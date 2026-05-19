import { describe, expect, it } from 'vitest';
import { Prng } from '../prng/index.js';
import { generateCollegePlayer } from './generate-college-player.js';
import { Position } from '../types/enums.js';
import { COLLEGE_SCHOOLS, getSchoolById } from '../data/colleges/index.js';

const ALABAMA = getSchoolById('ALABAMA')!;
const NDSU = getSchoolById('NORTH_DAKOTA_STATE')!;

describe('generateCollegePlayer', () => {
  it('is deterministic for the same seed', () => {
    const a = generateCollegePlayer(new Prng('seed'), {
      idSuffix: 'TEST_0',
      classYear: 'JR',
      school: ALABAMA,
      simYear: 2026,
    });
    const b = generateCollegePlayer(new Prng('seed'), {
      idSuffix: 'TEST_0',
      classYear: 'JR',
      school: ALABAMA,
      simYear: 2026,
    });
    expect(a).toEqual(b);
  });

  it('produces a CP_-prefixed PlayerId', () => {
    const cp = generateCollegePlayer(new Prng('seed'), {
      idSuffix: 'X1',
      classYear: 'SR',
      school: ALABAMA,
      simYear: 2026,
    });
    expect(cp.id).toMatch(/^CP_/);
  });

  it('marks JR/SR/RS_SR as draft-eligible and earlier years as not', () => {
    // v0.53: SR/RS_SR auto-declare at generation (eligibility runs
    // out — they have no choice but to enter the next draft). JRs
    // stay undeclared at gen and roll declaration each cycle.
    const cases: Array<['TRUE_FR' | 'RS_FR' | 'SO' | 'JR' | 'SR' | 'RS_SR', boolean, boolean]> = [
      ['TRUE_FR', false, false],
      ['RS_FR', false, false],
      ['SO', false, false],
      ['JR', true, false],
      ['SR', true, true],
      ['RS_SR', true, true],
    ];
    for (const [year, expectedEligible, expectedDeclared] of cases) {
      const cp = generateCollegePlayer(new Prng(`seed-${year}`), {
        idSuffix: `Y_${year}`,
        classYear: year,
        school: ALABAMA,
        simYear: 2026,
      });
      expect(cp.classYear).toBe(year);
      expect(cp.isDraftEligible).toBe(expectedEligible);
      expect(cp.hasDeclared).toBe(expectedDeclared);
    }
  });

  it('records the school they currently attend', () => {
    const cp = generateCollegePlayer(new Prng('seed'), {
      idSuffix: 'X',
      classYear: 'JR',
      school: NDSU,
      simYear: 2026,
    });
    expect(cp.schoolId).toBe('NORTH_DAKOTA_STATE');
  });

  it('produces full skill ratings (current + ceiling) where ceiling >= current per skill', () => {
    const cp = generateCollegePlayer(new Prng('skills-test'), {
      idSuffix: 'S',
      classYear: 'JR',
      school: ALABAMA,
      simYear: 2026,
    });
    for (const key of Object.keys(cp.current) as (keyof typeof cp.current)[]) {
      expect(cp.ceiling[key]).toBeGreaterThanOrEqual(cp.current[key]);
    }
  });

  it('roughly 14% of prospects are conversion candidates across a large sample', () => {
    let conversions = 0;
    const SAMPLES = 600;
    for (let i = 0; i < SAMPLES; i++) {
      const cp = generateCollegePlayer(new Prng(`conv-${i}`), {
        idSuffix: `C${i}`,
        classYear: 'JR',
        school: ALABAMA,
        simYear: 2026,
      });
      if (cp.isConversionCandidate) {
        conversions++;
        // When conversion, projected position differs from college position
        expect(cp.nflProjectedPosition).not.toBe(cp.collegePosition);
      } else {
        expect(cp.nflProjectedPosition).toBe(cp.collegePosition);
      }
    }
    const rate = conversions / SAMPLES;
    // Some positions (K/P/LS) have no conversion path so the realized
    // rate is just under the design 14%. Allow [0.06, 0.20].
    expect(rate).toBeGreaterThanOrEqual(0.06);
    expect(rate).toBeLessThanOrEqual(0.20);
  });

  it('all conversion candidates carry a non-empty alternates list', () => {
    let checked = 0;
    for (let i = 0; i < 400; i++) {
      const cp = generateCollegePlayer(new Prng(`conv-alt-${i}`), {
        idSuffix: `CA${i}`,
        classYear: 'JR',
        school: ALABAMA,
        simYear: 2026,
      });
      if (cp.isConversionCandidate) {
        expect(cp.alternatePositions.length).toBeGreaterThan(0);
        expect(cp.alternatePositions).toContain(cp.collegePosition);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('archetypeMisreadFlag agrees with archetype !== assumedArchetype', () => {
    for (let i = 0; i < 80; i++) {
      const cp = generateCollegePlayer(new Prng(`misread-${i}`), {
        idSuffix: `M${i}`,
        classYear: 'JR',
        school: ALABAMA,
        simYear: 2026,
      });
      expect(cp.archetypeMisreadFlag).toBe(cp.archetype !== cp.assumedArchetype);
    }
  });

  it('measurables are physically plausible across a large sample', () => {
    for (let i = 0; i < 200; i++) {
      const cp = generateCollegePlayer(new Prng(`m-${i}`), {
        idSuffix: `M${i}`,
        classYear: 'SR',
        school: ALABAMA,
        simYear: 2026,
      });
      const m = cp.measurables;
      expect(m.heightInches).toBeGreaterThanOrEqual(62);
      expect(m.heightInches).toBeLessThanOrEqual(82);
      expect(m.weightLbs).toBeGreaterThanOrEqual(150);
      expect(m.weightLbs).toBeLessThanOrEqual(400);
      expect(m.fortyYardSeconds).toBeGreaterThanOrEqual(4.20);
      expect(m.fortyYardSeconds).toBeLessThanOrEqual(6.00);
    }
  });

  it('ages prospects appropriately for class year', () => {
    // Quick spot-check a TRUE_FR vs RS_SR
    const fr = generateCollegePlayer(new Prng('fr'), {
      idSuffix: 'FR',
      classYear: 'TRUE_FR',
      school: ALABAMA,
      simYear: 2026,
    });
    const sr = generateCollegePlayer(new Prng('sr'), {
      idSuffix: 'SR',
      classYear: 'RS_SR',
      school: ALABAMA,
      simYear: 2026,
    });
    const frYear = parseInt(fr.birthDate.slice(0, 4), 10);
    const srYear = parseInt(sr.birthDate.slice(0, 4), 10);
    // TRUE_FR aged 18-19, born 2007-2008; RS_SR aged 22-24, born 2002-2004
    expect(frYear).toBeGreaterThanOrEqual(2007);
    expect(frYear).toBeLessThanOrEqual(2008);
    expect(srYear).toBeGreaterThanOrEqual(2002);
    expect(srYear).toBeLessThanOrEqual(2004);
  });

  it('produces college stats for played seasons but skips redshirt years', () => {
    const trueFr = generateCollegePlayer(new Prng('s-tf'), {
      idSuffix: 'TF', classYear: 'TRUE_FR', school: ALABAMA, simYear: 2026,
    });
    expect(trueFr.collegeStats.length).toBe(0);

    const so = generateCollegePlayer(new Prng('s-so'), {
      idSuffix: 'S', classYear: 'SO', school: ALABAMA, simYear: 2026,
    });
    expect(so.collegeStats.length).toBe(1);

    const jr = generateCollegePlayer(new Prng('s-jr'), {
      idSuffix: 'J', classYear: 'JR', school: ALABAMA, simYear: 2026,
    });
    expect(jr.collegeStats.length).toBe(2);

    const sr = generateCollegePlayer(new Prng('s-sr'), {
      idSuffix: 'SR', classYear: 'SR', school: ALABAMA, simYear: 2026,
    });
    expect(sr.collegeStats.length).toBe(3);

    const rsr = generateCollegePlayer(new Prng('s-rsr'), {
      idSuffix: 'RSR', classYear: 'RS_SR', school: ALABAMA, simYear: 2026,
    });
    expect(rsr.collegeStats.length).toBe(4);
  });

  it('forces position when override is supplied', () => {
    const cp = generateCollegePlayer(new Prng('force'), {
      idSuffix: 'F',
      classYear: 'JR',
      school: ALABAMA,
      simYear: 2026,
      forcePosition: Position.QB,
    });
    expect(cp.collegePosition).toBe(Position.QB);
  });

  it('marks transfers via TRANSFER_PORTAL flag and TRANSFER background', () => {
    const cp = generateCollegePlayer(new Prng('xfer'), {
      idSuffix: 'T',
      classYear: 'SR',
      school: ALABAMA,
      simYear: 2026,
      isTransfer: true,
    });
    expect(cp.recruiting.background).toBe('TRANSFER');
    expect(cp.characterFlags).toContain('TRANSFER_PORTAL');
  });

  it('star ratings cluster more 4-5 stars for STAR-tier prospects across a sample', () => {
    // We can't force tier directly, but seeds + many samples should
    // surface enough STAR-tier prospects to validate the bias.
    let starHigh = 0;
    let starTotal = 0;
    let fringeHigh = 0;
    let fringeTotal = 0;
    for (let i = 0; i < 800; i++) {
      const cp = generateCollegePlayer(new Prng(`sb-${i}`), {
        idSuffix: `SB${i}`, classYear: 'JR', school: ALABAMA, simYear: 2026,
      });
      if (cp.tier === 'STAR') {
        starTotal++;
        if (cp.recruiting.starRating >= 4) starHigh++;
      } else if (cp.tier === 'FRINGE') {
        fringeTotal++;
        if (cp.recruiting.starRating >= 4) fringeHigh++;
      }
    }
    if (starTotal === 0 || fringeTotal === 0) return; // not enough samples to assert
    const starHighRate = starHigh / starTotal;
    const fringeHighRate = fringeHigh / fringeTotal;
    expect(starHighRate).toBeGreaterThan(fringeHighRate);
  });

  it('hometown comes from the populated state pool', () => {
    const cp = generateCollegePlayer(new Prng('home'), {
      idSuffix: 'H', classYear: 'JR', school: ALABAMA, simYear: 2026,
    });
    expect(cp.recruiting.hometown.city.length).toBeGreaterThan(0);
    expect(cp.recruiting.hometown.state.length).toBe(2);
  });

  it('catalog includes all four conference tiers', () => {
    const tiers = new Set(COLLEGE_SCHOOLS.map((s) => s.tier));
    expect(tiers.has('POWER')).toBe(true);
    expect(tiers.has('GROUP_OF_5')).toBe(true);
    expect(tiers.has('FCS')).toBe(true);
    expect(tiers.has('SMALL')).toBe(true);
  });
});
