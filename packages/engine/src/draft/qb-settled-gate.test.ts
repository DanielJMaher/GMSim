import { describe, expect, it } from 'vitest';
import { Prng } from '../prng/index.js';
import { createLeague } from '../league/generate.js';
import { runDraft } from './event.js';
import { rollJuniorDeclarations } from './declaration.js';
import { hasDesperateQbNeed } from './team-needs.js';
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
  const team = Object.values(league.teams).find((t) => !hasDesperateQbNeed(t, league.players));
  if (!team) throw new Error('no QB-settled team in fixture league');
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
