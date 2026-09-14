import type { LeagueState } from '../types/league.js';
import type { Player } from '../types/player.js';
import type { Contract } from '../types/contract.js';
import type { TeamState } from '../types/team.js';
import type {
  PlayerId,
  TeamId,
  ContractId as ContractIdType,
} from '../types/ids.js';
import {
  currentCapHit,
  deadMoneyOnPreJune1Release,
  teamCapUsage,
  unamortizedSigningBonus,
  addToYear,
  splitDeadMoney,
  isOffseasonPhase,
} from '../contracts/cap.js';
import { makeFreeAgentContract } from './free-agency.js';
import { auctionFreeAgent } from './fa-bidding.js';
import type { FaBidderDetail, SuppliedBid } from './fa-bidding.js';
import { computeStarterCaliberIds } from '../players/starter-caliber.js';
import { leagueMinimumSalary } from '../contracts/constants.js';
import { ContractId } from '../types/ids.js';
import type { Transaction, FaSignBidder } from '../types/transaction.js';
import { mintContractId, contractIdCollisionEntry } from '../contracts/mint.js';

/**
 * Drop every contract whose `yearsRemaining` is 0. The corresponding
 * players become free agents — `teamId` and `contractId` cleared, and
 * they are removed from their old team's roster.
 *
 * Caller must have already decremented `yearsRemaining` for the season
 * just played; this function only consumes the post-decrement state.
 */
export function applyContractExpirations(league: LeagueState): LeagueState {
  const expired: Contract[] = [];
  for (const contract of Object.values(league.contracts)) {
    if (contract.yearsRemaining <= 0) expired.push(contract);
  }
  if (expired.length === 0) return league;

  const playersNext: Record<string, Player> = { ...league.players };
  const contractsNext: Record<string, Contract> = { ...league.contracts };
  const removalsByTeam = new Map<TeamId, Set<PlayerId>>();
  const voidChargesByTeam = new Map<TeamId, number>();
  const logEntries: Transaction[] = [];

  for (const contract of expired) {
    const player = playersNext[contract.playerId];
    delete contractsNext[contract.id];
    // The VOID-YEAR hit (v0.176): a deal that prorated its bonus across
    // void years still owes the unamortized share when the real years run
    // out — it accelerates onto the signing team's CURRENT year (this runs
    // post-finalize, so [0] is the new league year, matching the real
    // March void-day charge). Charged to the obligated club whether or not
    // the player object survived retirement pruning.
    const voidCharge = contract.voidYears > 0 ? unamortizedSigningBonus(contract) : 0;
    if (voidCharge > 0) {
      voidChargesByTeam.set(
        contract.teamId,
        (voidChargesByTeam.get(contract.teamId) ?? 0) + voidCharge,
      );
    }
    if (!player) continue; // retired or otherwise gone
    if (player.teamId) {
      const team = league.teams[player.teamId];
      const wasOnActive = team?.rosterIds.includes(player.id) ?? false;
      logEntries.push({
        kind: 'contract-expiration',
        tick: league.tick,
        seasonNumber: league.seasonNumber,
        teamId: player.teamId,
        playerId: player.id,
        contractId: contract.id,
        fromActiveRoster: wasOnActive,
        ...(voidCharge > 0 ? { voidDeadMoney: voidCharge } : {}),
      });
      const set = removalsByTeam.get(player.teamId) ?? new Set<PlayerId>();
      set.add(player.id);
      removalsByTeam.set(player.teamId, set);
    }
    playersNext[contract.playerId] = {
      ...player,
      teamId: null,
      contractId: null,
    };
  }

  const teamsNext: Record<string, TeamState> = { ...league.teams };
  for (const [teamId, removals] of removalsByTeam) {
    const team = teamsNext[teamId];
    if (!team) continue;
    // Filter both rosterIds AND practiceSquadIds — an expired player may
    // have been on either list. Filtering both is cheap and keeps PS
    // contract churn coherent without a separate code path.
    teamsNext[teamId] = {
      ...team,
      rosterIds: team.rosterIds.filter((id) => !removals.has(id)),
      practiceSquadIds: team.practiceSquadIds.filter((id) => !removals.has(id)),
    };
  }
  for (const [teamId, charge] of voidChargesByTeam) {
    const team = teamsNext[teamId];
    if (!team) continue;
    const deadMoneyByYear = [...team.deadMoneyByYear];
    deadMoneyByYear[0] = (deadMoneyByYear[0] ?? 0) + charge;
    teamsNext[teamId] = { ...team, deadMoneyByYear };
  }

  return {
    ...league,
    teams: teamsNext as Readonly<Record<TeamId, TeamState>>,
    players: playersNext as Readonly<Record<PlayerId, Player>>,
    contracts: contractsNext as Readonly<Record<ContractIdType, Contract>>,
    transactionLog: [...league.transactionLog, ...logEntries],
  };
}

/**
 * For every team currently over the salary cap, repeatedly release the
 * player whose cut yields the largest *positive* cap saving
 * (`currentCapHit - deadMoney`) until the team is back under the cap or
 * no positive-saving cuts remain.
 *
 * Released players join the free-agent pool with their dead money
 * accruing to the team's current-year `deadMoneyByYear[0]`.
 */
export function applyCapCuts(league: LeagueState): LeagueState {
  let working = league;

  for (const teamId of Object.keys(league.teams) as TeamId[]) {
    while (true) {
      const team = working.teams[teamId]!;
      const usage = teamCapUsage(team, working);
      if (usage <= working.salaryCap) break;

      const candidate = pickCapCutCandidate(team, working);
      if (!candidate) break;

      working = applyCapCutRelease(
        working,
        teamId,
        candidate.playerId,
        candidate.deadMoney,
        candidate.deadMoneyDeferred,
        candidate.saving,
      );
    }
  }
  return working;
}

/**
 * Cap-compliance pass with MINIMAL casualties (v0.148). `applyCapCuts`
 * sheds the largest positive saving first — right for a team $40M over,
 * but a team nudged $0.5M over (rookie contracts land with no rookie-pool
 * reservation; an un-cap-checked trade) would dump a star for pocket
 * change. Real cutdown casualties are the cheapest sufficient vet: cut
 * the SMALLEST positive saving that clears the overage alone, falling
 * back to the largest when no single cut suffices.
 *
 * ⚠️ NOT TO BE CONFUSED with `npc-ai/cap-casualty.ts`'s `applyCapCasualties`
 * (`CAP_CASUALTY.md`) — that is a VALUE decision (is this contract worth its
 * price, evaluated regardless of cap room) that runs first, every offseason.
 * This is a cap-PRESSURE compliance backstop (is this team over the cap right
 * now) that only fires when `applyCapCuts` already left a team over. Adjacent
 * names, different mechanics: this one is always cap-gated; the other never is.
 */
export function applyMinimalCapCasualties(
  league: LeagueState,
  protectedPlayerIds?: ReadonlySet<PlayerId>,
): LeagueState {
  let working = league;
  for (const teamId of Object.keys(league.teams) as TeamId[]) {
    // Fix B guard 2 (below) only needs to run once per team, against the
    // pre-cut roster — not re-checked after every cut. Its candidate list
    // is reused for that same iteration's pick (perf, W2 2026-09-09): the
    // state hasn't changed since the guard computed it, so recomputing
    // would be an exact duplicate. Cleared after use — every later
    // iteration's state has changed and must recompute fresh.
    let checkedBound = false;
    let unspentBoundCandidates: readonly CutCandidate[] | null = null;
    while (true) {
      const team = working.teams[teamId]!;
      const over = teamCapUsage(team, working) - working.salaryCap;
      if (over <= 0) break;

      // Fix B guard 1 (ROSTER_FLOOR.md §17.7/§17.15, Sonnet 2026-09-09):
      // never strip a roster below the 53-man floor for partial credit —
      // a compliance pass that fields fewer than 53 has traded one
      // league-rule breach for a worse one. The team is left over cap;
      // logged loudly rather than silently continuing.
      if (team.rosterIds.length <= 53) {
        working = logCapComplianceUnclearable(working, teamId, over, 'floor');
        break;
      }

      // Fix B guard 2: the sum of every remaining candidate's individually-
      // hypothesized positive saving is an upper bound on what ANY cut
      // sequence can ever recover (not exact after real sequential cuts —
      // Top-51 promotion can shift a later candidate's true saving — which
      // is exactly why it's used only to detect "definitely doomed," never
      // to predict the actual recovered total). Below the overage, the
      // whole sequence is guaranteed-partial credit — stop before the
      // first cut instead of stripping the roster to get there anyway.
      if (!checkedBound) {
        checkedBound = true;
        const candidates = positiveSavingCandidates(team, working, protectedPlayerIds);
        const bound = candidates.reduce((sum, c) => sum + c.saving, 0);
        if (bound < over) {
          working = logCapComplianceUnclearable(working, teamId, over, 'bound');
          break;
        }
        unspentBoundCandidates = candidates;
      }

      // Roster-aware target (v0.178.1, the adv-trajectory full-gate find):
      // a compliance cut that leaves the team short of 53 must ALSO free
      // room for the vet-minimum backfill(s), or the roster strands below
      // 53 for the whole season (FA left one team cap-pinned at 49, the
      // draft filled to 53 but over the cap, the old smallest-sufficient
      // cut got compliant at 52 with $0.1M room — and nothing refills
      // after the post-draft compliance pass without this).
      const shortAfterCut = Math.max(0, 53 - (team.rosterIds.length - 1));
      const target = over + shortAfterCut * leagueMinimumSalary(working.salaryCap);
      const candidate = unspentBoundCandidates
        ? selectFromCandidates(unspentBoundCandidates, target)
        : pickMinimalCasualty(team, working, target, protectedPlayerIds);
      unspentBoundCandidates = null;
      if (!candidate) break;
      working = applyCapCutRelease(
        working,
        teamId,
        candidate.playerId,
        candidate.deadMoney,
        candidate.deadMoneyDeferred,
        candidate.saving,
      );
    }
  }
  return working;
}

/** Record Fix B's loud bail (ROSTER_FLOOR.md §17.15/§17.19). */
function logCapComplianceUnclearable(
  league: LeagueState,
  teamId: TeamId,
  overage: number,
  reason: 'bound' | 'floor',
): LeagueState {
  const team = league.teams[teamId]!;
  const entry: Transaction = {
    kind: 'cap-compliance-unclearable',
    tick: league.tick,
    seasonNumber: league.seasonNumber,
    teamId,
    rosterSize: team.rosterIds.length,
    overage,
    reason,
  };
  return { ...league, transactionLog: [...league.transactionLog, entry] };
}

/**
 * Vet-minimum fill-up to 53 as a standalone pass (v0.178.1) — the same
 * backstop `refillRosters` runs after its auction, exported so
 * POST_DRAFT_ROSTER can restore any team the compliance cuts left short
 * (see `applyMinimalCapCasualties`' roster-aware target, which frees the
 * room this pass spends). Deterministic: tier/skill-ordered pool,
 * most-depleted team first.
 */
export function applyVetMinFillUp(league: LeagueState, signedOnTick: number): LeagueState {
  let working = league;
  let counter = 0;
  for (const playerId of sortedFreeAgentPool(working)) {
    const player = working.players[playerId];
    if (!player || player.teamId !== null) continue;
    const teamId = pickFillUpTeam(working);
    if (!teamId) break; // no team has space + min-cap-room remaining
    const team = working.teams[teamId]!;
    // Distinct suffix from refillRosters' `_FAmin` — same season, same
    // counter values would collide on ContractIds otherwise.
    const idSuffix = `${team.identity.abbreviation}_FAminPD${working.seasonNumber}_${counter++}`;
    working = signMinimumTo(working, teamId, playerId, idSuffix, signedOnTick);
  }
  return working;
}

/**
 * Every roster member whose hypothetical cut shows a positive TRUE saving
 * (recomputed via `teamCapUsage` on a hypothetical roster, not `hit − dead`
 * — the naive form is wrong under the offseason Top-51 rule: cutting a
 * below-the-line contract saves nothing while ADDING dead money, and
 * cutting a counted contract promotes the 52nd hit into the count). Shared
 * by `pickMinimalCasualty` (pick one) and Fix B's unclearable-overage bound
 * (`ROSTER_FLOOR.md` §17.15/§17.19 — sum all of them).
 */
function positiveSavingCandidates(
  team: TeamState,
  league: LeagueState,
  protectedPlayerIds?: ReadonlySet<PlayerId>,
): CutCandidate[] {
  const usageNow = teamCapUsage(team, league);
  // Shared everywhere this runs: the Week-1 boundary call is always
  // pre-June-1, but roster-floor's mid-season fringe cut (rung 2) is not —
  // deriving this from `league.phase` rather than hardcoding it is what
  // makes that engagement split correctly with no separate code path (§18.5).
  const postJune1 = !isOffseasonPhase(league.phase);
  const candidates: CutCandidate[] = [];
  for (const playerId of team.rosterIds) {
    if (protectedPlayerIds?.has(playerId)) continue;
    const player = league.players[playerId];
    if (!player || !player.contractId) continue;
    const contract = league.contracts[player.contractId];
    if (!contract) continue;
    const split = splitDeadMoney(contract, deadMoneyOnPreJune1Release(contract), postJune1);
    const hypo: TeamState = {
      ...team,
      rosterIds: team.rosterIds.filter((id) => id !== playerId),
      deadMoneyByYear: addToYear(team.deadMoneyByYear, 0, split.currentYear),
    };
    const saving = usageNow - teamCapUsage(hypo, league);
    if (saving <= 0) continue;
    candidates.push({
      playerId,
      deadMoney: split.currentYear,
      deadMoneyDeferred: split.nextYear,
      saving,
    });
  }
  return candidates;
}

export function pickMinimalCasualty(
  team: TeamState,
  league: LeagueState,
  over: number,
  protectedPlayerIds?: ReadonlySet<PlayerId>,
): CutCandidate | null {
  return selectFromCandidates(positiveSavingCandidates(team, league, protectedPlayerIds), over);
}

/** The smallest-sufficient-or-largest pick, over an already-computed candidate list. */
function selectFromCandidates(
  candidates: readonly CutCandidate[],
  over: number,
): CutCandidate | null {
  let smallestSufficient: CutCandidate | null = null;
  let largest: CutCandidate | null = null;
  for (const cand of candidates) {
    if (
      cand.saving >= over &&
      (!smallestSufficient ||
        cand.saving < smallestSufficient.saving ||
        (cand.saving === smallestSufficient.saving && cand.playerId < smallestSufficient.playerId))
    ) {
      smallestSufficient = cand;
    }
    if (
      !largest ||
      cand.saving > largest.saving ||
      (cand.saving === largest.saving && cand.playerId < largest.playerId)
    ) {
      largest = cand;
    }
  }
  return smallestSufficient ?? largest;
}

export interface CutCandidate {
  playerId: PlayerId;
  /** Current-year dead money this cut charges. */
  deadMoney: number;
  /**
   * Post-June-1 rule (§18.5): the remainder deferred to next year's cap.
   * Always 0 for the offseason candidates this file produces; roster-floor's
   * mid-season fringe cut is the one caller that can see it non-zero.
   */
  deadMoneyDeferred: number;
  saving: number;
}

function pickCapCutCandidate(team: TeamState, league: LeagueState): CutCandidate | null {
  const postJune1 = !isOffseasonPhase(league.phase);
  let best: CutCandidate | null = null;
  for (const playerId of team.rosterIds) {
    const player = league.players[playerId];
    if (!player || !player.contractId) continue;
    const contract = league.contracts[player.contractId];
    if (!contract) continue;
    const split = splitDeadMoney(contract, deadMoneyOnPreJune1Release(contract), postJune1);
    const saving = currentCapHit(contract) - split.currentYear;
    if (saving <= 0) continue;
    if (!best || saving > best.saving || (saving === best.saving && playerId < best.playerId)) {
      best = { playerId, deadMoney: split.currentYear, deadMoneyDeferred: split.nextYear, saving };
    }
  }
  return best;
}

/**
 * Release primitive shared by every cap-cut caller in this file, and (v0.193,
 * `CAP_CASUALTY.md` §7.2) by `npc-ai/cap-casualty.ts`. Mirrors
 * transactions/release.ts but precomputes the dead money so the
 * candidate-picker isn't recomputing. `flags` is spread into the logged
 * `cap-cut` transaction (`forFloor`/`capCasualty`) — bit-identical to the
 * prior `applyRelease` when omitted.
 */
export function applyCapCutRelease(
  league: LeagueState,
  teamId: TeamId,
  playerId: PlayerId,
  deadMoney: number,
  deadMoneyDeferred: number,
  saving: number,
  flags?: { forFloor?: true; capCasualty?: true },
): LeagueState {
  const team = league.teams[teamId]!;
  const player = league.players[playerId]!;
  const contractId = player.contractId!;

  const teamsNext = {
    ...league.teams,
    [teamId]: {
      ...team,
      rosterIds: team.rosterIds.filter((id) => id !== playerId),
      deadMoneyByYear:
        deadMoneyDeferred > 0
          ? addToYear(addToYear(team.deadMoneyByYear, 0, deadMoney), 1, deadMoneyDeferred)
          : addToYear(team.deadMoneyByYear, 0, deadMoney),
    },
  } as Readonly<Record<TeamId, TeamState>>;

  const playersNext = {
    ...league.players,
    [playerId]: { ...player, teamId: null, contractId: null },
  } as Readonly<Record<PlayerId, Player>>;

  const contractsNext: Record<string, Contract> = { ...league.contracts };
  delete contractsNext[contractId];

  const entry: Transaction = {
    kind: 'cap-cut',
    tick: league.tick,
    seasonNumber: league.seasonNumber,
    teamId,
    playerId,
    contractId,
    deadMoney,
    ...(deadMoneyDeferred > 0 ? { deadMoneyDeferred } : {}),
    capSaving: saving,
    ...flags,
  };

  return {
    ...league,
    teams: teamsNext,
    players: playersNext,
    contracts: contractsNext as Readonly<Record<ContractIdType, Contract>>,
    transactionLog: [...league.transactionLog, entry],
  };
}

/**
 * Run the offseason free-agent market. Each available FA — sorted in
 * tier order (STAR → FRINGE), then by skill within tier — goes through
 * `auctionFreeAgent`, a second-price bidding pass where every team
 * computes a cash valuation (scheme fit × positional need × cap room)
 * and a player-preference multiplier (personality + market size +
 * owner/HC quirks). The winner is whoever maximises `cash × preference`;
 * the price is the runner-up's cash valuation plus a 2% nudge, capped
 * at the winner's own valuation. A lone bidder gets the player at 85%
 * of their valuation (the single-bidder discount).
 *
 * If no team has roster space, positional need, AND cap room for any
 * positive bid, the FA falls through to a **fill-up** pass that signs
 * them to a 1-year veteran-minimum deal at the most-depleted team with
 * room — guaranteeing rosters approach 53 even when scheme/need/cap
 * pinches in the auction.
 */
/**
 * The D7 seam: free agency as a stepped, wave-resolved session
 * (`D7_FA_SEAM.md`, approved 2026-09-14).
 *
 * `refillRosters` below is now a thin loop over `stepFreeAgency`, exactly as
 * `runDraft` is a thin loop over `stepDraft`. That is the load-bearing safety
 * property: **one implementation of the market, not two that can drift**, so
 * NPC-only behaviour is identical by construction rather than by a coincidence
 * a test has to police.
 *
 * ## Waves are pause points, NOT a change to resolution order
 *
 * The pool is already tier-sorted (`compareForSigning`: STAR → STARTER →
 * BACKUP → FRINGE), so wave boundaries exist for free. A wave boundary is a
 * place the loop can YIELD; it does not reorder anything, does not re-sort the
 * pool, and does not recompute `starterCaliberIds`.
 *
 * That last point is the specific hazard the design named. `starterCaliberIds`
 * is computed ONCE for the whole FA period with an explicit PERF note, and
 * `orderedPool` likewise. Both live on the session and are `readonly`, so
 * re-entering a yielded wave cannot rebuild either — which would have changed
 * every downstream auction.
 */

/** One wave of the market. Tiers, because the pool is already sorted by them. */
export type FaWave = Player['tier'];

/** An offer supplied from outside the NPC AI (the D7 seam). */
export interface FaOffer {
  playerId: PlayerId;
  /** The most this club will pay, in cash terms — the same units NPC bids use. */
  maxCash: number;
  /**
   * Lower goes first. Offers are entered in priority order and only while the
   * club still has room, so a GM who bids on more talent than they can afford
   * signs down their board and stops rather than blowing the cap.
   */
  priority: number;
}

export type FaStep =
  | { kind: 'wave-open'; wave: FaWave; availablePlayerIds: readonly PlayerId[] }
  | { kind: 'signing'; playerId: PlayerId; teamId: TeamId; wave: FaWave }
  | { kind: 'unsigned'; playerId: PlayerId; wave: FaWave }
  | { kind: 'wave-closed'; wave: FaWave }
  | { kind: 'fill-up'; playerId: PlayerId; teamId: TeamId }
  | { kind: 'complete' };

/**
 * A free-agency period in progress. Mutable by design and shared by the batch
 * and stepped paths — the same reasoning as `DraftSession`.
 *
 * Treat as opaque: the exported functions are the API.
 */
export interface FaSession {
  /** @internal */ working: LeagueState;
  /** @internal The pool, computed ONCE. Never re-sorted. */
  readonly orderedPool: readonly PlayerId[];
  /** @internal Computed ONCE for the period — see starter-caliber.ts's PERF note. */
  readonly starterCaliberIds: ReadonlySet<PlayerId>;
  /** @internal Tier of each pooled player, captured up front so a signing cannot shift wave boundaries. */
  readonly waveOf: ReadonlyMap<string, FaWave>;
  /** @internal */ readonly signedOnTick: number;
  /** @internal */ readonly externallyControlled: ReadonlySet<TeamId>;
  /** @internal Offers by team, already priority-sorted. */
  readonly offers: Map<string, FaOffer[]>;
  /** @internal */ index: number;
  /** @internal Shared across BOTH passes, exactly as the original loop did. */
  signCounter: number;
  /** @internal */ stillUnsigned: PlayerId[];
  /** @internal */ fillIndex: number;
  /** @internal */ phase: 'auction' | 'fill-up' | 'done';
  /** @internal The wave currently open, so open/close events fire once each. */
  openWave: FaWave | null;
}

export interface BeginFreeAgencyOptions {
  signedOnTick: number;
  /**
   * Clubs whose bids are SUPPLIED rather than COMPUTED. They get no advantage,
   * no extra information and no different rules — the same auction, pricing and
   * cap. Empty in batch mode, which is what keeps `refillRosters` identical.
   */
  externallyControlledTeamIds?: readonly TeamId[];
}

export function beginFreeAgency(
  league: LeagueState,
  options: BeginFreeAgencyOptions,
): FaSession {
  const orderedPool = sortedFreeAgentPool(league);
  // Talent Allocation Track 1 (2026-08-04/05): computed ONCE for the whole
  // FA period, not per free agent — see starter-caliber.ts's PERF note.
  // Reflects the roster census entering FA (post-trades/cuts); it does not
  // update as players sign during this loop, same convention as the
  // blueprint-count maps computed once per offseason elsewhere.
  const starterCaliberIds = computeStarterCaliberIds(Object.values(league.players));

  // Tier captured up front: a player's tier is stable, but reading it from
  // `working` mid-period would couple wave boundaries to signing order.
  const waveOf = new Map<string, FaWave>();
  for (const id of orderedPool) {
    const p = league.players[id];
    if (p) waveOf.set(String(id), p.tier);
  }

  return {
    working: league,
    orderedPool,
    starterCaliberIds,
    waveOf,
    signedOnTick: options.signedOnTick,
    externallyControlled: new Set(options.externallyControlledTeamIds ?? []),
    offers: new Map(),
    index: 0,
    signCounter: 0,
    stillUnsigned: [],
    fillIndex: 0,
    phase: 'auction',
    openWave: null,
  };
}

/** True once both the auction sweep and the fill-up pass have run out. */
export function isFreeAgencyComplete(session: FaSession): boolean {
  return session.phase === 'done';
}

/**
 * Supply a club's offers for the open wave.
 *
 * Offers are per-wave and expire with it: an offer targets a specific player
 * who is signed or not by the time the wave closes, so there is nothing to
 * carry forward. What carries is cap room, which a losing bid never spent.
 */
export function submitOffers(
  session: FaSession,
  teamId: TeamId,
  offers: readonly FaOffer[],
): void {
  const sorted = [...offers].sort((a, b) => a.priority - b.priority);
  session.offers.set(String(teamId), sorted);
}

/** Still-unsigned players in the given wave, in pool order. */
function availableInWave(session: FaSession, wave: FaWave): readonly PlayerId[] {
  const out: PlayerId[] = [];
  for (let i = session.index; i < session.orderedPool.length; i++) {
    const id = session.orderedPool[i]!;
    if (session.waveOf.get(String(id)) !== wave) break;
    const player = session.working.players[id];
    if (player && player.teamId === null) out.push(id);
  }
  return out;
}

/**
 * The supplied bids that should be entered for this player, as extra entries in
 * the auction's bid table.
 *
 * A club's offer is only entered while it still has room for it — the same
 * condition an NPC bidder faces. That is what stops a batched wave from letting
 * a GM win five stars they cannot pay for: they sign down their priority order
 * and stop.
 */
function suppliedBidsFor(session: FaSession, playerId: PlayerId): SuppliedBid[] {
  if (session.offers.size === 0) return [];
  const out: SuppliedBid[] = [];
  for (const [teamIdStr, offers] of session.offers) {
    const teamId = teamIdStr as TeamId;
    const offer = offers.find((o) => String(o.playerId) === String(playerId));
    if (!offer) continue;
    const team = session.working.teams[teamId];
    if (!team) continue;
    const capRoom = session.working.salaryCap - teamCapUsage(team, session.working);
    if (capRoom < offer.maxCash) continue; // no room: not entered, as for any club
    out.push({ teamId, cash: offer.maxCash, capRoom });
  }
  return out;
}

/**
 * Advance the market by one event.
 *
 * With no supplied offers this walks the identical sequence the original single
 * loop did: same pool, same order, same `auctionFreeAgent` calls, same shared
 * `signCounter`, same single fill-up pass at the end. The wave events are pure
 * yields that touch nothing.
 */
export function stepFreeAgency(session: FaSession): FaStep {
  if (session.phase === 'done') return { kind: 'complete' };

  if (session.phase === 'auction') {
    // Close the wave that just finished, then open the next one — each fires
    // exactly once per wave.
    if (session.index >= session.orderedPool.length) {
      if (session.openWave !== null) {
        const closed = session.openWave;
        session.openWave = null;
        return { kind: 'wave-closed', wave: closed };
      }
      session.phase = 'fill-up';
      return stepFreeAgency(session);
    }

    const playerId = session.orderedPool[session.index]!;
    const wave = session.waveOf.get(String(playerId)) ?? 'FRINGE';

    if (session.openWave !== wave) {
      if (session.openWave !== null) {
        const closed = session.openWave;
        session.openWave = null;
        return { kind: 'wave-closed', wave: closed };
      }
      session.openWave = wave;
      return { kind: 'wave-open', wave, availablePlayerIds: availableInWave(session, wave) };
    }

    session.index++;
    const player = session.working.players[playerId];
    if (!player || player.teamId !== null) return stepFreeAgency(session);

    const auction = auctionFreeAgent(
      session.working,
      player,
      session.starterCaliberIds,
      suppliedBidsFor(session, playerId),
    );
    if (auction.winnerTeamId) {
      const team = session.working.teams[auction.winnerTeamId]!;
      const idSuffix = `${team.identity.abbreviation}_FA${session.working.seasonNumber}_${session.signCounter++}`;
      session.working = signAuctionWinner(
        session.working,
        auction.winnerTeamId,
        playerId,
        idSuffix,
        session.signedOnTick,
        auction.valuationMultiplier,
        auction.runnersUp,
        auction.bidders,
      );
      return { kind: 'signing', playerId, teamId: auction.winnerTeamId, wave };
    }
    session.stillUnsigned.push(playerId);
    return { kind: 'unsigned', playerId, wave };
  }

  // Fill-up pass: any FA still unsigned takes a vet-minimum deal at the
  // most-depleted team that has roster space and at least minimum cap room.
  while (session.fillIndex < session.stillUnsigned.length) {
    const playerId = session.stillUnsigned[session.fillIndex++]!;
    const player = session.working.players[playerId];
    if (!player || player.teamId !== null) continue;

    const teamId = pickFillUpTeam(session.working);
    if (!teamId) break; // no team has space + min-cap-room remaining

    const team = session.working.teams[teamId]!;
    const idSuffix = `${team.identity.abbreviation}_FAmin${session.working.seasonNumber}_${session.signCounter++}`;
    session.working = signMinimumTo(
      session.working,
      teamId,
      playerId,
      idSuffix,
      session.signedOnTick,
    );
    return { kind: 'fill-up', playerId, teamId };
  }

  session.phase = 'done';
  return { kind: 'complete' };
}

/** The league with this period's signings folded in. */
export function finishFreeAgency(session: FaSession): LeagueState {
  return session.working;
}

/**
 * Sign every remaining free agent the NPC market would.
 *
 * Now a thin loop over `stepFreeAgency`, so batch and stepped mode execute the
 * SAME market. Byte-identity with the pre-D7 implementation is therefore a
 * property of there being one implementation, not of two agreeing.
 */
export function refillRosters(league: LeagueState, signedOnTick: number): LeagueState {
  const session = beginFreeAgency(league, { signedOnTick });
  while (!isFreeAgencyComplete(session)) {
    stepFreeAgency(session);
  }
  return finishFreeAgency(session);
}

/**
 * Build the ordered FA pool: tier-major (STAR best), then skill-summary
 * descending, then PlayerId for deterministic tiebreak.
 */
export function sortedFreeAgentPool(league: LeagueState): readonly PlayerId[] {
  const pool: PlayerId[] = [];
  for (const player of Object.values(league.players)) {
    if (player.teamId !== null) continue;
    pool.push(player.id);
  }
  pool.sort((a, b) => compareForSigning(league.players[a]!, league.players[b]!));
  return pool;
}

const TIER_RANK: Record<Player['tier'], number> = {
  STAR: 0,
  STARTER: 1,
  BACKUP: 2,
  FRINGE: 3,
};

function compareForSigning(a: Player, b: Player): number {
  const t = TIER_RANK[a.tier] - TIER_RANK[b.tier];
  if (t !== 0) return t;
  const sa = skillSummary(a);
  const sb = skillSummary(b);
  if (sa !== sb) return sb - sa;
  return a.id < b.id ? -1 : 1;
}

function skillSummary(player: Player): number {
  const s = player.current;
  return (
    s.technicalSkill +
    s.footballIq +
    s.speed +
    s.strength +
    s.decisionMaking
  );
}

/**
 * Pick a team for the fill-up pass: most under-53, with at least
 * league-minimum cap room. Ignores scheme and positional fit.
 */
function pickFillUpTeam(league: LeagueState): TeamId | null {
  let bestId: TeamId | null = null;
  let bestDeficit = -Infinity;

  for (const team of Object.values(league.teams)) {
    if (team.rosterIds.length >= 53) continue;
    const capRoom = league.salaryCap - teamCapUsage(team, league);
    if (capRoom < leagueMinimumSalary(league.salaryCap)) continue;
    const deficit = 53 - team.rosterIds.length;
    if (
      deficit > bestDeficit ||
      (deficit === bestDeficit && (bestId === null || team.identity.id < bestId))
    ) {
      bestDeficit = deficit;
      bestId = team.identity.id;
    }
  }
  return bestId;
}

/**
 * Sign an auction-winning team to the FA at a deal scaled by the
 * auction outcome. The tier-shape (years, signing-bonus split,
 * guarantee depth) is preserved; only base salary and signing bonus
 * scale with `valuationMultiplier`. Runners-up land on the resulting
 * `fa-sign` transaction so the news feed can surface lost-out interest.
 */
function signAuctionWinner(
  league: LeagueState,
  teamId: TeamId,
  playerId: PlayerId,
  idSuffix: string,
  signedOnTick: number,
  valuationMultiplier: number,
  runnersUp: readonly TeamId[],
  bidders: readonly FaBidderDetail[],
): LeagueState {
  const player = league.players[playerId]!;
  const team = league.teams[teamId]!;
  const contract = makeFreeAgentContract(
    player,
    teamId,
    idSuffix,
    signedOnTick,
    valuationMultiplier,
    league.salaryCap,
  );
  // FaBidderDetail (auction module) and FaSignBidder (transaction
  // type) are structurally identical — copy across to keep the
  // transaction type free of an inbound dependency on the auction
  // module.
  const txnBidders: FaSignBidder[] = bidders.map((b) => ({
    teamId: b.teamId,
    cashValuation: b.cashValuation,
    cashValuationBaseline: b.cashValuationBaseline,
    preferenceMultiplier: b.preferenceMultiplier,
    perceivedBid: b.perceivedBid,
    capRoomAtTime: b.capRoomAtTime,
    preferenceFactors: { ...b.preferenceFactors },
    watchListMultiplier: b.watchListMultiplier,
    watchListPriority: b.watchListPriority,
    watchListReason: b.watchListReason,
  }));
  return mergeSigning(league, team, player, contract, runnersUp, txnBidders);
}

/**
 * Sign a free agent to a 1-year league-minimum deal — used only by the
 * fill-up pass when a team has no positional need or insufficient cap
 * room for the FA's tier deal.
 */
function signMinimumTo(
  league: LeagueState,
  teamId: TeamId,
  playerId: PlayerId,
  idSuffix: string,
  signedOnTick: number,
): LeagueState {
  const player = league.players[playerId]!;
  const team = league.teams[teamId]!;
  const contract: Contract = {
    id: ContractId(`C_${idSuffix}`),
    playerId: player.id,
    teamId,
    signedOnTick,
    realYears: 1,
    voidYears: 0,
    yearsRemaining: 1,
    baseSalaries: [leagueMinimumSalary(league.salaryCap)],
    signingBonus: 0,
    rosterBonuses: [0],
    workoutBonuses: [0],
    guarantees: [{ baseGuaranteedPct: 0, type: 'NONE' }],
    incentives: [],
    noTradeClause: false,
  };
  return mergeSigning(league, team, player, contract);
}

function mergeSigning(
  league: LeagueState,
  team: TeamState,
  player: Player,
  contractIn: Contract,
  runnersUp: readonly TeamId[] = [],
  bidders: readonly FaSignBidder[] = [],
): LeagueState {
  // Fix 2 (§14): the shared insertion point for BOTH of this file's signing
  // paths (auction-priced `makeFreeAgentContract` and the inline minimum
  // fill) — resolve here, before either the map write or the contractId
  // stamp, so a single guard covers both.
  const minted = mintContractId(league.contracts, contractIn.id);
  const contract: Contract =
    minted.collision === undefined ? contractIn : { ...contractIn, id: minted.id };
  const entry: Transaction = {
    kind: 'fa-sign',
    tick: contract.signedOnTick,
    seasonNumber: league.seasonNumber,
    teamId: team.identity.id,
    playerId: player.id,
    contractId: contract.id,
    yearOneCapHit: currentCapHit(contract),
    marketContract: contract.realYears > 1 || contract.signingBonus > 0,
    phaseAtSigning: league.phase,
    ...(runnersUp.length > 0 ? { runnersUp } : {}),
    ...(bidders.length > 0 ? { bidders } : {}),
  };
  const collisionEntry = contractIdCollisionEntry(minted, {
    tick: contract.signedOnTick,
    seasonNumber: league.seasonNumber,
    teamId: team.identity.id,
    playerId: player.id,
  });
  return {
    ...league,
    teams: {
      ...league.teams,
      [team.identity.id]: { ...team, rosterIds: [...team.rosterIds, player.id] },
    } as Readonly<Record<TeamId, TeamState>>,
    players: {
      ...league.players,
      [player.id]: { ...player, teamId: team.identity.id, contractId: contract.id },
    } as Readonly<Record<PlayerId, Player>>,
    contracts: {
      ...league.contracts,
      [contract.id]: contract,
    } as Readonly<Record<ContractIdType, Contract>>,
    transactionLog: collisionEntry
      ? [...league.transactionLog, entry, collisionEntry]
      : [...league.transactionLog, entry],
  };
}
