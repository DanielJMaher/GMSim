import { describe, it, expect } from 'vitest';
import { offensiveSchemeFit, defensiveSchemeFit, schemeFitForPlayer } from './fit.js';
import { ALL_SKILL_KEYS } from '../players/skill-keys.js';
import type { PlayerSkills } from '../types/player.js';

/** A full skill set with every attribute set to `v`. */
function skillsAll(v: number): PlayerSkills {
  const s = {} as Record<string, number>;
  for (const k of ALL_SKILL_KEYS) s[k] = v;
  return s as unknown as PlayerSkills;
}

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

  // ── Role-based modulation (v0.96, Stage 3) ──────────────────────────
  it('bare archetype (no skills) falls back to the raw baseline', () => {
    // DL_EDGE_PASS_RUSHER in BASE_4_3 is 1.5 in the catalog.
    expect(
      schemeFitForPlayer(
        { archetype: 'DL_EDGE_PASS_RUSHER' },
        { offensiveScheme: 'WEST_COAST', defensiveScheme: 'BASE_4_3' },
      ),
    ).toBe(1.5);
  });

  it('a blue-chip edge realizes the premium fit; a scrub edge is ~neutral', () => {
    const scheme = { offensiveScheme: 'WEST_COAST', defensiveScheme: 'BASE_4_3' } as const;
    const elite = schemeFitForPlayer(
      { archetype: 'DL_EDGE_PASS_RUSHER', current: skillsAll(92) },
      scheme,
    );
    const scrub = schemeFitForPlayer(
      { archetype: 'DL_EDGE_PASS_RUSHER', current: skillsAll(48) },
      scheme,
    );
    expect(elite).toBeGreaterThan(1.4); // near the full 1.5
    expect(scrub).toBeLessThan(1.1); // no premium — replaceable
    expect(elite).toBeGreaterThan(scrub);
  });

  it('a blue-chip transcends a non-ideal scheme; a role player is scheme-locked', () => {
    // DB_PRESS_CB in COVER_2_SHELL is a 0.85 penalty baseline.
    const scheme = { offensiveScheme: 'WEST_COAST', defensiveScheme: 'COVER_2_SHELL' } as const;
    const elite = schemeFitForPlayer({ archetype: 'DB_PRESS_CB', current: skillsAll(92) }, scheme);
    const scrub = schemeFitForPlayer({ archetype: 'DB_PRESS_CB', current: skillsAll(48) }, scheme);
    expect(elite).toBeGreaterThan(0.97); // fits everywhere
    expect(scrub).toBeLessThan(0.9); // takes the scheme penalty
  });
});
