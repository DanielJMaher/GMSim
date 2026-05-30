import type { LeagueState } from '../types/league.js';
import type { PlayerId, TeamId, CoachId } from '../types/ids.js';
import type { PlayerSeasonStats } from '../types/stats.js';
import type { Player } from '../types/player.js';
import { Position, PositionGroup } from '../types/enums.js';
import type { AwardKind } from '../types/awards.js';
import { keySkillAverage } from '../archetypes/key-skill.js';
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

// ─── Pro Bowl / All-Pro (Skill Adjudicator 2b) ────────────────────────────

interface AccoladeSlots {
  /** Pro Bowlers at this position (1st/2nd-team All-Pros are a subset). */
  proBowl: number;
  allPro1: number;
  allPro2: number;
}

/**
 * Per-position season-accolade slots, scaled to the 32-team league to mirror
 * real NFL counts (1st-team All-Pro = top 1-2/pos; Pro Bowl ≈ 2× All-Pro
 * slots ≈ ~91 total). All-Pros are also credited PRO_BOWL.
 */
const ACCOLADE_SLOTS: Partial<Record<Position, AccoladeSlots>> = {
  [Position.QB]: { proBowl: 6, allPro1: 1, allPro2: 1 },
  [Position.RB]: { proBowl: 6, allPro1: 2, allPro2: 1 },
  [Position.FB]: { proBowl: 1, allPro1: 1, allPro2: 0 },
  [Position.WR]: { proBowl: 12, allPro1: 3, allPro2: 2 },
  [Position.TE]: { proBowl: 6, allPro1: 1, allPro2: 1 },
  [Position.LT]: { proBowl: 4, allPro1: 1, allPro2: 1 },
  [Position.RT]: { proBowl: 4, allPro1: 1, allPro2: 1 },
  [Position.LG]: { proBowl: 3, allPro1: 1, allPro2: 1 },
  [Position.RG]: { proBowl: 3, allPro1: 1, allPro2: 1 },
  [Position.C]: { proBowl: 3, allPro1: 1, allPro2: 1 },
  [Position.EDGE]: { proBowl: 8, allPro1: 2, allPro2: 2 },
  [Position.DT]: { proBowl: 5, allPro1: 2, allPro2: 1 },
  [Position.NT]: { proBowl: 1, allPro1: 0, allPro2: 1 },
  [Position.OLB]: { proBowl: 4, allPro1: 1, allPro2: 1 },
  [Position.ILB]: { proBowl: 4, allPro1: 1, allPro2: 1 },
  [Position.CB]: { proBowl: 8, allPro1: 2, allPro2: 2 },
  [Position.S]: { proBowl: 6, allPro1: 2, allPro2: 2 },
  [Position.NICKEL]: { proBowl: 2, allPro1: 1, allPro2: 0 },
  [Position.K]: { proBowl: 2, allPro1: 1, allPro2: 1 },
  [Position.P]: { proBowl: 2, allPro1: 1, allPro2: 1 },
  [Position.LS]: { proBowl: 1, allPro1: 1, allPro2: 0 },
};

/** Weight of the talent term in the talent-blended accolade score. The blend
 *  is over z-scores (box production vs talent), so an ELITE player in a
 *  low-box-score role — a shutdown CB QBs avoid, a run-stuffing DT, a blocking
 *  TE — still rises instead of being buried under volume producers, while a top
 *  producer at the position still places. 0 = pure production, 1 = pure talent;
 *  0.6 lands realistic ELITE→Pro Bowl conversion without ignoring the box. */
const TALENT_BLEND = 0.6;

/** Per-position RAW season box production. 0 for OL/ST (no box stats — they
 *  rank on talent alone) and for box players who didn't record a stat line. */
function boxProduction(player: Player, line: PlayerSeasonStats | undefined): number {
  switch (player.positionGroup) {
    case PositionGroup.QB:
      return line ? line.passingYards + 25 * line.passingTds - 20 * line.interceptionsThrown : 0;
    case PositionGroup.SKILL:
      return line
        ? line.rushingYards + line.receivingYards + 50 * (line.rushingTds + line.receivingTds)
        : 0;
    case PositionGroup.DL:
    case PositionGroup.LB:
    case PositionGroup.DB:
      return line ? line.tackles + 30 * line.sacks + 60 * line.interceptions : 0;
    default:
      return 0; // OL / ST — talent-only.
  }
}

function isBoxGroup(group: PositionGroup): boolean {
  return (
    group === PositionGroup.QB ||
    group === PositionGroup.SKILL ||
    group === PositionGroup.DL ||
    group === PositionGroup.LB ||
    group === PositionGroup.DB
  );
}

interface AccoladeCand {
  id: PlayerId;
  box: number;
  talent: number;
  /** Recorded a stat line this season (box positions only). */
  played: boolean;
}

function meanStd(values: readonly number[]): { mean: number; std: number } {
  if (values.length === 0) return { mean: 0, std: 0 };
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return { mean, std: Math.sqrt(variance) };
}

/**
 * Select Pro Bowl + All-Pro accolades for the just-played season. Returns
 * playerId → awarded kinds (each accolade winner gets PRO_BOWL; the very top
 * also get ALL_PRO_1ST / ALL_PRO_2ND). Pure & deterministic.
 *
 * Box positions are ranked by a talent-blended z-score (production + talent),
 * so dominant-but-quiet roles (shutdown CB, run DT, blocking TE) aren't snubbed
 * by raw volume. OL / ST have no box stats and rank on talent alone. A player
 * who didn't play (no stat line) can't place at a box position regardless of
 * talent — accolades reward what happened on the field, not the depth chart.
 */
export function selectAccolades(league: LeagueState): Map<PlayerId, AwardKind[]> {
  const out = new Map<PlayerId, AwardKind[]>();
  if (!league.schedule) return out;
  const stats = seasonStatsForLeague(league);

  const byPosition = new Map<Position, AccoladeCand[]>();
  for (const player of Object.values(league.players)) {
    if (!player.teamId) continue;
    const line = stats.get(player.id);
    const bucket = byPosition.get(player.position) ?? byPosition.set(player.position, []).get(player.position)!;
    bucket.push({
      id: player.id,
      box: boxProduction(player, line),
      talent: keySkillAverage(player.current, player.archetype),
      played: Boolean(line),
    });
  }

  const add = (id: PlayerId, kind: AwardKind): void => {
    const list = out.get(id) ?? out.set(id, []).get(id)!;
    list.push(kind);
  };

  for (const [position, cands] of byPosition) {
    const slots = ACCOLADE_SLOTS[position];
    if (!slots || cands.length === 0) continue;
    const group = positionGroupOf(cands, league);

    let scored: { id: PlayerId; score: number }[];
    if (!isBoxGroup(group)) {
      // OL / ST — talent only.
      scored = cands.map((c) => ({ id: c.id, score: c.talent }));
    } else {
      // z-blend box production with talent over the players who actually
      // played; the rest can't place (score -Infinity).
      const played = cands.filter((c) => c.played);
      const box = meanStd(played.map((c) => c.box));
      const tal = meanStd(played.map((c) => c.talent));
      scored = cands.map((c) => {
        if (!c.played) return { id: c.id, score: Number.NEGATIVE_INFINITY };
        const zb = box.std > 0 ? (c.box - box.mean) / box.std : 0;
        const zt = tal.std > 0 ? (c.talent - tal.mean) / tal.std : 0;
        return { id: c.id, score: (1 - TALENT_BLEND) * zb + TALENT_BLEND * zt };
      });
    }

    scored.sort((a, b) => b.score - a.score);
    const proBowlers = scored.slice(0, slots.proBowl).filter((c) => c.score > Number.NEGATIVE_INFINITY);
    proBowlers.forEach((c, i) => {
      add(c.id, 'PRO_BOWL');
      if (i < slots.allPro1) add(c.id, 'ALL_PRO_1ST');
      else if (i < slots.allPro1 + slots.allPro2) add(c.id, 'ALL_PRO_2ND');
    });
  }
  return out;
}

/** All players in a position bucket share a position group — read it off the
 *  first candidate's player record. */
function positionGroupOf(cands: readonly AccoladeCand[], league: LeagueState): PositionGroup {
  const first = cands[0];
  const p = first ? league.players[first.id] : undefined;
  return p?.positionGroup ?? PositionGroup.ST;
}
