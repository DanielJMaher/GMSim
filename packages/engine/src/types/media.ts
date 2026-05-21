/**
 * Media layer types (v0.62+).
 *
 * Outlets are the third intel stream alongside scouts (per-team) and
 * head coaches (per-team narrow-but-tight). Where scouts see ground
 * truth at varying confidence and coaches see scheme fit + intangibles,
 * outlets generate **league-wide narrative** that may or may not match
 * reality. A sensationalist sports-radio outlet creates "false flag"
 * hype around a college prospect; an insider reports accurate
 * trade-deadline buzz that a beat reporter wouldn't catch.
 *
 * v0.62 ships the foundation: outlet entities + weekly team-week
 * reports during regular-season and playoff ticks. The other report
 * kinds in the discriminated union are defined now so the college-
 * season slice (Heisman tracking, mock-draft big boards, prospect
 * hype) drops generators onto a stable type surface.
 *
 * Per North Star: outlet output is observable to the player; the
 * underlying accuracy/hype spectrums driving each outlet's behavior
 * are NOT surfaced as numbers. The player learns each outlet's
 * trustworthiness through repeated exposure (same way they learn
 * scouts and team chart modifiers).
 */

import type { LifecyclePhase } from '../season/lifecycle.js';
import type {
  MediaOutletId,
  MediaReportId,
  TeamId,
  PlayerId,
} from './ids.js';

/**
 * Categorical outlet tier. Drives readership scale, report cadence,
 * baseline accuracy, and tone affordances. Real-world analogues:
 *
 *   INSIDER    — Schefter / Rapoport tier. National, accurate,
 *                low-hype, often-first reporting.
 *   BEAT       — The Athletic / team newspaper beat. One-team-deep,
 *                accurate, measured tone, granular detail.
 *   COLUMNIST  — National opinion writer (PFT, Sports Illustrated
 *                style). Moderate accuracy, higher hype.
 *   RADIO      — Sports talk radio. Lower accuracy, high hype,
 *                fast-take culture. Drives false-flag patterns.
 *   BLOG       — Independent / fan-blog tier. Wide accuracy variance;
 *                some are sharper than columnists, some are pure
 *                noise. College-side bloggers track regional
 *                prospects national outlets miss.
 */
export type MediaTier = 'INSIDER' | 'BEAT' | 'COLUMNIST' | 'RADIO' | 'BLOG';

/**
 * What the outlet covers. v0.62 only generates content for `NFL` and
 * `BOTH` outlets (college-side generators land in the college-season
 * slice). College-only outlets exist on day 1 with no reports yet —
 * the entity layer is forward-compatible.
 */
export type MediaFocus = 'NFL' | 'COLLEGE' | 'BOTH';

/**
 * Outlet market. `NATIONAL` outlets cover the entire league;
 * team-local outlets attach to a specific franchise.
 */
export type MediaMarket = 'NATIONAL' | { localTo: TeamId };

/**
 * One media outlet. ~50 of these generated per league at creation;
 * stable across the league's lifespan (no outlet birth/death yet —
 * future slice). Spectrums are 1-10 to match the engine's
 * personality-spectrum convention (Owner, GM, HC use 1-10 too).
 */
export interface MediaOutlet {
  id: MediaOutletId;
  /** Display name, e.g. "ESPN", "The Athletic Boston", "Sports Radio 101 Dallas". */
  name: string;
  tier: MediaTier;
  focus: MediaFocus;
  market: MediaMarket;
  /**
   * 1 = sensationalist / unreliable, 10 = insider-quality / always right.
   * Future: scout-style observation-confidence applies — a high-accuracy
   * outlet's reports about player tier / prospect quality / trade hot
   * takes are closer to ground truth than a sports-radio outlet's.
   */
  accuracySpectrum: number;
  /**
   * 1 = measured / nuanced, 10 = clickbait / dramatic. Drives tone
   * + template selection. High-hype outlets pick more dramatic
   * headlines and amplify streaks / controversies. Low-hype outlets
   * pick measured templates and may stay silent on borderline events.
   */
  hypeSpectrum: number;
}

/**
 * Categorical tone tag attached to every report. Drives display
 * styling (red chip for CRITICAL, green for POSITIVE) and lets future
 * narrative aggregators ("this week's biggest critics" / "this team's
 * biggest fans") group reports by sentiment.
 */
export type MediaTone = 'POSITIVE' | 'NEUTRAL' | 'CRITICAL' | 'SPECULATIVE';

/**
 * Common fields across every report kind. Append-only — reports are
 * filed at a specific tick and never mutate. The stream is a
 * historical record.
 */
export interface MediaReportBase {
  id: MediaReportId;
  outletId: MediaOutletId;
  /** Sim tick when the report was filed. */
  filedOnTick: number;
  /** League season at filing. */
  seasonNumber: number;
  /**
   * 1-indexed week number when the report fired during the regular
   * season; null for offseason / playoff reports (use lifecyclePhase
   * to distinguish those).
   */
  weekNumber: number | null;
  lifecyclePhase: LifecyclePhase;
  tone: MediaTone;
  /** Outlet's published headline. Display-ready, beat-reporter tone. */
  headline: string;
}

/**
 * v0.62 — the only populated kind. Fires during REGULAR_SEASON_WEEK
 * and the four playoff-round ticks. Anchored to a specific team
 * (typically the just-played-game team) so the inspector can attach
 * reports to teams + filter the feed.
 */
export interface TeamWeekReport extends MediaReportBase {
  kind: 'team-week-report';
  subjectTeamId: TeamId;
  /**
   * Optional game reference — if the report is driven by a specific
   * just-played game, the gameId. Allows future inspector views to
   * cluster reports under each game card.
   */
  gameId?: string;
}

/**
 * Future kind (college-season slice + NFL player-take coverage).
 * Defined now so the discriminated union doesn't change shape later.
 * No generator in v0.62.
 */
export interface PlayerTakeReport extends MediaReportBase {
  kind: 'player-take';
  subjectPlayerId: PlayerId;
  /**
   * For college prospects, this is the CollegePlayer id (which shares
   * the PlayerId brand). The `subjectIsCollegeProspect` flag lets
   * consumers split NFL vs college takes without joining against
   * league.collegePool.
   */
  subjectIsCollegeProspect: boolean;
}

/**
 * Future kind (college-season slice). Per-outlet mock-draft entry for
 * a single college prospect — the building block of media-driven big
 * boards. v0.51 currently proxies a "media big board" via
 * `leagueAggregateByProspect` pooled scouting; once outlets generate
 * their own boards, the aggregate becomes a real third stream.
 */
export interface ProspectBoardReport extends MediaReportBase {
  kind: 'prospect-board';
  subjectPlayerId: PlayerId;
  /** This outlet's projected draft slot for this prospect. 1..257. */
  projectedOverallPick: number;
}

/**
 * Future kind (college-season slice). League-wide narrative threads
 * that span multiple subjects: Heisman race state, mock-draft consensus
 * shifts, awards-race watch, trade-deadline buzz aggregates.
 */
export interface NarrativeReport extends MediaReportBase {
  kind: 'narrative';
  /**
   * Narrative thread id. Multiple reports across weeks can share the
   * same threadId so the inspector can render "Heisman race week 8"
   * → "Heisman race week 9" as a single evolving story.
   */
  threadId: string;
}

/**
 * Discriminated union of all media report shapes. v0.62 only emits
 * `TeamWeekReport`; the other kinds reserve their slot in the union
 * so college-season generators drop in without breaking consumers.
 */
export type MediaReport =
  | TeamWeekReport
  | PlayerTakeReport
  | ProspectBoardReport
  | NarrativeReport;
