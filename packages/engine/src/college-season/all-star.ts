/**
 * Draft all-star showcases (v0.65) — Senior Bowl + Shrine Bowl.
 *
 * The pre-draft all-star weeks are, in practice, the biggest concentrated
 * scouting event of the calendar: every NFL team sends scouts to watch
 * the top draft-eligible prospects practice and play. We model that as a
 * focused, higher-accuracy observation sweep on the invited participants
 * — sharpening each team's read (and therefore its board) on the players
 * who attend, ahead of the spring board regeneration. The two squads are
 * flavor for the inspector; the observation boost is the substance.
 *
 * Tuning knobs (see callers in lifecycle.ts): the invite `count`, the
 * `skipTop` offset (so the Shrine Bowl draws a tier below the Senior
 * Bowl), and the `accuracyBonus` applied to the sweep.
 */

import type { Prng } from '../prng/index.js';
import type { LeagueState } from '../types/league.js';
import type { CollegePlayer, CollegeScout, CollegePlayerObservation } from '../types/college.js';
import type { TeamId } from '../types/ids.js';
import type { AllStarGame } from '../types/college-season.js';
import { generateInitialCollegeObservations } from '../draft/college-observation.js';

export interface AllStarShowcaseOptions {
  /** Display name, e.g. "Senior Bowl". */
  name: string;
  squadAName: string;
  squadBName: string;
  /** How many prospects to invite. */
  count: number;
  /** Skip this many top prospects first (a second bowl draws a tier down). */
  skipTop: number;
  /** Per-skill accuracy bonus for the showcase scouting sweep (0..1). */
  accuracyBonus: number;
  observedOnTick: number;
}

export interface AllStarShowcaseResult {
  game: AllStarGame;
  observations: readonly CollegePlayerObservation[];
}

/**
 * Mean of a prospect's current skill ratings — a simple, deterministic
 * talent proxy for ranking invitees. The Senior Bowl takes the top tier;
 * the Shrine Bowl takes the next (`skipTop`).
 */
export function prospectTalentScore(cp: CollegePlayer): number {
  const values = Object.values(cp.current) as number[];
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/**
 * Pick the invitees, split them into two squads, and run the boosted
 * scouting sweep. Pure + deterministic for a given (prng, league, opts).
 */
export function runAllStarShowcase(
  prng: Prng,
  league: LeagueState,
  opts: AllStarShowcaseOptions,
): AllStarShowcaseResult {
  // Declared, draft-eligible prospects ranked by talent (deterministic
  // id tiebreak so equal-rated prospects order stably).
  const eligible = league.collegePool
    .filter((cp) => cp.isDraftEligible && cp.hasDeclared)
    .sort((a, b) => {
      const d = prospectTalentScore(b) - prospectTalentScore(a);
      if (d !== 0) return d;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

  const participants = eligible.slice(opts.skipTop, opts.skipTop + opts.count);

  // Split into two squads.
  const shuffled = [...participants];
  prng.fork('split').shuffle(shuffled);
  const half = Math.ceil(shuffled.length / 2);
  const squadA = shuffled.slice(0, half).map((p) => p.id);
  const squadB = shuffled.slice(half).map((p) => p.id);

  // Boosted scouting sweep on the participants only.
  const scoutsByTeam: Record<string, CollegeScout[]> = {};
  for (const team of Object.values(league.teams)) {
    const teamScouts: CollegeScout[] = [];
    for (const sid of team.collegeScoutIds) {
      const scout = league.collegeScouts[sid];
      if (scout) teamScouts.push(scout);
    }
    scoutsByTeam[team.identity.id] = teamScouts;
  }
  const observations = generateInitialCollegeObservations(
    prng.fork('obs'),
    scoutsByTeam as Readonly<Record<TeamId, readonly CollegeScout[]>>,
    participants,
    opts.observedOnTick,
    opts.accuracyBonus,
  );

  const game: AllStarGame = {
    id: `ALLSTAR_S${league.seasonNumber}_${opts.name.replace(/\s+/g, '_').toUpperCase()}`,
    name: opts.name,
    squadAName: opts.squadAName,
    squadBName: opts.squadBName,
    squadA,
    squadB,
  };

  return { game, observations };
}
