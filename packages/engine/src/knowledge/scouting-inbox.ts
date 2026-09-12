/**
 * `scoutingInbox` — the mail-style beat (SCOUTING_PROCESS.md §2/§7; the inbox
 * screen reads this).
 *
 * Daniel's fantasy for this surface, verbatim from §1: reports cross your desk,
 * your area scout swears by a small-school edge, your national guy is lukewarm,
 * and *you* decide who to believe. So an inbox item is a report with a BYLINE,
 * not a data row.
 *
 * ## Reuse, not re-derivation
 *
 * The raw material is `CollegePlayerObservation`, whose `skills` and
 * `confidence` are raw numeric maps — the rawest ground-truth-adjacent payload
 * in the draft pipeline. Converting those into attributed, qualitative,
 * source-bylined prose is exactly what `prospectSnapshot` already does, through
 * the same assembly the inspector's dossier uses. So the inbox finds WHICH
 * prospects were filed on in this beat and hands each one's snapshot back; it
 * never touches an observation's numbers itself.
 *
 * That keeps one conversion path for prospect knowledge instead of two that can
 * drift, and it means this module inherits `snapshot.test.ts` — the original
 * leak gate — rather than needing to re-prove the same property.
 *
 * ## The scout's name is public; his accuracy is not
 *
 * `CollegeScout` carries `trueAccuracy` (hidden per-group accuracy) alongside
 * `name`, `knownSpecialty` and `yearsExperience`. §6 is explicit that in alpha
 * a scout is visible as identity + known specialty + tenure, and that his
 * reliability is "learnable only by tracking their calls". So the byline
 * carries who filed it and what he is known for; how right he tends to be is
 * the thing the player is playing to find out.
 */

import type { PlayerId, TeamId, ScoutId } from '../types/ids.js';
import type { Position, PositionGroup } from '../types/enums.js';
import { prospectSnapshot, type ProspectSnapshot } from './snapshot.js';
import { unwrapGameLeague, type GameLeague } from './game-session.js';

/** Who filed a report. Identity and known specialty only — never accuracy. */
export interface ScoutBylineView {
  scoutId: ScoutId;
  name: string;
  /** What he is known for. His actual reliability stays hidden (§6). */
  knownSpecialty: PositionGroup;
  yearsExperience: number;
}

export interface InboxItemView {
  prospectId: PlayerId;
  firstName: string;
  lastName: string;
  projectedPosition: Position;
  schoolId: string;
  /** Most recent filing tick in this beat — the inbox sorts on it. */
  filedOnTick: number;
  /** Everyone from your department who filed on him in this window. */
  bylines: readonly ScoutBylineView[];
  /** How many reports landed in this window. */
  reportCount: number;
  /** The club's current read on him, attributed and qualitative. */
  snapshot: ProspectSnapshot;
}

export interface ScoutingInboxOptions {
  /** Only reports filed at or after this tick — one beat of the calendar. */
  sinceTick?: number;
  /** Cap the returned list, newest first. Default 80. */
  limit?: number;
}

const DEFAULT_LIMIT = 80;

/**
 * The reports that landed on this club's desk, newest first.
 *
 * Only this club's OWN scouts are read. A rival's department filings are not
 * the player's mail, and media evaluations are a separate stream that reaches
 * the player through `newsView` and the consensus board.
 */
export function scoutingInbox(
  handle: GameLeague,
  teamId: TeamId,
  options: ScoutingInboxOptions = {},
): readonly InboxItemView[] {
  const league = unwrapGameLeague(handle);
  const team = league.teams[teamId];
  if (!team) return [];

  const sinceTick = options.sinceTick ?? Number.NEGATIVE_INFINITY;
  const limit = options.limit ?? DEFAULT_LIMIT;
  const ourScouts = new Set((team.collegeScoutIds as readonly ScoutId[]).map(String));

  /** prospectId -> { latest tick, scoutIds, count } */
  const beat = new Map<string, { tick: number; scouts: Set<string>; count: number }>();
  for (const obs of league.collegeObservations) {
    if (!ourScouts.has(String(obs.scoutId))) continue;
    if (obs.observedOnTick < sinceTick) continue;
    const key = String(obs.collegePlayerId);
    const entry = beat.get(key);
    if (entry) {
      entry.tick = Math.max(entry.tick, obs.observedOnTick);
      entry.scouts.add(String(obs.scoutId));
      entry.count++;
    } else {
      beat.set(key, {
        tick: obs.observedOnTick,
        scouts: new Set([String(obs.scoutId)]),
        count: 1,
      });
    }
  }

  const viewer = { kind: 'team', teamId } as const;
  const items: InboxItemView[] = [];

  for (const [prospectId, entry] of beat) {
    const cp = league.collegePool.find((c) => String(c.id) === prospectId);
    if (!cp) continue;
    const snapshot = prospectSnapshot(league, viewer, cp.id);
    if (!snapshot) continue;

    const bylines: ScoutBylineView[] = [];
    for (const scoutId of entry.scouts) {
      const scout = league.collegeScouts[scoutId as ScoutId];
      if (!scout) continue;
      bylines.push({
        scoutId: scout.id,
        name: scout.name,
        knownSpecialty: scout.knownSpecialty,
        yearsExperience: scout.yearsExperience,
      });
    }

    items.push({
      prospectId: cp.id,
      firstName: cp.firstName,
      lastName: cp.lastName,
      projectedPosition: cp.nflProjectedPosition,
      schoolId: cp.schoolId,
      filedOnTick: entry.tick,
      bylines,
      reportCount: entry.count,
      snapshot,
    });
  }

  return items.sort((a, b) => b.filedOnTick - a.filedOnTick).slice(0, limit);
}
