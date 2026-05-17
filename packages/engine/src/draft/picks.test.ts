import { describe, expect, it } from 'vitest';
import {
  generateInitialDraftPicks,
  advancePickHorizon,
  picksForRoundInSlotOrder,
  consumePicks,
  buildSlotMap,
  pickOwnershipByTeam,
  DRAFT_PICK_HORIZON_YEARS,
  DRAFT_PICK_ROUNDS,
} from './picks.js';
import { createLeague } from '../league/generate.js';
import { simulateSeason } from '../season/runner.js';
import { advanceSeason } from '../season/advance.js';
import { TeamId, DraftPickId } from '../types/ids.js';

const TEAM_A = TeamId('TEAM_A');
const TEAM_B = TeamId('TEAM_B');

describe('generateInitialDraftPicks', () => {
  it('produces horizon × rounds picks per team', () => {
    const picks = generateInitialDraftPicks([TEAM_A, TEAM_B], 2);
    expect(picks.length).toBe(2 * DRAFT_PICK_HORIZON_YEARS * DRAFT_PICK_ROUNDS);
  });

  it('every pick starts with currentTeamId == originalTeamId', () => {
    const picks = generateInitialDraftPicks([TEAM_A, TEAM_B], 2);
    for (const p of picks) {
      expect(p.currentTeamId).toBe(p.originalTeamId);
    }
  });

  it('covers the expected season range', () => {
    const picks = generateInitialDraftPicks([TEAM_A], 5);
    const seasons = new Set(picks.map((p) => p.seasonNumber));
    expect([...seasons].sort((a, b) => a - b)).toEqual([5, 6, 7]);
  });

  it('produces unique IDs', () => {
    const picks = generateInitialDraftPicks([TEAM_A, TEAM_B], 2);
    const ids = new Set(picks.map((p) => p.id));
    expect(ids.size).toBe(picks.length);
  });
});

describe('advancePickHorizon', () => {
  it('drops the just-drafted season AND adds the new far-edge season', () => {
    let picks = generateInitialDraftPicks([TEAM_A, TEAM_B], 2);
    // Simulate the season-2 draft consuming all picks for season 2.
    picks = consumePicks(
      picks,
      new Set(picks.filter((p) => p.seasonNumber === 2).map((p) => p.id)),
    );
    const advanced = advancePickHorizon(picks, 2, [TEAM_A, TEAM_B]);
    const seasons = new Set(advanced.map((p) => p.seasonNumber));
    // Now should cover seasons 3, 4, 5 (season 2 done; horizon rolls to 5).
    expect([...seasons].sort((a, b) => a - b)).toEqual([3, 4, 5]);
    expect(advanced.length).toBe(2 * DRAFT_PICK_HORIZON_YEARS * DRAFT_PICK_ROUNDS);
  });

  it('idempotent — calling twice with the same currentDraftSeason is a no-op on far-year', () => {
    const picks = generateInitialDraftPicks([TEAM_A], 2);
    const consumed = consumePicks(
      picks,
      new Set(picks.filter((p) => p.seasonNumber === 2).map((p) => p.id)),
    );
    const a = advancePickHorizon(consumed, 2, [TEAM_A]);
    const b = advancePickHorizon(a, 2, [TEAM_A]); // double-advance defensive
    expect(b.length).toBe(a.length);
  });
});

describe('picksForRoundInSlotOrder', () => {
  it('orders picks by original-team standing slot', () => {
    const picks = generateInitialDraftPicks([TEAM_A, TEAM_B], 2);
    // TEAM_B picks first (slot 0) — say TEAM_B was worst last year
    const slotMap = buildSlotMap([TEAM_B, TEAM_A]);
    const r1 = picksForRoundInSlotOrder(picks, 2, 1, slotMap);
    expect(r1.length).toBe(2);
    expect(r1[0]!.originalTeamId).toBe(TEAM_B);
    expect(r1[1]!.originalTeamId).toBe(TEAM_A);
  });

  it('filters to the requested season + round', () => {
    const picks = generateInitialDraftPicks([TEAM_A, TEAM_B], 2);
    const slotMap = buildSlotMap([TEAM_A, TEAM_B]);
    const r3 = picksForRoundInSlotOrder(picks, 3, 4, slotMap);
    expect(r3.length).toBe(2);
    for (const p of r3) {
      expect(p.seasonNumber).toBe(3);
      expect(p.round).toBe(4);
    }
  });
});

describe('consumePicks', () => {
  it('removes consumed assets, keeps the rest', () => {
    const picks = generateInitialDraftPicks([TEAM_A], 2);
    const toConsume = new Set<DraftPickId>([picks[0]!.id]);
    const after = consumePicks(picks, toConsume);
    expect(after.length).toBe(picks.length - 1);
    expect(after.find((p) => p.id === picks[0]!.id)).toBeUndefined();
  });

  it('no-op for empty consumed set', () => {
    const picks = generateInitialDraftPicks([TEAM_A], 2);
    const after = consumePicks(picks, new Set());
    expect(after).toEqual(picks);
  });
});

describe('pickOwnershipByTeam', () => {
  it('groups by currentTeamId', () => {
    const picks = generateInitialDraftPicks([TEAM_A, TEAM_B], 2);
    const map = pickOwnershipByTeam(picks);
    expect(map.size).toBe(2);
    expect(map.get(TEAM_A)?.length).toBe(DRAFT_PICK_HORIZON_YEARS * DRAFT_PICK_ROUNDS);
    expect(map.get(TEAM_B)?.length).toBe(DRAFT_PICK_HORIZON_YEARS * DRAFT_PICK_ROUNDS);
  });

  it('reflects trade-style ownership transfers', () => {
    const picks = generateInitialDraftPicks([TEAM_A, TEAM_B], 2);
    // Simulate TEAM_A trading their season-2 R1 to TEAM_B.
    const tradedIdx = picks.findIndex(
      (p) => p.originalTeamId === TEAM_A && p.seasonNumber === 2 && p.round === 1,
    );
    expect(tradedIdx).toBeGreaterThanOrEqual(0);
    const tradedPick = { ...picks[tradedIdx]!, currentTeamId: TEAM_B };
    const after = picks.map((p, i) => (i === tradedIdx ? tradedPick : p));
    const map = pickOwnershipByTeam(after);
    expect(map.get(TEAM_A)?.length).toBe(DRAFT_PICK_HORIZON_YEARS * DRAFT_PICK_ROUNDS - 1);
    expect(map.get(TEAM_B)?.length).toBe(DRAFT_PICK_HORIZON_YEARS * DRAFT_PICK_ROUNDS + 1);
  });
});

describe('integration: assets consumed by draft + horizon rolls', () => {
  it('createLeague populates 32 teams × 3 years × 7 rounds of picks (672)', () => {
    const league = createLeague({ seed: 'picks-int' });
    expect(league.draftPicks.length).toBe(32 * 3 * 7);
    // Every pick should be currently owned by its original team.
    for (const p of league.draftPicks) {
      expect(p.currentTeamId).toBe(p.originalTeamId);
    }
  });

  it('advanceSeason consumes the about-to-fire-draft picks and rolls horizon forward', () => {
    const league = createLeague({ seed: 'picks-adv' });
    const seasonsBefore = new Set(league.draftPicks.map((p) => p.seasonNumber));
    expect([...seasonsBefore].sort((a, b) => a - b)).toEqual([2, 3, 4]);

    const played = simulateSeason(league);
    const after = advanceSeason(played);

    const seasonsAfter = new Set(after.draftPicks.map((p) => p.seasonNumber));
    // After advance (which fires the season-2 draft), horizon rolls
    // to seasons 3, 4, 5.
    expect([...seasonsAfter].sort((a, b) => a - b)).toEqual([3, 4, 5]);
    expect(after.draftPicks.length).toBe(32 * 3 * 7);
  });

  it('draft history records carry pickAssetId + originalTeamId for asset-fired picks', () => {
    const league = createLeague({ seed: 'picks-rec' });
    const played = simulateSeason(league);
    const after = advanceSeason(played);
    expect(after.draftHistory.length).toBeGreaterThan(0);
    for (const pick of after.draftHistory) {
      expect(pick.pickAssetId).toBeDefined();
      expect(pick.originalTeamId).toBeDefined();
      // Un-traded league: originalTeamId === teamId (picker).
      expect(pick.originalTeamId).toBe(pick.teamId);
    }
  });

  it('migration backfills draftPicks on pre-v0.44 save', () => {
    const league = createLeague({ seed: 'picks-mig' });
    const stripped = { ...league } as typeof league & {
      draftPicks?: typeof league.draftPicks;
    };
    delete stripped.draftPicks;
    const played = simulateSeason(stripped as typeof league);
    expect(played.draftPicks.length).toBeGreaterThan(0);
    expect(played.draftPicks.length).toBe(32 * 3 * 7);
  });
});
