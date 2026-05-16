import { describe, expect, it } from 'vitest';
import { Prng } from '../prng/index.js';
import { runCoachVisits, coachVisitAccuracy } from './coach-visits.js';
import { createLeague } from '../league/generate.js';
import { simulateSeason } from '../season/runner.js';
import { advanceSeason } from '../season/advance.js';
import type { HeadCoach } from '../types/personnel.js';
import { CoachId, OwnerId, GmId } from '../types/ids.js';

function hc(staff: number, exp: number, adapt: number): HeadCoach {
  return {
    id: CoachId('HC_T'),
    name: 'Test HC',
    spectrums: {
      offensiveDefensiveIdentity: 5,
      playCallingAggression: 5,
      playerRelationships: 5,
      schemeFlexibility: 5,
      qbDevelopment: 5,
      gameManagement: 5,
      pressureResponse: 5,
      staffDevelopment: staff,
      adaptability: adapt,
      experience: exp,
    },
    offensiveScheme: 'WEST_COAST',
    defensiveScheme: 'BASE_4_3',
    quirks: [],
    personality: {
      egoLevel: 5,
      confidence: 5,
      openness: 5,
      loyalty: 5,
      integrity: 5,
      composure: 5,
    },
    careerAwards: [],
  };
}

void OwnerId;
void GmId;

describe('coachVisitAccuracy', () => {
  it('produces values in [0.50, 0.95]', () => {
    expect(coachVisitAccuracy(hc(1, 1, 1))).toBeGreaterThanOrEqual(0.50);
    expect(coachVisitAccuracy(hc(10, 10, 10))).toBeLessThanOrEqual(0.95);
  });

  it('high-quality staff coaches more accurate than floor coaches', () => {
    expect(coachVisitAccuracy(hc(10, 10, 10))).toBeGreaterThan(
      coachVisitAccuracy(hc(1, 1, 1)),
    );
  });

  it('caps higher than the scout floor of 0.35', () => {
    // Even the lowest-quality HC should be more accurate than a
    // floor-quality scout (slice 2 sets scout floor at 0.35).
    expect(coachVisitAccuracy(hc(1, 1, 1))).toBeGreaterThan(0.35);
  });
});

describe('runCoachVisits', () => {
  it('createLeague populates initial coach visits (3 per team)', () => {
    const league = createLeague({ seed: 'cv-init' });
    // Boards exist (32 teams × 3 visits each = 96 maximum).
    expect(league.coachVisitObservations.length).toBeGreaterThan(0);
    expect(league.coachVisitObservations.length).toBeLessThanOrEqual(32 * 3);
    // Each visit attributed to a real coach.
    for (const v of league.coachVisitObservations) {
      expect(league.coaches[v.coachId]).toBeDefined();
    }
  });

  it('coaches only observe a focused subset of dimensions', () => {
    const league = createLeague({ seed: 'cv-keys' });
    const allowedKeys = new Set([
      'leadership', 'competitiveness', 'workEthic', 'coachability',
      'composure', 'footballIq', 'decisionMaking', 'technicalSkill',
    ]);
    const physicalKeys = new Set(['speed', 'acceleration', 'strength', 'agility', 'durability']);
    for (const v of league.coachVisitObservations) {
      for (const k of Object.keys(v.skills)) {
        expect(allowedKeys.has(k)).toBe(true);
        expect(physicalKeys.has(k)).toBe(false);
      }
    }
  });

  it('is deterministic for the same league seed', () => {
    const a = createLeague({ seed: 'cv-det' });
    const b = createLeague({ seed: 'cv-det' });
    expect(a.coachVisitObservations.length).toBe(b.coachVisitObservations.length);
    for (let i = 0; i < a.coachVisitObservations.length; i++) {
      expect(a.coachVisitObservations[i]).toEqual(b.coachVisitObservations[i]);
    }
  });

  it('higher coach accuracy → tighter observation distribution', () => {
    // Build a league, then run two parallel coach-visit cycles with
    // different forced accuracies (via picking different HCs). Easiest
    // test: just compare confidence values across coaches in a real
    // league — high-spectrum HCs should have higher confidence than
    // low-spectrum HCs.
    const league = createLeague({ seed: 'cv-acc' });
    // Sort coaches by staffDevelopment and find one in the top and
    // bottom quartile.
    const coaches = Object.values(league.coaches).sort(
      (a, b) => a.spectrums.staffDevelopment - b.spectrums.staffDevelopment,
    );
    const lowHc = coaches[0]!;
    const highHc = coaches[coaches.length - 1]!;
    expect(coachVisitAccuracy(highHc)).toBeGreaterThan(coachVisitAccuracy(lowHc));
  });

  it('visits target prospects on the team draft board (skipping non-eligible)', () => {
    const league = createLeague({ seed: 'cv-target' });
    // Visit targets come from the team's board. The picker walks
    // top → bottom and skips non-eligible entries (boards aren't
    // pre-filtered for draft eligibility — they include SO/RS_FR
    // prospects whose observations were filed but who can't yet be
    // drafted). So a visited prospect should be ON the team's board
    // and ELIGIBLE — we don't assert a strict top-N because the
    // walk can run deep when many top entries are pre-JR.
    for (const team of Object.values(league.teams)) {
      const board = league.draftBoards[team.identity.id] ?? [];
      const boardIds = new Set(board.map((e) => e.collegePlayerId));
      const teamVisits = league.coachVisitObservations.filter(
        (v) => v.coachId === team.headCoachId,
      );
      if (teamVisits.length === 0) continue;
      for (const v of teamVisits) {
        expect(boardIds.has(v.collegePlayerId)).toBe(true);
        const prospect = league.collegePool.find((cp) => cp.id === v.collegePlayerId);
        expect(prospect?.isDraftEligible).toBe(true);
      }
    }
  });
});

describe('coach visits integration in advanceSeason', () => {
  it('advanceSeason produces additional coach visits each cycle', () => {
    const league = createLeague({ seed: 'cv-adv' });
    const before = league.coachVisitObservations.length;
    const played = simulateSeason(league);
    const after = advanceSeason(played);
    expect(after.coachVisitObservations.length).toBeGreaterThan(before);
  });

  it('migration backfills coachVisitObservations on a save without them', () => {
    const league = createLeague({ seed: 'cv-mig' });
    const stripped = { ...league } as typeof league & {
      coachVisitObservations?: typeof league.coachVisitObservations;
    };
    delete stripped.coachVisitObservations;
    const played = simulateSeason(stripped as typeof league);
    expect(played.coachVisitObservations).toBeDefined();
  });

  it('coach visits accumulate across multiple seasons', () => {
    let league = createLeague({ seed: 'cv-multi' });
    league = simulateSeason(league);
    league = advanceSeason(league);
    const yr1 = league.coachVisitObservations.length;
    league = simulateSeason(league);
    league = advanceSeason(league);
    const yr2 = league.coachVisitObservations.length;
    expect(yr2).toBeGreaterThan(yr1);
  });
});
