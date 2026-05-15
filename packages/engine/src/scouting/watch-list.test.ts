import { describe, expect, it } from 'vitest';
import { createLeague } from '../league/generate.js';

describe('generateInitialWatchLists', () => {
  it('produces deterministic per-team watch lists from the same seed', () => {
    const a = createLeague({ seed: 'wl-determinism' });
    const b = createLeague({ seed: 'wl-determinism' });
    expect(a.watchLists).toEqual(b.watchLists);
  });

  it('every team has a watch list, capped at 15 entries', () => {
    const league = createLeague({ seed: 'wl-shape' });
    const teams = Object.keys(league.teams);
    expect(teams.length).toBe(32);
    for (const teamId of teams) {
      const list = league.watchLists[teamId as keyof typeof league.watchLists];
      expect(list).toBeDefined();
      expect(list!.length).toBeLessThanOrEqual(15);
    }
  });

  it('watch list entries are sorted by priority descending', () => {
    const league = createLeague({ seed: 'wl-order' });
    for (const list of Object.values(league.watchLists)) {
      for (let i = 1; i < list.length; i++) {
        expect(list[i]!.priority).toBeLessThanOrEqual(list[i - 1]!.priority);
      }
    }
  });

  it('no watch list entry references a player on the same team', () => {
    const league = createLeague({ seed: 'wl-self-exclude' });
    for (const [teamId, list] of Object.entries(league.watchLists)) {
      for (const entry of list) {
        const player = league.players[entry.playerId];
        expect(player).toBeDefined();
        expect(player!.teamId).not.toBe(teamId);
      }
    }
  });

  it('every watch list entry has at least one underlying observation', () => {
    const league = createLeague({ seed: 'wl-obs-backing' });
    const obsByPlayerByScout = new Map<string, Set<string>>();
    for (const obs of league.observations) {
      let scouts = obsByPlayerByScout.get(obs.playerId);
      if (!scouts) {
        scouts = new Set();
        obsByPlayerByScout.set(obs.playerId, scouts);
      }
      scouts.add(obs.scoutId);
    }
    const scoutTeam = new Map<string, string>();
    for (const team of Object.values(league.teams)) {
      for (const sid of team.scoutIds) scoutTeam.set(sid, team.identity.id);
    }
    for (const [teamId, list] of Object.entries(league.watchLists)) {
      for (const entry of list) {
        const observingScouts = obsByPlayerByScout.get(entry.playerId) ?? new Set();
        let teamObserved = false;
        for (const sid of observingScouts) {
          if (scoutTeam.get(sid) === teamId) {
            teamObserved = true;
            break;
          }
        }
        expect(teamObserved).toBe(true);
        expect(entry.observationCount).toBeGreaterThan(0);
      }
    }
  });

  it('reasons are populated from the allowed set', () => {
    const league = createLeague({ seed: 'wl-reasons' });
    const allowed = new Set(['SCHEME_FIT', 'POSITIONAL_NEED', 'MISCAST_ELEVATION', 'ROLE_PLAYER']);
    for (const list of Object.values(league.watchLists)) {
      for (const entry of list) {
        expect(allowed.has(entry.reason)).toBe(true);
      }
    }
  });

  it('cross-team competition: at least one player appears on multiple watch lists', () => {
    // With 32 teams scoring across overlapping observation pools, at
    // least one star-tier player should land on multiple lists. If
    // this ever fails, the scoring has collapsed into team-specific
    // local maxima (a regression worth catching).
    const league = createLeague({ seed: 'wl-competition' });
    const playerListCount = new Map<string, number>();
    for (const list of Object.values(league.watchLists)) {
      for (const entry of list) {
        playerListCount.set(entry.playerId, (playerListCount.get(entry.playerId) ?? 0) + 1);
      }
    }
    const maxAppearances = Math.max(...playerListCount.values());
    expect(maxAppearances).toBeGreaterThan(1);
  });

  it('schemeFit field on entries falls in the catalog range', () => {
    const league = createLeague({ seed: 'wl-fit-range' });
    for (const list of Object.values(league.watchLists)) {
      for (const entry of list) {
        expect(entry.schemeFit).toBeGreaterThanOrEqual(0.5);
        expect(entry.schemeFit).toBeLessThanOrEqual(1.7);
      }
    }
  });
});
