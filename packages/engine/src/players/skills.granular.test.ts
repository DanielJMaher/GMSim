import { describe, it, expect } from 'vitest';
import { Prng } from '../prng/index.js';
import { rollSkills } from './skills.js';
import { GRANULAR_KEYS } from './skill-keys.js';
import { getArchetypeById, type ArchetypeId } from '../archetypes/index.js';
import type { PlayerSkills } from '../types/player.js';

/** Mean of a granular skill across many PRIME rolls of an archetype. */
function meanSkill(archetypeId: ArchetypeId, key: keyof PlayerSkills, n = 200): number {
  const arch = getArchetypeById(archetypeId)!;
  let sum = 0;
  const prng = new Prng(`gran:${archetypeId}:${key}`);
  for (let i = 0; i < n; i++) {
    sum += rollSkills(prng.fork(`p${i}`), arch, 'PRIME').current[key];
  }
  return sum / n;
}

describe('granular skill differentiation (Stage 2)', () => {
  it('every roll populates the full granular set', () => {
    const arch = getArchetypeById('DL_EDGE_PASS_RUSHER')!;
    const skills = rollSkills(new Prng('full'), arch, 'PRIME').current;
    for (const key of GRANULAR_KEYS) {
      expect(skills[key]).toBeGreaterThanOrEqual(1);
      expect(skills[key]).toBeLessThanOrEqual(99);
    }
  });

  it('speed-rush edge favors finesse moves; run-setting end favors power + block shed', () => {
    const speedFinesse = meanSkill('DL_EDGE_PASS_RUSHER', 'swimMove');
    const speedPower = meanSkill('DL_EDGE_PASS_RUSHER', 'bullRush');
    const speedBend = meanSkill('DL_EDGE_PASS_RUSHER', 'bend');
    expect(speedFinesse).toBeGreaterThan(speedPower);
    expect(speedBend).toBeGreaterThan(speedPower);

    const runPower = meanSkill('DL_TWO_GAP_DE', 'bullRush');
    const runFinesse = meanSkill('DL_TWO_GAP_DE', 'swimMove');
    const runShed = meanSkill('DL_TWO_GAP_DE', 'blockShedding');
    expect(runPower).toBeGreaterThan(runFinesse);
    expect(runShed).toBeGreaterThan(runFinesse);

    // The two profiles are genuinely different, not just tier noise:
    // the speed rusher out-bends the run-setter, who out-powers him.
    expect(speedBend).toBeGreaterThan(meanSkill('DL_TWO_GAP_DE', 'bend'));
    expect(runPower).toBeGreaterThan(speedPower);
  });

  it('press corner favors man + press; zone corner favors zone + ball skills', () => {
    expect(meanSkill('DB_PRESS_CB', 'manCoverage')).toBeGreaterThan(
      meanSkill('DB_PRESS_CB', 'zoneCoverage'),
    );
    expect(meanSkill('DB_ZONE_CB', 'zoneCoverage')).toBeGreaterThan(
      meanSkill('DB_ZONE_CB', 'manCoverage'),
    );
    expect(meanSkill('DB_ZONE_CB', 'ballSkills')).toBeGreaterThan(
      meanSkill('DB_PRESS_CB', 'ballSkills'),
    );
  });

  it('vertical QB favors deep accuracy + spectacular; precision QB favors short accuracy', () => {
    expect(meanSkill('QB_VERTICAL_PASSER', 'accuracyDeep')).toBeGreaterThan(
      meanSkill('QB_VERTICAL_PASSER', 'accuracyShort'),
    );
    expect(meanSkill('QB_VERTICAL_PASSER', 'spectacularThrow')).toBeGreaterThan(
      meanSkill('QB_PRECISION_PASSER', 'spectacularThrow'),
    );
    expect(meanSkill('QB_PRECISION_PASSER', 'accuracyShort')).toBeGreaterThan(
      meanSkill('QB_PRECISION_PASSER', 'accuracyDeep'),
    );
  });

  it('power back favors trucking/break-tackle; receiving back favors catching/routes', () => {
    expect(meanSkill('RB_POWER_BACK', 'trucking')).toBeGreaterThan(
      meanSkill('RB_RECEIVING_BACK', 'trucking'),
    );
    expect(meanSkill('RB_RECEIVING_BACK', 'catching')).toBeGreaterThan(
      meanSkill('RB_POWER_BACK', 'catching'),
    );
  });

  it('zone OL favors run-block finesse; power OL favors run-block power', () => {
    expect(meanSkill('OL_ZONE_BLOCKER', 'runBlockFinesse')).toBeGreaterThan(
      meanSkill('OL_ZONE_BLOCKER', 'runBlockPower'),
    );
    expect(meanSkill('OL_POWER_BLOCKER', 'runBlockPower')).toBeGreaterThan(
      meanSkill('OL_POWER_BLOCKER', 'runBlockFinesse'),
    );
  });

  it('ball-hawk safety favors ball skills/zone; box safety favors tackle/hit power', () => {
    expect(meanSkill('DB_BALL_HAWK_S', 'ballSkills')).toBeGreaterThan(
      meanSkill('DB_BOX_S', 'ballSkills'),
    );
    expect(meanSkill('DB_BOX_S', 'hitPower')).toBeGreaterThan(
      meanSkill('DB_BALL_HAWK_S', 'hitPower'),
    );
  });

  it('run-stopping ILB favors block-shed/tackle; coverage LB favors zone coverage', () => {
    expect(meanSkill('LB_3_4_ILB', 'blockShedding')).toBeGreaterThan(
      meanSkill('LB_COVERAGE', 'blockShedding'),
    );
    expect(meanSkill('LB_COVERAGE', 'zoneCoverage')).toBeGreaterThan(
      meanSkill('LB_3_4_ILB', 'zoneCoverage'),
    );
  });

  it('penetrating DT favors get-off/finesse; nose tackle favors block-shed/power', () => {
    expect(meanSkill('DL_PENETRATING_DT', 'getOff')).toBeGreaterThan(
      meanSkill('DL_NOSE_TACKLE', 'getOff'),
    );
    expect(meanSkill('DL_NOSE_TACKLE', 'blockShedding')).toBeGreaterThan(
      meanSkill('DL_NOSE_TACKLE', 'swimMove'),
    );
  });

  it('deep-threat WR favors deep routes + release vs off; possession WR favors short routes + release vs press', () => {
    expect(meanSkill('WR_DEEP_THREAT', 'routeDeep')).toBeGreaterThan(
      meanSkill('WR_DEEP_THREAT', 'routeShort'),
    );
    expect(meanSkill('WR_DEEP_THREAT', 'releaseVsOff')).toBeGreaterThan(
      meanSkill('WR_DEEP_THREAT', 'releaseVsPress'),
    );
    expect(meanSkill('WR_POSSESSION', 'releaseVsPress')).toBeGreaterThan(
      meanSkill('WR_POSSESSION', 'routeDeep'),
    );
  });
});
