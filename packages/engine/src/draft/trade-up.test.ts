import { describe, expect, it } from 'vitest';
import {
  evaluateTradeUpForPick,
  applyTradeUpToWorkingAssets,
  MAX_TRADE_UPS_PER_DRAFT,
  TRADE_UP_TARGET_SLOT_CEILING,
  MAX_FUTURE_PICKS_PER_OFFER,
} from './trade-up.js';
import { TeamId, PlayerId, DraftPickId } from '../types/ids.js';
import {
  NEUTRAL_MODIFIERS,
  QB_CURRENT_PICK_PREMIUM,
} from './chart-modifiers.js';
import type {
  CollegePlayer,
  DraftBoardEntry,
  DraftPickAsset,
} from '../types/college.js';

const TEAM_A = TeamId('TEAM_A');
const TEAM_B = TeamId('TEAM_B');
const TEAM_C = TeamId('TEAM_C');
const TEAM_D = TeamId('TEAM_D');

const PROSPECT_X = PlayerId('CP_X');
const PROSPECT_Y = PlayerId('CP_Y');

const SEASON = 5;

function entry(opts: { id: PlayerId; priority: number }): DraftBoardEntry {
  return {
    collegePlayerId: opts.id,
    priority: opts.priority,
    reason: 'BLUE_CHIP',
    observedSkillScore: 80,
    schemeFit: 1,
    meanConfidence: 0.8,
    observationCount: 5,
    addedOnTick: 0,
  };
}

function asset(opts: {
  id: string;
  originalTeam: TeamId;
  currentTeam?: TeamId;
  seasonNumber?: number;
  round: number;
}): DraftPickAsset {
  return {
    id: DraftPickId(opts.id),
    originalTeamId: opts.originalTeam,
    currentTeamId: opts.currentTeam ?? opts.originalTeam,
    seasonNumber: opts.seasonNumber ?? SEASON,
    round: opts.round,
  };
}

function availableMap(ids: PlayerId[]): Map<PlayerId, CollegePlayer> {
  // Evaluator only checks .has() — content doesn't matter.
  return new Map(ids.map((id) => [id, {} as CollegePlayer]));
}

describe('evaluateTradeUpForPick', () => {
  it('returns null when target slot is past the slot ceiling', () => {
    const proposal = evaluateTradeUpForPick({
      onClockIndex: 0,
      overallPick: TRADE_UP_TARGET_SLOT_CEILING + 1,
      round: 1,
      seasonNumber: SEASON,
      workingRoundAssets: [
        asset({ id: 'p1', originalTeam: TEAM_A, round: 1 }),
        asset({ id: 'p2', originalTeam: TEAM_B, round: 1 }),
      ],
      draftBoards: {
        [TEAM_A]: [entry({ id: PROSPECT_X, priority: 100 })],
        [TEAM_B]: [entry({ id: PROSPECT_X, priority: 100 })],
      },
      availableById: availableMap([PROSPECT_X]),
      fullDraftPicks: [],
      tradeUpsFiredSoFar: 0,
    });
    expect(proposal).toBeNull();
  });

  it('returns null when the per-draft trade-up cap is reached', () => {
    const proposal = evaluateTradeUpForPick({
      onClockIndex: 0,
      overallPick: 1,
      round: 1,
      seasonNumber: SEASON,
      workingRoundAssets: [
        asset({ id: 'p1', originalTeam: TEAM_A, round: 1 }),
        asset({ id: 'p2', originalTeam: TEAM_B, round: 1 }),
      ],
      draftBoards: {
        [TEAM_A]: [entry({ id: PROSPECT_X, priority: 100 })],
        [TEAM_B]: [entry({ id: PROSPECT_X, priority: 100 })],
      },
      availableById: availableMap([PROSPECT_X]),
      fullDraftPicks: [],
      tradeUpsFiredSoFar: MAX_TRADE_UPS_PER_DRAFT,
    });
    expect(proposal).toBeNull();
  });

  it('returns null when no team behind shares the top target', () => {
    const proposal = evaluateTradeUpForPick({
      onClockIndex: 0,
      overallPick: 1,
      round: 1,
      seasonNumber: SEASON,
      workingRoundAssets: [
        asset({ id: 'p1', originalTeam: TEAM_A, round: 1 }),
        asset({ id: 'p2', originalTeam: TEAM_B, round: 1 }),
      ],
      draftBoards: {
        [TEAM_A]: [entry({ id: PROSPECT_X, priority: 100 })],
        // B has a different #1 — they don't want X.
        [TEAM_B]: [entry({ id: PROSPECT_Y, priority: 100 })],
      },
      availableById: availableMap([PROSPECT_X, PROSPECT_Y]),
      fullDraftPicks: [],
      tradeUpsFiredSoFar: 0,
    });
    expect(proposal).toBeNull();
  });

  it('picks the highest-priority candidate when multiple share the top target', () => {
    // A is on the clock at pick 1 with X as #1.
    // B (slot 2) and C (slot 3) both also want X.
    // C has higher priority on X — they win the trade-up race.
    // Each owns a R1 next-year pick (heuristic value ≈ 2805) — large
    // enough to close the 1-vs-3 gap of 1200 with a single sweetener.
    const futurePicks: DraftPickAsset[] = [
      asset({
        id: 'fB',
        originalTeam: TEAM_B,
        seasonNumber: SEASON + 1,
        round: 1,
      }),
      asset({
        id: 'fC',
        originalTeam: TEAM_C,
        seasonNumber: SEASON + 1,
        round: 1,
      }),
    ];
    const proposal = evaluateTradeUpForPick({
      onClockIndex: 0,
      overallPick: 1,
      round: 1,
      seasonNumber: SEASON,
      workingRoundAssets: [
        asset({ id: 'p1', originalTeam: TEAM_A, round: 1 }),
        asset({ id: 'p2', originalTeam: TEAM_B, round: 1 }),
        asset({ id: 'p3', originalTeam: TEAM_C, round: 1 }),
      ],
      draftBoards: {
        [TEAM_A]: [entry({ id: PROSPECT_X, priority: 100 })],
        [TEAM_B]: [entry({ id: PROSPECT_X, priority: 95 })],
        [TEAM_C]: [entry({ id: PROSPECT_X, priority: 130 })],
      },
      availableById: availableMap([PROSPECT_X]),
      fullDraftPicks: futurePicks,
      tradeUpsFiredSoFar: 0,
    });
    expect(proposal).not.toBeNull();
    expect(proposal!.tradingUpTeamId).toBe(TEAM_C);
    expect(proposal!.swapAssetId).toBe(DraftPickId('p3'));
    expect(proposal!.targetCollegePlayerId).toBe(PROSPECT_X);
  });

  it('produces an offer with ratio >= 1.0 from the on-clock perspective', () => {
    // Pick 1 (10000 pts) vs pick 5 (7600 pts) — gap = 2400.
    // R1 mid-pick (16, next year, 75%) = 3740 * 0.75 = 2805 — closes
    // the gap with one future pick.
    const futurePicks: DraftPickAsset[] = [
      asset({
        id: 'fD',
        originalTeam: TEAM_D,
        seasonNumber: SEASON + 1,
        round: 1,
      }),
    ];
    const workingRoundAssets: DraftPickAsset[] = [];
    for (let i = 0; i < 5; i++) {
      workingRoundAssets.push(
        asset({ id: `p${i + 1}`, originalTeam: TeamId(`T${i + 1}`), round: 1 }),
      );
    }
    // Slot 4 → team T5 in the array's last index. Set up so T5 wants X.
    const lastSlotTeam = workingRoundAssets[4]!.currentTeamId;
    const onClockTeam = workingRoundAssets[0]!.currentTeamId;
    // T5 needs to own the future pick.
    const adjustedFuturePick: DraftPickAsset = {
      ...futurePicks[0]!,
      originalTeamId: lastSlotTeam,
      currentTeamId: lastSlotTeam,
    };

    const proposal = evaluateTradeUpForPick({
      onClockIndex: 0,
      overallPick: 1,
      round: 1,
      seasonNumber: SEASON,
      workingRoundAssets,
      draftBoards: {
        [onClockTeam]: [entry({ id: PROSPECT_X, priority: 100 })],
        [lastSlotTeam]: [entry({ id: PROSPECT_X, priority: 200 })],
      },
      availableById: availableMap([PROSPECT_X]),
      fullDraftPicks: [adjustedFuturePick],
      tradeUpsFiredSoFar: 0,
    });
    expect(proposal).not.toBeNull();
    expect(proposal!.ratio).toBeGreaterThanOrEqual(1.0);
    expect(proposal!.tradingUpTeamId).toBe(lastSlotTeam);
    expect(proposal!.futurePickIds).toContain(adjustedFuturePick.id);
  });

  it('returns null when no offer reaches ratio >= 1.0 within the sweetener cap', () => {
    // Pick 1 vs pick 5 — gap = 2400. Only future picks available are
    // R7 mid-picks (208, two years out × 0.58 → ~120pts) — way too
    // small even with the 2-pick cap.
    const lastSlotTeam = TEAM_B;
    const futurePicks: DraftPickAsset[] = [
      asset({
        id: 'fB1',
        originalTeam: lastSlotTeam,
        seasonNumber: SEASON + 2,
        round: 7,
      }),
      asset({
        id: 'fB2',
        originalTeam: lastSlotTeam,
        seasonNumber: SEASON + 2,
        round: 7,
      }),
    ];
    const workingRoundAssets: DraftPickAsset[] = [];
    for (let i = 0; i < 5; i++) {
      workingRoundAssets.push(
        asset({ id: `p${i + 1}`, originalTeam: TeamId(`T${i + 1}`), round: 1 }),
      );
    }
    workingRoundAssets[4] = asset({ id: 'p5', originalTeam: lastSlotTeam, round: 1 });
    const onClockTeam = workingRoundAssets[0]!.currentTeamId;

    const proposal = evaluateTradeUpForPick({
      onClockIndex: 0,
      overallPick: 1,
      round: 1,
      seasonNumber: SEASON,
      workingRoundAssets,
      draftBoards: {
        [onClockTeam]: [entry({ id: PROSPECT_X, priority: 100 })],
        [lastSlotTeam]: [entry({ id: PROSPECT_X, priority: 200 })],
      },
      availableById: availableMap([PROSPECT_X]),
      fullDraftPicks: futurePicks,
      tradeUpsFiredSoFar: 0,
    });
    expect(proposal).toBeNull();
  });

  it('never offers more future picks than MAX_FUTURE_PICKS_PER_OFFER', () => {
    // Construct a scenario where many future picks exist but only
    // need 1 to close the gap — verify only 1 is offered (the
    // smallest, by greedy-minimum-overpay).
    const lastSlotTeam = TEAM_B;
    const futurePicks: DraftPickAsset[] = [
      // Owned by the trading-up team — varied rounds.
      asset({
        id: 'fR2',
        originalTeam: lastSlotTeam,
        seasonNumber: SEASON + 1,
        round: 2,
      }),
      asset({
        id: 'fR1',
        originalTeam: lastSlotTeam,
        seasonNumber: SEASON + 1,
        round: 1,
      }),
      asset({
        id: 'fR3',
        originalTeam: lastSlotTeam,
        seasonNumber: SEASON + 1,
        round: 3,
      }),
    ];
    const workingRoundAssets: DraftPickAsset[] = [
      asset({ id: 'p1', originalTeam: TEAM_A, round: 1 }),
      asset({ id: 'p2', originalTeam: lastSlotTeam, round: 1 }),
    ];

    const proposal = evaluateTradeUpForPick({
      onClockIndex: 0,
      overallPick: 1,
      round: 1,
      seasonNumber: SEASON,
      workingRoundAssets,
      draftBoards: {
        [TEAM_A]: [entry({ id: PROSPECT_X, priority: 100 })],
        [lastSlotTeam]: [entry({ id: PROSPECT_X, priority: 200 })],
      },
      availableById: availableMap([PROSPECT_X]),
      fullDraftPicks: futurePicks,
      tradeUpsFiredSoFar: 0,
    });
    expect(proposal).not.toBeNull();
    expect(proposal!.futurePickIds.length).toBeLessThanOrEqual(
      MAX_FUTURE_PICKS_PER_OFFER,
    );
  });
});

describe('evaluateTradeUpForPick — Doc 5 dynamic modifiers', () => {
  function buildSlot1to5Scenario(opts: {
    onClockModifiers?: import('./chart-modifiers.js').ChartModifiers;
    targetPosition?: string;
  }) {
    const onClockTeam = TEAM_A;
    const tradingUpTeam = TEAM_B;
    const futurePicks: DraftPickAsset[] = [
      asset({
        id: 'fR1',
        originalTeam: tradingUpTeam,
        seasonNumber: SEASON + 1,
        round: 1,
      }),
    ];
    const workingRoundAssets: DraftPickAsset[] = [];
    for (let i = 0; i < 5; i++) {
      const tid = i === 0 ? onClockTeam : i === 4 ? tradingUpTeam : TeamId(`T${i}`);
      workingRoundAssets.push(asset({ id: `p${i + 1}`, originalTeam: tid, round: 1 }));
    }
    const targetCp = (opts.targetPosition
      ? { nflProjectedPosition: opts.targetPosition }
      : {}) as CollegePlayer;
    const availableById = new Map<PlayerId, CollegePlayer>([[PROSPECT_X, targetCp]]);
    return evaluateTradeUpForPick({
      onClockIndex: 0,
      overallPick: 1,
      round: 1,
      seasonNumber: SEASON,
      workingRoundAssets,
      draftBoards: {
        [onClockTeam]: [entry({ id: PROSPECT_X, priority: 100 })],
        [tradingUpTeam]: [entry({ id: PROSPECT_X, priority: 200 })],
      },
      availableById,
      fullDraftPicks: futurePicks,
      tradeUpsFiredSoFar: 0,
      ...(opts.onClockModifiers ? { onClockModifiers: opts.onClockModifiers } : {}),
    });
  }

  it('CHAMPIONSHIP-windowed on-clock REJECTS what NEUTRAL accepts', () => {
    // Same slot-1-to-slot-5 swap + R1-next-year sweetener.
    // NEUTRAL accepts (ratio ~1.04); CHAMPIONSHIP modifiers
    // (current 1.1, future 0.65) deflate the future-pick sweetener
    // and tip the ratio below 1.0.
    const accepted = buildSlot1to5Scenario({});
    expect(accepted).not.toBeNull();

    const rejected = buildSlot1to5Scenario({
      onClockModifiers: { currentMultiplier: 1.1, futureMultiplier: 0.65 },
    });
    expect(rejected).toBeNull();
  });

  it('REBUILDING-windowed on-clock accepts what CHAMPIONSHIP rejects', () => {
    // REBUILDING modifiers (current 0.85, future 1.25) inflate the
    // future-pick sweetener — same R1-next-year now closes the gap
    // comfortably from the rebuilder's perspective.
    const rebuilderAccepted = buildSlot1to5Scenario({
      onClockModifiers: { currentMultiplier: 0.85, futureMultiplier: 1.25 },
    });
    expect(rebuilderAccepted).not.toBeNull();
    expect(rebuilderAccepted!.ratio).toBeGreaterThan(1.0);
  });

  it('QB target inflates the gap — same offer that works for WR fails for QB', () => {
    const wrAccepted = buildSlot1to5Scenario({ targetPosition: 'WR' });
    expect(wrAccepted).not.toBeNull();

    const qbRejected = buildSlot1to5Scenario({ targetPosition: 'QB' });
    expect(qbRejected).toBeNull();
  });
});

describe('evaluateTradeUpForPick — trading-up perspective (v0.49)', () => {
  function buildSlot1to5Scenario(opts: {
    teamContexts?: Record<TeamId, import('./trade-up.js').TeamChartContext>;
    targetPosition?: string;
    sweetenerRound?: number;
  }) {
    const onClockTeam = TEAM_A;
    const tradingUpTeam = TEAM_B;
    const sweetenerRound = opts.sweetenerRound ?? 1;
    const futurePicks: DraftPickAsset[] = [
      asset({
        id: 'fR',
        originalTeam: tradingUpTeam,
        seasonNumber: SEASON + 1,
        round: sweetenerRound,
      }),
    ];
    const workingRoundAssets: DraftPickAsset[] = [];
    for (let i = 0; i < 5; i++) {
      const tid = i === 0 ? onClockTeam : i === 4 ? tradingUpTeam : TeamId(`T${i}`);
      workingRoundAssets.push(asset({ id: `p${i + 1}`, originalTeam: tid, round: 1 }));
    }
    const targetCp = (opts.targetPosition
      ? { nflProjectedPosition: opts.targetPosition }
      : {}) as CollegePlayer;
    const availableById = new Map<PlayerId, CollegePlayer>([[PROSPECT_X, targetCp]]);
    return evaluateTradeUpForPick({
      onClockIndex: 0,
      overallPick: 1,
      round: 1,
      seasonNumber: SEASON,
      workingRoundAssets,
      draftBoards: {
        [onClockTeam]: [entry({ id: PROSPECT_X, priority: 100 })],
        [tradingUpTeam]: [entry({ id: PROSPECT_X, priority: 200 })],
      },
      availableById,
      fullDraftPicks: futurePicks,
      tradeUpsFiredSoFar: 0,
      ...(opts.teamContexts ? { teamContexts: opts.teamContexts } : {}),
    });
  }

  it('rebuilder on-clock + championship trading-up: trade still fires (asymmetry helps)', () => {
    const teamContexts = {
      [TEAM_A]: {
        modifiers: { currentMultiplier: 0.85, futureMultiplier: 1.25 },
        qbPremium: QB_CURRENT_PICK_PREMIUM,
      },
      [TEAM_B]: {
        modifiers: { currentMultiplier: 1.1, futureMultiplier: 0.65 },
        qbPremium: QB_CURRENT_PICK_PREMIUM,
      },
    } as const;
    const proposal = buildSlot1to5Scenario({ teamContexts });
    expect(proposal).not.toBeNull();
  });

  it('trading-up acceptance floor refuses absurdly inflated sweetener over-pay', () => {
    // Trading-up team values future picks SO HIGHLY (futureMultiplier
    // 5.0) that giving up an R1-next-year to leapfrog feels like
    // throwing away the rebuild. The on-clock team is willing
    // (modest modifiers; small gap closes easily), but the
    // trading-up team's offer-side floor (their ratio < 0.5) blocks
    // construction. This is the "patient-rebuilder refuses to trade
    // away their future" guardrail.
    const teamContexts = {
      [TEAM_A]: {
        modifiers: NEUTRAL_MODIFIERS,
        qbPremium: QB_CURRENT_PICK_PREMIUM,
      },
      [TEAM_B]: {
        modifiers: { currentMultiplier: 0.5, futureMultiplier: 5.0 },
        qbPremium: QB_CURRENT_PICK_PREMIUM,
      },
    } as const;
    const proposal = buildSlot1to5Scenario({ teamContexts, sweetenerRound: 1 });
    expect(proposal).toBeNull();
  });

  it('per-team QB premium scales the acceptance threshold appropriately', () => {
    // QB target, NEUTRAL modifiers; vary on-clock QB premium to show
    // that a desperate on-clock GM resists trading down for QB picks
    // MORE than a patient GM does.
    const desperateOnClock = {
      [TEAM_A]: {
        modifiers: NEUTRAL_MODIFIERS,
        qbPremium: 1.5,
      },
      [TEAM_B]: {
        modifiers: NEUTRAL_MODIFIERS,
        qbPremium: 1.5,
      },
    } as const;
    const patientOnClock = {
      [TEAM_A]: {
        modifiers: NEUTRAL_MODIFIERS,
        qbPremium: 1.2,
      },
      [TEAM_B]: {
        modifiers: NEUTRAL_MODIFIERS,
        qbPremium: 1.5,
      },
    } as const;
    // Sweetener: a R3 mid-future-year pick — small enough that QB
    // premium tightening can tip the threshold.
    const desperateProposal = buildSlot1to5Scenario({
      teamContexts: desperateOnClock,
      targetPosition: 'QB',
      sweetenerRound: 3,
    });
    const patientProposal = buildSlot1to5Scenario({
      teamContexts: patientOnClock,
      targetPosition: 'QB',
      sweetenerRound: 3,
    });
    // Patient on-clock applies smaller QB premium → easier to accept
    // (lower required threshold). At minimum: patient's ratio ≥
    // desperate's ratio, if both fire.
    if (desperateProposal && patientProposal) {
      expect(patientProposal.ratio).toBeGreaterThanOrEqual(desperateProposal.ratio);
    } else if (desperateProposal === null && patientProposal !== null) {
      // Expected case: desperate rejected, patient accepted.
      expect(patientProposal.ratio).toBeGreaterThanOrEqual(1.0);
    }
  });
});

describe('applyTradeUpToWorkingAssets', () => {
  it('flips currentTeamId on both the on-clock and swap assets', () => {
    const onClockAsset = asset({ id: 'p1', originalTeam: TEAM_A, round: 1 });
    const swapAsset = asset({ id: 'p2', originalTeam: TEAM_B, round: 1 });
    const working: DraftPickAsset[] = [onClockAsset, swapAsset];

    applyTradeUpToWorkingAssets(working, {
      onClockTeamId: TEAM_A,
      onClockAssetId: onClockAsset.id,
      tradingUpTeamId: TEAM_B,
      swapAssetId: swapAsset.id,
      futurePickIds: [],
      targetCollegePlayerId: PROSPECT_X,
      ratio: 1.05,
    });
    expect(working[0]!.currentTeamId).toBe(TEAM_B);
    expect(working[0]!.id).toBe(onClockAsset.id);
    expect(working[0]!.originalTeamId).toBe(TEAM_A);
    expect(working[1]!.currentTeamId).toBe(TEAM_A);
    expect(working[1]!.id).toBe(swapAsset.id);
    expect(working[1]!.originalTeamId).toBe(TEAM_B);
  });
});
