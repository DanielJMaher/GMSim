import { describe, it, expect } from 'vitest';
import { createLeague } from '../league/generate.js';
import { releasePlayer } from './release.js';
import { freeAgents, freeAgentsByPosition, signFreeAgent } from './free-agency.js';
import type { PlayerId, TeamId } from '../types/ids.js';
import { Position } from '../types/enums.js';

function freshLeague() {
  return createLeague({ seed: 'fa-test' });
}

describe('freeAgents', () => {
  it('returns empty when every player is on a roster', () => {
    const league = freshLeague();
    expect(freeAgents(league).length).toBe(0);
  });

  it('returns a released player', () => {
    const league = freshLeague();
    const team = Object.values(league.teams)[0]!;
    const playerId = team.rosterIds[0]!;
    const next = releasePlayer(league, playerId);
    const fas = freeAgents(next);
    expect(fas.length).toBe(1);
    expect(fas[0]!.id).toBe(playerId);
    expect(fas[0]!.teamId).toBeNull();
  });
});

describe('freeAgentsByPosition', () => {
  it('filters by position', () => {
    let league = freshLeague();
    const team = Object.values(league.teams)[0]!;
    const qbId = team.rosterIds.find((id) => league.players[id]!.position === Position.QB)!;
    const wrId = team.rosterIds.find((id) => league.players[id]!.position === Position.WR)!;
    league = releasePlayer(league, qbId);
    league = releasePlayer(league, wrId);
    const qbs = freeAgentsByPosition(league, Position.QB);
    const wrs = freeAgentsByPosition(league, Position.WR);
    expect(qbs.map((p) => p.id)).toEqual([qbId]);
    expect(wrs.map((p) => p.id)).toEqual([wrId]);
  });
});

describe('signFreeAgent', () => {
  it('adds the player to the team and creates a tier-appropriate contract', () => {
    let league = freshLeague();
    const team = Object.values(league.teams)[0]!;
    const playerId = team.rosterIds[0]!;
    const tier = league.players[playerId]!.tier;
    league = releasePlayer(league, playerId);

    const otherTeam = Object.values(league.teams)[1]!;
    const before = otherTeam.rosterIds.length;
    league = signFreeAgent(league, otherTeam.identity.id, playerId, {
      idSuffix: 'TEST_SIGN',
      signedOnTick: 100,
    });

    const player = league.players[playerId]!;
    const newTeam = league.teams[otherTeam.identity.id]!;
    expect(player.teamId).toBe(otherTeam.identity.id);
    expect(player.contractId).not.toBeNull();
    expect(newTeam.rosterIds).toContain(playerId);
    expect(newTeam.rosterIds.length).toBe(before + 1);

    const contract = league.contracts[player.contractId!]!;
    const expectedYears = { STAR: 4, STARTER: 3, BACKUP: 2, FRINGE: 1 }[tier];
    expect(contract.realYears).toBe(expectedYears);
    expect(contract.yearsRemaining).toBe(expectedYears);
  });

  it('throws when signing a player who is already on a team', () => {
    const league = freshLeague();
    const team = Object.values(league.teams)[0]!;
    const otherTeam = Object.values(league.teams)[1]!;
    const playerId = team.rosterIds[0]!;
    expect(() =>
      signFreeAgent(league, otherTeam.identity.id, playerId, {
        idSuffix: 'TEST_DUP',
        signedOnTick: 0,
      }),
    ).toThrow(/already on team/);
  });

  it('throws when player does not exist', () => {
    const league = freshLeague();
    const team = Object.values(league.teams)[0]!;
    expect(() =>
      signFreeAgent(league, team.identity.id, 'P_NOPE' as PlayerId, {
        idSuffix: 'X',
        signedOnTick: 0,
      }),
    ).toThrow(/not found/);
  });

  it('throws when team does not exist', () => {
    let league = freshLeague();
    const team = Object.values(league.teams)[0]!;
    const playerId = team.rosterIds[0]!;
    league = releasePlayer(league, playerId);
    expect(() =>
      signFreeAgent(league, 'TEAM_NOPE' as TeamId, playerId, {
        idSuffix: 'X',
        signedOnTick: 0,
      }),
    ).toThrow(/team .* not found/);
  });
});
