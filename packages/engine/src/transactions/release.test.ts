import { describe, it, expect } from 'vitest';
import { createLeague } from '../league/generate.js';
import { releasePlayer } from './release.js';
import { deadMoneyOnPreJune1Release, teamCapUsage } from '../contracts/cap.js';
import type { PlayerId } from '../types/ids.js';

function freshLeague() {
  return createLeague({ seed: 'release-test' });
}

function pickAnyPlayerOnTeam(league: ReturnType<typeof createLeague>) {
  const team = Object.values(league.teams)[0]!;
  const playerId = team.rosterIds[0]!;
  return { team, playerId };
}

describe('releasePlayer', () => {
  it('removes the player from the team roster', () => {
    const league = freshLeague();
    const { team, playerId } = pickAnyPlayerOnTeam(league);

    const next = releasePlayer(league, playerId);

    const nextTeam = next.teams[team.identity.id]!;
    expect(nextTeam.rosterIds).not.toContain(playerId);
    expect(nextTeam.rosterIds.length).toBe(team.rosterIds.length - 1);
  });

  it('makes the player a free agent (teamId / contractId null)', () => {
    const league = freshLeague();
    const { playerId } = pickAnyPlayerOnTeam(league);

    const next = releasePlayer(league, playerId);

    const nextPlayer = next.players[playerId]!;
    expect(nextPlayer.teamId).toBeNull();
    expect(nextPlayer.contractId).toBeNull();
  });

  it('drops the released contract from league.contracts', () => {
    const league = freshLeague();
    const { playerId } = pickAnyPlayerOnTeam(league);
    const contractId = league.players[playerId]!.contractId!;
    expect(league.contracts[contractId]).toBeDefined();

    const next = releasePlayer(league, playerId);

    expect(next.contracts[contractId]).toBeUndefined();
  });

  it('accrues dead money to the team for the current year', () => {
    const league = freshLeague();
    const { team, playerId } = pickAnyPlayerOnTeam(league);
    const contract = league.contracts[league.players[playerId]!.contractId!]!;
    const expectedDead = deadMoneyOnPreJune1Release(contract);

    const next = releasePlayer(league, playerId);

    const nextTeam = next.teams[team.identity.id]!;
    expect(nextTeam.deadMoneyByYear[0]).toBe(expectedDead);
  });

  it('teamCapUsage reflects dead money + drops the contract', () => {
    // Use REGULAR_SEASON phase so all 53 contracts count toward the cap;
    // this lets the test compare delta cleanly against a single contract's
    // cap hit. (Top-51 accounting kicks in during offseason phases.)
    const league = { ...freshLeague(), phase: 'REGULAR_SEASON' as const };
    const { team, playerId } = pickAnyPlayerOnTeam(league);
    const contract = league.contracts[league.players[playerId]!.contractId!]!;
    const before = teamCapUsage(team, league);

    const next = releasePlayer(league, playerId);
    const after = teamCapUsage(next.teams[team.identity.id]!, next);

    // Cap delta = dead money - the contract's prior current-year cap hit.
    const dead = deadMoneyOnPreJune1Release(contract);
    const yearOfDeal = contract.realYears - contract.yearsRemaining;
    const proration = Math.round(
      contract.signingBonus / Math.min(contract.realYears + contract.voidYears, 5),
    );
    const priorHit =
      (contract.baseSalaries[yearOfDeal] ?? 0) +
      (contract.rosterBonuses[yearOfDeal] ?? 0) +
      (contract.workoutBonuses[yearOfDeal] ?? 0) +
      proration;
    expect(after - before).toBe(dead - priorHit);
  });

  it('accumulates dead money across multiple releases on the same team', () => {
    const league = freshLeague();
    const team = Object.values(league.teams)[0]!;
    const [first, second] = [team.rosterIds[0]!, team.rosterIds[1]!];
    const c1 = league.contracts[league.players[first]!.contractId!]!;
    const c2 = league.contracts[league.players[second]!.contractId!]!;
    const expectedDead =
      deadMoneyOnPreJune1Release(c1) + deadMoneyOnPreJune1Release(c2);

    let next = releasePlayer(league, first);
    next = releasePlayer(next, second);

    expect(next.teams[team.identity.id]!.deadMoneyByYear[0]).toBe(expectedDead);
  });

  it('throws when the player does not exist', () => {
    const league = freshLeague();
    expect(() => releasePlayer(league, 'P_NOPE' as PlayerId)).toThrow(/not found/);
  });

  it('throws when the player is already a free agent', () => {
    const league = freshLeague();
    const { playerId } = pickAnyPlayerOnTeam(league);
    const once = releasePlayer(league, playerId);
    expect(() => releasePlayer(once, playerId)).toThrow(/free agent/);
  });
});
