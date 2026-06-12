import { describe, expect, it } from 'vitest';
import { Prng } from '../prng/index.js';
import { createLeague } from '../league/generate.js';
import {
  applyResigningWindow,
  resignProbability,
  RESIGN_QB_FLOOR,
  RESIGN_BASE_BY_TIER,
} from './re-sign.js';
import { applyContractExpirations } from './offseason.js';
import { Position } from '../types/enums.js';
import type { LeagueState } from '../types/league.js';
import type { Player } from '../types/player.js';
import type { Contract } from '../types/contract.js';
import type { ContractId, PlayerId, TeamId } from '../types/ids.js';

/**
 * The re-sign window (v0.148). Real bar: primary starters stay with their
 * team 78.4% year-over-year (nflverse 2011-2024); pre-fix GMSim dumped
 * every expiring contract into the FA auction and ~45% of primary passers
 * changed teams in one offseason.
 */

/** Find a rostered player matching `pred` and mark his contract expiring. */
function withExpiring(
  league: LeagueState,
  pred: (p: Player) => boolean,
): { league: LeagueState; player: Player; teamId: TeamId; oldContractId: ContractId } {
  for (const team of Object.values(league.teams)) {
    for (const pid of team.rosterIds) {
      const p = league.players[pid];
      if (!p || !p.contractId || !pred(p)) continue;
      const old = league.contracts[p.contractId];
      if (!old) continue;
      const expiring: Contract = { ...old, yearsRemaining: 0 };
      return {
        league: {
          ...league,
          contracts: { ...league.contracts, [old.id]: expiring },
        },
        player: p,
        teamId: team.identity.id,
        oldContractId: old.id,
      };
    }
  }
  throw new Error('no matching rostered player in fixture league');
}

describe('resignProbability', () => {
  const league = createLeague({ seed: 'resign-prob' });
  const players = Object.values(league.players);

  it('floors established QBs at the franchise level', () => {
    const qb = players.find(
      (p) => p.position === Position.QB && (p.tier === 'STAR' || p.tier === 'STARTER'),
    )!;
    const content = { ...qb, mood: 75 };
    expect(resignProbability(content, league.seasonNumber)).toBeGreaterThanOrEqual(
      RESIGN_QB_FLOOR * 0.65, // even age-dampened, stays high
    );
    const young: Player = { ...content, birthDate: '1999-01-01' }; // 27 in sim-year 2026
    expect(resignProbability(young, league.seasonNumber)).toBeGreaterThanOrEqual(RESIGN_QB_FLOOR);
  });

  it('lets fringe players walk and dampens the disgruntled', () => {
    const fringe = players.find((p) => p.tier === 'FRINGE')!;
    expect(resignProbability({ ...fringe, mood: 75 }, league.seasonNumber)).toBeLessThanOrEqual(
      RESIGN_BASE_BY_TIER.FRINGE,
    );
    const star = players.find((p) => p.tier === 'STAR')!;
    const wantsOut = { ...star, mood: 5 };
    const content = { ...star, mood: 75 };
    expect(resignProbability(wantsOut, league.seasonNumber)).toBeLessThan(
      resignProbability(content, league.seasonNumber) * 0.3,
    );
  });
});

describe('applyResigningWindow', () => {
  it('re-signs an expiring franchise QB before the market opens', () => {
    const base = createLeague({ seed: 'resign-window' });
    const picked = withExpiring(
      base,
      (p) =>
        p.position === Position.QB &&
        (p.tier === 'STAR' || p.tier === 'STARTER') &&
        p.mood >= 60,
    );
    const { player, teamId, oldContractId } = picked;
    // Generated teams sit near the cap; double it so the desire mechanism
    // is what's under test (the cap-blocked path has its own case below).
    const league: LeagueState = { ...picked.league, salaryCap: picked.league.salaryCap * 2 };

    const after = applyResigningWindow(new Prng('resign-roll-2'), league, league.tick);
    const tx = after.transactionLog.find(
      (t) => t.kind === 're-sign' && t.playerId === player.id,
    );
    expect(tx, 'franchise QB should re-sign (deterministic seed)').toBeDefined();

    const updated = after.players[player.id]!;
    expect(updated.teamId).toBe(teamId);
    expect(updated.contractId).not.toBe(oldContractId);
    expect(after.contracts[oldContractId]).toBeUndefined();
    const fresh = after.contracts[updated.contractId!]!;
    expect(fresh.yearsRemaining).toBeGreaterThanOrEqual(1);

    // And the expiration step that follows must NOT drop him.
    const postExpiry = applyContractExpirations(after);
    expect(postExpiry.teams[teamId]!.rosterIds).toContain(player.id);
    expect(postExpiry.players[player.id]!.teamId).toBe(teamId);
  });

  it('lets the player walk when the cap cannot fit the new deal', () => {
    const base = createLeague({ seed: 'resign-window' });
    const { league, player } = withExpiring(
      base,
      (p) => p.position === Position.QB && (p.tier === 'STAR' || p.tier === 'STARTER'),
    );
    const broke: LeagueState = { ...league, salaryCap: 1 };

    const after = applyResigningWindow(new Prng('resign-roll-2'), broke, broke.tick);
    expect(
      after.transactionLog.some((t) => t.kind === 're-sign' && t.playerId === player.id),
    ).toBe(false);
    // Expiration then sends him to the pool — the realistic cap casualty.
    const postExpiry = applyContractExpirations(after);
    expect(postExpiry.players[player.id]!.teamId).toBeNull();
  });

  it('is deterministic for a given seed', () => {
    const base = createLeague({ seed: 'resign-det' });
    // Mark every contract on one team expiring for a denser sample.
    const team = Object.values(base.teams)[0]!;
    const contracts = { ...base.contracts };
    for (const pid of team.rosterIds) {
      const cid = base.players[pid]?.contractId;
      if (!cid) continue;
      const c = contracts[cid];
      if (c) contracts[cid] = { ...c, yearsRemaining: 0 };
    }
    const league = { ...base, contracts };
    const a = applyResigningWindow(new Prng('same'), league, league.tick);
    const b = applyResigningWindow(new Prng('same'), league, league.tick);
    const keysA = a.transactionLog.filter((t) => t.kind === 're-sign').map((t) => t.playerId);
    const keysB = b.transactionLog.filter((t) => t.kind === 're-sign').map((t) => t.playerId);
    expect(keysA).toEqual(keysB);
    expect(keysA.length).toBeGreaterThan(0);
  });
});
