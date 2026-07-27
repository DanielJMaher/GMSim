import { describe, it, expect } from 'vitest';
import { createLeague } from '../league/generate.js';
import { simulateSeason } from '../season/runner.js';
import { availableRoster, matchupFacets } from './strength.js';
import type { InjuryStatus, Player } from '../types/player.js';
import type { TeamState } from '../types/team.js';
import type { LeagueState } from '../types/league.js';

const QB_KEYS = [
  'accuracyShort', 'accuracyMedium', 'accuracyDeep', 'accuracyLeft', 'accuracyMiddle',
  'accuracyRight', 'throwPower', 'decisionMaking', 'throwUnderPressure', 'footballIq',
] as const;
const qbScore = (p: Player): number =>
  QB_KEYS.reduce((s, k) => s + p.current[k], 0) / QB_KEYS.length;

function injure(
  league: LeagueState,
  playerId: string,
  patch: Partial<InjuryStatus> = {},
): LeagueState {
  const p = league.players[playerId]!;
  const injury: InjuryStatus = {
    type: 'shoulder',
    severity: 'MODERATE',
    occurredOnTick: 0,
    estimatedReturnTick: 5,
    ...patch,
  };
  return { ...league, players: { ...league.players, [playerId]: { ...p, injury } } };
}

describe('availableRoster (Injury Realism §3.2 transmission fix)', () => {
  it('excludes a player with an active injury; includes healthy players', () => {
    const league = createLeague({ seed: 'avail-basic' });
    const team = Object.values(league.teams)[0]! as TeamState;
    const healthyId = team.rosterIds[0]!;
    const before = availableRoster(team, league);
    expect(before.map((p) => p.id)).toContain(healthyId);

    const league2 = injure(league, healthyId);
    const after = availableRoster(team, league2);
    expect(after.map((p) => p.id)).not.toContain(healthyId);
    expect(after.length).toBe(before.length - 1);
  });

  it('a MODERATE-injured QB1 is excluded and the backup seats into the qbPlay facet', () => {
    const league = createLeague({ seed: 'avail-qb' });
    const team = Object.values(league.teams)[0]! as TeamState;
    const qbs = team.rosterIds
      .map((id) => league.players[id]!)
      .filter((p) => p.position === 'QB')
      .sort((a, b) => qbScore(b) - qbScore(a));
    expect(qbs.length).toBeGreaterThanOrEqual(2); // need a backup to seat

    const qb1 = qbs[0]!;
    const facetHealthy = matchupFacets(team, league).qbPlay;
    const league2 = injure(league, qb1.id, { severity: 'MODERATE' });
    const facetInjured = matchupFacets(team, league2).qbPlay;

    // QB1 out ⇒ QB2 seats ⇒ the top-1 QB facet drops (this is the whole point:
    // a MODERATE injury now transmits, where before it was a no-op).
    expect(facetInjured).toBeLessThan(facetHealthy);
    expect(availableRoster(team, league2).map((p) => p.id)).not.toContain(qb1.id);
  });

  it('recovers on schedule: once the injury clears, the player is available again', () => {
    const league = createLeague({ seed: 'avail-recover' });
    const team = Object.values(league.teams)[0]! as TeamState;
    const id = team.rosterIds[0]!;
    const injured = injure(league, id);
    expect(availableRoster(team, injured).map((p) => p.id)).not.toContain(id);
    // Clearing the injury (what recoverInjuries does at the return tick) restores availability.
    const healed = { ...injured, players: { ...injured.players, [id]: { ...injured.players[id]!, injury: null } } };
    expect(availableRoster(team, healed).map((p) => p.id)).toContain(id);
  });
});

describe('interim head-injury type (Injury Realism §6 / §13.4)', () => {
  it('every head injury is a fixed 3-week absence and stays off IR', () => {
    const league = simulateSeason(createLeague({ seed: 'head-inj' }));
    const heads = Object.values(league.players).filter((p) => p.injury?.type === 'head');
    // A 32-team season at Stage-I rates produces head injuries under any seed.
    expect(heads.length).toBeGreaterThan(0);
    for (const p of heads) {
      // Fixed 3-week absence: estimatedReturnTick - occurredOnTick === 3.
      expect(p.injury!.estimatedReturnTick - p.injury!.occurredOnTick).toBe(3);
      // No severity roll ⇒ never MAJOR ⇒ never scarred to IR.
      expect(p.injury!.severity).not.toBe('MAJOR');
    }
    // Head players are never on any IR list (they stay rostered, out via the filter).
    const irIds = new Set(Object.values(league.teams).flatMap((t) => [...t.injuredReserveIds]));
    for (const p of heads) expect(irIds.has(p.id)).toBe(false);
  });
});

describe('Stage-I injury rate magnitude (M-INJ.1 scale)', () => {
  it('produces a realistic attrition level — far above the old doc-guess rates', () => {
    const league = simulateSeason(createLeague({ seed: 'inj-rate-mag' }));
    // At the old rates a season left only a handful active at season-end; the
    // recalibrated table (QB ~0.035, non-QB ~19×) means dozens of players are
    // injured/IR at any snapshot. Season-end active-injury count is a lower
    // bound (most events have already healed) — assert it is clearly non-trivial.
    const activeAtEnd = Object.values(league.players).filter((p) => p.injury !== null).length;
    const irAtEnd = Object.values(league.teams).reduce((s, t) => s + t.injuredReserveIds.length, 0);
    expect(activeAtEnd).toBeGreaterThan(15);
    expect(irAtEnd).toBeGreaterThan(15);
  });
});
