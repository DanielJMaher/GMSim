import { describe, it, expect } from 'vitest';
import { createLeague } from '../league/generate.js';
import { simulateSeason } from '../season/runner.js';
import { advanceSeason } from '../season/advance.js';
import { migrateLeagueForward } from '../season/migrations.js';
import { Prng } from '../prng/index.js';
import { CompetitiveWindow } from '../types/enums.js';
import type { LeagueState } from '../types/league.js';
import type { TeamState } from '../types/team.js';
import type { Owner, Gm, HeadCoach } from '../types/personnel.js';
import type {
  Transaction,
  TransactionHcFired,
  TransactionGmFired,
} from '../types/transaction.js';
import {
  computeSeatUpdate,
  decideFiring,
  GM_HEAT_RATIO,
  LAME_DUCK_FLOOR,
  SECOND_HIRE_JOINT_P,
  SECOND_HIRE_HATCH_JOINT_P,
  type SeasonOutcome,
} from './front-office.js';

const league = createLeague({ seed: 'front-office-test' });
const anyTeam = Object.values(league.teams)[0]!;
const owner = league.owners[anyTeam.ownerId]!;

/** Owner with neutral firing knobs (no quirks, mid ego) for predictable thresholds. */
const neutralOwner: Owner = {
  ...owner,
  quirks: [],
  personality: { ...owner.personality, egoLevel: 5.5 },
};

function fixtureTeam(overrides: Partial<TeamState['frontOffice']> = {}): TeamState {
  return {
    ...anyTeam,
    competitiveWindow: CompetitiveWindow.STAGNANT,
    seasonHistory: [
      {
        seasonNumber: 1,
        wins: 9,
        losses: 8,
        ties: 0,
        divisionFinish: 2,
        madePlayoffs: false,
      },
    ],
    frontOffice: {
      gmHiredSeason: 1,
      hcHiredSeason: 1,
      hcHiredByGmId: anyTeam.gmId,
      gmCoachFiringsSurvived: 0,
      gmLameDuck: false,
      gmVacant: false,
      hcVacant: false,
      seatPressure: { gm: 0, hc: 0 },
      ...overrides,
    },
  };
}

const badSeason: SeasonOutcome = { wins: 4, losses: 13, ties: 0, madePlayoffs: false };

describe('computeSeatUpdate', () => {
  it('heats the HC seat at exactly 1/GM_HEAT_RATIO times the GM seat for equal tenure', () => {
    const team = fixtureTeam();
    // Season 2: both chairs in year 2 → same expectation, same disappointment.
    const seats = computeSeatUpdate(team, neutralOwner, badSeason, 2);
    expect(seats.hc).toBeGreaterThan(0);
    expect(seats.gm).toBeGreaterThan(0);
    expect(seats.hc / seats.gm).toBeCloseTo(1 / GM_HEAT_RATIO, 5);
  });

  it('a Super Bowl win wipes both seats deep into credit', () => {
    const team = fixtureTeam();
    const seats = computeSeatUpdate(
      team,
      neutralOwner,
      { wins: 13, losses: 4, ties: 0, madePlayoffs: true, championshipResult: 'won_super_bowl' },
      2,
    );
    expect(seats.hc).toBeLessThanOrEqual(-40);
    expect(seats.gm).toBeLessThanOrEqual(-50);
  });

  it('banks credit (negative pressure) for beating expectations', () => {
    const team = fixtureTeam();
    const seats = computeSeatUpdate(
      team,
      neutralOwner,
      { wins: 12, losses: 5, ties: 0, madePlayoffs: true, championshipResult: 'lost_divisional' },
      2,
    );
    expect(seats.hc).toBeLessThan(0);
    expect(seats.gm).toBeLessThan(0);
  });

  it('floors a lame-duck GM near the threshold even after a decent season', () => {
    const team = fixtureTeam({ gmLameDuck: true });
    const seats = computeSeatUpdate(
      team,
      neutralOwner,
      { wins: 9, losses: 8, ties: 0, madePlayoffs: false },
      3,
    );
    expect(seats.gm).toBeGreaterThanOrEqual(LAME_DUCK_FLOOR);
  });

  it('an impatient owner heats the seat faster than a patient one', () => {
    const team = fixtureTeam();
    const impatient: Owner = {
      ...neutralOwner,
      spectrums: { ...neutralOwner.spectrums, patience: 1 },
    };
    const patient: Owner = {
      ...neutralOwner,
      spectrums: { ...neutralOwner.spectrums, patience: 10 },
    };
    const hot = computeSeatUpdate(team, impatient, badSeason, 2);
    const cool = computeSeatUpdate(team, patient, badSeason, 2);
    expect(hot.hc).toBeGreaterThan(cool.hc * 2);
  });
});

describe('decideFiring — grace periods', () => {
  it('a year-1 HC with 5+ wins is immune even under extreme pressure', () => {
    const team = fixtureTeam({ hcHiredSeason: 2 });
    const d = decideFiring(
      new Prng('grace-1'),
      team,
      neutralOwner,
      { gm: 0, hc: 105 },
      { wins: 5, losses: 12, ties: 0, madePlayoffs: false },
      2,
    );
    expect(d.fireHc).toBe(false);
  });

  it('a year-1 HC at ≤4 wins can be one-and-done', () => {
    const team = fixtureTeam({ hcHiredSeason: 2 });
    const d = decideFiring(
      new Prng('grace-2'),
      team,
      neutralOwner,
      { gm: 0, hc: 105 },
      badSeason,
      2,
    );
    expect(d.fireHc).toBe(true);
  });

  it('a GM in years 1–2 is shielded from a GM-only firing', () => {
    const young = fixtureTeam({ gmHiredSeason: 2 });
    const dYoung = decideFiring(
      new Prng('grace-3'),
      young,
      neutralOwner,
      { gm: 109, hc: 0 },
      badSeason,
      3,
    );
    expect(dYoung.fireGm).toBe(false);

    const old = fixtureTeam({ gmHiredSeason: 1 });
    const dOld = decideFiring(
      new Prng('grace-3'),
      old,
      neutralOwner,
      { gm: 109, hc: 0 },
      badSeason,
      5,
    );
    expect(dOld.fireGm).toBe(true);
  });
});

describe('decideFiring — the second-own-hire rule', () => {
  function jointRate(gmSeat: number, n = 400): { joint: number; lameDuck: number } {
    // GM in year 5 (the 4–7 dead zone), second own hire failing.
    const team = fixtureTeam({
      gmHiredSeason: 1,
      hcHiredSeason: 3,
      gmCoachFiringsSurvived: 1,
    });
    let joint = 0;
    let lame = 0;
    for (let i = 0; i < n; i++) {
      const d = decideFiring(
        new Prng(`second-hire:${gmSeat}:${i}`),
        team,
        neutralOwner,
        { gm: gmSeat, hc: 100 },
        badSeason,
        5,
      );
      expect(d.fireHc).toBe(true);
      if (d.joint) joint++;
      if (d.gmBecomesLameDuck) lame++;
    }
    return { joint: joint / n, lameDuck: lame / n };
  }

  it('with accumulated pressure (no hatch) the GM goes ~75% jointly, survivors lame-ducked', () => {
    const { joint, lameDuck } = jointRate(60);
    expect(joint).toBeGreaterThan(SECOND_HIRE_JOINT_P - 0.1);
    expect(joint).toBeLessThan(SECOND_HIRE_JOINT_P + 0.1);
    expect(joint + lameDuck).toBeCloseTo(1, 5);
  });

  it('with low accumulated pressure (early-teardown/banked-credit hatch) the GM usually survives', () => {
    const { joint } = jointRate(10);
    expect(joint).toBeGreaterThan(SECOND_HIRE_HATCH_JOINT_P - 0.08);
    expect(joint).toBeLessThan(SECOND_HIRE_HATCH_JOINT_P + 0.08);
  });
});

describe('front-office lifecycle integration', () => {
  function firings(log: readonly Transaction[]): {
    hcFired: TransactionHcFired[];
    gmFired: TransactionGmFired[];
    hcHired: number;
    gmHired: number;
  } {
    return {
      hcFired: log.filter((t): t is TransactionHcFired => t.kind === 'hc-fired'),
      gmFired: log.filter((t): t is TransactionGmFired => t.kind === 'gm-fired'),
      hcHired: log.filter((t) => t.kind === 'hc-hired').length,
      gmHired: log.filter((t) => t.kind === 'gm-hired').length,
    };
  }

  it('runs the carousel across seasons: every firing produces a hire, seats never stay vacant', () => {
    let lg: LeagueState = createLeague({ seed: 'carousel-3yr' });
    for (let s = 0; s < 2; s++) {
      lg = simulateSeason(lg);
      lg = advanceSeason(lg);
    }

    const f = firings(lg.transactionLog);
    // ~6-7 HC changes/season expected; over 3 seasons assert a loose floor.
    expect(f.hcFired.length).toBeGreaterThanOrEqual(1);
    expect(f.hcHired).toBe(f.hcFired.length);
    expect(f.gmHired).toBe(f.gmFired.length);

    for (const team of Object.values(lg.teams)) {
      expect(team.frontOffice.gmVacant).toBe(false);
      expect(team.frontOffice.hcVacant).toBe(false);
      const gm = lg.gms[team.gmId]!;
      const hc = lg.coaches[team.headCoachId]!;
      expect(gm.status).toBe('EMPLOYED');
      expect(hc.status).toBe('EMPLOYED');
    }

    // Fired personnel persist as UNEMPLOYED retread candidates (unless re-hired).
    for (const t of f.hcFired) {
      const coach = lg.coaches[t.coachId]!;
      expect(coach).toBeDefined();
      const sitting = Object.values(lg.teams).some((tm) => tm.headCoachId === t.coachId);
      if (!sitting) expect(coach.status).toBe('UNEMPLOYED');
    }

    // Sitting GMs accumulate stints covering every season they presided
    // over. GMs hired at the end of the final simulated season haven't
    // been evaluated yet (their first season is still ahead) — skip those.
    for (const team of Object.values(lg.teams)) {
      const gm = lg.gms[team.gmId]!;
      const seasonsPresided = lg.seasonNumber - team.frontOffice.gmHiredSeason;
      if (seasonsPresided <= 0) continue;
      const open = gm.careerStints.find(
        (st) => st.toSeason === null && st.teamId === team.identity.id && st.role === 'GM',
      );
      expect(open).toBeDefined();
      expect(open!.wins + open!.losses + open!.ties).toBe(seasonsPresided * 17);
    }
  });

  it('is deterministic: same seed → identical firing log', () => {
    const run = (): readonly Transaction[] => {
      let lg: LeagueState = createLeague({ seed: 'fo-determinism' });
      lg = simulateSeason(lg);
      lg = advanceSeason(lg);
      return lg.transactionLog.filter((t) =>
        ['hc-fired', 'gm-fired', 'hc-hired', 'gm-hired'].includes(t.kind),
      );
    };
    expect(run()).toEqual(run());
  });
});

describe('migration backfill', () => {
  it('restores frontOffice/status/careerStints on pre-v0.138 saves', () => {
    const stripped = {
      ...league,
      teams: Object.fromEntries(
        Object.entries(league.teams).map(([id, t]) => {
          const { frontOffice: _fo, ...rest } = t as TeamState & { frontOffice: unknown };
          return [id, rest];
        }),
      ),
      gms: Object.fromEntries(
        Object.entries(league.gms).map(([id, g]) => {
          const { status: _s, careerStints: _cs, ...rest } = g as Gm;
          return [id, rest];
        }),
      ),
      coaches: Object.fromEntries(
        Object.entries(league.coaches).map(([id, c]) => {
          const { status: _s, careerStints: _cs, ...rest } = c as HeadCoach;
          return [id, rest];
        }),
      ),
    } as unknown as LeagueState;

    const migrated = migrateLeagueForward(stripped);
    for (const team of Object.values(migrated.teams)) {
      expect(team.frontOffice).toBeDefined();
      expect(team.frontOffice.hcHiredByGmId).toBe(team.gmId);
      expect(team.frontOffice.seatPressure).toEqual({ gm: 0, hc: 0 });
    }
    for (const gm of Object.values(migrated.gms)) {
      expect(gm.status).toBe('EMPLOYED');
      expect(gm.careerStints).toEqual([]);
    }
    for (const hc of Object.values(migrated.coaches)) {
      expect(hc.status).toBe('EMPLOYED');
      expect(hc.careerStints).toEqual([]);
    }
  });
});
