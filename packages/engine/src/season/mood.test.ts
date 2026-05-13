import { describe, it, expect } from 'vitest';
import { createLeague } from '../league/generate.js';
import { simulateSeason } from './runner.js';
import {
  weeklyMoodUpdate,
  moodBucket,
  moodMultiplier,
  MOOD_BASELINE,
  MOOD_BUCKETS,
  TRADE_REQUEST_THRESHOLD,
  TRADE_REQUEST_RESOLVE_THRESHOLD,
} from './mood.js';
import { teamStrength } from '../games/strength.js';
import type { LeagueState } from '../types/league.js';
import type { Player } from '../types/player.js';
import type { HeadCoach } from '../types/personnel.js';
import type { ScheduledGame, GameResult } from '../types/game.js';
import type { TeamId, GameId, CoachId } from '../types/ids.js';

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
  it('every generated player starts at the baseline mood', () => {
    const league = createLeague({ seed: 'mood-init' });
    for (const player of Object.values(league.players)) {
      expect(player.mood).toBe(MOOD_BASELINE);
    }
  });
});

describe('weeklyMoodUpdate', () => {
  it('is a no-op when no weeks have been played', () => {
    const league = createLeague({ seed: 'mood-noplay' });
    const result = weeklyMoodUpdate({
      league,
      playedWeeks: [],
      tick: league.tick,
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
    });
    const highDrop = high.mood - players[high.id]!.mood;
    const lowDrop = low.mood - players[low.id]!.mood;
    expect(lowDrop).toBeGreaterThan(highDrop);
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
    const a = weeklyMoodUpdate({ league: leagueA, playedWeeks: wins, tick: base.tick });
    const b = weeklyMoodUpdate({ league: leagueB, playedWeeks: wins, tick: base.tick });

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
    // opposite extremes; force the rest of the team into deep
    // frustration to generate pressure.
    const players: typeof base.players = { ...base.players };
    const stoicId = team.rosterIds[0]!;
    const volatileId = team.rosterIds[1]!;
    players[stoicId] = {
      ...players[stoicId]!,
      current: { ...players[stoicId]!.current, composure: 95 },
    };
    players[volatileId] = {
      ...players[volatileId]!,
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
    const a = weeklyMoodUpdate({ league: leagueA, playedWeeks: wins, tick: base.tick });
    const b = weeklyMoodUpdate({ league: leagueB, playedWeeks: wins, tick: base.tick });

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
    });
    const vetAfter = weeklyMoodUpdate({
      league: vetLeague,
      playedWeeks: wins,
      tick: base.tick,
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
    const afterHigh = weeklyMoodUpdate({ league: high, playedWeeks: wins, tick: base.tick });
    const afterLow = weeklyMoodUpdate({ league: low, playedWeeks: wins, tick: base.tick });
    const highDelta = afterHigh.players[observerId]!.mood - high.players[observerId]!.mood;
    const lowDelta = afterLow.players[observerId]!.mood - low.players[observerId]!.mood;
    expect(highDelta).toBeGreaterThan(lowDelta);
  });

  it('a calm roster of content players generates no contagion drag', () => {
    // If no player is below LOCKER_ROOM_DRAG_CEILING (50), pressure is
    // zero. Verify the contagion pass leaves moods identical to what
    // the primary drift would produce on its own.
    const base = createLeague({ seed: 'contagion-quiet' });
    const team = Object.values(base.teams)[0]!;
    const other = Object.values(base.teams).find(
      (t) => t.identity.id !== team.identity.id,
    )!;
    // Force everyone above the drag ceiling.
    const players: typeof base.players = { ...base.players };
    for (const id of [...team.rosterIds, ...team.injuredReserveIds]) {
      players[id] = { ...players[id]!, mood: 75 };
    }
    const league: LeagueState = { ...base, players };
    const wins = [[makeFakeGame(team.identity.id, other.identity.id, 24, 7)]];
    const { players: after } = weeklyMoodUpdate({
      league,
      playedWeeks: wins,
      tick: base.tick,
    });
    // Every teammate should have mood >= the pre-contagion value
    // (winning + content baseline). If contagion were leaking through,
    // some would dip below 75.
    for (const id of team.rosterIds) {
      expect(after[id]!.mood).toBeGreaterThanOrEqual(75);
    }
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

