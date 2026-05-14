import type { LeagueState } from '../types/league.js';
import type { Player } from '../types/player.js';
import type {
  Transaction,
  TransactionLockerRoomIncident,
  TransactionTrade,
  TransactionTradeRequest,
  TransactionRelease,
  TransactionFreeAgentSign,
  TransactionCapCut,
  LockerRoomIncidentFlavor,
} from '../types/transaction.js';
import type { TeamId, PlayerId } from '../types/ids.js';

/**
 * News-feed module — MVP slice of Doc 12 (League News & Transaction Feed).
 *
 * This file derives a `NewsItem[]` view over the league's append-only
 * transaction log. Pure function — no new persisted state, no side
 * effects, deterministic by construction.
 *
 * Doc 12 envisions a full multi-source media ecosystem with reliability
 * tracking, fan sentiment, draft coverage, and a sortable transaction
 * database. This MVP covers the *narrative surfacing* slice the
 * chemistry rework needs: leaked locker-room incidents, trade demands,
 * major transactions. Reliability/bias mechanics, fan sentiment, the
 * full sortable DB, and generated quotes are deferred — see the
 * `.claude-resume.md` open-threads list.
 *
 * The intent is that the inspector's News Feed panel reads this output
 * verbatim, and a future player-facing UI can render the same items
 * with richer styling. The raw transaction log stays available as a
 * debug surface alongside; news is the *narrative* layer.
 */

export type NewsSource =
  | 'national_insider' // breaking-news authority — Schefter/Rapoport style
  | 'beat_writer'      // local market coverage — daily team paper
  | 'anonymous_source' // unattributed locker-room / front-office leak
  | 'social_media';    // viral / off-field — Twitter, Instagram

export interface NewsItem {
  /** Tick the underlying event took effect (matches the source transaction). */
  tick: number;
  /** League season number when this happened (1-indexed). */
  seasonNumber: number;
  /** 1=minor footnote, 5=blockbuster. Drives ordering and visual weight. */
  severity: 1 | 2 | 3 | 4 | 5;
  /** Short present-tense headline. */
  headline: string;
  /** 1-2 sentence body with player names and details. */
  body: string;
  /** Who's reporting it — Doc 12 source attribution. */
  source: NewsSource;
  /** Underlying transaction kind. Useful for filter chips. */
  sourceKind: Transaction['kind'];
  /** Team IDs the news touches (one for most, two for trades). */
  teamIds: readonly TeamId[];
  /** Players the news mentions. */
  playerIds: readonly PlayerId[];
}

export interface NewsFeedOptions {
  /** Drop items strictly before this tick. */
  sinceTick?: number;
  /** Only return items touching this team. */
  teamId?: TeamId;
  /** Cap the returned list (newest-first ordering preserved). */
  limit?: number;
}

/**
 * Derive a news feed from `league.transactionLog`. Returns most-recent
 * first; within a tick, ordering preserves the underlying log's append
 * order. Pure function — same league in → same list out.
 *
 * Filter options compose: `sinceTick` drops older items, `teamId`
 * restricts to a single team's news, `limit` caps the final length.
 */
export function deriveNewsFeed(
  league: LeagueState,
  opts: NewsFeedOptions = {},
): readonly NewsItem[] {
  const items: NewsItem[] = [];
  for (const txn of league.transactionLog) {
    if (opts.sinceTick !== undefined && txn.tick < opts.sinceTick) continue;
    const item = newsItemFor(txn, league);
    if (!item) continue;
    if (opts.teamId && !item.teamIds.includes(opts.teamId)) continue;
    items.push(item);
  }
  items.reverse();
  if (opts.limit !== undefined) return items.slice(0, opts.limit);
  return items;
}

function newsItemFor(txn: Transaction, league: LeagueState): NewsItem | null {
  switch (txn.kind) {
    case 'locker-room-incident':
      return txn.mediaLeak ? newsFromIncident(txn, league) : null;
    case 'trade-request':
      return newsFromTradeRequest(txn, league);
    case 'trade':
      return newsFromTrade(txn, league);
    case 'release':
      return newsFromRelease(txn, league);
    case 'cap-cut':
      return newsFromCapCut(txn, league);
    case 'fa-sign':
      return newsFromFreeAgentSign(txn, league);
    case 'ir-move':
    case 'ps-promotion':
    case 'contract-expiration':
    case 'mood-shift':
      // Intentionally not surfaced. IR moves and PS promotions happen
      // weekly across the league — routine roster bookkeeping rather
      // than news. Contract expirations are a calendar event, not a
      // beat. mood-shift fires on every bucket crossing; the
      // narrative-worthy crossing into wants_out is captured by the
      // matching trade-request transaction emitted alongside it.
      return null;
  }
}

function newsFromIncident(
  txn: TransactionLockerRoomIncident,
  league: LeagueState,
): NewsItem {
  const player = league.players[txn.playerId];
  const team = league.teams[txn.teamId];
  const source: NewsSource =
    txn.flavor === 'social_media_post' ? 'social_media' : 'anonymous_source';
  const severity = incidentSeverity(txn.flavor, player);
  return {
    tick: txn.tick,
    seasonNumber: txn.seasonNumber,
    severity,
    source,
    sourceKind: 'locker-room-incident',
    headline: incidentHeadline(txn, player, team),
    body: incidentBody(txn, player, team),
    teamIds: [txn.teamId],
    playerIds: [txn.playerId],
  };
}

function newsFromTradeRequest(
  txn: TransactionTradeRequest,
  league: LeagueState,
): NewsItem {
  const player = league.players[txn.playerId];
  const team = league.teams[txn.teamId];
  if (txn.state === 'requested') {
    const source: NewsSource = txn.tier === 'STAR' ? 'national_insider' : 'anonymous_source';
    const severity: NewsItem['severity'] = txn.tier === 'STAR' ? 5 : 3;
    return {
      tick: txn.tick,
      seasonNumber: txn.seasonNumber,
      severity,
      source,
      sourceKind: 'trade-request',
      headline: `${txn.tier} ${nameOf(player)} demands trade out of ${abbrOf(team)}`,
      body:
        `Sources confirm ${nameOf(player)} has formally requested a trade. ` +
        `Mood-driven escalation — internal trade-request flag is on the books at mood ${Math.round(txn.mood)}.`,
      teamIds: [txn.teamId],
      playerIds: [txn.playerId],
    };
  }
  return {
    tick: txn.tick,
    seasonNumber: txn.seasonNumber,
    severity: 2,
    source: 'beat_writer',
    sourceKind: 'trade-request',
    headline: `${nameOf(player)} withdraws trade request`,
    body: `${nameOf(player)} (${abbrOf(team)}) has rescinded the trade demand. Mood recovered to ${Math.round(txn.mood)}.`,
    teamIds: [txn.teamId],
    playerIds: [txn.playerId],
  };
}

function newsFromTrade(txn: TransactionTrade, league: LeagueState): NewsItem {
  const teamA = league.teams[txn.teamAId];
  const teamB = league.teams[txn.teamBId];
  const aToB = txn.playersAToB.map((id) => league.players[id]).filter(present);
  const bToA = txn.playersBToA.map((id) => league.players[id]).filter(present);
  const highestTier = highestTierAmong([...aToB, ...bToA]);
  const severity: NewsItem['severity'] =
    highestTier === 'STAR' ? 5 : highestTier === 'STARTER' ? 4 : 3;
  const aSide = aToB.map(nameOf).join(', ') || '—';
  const bSide = bToA.map(nameOf).join(', ') || '—';
  return {
    tick: txn.tick,
    seasonNumber: txn.seasonNumber,
    severity,
    source: 'national_insider',
    sourceKind: 'trade',
    headline: `${abbrOf(teamA)} and ${abbrOf(teamB)} swing trade`,
    body:
      `${abbrOf(teamA)} sends ${aSide} to ${abbrOf(teamB)} for ${bSide}. ` +
      `Dead-money charges: ${abbrOf(teamA)} $${(txn.deadMoneyTeamA / 1e6).toFixed(1)}M, ` +
      `${abbrOf(teamB)} $${(txn.deadMoneyTeamB / 1e6).toFixed(1)}M.`,
    teamIds: [txn.teamAId, txn.teamBId],
    playerIds: [...txn.playersAToB, ...txn.playersBToA],
  };
}

function newsFromRelease(txn: TransactionRelease, league: LeagueState): NewsItem | null {
  const player = league.players[txn.playerId];
  if (!player) return null;
  if (player.tier !== 'STAR' && player.tier !== 'STARTER') return null;
  const team = league.teams[txn.teamId];
  const severity: NewsItem['severity'] = player.tier === 'STAR' ? 4 : 2;
  const source: NewsSource = player.tier === 'STAR' ? 'national_insider' : 'beat_writer';
  return {
    tick: txn.tick,
    seasonNumber: txn.seasonNumber,
    severity,
    source,
    sourceKind: 'release',
    headline: `${abbrOf(team)} releases ${player.tier} ${nameOf(player)}`,
    body:
      `${abbrOf(team)} cuts ties with ${nameOf(player)} ` +
      `($${(txn.deadMoney / 1e6).toFixed(1)}M dead money). ` +
      `Player hits the open market.`,
    teamIds: [txn.teamId],
    playerIds: [txn.playerId],
  };
}

function newsFromCapCut(txn: TransactionCapCut, league: LeagueState): NewsItem | null {
  const player = league.players[txn.playerId];
  if (!player) return null;
  if (player.tier !== 'STAR' && player.tier !== 'STARTER') return null;
  const team = league.teams[txn.teamId];
  const severity: NewsItem['severity'] = player.tier === 'STAR' ? 4 : 2;
  const source: NewsSource = player.tier === 'STAR' ? 'national_insider' : 'beat_writer';
  return {
    tick: txn.tick,
    seasonNumber: txn.seasonNumber,
    severity,
    source,
    sourceKind: 'cap-cut',
    headline: `${abbrOf(team)} cap-cuts ${player.tier} ${nameOf(player)}`,
    body:
      `Cap-driven release saves $${(txn.capSaving / 1e6).toFixed(1)}M ` +
      `against $${(txn.deadMoney / 1e6).toFixed(1)}M in accelerated dead money.`,
    teamIds: [txn.teamId],
    playerIds: [txn.playerId],
  };
}

function newsFromFreeAgentSign(
  txn: TransactionFreeAgentSign,
  league: LeagueState,
): NewsItem | null {
  const player = league.players[txn.playerId];
  if (!player) return null;
  if (player.tier !== 'STAR' && player.tier !== 'STARTER') return null;
  // Mid-season "vet-min" street signings are common roster bookkeeping
  // and don't move the news needle even when the player is a STARTER.
  if (!txn.marketContract) return null;
  const team = league.teams[txn.teamId];
  const severity: NewsItem['severity'] = player.tier === 'STAR' ? 4 : 2;
  const source: NewsSource = player.tier === 'STAR' ? 'national_insider' : 'beat_writer';
  return {
    tick: txn.tick,
    seasonNumber: txn.seasonNumber,
    severity,
    source,
    sourceKind: 'fa-sign',
    headline: `${abbrOf(team)} signs ${player.tier} ${nameOf(player)}`,
    body:
      `${nameOf(player)} agrees to a deal with ${abbrOf(team)} ` +
      `at $${(txn.yearOneCapHit / 1e6).toFixed(1)}M Y1 cap hit.`,
    teamIds: [txn.teamId],
    playerIds: [txn.playerId],
  };
}

function incidentSeverity(
  flavor: LockerRoomIncidentFlavor,
  player: Player | undefined,
): NewsItem['severity'] {
  // STAR-tier players inherently make any drama louder; flavor sets
  // the base, tier provides one bump up for the big names.
  const base: Record<LockerRoomIncidentFlavor, 1 | 2 | 3 | 4 | 5> = {
    off_field_issue: 4,
    coach_dispute: 3,
    practice_conflict: 3,
    media_blowup: 3,
    social_media_post: 2,
    positive_moment: 2,
  };
  const b = base[flavor];
  if (player?.tier === 'STAR' && b < 5) {
    return (b + 1) as NewsItem['severity'];
  }
  return b;
}

function incidentHeadline(
  txn: TransactionLockerRoomIncident,
  player: Player | undefined,
  team: { identity: { abbreviation: string } } | undefined,
): string {
  const name = nameOf(player);
  const abbr = abbrOf(team);
  switch (txn.flavor) {
    case 'media_blowup':
      return `${name} (${abbr}) goes off in postgame presser`;
    case 'social_media_post':
      return `${name} (${abbr}) post raises eyebrows`;
    case 'practice_conflict':
      return `Report: ${name} (${abbr}) involved in practice dust-up`;
    case 'coach_dispute':
      return `${name} (${abbr}) reportedly at odds with coaching staff`;
    case 'off_field_issue':
      return `Off-field concerns surface around ${name} (${abbr})`;
    case 'positive_moment':
      return `${name} steps up as ${abbr} room rallies`;
  }
}

function incidentBody(
  txn: TransactionLockerRoomIncident,
  player: Player | undefined,
  team: { identity: { abbreviation: string } } | undefined,
): string {
  const delta = txn.moodDelta;
  const deltaStr = delta >= 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1);
  const moodFragment = `Internal mood shift ${deltaStr}.`;
  switch (txn.flavor) {
    case 'media_blowup':
      return `${nameOf(player)} took the podium and didn't hold back. ${moodFragment}`;
    case 'social_media_post':
      return `${nameOf(player)}'s timeline is the league's main character today. ${moodFragment}`;
    case 'practice_conflict':
      return `Anonymous teammates describe a heated practice-field incident involving ${nameOf(player)}. ${moodFragment}`;
    case 'coach_dispute':
      return `${nameOf(player)} and the coaching staff appear to be on different pages, per sources around the building. ${moodFragment}`;
    case 'off_field_issue':
      return `Sources close to ${nameOf(player)} describe an off-field situation drawing organizational attention. ${moodFragment}`;
    case 'positive_moment':
      return `${nameOf(player)} pulled the ${abbrOf(team)} locker room together this week. ${moodFragment}`;
  }
}

function highestTierAmong(players: readonly Player[]): Player['tier'] | null {
  if (players.length === 0) return null;
  const order: Record<Player['tier'], number> = { STAR: 0, STARTER: 1, BACKUP: 2, FRINGE: 3 };
  let best: Player['tier'] = 'FRINGE';
  for (const p of players) {
    if (order[p.tier] < order[best]) best = p.tier;
  }
  return best;
}

function nameOf(player: Player | undefined): string {
  if (!player) return 'Unknown';
  return `${player.firstName.charAt(0)}. ${player.lastName}`;
}

function abbrOf(team: { identity: { abbreviation: string } } | undefined): string {
  return team?.identity.abbreviation ?? '???';
}

function present<T>(x: T | undefined): x is T {
  return x !== undefined;
}
