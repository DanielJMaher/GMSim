import { describe, it, expect } from 'vitest';
import { Prng } from '../prng/index.js';
import { generateContract } from './generate.js';
import { generatePlayer } from '../players/generate.js';
import { Position } from '../types/enums.js';
import { TeamId } from '../types/ids.js';
import { currentCapHit } from './cap.js';
import { TIER_TEMPLATES } from './tiers.js';

function makePlayer() {
  const p = generatePlayer(new Prng('p-seed'), { position: Position.QB, idSuffix: 'x' });
  return { ...p, teamId: TeamId('TST') };
}

describe('generateContract', () => {
  it('is deterministic for the same prng + options', () => {
    const player = makePlayer();
    const a = generateContract(new Prng('c-seed'), { player, idSuffix: 'x', currentTick: 0 });
    const b = generateContract(new Prng('c-seed'), { player, idSuffix: 'x', currentTick: 0 });
    expect(a).toEqual(b);
  });

  it('contract length matches the tier template range for the player tier', () => {
    for (let i = 0; i < 50; i++) {
      const player = generatePlayer(new Prng(`p-${i}`), {
        position: Position.WR,
        idSuffix: String(i),
      });
      const playerWithTeam = { ...player, teamId: TeamId('TST') };
      const template = TIER_TEMPLATES[player.tier];
      const contract = generateContract(new Prng(`c-${i}`), {
        player: playerWithTeam,
        idSuffix: 'x',
        currentTick: 0,
      });
      expect(contract.realYears).toBeGreaterThanOrEqual(template.yearsRange[0]);
      expect(contract.realYears).toBeLessThanOrEqual(template.yearsRange[1]);
    }
  });

  it('yearsRemaining is in [1, realYears]', () => {
    for (let i = 0; i < 30; i++) {
      const player = makePlayer();
      const c = generateContract(new Prng(`yr-${i}`), {
        player,
        idSuffix: 'x',
        currentTick: 0,
      });
      expect(c.yearsRemaining).toBeGreaterThanOrEqual(1);
      expect(c.yearsRemaining).toBeLessThanOrEqual(c.realYears);
    }
  });

  it('baseSalaries length matches realYears', () => {
    const player = makePlayer();
    const c = generateContract(new Prng('s'), { player, idSuffix: 'x', currentTick: 0 });
    expect(c.baseSalaries.length).toBe(c.realYears);
  });

  it('signedOnTick is in the past relative to currentTick', () => {
    const player = makePlayer();
    const c = generateContract(new Prng('t'), {
      player,
      idSuffix: 'x',
      currentTick: 100,
    });
    expect(c.signedOnTick).toBeLessThanOrEqual(100);
  });

  it('current cap hit is positive for any tier', () => {
    for (let i = 0; i < 30; i++) {
      const player = generatePlayer(new Prng(`p-${i}`), {
        position: Position.RB,
        idSuffix: String(i),
      });
      const playerWithTeam = { ...player, teamId: TeamId('TST') };
      const c = generateContract(new Prng(`c-${i}`), {
        player: playerWithTeam,
        idSuffix: 'x',
        currentTick: 0,
      });
      expect(currentCapHit(c)).toBeGreaterThan(0);
    }
  });
});
