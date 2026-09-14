/**
 * The save wrapper — IndexedDB persistence with no UI around it.
 *
 * `GAME_UI_FOUNDATION.md` D4 ruled the mechanism: IndexedDB (a league is
 * multi-MB, localStorage will not hold it), version-stamped, with a newer save
 * politely refused.
 *
 * Daniel cut the save SCREEN for alpha — no slots, no resume UI, "they can just
 * play again for now" — but the wrapper underneath is not optional, for two
 * reasons that only show up when you trace what depends on it:
 *
 *   1. **The player's board lives here.** `SCOUTING_PROCESS.md` §3 deliberately
 *      keeps the board OUT of `LeagueState`, because the engine holds no
 *      player-team privilege (invariant #4). With no persistence the board —
 *      the thing Daniel called the heart of the game — would not survive a page
 *      refresh.
 *   2. **A league costs ~80 seconds to create.** A refresh without persistence
 *      is a to-minute penalty a tester will hit constantly.
 *
 * So: autosave, one slot, no interface. If slots are ever wanted, the only
 * change is a key other than `SLOT`.
 *
 * ## Why the league round-trips without ever being read
 *
 * The league is a `GameLeague` — opaque by construction, with no readable
 * members. That is exactly what makes it safe to store: this module hands the
 * whole handle to IndexedDB and gets it back, and at no point can it (or any
 * other game code) name a field on it. The knowledge layer owns both ends
 * through `serializeGame` / `restoreGame`, and `restoreGame` runs the engine's
 * forward migration so a save written before a field existed is healed on load
 * rather than crashing at first use.
 */

import { restoreGame, serializeGame, type GameLeague } from '@gmsim/engine/knowledge';
import type { TeamId, PlayerId } from '@gmsim/engine/types';

const DB_NAME = 'gmsim';
const DB_VERSION = 1;
const STORE = 'saves';
/** Single slot. Slots would be a different key here and nothing else. */
const SLOT = 'autosave';

/** The player's own board — ordering, tiers, flags, notes. Save-side by design. */
export interface PlayerBoard {
  /** Prospect ids in the player's preferred order. */
  order: readonly PlayerId[];
  /** Tier break positions — indices in `order` where a rule is drawn. */
  tierBreaks: readonly number[];
  /** Free-text notes per prospect. */
  notes: Readonly<Record<string, string>>;
}

export interface SavePayload {
  /** App version that wrote this save, for the newer-than-app refusal. */
  version: string;
  /** Wall-clock write time, for a human-readable "last played". */
  savedAt: string;
  /** The world seed, duplicated out of the league so a save can be identified
   *  without deserializing the whole thing. */
  seed: string;
  /** The opaque league. Never read by this module. */
  league: unknown;
  playerTeamId: TeamId | null;
  playerBoard: PlayerBoard;
  /** Whatever the UI wants to remember — active screen, filters. */
  uiState: Readonly<Record<string, unknown>>;
}

export interface LoadedSave {
  league: GameLeague;
  playerTeamId: TeamId | null;
  playerBoard: PlayerBoard;
  uiState: Readonly<Record<string, unknown>>;
  savedAt: string;
  version: string;
}

export const EMPTY_BOARD: PlayerBoard = { order: [], tierBreaks: [], notes: {} };

/** Thrown when a save was written by a newer build than the one loading it. */
export class SaveTooNewError extends Error {
  constructor(
    readonly saveVersion: string,
    readonly appVersion: string,
  ) {
    super(
      `This save was made with GMSim ${saveVersion}; you are running ${appVersion}. ` +
        'Update to load it.',
    );
    this.name = 'SaveTooNewError';
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the save database.'));
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = run(transaction.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Save operation failed.'));
        transaction.oncomplete = () => db.close();
      }),
  );
}

/**
 * Compare two `major.minor.patch` strings. Returns >0 when `a` is newer.
 *
 * Deliberately not a string comparison: "0.9.0" > "0.10.0" lexically, which
 * would refuse a save the app can actually read.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Write the autosave. Called on every advance — the whole persistence story,
 * since there is no save UI to trigger it explicitly.
 */
export async function saveGame(payload: {
  league: GameLeague;
  seed: string;
  playerTeamId: TeamId | null;
  playerBoard: PlayerBoard;
  uiState?: Readonly<Record<string, unknown>>;
  appVersion: string;
}): Promise<void> {
  const record: SavePayload = {
    version: payload.appVersion,
    savedAt: new Date().toISOString(),
    seed: payload.seed,
    league: serializeGame(payload.league),
    playerTeamId: payload.playerTeamId,
    playerBoard: payload.playerBoard,
    uiState: payload.uiState ?? {},
  };
  await tx('readwrite', (store) => store.put(record, SLOT));
}

/**
 * Read the autosave, or null when there is none.
 *
 * Throws `SaveTooNewError` when the save came from a newer build — D4's
 * "politely refuses". Everything else is healed by the engine's forward
 * migration inside `restoreGame`.
 */
export async function loadGame(appVersion: string): Promise<LoadedSave | null> {
  const record = (await tx<SavePayload | undefined>('readonly', (store) =>
    store.get(SLOT),
  )) as SavePayload | undefined;
  if (!record) return null;

  if (compareVersions(record.version, appVersion) > 0) {
    throw new SaveTooNewError(record.version, appVersion);
  }

  return {
    league: restoreGame(record.league),
    playerTeamId: record.playerTeamId,
    playerBoard: record.playerBoard ?? EMPTY_BOARD,
    uiState: record.uiState ?? {},
    savedAt: record.savedAt,
    version: record.version,
  };
}

/** Whether a save exists, without deserializing a multi-MB league. */
export async function hasSave(): Promise<boolean> {
  const keys = await tx<IDBValidKey[]>('readonly', (store) => store.getAllKeys());
  return keys.includes(SLOT);
}

/** Discard the autosave. The "start over" path, since there is no slot UI. */
export async function clearSave(): Promise<void> {
  await tx('readwrite', (store) => store.delete(SLOT));
}
