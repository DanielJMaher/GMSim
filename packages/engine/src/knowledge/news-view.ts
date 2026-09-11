/**
 * `newsView` — the game-safe league feed: what the outlets published, and what
 * the transaction wire reported (GAME_UI_FOUNDATION.md D1; the season hub's
 * news column reads this).
 *
 * Two rules do the real work here.
 *
 * **1. Outlet reliability never crosses.** `MediaOutlet` carries
 * `accuracySpectrum` (1 = sensationalist, 10 = insider) and `hypeSpectrum`.
 * Those are the engine's ground truth about who is worth believing, and they
 * are precisely what the North Star says the player must learn by WATCHING —
 * "the player learns which other GMs overpay in free agency by watching free
 * agency", and the same logic governs the press. A reliability number on a
 * byline would replace the entire read-to-learn loop with a stat. The feed
 * therefore carries the outlet's NAME and its public character (tier, focus,
 * market — you can tell ESPN from a sports-radio show by looking at it) and
 * never a spectrum value.
 *
 * **2. Transaction kinds are ALLOW-LISTED, not deny-listed.** The transaction
 * log mixes public world facts (a signing, a firing, a trade) with pure engine
 * diagnostics (`roster-floor-violation`, `contract-id-collision`,
 * `cap-compliance-unclearable`) and outright hidden truth (`mood-shift` is
 * literally mood internals). An allow-list means a transaction kind added later
 * is invisible here until someone deliberately publishes it — it fails CLOSED.
 *
 * The transaction prose itself is NOT re-implemented here. `season/news.ts`
 * already derives headlines, bodies, source attribution and severity from the
 * transaction log, so this module WRAPS it — the boundary decides what may be
 * seen, it does not rewrite the world.
 *
 * **Honest note on what that filter currently catches: nothing.**
 * `deriveNewsFeed` already returns null for `mood-shift`,
 * `roster-floor-violation`, `contract-id-collision` and
 * `cap-compliance-unclearable` — it suppresses them as "routine bookkeeping
 * rather than news", which happens to coincide with the boundary's needs. So
 * every kind it emits today is publishable, and the allow-list below removes
 * nothing.
 *
 * It stays anyway, for one reason: `newsItemFor`'s exclusions are an EDITORIAL
 * judgement about what is interesting, made in a module with no knowledge-layer
 * obligations. Nothing stops a future inspector feature from surfacing
 * `roster-floor-violation` there — a perfectly reasonable change in that
 * module, which would silently pipe engine diagnostics into a player-facing
 * feed. The allow-list makes this module's boundary explicit and independent,
 * and it fails CLOSED when that happens. It is a second barrier, and it is
 * documented as currently inert rather than presented as load-bearing.
 *
 * That direction is deliberate and this repo has the scar to justify it: four
 * exhaustive `Transaction['kind']` switches in the inspector went un-updated
 * when two kinds landed, and killed the v0.191.0 Pages deploy. A deny-list here
 * would have the same failure mode with a worse consequence — a forgotten entry
 * would leak engine internals into a player-facing feed rather than break a
 * build.
 */

import type { LeagueState } from '../types/league.js';
import type { TeamId, PlayerId } from '../types/ids.js';
import type { MediaTone, MediaTier, MediaFocus } from '../types/media.js';
import type { Transaction } from '../types/transaction.js';
import { deriveNewsFeed, type NewsSource } from '../season/news.js';

/** The public character of an outlet. Reliability is NOT here, by design. */
export interface NewsSourceView {
  outletId: string;
  name: string;
  /**
   * National / regional / local — visible from any masthead, so public.
   *
   * Named `outletTier`, not `tier`, on purpose. The knowledge layer's leak
   * gates are deliberately blunt recursive key scans, and `tier` is a
   * ground-truth field name on `Player` (`TalentTier`). Letting a legitimate
   * public field reuse that name would force the gate to stop forbidding
   * `tier` outright — trading a real leak detector for a naming convenience.
   * The gate caught this collision on first run; the field moved rather than
   * the rule. */
  outletTier: MediaTier;
  focus: MediaFocus;
}

export interface NewsItemView {
  /** Stable per-item id, so a feed can key rows without re-deriving. */
  id: string;
  /** `media` = someone published it. `wire` = a reported roster move. */
  kind: 'media' | 'wire';
  tick: number;
  seasonNumber: number;
  /** Regular-season week, or null outside it. */
  weekNumber: number | null;
  headline: string;
  /** A sentence or two of detail. Empty on media items — the headline is the report. */
  body: string;
  /** 1 = footnote, 5 = blockbuster. Drives visual weight in a feed. */
  severity: 1 | 2 | 3 | 4 | 5;
  /** Who is reporting a wire item. Null on media items, where the outlet is the byline. */
  wireSource: NewsSource | null;
  /** Players the item mentions, for player-scoped filtering. */
  playerIds: readonly PlayerId[];
  /** Present on media items; wire copy has no outlet byline. */
  source: NewsSourceView | null;
  /** The outlet's published stance. Editorial tone is public; reliability isn't. */
  tone: MediaTone | null;
  /** Clubs this item concerns, for filtering to your team. */
  teamIds: readonly TeamId[];
}

/**
 * Transaction kinds that are public world facts. Real NFL transactions are
 * reported the day they happen, and real contracts are public, so terms may
 * accompany them.
 *
 * `locker-room-incident` IS here, which looks wrong for a mood-derived event
 * until you read `newsItemFor`: it surfaces only when `txn.mediaLeak` is true —
 * the incident actually reached the press — and `newsFromIncident` renders
 * prose and an anonymous-source byline, never a mood value. A leaked incident
 * is precisely what beat writers report, and suppressing it would delete real
 * texture the Living Voice design wants, to guard against a leak that is not
 * there.
 *
 * Deliberately ABSENT, with the reason — see
 * `KNOWN_UNSAFE_TRANSACTION_KINDS`.
 */
const PUBLIC_TRANSACTION_KINDS: ReadonlySet<Transaction['kind']> = new Set([
  'release',
  'fa-sign',
  're-sign',
  'restructure',
  'trade',
  'cap-cut',
  'franchise-tag',
  'trade-request',
  'locker-room-incident',
  'hc-fired',
  'gm-fired',
  'hc-hired',
  'hc-interim',
  'gm-hired',
  // Reserved: public facts that `deriveNewsFeed` does not currently surface
  // (it judges them routine bookkeeping). Listed so that if it ever starts,
  // they publish as the public facts they are rather than being dropped by an
  // allow-list nobody revisited.
  'ir-move',
  'ps-promotion',
  'contract-expiration',
  'emergency-qb-game',
  'retirement-dead-money',
  'preseason-cut-dead-money',
] as Transaction['kind'][]);

/**
 * Kinds that must never reach a player-facing feed, whatever another module
 * decides to render. `mood-shift` is literally mood internals — ground truth on
 * CLAUDE.md's own list. The rest describe the SIMULATION misbehaving rather
 * than the football world, and belong in the inspector and the logs.
 *
 * Exported so the gate can assert the barrier DIRECTLY. Asserting it against
 * feed output cannot work: `deriveNewsFeed` already drops these, so a test that
 * only inspects the feed passes whether or not the barrier exists — which is
 * exactly what happened on the first attempt to verify it.
 */
export const KNOWN_UNSAFE_TRANSACTION_KINDS: readonly Transaction['kind'][] = [
  'mood-shift',
  'roster-floor-violation',
  'contract-id-collision',
  'cap-compliance-unclearable',
] as Transaction['kind'][];

/** Whether a transaction kind may be published to a player-facing feed. */
export function isPubliclyReportable(kind: Transaction['kind']): boolean {
  return PUBLIC_TRANSACTION_KINDS.has(kind);
}

export interface NewsViewOptions {
  /** Only items at or after this tick. */
  sinceTick?: number;
  /** Only items concerning this club. */
  teamId?: TeamId;
  /** Newest-first cap on returned items. Default 60. */
  limit?: number;
}

const DEFAULT_LIMIT = 60;


/**
 * The league feed as a game UI may see it, newest first: published media
 * reports interleaved with reported roster moves.
 *
 * The wire half delegates to `deriveNewsFeed` — headline, body, severity and
 * source attribution are already written there, for every kind below — and this
 * function's contribution is the ALLOW-LIST that drops the kinds a player must
 * never see. The filter runs BEFORE the limit is applied, so a feed capped at
 * N returns N publishable items rather than N minus however many diagnostics
 * happened to land in the window.
 */
export function newsView(
  league: LeagueState,
  options: NewsViewOptions = {},
): readonly NewsItemView[] {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const items: NewsItemView[] = [];

  // ── Published media ────────────────────────────────────────────────
  for (const report of league.mediaReports) {
    if (options.sinceTick !== undefined && report.filedOnTick < options.sinceTick) continue;
    const outlet = league.mediaOutlets[report.outletId];
    const teamIds: TeamId[] = [];
    const subject = (report as unknown as Record<string, unknown>)['subjectTeamId'];
    if (typeof subject === 'string') teamIds.push(subject as TeamId);
    if (options.teamId && !teamIds.includes(options.teamId)) continue;

    items.push({
      id: `media:${String(report.id)}`,
      kind: 'media',
      tick: report.filedOnTick,
      seasonNumber: report.seasonNumber,
      weekNumber: report.weekNumber,
      headline: report.headline,
      body: '',
      severity: 2,
      wireSource: null,
      playerIds: [],
      source: outlet
        ? {
            outletId: String(outlet.id),
            name: outlet.name,
            outletTier: outlet.tier,
            focus: outlet.focus,
          }
        : null,
      tone: report.tone,
      teamIds,
    });
  }

  // ── The transaction wire ───────────────────────────────────────────
  // No `limit` passed through: the allow-list below must filter the FULL
  // matched set, or the cap would be spent on items that never publish.
  const wireOptions: { sinceTick?: number; teamId?: TeamId } = {};
  if (options.sinceTick !== undefined) wireOptions.sinceTick = options.sinceTick;
  if (options.teamId !== undefined) wireOptions.teamId = options.teamId;

  let wireIndex = 0;
  for (const item of deriveNewsFeed(league, wireOptions)) {
    wireIndex++;
    if (!PUBLIC_TRANSACTION_KINDS.has(item.sourceKind)) continue;
    items.push({
      id: `wire:${item.sourceKind}:${item.tick}:${wireIndex}`,
      kind: 'wire',
      tick: item.tick,
      seasonNumber: item.seasonNumber,
      weekNumber: null,
      headline: item.headline,
      body: item.body,
      severity: item.severity,
      wireSource: item.source,
      playerIds: item.playerIds,
      source: null,
      tone: null,
      teamIds: item.teamIds,
    });
  }

  return items.sort((a, b) => b.tick - a.tick).slice(0, limit);
}
