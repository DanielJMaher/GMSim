import type { LeagueState } from '../types/league.js';
import type { TeamId } from '../types/ids.js';
import { Conference, Division } from '../types/enums.js';
import type { ScheduledGame } from '../types/game.js';

export interface TeamRecord {
  teamId: TeamId;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  divisionWins: number;
  divisionLosses: number;
  conferenceWins: number;
  conferenceLosses: number;
}

/**
 * Compute current-season records for every team based on completed
 * games in `league.schedule.regularSeason`. Cheap to recompute, so we
 * don't bother caching — call as needed.
 */
export function computeRecords(league: LeagueState): Map<TeamId, TeamRecord> {
  const records = new Map<TeamId, TeamRecord>();
  for (const team of Object.values(league.teams)) {
    records.set(team.identity.id, blankRecord(team.identity.id));
  }

  if (!league.schedule) return records;

  for (const week of league.schedule.regularSeason) {
    for (const game of week) {
      if (!game.result) continue;
      applyGameToRecords(game, records, league);
    }
  }
  return records;
}

function applyGameToRecords(
  game: ScheduledGame,
  records: Map<TeamId, TeamRecord>,
  league: LeagueState,
): void {
  const r = game.result!;
  const homeRec = records.get(game.homeTeamId)!;
  const awayRec = records.get(game.awayTeamId)!;
  homeRec.pointsFor += r.homeScore;
  homeRec.pointsAgainst += r.awayScore;
  awayRec.pointsFor += r.awayScore;
  awayRec.pointsAgainst += r.homeScore;

  const homeTeam = league.teams[game.homeTeamId]!;
  const awayTeam = league.teams[game.awayTeamId]!;
  const sameDivision = homeTeam.identity.division === awayTeam.identity.division;
  const sameConference = homeTeam.identity.conference === awayTeam.identity.conference;

  if (r.homeScore > r.awayScore) {
    homeRec.wins++;
    awayRec.losses++;
    if (sameDivision) {
      homeRec.divisionWins++;
      awayRec.divisionLosses++;
    }
    if (sameConference) {
      homeRec.conferenceWins++;
      awayRec.conferenceLosses++;
    }
  } else if (r.awayScore > r.homeScore) {
    awayRec.wins++;
    homeRec.losses++;
    if (sameDivision) {
      awayRec.divisionWins++;
      homeRec.divisionLosses++;
    }
    if (sameConference) {
      awayRec.conferenceWins++;
      homeRec.conferenceLosses++;
    }
  } else {
    homeRec.ties++;
    awayRec.ties++;
  }
}

function blankRecord(teamId: TeamId): TeamRecord {
  return {
    teamId,
    wins: 0,
    losses: 0,
    ties: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    divisionWins: 0,
    divisionLosses: 0,
    conferenceWins: 0,
    conferenceLosses: 0,
  };
}

/**
 * Win percentage with ties counting as half. Returns 0 if no games played.
 */
export function winPct(r: TeamRecord): number {
  const total = r.wins + r.losses + r.ties;
  if (total === 0) return 0;
  return (r.wins + r.ties * 0.5) / total;
}

/**
 * Sort teams by record + tiebreakers. Phase 2 tiebreaker order:
 *   1. Win pct
 *   2. Division record win pct
 *   3. Conference record win pct
 *   4. Point differential
 *
 * Real NFL has a more elaborate ladder (head-to-head, common opponents,
 * etc.); the simulation only needs deterministic ordering.
 */
export function sortByRecord(
  records: ReadonlyArray<TeamRecord>,
): readonly TeamRecord[] {
  return [...records].sort((a, b) => {
    const wa = winPct(a);
    const wb = winPct(b);
    if (wa !== wb) return wb - wa;
    const da = divisionWinPct(a);
    const db = divisionWinPct(b);
    if (da !== db) return db - da;
    const ca = conferenceWinPct(a);
    const cb = conferenceWinPct(b);
    if (ca !== cb) return cb - ca;
    const dpa = a.pointsFor - a.pointsAgainst;
    const dpb = b.pointsFor - b.pointsAgainst;
    if (dpa !== dpb) return dpb - dpa;
    // Final tiebreaker: team ID (stable + deterministic)
    return String(a.teamId).localeCompare(String(b.teamId));
  });
}

function divisionWinPct(r: TeamRecord): number {
  const t = r.divisionWins + r.divisionLosses;
  if (t === 0) return 0;
  return r.divisionWins / t;
}

function conferenceWinPct(r: TeamRecord): number {
  const t = r.conferenceWins + r.conferenceLosses;
  if (t === 0) return 0;
  return r.conferenceWins / t;
}

/**
 * Group teams by division, sorted by tiebreaker order within each.
 */
export function divisionStandings(
  league: LeagueState,
  records: Map<TeamId, TeamRecord>,
): Map<Division, readonly TeamRecord[]> {
  const out = new Map<Division, readonly TeamRecord[]>();
  for (const division of Object.values(Division)) {
    const teams = Object.values(league.teams).filter(
      (t) => t.identity.division === division,
    );
    const recs = teams.map((t) => records.get(t.identity.id)!);
    out.set(division, sortByRecord(recs));
  }
  return out;
}

/**
 * Compute the 7-team playoff bracket per conference: top 4 division
 * winners (seeded 1-4 by record) + top 3 wildcards (seeded 5-7).
 */
export function playoffSeeds(
  league: LeagueState,
  records: Map<TeamId, TeamRecord>,
): Record<Conference, readonly TeamRecord[]> {
  const out: Record<Conference, TeamRecord[]> = { AFC: [], NFC: [] };

  for (const conference of Object.values(Conference)) {
    // Division winners
    const divWinners: TeamRecord[] = [];
    for (const division of Object.values(Division)) {
      const teams = Object.values(league.teams).filter(
        (t) => t.identity.division === division && t.identity.conference === conference,
      );
      if (teams.length === 0) continue;
      const recs = teams.map((t) => records.get(t.identity.id)!);
      const sorted = sortByRecord(recs);
      if (sorted[0]) divWinners.push(sorted[0]);
    }
    const seededDivWinners = sortByRecord(divWinners);

    // Wildcards: best 3 non-division-winners in conference
    const winnerIds = new Set(seededDivWinners.map((r) => r.teamId));
    const wildcardCandidates = Object.values(league.teams)
      .filter(
        (t) => t.identity.conference === conference && !winnerIds.has(t.identity.id),
      )
      .map((t) => records.get(t.identity.id)!);
    const sortedWildcards = sortByRecord(wildcardCandidates).slice(0, 3);

    out[conference] = [...seededDivWinners, ...sortedWildcards];
  }

  return out;
}
