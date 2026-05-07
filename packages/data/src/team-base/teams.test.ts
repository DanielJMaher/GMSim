import { describe, it, expect } from 'vitest';
import { Conference, Division, MarketSize } from '@gmsim/engine/types';
import { NFL_TEAMS } from './teams.js';

describe('NFL_TEAMS', () => {
  it('contains exactly 32 teams', () => {
    expect(NFL_TEAMS.length).toBe(32);
  });

  it('has 16 AFC and 16 NFC teams', () => {
    expect(NFL_TEAMS.filter((t) => t.conference === Conference.AFC).length).toBe(16);
    expect(NFL_TEAMS.filter((t) => t.conference === Conference.NFC).length).toBe(16);
  });

  it('has 4 teams per division (all 8 divisions)', () => {
    for (const division of Object.values(Division)) {
      expect(NFL_TEAMS.filter((t) => t.division === division).length).toBe(4);
    }
  });

  it('honors the 8/14/10 market-size split required by the design doc', () => {
    expect(NFL_TEAMS.filter((t) => t.marketSize === MarketSize.LARGE).length).toBe(8);
    expect(NFL_TEAMS.filter((t) => t.marketSize === MarketSize.MEDIUM).length).toBe(14);
    expect(NFL_TEAMS.filter((t) => t.marketSize === MarketSize.SMALL).length).toBe(10);
  });

  it('has unique abbreviations', () => {
    const abbrs = NFL_TEAMS.map((t) => t.abbreviation);
    expect(new Set(abbrs).size).toBe(abbrs.length);
  });
});
