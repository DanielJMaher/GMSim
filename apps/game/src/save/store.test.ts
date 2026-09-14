import { describe, expect, it } from 'vitest';

import { compareVersions, EMPTY_BOARD, SaveTooNewError } from './store.js';

/**
 * The save wrapper's logic that does not need a browser.
 *
 * IndexedDB itself is exercised by running the app, not by mocking a database
 * into a node test — a mock would prove the mock works. What IS worth gating
 * here is the version comparison, because the obvious implementation is wrong
 * in a way that only bites after a version rolls over.
 */
describe('save version comparison', () => {
  it('orders by numeric component, not lexically', () => {
    // The trap: "0.9.0" > "0.10.0" as strings, which would refuse a save the
    // app can actually read. This is exactly the version range GMSim is in.
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0);
    expect(compareVersions('0.9.0', '0.10.0')).toBeLessThan(0);
    expect(compareVersions('0.192.1', '0.192.0')).toBeGreaterThan(0);
    expect(compareVersions('0.192.1', '0.193.0')).toBeLessThan(0);
  });

  it('treats equal versions as equal', () => {
    expect(compareVersions('0.192.1', '0.192.1')).toBe(0);
  });

  it('tolerates ragged and malformed versions rather than throwing', () => {
    // A save is user data; a version string that does not parse should not take
    // the app down on load.
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.1', '1.0')).toBeGreaterThan(0);
    expect(() => compareVersions('', 'x.y.z')).not.toThrow();
  });

  it('is the gate the newer-save refusal reads', () => {
    // D4: "loading a NEWER save than the app politely refuses."
    const saveVersion = '0.200.0';
    const appVersion = '0.192.1';
    expect(compareVersions(saveVersion, appVersion)).toBeGreaterThan(0);

    const err = new SaveTooNewError(saveVersion, appVersion);
    expect(err.message).toContain(saveVersion);
    expect(err.message).toContain(appVersion);
    // The message tells the player what to DO, not just what went wrong.
    expect(err.message).toMatch(/update/i);
  });
});

describe('empty board default', () => {
  it('is a usable board, not a null hole', () => {
    // A fresh game and a save written before the board existed both land here,
    // so it has to be renderable rather than something the UI must guard.
    expect(EMPTY_BOARD.order).toEqual([]);
    expect(EMPTY_BOARD.tierBreaks).toEqual([]);
    expect(EMPTY_BOARD.notes).toEqual({});
  });
});
