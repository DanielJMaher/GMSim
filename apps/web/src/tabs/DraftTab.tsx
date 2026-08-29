/**
 * Draft tab — the consensus college pool, per-team draft boards, media
 * mock boards + reliability panels, the pick-by-pick draft replay, trade-up
 * firings, and final draft results. Split out of App.tsx — pure code
 * motion, no behavior change.
 */
import React, { useMemo, useState } from 'react';
import { getArchetypeById, buildDraftBlurbs } from '@gmsim/engine';
import type { DraftBlurbs } from '@gmsim/engine';
import type { LeagueState, TeamState, Player, PlayerId, TeamId, CollegePlayer, ClassYear, CharacterFlag, DraftBoardEntry, DraftBoardReason, CombineMeasurables, DraftPickRecord, DraftProspectProfile } from '@gmsim/engine/types';
import { PositionGroup, Position } from '@gmsim/engine/types';
import { getSchoolById, positionGroupFor, computeConsensusBoard, consensusRankIndex, computeTeamNeeds, hasDesperateQbNeed, computeMediaConsensusBoard, computeOutletMockBoard, computeOutletQualityByGroup, prospectProjectedOverall, narrateBackstory, backstoryFromProspect } from '@gmsim/engine';
import type { OutletGroupQuality } from '@gmsim/engine';
import type { PositionNeed } from '@gmsim/engine';
import type { MediaReport } from '@gmsim/engine';
import { formatHeight, formatInches, POSITION_GROUPS_ORDERED, skillTone, prospectRealGradeFromCp, prospectRealGrade, consensusPerceivedGrades, CLASS_YEAR_LABELS, SKILL_GROUPS, SKILL_LABELS } from '../lib/format';
import { MeasureCell, GradeCell, DraftGradeCell } from '../lib/cells';

// ─── COLLEGE POOL PANEL (Doc 3 — Draft Module slice 1) ─────────────────────

const CLASS_YEAR_ORDER: readonly ClassYear[] = [
  'TRUE_FR', 'RS_FR', 'SO', 'JR', 'SR', 'RS_SR',
];

const VOICE_LABELS: Record<CollegePlayer['personalityVoice'], string> = {
  QUIET_WORKER: 'Quiet worker',
  ALPHA_LEADER: 'Alpha leader',
  BRASH: 'Brash',
  ANALYTICAL: 'Analytical',
  INSTINCTIVE: 'Instinctive',
  CHARISMATIC: 'Charismatic',
};

const FLAG_LABELS: Record<CharacterFlag, string> = {
  OFF_FIELD_INCIDENT: 'Off-field',
  COACH_CONFLICT: 'Coach conflict',
  INJURY_PRONE: 'Injury prone',
  LATE_BLOOMER: 'Late bloomer',
  TRANSFER_PORTAL: 'Transfer',
  CAPTAIN: 'Captain',
  ACADEMIC_HONORS: 'Academic',
  MEDIA_DARLING: 'Media darling',
  PRACTICE_LEGEND: 'Practice legend',
  WORKOUT_WARRIOR: 'Workout warrior',
  TAPE_STAR_POOR_TESTER: 'Tape star',
  SYSTEM_PRODUCT: 'System product',
  LEGACY: 'Legacy',
};

export function CollegePoolPanel({ league }: { league: LeagueState }) {
  const [expanded, setExpanded] = useState(false);
  const [expandedProspectId, setExpandedProspectId] = useState<PlayerId | null>(null);
  const pool = league.collegePool;
  const observations = league.collegeObservations;
  const collegeScouts = league.collegeScouts;

  // Consensus board derived from the league-wide 32 boards. Doc 3:
  // teams don't internally consume a consensus — engine never reads
  // this — but the inspector treats it as the most useful "what's
  // the league as a whole thinking" view of the prospect pool.
  const consensus = useMemo(
    () => computeConsensusBoard(league.draftBoards),
    [league.draftBoards],
  );
  const consensusRanks = useMemo(() => consensusRankIndex(consensus), [consensus]);
  // League's perceived grade per prospect (mean observed-skill across the
  // 32 boards) — shown vs the prospect's real overall on each row.
  const perceivedGrades = useMemo(() => consensusPerceivedGrades(league), [league]);

  const classCounts = useMemo(() => {
    const counts = new Map<ClassYear, number>();
    for (const cp of pool) counts.set(cp.classYear, (counts.get(cp.classYear) ?? 0) + 1);
    return counts;
  }, [pool]);

  const observationsByProspect = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of observations) m.set(o.collegePlayerId, (m.get(o.collegePlayerId) ?? 0) + 1);
    return m;
  }, [observations]);

  const collegeScoutCount = Object.keys(collegeScouts).length;

  const summary = useMemo(() => {
    let conversionCandidates = 0;
    let archetypeMisreads = 0;
    let withCharacterFlags = 0;
    let withBloodlines = 0;
    let starRatingHigh = 0;
    let smallSchoolGems = 0;
    for (const cp of pool) {
      if (cp.isConversionCandidate) conversionCandidates++;
      if (cp.archetypeMisreadFlag) archetypeMisreads++;
      if (cp.characterFlags.length > 0) withCharacterFlags++;
      if (cp.bloodline.hasNflFamily) withBloodlines++;
      if (cp.recruiting.starRating >= 4) starRatingHigh++;
      if (cp.recruiting.background === 'SMALL_SCHOOL_GEM' || cp.recruiting.background === 'WALK_ON_STORY') {
        smallSchoolGems++;
      }
    }
    return {
      conversionCandidates,
      archetypeMisreads,
      withCharacterFlags,
      withBloodlines,
      starRatingHigh,
      smallSchoolGems,
    };
  }, [pool]);

  const draftEligible = useMemo(
    () => pool.filter((cp) => cp.isDraftEligible),
    [pool],
  );

  // Consensus-ordered featured list. Prospects with no consensus
  // entry (i.e., not on any team's top-N board) fall to the bottom.
  // Per Doc 3 the boards filter to draft-eligible prospects, so the
  // consensus-eligible set ≈ the draftable cohort.
  const featured = useMemo(() => {
    const cpById = new Map(pool.map((cp) => [cp.id, cp] as const));
    const orderedFromConsensus: CollegePlayer[] = [];
    for (const entry of consensus) {
      const cp = cpById.get(entry.collegePlayerId);
      if (!cp) continue;
      if (!cp.isDraftEligible) continue;
      orderedFromConsensus.push(cp);
    }
    return orderedFromConsensus.slice(0, expanded ? 60 : 15);
  }, [consensus, pool, expanded]);

  return (
    <section className="mb-8 rounded border border-violet-500/30 bg-violet-500/5 p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-violet-300">
          Consensus Board — Live Draft Class (aggregated from 32 boards)
        </h2>
        <span className="text-xs text-zinc-500">
          {pool.length} prospects · {draftEligible.length} draft-eligible
          {' · '}
          <span className="text-violet-400">{consensus.length} on consensus</span>
          {' · '}
          <span className="text-violet-400">{collegeScoutCount} college scouts</span>
          {' · '}
          <span className="text-violet-400">{observations.length} reports</span>
        </span>
      </div>

      <div className="mb-3 grid grid-cols-3 gap-2 md:grid-cols-6">
        {CLASS_YEAR_ORDER.map((year) => (
          <div key={year} className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">
              {CLASS_YEAR_LABELS[year]}
            </div>
            <div className="font-mono text-sm text-zinc-200">{classCounts.get(year) ?? 0}</div>
          </div>
        ))}
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 text-xs md:grid-cols-3">
        <CollegePoolStat label="Conversion candidates" value={summary.conversionCandidates} />
        <CollegePoolStat label="Archetype misreads" value={summary.archetypeMisreads} />
        <CollegePoolStat label="With character flags" value={summary.withCharacterFlags} />
        <CollegePoolStat label="NFL bloodlines" value={summary.withBloodlines} />
        <CollegePoolStat label="4–5 star recruits" value={summary.starRatingHigh} />
        <CollegePoolStat label="Small-school / walk-ons" value={summary.smallSchoolGems} />
      </div>

      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Consensus top {featured.length} · ranked by mean priority across teams that carry the prospect
        </h3>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="rounded border border-zinc-700 bg-zinc-900/40 px-2 py-0.5 text-[11px] text-zinc-300 hover:border-violet-500/40 hover:text-violet-300"
        >
          {expanded ? 'show fewer' : 'show more'}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase tracking-wider text-zinc-500">
            <tr className="border-b border-zinc-800">
              <th className="px-2 py-1 text-right" title="Consensus rank — 1-based across the prospects on ≥1 team's board">#</th>
              <th className="px-2 py-1 text-left">Prospect</th>
              <th className="px-2 py-1 text-left">Class</th>
              <th className="px-2 py-1 text-left">School</th>
              <th className="px-2 py-1 text-left">Pos</th>
              <th className="px-2 py-1 text-left">NFL proj</th>
              <th className="px-2 py-1 text-right" title="perceived (league avg observed) / real overall">Grade</th>
              <th className="px-2 py-1 text-right" title="Draft grade (NFL.com 8-pt scale) — perceived (league consensus) / real (ground truth)">Draft grd</th>
              <th className="px-2 py-1 text-center" title="Teams (of 32) with this prospect on their top-50 board">Boards</th>
              <th className="px-2 py-1 text-center" title="Mean priority across teams that carry the prospect">Avg pri</th>
              <th className="px-2 py-1 text-center" title="Mean board rank across teams that carry the prospect">Avg rk</th>
              <th className="px-2 py-1 text-center">★</th>
              <th className="px-2 py-1 text-center">Tier</th>
              <th className="px-2 py-1 text-center" title="Reports filed by college scouts on this prospect">Reports</th>
              <th className="px-2 py-1 text-center" title="Combine 40-yard dash (italic = skipped)">40</th>
              <th className="px-2 py-1 text-left">Flags</th>
            </tr>
          </thead>
          <tbody>
            {featured.map((cp) => {
              const combine = league.combineResults[cp.id];
              const isOpen = expandedProspectId === cp.id;
              const consRank = consensusRanks.get(cp.id) ?? null;
              const consEntry = consRank !== null ? consensus[consRank - 1] ?? null : null;
              return (
                <React.Fragment key={cp.id}>
                  <CollegeProspectRow
                    prospect={cp}
                    reportCount={observationsByProspect.get(cp.id) ?? 0}
                    consensusRank={consRank}
                    consensusEntry={consEntry}
                    perceivedGrade={perceivedGrades.get(cp.id) ?? null}
                    isOpen={isOpen}
                    onClick={() =>
                      setExpandedProspectId(isOpen ? null : cp.id)
                    }
                    {...(combine ? { combine } : {})}
                  />
                  {isOpen && (
                    <tr className="border-t border-zinc-800 bg-zinc-950/60">
                      <td colSpan={16} className="px-3 py-3">
                        <CollegeProspectDetail prospect={cp} league={league} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-[10px] text-zinc-600">
        Consensus is diagnostic-only — the engine doesn't internally consume it (Doc 3:
        "no global consensus anything"). Boards column = teams (of 32) with this prospect
        on their top-50 board. Click a row for the full prospect dossier.
      </p>
    </section>
  );
}

function CollegePoolStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1">
      <span className="text-zinc-500">{label}: </span>
      <span className="font-mono text-zinc-200">{value}</span>
    </div>
  );
}

function CollegeProspectRow({
  prospect,
  reportCount,
  combine,
  consensusRank,
  consensusEntry,
  perceivedGrade,
  isOpen,
  onClick,
}: {
  prospect: CollegePlayer;
  reportCount: number;
  combine?: CombineMeasurables;
  consensusRank: number | null;
  consensusEntry: { appearances: number; averagePriority: number; averageRank: number } | null;
  perceivedGrade: number | null;
  isOpen: boolean;
  onClick: () => void;
}) {
  const school = getSchoolById(prospect.schoolId);
  const tierColor =
    prospect.tier === 'STAR' ? 'text-amber-300'
      : prospect.tier === 'STARTER' ? 'text-emerald-300'
        : prospect.tier === 'BACKUP' ? 'text-zinc-300'
          : 'text-zinc-500';
  const conversionTag = prospect.isConversionCandidate ? (
    <span className="ml-1 rounded bg-violet-500/20 px-1 text-[9px] font-mono text-violet-300" title="Conversion candidate">
      conv
    </span>
  ) : null;
  const misreadTag = prospect.archetypeMisreadFlag ? (
    <span className="ml-1 rounded bg-amber-500/20 px-1 text-[9px] font-mono text-amber-300" title="Assumed archetype differs from true archetype">
      misread
    </span>
  ) : null;
  const tierBadge = school ? (
    <span className={`ml-1 text-[9px] uppercase ${
      school.tier === 'POWER' ? 'text-emerald-400'
      : school.tier === 'GROUP_OF_5' ? 'text-sky-400'
      : school.tier === 'FCS' ? 'text-zinc-400' : 'text-zinc-600'}`}>
      {school.tier === 'GROUP_OF_5' ? 'G5' : school.tier === 'POWER' ? 'P5' : school.tier}
    </span>
  ) : null;
  const flagSummary = prospect.characterFlags.slice(0, 3).map((f) => FLAG_LABELS[f]).join(', ');
  return (
    <tr
      className={`cursor-pointer border-b border-zinc-900 hover:bg-zinc-900/30 ${isOpen ? 'bg-zinc-900/40' : ''}`}
      onClick={onClick}
    >
      <td className="px-2 py-1 text-right font-mono text-zinc-300">
        {consensusRank !== null ? consensusRank : <span className="text-zinc-700">—</span>}
      </td>
      <td className="px-2 py-1">
        <div className="font-medium text-zinc-100">
          <span className="mr-1 text-zinc-600">{isOpen ? '▼' : '▶'}</span>
          {prospect.firstName} {prospect.lastName}
        </div>
        <div className="text-[10px] text-zinc-500">
          {prospect.recruiting.hometown.city}, {prospect.recruiting.hometown.state}
          {prospect.bloodline.hasNflFamily && (
            <span className="ml-1 text-amber-400" title={`NFL ${prospect.bloodline.relation?.toLowerCase()}: ${prospect.bloodline.relativeName}`}>
              ⚜
            </span>
          )}
        </div>
      </td>
      <td className="px-2 py-1 font-mono text-zinc-400">{CLASS_YEAR_LABELS[prospect.classYear]}</td>
      <td className="px-2 py-1">
        <span className="text-zinc-300">{school?.name ?? prospect.schoolId}</span>
        {tierBadge}
      </td>
      <td className="px-2 py-1 font-mono text-zinc-300">{prospect.collegePosition}</td>
      <td className="px-2 py-1 font-mono">
        <span className={prospect.isConversionCandidate ? 'text-violet-300' : 'text-zinc-400'}>
          {prospect.nflProjectedPosition}
        </span>
        {conversionTag}
        {misreadTag}
      </td>
      <td className="px-2 py-1 text-right">
        <GradeCell
          perceived={perceivedGrade}
          real={prospectRealGradeFromCp(prospect)}
        />
      </td>
      <td className="px-2 py-1 text-right">
        <DraftGradeCell
          perceivedOverall={perceivedGrade}
          realOverall={prospectProjectedOverall(prospect)}
        />
      </td>
      <td className="px-2 py-1 text-center font-mono text-zinc-300">
        {consensusEntry ? (
          <span
            className={
              consensusEntry.appearances >= 20
                ? 'text-emerald-300'
                : consensusEntry.appearances >= 10
                  ? 'text-zinc-300'
                  : 'text-zinc-500'
            }
          >
            {consensusEntry.appearances}/32
          </span>
        ) : (
          <span className="text-zinc-700">—</span>
        )}
      </td>
      <td className="px-2 py-1 text-center font-mono text-zinc-300">
        {consensusEntry ? consensusEntry.averagePriority.toFixed(0) : <span className="text-zinc-700">—</span>}
      </td>
      <td className="px-2 py-1 text-center font-mono text-zinc-400">
        {consensusEntry ? consensusEntry.averageRank.toFixed(1) : <span className="text-zinc-700">—</span>}
      </td>
      <td className="px-2 py-1 text-center font-mono text-zinc-300">{prospect.recruiting.starRating}</td>
      <td className={`px-2 py-1 text-center font-mono ${tierColor}`}>{prospect.tier}</td>
      <td className={`px-2 py-1 text-center font-mono ${reportCount === 0 ? 'text-zinc-700' : reportCount >= 8 ? 'text-violet-300' : 'text-zinc-400'}`}>
        {reportCount}
      </td>
      <td className="px-2 py-1 text-center font-mono text-xs">
        {combine?.fortyYardSeconds !== undefined ? (
          <span className="text-emerald-300">{combine.fortyYardSeconds.toFixed(2)}</span>
        ) : combine ? (
          <span className="italic text-zinc-600" title="Prospect skipped this drill">DNP</span>
        ) : (
          <span className="text-zinc-700">—</span>
        )}
      </td>
      <td className="px-2 py-1 text-[10px] text-zinc-400">{flagSummary || <span className="text-zinc-600">—</span>}</td>
    </tr>
  );
}

function CollegeProspectDetail({
  prospect,
  league,
}: {
  prospect: CollegePlayer;
  league: LeagueState;
}) {
  const school = getSchoolById(prospect.schoolId);
  const trueArchetype = getArchetypeById(prospect.archetype);
  const assumedArchetype = getArchetypeById(prospect.assumedArchetype);
  const combine = league.combineResults[prospect.id];

  // Map of all college scouts → owning team for observation attribution.
  const scoutToTeam = useMemo(() => {
    const m = new Map<string, TeamState>();
    for (const team of Object.values(league.teams)) {
      for (const sid of team.collegeScoutIds) m.set(sid, team);
    }
    return m;
  }, [league.teams]);

  // All observations of this prospect, sorted by mean confidence desc.
  const prospectObservations = useMemo(() => {
    const obs = league.collegeObservations.filter((o) => o.collegePlayerId === prospect.id);
    const withMean = obs.map((o) => {
      const confs = Object.values(o.confidence).filter((c): c is number => typeof c === 'number');
      const mean = confs.length === 0 ? 0 : confs.reduce((s, c) => s + c, 0) / confs.length;
      return { obs: o, meanConf: mean };
    });
    withMean.sort((a, b) => b.meanConf - a.meanConf);
    return withMean;
  }, [league.collegeObservations, prospect.id]);

  // Which teams have this prospect on their draft board, and at what rank/priority/reason.
  const boardPlacements = useMemo(() => {
    const out: Array<{ team: TeamState; rank: number; entry: DraftBoardEntry }> = [];
    for (const team of Object.values(league.teams)) {
      const board = league.draftBoards[team.identity.id] ?? [];
      const idx = board.findIndex((e) => e.collegePlayerId === prospect.id);
      if (idx >= 0) {
        out.push({ team, rank: idx + 1, entry: board[idx]! });
      }
    }
    out.sort((a, b) => b.entry.priority - a.entry.priority);
    return out;
  }, [league.teams, league.draftBoards, prospect.id]);

  // Media takes about this prospect that carry a fuller scout report (v0.118) —
  // the Scribe's prose beneath the headline.
  const mediaScoutReports = useMemo(
    () =>
      league.mediaReports
        .filter(
          (r): r is Extract<MediaReport, { kind: 'player-take' }> =>
            r.kind === 'player-take' && r.subjectPlayerId === prospect.id && !!r.scoutReport,
        )
        .map((r) => ({ report: r, outlet: league.mediaOutlets[r.outletId] })),
    [league.mediaReports, league.mediaOutlets, prospect.id],
  );

  const m = prospect.measurables;
  const intang = prospect.hiddenIntangibles;

  return (
    <div className="space-y-3 text-xs">
      {/* Header strip */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-zinc-800 pb-2">
        <div className="text-sm font-semibold text-zinc-100">
          {prospect.firstName} {prospect.lastName}
        </div>
        <div className="text-zinc-400">
          {school?.name ?? prospect.schoolId} ({school?.conferenceId ?? '?'},{' '}
          {school?.tier === 'GROUP_OF_5' ? 'G5' : school?.tier ?? '?'})
        </div>
        <div className="text-zinc-500">
          {CLASS_YEAR_LABELS[prospect.classYear]} · {prospect.tier.toLowerCase()} ·{' '}
          {trueArchetype?.label ?? prospect.archetype}
        </div>
        <div className="text-zinc-600">
          born {prospect.birthDate} ·{' '}
          {prospect.recruiting.hometown.city}, {prospect.recruiting.hometown.state}
        </div>
        {prospect.bloodline.hasNflFamily && (
          <div className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">
            NFL legacy: {prospect.bloodline.relation?.toLowerCase()} {prospect.bloodline.relativeName}
            {prospect.bloodline.relativeWasStar && ' ★'}
          </div>
        )}
      </div>

      {trueArchetype?.description && (
        <div className="text-zinc-500">{trueArchetype.description}</div>
      )}

      {/* Backstory — the Narrator's prose from the prospect's bio facts (v0.119) */}
      <div className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
        <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">Backstory</div>
        <div className="text-zinc-300">{narrateBackstory(backstoryFromProspect(prospect))}</div>
        <div className="mt-1 flex flex-wrap gap-1">
          {[
            prospect.transferred && 'Transfer',
            prospect.redshirted && 'Redshirt',
          ]
            .filter((x): x is string => Boolean(x))
            .map((label) => (
              <span
                key={label}
                className="rounded border border-teal-500/30 bg-teal-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-teal-300"
              >
                {label}
              </span>
            ))}
        </div>
      </div>

      {/* Recruiting / Personality / Archetype tension */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">Recruiting</div>
          <div className="font-mono text-amber-300">
            {'★'.repeat(prospect.recruiting.starRating)}
            <span className="text-zinc-700">{'★'.repeat(5 - prospect.recruiting.starRating)}</span>
          </div>
          <div className="text-zinc-400">
            National rank: {prospect.recruiting.nationalRank ?? <span className="text-zinc-600">unranked</span>}
          </div>
          <div className="text-zinc-400">
            Background:{' '}
            <span className="font-mono uppercase tracking-wider text-zinc-300">
              {prospect.recruiting.background}
            </span>
          </div>
        </div>
        <div className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
            Personality (inspector view — hidden)
          </div>
          <div className="text-zinc-300">Voice: {VOICE_LABELS[prospect.personalityVoice]}</div>
          <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 font-mono text-zinc-400">
            <span>leader {intang.leadershipPresence}</span>
            <span>interview {intang.interviewSkill}</span>
            <span>work {intang.workEthic}</span>
            <span>coach {intang.coachability}</span>
            <span>compete {intang.competitiveness}</span>
            <span>fb char {intang.footballCharacter}</span>
          </div>
        </div>
        <div className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">Archetype</div>
          <div className="text-zinc-300">
            True: <span className="font-mono">{trueArchetype?.label ?? prospect.archetype}</span>
          </div>
          <div className="text-zinc-300">
            Assumed:{' '}
            <span className="font-mono">{assumedArchetype?.label ?? prospect.assumedArchetype}</span>
          </div>
          {prospect.archetypeMisreadFlag ? (
            <div className="mt-1 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">
              MISREAD — assumed differs from true
            </div>
          ) : (
            <div className="mt-1 text-[10px] text-zinc-600">aligned</div>
          )}
        </div>
      </div>

      {/* Position projection */}
      <div className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
        <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
          Position projection
        </div>
        <div className="flex flex-wrap items-baseline gap-x-3 text-zinc-300">
          <span>
            College:{' '}
            <span className="font-mono text-zinc-200">{prospect.collegePosition}</span>
          </span>
          <span>
            NFL projection:{' '}
            <span
              className={`font-mono ${prospect.isConversionCandidate ? 'text-violet-300' : 'text-zinc-200'}`}
            >
              {prospect.nflProjectedPosition}
            </span>
          </span>
          {prospect.isConversionCandidate && (
            <span className="rounded border border-violet-500/40 bg-violet-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-violet-300">
              conversion candidate
            </span>
          )}
          {prospect.alternatePositions.length > 0 && (
            <span className="text-zinc-500">
              alts:{' '}
              <span className="font-mono text-zinc-400">
                {prospect.alternatePositions.join(', ')}
              </span>
            </span>
          )}
        </div>
      </div>

      {/* Skills (current / ceiling) */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {SKILL_GROUPS.filter(
          (g) => !g.forGroups || g.forGroups.includes(positionGroupFor(prospect.nflProjectedPosition)),
        ).map((groupDef) => (
          <div key={groupDef.label} className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
              {groupDef.label}
            </div>
            <table className="w-full">
              <tbody>
                {groupDef.skills.map((skill) => {
                  const cur = prospect.current[skill];
                  const ceil = prospect.ceiling[skill];
                  return (
                    <tr key={skill}>
                      <td className="py-0.5 pr-2 text-zinc-400">{SKILL_LABELS[skill]}</td>
                      <td className={`py-0.5 pr-1 text-right font-mono ${skillTone(cur)}`}>{cur}</td>
                      <td
                        className="py-0.5 pr-2 text-right font-mono text-zinc-600"
                        title="Hidden ceiling — never shown to player"
                      >
                        /{ceil}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {/* Measurables + combine side by side */}
      <div className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
        <div className="mb-1 flex items-baseline justify-between text-[10px] uppercase tracking-wider text-zinc-500">
          <span>Measurables (truth vs combine)</span>
          <span className="normal-case text-zinc-600">
            italic = drill skipped; emerald = combine reported
          </span>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 sm:grid-cols-3 lg:grid-cols-5">
          <MeasureCell label="Height" truth={formatHeight(m.heightInches)} combine={combine?.heightInches !== undefined ? formatHeight(combine.heightInches) : undefined} attended={combine?.attended} />
          <MeasureCell label="Weight" truth={`${Math.round(m.weightLbs)} lb`} combine={combine?.weightLbs !== undefined ? `${Math.round(combine.weightLbs)} lb` : undefined} attended={combine?.attended} />
          <MeasureCell label="Arm" truth={formatInches(m.armLengthInches)} combine={combine?.armLengthInches !== undefined ? formatInches(combine.armLengthInches) : undefined} attended={combine?.attended} />
          <MeasureCell label="Hand" truth={formatInches(m.handSizeInches)} combine={combine?.handSizeInches !== undefined ? formatInches(combine.handSizeInches) : undefined} attended={combine?.attended} />
          <MeasureCell label="40-yd" truth={`${m.fortyYardSeconds.toFixed(2)}s`} combine={combine?.fortyYardSeconds !== undefined ? `${combine.fortyYardSeconds.toFixed(2)}s` : undefined} attended={combine?.attended} />
          <MeasureCell label="Bench" truth={`${m.benchPress225Reps}`} combine={combine?.benchPress225Reps !== undefined ? `${combine.benchPress225Reps}` : undefined} attended={combine?.attended} />
          <MeasureCell label="Vertical" truth={formatInches(m.verticalInches)} combine={combine?.verticalInches !== undefined ? formatInches(combine.verticalInches) : undefined} attended={combine?.attended} />
          <MeasureCell label="Broad" truth={formatInches(m.broadJumpInches)} combine={combine?.broadJumpInches !== undefined ? formatInches(combine.broadJumpInches) : undefined} attended={combine?.attended} />
          <MeasureCell label="3-cone" truth={`${m.threeConeSeconds.toFixed(2)}s`} combine={combine?.threeConeSeconds !== undefined ? `${combine.threeConeSeconds.toFixed(2)}s` : undefined} attended={combine?.attended} />
          <MeasureCell label="Shuttle" truth={`${m.shuttleSeconds.toFixed(2)}s`} combine={combine?.shuttleSeconds !== undefined ? `${combine.shuttleSeconds.toFixed(2)}s` : undefined} attended={combine?.attended} />
        </div>
      </div>

      {/* Character flags */}
      {prospect.characterFlags.length > 0 && (
        <div className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
            Character flags
          </div>
          <div className="flex flex-wrap gap-1">
            {prospect.characterFlags.map((f) => (
              <span
                key={f}
                className="rounded border border-fuchsia-500/30 bg-fuchsia-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-fuchsia-300"
              >
                {FLAG_LABELS[f]}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Media scouting reports — the Scribe's prose beneath each take (v0.118) */}
      {mediaScoutReports.length > 0 && (
        <div className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
            Media scouting reports
          </div>
          <div className="space-y-2">
            {mediaScoutReports.map(({ report, outlet }) => {
              const sr = report.scoutReport!;
              return (
                <div key={report.id} className="border-l-2 border-zinc-700 pl-2">
                  <div className="text-[10px] uppercase tracking-wider text-sky-400/80">
                    {outlet?.name ?? report.outletId}
                  </div>
                  <div className="text-zinc-300">{report.headline}</div>
                  <div className="mt-1 text-zinc-400">{sr.summary}</div>
                  <ul className="mt-0.5 space-y-0.5">
                    {sr.strengths.map((s, i) => (
                      <li key={i} className="text-emerald-300/80">
                        + {s}
                      </li>
                    ))}
                    <li className="text-amber-300/80">– {sr.concern}</li>
                  </ul>
                  {sr.comp && <div className="mt-0.5 italic text-zinc-500">{sr.comp}</div>}
                  <div className="mt-0.5 text-zinc-300">→ {sr.bottomLine}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* College stats per year */}
      {prospect.collegeStats.length > 0 && (
        <div className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
            College production (year-by-year)
          </div>
          <table className="w-full font-mono text-[10px]">
            <thead className="text-zinc-500">
              <tr>
                <th className="text-left font-normal">Yr</th>
                <th className="text-left font-normal">School</th>
                <th className="text-right font-normal">G</th>
                <th className="text-right font-normal">GS</th>
                <th className="text-right font-normal" title="Position-specific headline stats">stats</th>
              </tr>
            </thead>
            <tbody>
              {prospect.collegeStats.map((cs, idx) => (
                <tr key={idx} className="text-zinc-300">
                  <td>{CLASS_YEAR_LABELS[cs.classYear]}</td>
                  <td className="text-zinc-400">{getSchoolById(cs.schoolId)?.name ?? cs.schoolId}</td>
                  <td className="text-right">{cs.games}</td>
                  <td className="text-right">{cs.starts}</td>
                  <td className="text-right text-zinc-400">{collegeStatHeadline(prospect.collegePosition, cs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Injury history */}
      {prospect.injuryHistory.length > 0 && (
        <div className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
            Injury history
          </div>
          <ul className="space-y-0.5 text-[11px]">
            {prospect.injuryHistory.map((inj, idx) => (
              <li key={idx} className="flex justify-between gap-3 text-zinc-300">
                <span>
                  <span className="font-mono text-zinc-500">{CLASS_YEAR_LABELS[inj.classYear]}</span>{' '}
                  {inj.label}
                </span>
                <span className="text-zinc-500">
                  {inj.severity.toLowerCase()} · missed {inj.gamesMissed}g
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Coach visits cross-team */}
      <CoachVisitsSection prospect={prospect} league={league} />

      {/* Scout observations cross-team */}
      <div className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
        <div className="mb-1 flex items-baseline justify-between text-[10px] uppercase tracking-wider text-zinc-500">
          <span>Scout reports ({prospectObservations.length})</span>
          {prospectObservations.length > 10 && (
            <span className="normal-case text-zinc-600">showing top 10 by confidence</span>
          )}
        </div>
        {prospectObservations.length === 0 ? (
          <div className="text-zinc-600">No scout reports filed — coverage gap.</div>
        ) : (
          <table className="w-full text-[10px]">
            <thead className="text-zinc-500">
              <tr>
                <th className="text-left font-normal">Scout</th>
                <th className="text-left font-normal">Team</th>
                <th className="text-right font-normal">Conf</th>
                <th className="text-right font-normal" title="Observed speed">spd</th>
                <th className="text-right font-normal" title="Observed football IQ">iq</th>
                <th className="text-right font-normal" title="Observed technical skill">tech</th>
                <th className="text-right font-normal" title="Sim tick observed">tick</th>
              </tr>
            </thead>
            <tbody>
              {prospectObservations.slice(0, 10).map(({ obs, meanConf }, idx) => {
                const scout = league.collegeScouts[obs.scoutId];
                const team = scoutToTeam.get(obs.scoutId);
                return (
                  <tr key={`${obs.scoutId}-${idx}`} className="text-zinc-300">
                    <td>{scout?.name ?? obs.scoutId}</td>
                    <td className="text-zinc-400">{team?.identity.abbreviation ?? '?'}</td>
                    <td className="text-right font-mono text-zinc-300">{meanConf.toFixed(2)}</td>
                    <td className="text-right font-mono text-zinc-400">{obs.skills.speed ?? '—'}</td>
                    <td className="text-right font-mono text-zinc-400">{obs.skills.footballIq ?? '—'}</td>
                    <td className="text-right font-mono text-zinc-400">{obs.skills.technicalSkill ?? '—'}</td>
                    <td className="text-right font-mono text-zinc-600">{obs.observedOnTick}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Draft board placements across the league */}
      <div className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
        <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
          On {boardPlacements.length}/32 team draft boards
        </div>
        {boardPlacements.length === 0 ? (
          <div className="text-zinc-600">No team currently has this prospect on their top-50 board.</div>
        ) : (
          <table className="w-full text-[10px]">
            <thead className="text-zinc-500">
              <tr>
                <th className="text-left font-normal">Team</th>
                <th className="text-right font-normal">Rank</th>
                <th className="text-right font-normal">Priority</th>
                <th className="text-right font-normal">Fit</th>
                <th className="text-left font-normal">Reason</th>
              </tr>
            </thead>
            <tbody>
              {boardPlacements.map(({ team, rank, entry }) => (
                <tr key={team.identity.id} className="text-zinc-300">
                  <td>{team.identity.abbreviation}</td>
                  <td className="text-right font-mono">#{rank}</td>
                  <td className="text-right font-mono text-amber-300">{entry.priority.toFixed(1)}</td>
                  <td className="text-right font-mono text-zinc-400">{entry.schemeFit.toFixed(2)}</td>
                  <td className={`text-[10px] uppercase ${REASON_COLORS[entry.reason]}`}>
                    {REASON_LABELS[entry.reason]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function CoachVisitsSection({
  prospect,
  league,
}: {
  prospect: CollegePlayer;
  league: LeagueState;
}) {
  // Map coach id → owning team for attribution.
  const coachToTeam = useMemo(() => {
    const m = new Map<string, TeamState>();
    for (const team of Object.values(league.teams)) {
      m.set(team.headCoachId, team);
    }
    return m;
  }, [league.teams]);

  const visits = useMemo(
    () =>
      league.coachVisitObservations
        .filter((v) => v.collegePlayerId === prospect.id)
        .sort((a, b) => b.observedOnTick - a.observedOnTick),
    [league.coachVisitObservations, prospect.id],
  );

  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
      <div className="mb-1 flex items-baseline justify-between text-[10px] uppercase tracking-wider text-zinc-500">
        <span>Coach visits ({visits.length})</span>
        <span className="normal-case text-zinc-600">
          intangibles + scheme fit only · higher accuracy than scouts
        </span>
      </div>
      {visits.length === 0 ? (
        <div className="text-zinc-600">No coach has filed a visit on this prospect yet.</div>
      ) : (
        <table className="w-full text-[10px]">
          <thead className="text-zinc-500">
            <tr>
              <th className="text-left font-normal">Coach</th>
              <th className="text-left font-normal">Team</th>
              <th className="text-right font-normal">Conf</th>
              <th className="text-right font-normal" title="Observed leadership">lead</th>
              <th className="text-right font-normal" title="Observed football IQ">iq</th>
              <th className="text-right font-normal" title="Observed coachability">coach</th>
              <th className="text-right font-normal" title="Observed technical skill (scheme fit proxy)">scheme</th>
              <th className="text-right font-normal" title="Sim tick observed">tick</th>
            </tr>
          </thead>
          <tbody>
            {visits.map((v, idx) => {
              const coach = league.coaches[v.coachId];
              const team = coachToTeam.get(v.coachId);
              const conf = v.confidence.leadership ?? v.confidence.footballIq ?? 0;
              return (
                <tr key={`${v.coachId}-${idx}`} className="text-zinc-300">
                  <td>{coach?.name ?? v.coachId}</td>
                  <td className="text-zinc-400">{team?.identity.abbreviation ?? '?'}</td>
                  <td className="text-right font-mono text-emerald-300">{conf.toFixed(2)}</td>
                  <td className="text-right font-mono text-zinc-300">{v.skills.leadership ?? '—'}</td>
                  <td className="text-right font-mono text-zinc-300">{v.skills.footballIq ?? '—'}</td>
                  <td className="text-right font-mono text-zinc-300">{v.skills.coachability ?? '—'}</td>
                  <td className="text-right font-mono text-zinc-300">{v.skills.technicalSkill ?? '—'}</td>
                  <td className="text-right font-mono text-zinc-600">{v.observedOnTick}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function collegeStatHeadline(
  position: Position,
  s: CollegePlayer['collegeStats'][number],
): string {
  switch (position) {
    case Position.QB:
      return `${s.passCompletions}/${s.passAttempts}, ${s.passingYards} yd, ${s.passingTds} TD, ${s.interceptionsThrown} INT`;
    case Position.RB:
    case Position.FB:
      return `${s.rushingAttempts} att, ${s.rushingYards} yd, ${s.rushingTds} TD`;
    case Position.WR:
    case Position.TE:
      return `${s.receptions} rec, ${s.receivingYards} yd, ${s.receivingTds} TD`;
    case Position.EDGE:
    case Position.DT:
    case Position.NT:
    case Position.OLB:
      return `${s.tackles} tkl, ${s.sacks} sk, ${s.forcedFumbles} FF`;
    case Position.ILB:
      return `${s.tackles} tkl, ${s.sacks} sk, ${s.interceptions} INT`;
    case Position.CB:
    case Position.NICKEL:
    case Position.S:
      return `${s.tackles} tkl, ${s.interceptions} INT, ${s.passesDefended} PD`;
    default:
      return `${s.games} g / ${s.starts} GS`;
  }
}

// ─── TEAM NEEDS STRIP (v0.55) ──────────────────────────────────────────────
//
// Compact display of a team's top-N positional needs, computed from
// `computeTeamNeeds`. Reused in DraftBoardsPanel (per-team) and
// DraftReplayPanel (on-clock team at each pick).

function TeamNeedsStrip({
  needs,
  topN = 5,
  label = 'Needs (now)',
  tone = 'amber',
  qbDesperate = false,
}: {
  needs: readonly PositionNeed[];
  topN?: number;
  label?: string;
  tone?: 'amber' | 'sky';
  /** Show the binary desperate-QB badge the engine's draft logic acts on —
   *  the scored top-N can bury QB under sheer volume of other holes. */
  qbDesperate?: boolean;
}) {
  const top = needs.slice(0, topN);
  const accent =
    tone === 'amber'
      ? 'text-amber-200 border-amber-500/40 bg-amber-500/10'
      : 'text-sky-200 border-sky-500/40 bg-sky-500/10';
  return (
    <div className="flex flex-wrap items-baseline gap-1.5 text-[11px]">
      <span className="uppercase tracking-wide text-[10px] text-zinc-500">{label}</span>
      {qbDesperate && (
        <span
          className="rounded border border-rose-500/50 bg-rose-500/15 px-1.5 py-0.5 font-mono text-[10px] uppercase text-rose-300"
          title="hasDesperateQbNeed — no starter-quality QB and no recent first-round QB on the roster. This binary flag (not the scored list below) drives the QB reach and the need-aware slot premium, so it can be true even when QB doesn't crack the top-5 scored needs."
        >
          QB-desperate
        </span>
      )}
      {top.map((n, i) => (
        <span
          key={n.position}
          className={`rounded border px-1.5 py-0.5 font-mono ${accent}`}
          title={`${n.position} — score ${n.score.toFixed(2)} (pos-value ×${n.positionValue.toFixed(2)}) · starters ${n.starterCount}/${n.blueprintTarget}${n.bestStarterAge !== null ? ` · best age ${n.bestStarterAge}` : ''}`}
        >
          <span className="mr-1 text-zinc-500">{i + 1}.</span>
          {n.position}
          <span className="ml-1 text-[9px] text-zinc-400">{n.score.toFixed(1)}</span>
        </span>
      ))}
    </div>
  );
}

// ─── DRAFT BOARDS PANEL (Doc 3 — Draft Module slice 3) ─────────────────────

const REASON_LABELS: Record<DraftBoardReason, string> = {
  BLUE_CHIP: 'Blue chip',
  SCHEME_FIT: 'Scheme fit',
  POSITIONAL_NEED: 'Need',
  CONVERSION_PROJECTION: 'Conversion',
  DEVELOPMENTAL: 'Developmental',
};

const REASON_COLORS: Record<DraftBoardReason, string> = {
  BLUE_CHIP: 'text-amber-300',
  SCHEME_FIT: 'text-emerald-300',
  POSITIONAL_NEED: 'text-sky-300',
  CONVERSION_PROJECTION: 'text-violet-300',
  DEVELOPMENTAL: 'text-zinc-300',
};

type PositionFilter = PositionGroup | 'ALL';

const POSITION_FILTER_OPTIONS: ReadonlyArray<{ value: PositionFilter; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: PositionGroup.QB, label: 'QB' },
  { value: PositionGroup.SKILL, label: 'Skill (RB/WR/TE)' },
  { value: PositionGroup.OL, label: 'OL' },
  { value: PositionGroup.DL, label: 'DL' },
  { value: PositionGroup.LB, label: 'LB' },
  { value: PositionGroup.DB, label: 'DB' },
  { value: PositionGroup.ST, label: 'ST' },
];

export function DraftBoardsPanel({ league }: { league: LeagueState }) {
  const teamsList = useMemo(
    () =>
      Object.values(league.teams).sort((a, b) =>
        a.identity.location.localeCompare(b.identity.location),
      ),
    [league.teams],
  );
  const [selectedTeamId, setSelectedTeamId] = useState(teamsList[0]?.identity.id ?? null);
  const [topN, setTopN] = useState(20);
  const [positionFilter, setPositionFilter] = useState<PositionFilter>('ALL');

  // View selector: 'current' shows the live `league.draftBoards`
  // (regenerated post-advance for the next draft). A number selects
  // the historical snapshot `league.draftBoardSnapshots[season]` —
  // the board the team actually used to make that season's picks.
  // Diagnosis is much clearer reading from the snapshot when
  // comparing against the draft-results table.
  const snapshotSeasons = useMemo(() => {
    const out: number[] = Object.keys(league.draftBoardSnapshots).map(Number);
    out.sort((a, b) => b - a);
    return out;
  }, [league.draftBoardSnapshots]);
  // User-selected view, or null = auto-default to most-recent
  // snapshot (falling back to 'current' if no snapshots exist).
  // Derived as `viewMode` below so the panel re-resolves when
  // snapshots appear mid-session (e.g., after the first
  // simulate + advance) — the old useState lazy initializer
  // captured an empty snapshotSeasons on first mount and stayed
  // stuck on 'current' forever.
  const [userViewMode, setUserViewMode] = useState<'current' | number | null>(null);
  const viewMode: 'current' | number =
    userViewMode ?? snapshotSeasons[0] ?? 'current';
  const setViewMode = setUserViewMode;
  // Filter the board to prospects who did NOT get drafted in this
  // view's season. For 'current' the toggle is a no-op (no draft
  // has fired yet for the upcoming pool). For a snapshot, it
  // shows "who fell through your board" — useful diagnostic.
  const [undraftedOnly, setUndraftedOnly] = useState(false);

  const board: readonly DraftBoardEntry[] =
    selectedTeamId
      ? viewMode === 'current'
        ? league.draftBoards[selectedTeamId] ?? []
        : league.draftBoardSnapshots[viewMode]?.[selectedTeamId] ?? []
      : [];

  const prospectById = useMemo(() => {
    const m = new Map(league.collegePool.map((cp) => [cp.id, cp] as const));
    return m;
  }, [league.collegePool]);

  // Map for resolving names — covers both pool prospects (still in
  // college) AND drafted prospects (promoted to league.players with
  // PlayerId preserved). Without the players-side lookup, drafted
  // entries on a snapshot board would render as raw CP_... ids.
  const nameAndPosLookup = useMemo(() => {
    const m = new Map<string, { firstName: string; lastName: string; position: Position; schoolId?: string }>();
    for (const cp of league.collegePool) {
      m.set(cp.id, { firstName: cp.firstName, lastName: cp.lastName, position: cp.nflProjectedPosition, schoolId: cp.schoolId });
    }
    for (const p of Object.values(league.players)) {
      if (!m.has(p.id)) {
        m.set(p.id, { firstName: p.firstName, lastName: p.lastName, position: p.position });
      }
    }
    return m;
  }, [league.collegePool, league.players]);

  // Set of prospects drafted in the snapshot's season (empty when
  // viewing 'current'). Used by the undrafted-only toggle.
  const draftedInThisSeason = useMemo(() => {
    if (viewMode === 'current') return new Set<string>();
    const s = new Set<string>();
    for (const p of league.draftHistory) {
      if (p.seasonNumber === viewMode) s.add(p.collegePlayerId);
    }
    return s;
  }, [league.draftHistory, viewMode]);

  // Attach the original board rank to each entry BEFORE filtering so
  // the "#" column shows real overall rank — filtered re-ranks would
  // lie about board position.
  const rankedEntries = useMemo(() => {
    return board.map((entry, idx) => ({ entry, rank: idx + 1 }));
  }, [board]);

  const filteredRanked = useMemo(() => {
    let entries = rankedEntries;
    if (positionFilter !== 'ALL') {
      entries = entries.filter(({ entry }) => {
        const meta = nameAndPosLookup.get(entry.collegePlayerId);
        if (!meta) return false;
        return positionGroupFor(meta.position) === positionFilter;
      });
    }
    if (undraftedOnly && viewMode !== 'current') {
      entries = entries.filter(({ entry }) => !draftedInThisSeason.has(entry.collegePlayerId));
    }
    return entries;
  }, [rankedEntries, positionFilter, nameAndPosLookup, undraftedOnly, viewMode, draftedInThisSeason]);

  // Reason counts reflect the filtered set — flips dynamically with the
  // position filter so badges read "how many BLUE_CHIPs at QB" when
  // QB is selected.
  const reasonCounts = useMemo(() => {
    const counts: Record<DraftBoardReason, number> = {
      BLUE_CHIP: 0, SCHEME_FIT: 0, POSITIONAL_NEED: 0, CONVERSION_PROJECTION: 0, DEVELOPMENTAL: 0,
    };
    for (const { entry } of filteredRanked) counts[entry.reason]++;
    return counts;
  }, [filteredRanked]);

  const selectedTeam = selectedTeamId ? league.teams[selectedTeamId] : null;
  const selectedHc = selectedTeam ? league.coaches[selectedTeam.headCoachId] : null;
  const selectedTeamNeeds = useMemo(
    () => (selectedTeam ? computeTeamNeeds(selectedTeam, league) : []),
    [selectedTeam, league],
  );

  return (
    <section className="mb-8 rounded border border-violet-500/40 bg-violet-500/10 p-4">
      <div className="mb-3 flex items-baseline justify-between flex-wrap gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-violet-200">
          Draft Boards —{' '}
          {viewMode === 'current'
            ? 'current (upcoming draft)'
            : `season ${viewMode} snapshot (at draft time)`}
        </h2>
        <div className="flex items-center gap-3 text-xs flex-wrap">
          <label className="flex items-center gap-1 text-zinc-400">
            <span className="uppercase tracking-wide text-[10px]">View</span>
            <select
              value={String(viewMode)}
              onChange={(e) => {
                const v = e.target.value;
                setViewMode(v === 'current' ? 'current' : Number(v));
              }}
              className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 font-mono text-xs focus:border-violet-500 focus:outline-none"
            >
              <option value="current">Current (upcoming)</option>
              {snapshotSeasons.map((s) => (
                <option key={s} value={String(s)}>
                  Season {s} snapshot
                </option>
              ))}
            </select>
          </label>
          {viewMode !== 'current' && (
            <button
              onClick={() => setUndraftedOnly((v) => !v)}
              className={`rounded border px-2 py-0.5 font-mono text-[10px] transition-colors ${
                undraftedOnly
                  ? 'border-violet-500/50 bg-violet-500/20 text-violet-200'
                  : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-violet-500/30'
              }`}
              title={undraftedOnly
                ? "Showing only board entries who weren't drafted in this season. Click to show all."
                : "Showing the full snapshot board. Click to hide entries who got drafted in this season."}
            >
              {undraftedOnly ? 'undrafted only' : 'show all'}
            </button>
          )}
          <label className="flex items-center gap-1 text-zinc-400">
            <span className="uppercase tracking-wide text-[10px]">Team</span>
            <select
              value={selectedTeamId ?? ''}
              onChange={(e) => setSelectedTeamId(e.target.value as TeamId)}
              className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 font-mono text-xs focus:border-violet-500 focus:outline-none"
            >
              {teamsList.map((t) => (
                <option key={t.identity.id} value={t.identity.id}>
                  {t.identity.abbreviation} — {t.identity.fullName}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1 text-zinc-400">
            <span className="uppercase tracking-wide text-[10px]">Pos</span>
            <select
              value={positionFilter}
              onChange={(e) => setPositionFilter(e.target.value as PositionFilter)}
              className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 font-mono text-xs focus:border-violet-500 focus:outline-none"
            >
              {POSITION_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1 text-zinc-400">
            <span className="uppercase tracking-wide text-[10px]">Top</span>
            {[10, 20, 50].map((n) => (
              <button
                key={n}
                onClick={() => setTopN(n)}
                className={`rounded border px-2 py-0.5 font-mono ${
                  topN === n
                    ? 'border-violet-400 bg-violet-500/30 text-violet-100'
                    : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-violet-500/40 hover:text-violet-300'
                }`}
              >
                {n}
              </button>
            ))}
          </label>
        </div>
      </div>

      {selectedHc && (
        <p className="mb-2 text-xs text-zinc-500">
          Scheme: <span className="font-mono text-emerald-300">{selectedHc.offensiveScheme}</span>
          {' / '}
          <span className="font-mono text-emerald-300">{selectedHc.defensiveScheme}</span>
          {' · '}
          HC: <span className="text-zinc-300">{selectedHc.name}</span>
        </p>
      )}

      {selectedTeamNeeds.length > 0 && (
        <div className="mb-3">
          <TeamNeedsStrip
            needs={selectedTeamNeeds}
            qbDesperate={selectedTeam ? hasDesperateQbNeed(selectedTeam, league.players) : false}
          />
        </div>
      )}

      <div className="mb-3 grid grid-cols-2 gap-2 text-xs md:grid-cols-5">
        {(['BLUE_CHIP', 'SCHEME_FIT', 'POSITIONAL_NEED', 'CONVERSION_PROJECTION', 'DEVELOPMENTAL'] as DraftBoardReason[]).map((r) => (
          <div key={r} className="rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1">
            <span className={REASON_COLORS[r]}>{REASON_LABELS[r]}</span>
            <span className="ml-2 font-mono text-zinc-300">{reasonCounts[r]}</span>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase tracking-wider text-zinc-500">
            <tr className="border-b border-zinc-800">
              <th className="px-2 py-1 text-right">#</th>
              <th className="px-2 py-1 text-left">Prospect</th>
              <th className="px-2 py-1 text-left">School</th>
              <th className="px-2 py-1 text-left">NFL proj</th>
              <th className="px-2 py-1 text-right">Priority</th>
              <th className="px-2 py-1 text-right" title="perceived / real overall">Grade</th>
              <th className="px-2 py-1 text-right" title="Draft grade (NFL.com 8-pt scale) — perceived (team board) / real (ground truth)">Draft grd</th>
              <th className="px-2 py-1 text-right">Fit</th>
              <th className="px-2 py-1 text-right">Conf</th>
              <th className="px-2 py-1 text-center">N</th>
              <th className="px-2 py-1 text-left">Reason</th>
            </tr>
          </thead>
          <tbody>
            {filteredRanked.slice(0, topN).map(({ entry, rank }) => {
              const cp = prospectById.get(entry.collegePlayerId);
              const fromPlayers = league.players[entry.collegePlayerId];
              const meta = nameAndPosLookup.get(entry.collegePlayerId);
              // Snapshot view can reference prospects who've since
              // been drafted (no longer in collegePool). Fall back to
              // the rookie's NFL record for name + position.
              if (!cp && !fromPlayers) return null;
              const wasDraftedHere = draftedInThisSeason.has(entry.collegePlayerId);
              const draftPick = wasDraftedHere
                ? league.draftHistory.find(
                    (p) =>
                      p.collegePlayerId === entry.collegePlayerId &&
                      p.seasonNumber === viewMode,
                  )
                : undefined;
              return (
                <tr
                  key={entry.collegePlayerId}
                  className={`border-b border-zinc-900 hover:bg-zinc-900/30 ${
                    wasDraftedHere ? 'opacity-70' : ''
                  }`}
                >
                  <td className="px-2 py-1 text-right font-mono text-zinc-500">{rank}</td>
                  <td className="px-2 py-1">
                    <div className="font-medium text-zinc-100">
                      {meta ? `${meta.firstName} ${meta.lastName}` : entry.collegePlayerId}
                      {wasDraftedHere && draftPick && (
                        <span
                          className="ml-2 rounded bg-amber-500/20 px-1 text-[9px] font-mono text-amber-300"
                          title={`Drafted at #${draftPick.overallPick} by ${league.teams[draftPick.teamId]?.identity.abbreviation ?? '?'}`}
                        >
                          → #{draftPick.overallPick}
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      {cp ? (
                        <>
                          {cp.classYear} · {cp.recruiting.starRating}★
                          {cp.bloodline.hasNflFamily && (
                            <span
                              className="ml-1 text-amber-400"
                              title={`NFL legacy: ${cp.bloodline.relativeName}`}
                            >
                              ⚜
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-zinc-600">drafted prospect</span>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-1 text-zinc-300">
                    {cp
                      ? getSchoolById(cp.schoolId)?.name ?? cp.schoolId
                      : meta?.schoolId
                        ? getSchoolById(meta.schoolId)?.name ?? meta.schoolId
                        : '—'}
                  </td>
                  <td className="px-2 py-1 font-mono">
                    <span
                      className={
                        cp?.isConversionCandidate ? 'text-violet-300' : 'text-zinc-400'
                      }
                    >
                      {cp
                        ? cp.collegePosition !== cp.nflProjectedPosition
                          ? `${cp.collegePosition}→${cp.nflProjectedPosition}`
                          : cp.nflProjectedPosition
                        : meta?.position ?? '?'}
                    </span>
                    {cp && entry.assignedPosition && entry.assignedPosition !== cp.nflProjectedPosition && (
                      <span
                        className="ml-1 rounded bg-sky-500/20 px-1 text-[9px] font-mono text-sky-300"
                        title={`This team would convert him to ${entry.assignedPosition} (roster need at that spot)`}
                      >
                        ⇄{entry.assignedPosition}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1 text-right font-mono text-amber-300">{entry.priority.toFixed(1)}</td>
                  <td className="px-2 py-1 text-right">
                    <GradeCell
                      perceived={Math.round(entry.observedSkillScore)}
                      real={prospectRealGrade(league, entry.collegePlayerId)}
                    />
                  </td>
                  <td className="px-2 py-1 text-right">
                    <DraftGradeCell
                      perceivedOverall={entry.observedSkillScore}
                      realOverall={cp ? prospectProjectedOverall(cp) : null}
                    />
                  </td>
                  <td className="px-2 py-1 text-right font-mono text-zinc-300">{entry.schemeFit.toFixed(2)}</td>
                  <td className="px-2 py-1 text-right font-mono text-zinc-300">{entry.meanConfidence.toFixed(2)}</td>
                  <td className="px-2 py-1 text-center font-mono text-zinc-400">{entry.observationCount}</td>
                  <td className={`px-2 py-1 text-[10px] uppercase tracking-wide ${REASON_COLORS[entry.reason]}`}>
                    {REASON_LABELS[entry.reason]}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-[10px] text-zinc-600">
        {viewMode === 'current'
          ? "Current view = boards regenerated post-advance for the UPCOMING draft, not the one that just fired. Switch to a season snapshot to see the board the team actually used to make picks."
          : "Snapshot view = the team's board AS IT WAS the moment that season's draft fired. Faded rows + → #N badges mark prospects who got drafted in this draft (with their pick number); the rest fell through the board."}
      </p>
    </section>
  );
}

// ─── DRAFT REPLAY PANEL (v0.50) ───────────────────────────────────────────
//
// Step-through view of a completed draft. Surfaces the picking team's
// internal board, the consensus board (derived from all 32 boards),
// the picked player's ground-truth stats, and — the primary diagnostic
// — the reach delta between the team's evaluation and the league
// consensus at each pick. Daniel's "are boards reaching too far down
// consensus?" hypothesis is exactly what this panel exists to make
// answerable.

export function DraftReplayPanel({ league }: { league: LeagueState }) {
  // Available seasons = those with both a snapshot AND picks in history.
  // Pre-v0.50 saves can have draft history without snapshots; new
  // drafts will populate snapshots going forward.
  const availableSeasons = useMemo(() => {
    const seasonsInHistory = new Set<number>();
    for (const p of league.draftHistory) seasonsInHistory.add(p.seasonNumber);
    const out: number[] = [];
    for (const s of Object.keys(league.draftBoardSnapshots)) {
      const n = Number(s);
      if (seasonsInHistory.has(n)) out.push(n);
    }
    return out.sort((a, b) => b - a); // newest first
  }, [league.draftHistory, league.draftBoardSnapshots]);

  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const effectiveSeason = selectedSeason ?? availableSeasons[0] ?? null;

  const picks = useMemo(() => {
    if (effectiveSeason === null) return [];
    return league.draftHistory
      .filter((p) => p.seasonNumber === effectiveSeason)
      .sort((a, b) => a.overallPick - b.overallPick);
  }, [league.draftHistory, effectiveSeason]);

  const [pickIndex, setPickIndex] = useState(0);
  const safePickIndex = Math.max(0, Math.min(pickIndex, picks.length - 1));
  const currentPick: DraftPickRecord | null =
    picks.length > 0 ? picks[safePickIndex] ?? null : null;

  // Toggle: filter the picking team's board to prospects still
  // available at this slot (i.e., not taken by any earlier pick).
  // The board shown by default is the FULL pre-draft snapshot, which
  // is misleading mid-draft — "Frank Ross #3 picked over Aaron Nelson
  // #2" is fine when #2 was taken first by an earlier team. Toggle
  // OFF shows the original pre-draft snapshot.
  const [filterToAvailable, setFilterToAvailable] = useState(true);

  // Set of prospects picked at any slot STRICTLY before this one.
  // Used to filter the picking team's board view when the toggle is on.
  const pickedBeforeThisSlot = useMemo(() => {
    const s = new Set<PlayerId>();
    for (let i = 0; i < safePickIndex; i++) {
      const p = picks[i];
      if (p) s.add(p.collegePlayerId);
    }
    return s;
  }, [picks, safePickIndex]);

  const snapshot = useMemo(() => {
    if (effectiveSeason === null) return null;
    return league.draftBoardSnapshots[effectiveSeason] ?? null;
  }, [effectiveSeason, league.draftBoardSnapshots]);

  const consensus = useMemo(() => {
    if (!snapshot) return [];
    return computeConsensusBoard(snapshot);
  }, [snapshot]);

  const consensusRank = useMemo(() => consensusRankIndex(consensus), [consensus]);

  // Name + position lookup that resolves BOTH undrafted prospects
  // (still in collegePool) and drafted ones (promoted to
  // league.players with the same PlayerId). Without this we render
  // raw CP_... ids for every player picked in the current draft.
  const nameLookup = useMemo(() => {
    const m = new Map<PlayerId, ProspectNameRecord>();
    for (const cp of league.collegePool) {
      m.set(cp.id, {
        firstName: cp.firstName,
        lastName: cp.lastName,
        position: cp.nflProjectedPosition,
      });
    }
    for (const p of Object.values(league.players)) {
      if (!m.has(p.id)) {
        m.set(p.id, {
          firstName: p.firstName,
          lastName: p.lastName,
          position: p.position,
        });
      }
    }
    return m;
  }, [league.collegePool, league.players]);

  // Aggregate reach distribution across the whole draft — small
  // sparkline that lets Daniel scan the variance at a glance. Hook
  // call lifted above the early returns so the hook count stays
  // stable across renders (React Rules of Hooks).
  const reachDistribution = useMemo(() => {
    const buckets: Record<string, number> = {};
    let total = 0;
    let above = 0;
    let big = 0;
    for (const p of picks) {
      const r = consensusRank.get(p.collegePlayerId);
      if (r === undefined) continue;
      const reach = r - p.overallPick;
      total++;
      if (reach > 0) above++;
      if (reach >= 20) big++;
      const bucket =
        reach <= -30 ? '≤−30' :
        reach <= -10 ? '−29..−10' :
        reach < 0 ? '−9..−1' :
        reach === 0 ? '0' :
        reach < 10 ? '+1..+9' :
        reach < 30 ? '+10..+29' :
        '≥+30';
      buckets[bucket] = (buckets[bucket] ?? 0) + 1;
    }
    return { buckets, total, above, big };
  }, [picks, consensusRank]);

  if (availableSeasons.length === 0) {
    return (
      <section className="mb-8 rounded border border-zinc-800 bg-zinc-900/40 p-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-zinc-300">
          Draft replay
        </h2>
        <p className="text-xs text-zinc-500">
          No replayable drafts yet. Drafts that fire after v0.50 capture board
          snapshots; simulate + advance the league to populate one.
        </p>
      </section>
    );
  }

  if (!currentPick || !snapshot) {
    return null;
  }

  const team = league.teams[currentPick.teamId];
  const teamNeeds = team ? computeTeamNeeds(team, league) : [];
  const prospect = league.collegePool.find((cp) => cp.id === currentPick.collegePlayerId);
  // Drafted prospects are pruned from `collegePool` the moment the draft
  // completes (draft/event.ts), so a live lookup is empty in the replay. Prefer
  // the profile snapshotted onto the pick record at draft time (v0.162); fall
  // back to the live pool for pre-v0.162 saves / an in-progress draft.
  const profile: DraftProspectProfile | null =
    currentPick.prospectProfile ?? prospect ?? null;
  // Promotion preserves PlayerId, so the rookie record is reachable
  // through players[promotedPlayerId] even after the prospect's left
  // the college pool.
  const rookie = league.players[currentPick.promotedPlayerId];
  // Consensus perceived overall at draft time (mean observed-skill across the
  // snapshot's boards) — paired with the rookie's real grade on the draft card.
  const perceivedOverall = (() => {
    let s = 0;
    let n = 0;
    for (const board of Object.values(snapshot)) {
      for (const e of board) {
        if (e.collegePlayerId === currentPick.collegePlayerId) {
          s += e.observedSkillScore;
          n += 1;
        }
      }
    }
    return n > 0 ? s / n : null;
  })();
  const teamBoard = snapshot[currentPick.teamId] ?? [];
  const teamRank = currentPick.boardRankAtPick;
  const consRank = consensusRank.get(currentPick.collegePlayerId) ?? null;
  // reachVsConsensusSlot = how many spots EARLIER than consensus the
  // pick was made. Positive = team reached past the consensus value;
  // negative = steal at this slot per consensus.
  const reachVsConsensusSlot =
    consRank !== null ? consRank - currentPick.overallPick : null;

  // GM & HC draft-day blurbs (v0.162) — the regime's own words on the pick,
  // generated off the voice seed from the prospect-profile snapshot + pick
  // context. consRank drives the steal angle / length bump.
  const draftGm = team ? league.gms[team.gmId] : undefined;
  const draftHc = team ? league.coaches[team.headCoachId] : undefined;
  const blurbs: DraftBlurbs | null =
    profile && draftGm && draftHc && rookie
      ? buildDraftBlurbs({
          gm: draftGm,
          hc: draftHc,
          profile,
          playerName: `${rookie.firstName} ${rookie.lastName}`,
          round: currentPick.round,
          overallPick: currentPick.overallPick,
          boardReason: currentPick.boardReasonAtPick,
          needs: currentPick.needsAtPick ?? [],
          ...(currentPick.convertedFromPosition
            ? { convertedFromPosition: currentPick.convertedFromPosition }
            : {}),
          qbDesperate: currentPick.qbDesperateAtPick ?? false,
          consensusRank: consRank,
          seasonNumber: currentPick.seasonNumber,
          voiceSeed: league.voiceSeed,
        })
      : null;

  // Render the boards as a centered window around the picked player
  // (or top of board if the picked player isn't on this view's board).
  const WINDOW = 6;
  // Tag each board entry with its ORIGINAL rank (1-based) so the
  // displayed numbers stay stable when the toggle filters out
  // previously-picked prospects. Optionally drop already-picked
  // entries so the user sees what the team actually had to choose
  // from at this slot.
  const teamBoardWithRanks = teamBoard.map((entry, idx) => ({ entry, rank: idx + 1 }));
  const teamBoardFiltered = filterToAvailable
    ? teamBoardWithRanks.filter(
        ({ entry }) =>
          entry.collegePlayerId === currentPick.collegePlayerId ||
          !pickedBeforeThisSlot.has(entry.collegePlayerId),
      )
    : teamBoardWithRanks;
  // Recenter on the picked entry within the (possibly filtered) list.
  // The picked entry's POSITION in the filtered list is what we want
  // to band around, not its original board rank.
  const pickedPositionInFiltered = Math.max(
    1,
    teamBoardFiltered.findIndex(
      (e) => e.entry.collegePlayerId === currentPick.collegePlayerId,
    ) + 1,
  );
  const teamBoardWindow = bandAround(
    teamBoardFiltered,
    pickedPositionInFiltered,
    WINDOW,
  );
  const consensusWindow = bandAround(
    consensus.map((entry, idx) => ({ entry, rank: idx + 1 })),
    consRank ?? 1,
    WINDOW,
  );

  return (
    <section className="mb-8 rounded border border-sky-500/40 bg-sky-500/10 p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-sky-200">
          Draft replay — Season {effectiveSeason} (step-through)
        </h2>
        <div className="flex items-center gap-1 text-xs">
          <span className="text-zinc-500 uppercase tracking-wide text-[10px]">season</span>
          {availableSeasons.map((s) => (
            <button
              key={s}
              onClick={() => {
                setSelectedSeason(s);
                setPickIndex(0);
              }}
              className={`rounded border px-2 py-0.5 font-mono ${
                s === effectiveSeason
                  ? 'border-sky-400 bg-sky-500/30 text-sky-100'
                  : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-sky-500/40 hover:text-sky-300'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Pick navigator */}
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded border border-zinc-800 bg-zinc-950/50 p-2">
        <button
          onClick={() => setPickIndex(0)}
          disabled={safePickIndex === 0}
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-xs font-mono text-zinc-300 hover:border-sky-500/40 disabled:opacity-30"
        >
          ⏮
        </button>
        <button
          onClick={() => setPickIndex(Math.max(0, safePickIndex - 1))}
          disabled={safePickIndex === 0}
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-xs font-mono text-zinc-300 hover:border-sky-500/40 disabled:opacity-30"
        >
          ◀ Prev
        </button>
        <input
          type="number"
          min={1}
          max={picks.length}
          value={safePickIndex + 1}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) setPickIndex(Math.max(0, Math.min(picks.length - 1, n - 1)));
          }}
          className="w-16 rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-xs font-mono text-sky-200 focus:border-sky-500 focus:outline-none"
        />
        <span className="text-xs text-zinc-500">/ {picks.length}</span>
        <button
          onClick={() => setPickIndex(Math.min(picks.length - 1, safePickIndex + 1))}
          disabled={safePickIndex >= picks.length - 1}
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-xs font-mono text-zinc-300 hover:border-sky-500/40 disabled:opacity-30"
        >
          Next ▶
        </button>
        <button
          onClick={() => setPickIndex(picks.length - 1)}
          disabled={safePickIndex >= picks.length - 1}
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-xs font-mono text-zinc-300 hover:border-sky-500/40 disabled:opacity-30"
        >
          ⏭
        </button>
        <input
          type="range"
          min={1}
          max={picks.length}
          value={safePickIndex + 1}
          onChange={(e) => setPickIndex(Number(e.target.value) - 1)}
          className="flex-1 accent-sky-500"
        />
      </div>

      {/* Pick headline */}
      <div className="mb-3 rounded border border-sky-500/40 bg-sky-950/40 p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="font-mono text-lg text-sky-100">
            #{currentPick.overallPick} · R{currentPick.round} ·{' '}
            <span className="text-amber-200">{team?.identity.abbreviation ?? currentPick.teamId}</span>{' '}
            picks{' '}
            <span className="text-zinc-100">{rookie ? `${rookie.firstName} ${rookie.lastName}` : currentPick.promotedPlayerId}</span>
          </div>
          <ReachBadge reach={reachVsConsensusSlot} />
        </div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-400">
          <span>
            Team rank{' '}
            <span className="font-mono text-zinc-200">
              {teamRank === null ? 'off board' : `#${teamRank}`}
            </span>
          </span>
          <span>
            Consensus rank{' '}
            <span className="font-mono text-zinc-200">
              {consRank === null ? 'off everyone\'s board' : `#${consRank}`}
            </span>
          </span>
          {currentPick.boardReasonAtPick && (
            <span>
              Reason{' '}
              <span className="rounded bg-violet-500/20 px-1 font-mono text-[10px] uppercase text-violet-200">
                {currentPick.boardReasonAtPick}
              </span>
            </span>
          )}
          {currentPick.originalTeamId && currentPick.originalTeamId !== currentPick.teamId && (
            <span className="text-amber-300">
              From{' '}
              <span className="font-mono">
                {league.teams[currentPick.originalTeamId]?.identity.abbreviation
                  ?? currentPick.originalTeamId}
              </span>
            </span>
          )}
        </div>
        {currentPick.needsAtPick && currentPick.needsAtPick.length > 0 ? (
          // Pick-time snapshot (v0.147) — what the war room saw when it went
          // on the clock, NOT needs recomputed from the post-draft roster
          // (the drafted rookie satisfies the very need that justified him).
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="uppercase tracking-wide text-[10px] text-zinc-500">
              {team?.identity.abbreviation ?? 'Team'} needs at pick
            </span>
            {currentPick.qbDesperateAtPick && (
              <span
                className="rounded border border-rose-500/50 bg-rose-500/15 px-1.5 py-0.5 font-mono text-[10px] uppercase text-rose-300"
                title="hasDesperateQbNeed at pick time — the binary driver behind the QB reach and the need-aware slot premium."
              >
                QB-desperate
              </span>
            )}
            {currentPick.needsAtPick.map((pos) => (
              <span
                key={pos}
                className={`rounded border px-1.5 py-0.5 font-mono ${
                  rookie && pos === rookie.position
                    ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300'
                    : 'border-sky-500/40 bg-sky-500/10 text-sky-200'
                }`}
                title={rookie && pos === rookie.position ? 'This pick filled the need' : undefined}
              >
                {pos}
              </span>
            ))}
          </div>
        ) : (
          teamNeeds.length > 0 && (
            <div className="mt-2">
              <TeamNeedsStrip
                needs={teamNeeds}
                tone="sky"
                label={`${team?.identity.abbreviation ?? 'Team'} needs (now — pre-snapshot draft)`}
              />
            </div>
          )
        )}
      </div>

      {/* 3-column body: player card | team board | consensus board */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <DraftReplayPlayerCard
          profile={profile}
          rookie={rookie ?? null}
          team={team ?? null}
          perceivedOverall={perceivedOverall}
          blurbs={blurbs}
          gmName={draftGm?.name ?? null}
          hcName={draftHc?.name ?? null}
        />
        <div>
          <div className="mb-1 flex justify-end">
            <button
              onClick={() => setFilterToAvailable((v) => !v)}
              className={`rounded border px-2 py-0.5 font-mono text-[10px] transition-colors ${
                filterToAvailable
                  ? 'border-violet-500/50 bg-violet-500/20 text-violet-200'
                  : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-violet-500/30'
              }`}
              title={filterToAvailable
                ? "Showing only prospects still on the board at this pick. Click to show the full pre-draft board."
                : "Showing the full pre-draft board. Click to filter out prospects already taken before this pick."}
            >
              {filterToAvailable ? 'available only' : 'show all'}
            </button>
          </div>
          <DraftReplayBoardColumn
            title={`${team?.identity.abbreviation ?? 'Team'} board${filterToAvailable ? ' (available at this pick)' : ''}`}
            accent="violet"
            window={teamBoardWindow}
            highlightId={currentPick.collegePlayerId}
            nameLookup={nameLookup}
            extractRankInfo={(entry) => ({
              label: entry.reason,
              value: `pri ${entry.priority.toFixed(0)}`,
            })}
          />
        </div>
        <DraftReplayBoardColumn
          title="Consensus"
          accent="emerald"
          window={consensusWindow}
          highlightId={currentPick.collegePlayerId}
          nameLookup={nameLookup}
          extractRankInfo={(entry) => ({
            label: `${entry.appearances}/32`,
            value: `avg ${entry.averagePriority.toFixed(0)}`,
          })}
        />
      </div>

      {/* Draft-wide reach distribution */}
      <div className="mt-3 rounded border border-zinc-800 bg-zinc-950/40 p-2">
        <div className="mb-1 flex items-baseline justify-between text-[10px] text-zinc-500">
          <span className="uppercase tracking-wider">Reach distribution (this draft)</span>
          <span>
            <span className="font-mono text-zinc-300">{reachDistribution.above}</span>/{reachDistribution.total} picks reached
            past consensus · <span className="font-mono text-amber-300">{reachDistribution.big}</span> big reaches (≥20)
          </span>
        </div>
        <ReachHistogram buckets={reachDistribution.buckets} />
      </div>
    </section>
  );
}

function bandAround<T>(
  entries: readonly T[],
  centerRank: number,
  window: number,
): readonly T[] {
  if (entries.length === 0) return [];
  const center = Math.max(1, Math.min(entries.length, centerRank));
  const start = Math.max(0, center - 1 - window);
  const end = Math.min(entries.length, center - 1 + window + 1);
  return entries.slice(start, end);
}

function ReachBadge({ reach }: { reach: number | null }) {
  if (reach === null) {
    return (
      <span className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 font-mono text-xs text-zinc-400">
        Off consensus
      </span>
    );
  }
  // Positive reach = picked EARLIER than consensus rank (team reached
  // ahead of where consensus would have valued them).
  if (reach > 0) {
    const big = reach >= 20;
    return (
      <span
        className={`rounded border px-2 py-0.5 font-mono text-xs ${
          big
            ? 'border-amber-500 bg-amber-500/20 text-amber-200'
            : 'border-amber-700 bg-amber-700/20 text-amber-300'
        }`}
      >
        Reach +{reach}
      </span>
    );
  }
  if (reach < 0) {
    const big = reach <= -20;
    return (
      <span
        className={`rounded border px-2 py-0.5 font-mono text-xs ${
          big
            ? 'border-emerald-500 bg-emerald-500/20 text-emerald-200'
            : 'border-emerald-700 bg-emerald-700/20 text-emerald-300'
        }`}
      >
        Steal {reach}
      </span>
    );
  }
  return (
    <span className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 font-mono text-xs text-zinc-300">
      On consensus
    </span>
  );
}

function DraftReplayPlayerCard({
  profile,
  rookie,
  team,
  perceivedOverall,
  blurbs,
  gmName,
  hcName,
}: {
  profile: DraftProspectProfile | null;
  rookie: Player | null;
  team: TeamState | null;
  perceivedOverall: number | null;
  blurbs: DraftBlurbs | null;
  gmName: string | null;
  hcName: string | null;
}) {
  const school = profile ? getSchoolById(profile.schoolId) : null;
  const m = profile?.measurables;
  // Real grade comes from the promoted player's ratings; the profile snapshot
  // (a Pick of CollegePlayer) carries no skill state, so there's no fallback.
  const realOverall = rookie ? prospectProjectedOverall(rookie) : null;
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/50 p-3 text-xs">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-wider text-zinc-500">Draft card</span>
        {team && (
          <span
            className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-300"
            title={team.identity.fullName}
          >
            {team.identity.abbreviation}
          </span>
        )}
      </div>
      {rookie && (
        <div className="mb-1 font-mono text-sm text-zinc-100">
          {rookie.firstName} {rookie.lastName}
        </div>
      )}
      <div className="space-y-1 text-[11px] text-zinc-400">
        {profile && (
          <>
            <div>
              <span className="text-zinc-500">Position</span>{' '}
              <span className="font-mono text-zinc-200">{profile.nflProjectedPosition}</span>
              {profile.isConversionCandidate && (
                <span className="ml-1 rounded bg-cyan-500/20 px-1 text-[9px] uppercase text-cyan-200">
                  conv from {profile.collegePosition}
                </span>
              )}
            </div>
            <div>
              <span className="text-zinc-500">School</span>{' '}
              <span className="text-zinc-300">{school?.name ?? profile.schoolId}</span>
              <span className="text-zinc-600"> · {CLASS_YEAR_LABELS[profile.classYear]}</span>
            </div>
            <div>
              <span className="text-zinc-500">Tier</span>{' '}
              <TierBadge tier={profile.tier} />
              <span className="ml-2 text-zinc-500">Arch</span>{' '}
              <span className="font-mono text-zinc-300">{profile.archetype}</span>
            </div>
            {profile.assumedArchetype !== profile.archetype && (
              <div className="text-amber-400">
                Assumed archetype: {profile.assumedArchetype}{' '}
                <span className="text-amber-600">(misread)</span>
              </div>
            )}
          </>
        )}
        {!profile && (
          <div className="rounded border border-zinc-800 bg-zinc-900/40 px-2 py-1 text-[10px] text-zinc-500">
            Prospect profile not recorded for this pick — re-sim a draft (v0.162+)
            to populate position, combine, and college production.
          </div>
        )}

        {/* Draft grade — consensus PERCEIVED at draft time / REAL ground truth */}
        <div className="flex items-baseline gap-2">
          <span className="text-zinc-500">Draft grade</span>
          <DraftGradeCell perceivedOverall={perceivedOverall} realOverall={realOverall} />
          <span className="text-[10px] text-zinc-600">perceived / real</span>
        </div>

        {/* Combine / pro-day measurables */}
        {m && (
          <div className="mt-2 border-t border-zinc-800 pt-2">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
              Combine / Pro-Day
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[10px] text-zinc-300">
              <div className="flex justify-between"><span className="text-zinc-500">Ht/Wt</span><span>{formatHeight(m.heightInches)}, {Math.round(m.weightLbs)}</span></div>
              <div className="flex justify-between"><span className="text-zinc-500">40-yd</span><span>{m.fortyYardSeconds.toFixed(2)}s</span></div>
              <div className="flex justify-between"><span className="text-zinc-500">Bench</span><span>{m.benchPress225Reps}</span></div>
              <div className="flex justify-between"><span className="text-zinc-500">Vert</span><span>{formatInches(m.verticalInches)}</span></div>
              <div className="flex justify-between"><span className="text-zinc-500">Broad</span><span>{formatInches(m.broadJumpInches)}</span></div>
              <div className="flex justify-between"><span className="text-zinc-500">3-cone</span><span>{m.threeConeSeconds.toFixed(2)}s</span></div>
              <div className="flex justify-between"><span className="text-zinc-500">Shuttle</span><span>{m.shuttleSeconds.toFixed(2)}s</span></div>
              <div className="flex justify-between"><span className="text-zinc-500">Arm/Hand</span><span>{formatInches(m.armLengthInches)}/{formatInches(m.handSizeInches)}</span></div>
            </div>
          </div>
        )}

        {/* College production */}
        {profile && profile.collegeStats.length > 0 && (
          <div className="mt-2 border-t border-zinc-800 pt-2">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">College production</div>
            <table className="w-full font-mono text-[10px]">
              <thead className="text-zinc-500">
                <tr>
                  <th className="text-left font-normal">Yr</th>
                  <th className="text-right font-normal">G</th>
                  <th className="text-right font-normal">GS</th>
                  <th className="pl-2 text-left font-normal">stats</th>
                </tr>
              </thead>
              <tbody>
                {profile.collegeStats.map((cs, idx) => (
                  <tr key={idx} className="text-zinc-300">
                    <td>{CLASS_YEAR_LABELS[cs.classYear]}</td>
                    <td className="text-right">{cs.games}</td>
                    <td className="text-right">{cs.starts}</td>
                    <td className="pl-2 text-left text-zinc-400">{collegeStatHeadline(profile.collegePosition, cs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* War room — GM & HC blurbs on the pick (v0.162) */}
        {blurbs && (
          <div className="mt-2 space-y-2 border-t border-zinc-800 pt-2">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">War room</div>
            <div>
              <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-400/80">
                GM{gmName ? ` · ${gmName}` : ''}
              </div>
              <p className="text-[11px] leading-snug text-zinc-300">{blurbs.gm}</p>
            </div>
            <div>
              <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-sky-400/80">
                Head Coach{hcName ? ` · ${hcName}` : ''}
              </div>
              <p className="text-[11px] leading-snug text-zinc-300">{blurbs.hc}</p>
            </div>
          </div>
        )}

        {/* Ground-truth skills (dev view) */}
        {rookie && (
          <div className="mt-2 border-t border-zinc-800 pt-2">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
              Ground-truth skills (dev view)
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[10px]">
              <SkillRow label="speed" v={rookie.current.speed} ceiling={rookie.ceiling.speed} />
              <SkillRow label="accel" v={rookie.current.acceleration} ceiling={rookie.ceiling.acceleration} />
              <SkillRow label="strength" v={rookie.current.strength} ceiling={rookie.ceiling.strength} />
              <SkillRow label="tech" v={rookie.current.technicalSkill} ceiling={rookie.ceiling.technicalSkill} />
              <SkillRow label="iq" v={rookie.current.footballIq} ceiling={rookie.ceiling.footballIq} />
              <SkillRow label="decision" v={rookie.current.decisionMaking} ceiling={rookie.ceiling.decisionMaking} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SkillRow({
  label,
  v,
  ceiling,
}: {
  label: string;
  v: number;
  ceiling: number;
}) {
  return (
    <div className="flex items-baseline justify-between gap-1">
      <span className="text-zinc-500">{label}</span>
      <span className="text-zinc-200">
        {v}
        {ceiling > v && <span className="text-zinc-600"> → {ceiling}</span>}
      </span>
    </div>
  );
}

function TierBadge({ tier }: { tier: 'STAR' | 'STARTER' | 'BACKUP' | 'FRINGE' }) {
  const cls =
    tier === 'STAR' ? 'bg-amber-500/20 text-amber-200 border-amber-500/40' :
    tier === 'STARTER' ? 'bg-sky-500/20 text-sky-200 border-sky-500/40' :
    tier === 'BACKUP' ? 'bg-zinc-700/40 text-zinc-300 border-zinc-700' :
    'bg-zinc-900 text-zinc-500 border-zinc-800';
  return (
    <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase ${cls}`}>
      {tier}
    </span>
  );
}

interface ProspectNameRecord {
  firstName: string;
  lastName: string;
  position: Position;
}

function DraftReplayBoardColumn<T extends { collegePlayerId: PlayerId }>({
  title,
  accent,
  window,
  highlightId,
  nameLookup,
  extractRankInfo,
}: {
  title: string;
  accent: 'violet' | 'emerald';
  window: readonly { entry: T; rank: number }[];
  highlightId: PlayerId;
  nameLookup: ReadonlyMap<PlayerId, ProspectNameRecord>;
  extractRankInfo: (entry: T) => { label: string; value: string };
}) {
  const titleClass =
    accent === 'violet' ? 'text-violet-200 border-violet-500/40' : 'text-emerald-200 border-emerald-500/40';
  return (
    <div className={`rounded border bg-zinc-950/50 p-3 text-xs ${titleClass}`}>
      <div className="mb-2 text-[10px] uppercase tracking-wider">{title}</div>
      <div className="space-y-0.5">
        {window.length === 0 && (
          <div className="text-[11px] text-zinc-600">No board data.</div>
        )}
        {window.map(({ entry, rank }) => {
          const isPicked = entry.collegePlayerId === highlightId;
          const name = nameLookup.get(entry.collegePlayerId);
          const info = extractRankInfo(entry);
          return (
            <div
              key={String(entry.collegePlayerId) + rank}
              className={`flex items-baseline justify-between gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] ${
                isPicked
                  ? 'bg-amber-500/30 text-amber-100 ring-1 ring-amber-500'
                  : 'text-zinc-400'
              }`}
            >
              <span className="flex items-baseline gap-1">
                <span className="w-6 text-right text-zinc-500">#{rank}</span>
                <span className="truncate text-zinc-300">
                  {name ? `${name.firstName} ${name.lastName}` : String(entry.collegePlayerId)}
                </span>
                {name && (
                  <span className="text-[9px] text-zinc-600">{name.position}</span>
                )}
              </span>
              <span className="text-[9px] text-zinc-500">
                {info.label}
                <span className="ml-1 text-zinc-400">{info.value}</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ReachHistogram({ buckets }: { buckets: Record<string, number> }) {
  const ORDER = ['≤−30', '−29..−10', '−9..−1', '0', '+1..+9', '+10..+29', '≥+30'];
  const maxVal = Math.max(1, ...Object.values(buckets));
  return (
    <div className="flex items-end gap-1">
      {ORDER.map((label) => {
        const count = buckets[label] ?? 0;
        const height = (count / maxVal) * 28; // px
        const isSteal = label.startsWith('−') || label === '≤−30';
        const isReach = label.startsWith('+') || label === '≥+30';
        const cls = isSteal
          ? 'bg-emerald-500/60'
          : isReach
            ? 'bg-amber-500/60'
            : 'bg-zinc-600';
        return (
          <div key={label} className="flex flex-1 flex-col items-center text-[9px]">
            <div className="mb-0.5 font-mono text-zinc-300">{count}</div>
            <div
              className={`w-full rounded-t ${cls}`}
              style={{ height: `${Math.max(1, height)}px` }}
            />
            <div className="mt-0.5 text-zinc-500">{label}</div>
          </div>
        );
      })}
    </div>
  );
}

// ─── DRAFT TRADES PANEL (v0.52 — surface trade-up firings) ──────────────

export function DraftTradesPanel({ league }: { league: LeagueState }) {
  // Group trade-ups by seasonNumber. Each season may produce 0..3
  // trade-ups (per MAX_TRADE_UPS_PER_DRAFT in v0.45).
  const tradesBySeason = useMemo(() => {
    const m = new Map<number, typeof league.tradeUpHistory>();
    for (const tu of league.tradeUpHistory) {
      const arr = m.get(tu.seasonNumber);
      if (arr) {
        (arr as unknown as Array<typeof tu>).push(tu);
      } else {
        m.set(tu.seasonNumber, [tu] as unknown as typeof league.tradeUpHistory);
      }
    }
    return [...m.entries()].sort((a, b) => b[0] - a[0]); // newest first
  }, [league.tradeUpHistory]);

  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const effectiveSeason = selectedSeason ?? (tradesBySeason[0]?.[0] ?? null);

  const trades =
    effectiveSeason !== null
      ? tradesBySeason.find(([s]) => s === effectiveSeason)?.[1] ?? []
      : [];

  // Resolve pick metadata for display (round + season + slot # when
  // known). Slot # is only assigned once the draft fires, so future
  // picks come from `league.draftPicks` (slot = undefined) and
  // already-fired picks come from `league.draftHistory` (slot known).
  // History takes precedence so a pick consumed in a later draft
  // still surfaces its slot.
  const pickInfoById = useMemo(() => {
    const m = new Map<string, { round: number; seasonNumber: number; originalTeamId?: TeamId; overallPick?: number }>();
    for (const p of league.draftPicks) {
      m.set(p.id, {
        round: p.round,
        seasonNumber: p.seasonNumber,
        originalTeamId: p.originalTeamId,
      });
    }
    for (const p of league.draftHistory) {
      if (p.pickAssetId) {
        m.set(p.pickAssetId, {
          round: p.round,
          seasonNumber: p.seasonNumber,
          overallPick: p.overallPick,
          ...(p.originalTeamId ? { originalTeamId: p.originalTeamId } : {}),
        });
      }
    }
    return m;
  }, [league.draftPicks, league.draftHistory]);

  const nameByCpId = useMemo(() => {
    const m = new Map<string, { firstName: string; lastName: string; position: Position }>();
    for (const cp of league.collegePool) {
      m.set(cp.id, { firstName: cp.firstName, lastName: cp.lastName, position: cp.nflProjectedPosition });
    }
    for (const p of Object.values(league.players)) {
      if (!m.has(p.id)) {
        m.set(p.id, { firstName: p.firstName, lastName: p.lastName, position: p.position });
      }
    }
    return m;
  }, [league.collegePool, league.players]);

  // The pick actually MADE at each (season, overall-slot) — so a trade-up can
  // show who the team selected with the slot it moved up to grab, not just who
  // it targeted (usually the same, but the board can shift between the trade
  // and the pick).
  const pickAtSlot = useMemo(() => {
    const m = new Map<string, DraftPickRecord>();
    for (const p of league.draftHistory) m.set(`${p.seasonNumber}#${p.overallPick}`, p);
    return m;
  }, [league.draftHistory]);

  if (tradesBySeason.length === 0) {
    return (
      <section className="mb-8 rounded border border-zinc-800 bg-zinc-900/40 p-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-zinc-300">
          Draft trades
        </h2>
        <p className="text-xs text-zinc-500">
          No draft trade-ups have fired yet. Trade-ups can only happen when two
          teams' top board entries converge on the same prospect AND the
          trading-up team can construct a Doc 5 chart-fair offer (top-10 slots
          only; max 3 per draft).
        </p>
      </section>
    );
  }

  return (
    <section className="mb-8 rounded border border-amber-500/40 bg-amber-500/10 p-4">
      <div className="mb-3 flex items-baseline justify-between flex-wrap gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-amber-200">
          Draft trade-ups — Season {effectiveSeason} ({trades.length} {trades.length === 1 ? 'trade' : 'trades'})
        </h2>
        <div className="flex items-center gap-1 text-xs">
          <span className="text-zinc-500 uppercase tracking-wide text-[10px]">season</span>
          {tradesBySeason.map(([s, ts]) => (
            <button
              key={s}
              onClick={() => setSelectedSeason(s)}
              className={`rounded border px-2 py-0.5 font-mono ${
                s === effectiveSeason
                  ? 'border-amber-400 bg-amber-500/30 text-amber-100'
                  : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-amber-500/40 hover:text-amber-300'
              }`}
            >
              {s} <span className="text-[9px] text-zinc-500">·{ts.length}</span>
            </button>
          ))}
        </div>
      </div>

      {trades.length === 0 ? (
        <p className="text-xs text-zinc-500">No trade-ups in this season's draft — quiet draft.</p>
      ) : (
        <div className="space-y-3">
          {trades.map((tu) => {
            const acquiringTeam = league.teams[tu.tradingUpTeamId];
            const droppingTeam = league.teams[tu.onClockTeamId];
            const target = nameByCpId.get(tu.targetCollegePlayerId);
            const swapInfo = pickInfoById.get(tu.swapAssetId);
            // Who they actually drafted with the slot they moved up to.
            const selPick = pickAtSlot.get(`${tu.seasonNumber}#${tu.overallPick}`);
            const selPlayer = selPick ? league.players[selPick.promotedPlayerId] : undefined;
            return (
              <div
                key={`${tu.seasonNumber}-${tu.overallPick}-${tu.tradingUpTeamId}`}
                className="rounded border border-amber-500/40 bg-zinc-950/40 p-3 text-xs"
              >
                <div className="mb-1 flex items-baseline justify-between flex-wrap gap-2">
                  <div className="font-mono text-amber-200">
                    Slot #{tu.overallPick} · R{tu.round} ·{' '}
                    <span className="text-amber-100">
                      {acquiringTeam?.identity.abbreviation ?? tu.tradingUpTeamId}
                    </span>{' '}
                    moves up
                  </div>
                  <span className="rounded bg-amber-500/20 px-1.5 py-0.5 font-mono text-[10px] text-amber-200">
                    chart ratio {tu.ratio.toFixed(2)}
                  </span>
                </div>
                <div className="mb-2 text-[11px] text-zinc-400">
                  Target:{' '}
                  <span className="text-zinc-200">
                    {target ? `${target.firstName} ${target.lastName}` : tu.targetCollegePlayerId}
                  </span>
                  {target && (
                    <span className="ml-1 text-[10px] text-zinc-500">({target.position})</span>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  <div className="rounded border border-emerald-500/30 bg-zinc-950/40 p-2">
                    <div className="mb-1 text-[10px] uppercase tracking-wider text-emerald-300">
                      {acquiringTeam?.identity.abbreviation ?? tu.tradingUpTeamId} acquires
                    </div>
                    <div className="text-zinc-300">
                      Slot #{tu.overallPick} (R{tu.round})
                    </div>
                    <div className="mt-1 text-[11px]">
                      {selPlayer ? (
                        <span className="text-emerald-200">
                          selected: {selPlayer.firstName} {selPlayer.lastName}
                          <span className="ml-1 text-[10px] text-zinc-500">({selPlayer.position})</span>
                          {selPick?.convertedFromPosition && (
                            <span className="ml-1 text-[10px] text-sky-300">←{selPick.convertedFromPosition}</span>
                          )}
                          {selPick && selPick.collegePlayerId !== tu.targetCollegePlayerId && (
                            <span className="ml-1 text-[10px] text-amber-300/80" title="Not the prospect the trade-up targeted — the board moved by the time the pick fired.">
                              (off-target)
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-zinc-600">selected: — (pick not yet made)</span>
                      )}
                    </div>
                  </div>
                  <div className="rounded border border-rose-500/30 bg-zinc-950/40 p-2">
                    <div className="mb-1 text-[10px] uppercase tracking-wider text-rose-300">
                      {droppingTeam?.identity.abbreviation ?? tu.onClockTeamId} receives
                    </div>
                    <ul className="space-y-0.5 text-zinc-300">
                      <li>
                        <span className="font-mono text-[10px] text-zinc-500">·</span>{' '}
                        {acquiringTeam?.identity.abbreviation ?? '?'}'s{' '}
                        R{swapInfo?.round ?? '?'}
                        {swapInfo?.overallPick !== undefined && (
                          <span className="ml-1 font-mono text-amber-200">
                            #{swapInfo.overallPick}
                          </span>
                        )}{' '}
                        <span className="text-[10px] text-zinc-500">(this draft)</span>
                      </li>
                      {(tu.currentDraftPickIds ?? []).map((cid) => {
                        const info = pickInfoById.get(cid);
                        return (
                          <li key={cid}>
                            <span className="font-mono text-[10px] text-zinc-500">·</span>{' '}
                            {acquiringTeam?.identity.abbreviation ?? '?'}'s{' '}
                            {info ? (
                              <>
                                R{info.round}
                                {info.overallPick !== undefined && (
                                  <span className="ml-1 font-mono text-amber-200">
                                    #{info.overallPick}
                                  </span>
                                )}
                              </>
                            ) : (
                              cid
                            )}{' '}
                            <span className="text-[10px] text-zinc-500">(this draft)</span>
                          </li>
                        );
                      })}
                      {tu.futurePickIds.map((fid) => {
                        const info = pickInfoById.get(fid);
                        return (
                          <li key={fid}>
                            <span className="font-mono text-[10px] text-zinc-500">·</span>{' '}
                            {acquiringTeam?.identity.abbreviation ?? '?'}'s{' '}
                            {info ? (
                              <>
                                {info.seasonNumber} R{info.round}
                                {info.overallPick !== undefined && (
                                  <span className="ml-1 font-mono text-amber-200">
                                    #{info.overallPick}
                                  </span>
                                )}
                              </>
                            ) : (
                              fid
                            )}{' '}
                            {info && info.overallPick === undefined ? (
                              <span className="text-[10px] text-zinc-600">(TBD)</span>
                            ) : (
                              <span className="text-[10px] text-zinc-500">pick</span>
                            )}
                          </li>
                        );
                      })}
                      {(tu.currentDraftPickIds ?? []).length === 0 &&
                        tu.futurePickIds.length === 0 && (
                          <li className="text-[10px] text-zinc-600">
                            (no extra sweeteners — swap only)
                          </li>
                        )}
                    </ul>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-3 text-[10px] text-zinc-600">
        Trade-ups fire inside <code>runDraft</code> when a team further down
        the round wants the on-clock team's top-board prospect badly enough
        to construct a chart-fair offer (v0.45 firing; v0.49 dynamic modifier
        asymmetry tunes acceptance). The on-clock team accepts at ratio ≥ 1.0
        (Doc 5 chart). Caps: 3 trade-ups per draft, top-10 slots only.
      </p>
    </section>
  );
}

// ─── DRAFT RESULTS PANEL (Doc 3 — Draft Module slice 5a) ───────────────────

export function DraftResultsPanel({ league }: { league: LeagueState }) {
  // Group draftHistory by seasonNumber so the user can flip back through years.
  const seasons = useMemo(() => {
    const m = new Map<number, DraftPickRecord[]>();
    for (const p of league.draftHistory) {
      const arr = m.get(p.seasonNumber);
      if (arr) arr.push(p);
      else m.set(p.seasonNumber, [p]);
    }
    return [...m.entries()].sort((a, b) => b[0] - a[0]); // newest first
  }, [league.draftHistory]);

  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const effectiveSeason = selectedSeason ?? (seasons[0]?.[0] ?? null);

  // Consensus rank per pick for the selected season — derived from
  // the v0.50 draftBoardSnapshots captured at draft time. Null when
  // the season's snapshot is missing (pre-v0.50 saves).
  const consensusRanksForSeason = useMemo(() => {
    if (effectiveSeason === null) return null;
    const snapshot = league.draftBoardSnapshots[effectiveSeason];
    if (!snapshot) return null;
    return consensusRankIndex(computeConsensusBoard(snapshot));
  }, [effectiveSeason, league.draftBoardSnapshots]);

  // Perceived projected overall per prospect at draft time — mean observed-skill
  // across all 32 boards in the season's snapshot. Feeds the perceived draft
  // grade (shown next to the rookie's real grade). Null when no snapshot.
  const perceivedOverallForSeason = useMemo(() => {
    if (effectiveSeason === null) return null;
    const snapshot = league.draftBoardSnapshots[effectiveSeason];
    if (!snapshot) return null;
    const agg = new Map<string, { s: number; n: number }>();
    for (const board of Object.values(snapshot)) {
      for (const e of board) {
        const cur = agg.get(e.collegePlayerId) ?? { s: 0, n: 0 };
        cur.s += e.observedSkillScore;
        cur.n += 1;
        agg.set(e.collegePlayerId, cur);
      }
    }
    const m = new Map<string, number>();
    for (const [id, { s, n }] of agg) m.set(id, s / n);
    return m;
  }, [effectiveSeason, league.draftBoardSnapshots]);

  if (seasons.length === 0) {
    return (
      <section className="mb-8 rounded border border-zinc-800 bg-zinc-900/40 p-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-zinc-300">
          Draft results
        </h2>
        <p className="text-xs text-zinc-500">
          No draft has been run yet. Drafts fire each offseason during <code>advanceSeason</code>;
          simulate + advance the league to see picks here.
        </p>
      </section>
    );
  }

  const picks = effectiveSeason !== null ? seasons.find(([s]) => s === effectiveSeason)?.[1] ?? [] : [];

  return (
    <section className="mb-8 rounded border border-amber-500/40 bg-amber-500/10 p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-amber-200">
          Draft results — Season {effectiveSeason} ({picks.length} picks)
        </h2>
        <div className="flex items-center gap-1 text-xs">
          <span className="text-zinc-500 uppercase tracking-wide text-[10px]">season</span>
          {seasons.map(([s]) => (
            <button
              key={s}
              onClick={() => setSelectedSeason(s)}
              className={`rounded border px-2 py-0.5 font-mono ${
                s === effectiveSeason
                  ? 'border-amber-400 bg-amber-500/30 text-amber-100'
                  : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-amber-500/40 hover:text-amber-300'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase tracking-wider text-zinc-500">
            <tr className="border-b border-zinc-800">
              <th className="px-2 py-1 text-right">#</th>
              <th className="px-2 py-1 text-left">Team</th>
              <th className="px-2 py-1 text-left">Rookie</th>
              <th className="px-2 py-1 text-left">Pos</th>
              <th className="px-2 py-1 text-right" title="Draft grade (NFL.com 8-pt scale) — perceived (board consensus at draft time) / real (ground truth)">Draft grd</th>
              <th className="px-2 py-1 text-left">From</th>
              <th className="px-2 py-1 text-center">Board rank</th>
              <th
                className="px-2 py-1 text-center"
                title="Consensus rank (totalPriority-sorted aggregate across all 32 boards at draft time)"
              >
                Consensus
              </th>
              <th
                className="px-2 py-1 text-center"
                title="Reach = consensus rank − overall pick. Positive = reach, negative = steal."
              >
                Reach
              </th>
              <th className="px-2 py-1 text-left">Reason</th>
              <th className="px-2 py-1 text-right">Priority</th>
            </tr>
          </thead>
          <tbody>
            {picks.map((pick) => {
              const team = league.teams[pick.teamId];
              const player = league.players[pick.promotedPlayerId];
              const school = getSchoolById(
                // CollegePlayer was removed from pool by promotion. We
                // pull school via the rookie's id — fallback to '?'
                // if the player record is missing for any reason.
                (league.collegePool.find((cp) => cp.id === pick.collegePlayerId)?.schoolId)
                  ?? '__missing',
              );
              const consRank = consensusRanksForSeason?.get(pick.collegePlayerId) ?? null;
              const reach = consRank !== null ? consRank - pick.overallPick : null;
              return (
                <tr key={`${pick.seasonNumber}-${pick.overallPick}`} className="border-b border-zinc-900 hover:bg-zinc-900/30">
                  <td className="px-2 py-1 text-right font-mono text-zinc-400">{pick.overallPick}</td>
                  <td className="px-2 py-1 font-mono text-zinc-200">{team?.identity.abbreviation ?? '?'}</td>
                  <td className="px-2 py-1 text-zinc-100">
                    {player ? `${player.firstName} ${player.lastName}` : '—'}
                    {player && (
                      <span className="ml-1 text-[10px] text-zinc-500">{player.tier.toLowerCase()}</span>
                    )}
                  </td>
                  <td className="px-2 py-1 font-mono text-zinc-400">
                    {player?.position ?? '?'}
                    {pick.convertedFromPosition && (
                      <span
                        className="ml-1 rounded bg-sky-500/20 px-1 text-[9px] text-sky-300"
                        title={`Drafted as a ${pick.convertedFromPosition}, converting to ${player?.position ?? '?'} (team need)`}
                      >
                        ←{pick.convertedFromPosition}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1 text-right">
                    <DraftGradeCell
                      perceivedOverall={perceivedOverallForSeason?.get(pick.collegePlayerId) ?? null}
                      realOverall={player ? prospectProjectedOverall(player) : null}
                    />
                  </td>
                  <td className="px-2 py-1 text-[10px] text-zinc-500">
                    {school?.name ?? '—'}
                  </td>
                  <td className="px-2 py-1 text-center font-mono">
                    {pick.boardRankAtPick !== null ? (
                      <span className={pick.boardRankAtPick <= 5 ? 'text-emerald-300' : pick.boardRankAtPick <= 15 ? 'text-zinc-300' : 'text-amber-300'}>
                        #{pick.boardRankAtPick}
                      </span>
                    ) : (
                      <span className="text-zinc-600" title="Off-board pick (BPA fallback)">off</span>
                    )}
                  </td>
                  <td className="px-2 py-1 text-center font-mono">
                    {consRank !== null ? (
                      <span className="text-emerald-300">#{consRank}</span>
                    ) : (
                      <span className="text-zinc-600" title="Off consensus (not on any team's board at draft time)">off</span>
                    )}
                  </td>
                  <td className="px-2 py-1 text-center font-mono text-[11px]">
                    {reach === null ? (
                      <span className="text-zinc-600">—</span>
                    ) : reach >= 20 ? (
                      <span className="text-amber-300" title="Big reach (≥+20)">+{reach}</span>
                    ) : reach > 0 ? (
                      <span className="text-amber-400/80">+{reach}</span>
                    ) : reach === 0 ? (
                      <span className="text-zinc-300">0</span>
                    ) : reach <= -20 ? (
                      <span className="text-emerald-300" title="Big steal (≤−20)">{reach}</span>
                    ) : (
                      <span className="text-emerald-400/80">{reach}</span>
                    )}
                  </td>
                  <td className={`px-2 py-1 text-[10px] uppercase tracking-wide ${
                    pick.boardReasonAtPick ? REASON_COLORS[pick.boardReasonAtPick] : 'text-zinc-600'
                  }`}>
                    {pick.boardReasonAtPick ? REASON_LABELS[pick.boardReasonAtPick] : '—'}
                  </td>
                  <td className="px-2 py-1 text-right font-mono text-amber-300">
                    {pick.boardPriorityAtPick !== null ? pick.boardPriorityAtPick.toFixed(1) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-[10px] text-zinc-600">
        Draft order = inverse of prior season's standings. Each team picks BPA from their own
        scheme-fit-aware board. Slice 5a fires round 1 only; rounds 2–7 + trade-ups land in 5b.
      </p>
    </section>
  );
}
// ─── Media Mock Boards (v0.72) ──────────────────────────────────────────
//
// The media-consensus mock board next to each outlet's own — so you can
// see where the hot-take blog reaches and the sharp insider stays
// grounded (divergence vs consensus is color-coded).

export function MediaMockBoardsPanel({ league }: { league: LeagueState }) {
  const DEPTH = 40;
  // League (team) consensus rank per prospect — shown next to the MEDIA
  // consensus so the gap between what the media says and what the 32 team
  // boards say is legible (the realism check Daniel reads).
  const teamConsensusRank = useMemo(
    () => consensusRankIndex(computeConsensusBoard(league.draftBoards)),
    [league.draftBoards],
  );
  const collegeOutlets = useMemo(
    () =>
      Object.values(league.mediaOutlets)
        .filter((o) => o.focus === 'COLLEGE')
        .sort((a, b) => b.accuracySpectrum - a.accuracySpectrum),
    [league.mediaOutlets],
  );

  // Weight the consensus by outlet accuracy — sharper desks count more.
  const outletWeights = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of collegeOutlets) m.set(o.id, o.accuracySpectrum / 10);
    return m;
  }, [collegeOutlets]);

  const consensus = useMemo(
    () => computeMediaConsensusBoard(league.mediaCollegeObservations, DEPTH, outletWeights),
    [league.mediaCollegeObservations, outletWeights],
  );

  // Resolve prospect names — including prospects already drafted out of
  // the pool (via draft history → promoted NFL player).
  const nameById = useMemo(() => {
    const m = new Map<string, { name: string; school: string; pos: string }>();
    for (const cp of league.collegePool) {
      m.set(cp.id, {
        name: `${cp.firstName} ${cp.lastName}`,
        school: getSchoolById(cp.schoolId)?.name ?? cp.schoolId,
        pos: cp.nflProjectedPosition,
      });
    }
    for (const pick of league.draftHistory) {
      if (m.has(pick.collegePlayerId)) continue;
      const p = league.players[pick.promotedPlayerId];
      if (p) m.set(pick.collegePlayerId, { name: `${p.firstName} ${p.lastName}`, school: 'drafted', pos: p.position });
    }
    return m;
  }, [league.collegePool, league.draftHistory, league.players]);

  const outletPicks = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    for (const o of collegeOutlets) {
      const board = computeOutletMockBoard(league.mediaCollegeObservations, o.id, 60);
      const byProspect = new Map<string, number>();
      for (const e of board) byProspect.set(e.prospectId, e.projectedOverallPick);
      map.set(o.id, byProspect);
    }
    return map;
  }, [league.mediaCollegeObservations, collegeOutlets]);

  if (consensus.length === 0) {
    return (
      <section className="mt-6 rounded border border-fuchsia-500/20 bg-fuchsia-500/[0.03] p-3 text-xs text-zinc-500">
        🎙️ Media mock boards — empty until the pre-draft media cycle runs
        (step through Top-30 Visits, or simulate + advance a season).
      </section>
    );
  }

  return (
    <section className="mt-6 rounded border border-fuchsia-500/25 bg-fuchsia-500/[0.04] p-4">
      <h2 className="mb-1 text-lg font-semibold text-fuchsia-200">Media Mock Boards</h2>
      <p className="mb-3 text-xs text-zinc-500">
        <span className="text-fuchsia-300">Media #</span> = media consensus rank;{' '}
        <span className="text-zinc-300">Team #</span> = the 32 team boards' consensus
        rank (green = media has him ≥12 spots EARLIER than the teams, red = later —
        i.e. media buzz vs the war-room read). Then each outlet's own mock (cols
        sorted by accuracy, sharpest first): green = the outlet likes him well
        ahead of media consensus, red = well behind.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="text-left text-zinc-500">
              <th className="px-2 py-1 font-medium" title="Media consensus rank (this board)">Media #</th>
              <th className="px-2 py-1 font-medium" title="Team consensus rank (aggregate of the 32 draft boards) — compare to Media #">Team #</th>
              <th className="px-2 py-1 font-medium">Prospect</th>
              <th className="px-2 py-1 font-medium">Pos</th>
              <th className="px-2 py-1 font-medium" title="perceived / real">Grade</th>
              {collegeOutlets.map((o) => (
                <th key={o.id} className="px-2 py-1 text-center font-medium" title={o.name}>
                  {abbreviateOutlet(o.name)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {consensus.map((entry) => {
              const info = nameById.get(entry.prospectId);
              const name = info?.name ?? entry.prospectId;
              const school = info?.school ?? '';
              const teamRank = teamConsensusRank.get(entry.prospectId) ?? null;
              // Media vs team-consensus gap: positive = media has him EARLIER
              // (higher) than the teams do → media buzz outrunning the board.
              const teamGap = teamRank !== null ? teamRank - entry.projectedOverallPick : null;
              return (
                <tr key={entry.prospectId} className="border-t border-zinc-800/60">
                  <td className="px-2 py-1 font-mono tabular-nums text-fuchsia-300">
                    {entry.projectedOverallPick}
                  </td>
                  <td
                    className={`px-2 py-1 font-mono tabular-nums ${
                      teamGap === null ? 'text-zinc-700'
                        : teamGap >= 12 ? 'text-emerald-400'
                          : teamGap <= -12 ? 'text-rose-400' : 'text-zinc-400'
                    }`}
                    title={teamGap === null ? 'Not on the team consensus board' : `media ${teamGap >= 0 ? '+' : ''}${teamGap} vs team consensus`}
                  >
                    {teamRank ?? '—'}
                  </td>
                  <td className="px-2 py-1">
                    <span className="text-zinc-200">{name}</span>{' '}
                    <span className="text-zinc-600">({school})</span>
                  </td>
                  <td className="px-2 py-1 font-mono text-zinc-400">{info?.pos ?? '—'}</td>
                  <td className="px-2 py-1">
                    <GradeCell
                      perceived={Math.round(entry.grade)}
                      real={prospectRealGrade(league, entry.prospectId)}
                    />
                  </td>
                  {collegeOutlets.map((o) => {
                    const pick = outletPicks.get(o.id)?.get(entry.prospectId);
                    return (
                      <td
                        key={o.id}
                        className={`px-2 py-1 text-center font-mono tabular-nums ${mockCellClass(
                          pick,
                          entry.projectedOverallPick,
                        )}`}
                      >
                        {pick ?? '—'}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function abbreviateOutlet(name: string): string {
  // Short column header — first word + any capitals, capped.
  const compact = name.replace(/[^A-Za-z0-9 ]/g, '');
  if (compact.length <= 10) return compact;
  return compact
    .split(' ')
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 5);
}

function mockCellClass(pick: number | undefined, consensusPick: number): string {
  if (pick === undefined) return 'text-zinc-700';
  const delta = consensusPick - pick; // > 0 = outlet has him earlier (likes more)
  if (delta >= 8) return 'text-emerald-400';
  if (delta >= 3) return 'text-emerald-300/70';
  if (delta <= -8) return 'text-rose-400';
  if (delta <= -3) return 'text-rose-300/70';
  return 'text-zinc-400';
}
// ─── Media Reliability by Position Group (v0.89) ────────────────────────
//
// The heart of the media's purpose: WHICH outlet to trust, WHERE, and WHY.
// Each outlet carries hidden per-group accuracy + hype; this panel measures
// the RESULT — how well each outlet's read orders prospects vs the real
// board (rank correlation), per position group, and how it tilts them
// (bias). Green = trustworthy ordering here; red = noise/hype here. The
// hidden per-group knobs are shown in the cell tooltip for tuning (dev
// inspector only — never the game UI).

function correlationCellClass(corr: number | null): string {
  if (corr === null) return 'text-zinc-700';
  if (corr >= 0.6) return 'text-emerald-400';
  if (corr >= 0.3) return 'text-emerald-300/70';
  if (corr >= 0.0) return 'text-amber-300/80';
  return 'text-rose-400';
}

// ─── GM Media Trust (perceived vs real) ─────────────────────────────────
// "Perceived always shows real" (CLAUDE.md inspector convention). Each GM
// carries its own belief about how reliable each outlet is per position
// group (`perceivedOutletReliability`); the draft board blends a media read
// by THIS belief, not by the outlet's true accuracy. This panel shows the
// gap so Daniel can judge whether the miscalibration feels right: sharp
// evaluators land near truth, buzz-chasers over-rate loud outlets and chase
// the wrong voice. Dev-only — the game UI never shows these numbers.

/** Colour a perceived value by how far (and which way) it is off the truth. */
function gmTrustCellClass(perceived: number, real: number): string {
  const gap = perceived - real;
  if (Math.abs(gap) <= 1) return 'text-emerald-400'; // calibrated
  if (gap > 2.5) return 'text-rose-500'; // badly over-trusts a weaker outlet
  if (gap > 1) return 'text-rose-300/80'; // over-trusts
  if (gap < -2.5) return 'text-sky-500'; // badly sleeps on a sharp outlet
  return 'text-sky-300/70'; // under-trusts
}

export function GmMediaTrustPanel({ league }: { league: LeagueState }) {
  const teams = useMemo(
    () =>
      Object.values(league.teams).sort((a, b) =>
        a.identity.location.localeCompare(b.identity.location),
      ),
    [league.teams],
  );
  const [teamId, setTeamId] = useState<TeamId | null>(teams[0]?.identity.id ?? null);
  const team = teamId ? league.teams[teamId] : undefined;
  const gm = team ? league.gms[team.gmId] : undefined;

  // Draft-relevant outlets (those that cover college), sorted by their REAL
  // headline accuracy so the calibration gradient reads top-to-bottom.
  const outlets = useMemo(
    () =>
      Object.values(league.mediaOutlets)
        .filter((o) => o.focus !== 'NFL')
        .sort((a, b) => b.accuracySpectrum - a.accuracySpectrum),
    [league.mediaOutlets],
  );

  const perceived = gm?.perceivedOutletReliability;

  // Overall calibration error: mean |perceived − real| across outlet × group.
  const calErr = useMemo(() => {
    if (!perceived) return null;
    let sum = 0;
    let n = 0;
    for (const o of outlets) {
      const per = perceived[o.id];
      if (!per) continue;
      for (const g of POSITION_GROUPS_ORDERED) {
        const p = per[g];
        const r = o.accuracyByGroup[g];
        if (p === undefined || r === undefined) continue;
        sum += Math.abs(p - r);
        n++;
      }
    }
    return n ? sum / n : null;
  }, [perceived, outlets]);

  if (!gm) return null;

  return (
    <section className="mt-6 rounded border border-fuchsia-500/25 bg-fuchsia-500/[0.04] p-4">
      <h2 className="mb-1 text-lg font-semibold text-fuchsia-200">
        GM Media Trust — perceived vs real
      </h2>
      <p className="mb-3 text-xs text-zinc-500">
        What this GM <em>believes</em> about each outlet's reliability (left) next to the outlet's{' '}
        <em>real</em> hidden accuracy (right), per position group.{' '}
        <span className="text-emerald-400">Green</span> = well-calibrated;{' '}
        <span className="text-rose-400">red</span> = over-trusts a weaker outlet (chases the wrong
        voice → reaches at the draft); <span className="text-sky-400">blue</span> = sleeps on a sharp
        outlet. Sharp evaluators (high talent-eval) land near truth; buzz-chasers (high media-trust)
        over-rate loud outlets. The board blends each media read by the PERCEIVED number, not the
        real one. <span className="text-zinc-600">(dev-only; never the game UI)</span>
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs">
        <select
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-200"
          value={teamId ?? ''}
          onChange={(e) => setTeamId(e.target.value as TeamId)}
        >
          {teams.map((t) => (
            <option key={t.identity.id} value={t.identity.id}>
              {t.identity.abbreviation} — {league.gms[t.gmId]?.name ?? 'GM'}
            </option>
          ))}
        </select>
        <span className="text-zinc-400">
          {gm.name} · media-trust{' '}
          <span className="font-mono text-zinc-200">{gm.spectrums.mediaTrust}</span> · talent-eval{' '}
          <span className="font-mono text-zinc-200">{gm.spectrums.talentEvaluationAccuracy}</span>
          {calErr !== null && (
            <>
              {' '}
              · mean miscalibration{' '}
              <span className="font-mono text-zinc-200">{calErr.toFixed(2)}</span>
            </>
          )}
        </span>
      </div>

      {!perceived ? (
        <p className="text-xs text-zinc-500">No perceived-reliability data (legacy GM).</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="text-left text-zinc-500">
                <th className="px-2 py-1 font-medium">Outlet</th>
                <th
                  className="px-2 py-1 text-center font-medium"
                  title="real headline accuracy / hype"
                >
                  acc·hype
                </th>
                {POSITION_GROUPS_ORDERED.map((g) => (
                  <th key={g} className="px-2 py-1 text-center font-medium">
                    {g}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {outlets.map((o) => {
                const per = perceived[o.id];
                return (
                  <tr key={o.id} className="border-t border-zinc-800/60">
                    <td className="px-2 py-1 text-zinc-200" title={o.name}>
                      {abbreviateOutlet(o.name)}
                    </td>
                    <td className="px-2 py-1 text-center font-mono tabular-nums text-zinc-500">
                      {o.accuracySpectrum}·{o.hypeSpectrum}
                    </td>
                    {POSITION_GROUPS_ORDERED.map((g) => {
                      const p = per?.[g];
                      const r = o.accuracyByGroup[g];
                      if (p === undefined || r === undefined) {
                        return (
                          <td key={g} className="px-2 py-1 text-center text-zinc-700">
                            —
                          </td>
                        );
                      }
                      return (
                        <td
                          key={g}
                          className="px-2 py-1 text-center font-mono tabular-nums"
                          title={`${g}: perceived ${p.toFixed(1)} vs real ${r} · hype ${o.hypeByGroup[g]}`}
                        >
                          <span className={gmTrustCellClass(p, r)}>{p.toFixed(1)}</span>
                          <span className="text-zinc-600">/{r}</span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function MediaReliabilityPanel({ league }: { league: LeagueState }) {
  const collegeOutlets = useMemo(
    () =>
      Object.values(league.mediaOutlets)
        .filter((o) => o.focus === 'COLLEGE')
        .sort((a, b) => b.accuracySpectrum - a.accuracySpectrum),
    [league.mediaOutlets],
  );

  // outletId → group → quality row.
  const qualityByOutlet = useMemo(() => {
    const map = new Map<string, Map<PositionGroup, OutletGroupQuality>>();
    for (const o of collegeOutlets) {
      const rows = computeOutletQualityByGroup(
        league.mediaCollegeObservations,
        league.collegePool,
        o.id,
      );
      const byGroup = new Map<PositionGroup, OutletGroupQuality>();
      for (const r of rows) byGroup.set(r.group, r);
      map.set(o.id, byGroup);
    }
    return map;
  }, [collegeOutlets, league.mediaCollegeObservations, league.collegePool]);

  if (league.mediaCollegeObservations.length === 0) {
    return (
      <section className="mt-6 rounded border border-cyan-500/20 bg-cyan-500/[0.03] p-3 text-xs text-zinc-500">
        🎯 Media reliability by position group — empty until the media cycle
        runs (step through Top-30 Visits, or simulate + advance a season).
      </section>
    );
  }

  return (
    <section className="mt-6 rounded border border-cyan-500/25 bg-cyan-500/[0.04] p-4">
      <h2 className="mb-1 text-lg font-semibold text-cyan-200">
        Media Reliability by Position Group
      </h2>
      <p className="mb-3 text-xs text-zinc-500">
        How well each outlet's read <em>orders</em> prospects vs the real
        board, per group (Spearman rank correlation). Green = trust its order
        here; red = noise or hype here. Small number = bias (+ reads high). An
        outlet can be sharp on QBs and a hype machine on OL — that's the
        pattern to learn. Hover a cell for the hidden per-group knobs + sample
        size. A cell is blank (—) when this round covered fewer than 4
        prospects in that group — the media only reads the top ~30–50 flashy
        names, so thin groups (QB, OL, ST) populate only late when coverage
        widens. For a per-prospect read on everyone, use the Draft Audit tab.{' '}
        <span className="text-zinc-600">(dev-only; never the game UI)</span>
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="text-left text-zinc-500">
              <th className="px-2 py-1 font-medium">Outlet</th>
              <th className="px-2 py-1 text-center font-medium" title="headline accuracy / hype">
                acc·hype
              </th>
              {POSITION_GROUPS_ORDERED.map((g) => (
                <th key={g} className="px-2 py-1 text-center font-medium">
                  {g}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {collegeOutlets.map((o) => {
              const byGroup = qualityByOutlet.get(o.id);
              return (
                <tr key={o.id} className="border-t border-zinc-800/60">
                  <td className="px-2 py-1 text-zinc-200" title={o.name}>
                    {abbreviateOutlet(o.name)}
                  </td>
                  <td className="px-2 py-1 text-center font-mono tabular-nums text-zinc-500">
                    {o.accuracySpectrum}·{o.hypeSpectrum}
                  </td>
                  {POSITION_GROUPS_ORDERED.map((g) => {
                    const q = byGroup?.get(g);
                    const corr = q?.rankCorrelation ?? null;
                    const accG = o.accuracyByGroup[g];
                    const hypeG = o.hypeByGroup[g];
                    const title = q
                      ? `${g}: corr ${corr === null ? 'n/a' : corr.toFixed(2)}, ` +
                        `bias ${q.meanBias >= 0 ? '+' : ''}${q.meanBias.toFixed(1)}, ` +
                        `n=${q.sampleSize} · hidden acc ${accG} / hype ${hypeG}`
                      : `${g}: not covered · hidden acc ${accG} / hype ${hypeG}`;
                    return (
                      <td
                        key={g}
                        className="px-2 py-1 text-center font-mono tabular-nums"
                        title={title}
                      >
                        {corr === null ? (
                          <span className="text-zinc-700">—</span>
                        ) : (
                          <>
                            <span className={correlationCellClass(corr)}>{corr.toFixed(2)}</span>
                            {q && Math.abs(q.meanBias) >= 1 && (
                              <span className="ml-1 text-[10px] text-zinc-600">
                                {q.meanBias >= 0 ? '+' : ''}
                                {q.meanBias.toFixed(0)}
                              </span>
                            )}
                          </>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
