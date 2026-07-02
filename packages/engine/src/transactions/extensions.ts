import type { LeagueState } from '../types/league.js';
import type { Player } from '../types/player.js';
import type { Contract } from '../types/contract.js';
import type { PlayerId, TeamId, ContractId as ContractIdType } from '../types/ids.js';
import type { Transaction } from '../types/transaction.js';
import { makeFreeAgentContract } from './free-agency.js';
import { currentCapHit, teamCapUsage } from '../contracts/cap.js';
import { ageOfPlayer } from '../season/development.js';
import { RESIGN_INCUMBENT_PREMIUM } from './re-sign.js';

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
/** Never extend a team past this — leaves room for the rookie class + in-season. */
export const CAP_EXTENSION_CEIL = 0.95;
/** Skip marginal extensions — the market deal must add at least this much cap. */
const MIN_EXTENSION_GAIN = 1_000_000;
/** Prime-age cutoff: you lock up cornerstones, not fading veterans. */
const EXTEND_MAX_AGE_QB = 33;
const EXTEND_MAX_AGE_OTHER = 29;

const EXTENDABLE_TIERS: ReadonlySet<Player['tier']> = new Set(['STAR', 'STARTER']);

function isExtendable(player: Player, seasonNumber: number): boolean {
  if (!EXTENDABLE_TIERS.has(player.tier)) return false;
  const age = ageOfPlayer(player, seasonNumber);
  const maxAge = player.position === 'QB' ? EXTEND_MAX_AGE_QB : EXTEND_MAX_AGE_OTHER;
  return age <= maxAge;
}

export function applyCapFloorExtensions(league: LeagueState, signedOnTick: number): LeagueState {
  const floor = CAP_FLOOR_TARGET * league.salaryCap;
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
    let usage = teamCapUsage(team, view());
    if (usage >= floor) continue;

    // Own underpaid prime starters/stars, ranked by the cap gain a market deal
    // adds (most underpaid first). `gain` is stable across this team's later
    // extensions — re-pricing one player doesn't change another's gap.
    const candidates: { playerId: PlayerId; gain: number }[] = [];
    for (const pid of team.rosterIds) {
      const player = players[pid];
      if (!player || !player.contractId) continue;
      if (!isExtendable(player, league.seasonNumber)) continue;
      const current = contracts[player.contractId];
      if (!current) continue;
      const market = makeFreeAgentContract(player, teamId, 'probe', signedOnTick, RESIGN_INCUMBENT_PREMIUM);
      const gain = currentCapHit(market) - currentCapHit(current);
      if (gain < MIN_EXTENSION_GAIN) continue;
      candidates.push({ playerId: player.id, gain });
    }
    candidates.sort((a, b) => b.gain - a.gain || (a.playerId < b.playerId ? -1 : 1));

    for (const cand of candidates) {
      if (usage >= floor) break;
      if (usage + cand.gain > ceil) continue; // would breach the ceiling — skip
      const player = players[cand.playerId]!;
      const oldContractId = player.contractId!;
      const idSuffix = `${team.identity.abbreviation}_EXT${league.seasonNumber}_${counter++}`;
      const newContract = makeFreeAgentContract(
        player,
        teamId,
        idSuffix,
        signedOnTick,
        RESIGN_INCUMBENT_PREMIUM,
      );

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
