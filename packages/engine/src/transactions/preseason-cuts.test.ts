import { describe, it, expect } from 'vitest';
import { createLeague } from '../league/generate.js';
import { preseasonCuts } from './preseason-cuts.js';
import { unamortizedSigningBonus } from '../contracts/cap.js';
import { ContractId, PlayerId } from '../types/ids.js';
import type { Contract } from '../types/contract.js';
import type { LeagueState } from '../types/league.js';
import type { Player } from '../types/player.js';
import type { TeamId } from '../types/ids.js';

describe('preseasonCuts — contract evaporation must book dead money (LIQUIDATOR_DEAD_MONEY.md §11.1)', () => {
  it('a cut player with unamortized signing bonus books that exact amount as dead money', () => {
    // Today, preseasonCuts drops the contract with NO cap charge -- its own
    // doc comment admits this ("NO dead money charged ... that nuance lands
    // in a later slice"). Measured league-wide: $208.5M/league/season
    // unbooked (~+2.17pp) -- LARGER than the retirement channel, and
    // structurally invisible to a "vanished from league.players" probe
    // since a preseason-cut player survives as a free agent.
    const base = createLeague({ seed: 'pcuts-deadmoney' });
    const teamIds = Object.keys(base.teams) as TeamId[];
    const teamId = teamIds[0]!;
    const team = base.teams[teamId]!;
    const targetId = team.rosterIds[0]!;
    const target = base.players[targetId]!;

    // One extra body (cloned from another team's real player, contract
    // stripped) pushes the roster to 54 -- surplus of exactly 1, so exactly
    // ONE player gets cut. Give the padding body maxed-out skills so it is
    // never the one selected; give the target zeroed-out skills so it is
    // the guaranteed lowest-skill-mean (and therefore guaranteed cut)
    // player, deterministically isolating the fixture to one event.
    const otherTeamId = teamIds.find((id) => id !== teamId)!;
    const donor = base.players[base.teams[otherTeamId]!.rosterIds[0]!]!;
    const paddingId = PlayerId('P_PRESEASON_PADDING');
    const padding: Player = {
      ...donor,
      id: paddingId,
      teamId,
      contractId: null,
      current: mapSkills(donor.current, 99),
    };

    const contract: Contract = {
      id: ContractId('C_PRESEASON_TARGET'),
      playerId: targetId,
      teamId,
      signedOnTick: base.tick,
      realYears: 5,
      voidYears: 0,
      yearsRemaining: 5, // fresh deal -- zero years charged, full bonus unamortized
      baseSalaries: [4_000_000, 4_000_000, 4_000_000, 4_000_000, 4_000_000],
      // ROSTER_FLOOR.md §17 follow-up: the swap fix below spares a selected
      // cut whose dead money would exceed the cap hit it frees, in favor of
      // a cheaper-to-cut alternative -- so this bonus must stay small enough
      // that cutting `target` is itself cap-safe (dead <= hit), or he'd be
      // swapped out and this fixture would no longer isolate a single event.
      signingBonus: 2_000_000,
      rosterBonuses: [0, 0, 0, 0, 0],
      workoutBonuses: [0, 0, 0, 0, 0],
      guarantees: [
        { baseGuaranteedPct: 0, type: 'NONE' },
        { baseGuaranteedPct: 0, type: 'NONE' },
        { baseGuaranteedPct: 0, type: 'NONE' },
        { baseGuaranteedPct: 0, type: 'NONE' },
        { baseGuaranteedPct: 0, type: 'NONE' },
      ],
      incentives: [],
      noTradeClause: false,
    };
    const expectedUnamortized = unamortizedSigningBonus(contract);
    expect(expectedUnamortized).toBe(2_000_000); // sanity: fresh deal, full bonus

    const playersNext = {
      ...base.players,
      [targetId]: { ...target, contractId: contract.id, current: mapSkills(target.current, 1) },
      [paddingId]: padding,
    };
    const contractsNext = { ...base.contracts, [contract.id]: contract };
    const teamNext = { ...team, rosterIds: [...team.rosterIds, paddingId] };

    const league: LeagueState = {
      ...base,
      players: playersNext as LeagueState['players'],
      contracts: contractsNext as LeagueState['contracts'],
      teams: { ...base.teams, [teamId]: teamNext } as LeagueState['teams'],
    };
    expect(league.teams[teamId]!.rosterIds.length).toBe(54); // fixture check: surplus of exactly 1

    const beforeDead = league.teams[teamId]!.deadMoneyByYear[0] ?? 0;

    const after = preseasonCuts(league, { protectedPlayerIds: new Set() });

    expect(
      after.players[targetId]!.contractId,
      'fixture check: the zero-skill target must be the one cut',
    ).toBeNull();
    expect(after.players[paddingId]!.teamId, 'fixture check: the maxed-skill padding body must survive').toBe(teamId);

    const afterDead = after.teams[teamId]!.deadMoneyByYear[0] ?? 0;
    expect(
      afterDead - beforeDead,
      'preseasonCuts must book the unamortized signing bonus as dead money',
    ).toBe(expectedUnamortized);
  });
});

describe('preseasonCuts — Fix 4 PROPER follow-up (ROSTER_FLOOR.md §17): a mandatory cutdown must not cut a player whose dead money exceeds the cap hit it frees when a cheaper alternative exists', () => {
  it('spares the worst-skill player with a catastrophic fresh-deal bonus and cuts the next-worst, cap-safe player instead', () => {
    const base = createLeague({ seed: 'pcuts-swap' });
    const teamIds = Object.keys(base.teams) as TeamId[];
    const teamId = teamIds[0]!;
    const team = base.teams[teamId]!;
    const catastrophicId = team.rosterIds[0]!;
    const catastrophic = base.players[catastrophicId]!;
    const cheapId = team.rosterIds[1]!;
    const cheap = base.players[cheapId]!;

    const otherTeamId = teamIds.find((id) => id !== teamId)!;
    const donor = base.players[base.teams[otherTeamId]!.rosterIds[0]!]!;
    const paddingId = PlayerId('P_PRESEASON_SWAP_PADDING');
    const padding: Player = {
      ...donor,
      id: paddingId,
      teamId,
      contractId: null,
      current: mapSkills(donor.current, 99),
    };

    // Worst skill in the room (skill=1), but a fresh deal with a bonus
    // dwarfing its own cap hit -- cutting him would cost far more room
    // than it frees.
    const catastrophicContract: Contract = {
      id: ContractId('C_PRESEASON_SWAP_CATASTROPHIC'),
      playerId: catastrophicId,
      teamId,
      signedOnTick: base.tick,
      realYears: 5,
      voidYears: 0,
      yearsRemaining: 5,
      baseSalaries: [4_000_000, 4_000_000, 4_000_000, 4_000_000, 4_000_000],
      signingBonus: 15_000_000,
      rosterBonuses: [0, 0, 0, 0, 0],
      workoutBonuses: [0, 0, 0, 0, 0],
      guarantees: Array(5).fill({ baseGuaranteedPct: 0, type: 'NONE' as const }),
      incentives: [],
      noTradeClause: false,
    };
    // Second-worst skill (skill=2), plain vet-min-shaped deal -- cutting
    // him is pure savings.
    const cheapContract: Contract = {
      id: ContractId('C_PRESEASON_SWAP_CHEAP'),
      playerId: cheapId,
      teamId,
      signedOnTick: base.tick,
      realYears: 1,
      voidYears: 0,
      yearsRemaining: 1,
      baseSalaries: [1_200_000],
      signingBonus: 0,
      rosterBonuses: [0],
      workoutBonuses: [0],
      guarantees: [{ baseGuaranteedPct: 0, type: 'NONE' }],
      incentives: [],
      noTradeClause: false,
    };

    const playersNext = {
      ...base.players,
      [catastrophicId]: {
        ...catastrophic,
        contractId: catastrophicContract.id,
        current: mapSkills(catastrophic.current, 1),
      },
      [cheapId]: { ...cheap, contractId: cheapContract.id, current: mapSkills(cheap.current, 2) },
      [paddingId]: padding,
    };
    const contractsNext = {
      ...base.contracts,
      [catastrophicContract.id]: catastrophicContract,
      [cheapContract.id]: cheapContract,
    };
    const teamNext = { ...team, rosterIds: [...team.rosterIds, paddingId] };

    const league: LeagueState = {
      ...base,
      players: playersNext as LeagueState['players'],
      contracts: contractsNext as LeagueState['contracts'],
      teams: { ...base.teams, [teamId]: teamNext } as LeagueState['teams'],
    };
    expect(league.teams[teamId]!.rosterIds.length).toBe(54); // fixture check: surplus of exactly 1

    const after = preseasonCuts(league, { protectedPlayerIds: new Set() });

    expect(
      after.players[catastrophicId]!.contractId,
      'the catastrophic-dead-money player must be spared, not cut',
    ).not.toBeNull();
    expect(
      after.players[cheapId]!.contractId,
      'the cap-safe next-worst-skill player must be cut instead',
    ).toBeNull();
    expect(after.players[paddingId]!.teamId, 'the maxed-skill padding body must survive').toBe(teamId);
    expect(after.teams[teamId]!.rosterIds.length).toBe(53);
  });
});

function mapSkills(skills: Player['current'], value: number): Player['current'] {
  const next = { ...skills };
  for (const key of Object.keys(next) as (keyof Player['current'])[]) {
    if (typeof next[key] === 'number') (next[key] as number) = value;
  }
  return next;
}
