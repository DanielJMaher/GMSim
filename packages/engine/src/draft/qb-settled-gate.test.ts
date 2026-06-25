import { describe, expect, it } from 'vitest';
import { Prng } from '../prng/index.js';
import { createLeague } from '../league/generate.js';
import { runDraft } from './event.js';
import { rollJuniorDeclarations } from './declaration.js';
import { hasDesperateQbNeed, qbUpgradeDesire } from './team-needs.js';
import { qbSettledPickFactor, QB_SETTLED_DAMPEN, slotAwarePickBoost } from './position-value.js';
import type { TeamId, PlayerId } from '../types/ids.js';
import type { LeagueState } from '../types/league.js';
import type { CollegePlayer, DraftBoardEntry } from '../types/college.js';
import { Position } from '../types/enums.js';

/**
 * Need-aware QB surplus (v0.145, slice 2 of the Scorekeeper plan).
 *
 * The v0.143 slot premium was roster-blind: a team with an established
 * franchise QB still applied the full ×1.6 QB boost at premier slots —
 * Daniel's "Baltimore drafts a QB at #2 behind a 75 OVR / 4,600-yard
 * starter" report. Real top-of-draft QB selection is conditional on need:
 * no settled team has spent a top-8 pick on a QB in the wage-scale era.
 */

function leagueWithDeclaredPool(seed: string): LeagueState {
  const base = createLeague({ seed });
  return {
    ...base,
    collegePool: rollJuniorDeclarations(new Prng(`${seed}-decl`), base.collegePool),
  };
}

function available(league: LeagueState): CollegePlayer[] {
  return league.collegePool.filter((cp) => cp.isDraftEligible && cp.hasDeclared);
}

function entry(cp: CollegePlayer, priority: number): DraftBoardEntry {
  return {
    collegePlayerId: cp.id,
    priority,
    reason: 'BLUE_CHIP',
    observedSkillScore: 80,
    schemeFit: 1,
    meanConfidence: 0.8,
    observationCount: 3,
    addedOnTick: 0,
  };
}

/** A board with a QB narrowly on top of a premium non-QB — the contested case. */
function craftedBoard(league: LeagueState): {
  board: DraftBoardEntry[];
  qb: CollegePlayer;
  nonQb: CollegePlayer;
} {
  const pool = available(league);
  const qb = pool.find((cp) => cp.nflProjectedPosition === Position.QB);
  const nonQb = pool.find(
    (cp) =>
      cp.nflProjectedPosition === Position.EDGE || cp.nflProjectedPosition === Position.LT,
  );
  if (!qb || !nonQb) throw new Error('pool lacks a QB or EDGE/LT prospect');
  return { board: [entry(qb, 100), entry(nonQb, 95)], qb, nonQb };
}

function settledTeamId(league: LeagueState): TeamId {
  // Genuinely settled (v0.150/v0.154): zero desire under BOTH the regular
  // and the premier-slot (Rosen-aware) evaluation — a top-quartile QB room,
  // or a dev kid who isn't grading out as a bust.
  const team = Object.values(league.teams).find(
    (t) =>
      qbUpgradeDesire(t, league) === 0 &&
      qbUpgradeDesire(t, league, { premierPick: 1 }) === 0,
  );
  if (!team) throw new Error('no zero-desire team in fixture league');
  return team.identity.id;
}

function strippedOfQbs(league: LeagueState, tid: TeamId): LeagueState {
  const team = league.teams[tid]!;
  return {
    ...league,
    teams: {
      ...league.teams,
      [tid]: {
        ...team,
        rosterIds: team.rosterIds.filter(
          (id: PlayerId) => league.players[id]?.position !== Position.QB,
        ),
      },
    },
  };
}

describe('qbSettledPickFactor', () => {
  it('dampens inside the premier window and is neutral beyond it', () => {
    expect(qbSettledPickFactor(1)).toBe(QB_SETTLED_DAMPEN);
    expect(qbSettledPickFactor(8)).toBe(QB_SETTLED_DAMPEN);
    expect(qbSettledPickFactor(9)).toBe(1);
    // And the dampen must actually undercut the boost it replaces.
    expect(QB_SETTLED_DAMPEN).toBeLessThan(slotAwarePickBoost(Position.QB, 1));
  });
});

describe('qbUpgradeDesire', () => {
  it('grades the QB room: desperate 1.0, league-best 0, mediocre in between', () => {
    const league = createLeague({ seed: 'desire-grade' });
    const teams = Object.values(league.teams);

    const desires = teams.map((t) => qbUpgradeDesire(t, league));
    // Desperate teams (if any) read exactly 1.
    for (let i = 0; i < teams.length; i++) {
      if (hasDesperateQbNeed(teams[i]!, league.players)) expect(desires[i]).toBe(1);
      expect(desires[i]).toBeGreaterThanOrEqual(0);
      expect(desires[i]).toBeLessThanOrEqual(1);
    }
    // The league has both settled (0) and hunting (>0) rooms — the graded
    // landscape the slot premium needs.
    expect(desires.some((d) => d === 0)).toBe(true);
    expect(desires.some((d) => d > 0)).toBe(true);

    // Stripping a team's QBs maxes its desire.
    const t0 = teams[0]!;
    const stripped = strippedOfQbs(league, t0.identity.id);
    expect(qbUpgradeDesire(stripped.teams[t0.identity.id]!, stripped)).toBe(1);
  });
});

describe('need-aware QB surplus at the top of the draft', () => {
  it('a QB-settled team at #1 passes on a board-topping QB for the near-equal premium non-QB', () => {
    const base = leagueWithDeclaredPool('settled-gate');
    const tid = settledTeamId(base);
    const { board, qb } = craftedBoard(base);
    const league = { ...base, draftBoards: { ...base.draftBoards, [tid]: board } };

    const result = runDraft(new Prng('draft'), league, {
      draftOrder: [tid],
      pickedOnTick: 0,
      seasonNumber: league.seasonNumber + 1,
      round: 1,
      startingOverallPick: 1,
    });
    const picked = result.newPlayers[0]!;
    expect(picked.position).not.toBe(Position.QB);
    expect(result.removedFromCollegePool.has(qb.id)).toBe(false);
  });

  it('the same board makes a QB-desperate team take the QB #1 overall', () => {
    const base = leagueWithDeclaredPool('settled-gate');
    const tid = settledTeamId(base);
    const { board, qb } = craftedBoard(base);
    const desperate = strippedOfQbs(base, tid);
    expect(hasDesperateQbNeed(desperate.teams[tid]!, desperate.players)).toBe(true);
    const league = { ...desperate, draftBoards: { ...desperate.draftBoards, [tid]: board } };

    const result = runDraft(new Prng('draft'), league, {
      draftOrder: [tid],
      pickedOnTick: 0,
      seasonNumber: league.seasonNumber + 1,
      round: 1,
      startingOverallPick: 1,
    });
    expect(result.newPlayers[0]!.position).toBe(Position.QB);
    expect(result.removedFromCollegePool.has(qb.id)).toBe(true);
  });

  it('every pick records its team\'s pick-time needs and desperate-QB flag (v0.147 snapshot)', () => {
    const base = leagueWithDeclaredPool('settled-gate');
    const tid = settledTeamId(base);
    const desperateLeague = strippedOfQbs(base, tid);
    const { board } = craftedBoard(desperateLeague);
    const league = {
      ...desperateLeague,
      draftBoards: { ...desperateLeague.draftBoards, [tid]: board },
    };

    const result = runDraft(new Prng('draft'), league, {
      draftOrder: [tid],
      pickedOnTick: 0,
      seasonNumber: league.seasonNumber + 1,
      round: 1,
      startingOverallPick: 1,
    });
    const pick = result.picks[0]!;
    // The snapshot reflects the pre-pick roster: stripped of QBs, the team is
    // desperate, and QB floors into the recorded top needs.
    expect(pick.qbDesperateAtPick).toBe(true);
    expect(pick.needsAtPick).toBeDefined();
    expect(pick.needsAtPick!.length).toBeGreaterThan(0);
    expect(pick.needsAtPick).toContain(Position.QB);

    // A settled team's record carries the flag as false.
    const settled = runDraft(new Prng('draft'), { ...base }, {
      draftOrder: [tid],
      pickedOnTick: 0,
      seasonNumber: base.seasonNumber + 1,
      round: 1,
      startingOverallPick: 1,
    });
    expect(settled.picks[0]!.qbDesperateAtPick).toBe(false);
  });

  it('a full-desire team takes the QB at #1 even from board rank 2 (revealed preference, v0.152)', () => {
    const base = leagueWithDeclaredPool('settled-gate');
    const tid = settledTeamId(base);
    const desperate = strippedOfQbs(base, tid);
    const pool = available(desperate);
    const qb = pool.find((cp) => cp.nflProjectedPosition === Position.QB);
    const nonQb = pool.find(
      (cp) =>
        cp.nflProjectedPosition === Position.EDGE || cp.nflProjectedPosition === Position.LT,
    );
    if (!qb || !nonQb) throw new Error('pool lacks a QB or EDGE/LT prospect');
    // EDGE clearly tops the board; the QB sits at 78% of his priority —
    // below the 1.6-value threshold (~87%) but above the revealed-2.0
    // threshold (~72%). Real war room: take the franchise QB.
    const board = [entry(nonQb, 100), entry(qb, 78)];
    const league = { ...desperate, draftBoards: { ...desperate.draftBoards, [tid]: board } };

    const result = runDraft(new Prng('draft'), league, {
      draftOrder: [tid],
      pickedOnTick: 0,
      seasonNumber: league.seasonNumber + 1,
      round: 1,
      startingOverallPick: 1,
    });
    expect(result.newPlayers[0]!.position).toBe(Position.QB);
  });

  it('premier slots are binary: a graded-desire team hunts at #1 but not at #15 (v0.154)', () => {
    // Holding a top-8 pick is itself evidence the QB room isn't the answer —
    // a 2nd/3rd-quartile room takes the franchise QB at #1 (Tennessee/Ward)
    // but does NOT chase him from the mid-first.
    let found: { league: LeagueState; tid: TeamId } | null = null;
    for (const seed of ['settled-gate', 'desire-grade', 'script-behavior']) {
      const base = leagueWithDeclaredPool(seed);
      const team = Object.values(base.teams).find((t) => {
        const d = qbUpgradeDesire(t, base);
        return d >= 0.3 && d < 1;
      });
      if (team) {
        found = { league: base, tid: team.identity.id };
        break;
      }
    }
    if (!found) throw new Error('no graded-desire team across fixture seeds');

    const pool = available(found.league);
    const qb = pool.find((cp) => cp.nflProjectedPosition === Position.QB)!;
    const nonQb = pool.find(
      (cp) =>
        cp.nflProjectedPosition === Position.EDGE || cp.nflProjectedPosition === Position.LT,
    )!;
    const board = [entry(nonQb, 100), entry(qb, 78)];
    const league = {
      ...found.league,
      draftBoards: { ...found.league.draftBoards, [found.tid]: board },
    };

    const atOne = runDraft(new Prng('draft'), league, {
      draftOrder: [found.tid],
      pickedOnTick: 0,
      seasonNumber: league.seasonNumber + 1,
      round: 1,
      startingOverallPick: 1,
    });
    expect(atOne.newPlayers[0]!.position).toBe(Position.QB);

    const atFifteen = runDraft(new Prng('draft'), league, {
      draftOrder: [found.tid],
      pickedOnTick: 0,
      seasonNumber: league.seasonNumber + 1,
      round: 1,
      startingOverallPick: 15,
    });
    expect(atFifteen.newPlayers[0]!.position).not.toBe(Position.QB);
  });

  it('a desperate team holding two premier picks does not double-draft QBs in the round', () => {
    const base = leagueWithDeclaredPool('settled-gate');
    const tid = settledTeamId(base);
    const desperate = strippedOfQbs(base, tid);

    const pool = available(desperate);
    const qbs = pool.filter((cp) => cp.nflProjectedPosition === Position.QB).slice(0, 2);
    const nonQb = pool.find(
      (cp) =>
        cp.nflProjectedPosition === Position.EDGE || cp.nflProjectedPosition === Position.LT,
    );
    if (qbs.length < 2 || !nonQb) throw new Error('pool lacks 2 QBs + EDGE/LT');
    const board = [entry(qbs[0]!, 100), entry(qbs[1]!, 99), entry(nonQb, 95)];
    const league = { ...desperate, draftBoards: { ...desperate.draftBoards, [tid]: board } };

    const result = runDraft(new Prng('draft'), league, {
      draftOrder: [tid, tid],
      pickedOnTick: 0,
      seasonNumber: league.seasonNumber + 1,
      round: 1,
      startingOverallPick: 1,
    });
    const qbCount = result.newPlayers.filter((p) => p.position === Position.QB).length;
    expect(qbCount).toBe(1);
    expect(result.newPlayers).toHaveLength(2);
  });
});
