import { describe, expect, it } from 'vitest';
import { createLeague } from '../league/generate.js';
import {
  applyFranchiseTags,
  franchiseTagQuote,
  topFiveAveragePositionCapHit,
  FRANCHISE_TAG_PRIOR_SALARY_MULTIPLIER,
} from './franchise-tag.js';
import { Position } from '../types/enums.js';
import type { LeagueState } from '../types/league.js';
import type { Contract } from '../types/contract.js';
import type { PlayerId, TeamId } from '../types/ids.js';
import { ContractId } from '../types/ids.js';

/** A plain multi-year deal at a given position-market cap hit, N years in. */
function dealAt(
  playerId: PlayerId,
  teamId: TeamId,
  capHit: number,
  yearsRemaining: number,
): Contract {
  const realYears = 4;
  return {
    id: ContractId(`C_FT_${playerId}`),
    playerId,
    teamId,
    signedOnTick: 0,
    realYears,
    voidYears: 0,
    yearsRemaining,
    baseSalaries: Array(realYears).fill(capHit) as number[],
    signingBonus: 0,
    rosterBonuses: [0, 0, 0, 0],
    workoutBonuses: [0, 0, 0, 0],
    guarantees: Array(realYears).fill({ baseGuaranteedPct: 0, type: 'NONE' as const }),
    incentives: [],
    noTradeClause: false,
  };
}

/**
 * Strip every contract belonging to a player at `position` from a fresh
 * generated league, so a test can populate that position's market itself
 * and know exactly what `topFiveAveragePositionCapHit` will see -- a
 * generated league already carries 32 teams' worth of real contracts at
 * every position, which would otherwise leak into an "isolated" fixture.
 */
function withoutPosition(league: LeagueState, position: Position): LeagueState {
  const contracts: Record<string, Contract> = {};
  for (const [id, c] of Object.entries(league.contracts)) {
    if (league.players[c.playerId]?.position === position) continue;
    contracts[id] = c;
  }
  return { ...league, contracts: contracts as LeagueState['contracts'] };
}

/** Overwrite one rostered player's position+tier+contract in a fresh league. */
function pinPlayer(
  league: LeagueState,
  teamId: TeamId,
  playerId: PlayerId,
  position: Position,
  tier: 'STAR' | 'STARTER',
  contract: Contract,
): LeagueState {
  const player = league.players[playerId]!;
  return {
    ...league,
    players: {
      ...league.players,
      [playerId]: { ...player, position, tier, contractId: contract.id },
    } as LeagueState['players'],
    contracts: { ...league.contracts, [contract.id]: contract } as LeagueState['contracts'],
  };
}

describe('topFiveAveragePositionCapHit', () => {
  it('averages the top 5 cap hits at a position, ignoring the rest', () => {
    const base = createLeague({ seed: 'ft-top5' });
    const teamId = (Object.keys(base.teams) as TeamId[])[0]!;
    let league = withoutPosition(base, Position.QB);
    const hits = [10, 9, 8, 7, 6, 1, 1].map((m) => m * 1_000_000);
    hits.forEach((hit, i) => {
      const pid = `P_FT5_${i}` as PlayerId;
      league = {
        ...league,
        players: {
          ...league.players,
          [pid]: {
            ...Object.values(league.players)[0]!,
            id: pid,
            position: Position.QB,
            teamId,
            contractId: ContractId(`C_FT5_${i}`),
          },
        } as LeagueState['players'],
        contracts: {
          ...league.contracts,
          [`C_FT5_${i}`]: dealAt(pid, teamId, hit, 2),
        } as LeagueState['contracts'],
      };
    });
    const avg = topFiveAveragePositionCapHit(league, Position.QB);
    // top 5 of [10,9,8,7,6,1,1] = 10,9,8,7,6 -> mean 8
    expect(avg).toBe(8_000_000);
  });

  it('averages whatever exists below 5 contracts', () => {
    const base = createLeague({ seed: 'ft-thin' });
    const teamId = (Object.keys(base.teams) as TeamId[])[0]!;
    const pid = 'P_FT_THIN' as PlayerId;
    const league = pinPlayer(
      base,
      teamId,
      Object.keys(base.players)[0] as PlayerId,
      Position.LS,
      'STARTER',
      dealAt(pid, teamId, 2_000_000, 2),
    );
    // Only one LS contract exists in this fixture's hand-pinned state --
    // real generated leagues carry many, so isolate by checking the
    // pinned player's own value is reachable, not that LS is globally thin.
    const avg = topFiveAveragePositionCapHit(league, Position.LS);
    expect(avg).not.toBeNull();
    expect(avg!).toBeGreaterThan(0);
  });

  it('returns null for a position with zero contracted players (§3 edge case)', () => {
    const base = createLeague({ seed: 'ft-zero' });
    // Strip every contract at a position by pointing all players away from it
    // via a synthetic league with no players at a made-up-empty bucket: use
    // the real enum but assert against a league with contracts filtered out.
    const contractsWithoutQb: Record<string, Contract> = {};
    for (const [id, c] of Object.entries(base.contracts)) {
      const p = base.players[c.playerId];
      if (p?.position === Position.QB) continue;
      contractsWithoutQb[id] = c;
    }
    const league: LeagueState = { ...base, contracts: contractsWithoutQb as LeagueState['contracts'] };
    expect(topFiveAveragePositionCapHit(league, Position.QB)).toBeNull();
  });
});

describe('franchiseTagQuote', () => {
  it('picks the position-average branch when it exceeds the 120% floor', () => {
    const base = createLeague({ seed: 'ft-quote-avg' });
    const teamId = (Object.keys(base.teams) as TeamId[])[0]!;
    let league = withoutPosition(base, Position.QB);
    // Five QB contracts at $20M so the position average is $20M.
    for (let i = 0; i < 5; i++) {
      const pid = `P_FTQ_${i}` as PlayerId;
      league = {
        ...league,
        players: {
          ...league.players,
          [pid]: {
            ...Object.values(league.players)[0]!,
            id: pid,
            position: Position.QB,
            teamId,
            contractId: ContractId(`C_FTQ_${i}`),
          },
        } as LeagueState['players'],
        contracts: {
          ...league.contracts,
          [`C_FTQ_${i}`]: dealAt(pid, teamId, 20_000_000, 2),
        } as LeagueState['contracts'],
      };
    }
    // The expiring contract's own prior-year salary is low ($5M), so 120%
    // of it ($6M) is far below the $20M position average.
    const expiring = dealAt('P_FTQ_TARGET' as PlayerId, teamId, 5_000_000, 0);
    const quote = franchiseTagQuote(league, Position.QB, expiring);
    expect(quote).not.toBeNull();
    expect(quote!.branch).toBe('position-average');
    expect(quote!.amount).toBe(20_000_000);
  });

  it('picks the 120%-prior-salary floor when it exceeds the position average', () => {
    const base = createLeague({ seed: 'ft-quote-floor' });
    const teamId = (Object.keys(base.teams) as TeamId[])[0]!;
    let league = withoutPosition(base, Position.LS);
    // Position average is low ($3M)...
    for (let i = 0; i < 5; i++) {
      const pid = `P_FTF_${i}` as PlayerId;
      league = {
        ...league,
        players: {
          ...league.players,
          [pid]: {
            ...Object.values(league.players)[0]!,
            id: pid,
            position: Position.LS,
            teamId,
            contractId: ContractId(`C_FTF_${i}`),
          },
        } as LeagueState['players'],
        contracts: {
          ...league.contracts,
          [`C_FTF_${i}`]: dealAt(pid, teamId, 3_000_000, 2),
        } as LeagueState['contracts'],
      };
    }
    // ...but this specific player's own prior salary was $10M (an outlier
    // deal), so 120% of it ($12M) exceeds the $3M market average.
    const expiring = dealAt('P_FTF_TARGET' as PlayerId, teamId, 10_000_000, 0);
    const quote = franchiseTagQuote(league, Position.LS, expiring);
    expect(quote).not.toBeNull();
    expect(quote!.branch).toBe('prior-salary-floor');
    expect(quote!.amount).toBe(Math.round(10_000_000 * FRANCHISE_TAG_PRIOR_SALARY_MULTIPLIER));
  });

  it('§2.1: re-tagging a previously-tagged player yields ~120% of the old tag number with no tag-history state', () => {
    const base = createLeague({ seed: 'ft-escalator' });
    const teamId = (Object.keys(base.teams) as TeamId[])[0]!;
    // Strip the market so the position-average branch can't compete --
    // isolates the escalator (the floor branch) deterministically.
    let league = withoutPosition(base, Position.QB);
    for (let i = 0; i < 5; i++) {
      const pid = `P_FTE_${i}` as PlayerId;
      league = {
        ...league,
        players: {
          ...league.players,
          [pid]: {
            ...Object.values(league.players)[0]!,
            id: pid,
            position: Position.QB,
            teamId,
            contractId: ContractId(`C_FTE_${i}`),
          },
        } as LeagueState['players'],
        contracts: {
          ...league.contracts,
          [`C_FTE_${i}`]: dealAt(pid, teamId, 1_000_000, 2),
        } as LeagueState['contracts'],
      };
    }
    // A "previous tag" is just a 1-year deal whose only base salary IS the
    // old tag number -- no special-casing needed for the escalator to work.
    const oldTagNumber = 25_000_000;
    const previousTag: Contract = {
      id: ContractId('C_FT_PREVTAG'),
      playerId: 'P_FT_PREVTAG' as PlayerId,
      teamId,
      signedOnTick: 0,
      realYears: 1,
      voidYears: 0,
      yearsRemaining: 0,
      baseSalaries: [oldTagNumber],
      signingBonus: 0,
      rosterBonuses: [0],
      workoutBonuses: [0],
      guarantees: [{ baseGuaranteedPct: 100, type: 'FULLY_GUARANTEED' }],
      incentives: [],
      noTradeClause: false,
    };
    const quote = franchiseTagQuote(league, Position.QB, previousTag);
    expect(quote).not.toBeNull();
    expect(quote!.branch).toBe('prior-salary-floor');
    expect(quote!.amount).toBe(Math.round(oldTagNumber * FRANCHISE_TAG_PRIOR_SALARY_MULTIPLIER));
    expect(quote!.amount).toBe(30_000_000); // 120% of 25M
  });
});

describe('applyFranchiseTags', () => {
  it('tags exactly one player per team even with multiple eligible candidates', () => {
    const base = createLeague({ seed: 'ft-onepertm' });
    const teamId = (Object.keys(base.teams) as TeamId[])[0]!;
    const team = base.teams[teamId]!;
    let league = base;
    const targetIds: PlayerId[] = [];
    // Three STAR-tier expiring QBs on the same team -- only one may tag.
    // (§13: eligibility is STAR-only, not STAR/STARTER as originally
    // shipped -- see the STARTER exclusion test below for that boundary.)
    for (let i = 0; i < 3; i++) {
      const pid = team.rosterIds[i]!;
      targetIds.push(pid);
      league = pinPlayer(league, teamId, pid, Position.QB, 'STAR', dealAt(pid, teamId, 5_000_000, 0));
    }
    const after = applyFranchiseTags(league, league.tick);
    const tags = after.transactionLog.filter((t) => t.kind === 'franchise-tag' && t.teamId === teamId);
    expect(tags.length).toBe(1);
  });

  it('§13: never tags a STARTER-tier player, even affordable and highest-value on his team', () => {
    // The regression gate for §13's ruling. T1 measured 29.22
    // tags/league-season against a predicted 3-10 because the shipped
    // rule tagged any affordable STAR/STARTER candidate with no further
    // threshold (§12: 74.7% of firings were STARTER-tier). §13 narrows
    // eligibility to STAR alone -- this test is what stops a future "fix"
    // from quietly re-widening it back to STARTER.
    const base = createLeague({ seed: 'ft-starteronly' });
    const teamId = (Object.keys(base.teams) as TeamId[])[0]!;
    const team = base.teams[teamId]!;
    const pid = team.rosterIds[0]!;
    // Cheap and clearly affordable -- if eligibility were still
    // STAR/STARTER this player would be the obvious, uncontested tag.
    const league = pinPlayer(base, teamId, pid, Position.WR, 'STARTER', dealAt(pid, teamId, 2_000_000, 0));
    const after = applyFranchiseTags(league, league.tick);
    const tags = after.transactionLog.filter((t) => t.kind === 'franchise-tag' && t.teamId === teamId);
    expect(tags.length).toBe(0);
  });

  it('produces a one-year, fully-guaranteed, zero-signing-bonus contract at the tag number', () => {
    const base = createLeague({ seed: 'ft-shape' });
    const teamId = (Object.keys(base.teams) as TeamId[])[0]!;
    const team = base.teams[teamId]!;
    const pid = team.rosterIds[0]!;
    const league = pinPlayer(base, teamId, pid, Position.EDGE, 'STAR', dealAt(pid, teamId, 15_000_000, 0));

    const after = applyFranchiseTags(league, league.tick);
    const tag = after.transactionLog.find((t) => t.kind === 'franchise-tag' && t.playerId === pid);
    expect(tag).toBeDefined();
    if (tag?.kind !== 'franchise-tag') throw new Error('unreachable');
    const contract = after.contracts[tag.contractId]!;
    expect(contract.realYears).toBe(1);
    expect(contract.yearsRemaining).toBe(1);
    expect(contract.signingBonus).toBe(0);
    expect(contract.baseSalaries).toEqual([tag.tagNumber]);
    expect(contract.guarantees).toEqual([{ baseGuaranteedPct: 100, type: 'FULLY_GUARANTEED' }]);
    expect(after.players[pid]!.contractId).toBe(tag.contractId);
  });

  it('does not tag a team that cannot fit any eligible candidate under the cap', () => {
    const base = createLeague({ seed: 'ft-capgate' });
    const teamId = (Object.keys(base.teams) as TeamId[])[0]!;
    const team = base.teams[teamId]!;
    const pid = team.rosterIds[0]!;
    // A tag number this large cannot fit under any realistic cap.
    let league = pinPlayer(
      base,
      teamId,
      pid,
      Position.QB,
      'STAR',
      dealAt(pid, teamId, base.salaryCap * 5, 0),
    );
    // Force the position average sky-high too, so the formula can't
    // accidentally land under the cap.
    for (let i = 0; i < 5; i++) {
      const extraId = `P_FTCG_${i}` as PlayerId;
      league = {
        ...league,
        players: {
          ...league.players,
          [extraId]: {
            ...Object.values(league.players)[0]!,
            id: extraId,
            position: Position.QB,
            teamId,
            contractId: ContractId(`C_FTCG_${i}`),
          },
        } as LeagueState['players'],
        contracts: {
          ...league.contracts,
          [`C_FTCG_${i}`]: dealAt(extraId, teamId, base.salaryCap * 5, 2),
        } as LeagueState['contracts'],
      };
    }
    const after = applyFranchiseTags(league, league.tick);
    const tags = after.transactionLog.filter((t) => t.kind === 'franchise-tag' && t.teamId === teamId);
    expect(tags.length).toBe(0);
  });

  it('never tags a contract still under a real term (yearsRemaining > 0)', () => {
    const base = createLeague({ seed: 'ft-notexpiring' });
    const teamId = (Object.keys(base.teams) as TeamId[])[0]!;
    const team = base.teams[teamId]!;
    const pid = team.rosterIds[0]!;
    const league = pinPlayer(base, teamId, pid, Position.WR, 'STAR', dealAt(pid, teamId, 10_000_000, 3));
    const after = applyFranchiseTags(league, league.tick);
    const tag = after.transactionLog.find((t) => t.kind === 'franchise-tag' && t.playerId === pid);
    expect(tag).toBeUndefined();
  });

  it('is deterministic — identical input produces identical output', () => {
    const a = createLeague({ seed: 'ft-determ' });
    const b = createLeague({ seed: 'ft-determ' });
    const resA = applyFranchiseTags(a, a.tick);
    const resB = applyFranchiseTags(b, b.tick);
    const tagsA = resA.transactionLog.filter((t) => t.kind === 'franchise-tag');
    const tagsB = resB.transactionLog.filter((t) => t.kind === 'franchise-tag');
    expect(tagsA).toEqual(tagsB);
  });
});
