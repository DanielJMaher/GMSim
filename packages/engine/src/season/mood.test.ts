import { describe, it, expect } from 'vitest';
import { createLeague } from '../league/generate.js';
import { simulateSeason } from './runner.js';
import {
  weeklyMoodUpdate,
  offseasonMoodDrift,
  moodBucket,
  moodMultiplier,
  MOOD_BASELINE,
  MOOD_BUCKETS,
  TRADE_REQUEST_THRESHOLD,
  TRADE_REQUEST_RESOLVE_THRESHOLD,
} from './mood.js';
import { advanceSeason } from './advance.js';
import { teamStrength } from '../games/strength.js';
import { Prng } from '../prng/index.js';
import type { LeagueState } from '../types/league.js';
import type { Player } from '../types/player.js';
import type { HeadCoach } from '../types/personnel.js';
import type { ScheduledGame, GameResult } from '../types/game.js';
import type { TeamId, GameId, CoachId } from '../types/ids.js';
import type { OffensiveSchemeArchetype } from '../types/personnel.js';

describe('moodBucket', () => {
  it('maps known values to expected labels', () => {
    expect(moodBucket(0)).toBe('wants_out');
    expect(moodBucket(19)).toBe('wants_out');
    expect(moodBucket(20)).toBe('frustrated');
    expect(moodBucket(39)).toBe('frustrated');
    expect(moodBucket(40)).toBe('unsettled');
    expect(moodBucket(59)).toBe('unsettled');
    expect(moodBucket(60)).toBe('content');
    expect(moodBucket(79)).toBe('content');
    expect(moodBucket(80)).toBe('happy');
    expect(moodBucket(100)).toBe('happy');
  });

  it('bucket order is ascending by severity', () => {
    expect(MOOD_BUCKETS).toEqual([
      'wants_out',
      'frustrated',
      'unsettled',
      'content',
      'happy',
    ]);
  });
});

describe('moodMultiplier', () => {
  it('is 1.0 at baseline', () => {
    expect(moodMultiplier(MOOD_BASELINE)).toBe(1.0);
  });

  it('is asymmetric — penalty grows faster than bonus', () => {
    const symmetricDelta = 25;
    const above = moodMultiplier(MOOD_BASELINE + symmetricDelta) - 1.0;
    const below = 1.0 - moodMultiplier(MOOD_BASELINE - symmetricDelta);
    expect(below).toBeGreaterThan(above);
  });

  it('is monotonic — higher mood yields higher multiplier', () => {
    const samples = [0, 10, 30, 50, 75, 90, 100];
    for (let i = 1; i < samples.length; i++) {
      expect(moodMultiplier(samples[i]!)).toBeGreaterThan(
        moodMultiplier(samples[i - 1]!),
      );
    }
  });

  it('clamps to expected end values', () => {
    expect(moodMultiplier(0)).toBeCloseTo(0.94, 5);
    expect(moodMultiplier(100)).toBeCloseTo(1.015, 5);
  });
});

describe('teamStrength × mood', () => {
  it('all-happy roster has greater strength than the same roster frustrated', () => {
    const base = createLeague({ seed: 'mood-strength' });
    const team = Object.values(base.teams)[0]!;

    const happyPlayers: typeof base.players = { ...base.players };
    const sadPlayers: typeof base.players = { ...base.players };
    for (const id of team.rosterIds) {
      const p = base.players[id]!;
      happyPlayers[id] = { ...p, mood: 100 };
      sadPlayers[id] = { ...p, mood: 0 };
    }

    const happyStrength = teamStrength(team, { ...base, players: happyPlayers });
    const sadStrength = teamStrength(team, { ...base, players: sadPlayers });
    expect(happyStrength).toBeGreaterThan(sadStrength);
  });
});

describe('player mood initialization', () => {
  it('every generated player starts at their setPoint', () => {
    const league = createLeague({ seed: 'mood-init' });
    for (const player of Object.values(league.players)) {
      expect(player.mood).toBe(player.moodProfile.setPoint);
    }
  });

  it('league-wide setPoints span a realistic personality range', () => {
    const league = createLeague({ seed: 'mood-init-range' });
    const setPoints = Object.values(league.players).map((p) => p.moodProfile.setPoint);
    const min = Math.min(...setPoints);
    const max = Math.max(...setPoints);
    // Distractions floor 35; stabilizers ceiling 90 — we expect at
    // least one of each in a 32-team league worth of players.
    expect(min).toBeLessThan(60);
    expect(max).toBeGreaterThan(80);
  });

  it('every generated player has a moodProfile archetype label', () => {
    const league = createLeague({ seed: 'mood-init-archetype' });
    const archetypes = new Set<string>();
    for (const player of Object.values(league.players)) {
      archetypes.add(player.moodProfile.archetype);
    }
    // All five archetypes should appear across ~1700 players.
    expect(archetypes.has('stabilizer')).toBe(true);
    expect(archetypes.has('anchor')).toBe(true);
    expect(archetypes.has('normal')).toBe(true);
    expect(archetypes.has('moody')).toBe(true);
    expect(archetypes.has('distraction')).toBe(true);
  });
});

describe('weeklyMoodUpdate', () => {
  it('is a no-op when no weeks have been played', () => {
    const league = createLeague({ seed: 'mood-noplay' });
    const result = weeklyMoodUpdate({
      league,
      playedWeeks: [],
      tick: league.tick,
      prng: new Prng('mood-test'),
    });
    expect(result.players).toEqual(league.players);
    expect(result.transactionLog).toBe(league.transactionLog);
  });

  it('is deterministic across identical inputs', () => {
    const a = simulateSeason(createLeague({ seed: 'mood-det' }));
    const b = simulateSeason(createLeague({ seed: 'mood-det' }));
    const moodsA = Object.values(a.players).map((p) => p.mood);
    const moodsB = Object.values(b.players).map((p) => p.mood);
    expect(moodsA).toEqual(moodsB);
  });

  it('moves player moods away from baseline over a full season', () => {
    const after = simulateSeason(createLeague({ seed: 'mood-drift' }));
    const players = Object.values(after.players).filter((p) => p.teamId !== null);
    const shifted = players.filter((p) => p.mood !== MOOD_BASELINE).length;
    // Most rostered players should have moved off the baseline after 18
    // weeks of W/L churn, HC fit drift, and depth-chart pressure.
    expect(shifted).toBeGreaterThan(players.length * 0.5);
  });

  it('produces values clamped to 0..100', () => {
    const after = simulateSeason(createLeague({ seed: 'mood-clamp' }));
    for (const p of Object.values(after.players)) {
      expect(p.mood).toBeGreaterThanOrEqual(0);
      expect(p.mood).toBeLessThanOrEqual(100);
    }
  });

  it('emits mood-shift transactions when buckets cross', () => {
    const after = simulateSeason(createLeague({ seed: 'mood-shifts' }));
    const moodShifts = after.transactionLog.filter((t) => t.kind === 'mood-shift');
    expect(moodShifts.length).toBeGreaterThan(0);
    for (const t of moodShifts) {
      if (t.kind !== 'mood-shift') continue; // type narrowing
      expect(t.fromBucket).not.toBe(t.toBucket);
      expect(MOOD_BUCKETS).toContain(t.fromBucket);
      expect(MOOD_BUCKETS).toContain(t.toBucket);
      expect(t.mood).toBeGreaterThanOrEqual(0);
      expect(t.mood).toBeLessThanOrEqual(100);
    }
  });

  it('rewards players whose team won the last week', () => {
    // Controlled setup: boost the team's HC to high relationships and
    // promote a single rostered player to STAR so we know depth + HC
    // both push positive. Team result of +0.6 is then unambiguous.
    const base = createLeague({ seed: 'mood-win' });
    const team = Object.values(base.teams)[0]!;
    const other = Object.values(base.teams).find(
      (t) => t.identity.id !== team.identity.id,
    )!;
    const pid = team.rosterIds[0]!;
    const league = withBoostedScenario(base, team.identity.id, pid, { boostHc: true });
    const before = league.players[pid]!.mood;
    const { players } = weeklyMoodUpdate({
      league,
      playedWeeks: [[makeFakeGame(team.identity.id, other.identity.id, 27, 10)]],
      tick: league.tick,
      prng: new Prng('mood-test'),
    });
    const after = players[pid]!.mood;
    expect(after).toBeGreaterThan(before);
  });

  it('punishes players whose team is on a long losing streak', () => {
    const base = createLeague({ seed: 'mood-losing' });
    const team = Object.values(base.teams)[0]!;
    const other = Object.values(base.teams).find(
      (t) => t.identity.id !== team.identity.id,
    )!;
    const pid = team.rosterIds[0]!;
    const league = withBoostedScenario(base, team.identity.id, pid);
    const losses = Array.from({ length: 5 }, (_, i) =>
      [makeFakeGame(team.identity.id, other.identity.id, 3, 27, i)],
    );
    const before = league.players[pid]!.mood;
    const { players } = weeklyMoodUpdate({
      league,
      playedWeeks: losses,
      tick: league.tick,
      prng: new Prng('mood-test'),
    });
    const after = players[pid]!.mood;
    // Loss (-0.6) + 5-game losing streak amplifier (-1.0) net to -1.6
    // before HC/depth. With a high-relationships starting STAR we still
    // expect a clear drop of at least half a mood point.
    expect(after).toBeLessThan(before - 0.5);
  });

  it('high-playerRelationships HC raises mood vs a low one over a season', () => {
    // Swap every team's HC to a high-relationships profile and re-sim,
    // compare against the same league simmed normally.
    const baseline = simulateSeason(createLeague({ seed: 'mood-hc-compare' }));
    const baseAvg = avgMoodOnRoster(baseline);

    const handCoded = createLeague({ seed: 'mood-hc-compare' });
    const boostedCoaches: Record<CoachId, HeadCoach> = {};
    for (const [id, hc] of Object.entries(handCoded.coaches)) {
      boostedCoaches[id as CoachId] = withHighRelationships(hc);
    }
    const boostedLeague: LeagueState = {
      ...handCoded,
      coaches: boostedCoaches,
    };
    const boostedAfter = simulateSeason(boostedLeague);
    const boostedAvg = avgMoodOnRoster(boostedAfter);

    expect(boostedAvg).toBeGreaterThan(baseAvg);
  });

  it('low-composure players spiral faster on losses than high-composure peers', () => {
    const league = createLeague({ seed: 'mood-composure' });
    const team = Object.values(league.teams)[0]!;
    const other = Object.values(league.teams).find(
      (t) => t.identity.id !== team.identity.id,
    )!;
    // Find two rostered players with different composure profiles.
    const rostered = team.rosterIds.map((id) => league.players[id]!);
    const high = rostered.find((p) => p.current.composure >= 80);
    const low = rostered.find((p) => p.current.composure <= 30);
    if (!high || !low) {
      // Roster generation doesn't always produce both extremes; if not
      // present this iteration, skip rather than fail flakily.
      return;
    }

    const losses = [
      [makeFakeGame(team.identity.id, other.identity.id, 0, 24, 0)],
      [makeFakeGame(team.identity.id, other.identity.id, 7, 31, 1)],
      [makeFakeGame(team.identity.id, other.identity.id, 10, 28, 2)],
    ];
    const { players } = weeklyMoodUpdate({
      league,
      playedWeeks: losses,
      tick: league.tick,
      prng: new Prng('mood-test'),
    });
    const highDrop = high.mood - players[high.id]!.mood;
    const lowDrop = low.mood - players[low.id]!.mood;
    expect(lowDrop).toBeGreaterThan(highDrop);
  });
});

describe('scheme-fit driver', () => {
  // QB_PRECISION_PASSER scheme fits from the catalog:
  //   WEST_COAST 1.4 (delta +0.4/wk)
  //   AIR_RAID 0.85 (delta -0.15/wk)
  // A meaningful gap that's still smaller than the W/L driver.
  const GOOD_FIT_ARCHETYPE = 'QB_PRECISION_PASSER' as const;
  const GOOD_FIT_SCHEME: OffensiveSchemeArchetype = 'WEST_COAST';
  const BAD_FIT_SCHEME: OffensiveSchemeArchetype = 'AIR_RAID';

  function buildSchemeScenario(
    base: LeagueState,
    teamId: TeamId,
    playerId: import('../types/ids.js').PlayerId,
    scheme: OffensiveSchemeArchetype,
  ): LeagueState {
    const l = withBoostedScenario(base, teamId, playerId);
    const team = l.teams[teamId]!;
    const hc = l.coaches[team.headCoachId]!;
    return {
      ...l,
      coaches: {
        ...l.coaches,
        [team.headCoachId]: { ...hc, offensiveScheme: scheme },
      },
      players: {
        ...l.players,
        [playerId]: { ...l.players[playerId]!, archetype: GOOD_FIT_ARCHETYPE },
      },
    };
  }

  it('lifts mood for a player whose archetype fits the HC scheme', () => {
    const base = createLeague({ seed: 'mood-scheme-good' });
    const team = Object.values(base.teams)[0]!;
    const other = Object.values(base.teams).find(
      (t) => t.identity.id !== team.identity.id,
    )!;
    const pid = team.rosterIds[0]!;

    const goodFit = buildSchemeScenario(base, team.identity.id, pid, GOOD_FIT_SCHEME);
    const badFit = buildSchemeScenario(base, team.identity.id, pid, BAD_FIT_SCHEME);

    // A tied game neutralizes the W/L driver (both leagues see -0.1).
    const tie = [makeFakeGame(team.identity.id, other.identity.id, 14, 14)];
    const goodResult = weeklyMoodUpdate({
      league: goodFit,
      playedWeeks: [tie],
      tick: goodFit.tick,
      prng: new Prng('mood-test'),
    });
    const badResult = weeklyMoodUpdate({
      league: badFit,
      playedWeeks: [tie],
      tick: badFit.tick,
      prng: new Prng('mood-test'),
    });
    expect(goodResult.players[pid]!.mood).toBeGreaterThan(badResult.players[pid]!.mood);
  });

  it('compounds across multiple quiet weeks — direction is consistent', () => {
    // Run the same player through six identical tied weeks under each
    // scheme; the gap should widen monotonically. This catches
    // sign-flips or one-off lucky-noise wins that an N=1 test misses.
    const base = createLeague({ seed: 'mood-scheme-compound' });
    const team = Object.values(base.teams)[0]!;
    const other = Object.values(base.teams).find(
      (t) => t.identity.id !== team.identity.id,
    )!;
    const pid = team.rosterIds[0]!;

    let goodLeague = buildSchemeScenario(base, team.identity.id, pid, GOOD_FIT_SCHEME);
    let badLeague = buildSchemeScenario(base, team.identity.id, pid, BAD_FIT_SCHEME);
    const goodPrng = new Prng('mood-scheme-compound-good');
    const badPrng = new Prng('mood-scheme-compound-bad');

    const ties: ScheduledGame[][] = [];
    for (let i = 0; i < 6; i++) {
      ties.push([makeFakeGame(team.identity.id, other.identity.id, 14, 14, i)]);
      const goodRes = weeklyMoodUpdate({
        league: goodLeague,
        playedWeeks: ties,
        tick: goodLeague.tick,
        prng: goodPrng,
      });
      const badRes = weeklyMoodUpdate({
        league: badLeague,
        playedWeeks: ties,
        tick: badLeague.tick,
        prng: badPrng,
      });
      goodLeague = { ...goodLeague, players: goodRes.players };
      badLeague = { ...badLeague, players: badRes.players };
    }

    // After 6 quiet weeks the good-fit player should sit clearly above
    // the bad-fit one. We don't pin an exact gap because noise / drift
    // are stochastic, but the direction must hold.
    expect(goodLeague.players[pid]!.mood).toBeGreaterThan(badLeague.players[pid]!.mood);
  });

});

describe('locker-room contagion', () => {
  it('a team with many deeply frustrated players drags its other teammates down', () => {
    // Compare two parallel scenarios on a single league. Scenario A:
    // a third of one team's roster is forced to mood 5 with high
    // leadership (loud, frustrated veterans). Scenario B: same league
    // but no forced frustration. The remaining teammates should end
    // pass-2 with lower mood in A than B.
    const base = createLeague({ seed: 'contagion-spread' });
    const team = Object.values(base.teams)[0]!;
    const other = Object.values(base.teams).find(
      (t) => t.identity.id !== team.identity.id,
    )!;
    const frustratedIds = team.rosterIds.slice(0, Math.floor(team.rosterIds.length / 3));
    const cleanIds = team.rosterIds.filter((id) => !frustratedIds.includes(id));

    const withFrustration: typeof base.players = { ...base.players };
    for (const id of frustratedIds) {
      withFrustration[id] = {
        ...base.players[id]!,
        mood: 5,
        current: { ...base.players[id]!.current, leadership: 95 },
      };
    }
    const leagueA: LeagueState = { ...base, players: withFrustration };
    const leagueB: LeagueState = base;

    const wins = [[makeFakeGame(team.identity.id, other.identity.id, 17, 14)]];
    const a = weeklyMoodUpdate({ league: leagueA, playedWeeks: wins, tick: base.tick, prng: new Prng('mood-test') });
    const b = weeklyMoodUpdate({ league: leagueB, playedWeeks: wins, tick: base.tick, prng: new Prng('mood-test') });

    const avgCleanMood = (state: typeof a.players) =>
      cleanIds.reduce((s, id) => s + state[id]!.mood, 0) / cleanIds.length;
    expect(avgCleanMood(a.players)).toBeLessThan(avgCleanMood(b.players));
  });

  it('high-composure players resist contagion better than low-composure peers', () => {
    const base = createLeague({ seed: 'contagion-resist' });
    const team = Object.values(base.teams)[0]!;
    const other = Object.values(base.teams).find(
      (t) => t.identity.id !== team.identity.id,
    )!;

    // Pick two unaffected roster slots and fix their composure to
    // opposite extremes. Equalize their mood profiles (same setPoint,
    // same volatility) so the noise pass produces matching draws and
    // the comparison isolates composure-driven negative-drag resistance.
    const players: typeof base.players = { ...base.players };
    const stoicId = team.rosterIds[0]!;
    const volatileId = team.rosterIds[1]!;
    const sharedProfile = {
      archetype: 'normal' as const,
      setPoint: 70,
      volatility: 1,
      resilience: 0.5,
    };
    players[stoicId] = {
      ...players[stoicId]!,
      mood: 70,
      moodProfile: sharedProfile,
      current: { ...players[stoicId]!.current, composure: 95 },
    };
    players[volatileId] = {
      ...players[volatileId]!,
      mood: 70,
      moodProfile: sharedProfile,
      current: { ...players[volatileId]!.current, composure: 20 },
    };
    for (const id of team.rosterIds.slice(2, 2 + 10)) {
      players[id] = {
        ...players[id]!,
        mood: 5,
        current: { ...players[id]!.current, leadership: 95 },
      };
    }
    const league: LeagueState = { ...base, players };
    const wins = [[makeFakeGame(team.identity.id, other.identity.id, 21, 17)]];
    const { players: after } = weeklyMoodUpdate({
      league,
      playedWeeks: wins,
      tick: base.tick,
      prng: new Prng('mood-test'),
    });
    const stoicDrop = league.players[stoicId]!.mood - after[stoicId]!.mood;
    const volatileDrop = league.players[volatileId]!.mood - after[volatileId]!.mood;
    expect(volatileDrop).toBeGreaterThan(stoicDrop);
  });

  it('veteran leaders above baseline lift their teammates', () => {
    // Take a team. Promote a handful of players to "vet leader"
    // profile (mood 100, experienceYears 8, leadership + workEthic 95)
    // in scenario A. In scenario B, take the same league but force
    // those vet candidates' moods back to baseline so they don't
    // qualify as contributors. The unaffected teammates' mood should
    // end higher in A than in B after one weekly pass.
    const base = createLeague({ seed: 'pos-contagion-lift' });
    const team = Object.values(base.teams)[0]!;
    const other = Object.values(base.teams).find(
      (t) => t.identity.id !== team.identity.id,
    )!;
    const vetIds = team.rosterIds.slice(0, 4);
    const observerIds = team.rosterIds.filter((id) => !vetIds.includes(id));

    const makePlayers = (vetMood: number) => {
      const players: typeof base.players = { ...base.players };
      for (const id of vetIds) {
        const p = base.players[id]!;
        players[id] = {
          ...p,
          mood: vetMood,
          experienceYears: 8,
          current: { ...p.current, leadership: 95, workEthic: 95 },
        };
      }
      return players;
    };

    const leagueA: LeagueState = { ...base, players: makePlayers(100) };
    const leagueB: LeagueState = { ...base, players: makePlayers(75) };
    const wins = [[makeFakeGame(team.identity.id, other.identity.id, 24, 14)]];
    const a = weeklyMoodUpdate({ league: leagueA, playedWeeks: wins, tick: base.tick, prng: new Prng('mood-test') });
    const b = weeklyMoodUpdate({ league: leagueB, playedWeeks: wins, tick: base.tick, prng: new Prng('mood-test') });

    const avgObserver = (state: typeof a.players) =>
      observerIds.reduce((s, id) => s + state[id]!.mood, 0) / observerIds.length;
    expect(avgObserver(a.players)).toBeGreaterThan(avgObserver(b.players));
  });

  it('rookies cannot project veteran leadership even when happy', () => {
    // Two scenarios on the same league. A: a cohort of happy ROOKIES
    // with sky-high leadership + workEthic. B: same cohort but tagged
    // as VETS (experienceYears = 10). Only B should generate lift.
    const base = createLeague({ seed: 'pos-contagion-rookie-gate' });
    const team = Object.values(base.teams)[0]!;
    const other = Object.values(base.teams).find(
      (t) => t.identity.id !== team.identity.id,
    )!;
    const cohortIds = team.rosterIds.slice(0, 5);
    const observerIds = team.rosterIds.filter((id) => !cohortIds.includes(id));

    const makePlayers = (exp: number) => {
      const players: typeof base.players = { ...base.players };
      for (const id of cohortIds) {
        const p = base.players[id]!;
        players[id] = {
          ...p,
          mood: 100,
          experienceYears: exp,
          current: { ...p.current, leadership: 95, workEthic: 95 },
        };
      }
      return players;
    };

    const rookieLeague: LeagueState = { ...base, players: makePlayers(0) };
    const vetLeague: LeagueState = { ...base, players: makePlayers(10) };
    const wins = [[makeFakeGame(team.identity.id, other.identity.id, 21, 10)]];
    const rookieAfter = weeklyMoodUpdate({
      league: rookieLeague,
      playedWeeks: wins,
      tick: base.tick,
      prng: new Prng('mood-test'),
    });
    const vetAfter = weeklyMoodUpdate({
      league: vetLeague,
      playedWeeks: wins,
      tick: base.tick,
      prng: new Prng('mood-test'),
    });

    const avgObserver = (state: typeof rookieAfter.players) =>
      observerIds.reduce((s, id) => s + state[id]!.mood, 0) / observerIds.length;
    expect(avgObserver(vetAfter.players)).toBeGreaterThan(avgObserver(rookieAfter.players));
  });

  it('coachable teammates absorb more vet leadership lift than uncoachable peers', () => {
    // Compare deltas for the *same* observer across two scenarios that
    // differ only in their coachability. This isolates receptivity from
    // depth-chart / composure / position noise that would muddy a
    // two-player comparison.
    const base = createLeague({ seed: 'pos-contagion-receptivity' });
    const team = Object.values(base.teams)[0]!;
    const other = Object.values(base.teams).find(
      (t) => t.identity.id !== team.identity.id,
    )!;
    // Pick someone deep in the roster so they're not affected by tier
    // depth-chart bonuses for being a clear starter.
    const observerId = team.rosterIds[20] ?? team.rosterIds[10] ?? team.rosterIds[0]!;
    const vetIds = team.rosterIds.slice(0, 5).filter((id) => id !== observerId);

    const buildLeague = (coachability: number): LeagueState => {
      const players: typeof base.players = { ...base.players };
      const observer = players[observerId]!;
      players[observerId] = {
        ...observer,
        current: { ...observer.current, coachability },
      };
      for (const id of vetIds) {
        const p = players[id]!;
        players[id] = {
          ...p,
          mood: 100,
          experienceYears: 8,
          current: { ...p.current, leadership: 95, workEthic: 95 },
        };
      }
      return { ...base, players };
    };

    const wins = [[makeFakeGame(team.identity.id, other.identity.id, 17, 13)]];
    const high = buildLeague(95);
    const low = buildLeague(25);
    const afterHigh = weeklyMoodUpdate({ league: high, playedWeeks: wins, tick: base.tick, prng: new Prng('mood-test-high') });
    const afterLow = weeklyMoodUpdate({ league: low, playedWeeks: wins, tick: base.tick, prng: new Prng('mood-test-high') });
    const highDelta = afterHigh.players[observerId]!.mood - high.players[observerId]!.mood;
    const lowDelta = afterLow.players[observerId]!.mood - low.players[observerId]!.mood;
    expect(highDelta).toBeGreaterThan(lowDelta);
  });

  it('a calm roster with no frustrated players generates no negative contagion drag', () => {
    // Suppress noise by setting volatility = 0 on every roster member.
    // Force everyone above the drag ceiling. Verify the negative
    // contagion pass produces no drag — every player's mood should
    // remain at or above their setPoint after a single winning week.
    const base = createLeague({ seed: 'contagion-quiet' });
    const team = Object.values(base.teams)[0]!;
    const other = Object.values(base.teams).find(
      (t) => t.identity.id !== team.identity.id,
    )!;
    const players: typeof base.players = { ...base.players };
    for (const id of [...team.rosterIds, ...team.injuredReserveIds]) {
      const p = players[id]!;
      players[id] = {
        ...p,
        mood: 75,
        moodProfile: { ...p.moodProfile, setPoint: 75, volatility: 0 },
      };
    }
    const league: LeagueState = { ...base, players };
    const wins = [[makeFakeGame(team.identity.id, other.identity.id, 24, 7)]];
    const { players: after } = weeklyMoodUpdate({
      league,
      playedWeeks: wins,
      tick: base.tick,
      prng: new Prng('mood-test'),
    });
    // With volatility=0 the noise pass is silent. With everyone at the
    // setPoint there's no negative contagion. The only non-zero
    // contributors are the team-win bonus + (possibly) HC fit. So
    // every teammate should end at >= 75.
    for (const id of team.rosterIds) {
      expect(after[id]!.mood).toBeGreaterThanOrEqual(75);
    }
  });
});

describe('long-horizon stability (v0.18.0 saturation regression)', () => {
  // Instrumentation — not a strict assertion test. Logs per-season
  // league mood mean and league setPoint mean (recomputed each season
  // because retirement + rookie churn shifts the distribution), and
  // the running delta. Run with `pnpm test -- --run mood -t "trajectory"`
  // when investigating drift. The lone assertion is loose (delta < 15)
  // — purpose is the log output, not the gate.
  it('instrument: per-tier and per-archetype mood drift', () => {
    // The aggregate trajectory test below shows the league-mean delta
    // sits near zero. But the user reports visible upward drift in the
    // inspector — meaning the bias is hiding in a subset masked by
    // averaging. Slice by tier and by personality archetype to find
    // where it lives.
    const seeds = ['slice-a', 'slice-b', 'slice-c'];
    const N_SEASONS = 8;
    type Slice = { name: string; mood: number; setPoint: number; n: number };
    const accumulate = (rows: Slice[], key: string, mood: number, setPoint: number) => {
      let row = rows.find((r) => r.name === key);
      if (!row) {
        row = { name: key, mood: 0, setPoint: 0, n: 0 };
        rows.push(row);
      }
      row.mood += mood;
      row.setPoint += setPoint;
      row.n += 1;
    };
    const tierRows: Slice[] = [];
    const archetypeRows: Slice[] = [];
    for (const seed of seeds) {
      let league = createLeague({ seed });
      for (let i = 0; i < N_SEASONS; i++) {
        league = simulateSeason(league);
        league = advanceSeason(league);
      }
      for (const p of Object.values(league.players)) {
        if (p.teamId === null) continue;
        accumulate(tierRows, p.tier, p.mood, p.moodProfile.setPoint);
        accumulate(archetypeRows, p.moodProfile.archetype, p.mood, p.moodProfile.setPoint);
      }
    }
    console.log(`\n=== By tier (avg across ${seeds.length} seeds × ${N_SEASONS} seasons) ===`);
    console.log('tier      | n     | mood   | setpt  | delta');
    for (const r of tierRows.sort((a, b) => a.name.localeCompare(b.name))) {
      const moodAvg = r.mood / r.n;
      const setPointAvg = r.setPoint / r.n;
      const d = moodAvg - setPointAvg;
      console.log(
        `${r.name.padEnd(9)} | ${String(r.n).padStart(5)} | ${moodAvg.toFixed(2).padStart(6)} | ${setPointAvg.toFixed(2).padStart(6)} | ${d >= 0 ? '+' : ''}${d.toFixed(2)}`,
      );
    }
    console.log(`\n=== By personality archetype ===`);
    console.log('archetype   | n     | mood   | setpt  | delta');
    for (const r of archetypeRows.sort((a, b) => a.name.localeCompare(b.name))) {
      const moodAvg = r.mood / r.n;
      const setPointAvg = r.setPoint / r.n;
      const d = moodAvg - setPointAvg;
      console.log(
        `${r.name.padEnd(11)} | ${String(r.n).padStart(5)} | ${moodAvg.toFixed(2).padStart(6)} | ${setPointAvg.toFixed(2).padStart(6)} | ${d >= 0 ? '+' : ''}${d.toFixed(2)}`,
      );
    }
    // No assertion — log-only diagnostic.
    expect(true).toBe(true);
  });

  it('instrument: long-tenured player mood drift', () => {
    // Track players who've been on a roster for many seasons. If
    // long-tenured players accumulate upward bias each season that
    // would explain a "drift up year over year" visible bug while
    // league-wide averages look fine (most players churn out within
    // a few years).
    const seed = 'tenure-a';
    const N_SEASONS = 10;
    let league = createLeague({ seed });
    // Snapshot per-player mood + setPoint at season 0.
    const baseline = new Map<string, { mood: number; setPoint: number; archetype: string; tier: string }>();
    for (const p of Object.values(league.players)) {
      if (p.teamId === null) continue;
      baseline.set(p.id, {
        mood: p.mood,
        setPoint: p.moodProfile.setPoint,
        archetype: p.moodProfile.archetype,
        tier: p.tier,
      });
    }
    for (let i = 0; i < N_SEASONS; i++) {
      league = simulateSeason(league);
      league = advanceSeason(league);
    }
    // Find players who started season-0 and are still rostered at season-N.
    const survivors: { id: string; baseMood: number; baseSetPoint: number; finalMood: number; finalSetPoint: number; archetype: string; tier: string }[] = [];
    for (const p of Object.values(league.players)) {
      if (p.teamId === null) continue;
      const b = baseline.get(p.id);
      if (!b) continue;
      survivors.push({
        id: p.id,
        baseMood: b.mood,
        baseSetPoint: b.setPoint,
        finalMood: p.mood,
        finalSetPoint: p.moodProfile.setPoint,
        archetype: b.archetype,
        tier: b.tier,
      });
    }
    console.log(`\n=== Long-tenured player drift (${survivors.length} survivors after ${N_SEASONS} seasons) ===`);
    if (survivors.length === 0) {
      console.log('(no players survived all seasons)');
    } else {
      const moodChange = survivors.reduce((s, p) => s + (p.finalMood - p.baseMood), 0) / survivors.length;
      const setPointChange = survivors.reduce((s, p) => s + (p.finalSetPoint - p.baseSetPoint), 0) / survivors.length;
      const finalDelta = survivors.reduce((s, p) => s + (p.finalMood - p.finalSetPoint), 0) / survivors.length;
      console.log(`Avg mood change:     ${moodChange >= 0 ? '+' : ''}${moodChange.toFixed(2)}`);
      console.log(`Avg setPoint change: ${setPointChange >= 0 ? '+' : ''}${setPointChange.toFixed(2)} (should be ~0; setPoint is stable)`);
      console.log(`Avg final mood - final setPoint: ${finalDelta >= 0 ? '+' : ''}${finalDelta.toFixed(2)}`);
      // Break down by tier.
      const byTier = new Map<string, { count: number; moodDelta: number }>();
      for (const s of survivors) {
        const row = byTier.get(s.tier) ?? { count: 0, moodDelta: 0 };
        row.count += 1;
        row.moodDelta += s.finalMood - s.baseMood;
        byTier.set(s.tier, row);
      }
      console.log(`\nMood change by season-0 tier:`);
      for (const [tier, row] of [...byTier].sort()) {
        console.log(`  ${tier.padEnd(9)} (n=${row.count}): ${row.moodDelta / row.count >= 0 ? '+' : ''}${(row.moodDelta / row.count).toFixed(2)}`);
      }
    }
    expect(true).toBe(true);
  });

  it('instrument: per-season mood trajectory vs setPoint', () => {
    const seeds = ['traj-a', 'traj-b', 'traj-c'];
    const N_SEASONS = 12;
    const trajectories: { seed: string; rows: { season: number; moodMean: number; setPointMean: number; delta: number }[] }[] = [];
    for (const seed of seeds) {
      let league = createLeague({ seed });
      const rows: { season: number; moodMean: number; setPointMean: number; delta: number }[] = [];
      // Record season 0 (pre-sim) baseline.
      const initRostered = Object.values(league.players).filter((p) => p.teamId !== null);
      rows.push({
        season: 0,
        moodMean: initRostered.reduce((s, p) => s + p.mood, 0) / initRostered.length,
        setPointMean: initRostered.reduce((s, p) => s + p.moodProfile.setPoint, 0) / initRostered.length,
        delta: 0,
      });
      rows[0]!.delta = rows[0]!.moodMean - rows[0]!.setPointMean;
      for (let i = 1; i <= N_SEASONS; i++) {
        league = simulateSeason(league);
        league = advanceSeason(league);
        const rostered = Object.values(league.players).filter((p) => p.teamId !== null);
        const moodMean = rostered.reduce((s, p) => s + p.mood, 0) / rostered.length;
        const setPointMean = rostered.reduce((s, p) => s + p.moodProfile.setPoint, 0) / rostered.length;
        rows.push({ season: i, moodMean, setPointMean, delta: moodMean - setPointMean });
      }
      trajectories.push({ seed, rows });
    }
    // Log a compact table per seed.
    for (const t of trajectories) {
      console.log(`\n--- ${t.seed} ---`);
      console.log('season | mood_mean | setpt_mean | delta');
      for (const r of t.rows) {
        console.log(
          `  ${String(r.season).padStart(2)}   |   ${r.moodMean.toFixed(2)}   |   ${r.setPointMean.toFixed(2)}    | ${r.delta >= 0 ? '+' : ''}${r.delta.toFixed(2)}`,
        );
      }
    }
    // Loose gate so this test can run in CI without flakiness — real
    // assertions live in the strict regression tests below. We just
    // want the log to surface.
    for (const t of trajectories) {
      for (const r of t.rows) {
        expect(Math.abs(r.delta)).toBeLessThan(15);
      }
    }
  });

  it('league-mean mood tracks the league-mean setPoint over many seasons', () => {
    // The v0.17.0/early-v0.18.0 bug was systemic upward drift: every
    // driver leaned a little positive, the offseason drift only pulled
    // back partially, and after a few seasons the whole league sat
    // pegged near 100. The fix balances every driver to be zero-mean
    // across the league, so the long-horizon mean must stay close to
    // the league-mean setPoint (~67 from the archetype weighting).
    // Run several seeds + many seasons to make sure the equilibrium
    // doesn't drift across runs.
    const seeds = ['v018-eq-a', 'v018-eq-b', 'v018-eq-c', 'v018-eq-d'];
    let totalSetPoint = 0;
    let totalMood = 0;
    let totalPlayers = 0;
    for (const seed of seeds) {
      let league = createLeague({ seed });
      const rostered = Object.values(league.players).filter((p) => p.teamId !== null);
      totalSetPoint += rostered.reduce((s, p) => s + p.moodProfile.setPoint, 0);
      for (let i = 0; i < 8; i++) {
        league = simulateSeason(league);
        league = advanceSeason(league);
      }
      const moods = Object.values(league.players)
        .filter((p) => p.teamId !== null)
        .map((p) => p.mood);
      totalMood += moods.reduce((s, m) => s + m, 0);
      totalPlayers += moods.length;
      // No team-level saturation either.
      const at100 = moods.filter((m) => m >= 99).length;
      const at0 = moods.filter((m) => m <= 1).length;
      expect(at100 / moods.length).toBeLessThan(0.02);
      expect(at0 / moods.length).toBeLessThan(0.02);
    }
    const setPointMean = totalSetPoint / totalPlayers;
    const moodMean = totalMood / totalPlayers;
    // Across 4 seeds × 8 seasons the average mood should land within
    // ±5 points of the average setPoint. Wider than this was the bug.
    expect(Math.abs(moodMean - setPointMean)).toBeLessThan(5);
  });

  it('teams with good HC playerRelationships trend above league mean; bad HC trend below', () => {
    // The user-facing requirement: "good coaches should trend their
    // teams up, bad coaches should trend their teams down." If every
    // driver were zero-mean across the league but had no per-team
    // variance the test of the previous block would pass and this one
    // would not — so this guards the *dispersion* side of the contract.
    let league = createLeague({ seed: 'v018-hc-dispersion' });
    for (let i = 0; i < 4; i++) {
      league = simulateSeason(league);
      league = advanceSeason(league);
    }
    const teamMeans: { teamId: string; hcRel: number; moodMean: number }[] = [];
    for (const team of Object.values(league.teams)) {
      const hc = league.coaches[team.headCoachId];
      if (!hc) continue;
      const rosterMoods = team.rosterIds
        .map((id) => league.players[id])
        .filter((p) => p !== undefined)
        .map((p) => p!.mood);
      if (rosterMoods.length === 0) continue;
      teamMeans.push({
        teamId: team.identity.id,
        hcRel: hc.spectrums.playerRelationships,
        moodMean: rosterMoods.reduce((s, m) => s + m, 0) / rosterMoods.length,
      });
    }
    const leagueMean = teamMeans.reduce((s, t) => s + t.moodMean, 0) / teamMeans.length;
    // Split top and bottom quartiles by HC playerRelationships, compare
    // their team-mood means. Top quartile should clearly lead.
    const sortedByHc = [...teamMeans].sort((a, b) => a.hcRel - b.hcRel);
    const q = Math.floor(sortedByHc.length / 4);
    const bottomQ = sortedByHc.slice(0, q);
    const topQ = sortedByHc.slice(-q);
    const bottomMean = bottomQ.reduce((s, t) => s + t.moodMean, 0) / bottomQ.length;
    const topMean = topQ.reduce((s, t) => s + t.moodMean, 0) / topQ.length;
    expect(topMean).toBeGreaterThan(bottomMean);
    // Dispersion is measurable but compressed by the offseason 0.9
    // pull-back to setPoint — most HC influence accumulates within a
    // single season, then resets. The directional ordering matters
    // more than absolute magnitude here.
    expect(topMean - bottomMean).toBeGreaterThan(1);
    // Both groups should fall within sensible distance of the league
    // mean (no group has saturated up or down).
    expect(Math.abs(topMean - leagueMean)).toBeLessThan(15);
    expect(Math.abs(bottomMean - leagueMean)).toBeLessThan(15);
  });

  it('distractions track lower than stabilizers over a simmed season', () => {
    const league = simulateSeason(createLeague({ seed: 'v018-archetypes' }));
    const byArchetype = new Map<string, number[]>();
    for (const p of Object.values(league.players)) {
      if (p.teamId === null) continue;
      const list = byArchetype.get(p.moodProfile.archetype) ?? [];
      list.push(p.mood);
      byArchetype.set(p.moodProfile.archetype, list);
    }
    const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
    const distractionMean = avg(byArchetype.get('distraction') ?? []);
    const stabilizerMean = avg(byArchetype.get('stabilizer') ?? []);
    expect(distractionMean).toBeLessThan(stabilizerMean);
    // And the gap should be meaningful — at least ~15 mood points apart.
    expect(stabilizerMean - distractionMean).toBeGreaterThan(15);
  });

  it('emits locker-room-incident transactions across a season', () => {
    const after = simulateSeason(createLeague({ seed: 'v018-incidents' }));
    const incidents = after.transactionLog.filter(
      (t) => t.kind === 'locker-room-incident',
    );
    // 32 teams × 17 weeks × ~50 players × ~1% avg incident rate = a few
    // hundred. The exact count varies by seed but should be solidly
    // non-zero and not absurdly large.
    expect(incidents.length).toBeGreaterThan(20);
    expect(incidents.length).toBeLessThan(3000);
  });
});

describe('practice-squad mood', () => {
  it('PS players evolve through a season — not all frozen at setPoint', () => {
    const before = createLeague({ seed: 'ps-evolve' });
    const after = simulateSeason(before);
    const psAfter = collectPracticeSquad(after);
    expect(psAfter.length).toBeGreaterThan(0);
    let moved = 0;
    for (const p of psAfter) {
      const baseline = before.players[p.id];
      if (baseline && Math.abs(p.mood - baseline.mood) > 0.5) moved++;
    }
    // Most PS players should drift off their generation-time setPoint
    // across 18 weeks of dampened drivers + noise. Threshold is loose
    // (40%) to absorb the long tail of low-volatility stabilizers that
    // sit tight; the point of the test is that the loop runs at all.
    expect(moved).toBeGreaterThan(psAfter.length * 0.4);
  });

  it('PS players never generate locker-room-incident transactions', () => {
    const after = simulateSeason(createLeague({ seed: 'ps-no-incidents' }));
    const psIds = collectPsIds(after);
    const incidentsOnPs = after.transactionLog.filter(
      (t) => t.kind === 'locker-room-incident' && psIds.has(t.playerId),
    );
    expect(incidentsOnPs).toHaveLength(0);
  });

  it('PS players never generate trade-request transactions', () => {
    const after = simulateSeason(createLeague({ seed: 'ps-no-trade-req' }));
    const psIds = collectPsIds(after);
    const tradeReqsOnPs = after.transactionLog.filter(
      (t) => t.kind === 'trade-request' && psIds.has(t.playerId),
    );
    expect(tradeReqsOnPs).toHaveLength(0);
  });

  it('PS players are insulated from active-roster contagion drag', () => {
    // Force the entire active roster of one team to mood=5 (deep
    // wants_out) so contagion fires at max strength. The team's PS
    // player at mood=75 should barely move — drift toward setPoint
    // and a dampened tie-game team result are the only drivers.
    const base = createLeague({ seed: 'ps-no-contagion' });
    const team = Object.values(base.teams)[0]!;
    const other = Object.values(base.teams).find(
      (t) => t.identity.id !== team.identity.id,
    )!;
    const psId = team.practiceSquadIds[0]!;
    const playersNext = { ...base.players };
    for (const id of [...team.rosterIds, ...team.injuredReserveIds]) {
      const p = playersNext[id];
      if (p) playersNext[id] = { ...p, mood: 5 };
    }
    const psPlayer = playersNext[psId]!;
    playersNext[psId] = { ...psPlayer, mood: 75 };
    const league: LeagueState = { ...base, players: playersNext };
    const { players } = weeklyMoodUpdate({
      league,
      playedWeeks: [[makeFakeGame(team.identity.id, other.identity.id, 14, 14)]],
      tick: league.tick,
      prng: new Prng('ps-contagion-test'),
    });
    // If contagion leaked into PS the room would have dragged a 75-mood
    // player well below 65. The 60 floor leaves headroom for noise.
    expect(players[psId]!.mood).toBeGreaterThan(60);
  });

  it('emits mood-shift transactions for PS players crossing bucket boundaries', () => {
    // PS player at mood 41 (just above the unsettled→frustrated boundary)
    // with setPoint 10 + max resilience should drop a bucket from drift
    // alone (drift = (10-41) * 1.0 * 0.05 = -1.55), with a losing streak
    // adding another -0.48 on top via the dampened team-result driver.
    const base = createLeague({ seed: 'ps-mood-shift' });
    const team = Object.values(base.teams)[0]!;
    const other = Object.values(base.teams).find(
      (t) => t.identity.id !== team.identity.id,
    )!;
    const psId = team.practiceSquadIds[0]!;
    const psPlayer = base.players[psId]!;
    const league: LeagueState = {
      ...base,
      players: {
        ...base.players,
        [psId]: {
          ...psPlayer,
          mood: 41,
          moodProfile: { ...psPlayer.moodProfile, setPoint: 10, volatility: 3, resilience: 1.0 },
        },
      },
    };
    const losses = [
      [makeFakeGame(team.identity.id, other.identity.id, 0, 24, 0)],
      [makeFakeGame(team.identity.id, other.identity.id, 7, 31, 1)],
      [makeFakeGame(team.identity.id, other.identity.id, 10, 28, 2)],
    ];
    const { players, transactionLog } = weeklyMoodUpdate({
      league,
      playedWeeks: losses,
      tick: league.tick,
      prng: new Prng('ps-shift-test'),
    });
    expect(players[psId]!.mood).toBeLessThan(40);
    const shifts = transactionLog.filter(
      (t) => t.kind === 'mood-shift' && t.playerId === psId,
    );
    expect(shifts).toHaveLength(1);
  });

  it('PS players still get offseason drift toward setPoint', () => {
    const base = createLeague({ seed: 'ps-offseason' });
    const team = Object.values(base.teams)[0]!;
    const psId = team.practiceSquadIds[0]!;
    const psPlayer = base.players[psId]!;
    const setPoint = psPlayer.moodProfile.setPoint;
    const league: LeagueState = {
      ...base,
      players: {
        ...base.players,
        [psId]: { ...psPlayer, mood: 20 },
      },
    };
    const after = offseasonMoodDrift(league);
    const expected = 20 + (setPoint - 20) * 0.9;
    expect(after.players[psId]!.mood).toBeCloseTo(expected, 1);
  });

  it('PS HC influence lands at lower strength than active HC influence', () => {
    // Boost every HC to max playerRelationships + CULTURE_CARRIER and
    // sim a season. PS sees the HC at 0.5×, so the mean mood lift over
    // baseline should be smaller for PS than for active roster.
    const baselineLeague = createLeague({ seed: 'ps-vs-active' });
    const boostedLeague = withBoostedAllHcRelationships(baselineLeague);

    const baselineAfter = simulateSeason(baselineLeague);
    const boostedAfter = simulateSeason(boostedLeague);

    const activeLift =
      avgMoodOnRoster(boostedAfter) - avgMoodOnRoster(baselineAfter);
    const psLift =
      avgMoodOnPracticeSquad(boostedAfter) - avgMoodOnPracticeSquad(baselineAfter);

    expect(activeLift).toBeGreaterThan(0);
    expect(psLift).toBeGreaterThan(0);
    expect(activeLift).toBeGreaterThan(psLift);
  });

  it('is deterministic across identical inputs', () => {
    const a = simulateSeason(createLeague({ seed: 'ps-determinism' }));
    const b = simulateSeason(createLeague({ seed: 'ps-determinism' }));
    const moodsA = collectPracticeSquad(a).map((p) => p.mood);
    const moodsB = collectPracticeSquad(b).map((p) => p.mood);
    expect(moodsA).toEqual(moodsB);
  });
});

describe('offseasonMoodDrift', () => {
  it('pulls mood ~90% back toward setPoint', () => {
    const league = createLeague({ seed: 'offseason-drift' });
    const player = Object.values(league.players)[0]!;
    const setPoint = player.moodProfile.setPoint;
    // Force player to a known mood far from setPoint.
    const startMood = 10;
    const expected = startMood + (setPoint - startMood) * 0.9;
    const withMood: LeagueState = {
      ...league,
      players: { ...league.players, [player.id]: { ...player, mood: startMood } },
    };
    const after = offseasonMoodDrift(withMood);
    expect(after.players[player.id]!.mood).toBeCloseTo(expected, 1);
  });

  it('clears an outstanding trade request when offseason mood recovers', () => {
    const league = createLeague({ seed: 'offseason-clear' });
    const player = Object.values(league.players)[0]!;
    // Force a high setPoint, low current mood, with an open trade request.
    const profile = { ...player.moodProfile, setPoint: 80 };
    const withRequest: LeagueState = {
      ...league,
      players: {
        ...league.players,
        [player.id]: {
          ...player,
          mood: 20,
          moodProfile: profile,
          tradeRequestedOnTick: league.tick - 1,
        },
      },
    };
    const after = offseasonMoodDrift(withRequest);
    // Mood drifts from 20 toward 80: 20 + (80-20)*0.9 = 74. Above resolve threshold (40).
    expect(after.players[player.id]!.mood).toBeGreaterThan(40);
    expect(after.players[player.id]!.tradeRequestedOnTick).toBeNull();
  });
});

describe('trade requests', () => {
  it('every generated player starts with no open trade request', () => {
    const league = createLeague({ seed: 'tr-init' });
    for (const p of Object.values(league.players)) {
      expect(p.tradeRequestedOnTick).toBeNull();
    }
  });

  it('STAR whose mood collapses below the threshold demands a trade', () => {
    const base = createLeague({ seed: 'tr-star' });
    const team = Object.values(base.teams)[0]!;
    const other = Object.values(base.teams).find(
      (t) => t.identity.id !== team.identity.id,
    )!;
    const pid = team.rosterIds[0]!;
    // Pre-collapse the player's mood so a single weekly pass settles
    // them under the threshold rather than needing a full season of
    // losing. `withBoostedScenario` neutralises HC so the assertion
    // isn't fighting random coach generation.
    const baseWithControl = withBoostedScenario(base, team.identity.id, pid);
    const league: LeagueState = {
      ...baseWithControl,
      players: {
        ...baseWithControl.players,
        [pid]: { ...baseWithControl.players[pid]!, mood: 14 },
      },
    };
    const losses = Array.from({ length: 5 }, (_, i) =>
      [makeFakeGame(team.identity.id, other.identity.id, 0, 27, i)],
    );
    const { players, transactionLog } = weeklyMoodUpdate({
      league,
      playedWeeks: losses,
      tick: league.tick + 5,
      prng: new Prng('mood-test'),
    });
    expect(players[pid]!.mood).toBeLessThanOrEqual(TRADE_REQUEST_THRESHOLD);
    expect(players[pid]!.tradeRequestedOnTick).toBe(league.tick + 5);
    const requests = transactionLog.filter(
      (t) => t.kind === 'trade-request',
    );
    expect(requests.length).toBe(1);
    const r = requests[0]!;
    if (r.kind !== 'trade-request') return; // narrow
    expect(r.state).toBe('requested');
    expect(r.playerId).toBe(pid);
    expect(r.tier).toBe('STAR');
  });

  it('BACKUP / FRINGE never demands a trade even when miserable', () => {
    const base = createLeague({ seed: 'tr-backup' });
    const team = Object.values(base.teams)[0]!;
    const other = Object.values(base.teams).find(
      (t) => t.identity.id !== team.identity.id,
    )!;
    // Force every rostered player to BACKUP at mood 5 — well under the
    // trigger threshold. None should generate a trade request.
    const players: typeof base.players = { ...base.players };
    for (const id of team.rosterIds) {
      players[id] = { ...base.players[id]!, mood: 5, tier: 'BACKUP' };
    }
    const league: LeagueState = { ...base, players };
    const losses = Array.from({ length: 3 }, (_, i) =>
      [makeFakeGame(team.identity.id, other.identity.id, 3, 30, i)],
    );
    const result = weeklyMoodUpdate({
      league,
      playedWeeks: losses,
      tick: league.tick + 3,
      prng: new Prng('mood-test'),
    });
    const requests = result.transactionLog.filter((t) => t.kind === 'trade-request');
    expect(requests).toHaveLength(0);
    for (const id of team.rosterIds) {
      expect(result.players[id]!.tradeRequestedOnTick).toBeNull();
    }
  });

  it('resolves an outstanding request once mood recovers above the resolve threshold', () => {
    const base = createLeague({ seed: 'tr-resolve' });
    const team = Object.values(base.teams)[0]!;
    const other = Object.values(base.teams).find(
      (t) => t.identity.id !== team.identity.id,
    )!;
    const pid = team.rosterIds[0]!;
    // Player is currently mood 38 with an OPEN trade request from a
    // prior week. Boost the HC to high relationships and feed a winning
    // streak so mood climbs back above the resolve threshold.
    const baseWithBoost = withBoostedScenario(
      base,
      team.identity.id,
      pid,
      { boostHc: true },
    );
    const league: LeagueState = {
      ...baseWithBoost,
      players: {
        ...baseWithBoost.players,
        [pid]: {
          ...baseWithBoost.players[pid]!,
          mood: 38,
          tradeRequestedOnTick: baseWithBoost.tick,
        },
      },
    };
    const wins = Array.from({ length: 5 }, (_, i) =>
      [makeFakeGame(team.identity.id, other.identity.id, 31, 7, i)],
    );
    const { players, transactionLog } = weeklyMoodUpdate({
      league,
      playedWeeks: wins,
      tick: league.tick + 5,
      prng: new Prng('mood-test'),
    });
    expect(players[pid]!.mood).toBeGreaterThanOrEqual(TRADE_REQUEST_RESOLVE_THRESHOLD);
    expect(players[pid]!.tradeRequestedOnTick).toBeNull();
    const resolves = transactionLog.filter(
      (t) => t.kind === 'trade-request' && t.state === 'resolved',
    );
    expect(resolves.length).toBe(1);
  });

  it('does not re-emit a request when an open one is already on file', () => {
    const base = createLeague({ seed: 'tr-no-spam' });
    const team = Object.values(base.teams)[0]!;
    const other = Object.values(base.teams).find(
      (t) => t.identity.id !== team.identity.id,
    )!;
    const pid = team.rosterIds[0]!;
    const league: LeagueState = {
      ...base,
      players: {
        ...base.players,
        [pid]: {
          ...base.players[pid]!,
          mood: 8,
          tier: 'STAR',
          tradeRequestedOnTick: base.tick - 1,
        },
      },
    };
    const losses = [
      [makeFakeGame(team.identity.id, other.identity.id, 0, 24, 0)],
    ];
    const result = weeklyMoodUpdate({
      league,
      playedWeeks: losses,
      tick: league.tick + 1,
      prng: new Prng('mood-test'),
    });
    const requests = result.transactionLog.filter((t) => t.kind === 'trade-request');
    expect(requests).toHaveLength(0);
  });
});

// ─── helpers ────────────────────────────────────────────────────────────────

let fakeGameCounter = 0;
function makeFakeGame(
  homeTeamId: TeamId,
  awayTeamId: TeamId,
  homeScore: number,
  awayScore: number,
  weekIdx = 0,
): ScheduledGame {
  fakeGameCounter += 1;
  const result: GameResult = {
    homeScore,
    awayScore,
    homeStats: {
      totalYards: 300,
      passingYards: 200,
      rushingYards: 100,
      turnovers: 1,
      sacks: 2,
      thirdDownConversionPct: 0.4,
      redZoneTdPct: 0.5,
    },
    awayStats: {
      totalYards: 300,
      passingYards: 200,
      rushingYards: 100,
      turnovers: 1,
      sacks: 2,
      thirdDownConversionPct: 0.4,
      redZoneTdPct: 0.5,
    },
    injuries: [],
    variance: 'moderate',
  };
  return {
    id: `G_fake_${fakeGameCounter}` as GameId,
    weekNumber: weekIdx + 1,
    homeTeamId,
    awayTeamId,
    result,
    kind: 'REGULAR',
  };
}

function avgMoodOnRoster(league: LeagueState): number {
  const rostered: Player[] = [];
  for (const team of Object.values(league.teams)) {
    for (const id of team.rosterIds) {
      const p = league.players[id];
      if (p) rostered.push(p);
    }
  }
  return rostered.reduce((s, p) => s + p.mood, 0) / rostered.length;
}

function withHighRelationships(hc: HeadCoach): HeadCoach {
  return {
    ...hc,
    spectrums: { ...hc.spectrums, playerRelationships: 10 },
    quirks: hc.quirks.includes('CULTURE_CARRIER')
      ? hc.quirks
      : [...hc.quirks, 'CULTURE_CARRIER'],
  };
}

/**
 * Build a controlled mood scenario: neutralise the HC (playerRelationships
 * 5.5, no CULTURE_CARRIER) and promote the target player to STAR with
 * mid composure. Keeps the test independent of seed randomness so an
 * assertion on the team-result driver isn't masked by random HC fit.
 *
 * `boostHc: true` adds the high-relationships + CULTURE_CARRIER bonus
 * on top so positive-direction tests get a clear win-side signal.
 */
function withBoostedScenario(
  league: LeagueState,
  teamId: TeamId,
  playerId: import('../types/ids.js').PlayerId,
  options: { boostHc?: boolean } = {},
): LeagueState {
  const team = league.teams[teamId]!;
  const hc = league.coaches[team.headCoachId]!;
  const player = league.players[playerId]!;
  const neutralHc: HeadCoach = {
    ...hc,
    spectrums: { ...hc.spectrums, playerRelationships: 5.5 },
    quirks: hc.quirks.filter((q) => q !== 'CULTURE_CARRIER'),
  };
  const tunedHc = options.boostHc ? withHighRelationships(neutralHc) : neutralHc;
  return {
    ...league,
    coaches: {
      ...league.coaches,
      [team.headCoachId]: tunedHc,
    },
    players: {
      ...league.players,
      [playerId]: {
        ...player,
        tier: 'STAR',
        current: { ...player.current, composure: 50 },
      },
    },
  };
}

function collectPracticeSquad(league: LeagueState): Player[] {
  const ps: Player[] = [];
  for (const team of Object.values(league.teams)) {
    for (const id of team.practiceSquadIds) {
      const p = league.players[id];
      if (p) ps.push(p);
    }
  }
  return ps;
}

function collectPsIds(league: LeagueState): Set<string> {
  const ids = new Set<string>();
  for (const team of Object.values(league.teams)) {
    for (const id of team.practiceSquadIds) ids.add(id);
  }
  return ids;
}

function avgMoodOnPracticeSquad(league: LeagueState): number {
  const ps = collectPracticeSquad(league);
  if (ps.length === 0) return 0;
  return ps.reduce((s, p) => s + p.mood, 0) / ps.length;
}

function withBoostedAllHcRelationships(league: LeagueState): LeagueState {
  const coaches: Record<CoachId, HeadCoach> = {};
  for (const [id, hc] of Object.entries(league.coaches)) {
    coaches[id as CoachId] = withHighRelationships(hc);
  }
  return { ...league, coaches };
}

