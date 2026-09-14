import { describe, expect, it } from 'vitest';
import { Prng } from '../prng/index.js';
import {
  runDraft,
  beginDraft,
  stepDraft,
  submitPick,
  autoPick,
  finishDraft,
  isDraftComplete,
  acceptTradeOffer,
  declineTradeOffer,
  pendingTradeOffer,
  type DraftStep,
} from './event.js';
import { rollJuniorDeclarations } from './declaration.js';
import { createLeague } from '../league/generate.js';
import type { TeamId, PlayerId } from '../types/ids.js';
import { DraftPickId as DraftPickIdFactory } from '../types/ids.js';
import type { DraftPickAsset } from '../types/college.js';

/**
 * The pick-stepped draft driver (W4 keystone).
 *
 * The work order's hard requirement is that NPC behaviour in stepped mode is
 * byte-identical to batch mode for the same seed. That is achieved here by
 * CONSTRUCTION — `runDraft` is a thin loop over `stepDraft`, so there is only
 * one implementation of the pick logic and no second copy to drift. These
 * tests police it anyway: dual-gate discipline whenever draft code moves, and
 * the equivalence assertion is what caught a real defect during the refactor
 * (a yielded trade-up let `stepDraft` re-evaluate the same slot on re-entry,
 * firing a second deal where batch mode allowed one).
 */

function makeLeague(seed: string) {
  const baseLeague = createLeague({ seed });
  return {
    ...baseLeague,
    collegePool: rollJuniorDeclarations(new Prng('d'), baseLeague.collegePool),
  };
}

function pickAssetsFor(seed: string, draftOrder: readonly TeamId[]): DraftPickAsset[] {
  return draftOrder.map((teamId, i) => ({
    id: DraftPickIdFactory(`${seed}-r1-p${i + 1}`),
    seasonNumber: 2,
    round: 1,
    originalTeamId: teamId,
    currentTeamId: teamId,
  }));
}

/** Stable serialization for deep-equality across Maps and Sets. */
function normalize(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => {
    if (v instanceof Map) return { __map: [...v.entries()].map(([k, x]) => [String(k), x]) };
    if (v instanceof Set) return { __set: [...v].map(String) };
    return v;
  });
}

describe('stepped draft driver', () => {
  it('stepping a full draft equals the batch runDraft result, exactly', () => {
    for (const seed of ['step-equiv-1', 'step-equiv-2']) {
      const league = makeLeague(seed);
      const draftOrder = Object.keys(league.teams).slice(0, 32) as TeamId[];
      const options = { draftOrder, pickedOnTick: 100, seasonNumber: 2 };

      const batch = runDraft(new Prng('r'), league, options);

      const session = beginDraft(new Prng('r'), league, options);
      while (!isDraftComplete(session)) {
        const step = stepDraft(session);
        if (step.kind === 'complete') break;
      }
      const stepped = finishDraft(session);

      expect(normalize(stepped)).toBe(normalize(batch));
    }
  });

  it('stays identical with pick assets, where trade-ups fire', () => {
    const seed = 'step-equiv-assets';
    const league = makeLeague(seed);
    const draftOrder = Object.keys(league.teams).slice(0, 32) as TeamId[];
    const options = {
      draftOrder,
      pickedOnTick: 100,
      seasonNumber: 2,
      pickAssets: pickAssetsFor(seed, draftOrder),
    };

    const batch = runDraft(new Prng('r2'), league, {
      ...options,
      pickAssets: pickAssetsFor(seed, draftOrder),
    });

    const session = beginDraft(new Prng('r2'), league, {
      ...options,
      pickAssets: pickAssetsFor(seed, draftOrder),
    });
    const steps: DraftStep[] = [];
    while (!isDraftComplete(session)) {
      const step = stepDraft(session);
      steps.push(step);
      if (step.kind === 'complete') break;
    }
    const stepped = finishDraft(session);

    expect(normalize(stepped)).toBe(normalize(batch));
    // The stepped path surfaced the trade-ups as their own events.
    expect(steps.filter((s) => s.kind === 'trade-up')).toHaveLength(batch.tradeUps.length);
  });

  /**
   * Regression for the defect the equivalence hash caught during the refactor.
   * A yielded trade-up must not let the next `stepDraft` re-evaluate the same
   * slot — the batch loop checked each slot exactly once.
   */
  it('evaluates each slot’s trade-up exactly once despite yielding', () => {
    const seed = 'step-tradeup-once';
    const league = makeLeague(seed);
    const draftOrder = Object.keys(league.teams).slice(0, 32) as TeamId[];
    const session = beginDraft(new Prng('r3'), league, {
      draftOrder,
      pickedOnTick: 100,
      seasonNumber: 2,
      pickAssets: pickAssetsFor(seed, draftOrder),
    });

    const tradeUpSlots: number[] = [];
    while (!isDraftComplete(session)) {
      const step = stepDraft(session);
      if (step.kind === 'complete') break;
      if (step.kind === 'trade-up') tradeUpSlots.push(step.tradeUp.overallPick);
    }

    expect(new Set(tradeUpSlots).size).toBe(tradeUpSlots.length);
  });

  it('yields at an externally-controlled team’s slot instead of picking', () => {
    const league = makeLeague('step-external');
    const draftOrder = Object.keys(league.teams).slice(0, 32) as TeamId[];
    const playerTeam = draftOrder[3]!;

    const session = beginDraft(new Prng('r'), league, {
      draftOrder,
      pickedOnTick: 100,
      seasonNumber: 2,
      externallyControlledTeamIds: [playerTeam],
    });

    let step = stepDraft(session);
    let guard = 0;
    while (step.kind !== 'on-the-clock' && guard++ < 50) {
      step = stepDraft(session);
    }

    expect(step.kind).toBe('on-the-clock');
    if (step.kind !== 'on-the-clock') return;
    expect(step.teamId).toBe(playerTeam);
    expect(step.overallPick).toBe(4);
    expect(step.availableProspectIds.length).toBeGreaterThan(0);

    // The session refuses to advance past an unresolved slot.
    expect(() => stepDraft(session)).toThrow(/waiting on an externally/);

    // Supplying a pick resolves it and the draft continues.
    const chosenId = step.availableProspectIds[0]!;
    const { pick } = submitPick(session, chosenId);
    expect(pick.teamId).toBe(playerTeam);
    expect(pick.overallPick).toBe(4);
    expect(pick.collegePlayerId).toBe(chosenId);
    expect(stepDraft(session).kind).toBe('pick');
  });

  it('auto-picking every externally-controlled slot reproduces batch exactly', () => {
    // The seam must be behaviour-neutral: a team that hands its pick back to
    // the NPC logic is indistinguishable from one the AI ran all along.
    const league = makeLeague('step-autopick');
    const draftOrder = Object.keys(league.teams).slice(0, 32) as TeamId[];
    const options = { draftOrder, pickedOnTick: 100, seasonNumber: 2 };

    const batch = runDraft(new Prng('r'), league, options);

    const session = beginDraft(new Prng('r'), league, {
      ...options,
      externallyControlledTeamIds: [draftOrder[0]!, draftOrder[7]!, draftOrder[31]!],
    });
    while (!isDraftComplete(session)) {
      const step = stepDraft(session);
      if (step.kind === 'complete') break;
      if (step.kind === 'on-the-clock') autoPick(session);
    }

    expect(normalize(finishDraft(session))).toBe(normalize(batch));
  });

  /**
   * Regression: the trade-up evaluator swept every later slot as a trading-up
   * candidate without consulting `externallyControlled`, so a supplied-decision
   * team could have its current slot, sweeteners and future picks spent on a
   * deal the NPC AI computed and auto-accepted on its behalf — flatly against
   * `DraftSessionOptions`' own contract.
   *
   * The reverse (an NPC trading INTO the controlled team's slot) stays allowed:
   * that is ordinary draft-day misfortune, and realistic.
   */
  it('never computes a trade-up FOR an externally-controlled team', () => {
    const seed = 'step-external-noautotrade';
    const league = makeLeague(seed);
    const draftOrder = Object.keys(league.teams).slice(0, 32) as TeamId[];
    // Control a broad slice so the evaluator has ample chance to pick one.
    const controlled = draftOrder.slice(4, 20);

    const session = beginDraft(new Prng('r4'), league, {
      draftOrder,
      pickedOnTick: 100,
      seasonNumber: 2,
      pickAssets: pickAssetsFor(seed, draftOrder),
      externallyControlledTeamIds: controlled,
    });

    const controlledSet = new Set(controlled.map(String));
    while (!isDraftComplete(session)) {
      const step = stepDraft(session);
      if (step.kind === 'complete') break;
      if (step.kind === 'on-the-clock') autoPick(session);
      // Offers now surface for controlled clubs; decline them so this test
      // keeps measuring what it is about (nobody trades up ON THEIR BEHALF).
      if (step.kind === 'trade-offer') declineTradeOffer(session);
    }

    const offenders = finishDraft(session)
      .tradeUps.filter((t) => controlledSet.has(String(t.tradingUpTeamId)))
      .map((t) => `${String(t.tradingUpTeamId)} @ pick ${t.overallPick}`);
    expect(offenders).toEqual([]);
  });

  /**
   * Regression: `finishDraft` handed back the session's live collections, so a
   * stepped UI calling it mid-draft got arrays that grew underneath it with
   * unchanged identity — invisible to React, and not the snapshot the name
   * promises.
   */
  it('returns a snapshot, not the session’s live collections', () => {
    const league = makeLeague('step-snapshot');
    const draftOrder = Object.keys(league.teams).slice(0, 32) as TeamId[];
    const session = beginDraft(new Prng('r'), league, {
      draftOrder,
      pickedOnTick: 100,
      seasonNumber: 2,
    });

    stepDraft(session);
    stepDraft(session);
    const midDraft = finishDraft(session);
    const countAtSnapshot = midDraft.picks.length;
    expect(countAtSnapshot).toBeGreaterThan(0);

    stepDraft(session);
    stepDraft(session);

    expect(midDraft.picks.length, 'snapshot grew after more picks fired').toBe(countAtSnapshot);
    expect(finishDraft(session).picks.length).toBeGreaterThan(countAtSnapshot);
  });

  it('records an off-board supplied pick with a null board rank', () => {
    const league = makeLeague('step-offboard');
    const draftOrder = Object.keys(league.teams).slice(0, 32) as TeamId[];
    const playerTeam = draftOrder[0]!;
    const session = beginDraft(new Prng('r'), league, {
      draftOrder,
      pickedOnTick: 100,
      seasonNumber: 2,
      externallyControlledTeamIds: [playerTeam],
    });

    const step = stepDraft(session);
    expect(step.kind).toBe('on-the-clock');
    if (step.kind !== 'on-the-clock') return;

    const boardIds = new Set(
      (league.draftBoards[playerTeam] ?? []).map((e) => String(e.collegePlayerId)),
    );
    const offBoard = step.availableProspectIds.find((id) => !boardIds.has(String(id)));
    expect(offBoard).toBeDefined();

    const { pick } = submitPick(session, offBoard!);
    expect(pick.boardRankAtPick).toBeNull();
    expect(pick.boardPriorityAtPick).toBeNull();
  });

  it('refuses a prospect that is not available', () => {
    const league = makeLeague('step-unavailable');
    const draftOrder = Object.keys(league.teams).slice(0, 32) as TeamId[];
    const session = beginDraft(new Prng('r'), league, {
      draftOrder,
      pickedOnTick: 100,
      seasonNumber: 2,
      externallyControlledTeamIds: [draftOrder[0]!],
    });

    stepDraft(session);
    expect(() => submitPick(session, 'not-a-prospect' as PlayerId)).toThrow(/not available/);
  });

  it('refuses submitPick when no slot is on the clock', () => {
    const league = makeLeague('step-nopending');
    const draftOrder = Object.keys(league.teams).slice(0, 32) as TeamId[];
    const session = beginDraft(new Prng('r'), league, {
      draftOrder,
      pickedOnTick: 100,
      seasonNumber: 2,
    });
    expect(() => submitPick(session, 'anything' as PlayerId)).toThrow(/no slot is on the clock/);
  });
});

/**
 * Trade offers to a supplied-decision team (M2's "offers to you").
 *
 * This closes a real gap rather than adding a feature. The D7 seam excluded
 * controlled teams as trading-UP candidates, but left them exposed as on-clock
 * TARGETS — and the deal auto-applied. An NPC could therefore take a human GM's
 * pick without asking, which is not how a trade-up works: the on-clock team has
 * to agree.
 */
describe('trade offers to a controlled team', () => {
  const seed = 'step-trade-offer';

  function sessionControllingEverything() {
    const league = makeLeague(seed);
    const draftOrder = Object.keys(league.teams).slice(0, 32) as TeamId[];
    // Control every OTHER club. Controlling all 32 would leave no eligible
    // buyer — the D7 seam excludes controlled teams as trading-UP candidates,
    // so a fully-controlled draft can never produce an offer at all. Half
    // controlled gives buyers on one side and targets on the other.
    const controlled = draftOrder.filter((_, i) => i % 2 === 0);
    return beginDraft(new Prng('r5'), league, {
      draftOrder,
      pickedOnTick: 100,
      seasonNumber: 2,
      pickAssets: pickAssetsFor(seed, draftOrder),
      externallyControlledTeamIds: controlled,
    });
  }

  it('yields an offer instead of executing it', () => {
    const session = sessionControllingEverything();
    let step = stepDraft(session);
    let guard = 0;
    while (step.kind !== 'trade-offer' && guard++ < 200) {
      if (step.kind === 'on-the-clock') {
        autoPick(session);
        step = stepDraft(session);
        continue;
      }
      if (step.kind === 'complete') break;
      step = stepDraft(session);
    }

    expect(step.kind, 'no trade offer surfaced; this test would be vacuous').toBe('trade-offer');
    if (step.kind !== 'trade-offer') return;
    expect(pendingTradeOffer(session)).not.toBeNull();
    expect(step.offer.tradingUpTeamId).not.toBe(step.offer.onClockTeamId);

    // The session refuses to advance past an unanswered offer — the slot is
    // not resolved until the on-clock team answers.
    expect(() => stepDraft(session)).toThrow(/awaiting an answer/);
  });

  it('declining keeps the slot', () => {
    const session = sessionControllingEverything();
    let step = stepDraft(session);
    let guard = 0;
    while (step.kind !== 'trade-offer' && guard++ < 200) {
      if (step.kind === 'on-the-clock') { autoPick(session); }
      if (step.kind === 'complete') break;
      step = stepDraft(session);
    }
    if (step.kind !== 'trade-offer') return;

    const slotOwner = step.offer.onClockTeamId;
    declineTradeOffer(session);
    expect(pendingTradeOffer(session)).toBeNull();

    // Next event is that same club on the clock — they kept the pick.
    const next = stepDraft(session);
    expect(next.kind).toBe('on-the-clock');
    if (next.kind === 'on-the-clock') expect(next.teamId).toBe(slotOwner);
  });

  it('accepting hands the slot to the trading-up club', () => {
    const session = sessionControllingEverything();
    let step = stepDraft(session);
    let guard = 0;
    while (step.kind !== 'trade-offer' && guard++ < 200) {
      if (step.kind === 'on-the-clock') { autoPick(session); }
      if (step.kind === 'complete') break;
      step = stepDraft(session);
    }
    if (step.kind !== 'trade-offer') return;

    const buyer = step.offer.tradingUpTeamId;
    const record = acceptTradeOffer(session);
    expect(record).not.toBeNull();
    expect(record!.tradingUpTeamId).toBe(buyer);
    expect(pendingTradeOffer(session)).toBeNull();

    // The buyer is always an NPC — the seam excludes controlled clubs as
    // trading-UP candidates — so the slot resolves as a PICK, not another
    // on-the-clock yield. (A first version asserted 'on-the-clock' here and
    // failed; that was my assumption, not the engine's behaviour.)
    const next = stepDraft(session);
    expect(next.kind).toBe('pick');
    if (next.kind === 'pick') expect(next.pick.teamId).toBe(buyer);
  });

  it('refuses accept/decline when nothing is pending', () => {
    const league = makeLeague('step-no-offer');
    const draftOrder = Object.keys(league.teams).slice(0, 32) as TeamId[];
    const session = beginDraft(new Prng('r'), league, {
      draftOrder,
      pickedOnTick: 100,
      seasonNumber: 2,
    });
    expect(() => acceptTradeOffer(session)).toThrow(/no offer is pending/);
    expect(() => declineTradeOffer(session)).toThrow(/no offer is pending/);
  });

  it('never surfaces an offer in an NPC-only draft', () => {
    // The batch path must be untouched: with no controlled clubs, every
    // proposal executes as before and no offer is ever raised.
    const league = makeLeague('step-npc-only');
    const draftOrder = Object.keys(league.teams).slice(0, 32) as TeamId[];
    const session = beginDraft(new Prng('r6'), league, {
      draftOrder,
      pickedOnTick: 100,
      seasonNumber: 2,
      pickAssets: pickAssetsFor('step-npc-only', draftOrder),
    });
    let guard = 0;
    for (;;) {
      const step = stepDraft(session);
      if (step.kind === 'complete') break;
      expect(step.kind).not.toBe('trade-offer');
      if (guard++ > 400) break;
    }
  });
});
