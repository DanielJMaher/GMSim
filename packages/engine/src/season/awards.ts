import type { LeagueState } from '../types/league.js';
import type { PlayerId, TeamId, CoachId } from '../types/ids.js';
import type { PlayerSeasonStats } from '../types/stats.js';
import type { Player } from '../types/player.js';
import { Position, PositionGroup } from '../types/enums.js';
import { computeRecords, winPct, type TeamRecord } from './standings.js';
import { seasonStatsForLeague } from './stats.js';

/**
 * Year-end league awards derived from the just-played season.
 *
 * Phase 2 placeholder: pure scoring heuristics, no voting model. The
 * Doc-12 News & Transaction Feed will eventually narrate these and
 * persist them in award histories.
 */
export interface SeasonAwards {
  mvp: PlayerAward | null;
  opoy: PlayerAward | null;
  dpoy: PlayerAward | null;
  oroy: PlayerAward | null;
  droy: PlayerAward | null;
  coy: CoachAward | null;
}

export interface PlayerAward {
  playerId: PlayerId;
  teamId: TeamId | null;
  /** The score the candidate won with — useful for displaying the gap. */
  score: number;
  /** A short stat-line summary suitable for inline display. */
  summary: string;
}

export interface CoachAward {
  coachId: CoachId;
  teamId: TeamId;
  score: number;
  summary: string;
}

/**
 * Compute end-of-season awards from a played league. Returns an
 * object with every category null when the league has no schedule.
 *
 * Pure & deterministic.
 */
export function seasonAwards(league: LeagueState): SeasonAwards {
  if (!league.schedule) {
    return { mvp: null, opoy: null, dpoy: null, oroy: null, droy: null, coy: null };
  }

  const stats = seasonStatsForLeague(league);
  const records = computeRecords(league);

  // Pre-bucket players by relevant pools so we don't re-walk for each award.
  const candidates: { player: Player; line: PlayerSeasonStats; team: TeamRecord }[] = [];
  for (const [pid, line] of stats) {
    const player = league.players[pid];
    if (!player || !player.teamId) continue;
    const teamRec = records.get(player.teamId);
    if (!teamRec) continue;
    candidates.push({ player, line, team: teamRec });
  }

  return {
    mvp: pickMvp(candidates),
    opoy: pickOpoy(candidates),
    dpoy: pickDpoy(candidates),
    oroy: pickRookie(candidates, 'OFFENSE'),
    droy: pickRookie(candidates, 'DEFENSE'),
    coy: pickCoy(league, records),
  };
}

// ─── Scoring ──────────────────────────────────────────────────────────

/**
 * NFL MVP heavily favors winning QBs. We weight raw passing volume
 * with a meaningful team-record bonus so a 4500yd/35td QB on a 12-5
 * team beats a 5000yd/40td QB on a losing team.
 */
function mvpScore(line: PlayerSeasonStats, team: TeamRecord): number {
  return line.passingYards + 30 * line.passingTds + 2500 * winPct(team);
}

function opoyScore(line: PlayerSeasonStats, team: TeamRecord): number {
  const yards = line.rushingYards + line.receivingYards;
  const tds = line.rushingTds + line.receivingTds;
  return yards + 60 * tds + 1500 * winPct(team);
}

function dpoyScore(line: PlayerSeasonStats, team: TeamRecord): number {
  return (
    150 * line.sacks +
    100 * line.interceptions +
    1.5 * line.tackles +
    1500 * winPct(team)
  );
}

// ─── Pickers ──────────────────────────────────────────────────────────

function pickMvp(
  candidates: readonly { player: Player; line: PlayerSeasonStats; team: TeamRecord }[],
): PlayerAward | null {
  const qbs = candidates.filter((c) => c.player.position === Position.QB);
  return bestPlayer(qbs, mvpScore, mvpSummary);
}

function pickOpoy(
  candidates: readonly { player: Player; line: PlayerSeasonStats; team: TeamRecord }[],
): PlayerAward | null {
  // OPOY here = top non-QB offensive performer.
  const nonQbs = candidates.filter(
    (c) =>
      c.player.position !== Position.QB &&
      (c.player.positionGroup === PositionGroup.SKILL),
  );
  return bestPlayer(nonQbs, opoyScore, opoySummary);
}

function pickDpoy(
  candidates: readonly { player: Player; line: PlayerSeasonStats; team: TeamRecord }[],
): PlayerAward | null {
  const defenders = candidates.filter((c) => isDefensive(c.player.positionGroup));
  return bestPlayer(defenders, dpoyScore, dpoySummary);
}

function pickRookie(
  candidates: readonly { player: Player; line: PlayerSeasonStats; team: TeamRecord }[],
  side: 'OFFENSE' | 'DEFENSE',
): PlayerAward | null {
  const pool = candidates.filter((c) => c.player.experienceYears === 0);
  if (side === 'OFFENSE') {
    const off = pool.filter(
      (c) =>
        c.player.position === Position.QB || c.player.positionGroup === PositionGroup.SKILL,
    );
    return bestPlayer(
      off,
      (l, t) =>
        l.passingYards * 0.5 +
        25 * l.passingTds +
        l.rushingYards +
        l.receivingYards +
        50 * (l.rushingTds + l.receivingTds) +
        500 * winPct(t),
      rookieOffSummary,
    );
  }
  const def = pool.filter((c) => isDefensive(c.player.positionGroup));
  return bestPlayer(
    def,
    (l, t) => 120 * l.sacks + 80 * l.interceptions + 1.2 * l.tackles + 500 * winPct(t),
    dpoySummary,
  );
}

function pickCoy(
  league: LeagueState,
  records: Map<TeamId, TeamRecord>,
): CoachAward | null {
  const teams = Object.values(league.teams);
  if (teams.length === 0) return null;
  let best: { teamId: TeamId; coachId: CoachId; record: TeamRecord; score: number } | null = null;
  for (const team of teams) {
    const rec = records.get(team.identity.id);
    if (!rec) continue;
    const pointDiff = rec.pointsFor - rec.pointsAgainst;
    // Wins matter most; point differential is the tiebreaker.
    const score = winPct(rec) * 1000 + pointDiff * 0.1;
    if (!best || score > best.score) {
      best = { teamId: team.identity.id, coachId: team.headCoachId, record: rec, score };
    }
  }
  if (!best) return null;
  return {
    coachId: best.coachId,
    teamId: best.teamId,
    score: best.score,
    summary: `${best.record.wins}-${best.record.losses}${best.record.ties > 0 ? `-${best.record.ties}` : ''}, ${(best.record.pointsFor - best.record.pointsAgainst >= 0 ? '+' : '')}${best.record.pointsFor - best.record.pointsAgainst} pt diff`,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────

function bestPlayer(
  pool: readonly { player: Player; line: PlayerSeasonStats; team: TeamRecord }[],
  score: (l: PlayerSeasonStats, t: TeamRecord) => number,
  summary: (l: PlayerSeasonStats) => string,
): PlayerAward | null {
  if (pool.length === 0) return null;
  let bestEntry: typeof pool[number] | null = null;
  let bestScore = -Infinity;
  for (const c of pool) {
    const s = score(c.line, c.team);
    // Tiebreaker on player ID keeps ordering deterministic.
    if (s > bestScore || (s === bestScore && bestEntry && c.player.id < bestEntry.player.id)) {
      bestEntry = c;
      bestScore = s;
    }
  }
  if (!bestEntry) return null;
  return {
    playerId: bestEntry.player.id,
    teamId: bestEntry.player.teamId,
    score: bestScore,
    summary: summary(bestEntry.line),
  };
}

function isDefensive(group: PositionGroup): boolean {
  return group === PositionGroup.DL || group === PositionGroup.LB || group === PositionGroup.DB;
}

function mvpSummary(l: PlayerSeasonStats): string {
  return `${l.passingYards.toLocaleString()} pass yds, ${l.passingTds} TD, ${l.interceptionsThrown} INT`;
}

function opoySummary(l: PlayerSeasonStats): string {
  const yds = l.rushingYards + l.receivingYards;
  const tds = l.rushingTds + l.receivingTds;
  if (l.rushingYards >= l.receivingYards) {
    return `${yds.toLocaleString()} scrim yds (${l.rushingYards.toLocaleString()} rush), ${tds} TD`;
  }
  return `${yds.toLocaleString()} scrim yds (${l.receivingYards.toLocaleString()} rec), ${tds} TD`;
}

function dpoySummary(l: PlayerSeasonStats): string {
  return `${l.sacks} sk, ${l.interceptions} INT, ${l.tackles} tkl`;
}

function rookieOffSummary(l: PlayerSeasonStats): string {
  if (l.passingYards > 0) return mvpSummary(l);
  return opoySummary(l);
}
