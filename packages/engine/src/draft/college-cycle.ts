import type { Prng } from '../prng/index.js';
import type { LeagueState } from '../types/league.js';
import type { CollegeScout, CollegePlayer, CollegePlayerObservation, CombineMeasurables } from '../types/college.js';
import type { TeamId, PlayerId } from '../types/ids.js';
import {
  generateInitialCollegeObservations,
  generateCollegeObservation,
} from './college-observation.js';
import {
  buildSleeperProfiles,
  selectScoutSleepers,
  SLEEPER_CONFIDENCE_BONUS,
} from './sleepers.js';
import { aggregateCollegeSeasonStats } from '../college-season/season-stats.js';
import { generateMediaCollegeObservations } from '../media/prospect-evaluators.js';
import { buildProspectSleeperTake, buildMockBoardReport } from '../media/prospect-takes.js';
import { computeOutletMockBoard } from '../media/mock-boards.js';
import type { MediaReport } from '../types/media.js';

/**
 * Run one college-scouting cycle: every college scout produces a
 * fresh round of attributed observations on prospects in their
 * specialty group, with regional bias. Existing observations remain
 * — they're append-only — so multi-year evaluation arcs build up
 * organically across seasons. (A future "recency-weighted aggregation"
 * slice can let older reports decay; slice 2 just retains them all.)
 *
 * v0.68: after the regional sweep, each scout also rolls 3–5 personal
 * **sleepers** (see `sleepers.ts`) and files optimistic, high-
 * conviction observations of them — the source of board divergence
 * (each team's board diverges on who's a riser). Sleepers draw on two
 * signals available by this point in the calendar: season production
 * (tape) and combine measurables (workout risers).
 *
 * Called from `advanceSeason` after the NFL scouting cycle so the
 * new sim year's college pool (with seniors expired and freshmen
 * arrived) gets a fresh look. Same shape and intent as
 * `advanceScoutingCycle` for NFL scouts.
 */
export function advanceCollegeScoutingCycle(
  prng: Prng,
  league: LeagueState,
  observedOnTick: number,
): LeagueState {
  const scoutsByTeam: Record<string, CollegeScout[]> = {};
  for (const team of Object.values(league.teams)) {
    const teamScouts: CollegeScout[] = [];
    for (const sid of team.collegeScoutIds) {
      const scout = league.collegeScouts[sid];
      if (scout) teamScouts.push(scout);
    }
    scoutsByTeam[team.identity.id] = teamScouts;
  }

  const sweep = generateInitialCollegeObservations(
    prng.fork('cycle-cobs'),
    scoutsByTeam as Readonly<Record<TeamId, readonly CollegeScout[]>>,
    league.collegePool,
    observedOnTick,
  );

  // ── Sleepers ──────────────────────────────────────────────────────
  const seasonStats = aggregateCollegeSeasonStats(league.collegeGameStats);
  const profiles = buildSleeperProfiles(
    league.collegePool,
    league.combineResults as Readonly<Record<string, CombineMeasurables>>,
    seasonStats,
  );

  const poolById = new Map<PlayerId, CollegePlayer>(
    league.collegePool.map((cp) => [cp.id, cp]),
  );

  const sleeperObs: CollegePlayerObservation[] = [];
  if (profiles.size > 0) {
    const sleeperPrng = prng.fork('sleepers');
    for (const teamId of Object.keys(scoutsByTeam) as TeamId[]) {
      for (const scout of scoutsByTeam[teamId] ?? []) {
        const picks = selectScoutSleepers(sleeperPrng.fork(`s:${scout.id}`), scout, profiles);
        for (const pick of picks) {
          const prospect = poolById.get(pick.prospectId);
          if (!prospect) continue;
          sleeperObs.push(
            generateCollegeObservation(
              sleeperPrng.fork(`obs:${scout.id}:${pick.prospectId}`),
              scout,
              prospect,
              observedOnTick,
              SLEEPER_CONFIDENCE_BONUS,
              pick.love,
            ),
          );
        }
      }
    }
  }

  // ── Media's read on the class (separate stream) ───────────────────
  const mediaObs = generateMediaCollegeObservations(
    prng.fork('media-cobs'),
    league.mediaOutlets,
    league.collegePool,
    observedOnTick,
  );

  // ── Media sleeper-alert takes (narrative) ─────────────────────────
  // Each college outlet champions a couple of sleepers (loud outlets a
  // few more). Selection reuses the shared sleeper machinery; flavor is
  // driven by the channel + the outlet's hype.
  const takes: MediaReport[] = [];
  if (profiles.size > 0) {
    const takePrng = prng.fork('media-takes');
    // Generalist stand-in: no specialty, so sleeper selection is pure
    // worthiness (no position nudge). selectScoutSleepers only reads
    // `knownSpecialty`.
    const generalist = { knownSpecialty: '' } as unknown as CollegeScout;
    for (const outlet of Object.values(league.mediaOutlets)) {
      if (outlet.focus !== 'COLLEGE') continue;
      const outletPrng = takePrng.fork(`outlet:${outlet.id}`);
      const picks = selectScoutSleepers(outletPrng.fork('pick'), generalist, profiles).slice(
        0,
        outlet.hypeSpectrum >= 6 ? 3 : 2,
      );
      for (const pick of picks) {
        const prospect = poolById.get(pick.prospectId);
        if (!prospect) continue;
        takes.push(
          buildProspectSleeperTake(outletPrng.fork(`take:${pick.prospectId}`), {
            outlet,
            prospect,
            channel: pick.channel,
            filedOnTick: observedOnTick,
            seasonNumber: league.seasonNumber,
            lifecyclePhase: 'TOP_30_VISITS',
          }),
        );
      }
    }
  }

  // ── Mock-board headlines (top picks per outlet) ───────────────────
  // The full per-outlet + consensus boards are computed on demand from
  // the media stream; here each outlet publishes its premium picks.
  const updatedMediaStream = [...league.mediaCollegeObservations, ...mediaObs];
  for (const outlet of Object.values(league.mediaOutlets)) {
    if (outlet.focus !== 'COLLEGE') continue;
    const board = computeOutletMockBoard(updatedMediaStream, outlet.id, 3);
    for (const entry of board) {
      const prospect = poolById.get(entry.prospectId);
      if (!prospect) continue;
      takes.push(
        buildMockBoardReport({
          outlet,
          prospect,
          projectedOverallPick: entry.projectedOverallPick,
          filedOnTick: observedOnTick,
          seasonNumber: league.seasonNumber,
          lifecyclePhase: 'TOP_30_VISITS',
        }),
      );
    }
  }

  return {
    ...league,
    collegeObservations: [...league.collegeObservations, ...sweep, ...sleeperObs],
    mediaCollegeObservations: updatedMediaStream,
    mediaReports: [...league.mediaReports, ...takes],
  };
}
