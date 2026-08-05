import type { LeagueState } from '../types/league.js';
import type { Player } from '../types/player.js';
import type { Contract } from '../types/contract.js';
import type { PlayerId, TeamId, ContractId as ContractIdType } from '../types/ids.js';
import type { Transaction } from '../types/transaction.js';
import { makeFreeAgentContract } from './free-agency.js';
import { currentCapHit, teamCapUsage } from '../contracts/cap.js';
import { ANCHOR_CAP } from '../contracts/constants.js';
import { teamCashFloorStatus } from '../contracts/cash.js';
import { ageOfPlayer } from '../season/development.js';
import { mintContractId, contractIdCollisionEntry } from '../contracts/mint.js';
import {
  RESIGN_INCUMBENT_PREMIUM,
  RESIGN_QB_BAD_TEAM_WINS,
  lastSeasonWins,
} from './re-sign.js';

/**
 * Cap-floor veteran EXTENSIONS (cap-realism deep model, Slice 1).
 *
 * GMSim teams underspend badly over seasons: generation gives every player a
 * veteran-tier deal (~89% of cap), but as those expire and cheap rookie-scale
 * contracts replace retirees, teams DON'T redeploy the freed cap — the league
 * settles at ~62% cap usage with ~$95M/team idle, vs the real NFL's ~90%. Real
 * teams spend that room mostly on their OWN players: they extend the young star
 * before he hits the market, and pay the ascending starter.
 *
 * This pass models that. Each offseason, a team below the spend FLOOR extends
 * its own UNDERPAID prime starters/stars — those whose current cap hit sits well
 * below their open-market tier deal (a young star still on his rookie contract,
 * a starter on an old cheap deal) — re-pricing them to a fresh market deal,
 * biggest underpayment first, until it reaches the floor (never past the ceiling,
 * which leaves room for the incoming rookie class + in-season moves).
 *
 * Pure + deterministic: candidate selection and the deal are world-state; the
 * running cap is recomputed exactly after each extension. NPC decision behavior —
 * re-exported through `npc-ai`.
 */

/** Teams below this fraction of the cap extend their own vets up toward it. */
export const CAP_FLOOR_TARGET = 0.88;
/**
 * Raised floor for teams behind the CBA-style cash-floor pace (cap-realism
 * Slice 3): a club that has underspent its trailing window must push money
 * out, and extending its own core with fresh bonus cash is the primary
 * lever — mirroring how real floor-squeezed teams (the CBA forces ~89% of
 * caps in cash over 4-year periods) hand out early extensions.
 */
export const CASH_LAG_FLOOR_TARGET = 0.93;
/**
 * Extra premium on a floor-lagging team's extensions (multiplies
 * RESIGN_INCUMBENT_PREMIUM). Floor-squeezed front offices overpay their own
 * core the same way they overpay the FA market — the money has to move.
 */
export const CASH_LAG_EXTENSION_PREMIUM = 1.15;
/** Never extend a team past this — leaves room for the rookie class + in-season. */
export const CAP_EXTENSION_CEIL = 0.95;
/** Skip marginal extensions — the market deal must add at least this much cap
 *  (dollars at ANCHOR_CAP; scaled by the current cap in the pass). */
const MIN_EXTENSION_GAIN = 1_000_000;
/** Prime-age cutoff: you lock up cornerstones, not fading veterans. */
const EXTEND_MAX_AGE_QB = 33;
const EXTEND_MAX_AGE_OTHER = 29;
/**
 * Floor-lagging teams extend OLDER vets too (cap-realism Slice 3) — a team
 * that must move money pays the 30/31-year-old starter real front offices
 * would let walk. Candidate scarcity, not the floor target, was the binding
 * constraint on lagging-team spend (measured: the whole prime STAR/STARTER
 * pool re-priced to market tops out near ~53% of cap).
 */
const CASH_LAG_EXTEND_AGE_BONUS = 2;

const EXTENDABLE_TIERS: ReadonlySet<Player['tier']> = new Set(['STAR', 'STARTER']);
/**
 * Floor-lagging teams also pay their DEPTH (BACKUP tier) — the overpaid
 * rotational vet is a signature floor-team contract. Prime STAR/STARTER
 * candidates alone top out near ~53% of cap when fully re-priced.
 */
const EXTENDABLE_TIERS_LAGGING: ReadonlySet<Player['tier']> = new Set([
  'STAR',
  'STARTER',
  'BACKUP',
]);

function isExtendable(player: Player, seasonNumber: number, lagging: boolean): boolean {
  const tiers = lagging ? EXTENDABLE_TIERS_LAGGING : EXTENDABLE_TIERS;
  if (!tiers.has(player.tier)) return false;
  const age = ageOfPlayer(player, seasonNumber);
  const maxAge =
    (player.position === 'QB' ? EXTEND_MAX_AGE_QB : EXTEND_MAX_AGE_OTHER) +
    (lagging ? CASH_LAG_EXTEND_AGE_BONUS : 0);
  return age <= maxAge;
}

export function applyCapFloorExtensions(league: LeagueState, signedOnTick: number): LeagueState {
  const ceil = CAP_EXTENSION_CEIL * league.salaryCap;

  let players: Record<string, Player> = league.players;
  let contracts: Record<string, Contract> = league.contracts;
  const logEntries: Transaction[] = [];
  let counter = 0;

  // teamCapUsage reads a LeagueState; keep a light working view over the maps we
  // mutate so the running usage is exact (top-51 offseason rule included).
  const view = (): LeagueState =>
    ({ ...league, players, contracts } as LeagueState);

  for (const teamId of (Object.keys(league.teams) as TeamId[]).sort()) {
    const team = league.teams[teamId]!;
    // Cash-floor pressure (Slice 3): a team behind its trailing-window cash
    // pace extends up to a HIGHER usage target, at a premium — the floor
    // forces the money out.
    const lagging = teamCashFloorStatus(team, league).lagging;
    const floor = (lagging ? CASH_LAG_FLOOR_TARGET : CAP_FLOOR_TARGET) * league.salaryCap;
    const premium = lagging
      ? RESIGN_INCUMBENT_PREMIUM * CASH_LAG_EXTENSION_PREMIUM
      : RESIGN_INCUMBENT_PREMIUM;
    // Record-aware QB carve-out (v0.175, same philosophy as the v0.154
    // re-sign damper): a bottom team doesn't hand its middling veteran QB
    // a fresh multi-year deal — it lets the contract run out and drafts
    // the replacement. Floor pressure goes to every other position; STAR
    // QBs stay extendable (you don't cycle the franchise QB over one bad
    // year). Without this gate the cash floor quietly settles the QB room
    // of exactly the teams that should be QB-desperate at the top of the
    // draft (#1-overall QB share regressed 76→67% when Slice 3 landed).
    const wins = lastSeasonWins(team, league);
    const cyclesQbs = wins !== undefined && wins <= RESIGN_QB_BAD_TEAM_WINS;
    let usage = teamCapUsage(team, view());
    if (usage >= floor) continue;

    // Own underpaid prime starters/stars, ranked by the cap gain a market deal
    // adds (most underpaid first). `gain` is stable across this team's later
    // extensions — re-pricing one player doesn't change another's gap.
    const candidates: { playerId: PlayerId; gain: number }[] = [];
    for (const pid of team.rosterIds) {
      const player = players[pid];
      if (!player || !player.contractId) continue;
      if (cyclesQbs && player.position === 'QB' && player.tier !== 'STAR') continue;
      if (!isExtendable(player, league.seasonNumber, lagging)) continue;
      const current = contracts[player.contractId];
      if (!current) continue;
      const market = makeFreeAgentContract(
        player,
        teamId,
        'probe',
        signedOnTick,
        premium,
        league.salaryCap,
      );
      const gain = currentCapHit(market) - currentCapHit(current);
      if (gain < MIN_EXTENSION_GAIN * (league.salaryCap / ANCHOR_CAP)) continue;
      candidates.push({ playerId: player.id, gain });
    }
    candidates.sort((a, b) => b.gain - a.gain || (a.playerId < b.playerId ? -1 : 1));

    for (const cand of candidates) {
      if (usage >= floor) break;
      if (usage + cand.gain > ceil) continue; // would breach the ceiling — skip
      const player = players[cand.playerId]!;
      const oldContractId = player.contractId!;
      const idSuffix = `${team.identity.abbreviation}_EXT${league.seasonNumber}_${counter++}`;
      const rawContract = makeFreeAgentContract(
        player,
        teamId,
        idSuffix,
        signedOnTick,
        premium,
        league.salaryCap,
      );

      // Fix 2 (§14): resolve against the CURRENT (already-mutated-this-pass)
      // map before either the map write or the contractId stamp.
      const minted = mintContractId(contracts, rawContract.id);
      const newContract: Contract =
        minted.collision === undefined ? rawContract : { ...rawContract, id: minted.id };

      contracts = { ...contracts };
      delete contracts[oldContractId];
      contracts[newContract.id] = newContract;
      players = { ...players, [player.id]: { ...player, contractId: newContract.id } };

      logEntries.push({
        kind: 're-sign',
        tick: league.tick,
        seasonNumber: league.seasonNumber,
        teamId,
        playerId: player.id,
        contractId: newContract.id,
        yearOneCapHit: currentCapHit(newContract),
        years: newContract.realYears,
      });
      const collisionEntry = contractIdCollisionEntry(minted, {
        tick: league.tick,
        seasonNumber: league.seasonNumber,
        teamId,
        playerId: player.id,
      });
      if (collisionEntry) logEntries.push(collisionEntry);

      usage = teamCapUsage(team, view());
    }
  }

  if (logEntries.length === 0) return league;
  return {
    ...league,
    players: players as Readonly<Record<PlayerId, Player>>,
    contracts: contracts as Readonly<Record<ContractIdType, Contract>>,
    transactionLog: [...league.transactionLog, ...logEntries],
  };
}
