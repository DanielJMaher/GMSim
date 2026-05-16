import { describe, expect, it } from 'vitest';
import { Prng } from '../prng/index.js';
import { runUdfaPromotion, applyUdfaResult } from './udfa.js';
import { rollJuniorDeclarations } from './declaration.js';
import { runDraft } from './event.js';
import { createLeague } from '../league/generate.js';
import { simulateSeason } from '../season/runner.js';
import { advanceSeason } from '../season/advance.js';
import type { TeamId, PlayerId } from '../types/ids.js';

describe('runUdfaPromotion (slice 5c)', () => {
  it('promotes only declared, draft-eligible, undrafted prospects', () => {
    const baseLeague = createLeague({ seed: 'udfa1' });
    const league = {
      ...baseLeague,
      collegePool: rollJuniorDeclarations(new Prng('d'), baseLeague.collegePool),
    };
    // No one drafted yet — every declared eligible prospect should UDFA.
    const result = runUdfaPromotion(new Prng('u'), league, {
      draftedIds: new Set<PlayerId>(),
    });
    const eligibleDeclared = league.collegePool.filter(
      (cp) => cp.isDraftEligible && cp.hasDeclared,
    );
    expect(result.newPlayers.length).toBe(eligibleDeclared.length);
    expect(result.removedFromCollegePool.size).toBe(eligibleDeclared.length);
  });

  it('skips drafted prospects', () => {
    const baseLeague = createLeague({ seed: 'udfa-skip' });
    const league = {
      ...baseLeague,
      collegePool: rollJuniorDeclarations(new Prng('d'), baseLeague.collegePool),
    };
    const draftOrder = Object.keys(league.teams) as TeamId[];
    const draft = runDraft(new Prng('r'), league, {
      draftOrder,
      pickedOnTick: 0,
      seasonNumber: 2,
    });
    const draftedIds = new Set(draft.picks.map((p) => p.collegePlayerId));
    const result = runUdfaPromotion(new Prng('u'), league, { draftedIds });
    for (const player of result.newPlayers) {
      expect(draftedIds.has(player.id)).toBe(false);
    }
  });

  it('skips undeclared prospects (no path to NFL without declaring)', () => {
    const baseLeague = createLeague({ seed: 'udfa-undecl' });
    // Roll declarations — some JRs decline.
    const league = {
      ...baseLeague,
      collegePool: rollJuniorDeclarations(new Prng('d'), baseLeague.collegePool),
    };
    const result = runUdfaPromotion(new Prng('u'), league, {
      draftedIds: new Set<PlayerId>(),
    });
    const undeclaredEligible = league.collegePool.filter(
      (cp) => cp.isDraftEligible && !cp.hasDeclared,
    );
    for (const cp of undeclaredEligible) {
      expect(result.removedFromCollegePool.has(cp.id)).toBe(false);
    }
  });

  it('produces NFL Player records with teamId=null and contractId=null', () => {
    const baseLeague = createLeague({ seed: 'udfa-fa-shape' });
    const league = {
      ...baseLeague,
      collegePool: rollJuniorDeclarations(new Prng('d'), baseLeague.collegePool),
    };
    const result = runUdfaPromotion(new Prng('u'), league, {
      draftedIds: new Set<PlayerId>(),
    });
    expect(result.newPlayers.length).toBeGreaterThan(0);
    for (const p of result.newPlayers) {
      expect(p.teamId).toBeNull();
      expect(p.contractId).toBeNull();
      expect(p.experienceYears).toBe(0);
    }
  });

  it('is deterministic for the same seed', () => {
    const baseLeague = createLeague({ seed: 'udfa-det' });
    const league = {
      ...baseLeague,
      collegePool: rollJuniorDeclarations(new Prng('d'), baseLeague.collegePool),
    };
    const a = runUdfaPromotion(new Prng('u'), league, { draftedIds: new Set<PlayerId>() });
    const b = runUdfaPromotion(new Prng('u'), league, { draftedIds: new Set<PlayerId>() });
    expect(a.newPlayers.length).toBe(b.newPlayers.length);
    for (let i = 0; i < a.newPlayers.length; i++) {
      expect(a.newPlayers[i]!.id).toBe(b.newPlayers[i]!.id);
    }
  });
});

describe('applyUdfaResult', () => {
  it('adds new players to LeagueState.players and removes from collegePool', () => {
    const baseLeague = createLeague({ seed: 'udfa-apply' });
    const league = {
      ...baseLeague,
      collegePool: rollJuniorDeclarations(new Prng('d'), baseLeague.collegePool),
    };
    const result = runUdfaPromotion(new Prng('u'), league, {
      draftedIds: new Set<PlayerId>(),
    });
    const applied = applyUdfaResult(league, result);
    for (const p of result.newPlayers) {
      expect(applied.players[p.id]).toBeDefined();
    }
    expect(applied.collegePool.length).toBe(
      league.collegePool.length - result.removedFromCollegePool.size,
    );
    for (const removedId of result.removedFromCollegePool) {
      expect(applied.collegePool.some((cp) => cp.id === removedId)).toBe(false);
    }
  });

  it('is a no-op when no UDFAs were promoted', () => {
    const baseLeague = createLeague({ seed: 'udfa-noop' });
    const result = { newPlayers: [], removedFromCollegePool: new Set<PlayerId>() };
    const applied = applyUdfaResult(baseLeague, result);
    expect(applied).toBe(baseLeague); // same reference
  });
});

describe('UDFA integration in advanceSeason', () => {
  it('UDFAs land in the FA pool (teamId null, no contract)', () => {
    const league = createLeague({ seed: 'udfa-int' });
    const played = simulateSeason(league);
    const after = advanceSeason(played);
    // Identify UDFAs: players in after.players that came from
    // promotion (id starts with CP_) but were NOT drafted this year.
    const draftedThisYear = new Set(
      after.draftHistory
        .filter((p) => p.seasonNumber === after.seasonNumber)
        .map((p) => p.promotedPlayerId),
    );
    const udfas = Object.values(after.players).filter(
      (p) => p.id.startsWith('CP_') && !draftedThisYear.has(p.id),
    );
    expect(udfas.length).toBeGreaterThan(0);
    for (const u of udfas) {
      expect(u.teamId).toBeNull();
      expect(u.contractId).toBeNull();
    }
  });

  it('every declared draft-eligible prospect exits the pool (drafted OR UDFA)', () => {
    const league = createLeague({ seed: 'udfa-clean' });
    const declaredBefore = new Set(
      league.collegePool
        .filter((cp) => cp.isDraftEligible && (cp.classYear === 'SR' || cp.classYear === 'RS_SR'))
        .map((cp) => cp.id),
    );
    expect(declaredBefore.size).toBeGreaterThan(0);
    const played = simulateSeason(league);
    const after = advanceSeason(played);
    // No SR / RS_SR from the initial pool should still be in the
    // college pool — they either got drafted or UDFA'd, then the pool
    // advance cleared anything else.
    for (const cp of after.collegePool) {
      expect(declaredBefore.has(cp.id)).toBe(false);
    }
    // And they should all exist as NFL players now.
    for (const id of declaredBefore) {
      expect(after.players[id]).toBeDefined();
    }
  });

  it('UDFA-grade talent eventually surfaces in next-year FA refill', () => {
    // Smoke test — across 2 advances, the FA pool should grow with
    // UDFAs, and refillRosters in year 2 picks the best ones.
    let league = createLeague({ seed: 'udfa-flow' });
    league = simulateSeason(league);
    league = advanceSeason(league);
    const faAfterYear1 = Object.values(league.players).filter(
      (p) => p.teamId === null,
    ).length;
    expect(faAfterYear1).toBeGreaterThan(0);
    league = simulateSeason(league);
    league = advanceSeason(league);
    // Year 2 FA pool exists.
    const faAfterYear2 = Object.values(league.players).filter(
      (p) => p.teamId === null,
    ).length;
    expect(faAfterYear2).toBeGreaterThan(0);
  });
});
