import { describe, expect, it } from 'vitest';
import { createLeague } from '../league/generate.js';
import { simulateSeason } from '../season/runner.js';
import { advanceSeason } from '../season/advance.js';
import { applyCapCasualties, evaluateCapCasualty } from './cap-casualty.js';
import { positionScaledStandardY1, TIER_STANDARD_Y1 } from '../transactions/fa-bidding.js';
import { FA_DEAL_BY_TIER } from '../transactions/free-agency.js';
import { teamCapUsage } from '../contracts/cap.js';
import { Position } from '../types/enums.js';
import type { LeagueState } from '../types/league.js';
import type { Contract } from '../types/contract.js';
import type { Player } from '../types/player.js';
import type { Transaction } from '../types/transaction.js';
import type { PlayerId, TeamId } from '../types/ids.js';
import { ContractId } from '../types/ids.js';

type CapCutTx = Extract<Transaction, { kind: 'cap-cut' }>;
function isCapCut(t: Transaction): t is CapCutTx {
  return t.kind === 'cap-cut';
}

/**
 * A contract with a flat per-year base salary and (optionally) a signing
 * bonus, mirroring `franchise-tag.test.ts`'s `dealAt` but exposing the
 * signing bonus and an optional full guarantee on the LAST remaining year —
 * the two knobs this file's fixtures need to control dead money directly.
 */
function contractAt(
  id: string,
  playerId: PlayerId,
  teamId: TeamId,
  realYears: number,
  yearsRemaining: number,
  baseSalary: number,
  signingBonus: number,
  guaranteeCurrentYear = false,
): Contract {
  const yearOfDeal = realYears - yearsRemaining;
  return {
    id: ContractId(id),
    playerId,
    teamId,
    signedOnTick: 0,
    realYears,
    voidYears: 0,
    yearsRemaining,
    baseSalaries: Array(realYears).fill(baseSalary) as number[],
    signingBonus,
    rosterBonuses: Array(realYears).fill(0) as number[],
    workoutBonuses: Array(realYears).fill(0) as number[],
    guarantees: Array.from({ length: realYears }, (_, y) =>
      guaranteeCurrentYear && y === yearOfDeal
        ? { baseGuaranteedPct: 1, type: 'FULLY_GUARANTEED' as const }
        : { baseGuaranteedPct: 0, type: 'NONE' as const },
    ),
    incentives: [],
    noTradeClause: false,
  };
}

/** Overwrite one rostered player's position+tier+contract in a league. */
function pinPlayer(
  league: LeagueState,
  teamId: TeamId,
  playerId: PlayerId,
  position: Position,
  tier: Player['tier'],
  contract: Contract,
): LeagueState {
  const player = league.players[playerId]!;
  return {
    ...league,
    players: {
      ...league.players,
      [playerId]: { ...player, teamId, position, tier, contractId: contract.id },
    } as LeagueState['players'],
    contracts: { ...league.contracts, [contract.id]: contract } as LeagueState['contracts'],
  };
}

/** The open-market APY `evaluateCapCasualty` compares a cap hit against. */
function marketFor(league: LeagueState, position: Position, tier: Player['tier']): number {
  const anyPlayer = Object.values(league.players)[0]!;
  return positionScaledStandardY1({ ...anyPlayer, position, tier }, league);
}

/** Dollar-figure equality tolerant of the engine's internal `Math.round`s. */
function expectDollarsClose(actual: number, expected: number): void {
  expect(Math.abs(actual - expected)).toBeLessThan(10);
}

/**
 * The team with the most cap room in a freshly generated league. Individual
 * seeded teams vary in how close to the cap their 52 OTHER contracts leave
 * them (the whole cap-realism thesis is teams average ~57% usage, not that
 * every single team does) — picking the roomiest one makes "far under the
 * cap" a reliable fixture property instead of a seed-dependent coin flip.
 */
function teamWithMostCapRoom(league: LeagueState): TeamId {
  let best: TeamId | null = null;
  let bestRoom = -Infinity;
  for (const teamId of Object.keys(league.teams) as TeamId[]) {
    const room = league.salaryCap - teamCapUsage(league.teams[teamId]!, league);
    if (room > bestRoom) {
      bestRoom = room;
      best = teamId;
    }
  }
  return best!;
}

describe('evaluateCapCasualty', () => {
  it('fires on a below-market contract even with the team far under the cap', () => {
    const league0 = createLeague({ seed: 'cc-fires' });
    const teamId = teamWithMostCapRoom(league0);
    const team0 = league0.teams[teamId]!;
    const pid = team0.rosterIds[0]!;
    const market = marketFor(league0, Position.LB, 'STARTER');

    // realYears=4, yearsRemaining=2 (year-of-deal 2), signingBonus = 4.8×market
    // so proration/yr = 1.2×market (> market — C1's replacement-cost anchor);
    // unamortized at this point = proration × yearsRemaining = 2.4×market.
    // base = 3×market/yr ⇒ capHit = 3market + 1.2market = 4.2market.
    //   C1: 4.2market > 1.2×market ✓
    //   C2 (pre-June-1, offseason): saving = 4.2market − 2.4market = 1.8market > 0 ✓
    //   C3: dead 2.4market ≥ market ✓
    const contract = contractAt(
      'C_CC_fires',
      pid,
      teamId,
      4,
      2,
      3 * market,
      4.8 * market,
    );
    const league: LeagueState = {
      ...pinPlayer(league0, teamId, pid, Position.LB, 'STARTER', contract),
      phase: 'OFFSEASON_PRE_FA',
    };

    const team = league.teams[teamId]!;
    expect(league.salaryCap - teamCapUsage(team, league)).toBeGreaterThan(50_000_000);

    const evaluation = evaluateCapCasualty(league, league.players[pid]!);
    expect(evaluation).not.toBeNull();
    expectDollarsClose(evaluation!.capHit, 4.2 * market);
    expectDollarsClose(evaluation!.deadMoney, 2.4 * market);
    expect(evaluation!.deadMoneyDeferred).toBe(0);
  });

  it('does NOT fire on a fairly-priced contract even with the team over the cap', () => {
    const league0 = createLeague({ seed: 'cc-fair' });
    const teamId = (Object.keys(league0.teams) as TeamId[])[0]!;
    const team0 = league0.teams[teamId]!;
    const pid = team0.rosterIds[0]!;
    const market = marketFor(league0, Position.WR, 'STAR');

    // capHit == 1.0×market — at the anchor, below the C1 threshold
    // (1.2×market) by construction.
    const contract = contractAt('C_CC_fair', pid, teamId, 4, 3, market, 0);
    let league: LeagueState = {
      ...pinPlayer(league0, teamId, pid, Position.WR, 'STAR', contract),
      phase: 'OFFSEASON_PRE_FA',
    };
    // Force the team over the cap on totally unrelated grounds.
    const team = league.teams[teamId]!;
    league = {
      ...league,
      teams: {
        ...league.teams,
        [teamId]: { ...team, deadMoneyByYear: [league.salaryCap + 50_000_000] },
      } as LeagueState['teams'],
    };
    expect(teamCapUsage(league.teams[teamId]!, league)).toBeGreaterThan(league.salaryCap);

    const evaluation = evaluateCapCasualty(league, league.players[pid]!);
    expect(evaluation).toBeNull();
  });

  it('C2: does not fire when the remaining money is fully sunk', () => {
    const league0 = createLeague({ seed: 'cc-sunk' });
    const teamId = (Object.keys(league0.teams) as TeamId[])[0]!;
    const pid = league0.teams[teamId]!.rosterIds[0]!;
    const market = marketFor(league0, Position.CB, 'STARTER');

    // Last remaining year (yearsRemaining=1), no signing bonus, the whole
    // base salary fully guaranteed — dead == capHit == 2×market, so C1 and
    // C3 both hold but saving is exactly 0.
    const contract = contractAt(
      'C_CC_sunk',
      pid,
      teamId,
      4,
      1,
      2 * market,
      0,
      /* guaranteeCurrentYear */ true,
    );
    const league: LeagueState = {
      ...pinPlayer(league0, teamId, pid, Position.CB, 'STARTER', contract),
      phase: 'OFFSEASON_PRE_FA',
    };

    expect(evaluateCapCasualty(league, league.players[pid]!)).toBeNull();
  });

  it('C3: does not fire on a cheap contract with no unamortized bonus (scope boundary)', () => {
    const league0 = createLeague({ seed: 'cc-cheap' });
    const teamId = (Object.keys(league0.teams) as TeamId[])[0]!;
    const pid = league0.teams[teamId]!.rosterIds[0]!;
    const market = marketFor(league0, Position.S, 'STARTER');

    // capHit = 3×market (comfortably above C1's threshold) but signingBonus
    // is 0 and nothing is guaranteed, so dead money on release is 0 — a
    // roster cut, not a casualty. This is the scope boundary §4.3 draws
    // against `releaseSurplusStarters`/`preseasonCuts`.
    const contract = contractAt('C_CC_cheap', pid, teamId, 4, 2, 3 * market, 0);
    const league: LeagueState = {
      ...pinPlayer(league0, teamId, pid, Position.S, 'STARTER', contract),
      phase: 'OFFSEASON_PRE_FA',
    };

    expect(evaluateCapCasualty(league, league.players[pid]!)).toBeNull();
  });

  it('never touches an expiring contract (yearsRemaining === 0)', () => {
    const league0 = createLeague({ seed: 'cc-expiring' });
    const teamId = (Object.keys(league0.teams) as TeamId[])[0]!;
    const pid = league0.teams[teamId]!.rosterIds[0]!;
    const market = marketFor(league0, Position.LB, 'STARTER');

    const contract = contractAt('C_CC_expiring', pid, teamId, 4, 0, 5 * market, 5 * market);
    const league: LeagueState = {
      ...pinPlayer(league0, teamId, pid, Position.LB, 'STARTER', contract),
      phase: 'OFFSEASON_PRE_FA',
    };

    expect(evaluateCapCasualty(league, league.players[pid]!)).toBeNull();
  });

  it('TIER_STANDARD_Y1 is each tier\'s APY, not a Year-1 cap hit (§4.2 identity)', () => {
    for (const tier of Object.keys(TIER_STANDARD_Y1) as Array<keyof typeof TIER_STANDARD_Y1>) {
      const shape = FA_DEAL_BY_TIER[tier];
      const apy = (shape.baseSalary * shape.realYears + shape.signingBonus) / shape.realYears;
      expect(TIER_STANDARD_Y1[tier]).toBe(apy);
    }
  });
});

describe('applyCapCasualties', () => {
  it('orders cuts within a team by descending surplus', () => {
    const league0 = createLeague({ seed: 'cc-order' });
    const teamId = (Object.keys(league0.teams) as TeamId[])[0]!;
    const team0 = league0.teams[teamId]!;
    const [pidA, pidB] = team0.rosterIds as [PlayerId, PlayerId];
    const market = marketFor(league0, Position.LB, 'STARTER');

    // Both candidates share the same bonus shape (same dead money, 2.4×market)
    // but B's base salary is higher, so B's surplus is larger.
    const dealA = contractAt('C_CC_ordA', pidA, teamId, 4, 2, 3 * market, 4.8 * market);
    const dealB = contractAt('C_CC_ordB', pidB, teamId, 4, 2, 5 * market, 4.8 * market);
    let league: LeagueState = {
      ...pinPlayer(league0, teamId, pidA, Position.LB, 'STARTER', dealA),
      phase: 'OFFSEASON_PRE_FA',
    };
    league = pinPlayer(league, teamId, pidB, Position.LB, 'STARTER', dealB);

    const evalA = evaluateCapCasualty(league, league.players[pidA]!)!;
    const evalB = evaluateCapCasualty(league, league.players[pidB]!)!;
    expect(evalB.surplus).toBeGreaterThan(evalA.surplus);

    const after = applyCapCasualties(league);
    const cuts = after.transactionLog
      .filter(isCapCut)
      .filter((t) => t.playerId === pidA || t.playerId === pidB);
    expect(cuts.map((t) => t.playerId)).toEqual([pidB, pidA]);
    for (const cut of cuts) {
      expect(cut.capCasualty).toBe(true);
    }
  });

  it('respects the post-June-1 split when run in-season', () => {
    const league0 = createLeague({ seed: 'cc-june1' });
    const teamId = (Object.keys(league0.teams) as TeamId[])[0]!;
    const pid = league0.teams[teamId]!.rosterIds[0]!;
    const market = marketFor(league0, Position.LB, 'STARTER');
    const contract = contractAt('C_CC_june1', pid, teamId, 4, 2, 3 * market, 4.8 * market);
    const league: LeagueState = {
      ...pinPlayer(league0, teamId, pid, Position.LB, 'STARTER', contract),
      phase: 'REGULAR_SEASON',
    };

    const preSplitTotal = 2.4 * market; // same total as the offseason fixture above
    const after = applyCapCasualties(league);
    const team = after.teams[teamId]!;
    const cut = after.transactionLog.filter(isCapCut).find((t) => t.playerId === pid);
    expect(cut).toBeDefined();
    expect(cut!.capCasualty).toBe(true);
    const deferred = cut!.deadMoneyDeferred ?? 0;
    expect(deferred).toBeGreaterThan(0);
    expectDollarsClose(cut!.deadMoney + deferred, preSplitTotal);
    expectDollarsClose(team.deadMoneyByYear[1] ?? 0, deferred);
  });

  it('is deterministic — identical input produces identical output', () => {
    const build = (seed: string): LeagueState => {
      const base = createLeague({ seed });
      const teamId = (Object.keys(base.teams) as TeamId[])[0]!;
      const pid = base.teams[teamId]!.rosterIds[0]!;
      const market = marketFor(base, Position.LB, 'STARTER');
      const contract = contractAt('C_CC_determ', pid, teamId, 4, 2, 3 * market, 4.8 * market);
      return {
        ...pinPlayer(base, teamId, pid, Position.LB, 'STARTER', contract),
        phase: 'OFFSEASON_PRE_FA',
      };
    };
    const a = applyCapCasualties(build('cc-determ'));
    const b = applyCapCasualties(build('cc-determ'));
    const cutsA = a.transactionLog.filter(isCapCut).filter((t) => t.capCasualty);
    const cutsB = b.transactionLog.filter(isCapCut).filter((t) => t.capCasualty);
    expect(cutsA).toEqual(cutsB);
  });

  it('does not prevent a settled league from ending the offseason at 53', () => {
    let league = createLeague({ seed: 'cc-integration' });
    for (let season = 1; season <= 2; season++) {
      league = advanceSeason(simulateSeason(league));
    }
    for (const team of Object.values(league.teams)) {
      expect(team.rosterIds.length).toBe(53);
    }
    const violations = league.transactionLog.filter((t) => t.kind === 'roster-floor-violation');
    expect(violations.length).toBe(0);
  });
});
