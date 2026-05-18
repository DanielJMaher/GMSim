import { describe, it, expect } from 'vitest';
import { createLeague } from '../league/generate.js';
import { evaluatePlayerValue, evaluateTradePackage, evaluatePickValue } from './value.js';
import { CompetitiveWindow, Position } from '../types/enums.js';
import type { LeagueState } from '../types/league.js';
import type { Player } from '../types/player.js';
import type { TeamState } from '../types/team.js';
import type { DraftPickAsset } from '../types/college.js';

describe('evaluatePlayerValue', () => {
  it('produces a positive total + populated breakdown for any player/team pairing', () => {
    const league = createLeague({ seed: 'tv-basic' });
    const team = Object.values(league.teams)[0]!;
    const player = Object.values(league.players)[0]!;
    const v = evaluatePlayerValue(team, player, league);
    expect(v.total).toBeGreaterThan(0);
    expect(v.totalDollars).toBeCloseTo(v.total * 1_000_000, 5);
    // All five factors should have a multiplier > 0.
    expect(v.factors.ability.multiplier).toBeGreaterThan(0);
    expect(v.factors.schemeFit.multiplier).toBeGreaterThan(0);
    expect(v.factors.ageContract.multiplier).toBeGreaterThan(0);
    expect(v.factors.positional.multiplier).toBeGreaterThan(0);
    expect(v.factors.timing.multiplier).toBeGreaterThan(0);
    // Rationales should be human-readable non-empty strings.
    expect(v.factors.ability.rationale.length).toBeGreaterThan(0);
    expect(v.factors.positional.rationale.length).toBeGreaterThan(0);
  });

  it('STAR QB on a contender out-values a STARTER LS by a wide margin', () => {
    const league = createLeague({ seed: 'tv-position-hierarchy' });
    const team = Object.values(league.teams)[0]!;
    // Hand-build two synthetic players: STAR QB vs STARTER LS.
    const qb = makeSynthetic(league, { tier: 'STAR', position: Position.QB });
    const ls = makeSynthetic(league, { tier: 'STARTER', position: Position.LS });
    const contender: TeamState = {
      ...team,
      competitiveWindow: CompetitiveWindow.CONTENDER,
    };
    const qbValue = evaluatePlayerValue(contender, qb, league);
    const lsValue = evaluatePlayerValue(contender, ls, league);
    // QB on contender should be much more valuable than a LS — positional
    // multipliers alone (QB 2.0, LS 0.4) put QB at 5x; tier (STAR vs
    // STARTER) adds another 2.8x for ~14x. Synthetic players inherit
    // skills/archetype from a template so we don't pin a tighter bound.
    expect(qbValue.total).toBeGreaterThan(lsValue.total * 10);
    expect(qbValue.factors.positional.multiplier).toBeGreaterThan(
      lsValue.factors.positional.multiplier * 3,
    );
  });

  it('contender pays a win-now premium for veteran STARs vs rebuilder discount', () => {
    const league = createLeague({ seed: 'tv-window-premium' });
    const baseTeam = Object.values(league.teams)[0]!;
    const contender: TeamState = {
      ...baseTeam,
      competitiveWindow: CompetitiveWindow.CONTENDER,
    };
    const rebuilder: TeamState = {
      ...baseTeam,
      competitiveWindow: CompetitiveWindow.REBUILDING,
    };
    // Veteran STAR (experienceYears 10) — rebuilder shouldn't want him.
    const vetStar = makeSynthetic(league, {
      tier: 'STAR',
      position: Position.WR,
      experienceYears: 10,
    });
    const contenderValue = evaluatePlayerValue(contender, vetStar, league);
    const rebuilderValue = evaluatePlayerValue(rebuilder, vetStar, league);
    expect(contenderValue.factors.timing.multiplier).toBeGreaterThan(
      rebuilderValue.factors.timing.multiplier,
    );
    expect(contenderValue.total).toBeGreaterThan(rebuilderValue.total);
  });

  it('rebuilder pays a premium for young STARs', () => {
    const league = createLeague({ seed: 'tv-young-asset' });
    const baseTeam = Object.values(league.teams)[0]!;
    const rebuilder: TeamState = {
      ...baseTeam,
      competitiveWindow: CompetitiveWindow.REBUILDING,
    };
    const stagnant: TeamState = {
      ...baseTeam,
      competitiveWindow: CompetitiveWindow.STAGNANT,
    };
    const youngStar = makeSynthetic(league, {
      tier: 'STAR',
      position: Position.EDGE,
      experienceYears: 2,
    });
    const rebuilderValue = evaluatePlayerValue(rebuilder, youngStar, league);
    const stagnantValue = evaluatePlayerValue(stagnant, youngStar, league);
    expect(rebuilderValue.factors.timing.multiplier).toBeGreaterThan(
      stagnantValue.factors.timing.multiplier,
    );
  });

  it('age curve reduces value sharply past 33', () => {
    const league = createLeague({ seed: 'tv-age-curve' });
    const team = Object.values(league.teams)[0]!;
    const prime = makeSyntheticAged(league, { tier: 'STARTER', position: Position.WR }, 27);
    const aging = makeSyntheticAged(league, { tier: 'STARTER', position: Position.WR }, 35);
    const primeValue = evaluatePlayerValue(team, prime, league);
    const agingValue = evaluatePlayerValue(team, aging, league);
    expect(agingValue.total).toBeLessThan(primeValue.total * 0.85);
  });

  it('is deterministic — same league + same player + same team → same value', () => {
    const a = createLeague({ seed: 'tv-determ' });
    const b = createLeague({ seed: 'tv-determ' });
    const teamA = Object.values(a.teams)[0]!;
    const teamB = Object.values(b.teams)[0]!;
    const playerA = Object.values(a.players)[0]!;
    const playerB = b.players[playerA.id]!;
    const vA = evaluatePlayerValue(teamA, playerA, a);
    const vB = evaluatePlayerValue(teamB, playerB, b);
    expect(vA.total).toBe(vB.total);
    expect(vA.factors.ability.multiplier).toBe(vB.factors.ability.multiplier);
    expect(vA.factors.schemeFit.multiplier).toBe(vB.factors.schemeFit.multiplier);
  });
});

describe('evaluateTradePackage', () => {
  it('positive netValue when team receives more value than it gives', () => {
    const league = createLeague({ seed: 'tv-package-positive' });
    const team = Object.values(league.teams)[0]!;
    const star = makeSynthetic(league, { tier: 'STAR', position: Position.WR });
    const backup = makeSynthetic(league, { tier: 'BACKUP', position: Position.WR });
    const pkg = evaluateTradePackage(team, [star], [backup], league);
    expect(pkg.netValue).toBeGreaterThan(0);
    expect(pkg.received).toHaveLength(1);
    expect(pkg.given).toHaveLength(1);
  });

  it('negative netValue when team gives away more than it receives', () => {
    const league = createLeague({ seed: 'tv-package-negative' });
    const team = Object.values(league.teams)[0]!;
    const star = makeSynthetic(league, { tier: 'STAR', position: Position.WR });
    const backup = makeSynthetic(league, { tier: 'BACKUP', position: Position.WR });
    const pkg = evaluateTradePackage(team, [backup], [star], league);
    expect(pkg.netValue).toBeLessThan(0);
  });

  it('netValue is the difference of received and given totals', () => {
    const league = createLeague({ seed: 'tv-package-sum' });
    const team = Object.values(league.teams)[0]!;
    const players = Object.values(league.players).slice(0, 4);
    const pkg = evaluateTradePackage(team, [players[0]!, players[1]!], [players[2]!, players[3]!], league);
    const recv = pkg.received.reduce((s, r) => s + r.breakdown.total, 0);
    const giv = pkg.given.reduce((s, g) => s + g.breakdown.total, 0);
    expect(pkg.netValue).toBeCloseTo(recv - giv, 5);
  });
});

describe('evaluatePickValue', () => {
  it('produces a positive total + chart + modifier breakdown', () => {
    const league = createLeague({ seed: 'pv-basic' });
    const team = Object.values(league.teams)[0]!;
    const pick = league.draftPicks.find((p) => p.round === 1)!;
    const v = evaluatePickValue(team, pick, league);
    expect(v.total).toBeGreaterThan(0);
    expect(v.totalDollars).toBeCloseTo(v.total * 1_000_000, 5);
    expect(v.factors.chart.rationale).toContain('R1');
    expect(v.factors.modifiers.multiplier).toBeGreaterThan(0);
  });

  it('current-year R1 out-values future-year R3 by a wide margin', () => {
    const league = createLeague({ seed: 'pv-tier' });
    const team = Object.values(league.teams)[0]!;
    // Pin a R1 picking this year vs a R3 picking 2 years out.
    const currentR1: DraftPickAsset = {
      ...league.draftPicks.find((p) => p.round === 1)!,
      seasonNumber: league.seasonNumber,
    };
    const futureR3: DraftPickAsset = {
      ...league.draftPicks.find((p) => p.round === 3)!,
      seasonNumber: league.seasonNumber + 2,
    };
    const vR1 = evaluatePickValue(team, currentR1, league);
    const vR3 = evaluatePickValue(team, futureR3, league);
    expect(vR1.total).toBeGreaterThan(vR3.total * 5);
  });

  it('rebuilder values incoming future picks more than a contender', () => {
    const league = createLeague({ seed: 'pv-modifier' });
    const baseTeam = Object.values(league.teams)[0]!;
    const rebuilder: TeamState = {
      ...baseTeam,
      competitiveWindow: CompetitiveWindow.REBUILDING,
    };
    const contender: TeamState = {
      ...baseTeam,
      competitiveWindow: CompetitiveWindow.CHAMPIONSHIP,
    };
    const futureR2: DraftPickAsset = {
      ...league.draftPicks.find((p) => p.round === 2)!,
      seasonNumber: league.seasonNumber + 1,
    };
    const rebuilderValue = evaluatePickValue(rebuilder, futureR2, league);
    const contenderValue = evaluatePickValue(contender, futureR2, league);
    expect(rebuilderValue.total).toBeGreaterThan(contenderValue.total);
  });
});

describe('evaluateTradePackage with picks', () => {
  it('mixed player+pick package netValue sums across both asset types', () => {
    const league = createLeague({ seed: 'tp-mixed' });
    const team = Object.values(league.teams)[0]!;
    const incomingPlayer = Object.values(league.players)[0]!;
    const outgoingPlayer = Object.values(league.players)[1]!;
    const incomingPick = league.draftPicks.find((p) => p.round === 2)!;
    const outgoingPick = league.draftPicks.find(
      (p) => p.round === 5 && p.id !== incomingPick.id,
    )!;

    const evalWithPicks = evaluateTradePackage(
      team,
      [incomingPlayer],
      [outgoingPlayer],
      league,
      { incoming: [incomingPick], outgoing: [outgoingPick] },
    );
    const evalWithoutPicks = evaluateTradePackage(
      team,
      [incomingPlayer],
      [outgoingPlayer],
      league,
    );

    const incomingPickValue = evaluatePickValue(team, incomingPick, league).total;
    const outgoingPickValue = evaluatePickValue(team, outgoingPick, league).total;
    const expectedDelta = incomingPickValue - outgoingPickValue;
    expect(evalWithPicks.netValue - evalWithoutPicks.netValue).toBeCloseTo(
      expectedDelta,
      5,
    );
    expect(evalWithPicks.receivedPicks.length).toBe(1);
    expect(evalWithPicks.givenPicks.length).toBe(1);
  });

  it('empty picks arrays produce identical result to omitting the picks arg', () => {
    const league = createLeague({ seed: 'tp-empty' });
    const team = Object.values(league.teams)[0]!;
    const a = Object.values(league.players)[0]!;
    const b = Object.values(league.players)[1]!;
    const withEmpty = evaluateTradePackage(team, [a], [b], league, {
      incoming: [],
      outgoing: [],
    });
    const without = evaluateTradePackage(team, [a], [b], league);
    expect(withEmpty.netValue).toBe(without.netValue);
    expect(withEmpty.receivedPicks).toEqual([]);
    expect(withEmpty.givenPicks).toEqual([]);
  });
});

// ─── helpers ────────────────────────────────────────────────────────────

/**
 * Build a synthetic player off a real template, overriding tier and
 * position. Uses an existing player as the template so all required
 * fields (skills, archetype, moodProfile, etc.) come along.
 */
function makeSynthetic(
  league: LeagueState,
  overrides: Partial<Pick<Player, 'tier' | 'position' | 'experienceYears'>>,
): Player {
  const template = Object.values(league.players)[0]!;
  return {
    ...template,
    id: `SYN_${Math.random().toString(36).slice(2, 8)}` as Player['id'],
    tier: overrides.tier ?? template.tier,
    position: overrides.position ?? template.position,
    experienceYears: overrides.experienceYears ?? template.experienceYears,
  };
}

/** Variant that also sets a birthDate to produce a target age. */
function makeSyntheticAged(
  league: LeagueState,
  overrides: Partial<Pick<Player, 'tier' | 'position'>>,
  targetAge: number,
): Player {
  const base = makeSynthetic(league, overrides);
  const simYear = 2026 + (league.seasonNumber - 1);
  const birthYear = simYear - targetAge;
  return { ...base, birthDate: `${birthYear}-06-15` };
}
