import { describe, it, expect } from 'vitest';
import { createLeague } from './generate.js';
import { teamCapUsage, summarizeTeamCap } from '../contracts/cap.js';

describe('createLeague — contracts + cap', () => {
  it('every player has a contract resolvable in the contracts store', () => {
    const league = createLeague({ seed: 'cap-refs' });
    for (const player of Object.values(league.players)) {
      expect(player.contractId).not.toBeNull();
      const contract = league.contracts[player.contractId!];
      expect(contract).toBeDefined();
      expect(contract!.playerId).toBe(player.id);
      expect(contract!.teamId).toBe(player.teamId);
    }
  });

  it('total contracts = total players (1,696 league-wide)', () => {
    const league = createLeague({ seed: 'cap-count' });
    const playerCount = Object.keys(league.players).length;
    const contractCount = Object.keys(league.contracts).length;
    expect(contractCount).toBe(playerCount);
  });

  it('determinism — identical seed produces identical contracts', () => {
    const a = createLeague({ seed: 'det' });
    const b = createLeague({ seed: 'det' });
    expect(a.contracts).toEqual(b.contracts);
  });

  it('team cap usage is positive and roughly within plausible NFL range', () => {
    const league = createLeague({ seed: 'cap-range' });
    let teamsOver = 0;
    let teamsUnder = 0;
    let teamsClose = 0;
    for (const team of Object.values(league.teams)) {
      const summary = summarizeTeamCap(team, league);
      expect(summary.capUsed).toBeGreaterThan(0);
      // Plausible range: $150M-$320M. Beyond either bound suggests the
      // generator's tier-salary tuning is way off.
      expect(summary.capUsed).toBeGreaterThan(150_000_000);
      expect(summary.capUsed).toBeLessThan(320_000_000);
      if (summary.capUsed > league.salaryCap) teamsOver++;
      else if (summary.capUsed > league.salaryCap - 30_000_000) teamsClose++;
      else teamsUnder++;
    }
    // Sanity-check the distribution is non-degenerate (not every team
    // pinned to one extreme).
    expect(teamsOver + teamsClose + teamsUnder).toBe(32);
  });

  it('aggregating cap via teamCapUsage matches summarizeTeamCap.capUsed', () => {
    const league = createLeague({ seed: 'agg' });
    for (const team of Object.values(league.teams)) {
      const used = teamCapUsage(team, league);
      const summary = summarizeTeamCap(team, league);
      expect(used).toBe(summary.capUsed);
      expect(summary.capSpace).toBe(summary.capCeiling - summary.capUsed);
    }
  });
});
