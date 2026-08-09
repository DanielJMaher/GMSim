import type { LeagueState } from '../types/league.js';
import type { Player } from '../types/player.js';
import type { Contract } from '../types/contract.js';
import type { Transaction } from '../types/transaction.js';
import type { ContractId as ContractIdType, TeamId } from '../types/ids.js';
import { ContractId } from '../types/ids.js';
import type { Position } from '../types/enums.js';
import { currentCapHit, teamCapUsage } from '../contracts/cap.js';
import { evaluatePlayerValue } from '../trade/value.js';
import { mintContractId, contractIdCollisionEntry } from '../contracts/mint.js';

/**
 * The franchise tag (`FRANCHISE_TAG.md`, Opus 2026-08-09; §12 of
 * `LIQUIDATOR_DEAD_MONEY.md` ranks it #1 by alpha-tester visibility). A
 * team may retain ONE expiring player it didn't re-sign to a long-term deal
 * on a one-year, fully-guaranteed contract at a formula number instead of
 * losing him to free agency.
 *
 * v1 scope (§4): one tag per team per offseason, no offer sheets, no
 * exclusive/non-exclusive distinction, no transition tag — see the design
 * doc for why each is deliberately excluded rather than deferred silently.
 */

/**
 * §2: the tag number is the GREATER of the league's own top-5-at-position
 * cap-hit average, and 120% of the player's prior-year salary. §3: this is
 * directly computable from league state (no new data, no new constant) and
 * self-calibrates as the league's own market moves.
 */
export const FRANCHISE_TAG_PRIOR_SALARY_MULTIPLIER = 1.2;

/** How many of a position's top cap hits the average is drawn from (§2). */
const TOP_N_FOR_POSITION_AVERAGE = 5;

export interface FranchiseTagQuote {
  amount: number;
  /** Which side of the max() set the number — logged for auditability (§6). */
  branch: 'position-average' | 'prior-salary-floor';
}

/**
 * §3: average of the top-5 cap hits at `position` league-wide. Averages
 * whatever exists below 5 contracts (small positions like LS/FB/P in a thin
 * league); returns `null` — not a divide-by-zero — when the league carries
 * ZERO contracted players at the position, meaning no tag is offerable
 * there at all.
 */
export function topFiveAveragePositionCapHit(
  league: LeagueState,
  position: Position,
): number | null {
  const hits: number[] = [];
  for (const contract of Object.values(league.contracts)) {
    const player = league.players[contract.playerId];
    if (!player || player.position !== position) continue;
    hits.push(currentCapHit(contract));
  }
  if (hits.length === 0) return null;
  hits.sort((a, b) => b - a);
  const top = hits.slice(0, TOP_N_FOR_POSITION_AVERAGE);
  return top.reduce((sum, v) => sum + v, 0) / top.length;
}

/**
 * §2.1: "prior-year salary" is simply the expiring contract's OWN final
 * base-salary year — this works identically whether the expiring deal is a
 * normal multi-year contract or a PREVIOUS franchise tag (a 1-year deal
 * whose only base salary IS the prior tag number), so the 120%
 * second/third-tag escalator falls out for free with no tag-history state.
 */
function priorYearSalary(contract: Contract): number {
  return contract.baseSalaries[contract.baseSalaries.length - 1] ?? 0;
}

/**
 * §2/§3: the tag quote for `contract`'s player, or `null` if the position
 * carries zero contracted players league-wide (no market to anchor to).
 */
export function franchiseTagQuote(
  league: LeagueState,
  position: Position,
  contract: Contract,
): FranchiseTagQuote | null {
  const positionAverage = topFiveAveragePositionCapHit(league, position);
  if (positionAverage === null) return null;
  const floor = FRANCHISE_TAG_PRIOR_SALARY_MULTIPLIER * priorYearSalary(contract);
  return positionAverage >= floor
    ? { amount: Math.round(positionAverage), branch: 'position-average' }
    : { amount: Math.round(floor), branch: 'prior-salary-floor' };
}

/**
 * §7: the NPC decision rule. Deliberately simple — among a team's expiring
 * (post-re-sign-window) STAR/STARTER-tier players, tag the single
 * highest-value one it can afford. No competitive-window gate (§7): real
 * rebuilders tag star players constantly, to trade them or because losing
 * them for nothing is worse — asserting the intuitive gate without
 * measurement would be exactly the unmeasured behavioural claim law 3
 * exists to prevent.
 *
 * Must run AFTER `applyResigningWindow` and BEFORE `applyContractExpirations`
 * (§5) — it operates on exactly the population the re-sign window failed to
 * retain, which is precisely when a real team reaches for the tag. Pure
 * function — no PRNG; selection is deterministic (highest value, `player.id`
 * tiebreak).
 */
export function applyFranchiseTags(league: LeagueState, tick: number): LeagueState {
  const expiringIds = new Set<ContractIdType>();
  for (const c of Object.values(league.contracts)) {
    if (c.yearsRemaining <= 0) expiringIds.add(c.id);
  }
  if (expiringIds.size === 0) return league;

  // Cap baseline per team: usage as if every expiring contract were already
  // gone (same "sans expiring" pattern as applyResigningWindow) — the tag
  // adds back exactly one contract's cost on top of that clean baseline.
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

  const teamIds = (Object.keys(league.teams) as TeamId[]).sort();
  for (const teamId of teamIds) {
    const team = league.teams[teamId]!;

    const candidates = team.rosterIds
      .map((id) => league.players[id])
      .filter((p): p is Player => {
        if (!p || !p.contractId) return false;
        if (p.tier !== 'STAR' && p.tier !== 'STARTER') return false;
        return expiringIds.has(p.contractId);
      })
      .sort(
        (a, b) =>
          evaluatePlayerValue(team, b, league).total - evaluatePlayerValue(team, a, league).total ||
          (a.id < b.id ? -1 : 1),
      );
    if (candidates.length === 0) continue;

    const baseline = teamCapUsage(team, leagueSansExpiring);

    for (const player of candidates) {
      const oldContract = league.contracts[player.contractId!];
      if (!oldContract) continue;
      const quote = franchiseTagQuote(league, player.position, oldContract);
      if (quote === null) continue; // no market at this position -- can't price a tag
      if (baseline + quote.amount > league.salaryCap) continue; // can't fit -- try the next candidate

      const idSuffix = `${team.identity.abbreviation}_TAG${league.seasonNumber}`;
      const rawContract: Contract = {
        id: ContractId(`C_${idSuffix}`),
        playerId: player.id,
        teamId,
        signedOnTick: tick,
        realYears: 1,
        voidYears: 0,
        yearsRemaining: 1,
        baseSalaries: [quote.amount],
        signingBonus: 0,
        rosterBonuses: [0],
        workoutBonuses: [0],
        guarantees: [{ baseGuaranteedPct: 100, type: 'FULLY_GUARANTEED' }],
        incentives: [],
        noTradeClause: false,
      };
      // Fix 2 (Roster Floor §14): resolve against the CURRENT
      // (already-mutated-this-pass) map before either the map write or the
      // contractId stamp.
      const minted = mintContractId(contractsNext, rawContract.id);
      const contract: Contract =
        minted.collision === undefined ? rawContract : { ...rawContract, id: minted.id };

      delete contractsNext[oldContract.id];
      contractsNext[contract.id] = contract;
      playersNext[player.id] = { ...player, contractId: contract.id };
      logEntries.push({
        kind: 'franchise-tag',
        tick,
        seasonNumber: league.seasonNumber,
        teamId,
        playerId: player.id,
        contractId: contract.id,
        tagNumber: quote.amount,
        formulaBranch: quote.branch,
      });
      const collisionEntry = contractIdCollisionEntry(minted, {
        tick,
        seasonNumber: league.seasonNumber,
        teamId,
        playerId: player.id,
      });
      if (collisionEntry) logEntries.push(collisionEntry);
      break; // one tag per team (§4.1)
    }
  }

  if (logEntries.length === 0) return league;
  return {
    ...league,
    players: playersNext as LeagueState['players'],
    contracts: contractsNext as LeagueState['contracts'],
    transactionLog: [...league.transactionLog, ...logEntries],
  };
}
