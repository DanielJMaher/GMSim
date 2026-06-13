import type { Prng } from '../prng/index.js';
import type { LeagueState } from '../types/league.js';
import type { Player } from '../types/player.js';
import type { Contract } from '../types/contract.js';
import type { PlayerId, TeamId, ContractId as ContractIdType } from '../types/ids.js';
import type { Transaction } from '../types/transaction.js';
import { makeFreeAgentContract } from './free-agency.js';
import { currentCapHit, teamCapUsage } from '../contracts/cap.js';
import { moodBucket } from '../season/mood.js';
import { ageOfPlayer } from '../season/development.js';

/**
 * The RE-SIGN WINDOW (v0.148) — teams keep their own expiring players.
 *
 * Real bar (nflverse games.csv starting QBs, 2011-2024 season pairs):
 * primary QBs with 10+ starts STAY with their team 78.4% of the time
 * year-over-year (12.9% start elsewhere, 8.7% don't start again). Before
 * this step existed, GMSim dumped every expiring contract straight into
 * the FA auction — the incumbent was just another bidder — and ~45% of
 * primary passers (>2,500 yds) changed teams in ONE offseason, mass-
 * producing QB-desperate teams (the upstream cause of Daniel's year-1
 * draft observations).
 *
 * Runs in `applyOffseasonTransactions` BEFORE `applyContractExpirations`:
 * for each team, each ACTIVE-roster player whose contract just ran out is
 * a re-sign candidate. The team keeps him when:
 *   1. the dice clear `resignProbability` — tier-based desire (stars are
 *      priorities, fringe players walk), with an established-QB floor
 *      (franchise QBs essentially never reach the market), an age damper
 *      (teams let aging vets test the market — that's much of the real
 *      12.9% movement), and a mood damper (a wants-out player forces his
 *      way to the door); AND
 *   2. the new deal fits the cap: re-signs are processed stars-first and
 *      each consumes room; a team that can't fit the deal lets him walk
 *      (the realistic cap casualty).
 * The new contract is the player's open-market tier deal with a small
 * incumbent premium — teams pay to avoid the auction.
 *
 * NPC decision behavior — re-exported through `npc-ai`.
 */

/** Base re-sign desire by tier. Calibrated against the 78.4% real stay
 *  rate for primary starters (see module doc); verified by the retention
 *  probe rather than asserted blindly. */
export const RESIGN_BASE_BY_TIER: Readonly<Record<Player['tier'], number>> = {
  STAR: 0.88,
  STARTER: 0.75,
  BACKUP: 0.35,
  FRINGE: 0.12,
};

/** Floor for an established (STAR/STARTER) quarterback — franchise QBs
 *  essentially never hit the open market. */
export const RESIGN_QB_FLOOR = 0.93;

/** Age dampers — teams let aging vets test the market. QBs age later. */
export const RESIGN_AGE_SOFT = { qb: 36, other: 30 } as const;
export const RESIGN_AGE_HARD = { qb: 39, other: 33 } as const;
export const RESIGN_AGE_SOFT_FACTOR = 0.65;
export const RESIGN_AGE_HARD_FACTOR = 0.35;

/** Mood dampers — an unhappy player forces his way to the market. */
export const RESIGN_MOOD_FACTOR: Readonly<Record<string, number>> = {
  wants_out: 0.15,
  frustrated: 0.55,
  unsettled: 0.85,
  content: 1.0,
  happy: 1.0,
};

/**
 * Record-aware QB churn (v0.154 — the draft-order ↔ QB-need correlation).
 * Real primary-passer movement concentrates at BAD teams: a bottom team
 * doesn't re-sign its middling QB1 — it lets him walk and drafts the
 * replacement (which is WHY 75% of real #1 overalls are QBs). GMSim's
 * churn was random-expiry, so the team picking first was no more
 * QB-desperate than the league average. Non-STAR QBs on losing teams get
 * dampened; stars are immune (you don't dump the franchise QB over one
 * bad year — he was probably why you won what you did win).
 */
export const RESIGN_QB_BAD_TEAM_WINS = 6;
export const RESIGN_QB_BAD_TEAM_FACTOR = 0.45;
export const RESIGN_QB_MEDIOCRE_TEAM_WINS = 8;
export const RESIGN_QB_MEDIOCRE_TEAM_FACTOR = 0.75;

/** Incumbent premium on the re-sign deal vs the open-market tier shape. */
export const RESIGN_INCUMBENT_PREMIUM = 1.05;

/**
 * Re-signs may only commit up to this fraction of the cap — the rest is
 * reserved FA budget so the team can still fill its roster back to 53 in
 * the market (re-signing stars to 100% of cap left teams unable to refill;
 * the 53-man invariant test caught it).
 */
export const RESIGN_CAP_HEADROOM = 0.9;

/**
 * Probability the team re-signs this expiring player, before the cap
 * gate. Pure — exported for tests and the inspector. `lastSeasonWins`
 * drives the record-aware QB churn (v0.154); omitted = neutral record.
 */
export function resignProbability(
  player: Player,
  seasonNumber: number,
  lastSeasonWins?: number,
): number {
  let p = RESIGN_BASE_BY_TIER[player.tier];

  const isQb = player.position === 'QB';
  if (isQb && (player.tier === 'STAR' || player.tier === 'STARTER')) {
    p = Math.max(p, RESIGN_QB_FLOOR);
  }

  const age = ageOfPlayer(player, seasonNumber);
  const soft = isQb ? RESIGN_AGE_SOFT.qb : RESIGN_AGE_SOFT.other;
  const hard = isQb ? RESIGN_AGE_HARD.qb : RESIGN_AGE_HARD.other;
  if (age >= hard) p *= RESIGN_AGE_HARD_FACTOR;
  else if (age >= soft) p *= RESIGN_AGE_SOFT_FACTOR;

  p *= RESIGN_MOOD_FACTOR[moodBucket(player.mood)] ?? 1.0;

  // Losing teams cycle their non-star QBs back to the market (the real
  // source of primary-passer churn — and of QB-desperate teams at the
  // top of the draft order).
  if (isQb && player.tier !== 'STAR' && lastSeasonWins !== undefined) {
    if (lastSeasonWins <= RESIGN_QB_BAD_TEAM_WINS) p *= RESIGN_QB_BAD_TEAM_FACTOR;
    else if (lastSeasonWins <= RESIGN_QB_MEDIOCRE_TEAM_WINS) p *= RESIGN_QB_MEDIOCRE_TEAM_FACTOR;
  }

  return Math.max(0, Math.min(0.97, p));
}

const TIER_RANK: Record<Player['tier'], number> = {
  STAR: 0,
  STARTER: 1,
  BACKUP: 2,
  FRINGE: 3,
};

/**
 * Run the re-sign window over every team. Must run AFTER the season's
 * `yearsRemaining` decrement and BEFORE `applyContractExpirations` —
 * it consumes contracts at `yearsRemaining <= 0` that are about to drop.
 */
export function applyResigningWindow(
  prng: Prng,
  league: LeagueState,
  signedOnTick: number,
): LeagueState {
  // Cap baseline per team: usage as if every expiring contract were
  // already gone (they leave unless re-signed). Re-signs then consume
  // room stars-first against this baseline.
  const expiringIds = new Set<ContractIdType>();
  for (const c of Object.values(league.contracts)) {
    if (c.yearsRemaining <= 0) expiringIds.add(c.id);
  }
  if (expiringIds.size === 0) return league;
  const contractsSansExpiring: Record<string, Contract> = {};
  for (const c of Object.values(league.contracts)) {
    if (!expiringIds.has(c.id)) contractsSansExpiring[c.id] = c;
  }
  const leagueSansExpiring: LeagueState = {
    ...league,
    contracts: contractsSansExpiring as Readonly<Record<ContractIdType, Contract>>,
  };

  const playersNext: Record<string, Player> = { ...league.players };
  const contractsNext: Record<string, Contract> = { ...league.contracts };
  const logEntries: Transaction[] = [];
  let counter = 0;

  const teamIds = (Object.keys(league.teams) as TeamId[]).sort();
  for (const teamId of teamIds) {
    const team = league.teams[teamId]!;
    let committed = teamCapUsage(team, leagueSansExpiring);

    const candidates = team.rosterIds
      .map((id) => league.players[id])
      .filter((p): p is Player => {
        if (!p || !p.contractId) return false;
        return expiringIds.has(p.contractId);
      })
      .sort(
        (a, b) =>
          TIER_RANK[a.tier] - TIER_RANK[b.tier] || (a.id < b.id ? -1 : 1),
      );

    const lastRecord = team.seasonHistory[team.seasonHistory.length - 1];
    const lastWins =
      lastRecord && lastRecord.seasonNumber === league.seasonNumber
        ? lastRecord.wins
        : undefined;

    for (const player of candidates) {
      const p = resignProbability(player, league.seasonNumber, lastWins);
      if (prng.next() >= p) continue; // team (or player) opts for the market

      const idSuffix = `${team.identity.abbreviation}_RS${league.seasonNumber}_${counter++}`;
      const contract = makeFreeAgentContract(
        player,
        teamId,
        idSuffix,
        signedOnTick,
        RESIGN_INCUMBENT_PREMIUM,
      );
      const y1 = currentCapHit(contract);
      // Cap casualty — he walks. Headroom keeps FA budget for the refill.
      if (committed + y1 > league.salaryCap * RESIGN_CAP_HEADROOM) continue;

      committed += y1;
      delete contractsNext[player.contractId!];
      contractsNext[contract.id] = contract;
      playersNext[player.id] = { ...player, contractId: contract.id };
      logEntries.push({
        kind: 're-sign',
        tick: league.tick,
        seasonNumber: league.seasonNumber,
        teamId,
        playerId: player.id,
        contractId: contract.id,
        yearOneCapHit: y1,
        years: contract.realYears,
      });
    }
  }

  if (logEntries.length === 0) return league;
  return {
    ...league,
    players: playersNext as Readonly<Record<PlayerId, Player>>,
    contracts: contractsNext as Readonly<Record<ContractIdType, Contract>>,
    transactionLog: [...league.transactionLog, ...logEntries],
  };
}
