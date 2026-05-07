import { describe, it, expect } from 'vitest';
import { offensiveSchemeFit, defensiveSchemeFit, schemeFitForPlayer } from './fit.js';

describe('offensiveSchemeFit', () => {
  it('returns the published multiplier for known archetype/scheme pair', () => {
    // QB_DUAL_THREAT in RPO_BASED is set to 1.7 in the catalog.
    expect(offensiveSchemeFit('QB_DUAL_THREAT', 'RPO_BASED')).toBe(1.7);
  });

  it('returns 1.0 (neutral) when archetype is registered but scheme is not in its fit map', () => {
    // Some archetypes don't list every scheme; default is neutral.
    // Lookup for an absent scheme returns 1.0.
    // Construct by calling with a scheme we know isn't listed.
    // Note: catalog as written tends to specify all schemes for QB
    // archetypes, so use a defensive archetype passed an offensive scheme:
    expect(offensiveSchemeFit('DL_PENETRATING_DT', 'WEST_COAST')).toBe(1.0);
  });

  it('returns 1.0 for unknown archetypes', () => {
    expect(offensiveSchemeFit('NOT_A_REAL_ARCHETYPE' as never, 'WEST_COAST')).toBe(1.0);
  });
});

describe('defensiveSchemeFit', () => {
  it('returns the published multiplier for known archetype/scheme pair', () => {
    // DL_NOSE_TACKLE in BASE_3_4 is set to 1.7 in the catalog.
    expect(defensiveSchemeFit('DL_NOSE_TACKLE', 'BASE_3_4')).toBe(1.7);
  });

  it('Press CB performs poorly in Cover 2 Shell (per catalog: 0.85)', () => {
    expect(defensiveSchemeFit('DB_PRESS_CB', 'COVER_2_SHELL')).toBe(0.85);
  });

  it('returns 1.0 when offensive archetype passed to defensive lookup', () => {
    expect(defensiveSchemeFit('QB_PRECISION_PASSER', 'BASE_4_3')).toBe(1.0);
  });
});

describe('schemeFitForPlayer', () => {
  it('routes offensive archetype through offensive scheme', () => {
    const fit = schemeFitForPlayer(
      { archetype: 'QB_DUAL_THREAT' },
      { offensiveScheme: 'RPO_BASED', defensiveScheme: 'BASE_4_3' },
    );
    expect(fit).toBe(1.7);
  });

  it('routes defensive archetype through defensive scheme', () => {
    const fit = schemeFitForPlayer(
      { archetype: 'DL_NOSE_TACKLE' },
      { offensiveScheme: 'WEST_COAST', defensiveScheme: 'BASE_3_4' },
    );
    expect(fit).toBe(1.7);
  });

  it('special teams archetypes are always neutral', () => {
    const fit = schemeFitForPlayer(
      { archetype: 'ST_KICKER' },
      { offensiveScheme: 'WEST_COAST', defensiveScheme: 'BASE_4_3' },
    );
    expect(fit).toBe(1.0);
  });

  it('unknown archetypes are neutral', () => {
    const fit = schemeFitForPlayer(
      { archetype: 'BOGUS' },
      { offensiveScheme: 'WEST_COAST', defensiveScheme: 'BASE_4_3' },
    );
    expect(fit).toBe(1.0);
  });
});
