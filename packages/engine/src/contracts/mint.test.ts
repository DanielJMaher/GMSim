import { describe, it, expect } from 'vitest';
import { createLeague } from '../league/generate.js';
import { releasePlayer } from '../transactions/release.js';
import type { Contract } from '../types/contract.js';
import type { LeagueState } from '../types/league.js';
import type { TeamId, PlayerId } from '../types/ids.js';
import { ContractId } from '../types/ids.js';
import { mintContractId, contractIdCollisionEntry } from './mint.js';

/**
 * Roster Floor §14 Fix 2 (Daniel-ruled 2026-08-05, `ROSTER_FLOOR.md` §14.9:
 * class-wide + log-and-continue) — §14.7a's four REQUIRED regression tests.
 * T1 (the collision reproduced via `enforceRosterFloor` directly) lives in
 * `transactions/roster-floor.test.ts`. These four test `mintContractId` /
 * `contractIdCollisionEntry` directly — robust to any individual call
 * site's id-format changing later.
 */

function makeContract(overrides: Partial<Contract> = {}): Contract {
  return {
    id: ContractId('C_TEST'),
    playerId: 'P_TEST' as PlayerId,
    teamId: 'TST' as TeamId,
    signedOnTick: 0,
    realYears: 1,
    voidYears: 0,
    yearsRemaining: 1,
    baseSalaries: [1_000_000],
    signingBonus: 0,
    rosterBonuses: [0],
    workoutBonuses: [0],
    guarantees: [{ baseGuaranteedPct: 0, type: 'NONE' }],
    incentives: [],
    noTradeClause: false,
    ...overrides,
  };
}

describe('mintContractId — T4: the control (no collision => no uniquify, no log)', () => {
  it('returns a genuinely free id UNCHANGED and reports no collision', () => {
    const contracts: LeagueState['contracts'] = {};
    const result = mintContractId(contracts, ContractId('C_FREE'));
    expect(result.id).toBe(ContractId('C_FREE'));
    expect(result.collision).toBeUndefined();
  });

  it('contractIdCollisionEntry returns undefined for a no-collision result — the common path never grows the log', () => {
    const result = mintContractId({}, ContractId('C_FREE'));
    const entry = contractIdCollisionEntry(result, {
      tick: 100,
      seasonNumber: 1,
      teamId: 'TST' as TeamId,
      playerId: 'P_NEW' as PlayerId,
    });
    expect(entry).toBeUndefined();
  });
});

describe('mintContractId — T2: the guard (incident occurs, is fixed, is logged)', () => {
  it('a colliding id is deterministically uniquified, the pre-existing contract is untouched, and exactly one collision is reported', () => {
    const existing = makeContract({ id: ContractId('C_X'), playerId: 'P_OLD' as PlayerId });
    const contracts: LeagueState['contracts'] = { [existing.id]: existing };

    const result = mintContractId(contracts, ContractId('C_X'));

    // OCCURS + FIXED: a different id comes back; the pre-existing contract
    // at the requested key is untouched — same reference, not just equal.
    expect(result.id).not.toBe(ContractId('C_X'));
    expect(contracts[ContractId('C_X')]).toBe(existing);

    // FIXED (key/pointer discipline): the resolved id is exactly what a
    // caller must use for BOTH the map write and the Player.contractId
    // stamp — verified end-to-end in the T3 test below.
    expect(result.collision).toBeDefined();
    expect(result.collision!.resolvedId).toBe(result.id);

    // LOGGED: the collision record carries both ids, and they differ.
    expect(result.collision!.attemptedId).toBe(ContractId('C_X'));
    expect(result.collision!.resolvedId).not.toBe(result.collision!.attemptedId);

    // Deterministic — no PRNG (invariant 2): repeat resolution against the
    // SAME map yields the SAME id.
    const again = mintContractId(contracts, ContractId('C_X'));
    expect(again.id).toBe(result.id);

    const entry = contractIdCollisionEntry(result, {
      tick: 100,
      seasonNumber: 1,
      teamId: 'TST' as TeamId,
      playerId: 'P_NEW' as PlayerId,
    });
    expect(entry).toBeDefined();
    expect(entry!.kind).toBe('contract-id-collision');
    if (entry!.kind === 'contract-id-collision') {
      expect(entry!.attemptedId).toBe(ContractId('C_X'));
      expect(entry!.resolvedId).toBe(result.id);
    }
  });

  it('keeps uniquifying across repeated collisions (three mints requesting the same id land on three distinct keys)', () => {
    let contracts: LeagueState['contracts'] = {
      [ContractId('C_Y')]: makeContract({ id: ContractId('C_Y') }),
    };
    const first = mintContractId(contracts, ContractId('C_Y'));
    contracts = { ...contracts, [first.id]: makeContract({ id: first.id }) };
    const second = mintContractId(contracts, ContractId('C_Y'));

    expect(new Set([ContractId('C_Y'), first.id, second.id]).size).toBe(3);
  });
});

describe('mintContractId — T3: the orphan regression (the exact production crash, guarded)', () => {
  it('after a guarded collision, releasing one aliased player does not orphan the other', () => {
    // Reproduces §14.2's failure chain directly: two players, one contract
    // id requested for both (the exact `C_PHI_FLR4_1` shape from seed
    // `qcensus-1`). Pre-guard this silently overwrote the map entry,
    // orphaning whichever player's contractId still pointed at the old
    // (now-aliased) key; the next release of that player crashed with
    // `releasePlayer: contract ... missing`.
    let league = createLeague({ seed: 'mint-t3' });
    const teamId = (Object.keys(league.teams) as TeamId[]).sort()[0]!;
    const team = league.teams[teamId]!;
    const playerAId = team.rosterIds[0]!;
    const playerBId = team.rosterIds[1]!;
    expect(playerAId).not.toBe(playerBId);

    const requestedId = ContractId('C_SHARED');

    // Player A mints first — the requested id is free, so it lands exactly.
    const contractA = makeContract({ id: requestedId, playerId: playerAId, teamId });
    let contracts: Record<string, Contract> = { ...league.contracts };
    const playerAOldContractId = league.players[playerAId]!.contractId;
    if (playerAOldContractId) delete contracts[playerAOldContractId];
    contracts[contractA.id] = contractA;
    let players = {
      ...league.players,
      [playerAId]: { ...league.players[playerAId]!, teamId, contractId: contractA.id },
    };

    // Player B's mint site ALSO requests `requestedId` — the exact §14.2
    // failure condition — but goes through the guard this time.
    const minted = mintContractId(contracts, requestedId);
    expect(minted.collision).toBeDefined(); // sanity: this scenario DOES collide

    const contractB = makeContract({ id: minted.id, playerId: playerBId, teamId });
    const playerBOldContractId = players[playerBId]?.contractId ?? league.players[playerBId]!.contractId;
    if (playerBOldContractId) delete contracts[playerBOldContractId];
    contracts = { ...contracts, [contractB.id]: contractB };
    players = {
      ...players,
      [playerBId]: { ...league.players[playerBId]!, teamId, contractId: contractB.id },
    };

    league = {
      ...league,
      players: players as LeagueState['players'],
      contracts: contracts as LeagueState['contracts'],
    };

    // Both contracts really are at distinct keys (the guard's whole point).
    expect(contractA.id).not.toBe(contractB.id);

    // The regression: releasing B must not throw, and must not touch A.
    expect(() => releasePlayer(league, playerBId)).not.toThrow();
    const afterRelease = releasePlayer(league, playerBId);
    expect(afterRelease.players[playerAId]!.contractId).toBe(contractA.id);
    expect(afterRelease.contracts[contractA.id]).toBe(contractA);

    // And releasing A afterward must ALSO not throw — this exact sequence
    // (release the aliased player, then release the survivor) is what threw
    // `releasePlayer: contract missing` in production.
    expect(() => releasePlayer(afterRelease, playerAId)).not.toThrow();
  });
});
