import { describe, expect, it } from 'vitest';

import { createLeague } from '../league/generate.js';
import { simulateSeason } from '../season/runner.js';
import {
  beginFreeAgency,
  stepFreeAgency,
  submitOffers,
  finishFreeAgency,
  isFreeAgencyComplete,
  refillRosters,
  type FaStep,
} from './offseason.js';
import { teamCapUsage } from '../contracts/cap.js';
import type { LeagueState } from '../types/league.js';
import type { PlayerId, TeamId } from '../types/ids.js';

/**
 * The D7 seam (D7_FA_SEAM.md, approved 2026-09-14).
 *
 * P1 (byte-identity with the pre-refactor market) was verified once, at
 * refactor time, by hashing a full `advanceSeason` across three seeds in a git
 * worktree at the pre-refactor commit and again after: **`b25b0c9c…`, 2130 FA
 * signings, identical on both sides**.
 *
 * The count is part of the evidence, not decoration. The FIRST attempt at that
 * verification hashed `refillRosters` on
 * `applyContractExpirations(simulateSeason(...))` and reported a clean match —
 * which was **vacuous**: that construction yields ZERO free agents, so both
 * implementations trivially did nothing. A matching hash over a market that
 * never ran proves nothing, and it nearly shipped the refactor unverified. The
 * probe now asserts a signing count before reporting, and `leagueWithFreeAgents`
 * below exists for the same reason.
 *
 * P1 is not re-gated here: `refillRosters` is now a thin loop over
 * `stepFreeAgency`, so a "both agree" test would assert a tautology. What IS
 * gated is everything the seam adds — and, first, that there is a market to add
 * it to.
 */

/**
 * A league with a real FA pool.
 *
 * NOT `applyContractExpirations(simulateSeason(...))` — that was the first
 * attempt and it produces **zero** free agents, because `simulateSeason` leaves
 * no contract at `yearsRemaining <= 0` for the expiration pass to find. Every
 * test below then "passed" against an empty market, and the refactor's
 * byte-identity probe reported a clean match over a market that never ran.
 *
 * Releasing the tail of each roster manufactures a genuine pool directly, with
 * no dependency on where contract ageing happens in the lifecycle.
 */
function leagueWithFreeAgents(seed: string): LeagueState {
  const league = simulateSeason(createLeague({ seed }));
  const players = { ...league.players };
  const teams = { ...league.teams };

  for (const team of Object.values(league.teams)) {
    // Release the last 8 on each roster: enough bodies to make a market, few
    // enough that clubs still have the room and the need to bid.
    const released = team.rosterIds.slice(-8);
    teams[team.identity.id] = {
      ...team,
      rosterIds: team.rosterIds.slice(0, -8),
    };
    for (const id of released) {
      const p = players[id];
      if (p) players[id] = { ...p, teamId: null };
    }
  }
  return { ...league, players, teams };
}

function runToCompletion(session: ReturnType<typeof beginFreeAgency>): FaStep[] {
  const steps: FaStep[] = [];
  let guard = 0;
  while (!isFreeAgencyComplete(session) && guard++ < 20_000) {
    steps.push(stepFreeAgency(session));
  }
  return steps;
}

describe('free-agency waves', () => {
  const league = leagueWithFreeAgents('fa-waves');

  it('has a real pool to test against (guards against a vacuous suite)', () => {
    const fa = Object.values(league.players).filter((p) => p.teamId === null);
    expect(fa.length).toBeGreaterThan(100);
  });

  it('opens and closes each wave exactly once, in tier order', () => {
    const session = beginFreeAgency(league, { signedOnTick: league.tick });
    const steps = runToCompletion(session);

    const opened = steps.filter((s) => s.kind === 'wave-open').map((s) => s.wave);
    const closed = steps.filter((s) => s.kind === 'wave-closed').map((s) => s.wave);

    expect(opened.length).toBeGreaterThan(0);
    expect(new Set(opened).size).toBe(opened.length);
    expect(closed).toEqual(opened);

    // Tier order: the pool is already sorted STAR -> STARTER -> BACKUP -> FRINGE,
    // which is why wave boundaries were free.
    const rank = { STAR: 0, STARTER: 1, BACKUP: 2, FRINGE: 3 } as const;
    for (let i = 1; i < opened.length; i++) {
      expect(rank[opened[i]!]).toBeGreaterThan(rank[opened[i - 1]!]);
    }
  });

  it('reaches completion and signs players', () => {
    const session = beginFreeAgency(league, { signedOnTick: league.tick });
    const steps = runToCompletion(session);
    expect(isFreeAgencyComplete(session)).toBe(true);
    expect(steps.filter((s) => s.kind === 'signing').length).toBeGreaterThan(0);
  });

  it('produces the same league as refillRosters', () => {
    // Not a tautology worth much on its own, but it pins the thin-loop wiring:
    // if someone later gives refillRosters its own logic again, this breaks.
    const session = beginFreeAgency(league, { signedOnTick: league.tick });
    runToCompletion(session);
    const stepped = finishFreeAgency(session);
    const batch = refillRosters(league, league.tick);

    const roster = (l: LeagueState) =>
      Object.values(l.teams)
        .map((t) => `${String(t.identity.id)}:${[...t.rosterIds].sort().join(',')}`)
        .sort()
        .join('|');
    expect(roster(stepped)).toBe(roster(batch));
  });
});

describe('D7 supplied offers', () => {
  const league = leagueWithFreeAgents('fa-offers');
  const teamId = Object.keys(league.teams)[0] as TeamId;

  /** Free agents in the market, best first. */
  function poolOf(l: LeagueState): PlayerId[] {
    return Object.values(l.players)
      .filter((p) => p.teamId === null)
      .map((p) => p.id);
  }

  /**
   * P3 — the player can lose.
   *
   * A market where a supplied offer always wins is not a market, and the whole
   * "learn who overpays by watching" loop needs the player to lose auctions and
   * see the price. Offering the league minimum on a broad slice should lose
   * most of them to clubs that actually valued the player.
   */
  it('loses auctions when it underbids', () => {
    const session = beginFreeAgency(league, {
      signedOnTick: league.tick,
      externallyControlledTeamIds: [teamId],
    });

    let guard = 0;
    let offered = 0;
    let won = 0;
    while (!isFreeAgencyComplete(session) && guard++ < 20_000) {
      const step = stepFreeAgency(session);
      if (step.kind === 'wave-open') {
        const offers = step.availablePlayerIds.slice(0, 25).map((playerId, i) => ({
          playerId,
          maxCash: 1_000_000, // deliberately derisory
          priority: i,
        }));
        offered += offers.length;
        submitOffers(session, teamId, offers);
      }
      if (step.kind === 'signing' && step.teamId === teamId) won++;
    }

    expect(offered).toBeGreaterThan(0);
    expect(won).toBeLessThan(offered);
  });

  /**
   * P4 — priority binds.
   *
   * A GM who offers on more talent than they can afford must sign down their
   * board and STOP, not exceed the cap. The offer simply is not entered once the
   * room is gone, which is the same condition an NPC bidder faces.
   */
  it('never signs a supplied offer past the cap', () => {
    const session = beginFreeAgency(league, {
      signedOnTick: league.tick,
      externallyControlledTeamIds: [teamId],
    });

    let guard = 0;
    while (!isFreeAgencyComplete(session) && guard++ < 20_000) {
      const step = stepFreeAgency(session);
      if (step.kind === 'wave-open') {
        // Offer absurdly on everything available — far more than any club can
        // pay for. Priority binds or the cap blows.
        submitOffers(
          session,
          teamId,
          step.availablePlayerIds.map((playerId, i) => ({
            playerId,
            maxCash: 30_000_000,
            priority: i,
          })),
        );
      }
    }

    const after = finishFreeAgency(session);
    const team = after.teams[teamId]!;
    expect(teamCapUsage(team, after)).toBeLessThanOrEqual(after.salaryCap);
  });

  /**
   * The seam must be BEHAVIOURALLY NEUTRAL: marking a club externally
   * controlled and supplying nothing leaves the market exactly as it was.
   *
   * This is the FA analogue of the draft's autoPick-equivalence test, and it is
   * the property that makes the seam safe to ship — a club that declines to use
   * it is in no way disadvantaged.
   */
  it('changes nothing when a controlled club supplies no offers', () => {
    const controlled = beginFreeAgency(league, {
      signedOnTick: league.tick,
      externallyControlledTeamIds: [teamId],
    });
    runToCompletion(controlled);

    const plain = refillRosters(league, league.tick);
    const after = finishFreeAgency(controlled);

    const roster = (l: LeagueState) =>
      Object.values(l.teams)
        .map((t) => `${String(t.identity.id)}:${[...t.rosterIds].sort().join(',')}`)
        .sort()
        .join('|');
    expect(roster(after)).toBe(roster(plain));
  });

  it('can actually win a player when it bids seriously', () => {
    // The complement of the losing test: a market the player can never win is
    // as broken as one they always win.
    const pool = poolOf(league);
    expect(pool.length).toBeGreaterThan(0);

    const session = beginFreeAgency(league, {
      signedOnTick: league.tick,
      externallyControlledTeamIds: [teamId],
    });

    let guard = 0;
    let won = 0;
    while (!isFreeAgencyComplete(session) && guard++ < 20_000) {
      const step = stepFreeAgency(session);
      if (step.kind === 'wave-open') {
        submitOffers(
          session,
          teamId,
          step.availablePlayerIds.slice(0, 3).map((playerId, i) => ({
            playerId,
            maxCash: 25_000_000,
            priority: i,
          })),
        );
      }
      if (step.kind === 'signing' && step.teamId === teamId) won++;
    }
    expect(won).toBeGreaterThan(0);
  });
});
