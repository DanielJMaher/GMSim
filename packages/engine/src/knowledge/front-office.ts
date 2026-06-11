import type { LeagueState } from '../types/league.js';
import type { TeamId } from '../types/ids.js';
import type { HotSeatHeat } from '../types/media.js';

/**
 * Front-office knowledge (S3, v0.140) — the game-safe view of the hot
 * seat. The engine knows the real seat pressure; outlets perceive it
 * (miscalibrated); a GAME surface sees only this: who is reportedly in
 * trouble, per which outlet, in qualitative heat bands. No numbers —
 * neither the real pressure nor the outlet's numeric read crosses this
 * boundary (`front-office.test.ts` is the leak gate). The player learns
 * which outlets' hot-seat calls come true the same way they learn
 * everything else: by watching.
 */
export interface HotSeatKnowledgeItem {
  teamId: TeamId;
  chair: 'HC' | 'GM';
  /** Subject's name as reported (frozen at filing). */
  subjectName: string;
  /** Who is saying it — the attribution the player calibrates against. */
  outletName: string;
  /** Qualitative read: warm / hot / inferno. */
  heat: HotSeatHeat;
  headline: string;
  seasonNumber: number;
  /** 1-indexed regular-season week, or null for offseason coverage. */
  weekNumber: number | null;
}

export interface HotSeatKnowledgeOptions {
  /** Only items touching this team. */
  teamId?: TeamId;
  /** Only items from this season. */
  seasonNumber?: number;
  /** Cap the returned list (newest-first preserved). */
  limit?: number;
}

/**
 * Derive the attributed hot-seat feed from the media stream. Pure
 * function, newest-first.
 */
export function hotSeatKnowledge(
  league: LeagueState,
  opts: HotSeatKnowledgeOptions = {},
): readonly HotSeatKnowledgeItem[] {
  const items: HotSeatKnowledgeItem[] = [];
  for (let i = league.mediaReports.length - 1; i >= 0; i--) {
    const r = league.mediaReports[i]!;
    if (r.kind !== 'hot-seat') continue;
    if (opts.teamId && r.subjectTeamId !== opts.teamId) continue;
    if (opts.seasonNumber !== undefined && r.seasonNumber !== opts.seasonNumber) continue;
    items.push({
      teamId: r.subjectTeamId,
      chair: r.chair,
      subjectName: r.subjectName,
      outletName: league.mediaOutlets[r.outletId]?.name ?? 'Unknown outlet',
      heat: r.heat,
      headline: r.headline,
      seasonNumber: r.seasonNumber,
      weekNumber: r.weekNumber,
    });
    if (opts.limit !== undefined && items.length >= opts.limit) break;
  }
  return items;
}
