import { describe, it, expect } from 'vitest';
import { createLeague } from '../league/generate.js';
import { simulateSeason } from '../season/runner.js';
import { advanceSeason } from '../season/advance.js';
import {
  applyContractExpirations,
  applyCapCuts,
  refillRosters,
} from './offseason.js';
import { teamCapUsage, summarizeTeamCap } from '../contracts/cap.js';
import { freeAgents } from './free-agency.js';
import { schemeFitForPlayer } from '../scheme/fit.js';

describe('applyContractExpirations', () => {
  it('drops contracts with yearsRemaining <= 0 and frees their players', () => {
    const league = createLeague({ seed: 'expire-1' });
    // Force one contract to be expired by mutating a copy.
    const team = Object.values(league.teams)[0]!;
    const playerId = team.rosterIds[0]!;
    const contractId = league.players[playerId]!.contractId!;
    const expiredContract = { ...league.contracts[contractId]!, yearsRemaining: 0 };
    const staged = {
      ...league,
      contracts: { ...league.contracts, [contractId]: expiredContract },
    } as typeof league;

    const next = applyContractExpirations(staged);

    expect(next.contracts[contractId]).toBeUndefined();
    expect(next.players[playerId]!.teamId).toBeNull();
    expect(next.players[playerId]!.contractId).toBeNull();
    expect(next.teams[team.identity.id]!.rosterIds).not.toContain(playerId);
  });

  it('is a no-op when no contracts have expired', () => {
    const league = createLeague({ seed: 'expire-noop' });
    const next = applyContractExpirations(league);
    expect(next).toBe(league); // same object — early-return path
  });
});

describe('applyCapCuts', () => {
  it('reduces cap usage on over-cap teams and adds dead money', () => {
    // Lower the cap to ~$160M so most teams generated at $220–260M are over.
    const base = createLeague({ seed: 'cap-cuts' });
    const lowCapLeague = { ...base, salaryCap: 160_000_000 };

    const before = new Map<string, number>();
    for (const team of Object.values(lowCapLeague.teams)) {
      before.set(team.identity.id, teamCapUsage(team, lowCapLeague));
    }

    const next = applyCapCuts(lowCapLeague);

    let teamsThatShed = 0;
    let teamsBroughtUnderCap = 0;
    let totalDead = 0;
    for (const team of Object.values(next.teams)) {
      const usageAfter = teamCapUsage(team, next);
      const usageBefore = before.get(team.identity.id)!;
      if (usageBefore > next.salaryCap && usageAfter < usageBefore) teamsThatShed++;
      if (usageBefore > next.salaryCap && usageAfter <= next.salaryCap) teamsBroughtUnderCap++;
      totalDead += team.deadMoneyByYear[0] ?? 0;
    }
    expect(teamsThatShed).toBeGreaterThan(0);
    expect(teamsBroughtUnderCap).toBeGreaterThan(0);
    expect(totalDead).toBeGreaterThan(0);
    expect(freeAgents(next).length).toBeGreaterThan(0);
  });
});

describe('refillRosters', () => {
  it('fills every team back to 53 when the FA pool is sufficient', () => {
    // Manufacture a pool by releasing some players, then refill.
    let league = createLeague({ seed: 'refill' });

    // Release 5 players from each of 5 teams to create both vacancies + FAs.
    const teamSubset = Object.values(league.teams).slice(0, 5);
    for (const team of teamSubset) {
      const sample = team.rosterIds.slice(0, 5);
      for (const playerId of sample) {
        league = {
          ...league,
          players: {
            ...league.players,
            [playerId]: { ...league.players[playerId]!, teamId: null, contractId: null },
          },
          teams: {
            ...league.teams,
            [team.identity.id]: {
              ...league.teams[team.identity.id]!,
              rosterIds: league.teams[team.identity.id]!.rosterIds.filter((id) => id !== playerId),
            },
          },
        } as typeof league;
        // Drop the player's contract to keep state internally consistent.
        const cId = league.players[playerId]!.contractId; // already null after spread
        if (cId) {
          const { [cId]: _drop, ...rest } = league.contracts;
          void _drop;
          league = { ...league, contracts: rest } as typeof league;
        }
      }
    }

    const next = refillRosters(league, league.tick);

    // The 5 affected teams should be back to 53.
    for (const team of teamSubset) {
      expect(next.teams[team.identity.id]!.rosterIds.length).toBe(53);
    }
  });

  it('end-to-end: advanceSeason produces 53-man rosters with resolvable contracts', () => {
    let league = createLeague({ seed: 'refill-e2e' });
    league = simulateSeason(league);
    league = advanceSeason(league);

    for (const team of Object.values(league.teams)) {
      expect(team.rosterIds.length).toBe(53);
      for (const playerId of team.rosterIds) {
        const player = league.players[playerId]!;
        expect(player.contractId).not.toBeNull();
        const contract = league.contracts[player.contractId!]!;
        expect(contract).toBeDefined();
        expect(contract.yearsRemaining).toBeGreaterThan(0);
      }
    }
  });

  it('end-to-end: cap usage stays in a realistic mid-offseason band', () => {
    let league = createLeague({ seed: 'refill-cap' });
    for (let i = 0; i < 3; i++) {
      league = simulateSeason(league);
      league = advanceSeason(league);
    }
    let total = 0;
    let perTeamMax = 0;
    for (const team of Object.values(league.teams)) {
      const summary = summarizeTeamCap(team, league);
      total += summary.capUsed;
      if (summary.capUsed > perTeamMax) perTeamMax = summary.capUsed;
    }
    const avg = total / Object.values(league.teams).length;
    // No team should be wildly over cap (a hard ceiling at 1.5× the cap).
    expect(perTeamMax).toBeLessThan(league.salaryCap * 1.5);
    // Average should be in a plausible mid-offseason band.
    expect(avg).toBeGreaterThan(120_000_000);
    expect(avg).toBeLessThan(260_000_000);
  });

  it('FA market produces tier-appropriate multi-year contracts', () => {
    let league = createLeague({ seed: 'fa-market-tiers' });
    league = simulateSeason(league);
    league = advanceSeason(league);

    // Inspect the new contracts that the FA market produced this offseason
    // by matching contract.signedOnTick === league.tick.
    const tierToYears: Record<string, Set<number>> = {
      STAR: new Set(),
      STARTER: new Set(),
      BACKUP: new Set(),
      FRINGE: new Set(),
    };
    for (const contract of Object.values(league.contracts)) {
      if (contract.signedOnTick !== league.tick) continue;
      const player = league.players[contract.playerId];
      if (!player) continue;
      tierToYears[player.tier]!.add(contract.realYears);
    }
    // Every tier should have produced at least one freshly-signed FA deal.
    expect(tierToYears.STAR!.size).toBeGreaterThan(0);
    expect(tierToYears.STARTER!.size).toBeGreaterThan(0);
    expect(tierToYears.BACKUP!.size).toBeGreaterThan(0);
    // STAR primary deals are 4yr; allow 1yr (vet-min fill-up) too.
    expect(tierToYears.STAR!.has(4) || tierToYears.STAR!.has(1)).toBe(true);
    expect(tierToYears.STARTER!.has(3) || tierToYears.STARTER!.has(1)).toBe(true);
    expect(tierToYears.BACKUP!.has(2) || tierToYears.BACKUP!.has(1)).toBe(true);
  });

  it('FA market does not push any team above the salary cap', () => {
    let league = createLeague({ seed: 'fa-market-cap' });
    for (let i = 0; i < 5; i++) {
      league = simulateSeason(league);
      league = advanceSeason(league);
      for (const team of Object.values(league.teams)) {
        const used = teamCapUsage(team, league);
        // A team can be at-cap from FA-market signings but never wildly
        // over (the market refuses signings that exceed cap room).
        expect(used).toBeLessThanOrEqual(league.salaryCap);
      }
    }
  });

  it('FA market biases toward scheme-fit destinations', () => {
    // Run a season + advance, then look at fresh STAR signings: their
    // scheme fit at the signing team should be at least 1.0 on average
    // (catalog values run [0.5, 1.7]; pure random selection averages 1.0).
    // The market should systematically beat 1.0.
    const seeds = ['fa-fit-1', 'fa-fit-2', 'fa-fit-3'];
    let total = 0;
    let count = 0;
    for (const seed of seeds) {
      let league = createLeague({ seed });
      league = simulateSeason(league);
      league = advanceSeason(league);
      for (const contract of Object.values(league.contracts)) {
        if (contract.signedOnTick !== league.tick) continue;
        const player = league.players[contract.playerId];
        if (!player || player.tier !== 'STAR') continue;
        if (player.teamId === null) continue;
        const team = league.teams[player.teamId]!;
        const hc = league.coaches[team.headCoachId]!;
        total += schemeFitForPlayer(player, {
          offensiveScheme: hc.offensiveScheme,
          defensiveScheme: hc.defensiveScheme,
        });
        count++;
      }
    }
    expect(count).toBeGreaterThan(0);
    const avg = total / count;
    expect(avg).toBeGreaterThan(1.0);
  });
});
