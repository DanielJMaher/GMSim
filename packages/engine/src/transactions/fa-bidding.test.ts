import { describe, it, expect } from 'vitest';
import { createLeague } from '../league/generate.js';
import { simulateSeason } from '../season/runner.js';
import { advanceSeason } from '../season/advance.js';
import { auctionFreeAgent } from './fa-bidding.js';
import { teamCapUsage } from '../contracts/cap.js';
import { MarketSize, Position } from '../types/enums.js';
import type { LeagueState } from '../types/league.js';
import type { Player } from '../types/player.js';
import type { TeamState } from '../types/team.js';
import type { HeadCoach } from '../types/personnel.js';
import type { PlayerId, TeamId } from '../types/ids.js';

// All controlled tests use Position.WR (blueprint count = 3) as the FA
// slot. We remove one WR from a team's roster to create positional need
// at that team; remove WRs from every team for league-wide need.

describe('auctionFreeAgent', () => {
  it('returns null winner when no team has positional need', () => {
    // Default league has every team at full WR blueprint count — no
    // natural need. The synthetic FA gets no bidders.
    const league = createLeague({ seed: 'auction-no-need' });
    const fa = makeWrFreeAgent(league, 'STARTER');
    const result = auctionFreeAgent(league, fa);
    expect(result.winnerTeamId).toBeNull();
    expect(result.runnersUp).toHaveLength(0);
  });

  it('returns null winner when every team is at 53 with no roster space', () => {
    const base = createLeague({ seed: 'auction-no-space' });
    const stuffed = padEveryTeamTo53(base);
    const fa = makeWrFreeAgent(stuffed, 'STARTER');
    const result = auctionFreeAgent(stuffed, fa);
    expect(result.winnerTeamId).toBeNull();
  });

  it('single bidder gets the player at a discount vs. the multi-bidder price', () => {
    // Run the same FA + same target team in two scenarios: one with
    // need at only that team (solo bidder), one with league-wide need
    // (auction competition). Verify the solo result is cheaper.
    const base = createLeague({ seed: 'auction-single' });
    const target = Object.values(base.teams)[0]!;

    const soloLeague = withWrNeedAtOnly(base, target.identity.id);
    const allLeague = withWrNeedAtEveryTeam(base);

    const fa = makeWrFreeAgent(soloLeague, 'STARTER');
    const soloRes = auctionFreeAgent(soloLeague, fa);
    const allRes = auctionFreeAgent(allLeague, fa);

    expect(soloRes.winnerTeamId).toBe(target.identity.id);
    expect(soloRes.runnersUp).toHaveLength(0);
    // The solo bidder pays less than the team would in a competitive
    // auction. (Even when `target` doesn't win the competitive auction,
    // the competitive *price* is set by the runner-up and is strictly
    // higher than the solo discount.)
    expect(soloRes.valuationMultiplier).toBeLessThan(allRes.valuationMultiplier);
  });

  it('with multiple bidders, the winner is determined by perceived bid', () => {
    const base = createLeague({ seed: 'auction-multi' });
    const league = withWrNeedAtEveryTeam(base);
    const fa = makeWrFreeAgent(league, 'STARTER');
    const result = auctionFreeAgent(league, fa);
    expect(result.winnerTeamId).not.toBeNull();
    expect(result.runnersUp.length).toBeGreaterThan(0);
    expect(result.valuationMultiplier).toBeGreaterThan(0);
  });

  it('player preference shifts winner — friendly HC beats hostile HC at equal cash', () => {
    // Two-team scenario where both teams have identical cash bids:
    // same roster, same cap. Differ only in HC quirks. The friendly
    // (CULTURE_CARRIER + high playerRelationships) HC's team should
    // win because the perceived bid is higher.
    const base = createLeague({ seed: 'auction-pref-shift' });
    const teams = Object.values(base.teams);
    const friendly = teams[0]!;
    const hostile = teams[1]!;
    let league = withWrNeedAtOnly(base, friendly.identity.id);
    league = withWrNeedAtAlso(league, hostile.identity.id);
    // All other teams cannot bid (no need).

    const friendlyHc: HeadCoach = {
      ...league.coaches[friendly.headCoachId]!,
      quirks: ['CULTURE_CARRIER'],
      spectrums: {
        ...league.coaches[friendly.headCoachId]!.spectrums,
        playerRelationships: 10,
      },
    };
    const hostileHc: HeadCoach = {
      ...league.coaches[hostile.headCoachId]!,
      quirks: ['PRESS_CONFERENCE_DISASTER'],
      spectrums: {
        ...league.coaches[hostile.headCoachId]!.spectrums,
        playerRelationships: 1,
      },
    };
    league = {
      ...league,
      coaches: {
        ...league.coaches,
        [friendly.headCoachId]: friendlyHc,
        [hostile.headCoachId]: hostileHc,
      },
    };
    const fa = makeWrFreeAgent(league, 'STAR');
    const result = auctionFreeAgent(league, fa);
    expect(result.winnerTeamId).toBe(friendly.identity.id);
  });

  it('distraction-archetype STAR prefers large-market teams', () => {
    // Two-team scenario, both with WR need, identical cap + scheme.
    // Team A is LARGE market, Team B is SMALL. A distraction FA should
    // be more drawn to A's market, tipping the auction.
    const base = createLeague({ seed: 'auction-distraction' });
    const teams = Object.values(base.teams);
    const largeTeam = teams[0]!;
    const smallTeam = teams[1]!;
    let league = withWrNeedAtOnly(base, largeTeam.identity.id);
    league = withWrNeedAtAlso(league, smallTeam.identity.id);
    league = setTeamMarketSize(league, largeTeam.identity.id, MarketSize.LARGE);
    league = setTeamMarketSize(league, smallTeam.identity.id, MarketSize.SMALL);
    const fa = makeWrFreeAgent(league, 'STAR', 'distraction');
    const result = auctionFreeAgent(league, fa);
    // The market-size preference adds 0.06 to LARGE and -0.05 to SMALL —
    // a 0.11 perceived-bid swing. Cash bids only differ via natural
    // scheme/cap variance, which is dwarfed by the preference at this
    // configuration in most seeds. Assert winner is large.
    expect(result.winnerTeamId).toBe(largeTeam.identity.id);
  });

  it('respects cap-room hard constraint', () => {
    // Two teams with WR need; one is cap-pressed so they can't afford
    // even a STARTER bid. The other team wins uncontested.
    const base = createLeague({ seed: 'auction-cap' });
    const teams = Object.values(base.teams);
    const richTeam = teams[0]!;
    const poorTeam = teams[1]!;
    let league = withWrNeedAtOnly(base, richTeam.identity.id);
    league = withWrNeedAtAlso(league, poorTeam.identity.id);
    league = crushTeamCap(league, poorTeam.identity.id);
    const fa = makeWrFreeAgent(league, 'STARTER');
    const result = auctionFreeAgent(league, fa);
    expect(result.winnerTeamId).toBe(richTeam.identity.id);
    expect(result.runnersUp).toHaveLength(0);
  });

  it('is deterministic — same league + same FA produces the same outcome', () => {
    const a = createLeague({ seed: 'auction-det' });
    const b = createLeague({ seed: 'auction-det' });
    const leagueA = withWrNeedAtEveryTeam(a);
    const leagueB = withWrNeedAtEveryTeam(b);
    const faA = makeWrFreeAgent(leagueA, 'STAR');
    const faB = makeWrFreeAgent(leagueB, 'STAR');
    const resA = auctionFreeAgent(leagueA, faA);
    const resB = auctionFreeAgent(leagueB, faB);
    expect(resA.winnerTeamId).toBe(resB.winnerTeamId);
    expect(resA.finalPrice).toBe(resB.finalPrice);
    expect(resA.runnersUp).toEqual(resB.runnersUp);
  });

  it('end-to-end: refillRosters populates runnersUp on some fa-sign transactions', () => {
    let league = createLeague({ seed: 'auction-e2e' });
    league = simulateSeason(league);
    league = advanceSeason(league);
    const freshSigns = league.transactionLog.filter(
      (t) => t.kind === 'fa-sign' && t.tick === league.tick,
    );
    expect(freshSigns.length).toBeGreaterThan(0);
    const withRunners = freshSigns.filter(
      (t) => t.kind === 'fa-sign' && t.runnersUp && t.runnersUp.length > 0,
    );
    expect(withRunners.length).toBeGreaterThan(0);
  });

  it('end-to-end: contract value scales with auction outcome (real dispersion)', () => {
    let league = createLeague({ seed: 'auction-spread' });
    league = simulateSeason(league);
    league = advanceSeason(league);
    const starBaseSalaries: number[] = [];
    for (const contract of Object.values(league.contracts)) {
      if (contract.signedOnTick !== league.tick) continue;
      const player = league.players[contract.playerId];
      if (!player || player.tier !== 'STAR') continue;
      if (contract.realYears !== 4) continue; // skip vet-min fill-ups
      starBaseSalaries.push(contract.baseSalaries[0]!);
    }
    expect(starBaseSalaries.length).toBeGreaterThan(2);
    // Pre-v0.20 had ALL STAR base salaries equal at $7M. Auction
    // produces dispersion.
    expect(new Set(starBaseSalaries).size).toBeGreaterThan(1);
  });

  it('end-to-end: FA market still respects cap and roster invariants', () => {
    let league = createLeague({ seed: 'auction-invariants' });
    for (let i = 0; i < 3; i++) {
      league = simulateSeason(league);
      league = advanceSeason(league);
      for (const team of Object.values(league.teams)) {
        expect(teamCapUsage(team, league)).toBeLessThanOrEqual(league.salaryCap);
      }
    }
  });
});

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Build a synthetic WR free agent off a real rostered template. The
 * template player remains on their team (we'll create need separately
 * via `withWrNeedAt*`). The returned FA uses a unique id and is NOT
 * registered in league.players — callers pass it directly to
 * `auctionFreeAgent`, which doesn't read from `league.players[fa.id]`.
 */
function makeWrFreeAgent(
  league: LeagueState,
  tier: Player['tier'],
  archetype?: Player['moodProfile']['archetype'],
): Player {
  // Find any WR in the league to use as a template.
  let template: Player | null = null;
  for (const team of Object.values(league.teams)) {
    for (const pid of team.rosterIds) {
      const p = league.players[pid];
      if (p?.position === Position.WR) {
        template = p;
        break;
      }
    }
    if (template) break;
  }
  if (!template) throw new Error('no WR found in league');
  return {
    ...template,
    id: ('FA_TEST_WR' as unknown) as PlayerId,
    teamId: null,
    contractId: null,
    tier,
    moodProfile: archetype
      ? { ...template.moodProfile, archetype }
      : template.moodProfile,
  };
}

/** Remove one WR from the named team so they have WR positional need. */
function withWrNeedAtOnly(league: LeagueState, teamId: TeamId): LeagueState {
  return removeOneWrFromTeam(league, teamId);
}

/** Layer additional WR need on top of an already-modified league. */
function withWrNeedAtAlso(league: LeagueState, teamId: TeamId): LeagueState {
  return removeOneWrFromTeam(league, teamId);
}

/** Remove one WR from every team — league-wide WR need. */
function withWrNeedAtEveryTeam(league: LeagueState): LeagueState {
  let next = league;
  for (const teamId of Object.keys(league.teams) as TeamId[]) {
    next = removeOneWrFromTeam(next, teamId);
  }
  return next;
}

function removeOneWrFromTeam(league: LeagueState, teamId: TeamId): LeagueState {
  const team = league.teams[teamId]!;
  let removed = false;
  const newRosterIds = team.rosterIds.filter((pid) => {
    if (removed) return true;
    const p = league.players[pid];
    if (p?.position === Position.WR) {
      removed = true;
      return false;
    }
    return true;
  });
  if (!removed) return league;
  return {
    ...league,
    teams: {
      ...league.teams,
      [teamId]: { ...team, rosterIds: newRosterIds },
    } as LeagueState['teams'],
  };
}

function setTeamMarketSize(
  league: LeagueState,
  teamId: TeamId,
  size: typeof MarketSize[keyof typeof MarketSize],
): LeagueState {
  const team = league.teams[teamId]!;
  return {
    ...league,
    teams: {
      ...league.teams,
      [teamId]: { ...team, identity: { ...team.identity, marketSize: size } },
    } as LeagueState['teams'],
  };
}

/**
 * Push the team well over the cap by inflating `deadMoneyByYear[0]` —
 * cleaner than spiking base salaries (top-51 rule can absorb a single
 * spike) and directly forces `teamCapUsage > salaryCap`.
 */
function crushTeamCap(league: LeagueState, teamId: TeamId): LeagueState {
  const team = league.teams[teamId]!;
  return {
    ...league,
    teams: {
      ...league.teams,
      [teamId]: {
        ...team,
        deadMoneyByYear: [league.salaryCap, ...team.deadMoneyByYear.slice(1)],
      },
    } as LeagueState['teams'],
  };
}

function padEveryTeamTo53(league: LeagueState): LeagueState {
  const teamsNext: Record<string, TeamState> = {};
  for (const [id, team] of Object.entries(league.teams)) {
    const padCount = Math.max(0, 53 - team.rosterIds.length);
    const padding = Array.from(
      { length: padCount },
      (_, i) => `pad-${id}-${i}` as ReturnType<typeof String>,
    );
    teamsNext[id] = {
      ...team,
      rosterIds: [...team.rosterIds, ...padding] as TeamState['rosterIds'],
    };
  }
  return { ...league, teams: teamsNext as LeagueState['teams'] };
}
