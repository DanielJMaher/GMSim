/**
 * `faMarketView` + the free-agency facade — the FA market screen
 * (D7_FA_SEAM.md §7; GAME_UI_FOUNDATION.md §8.3 draws the boundary).
 *
 * Same shape as the draft-room facade, and for the same reason: the stepped
 * session lives in `transactions/`, and `apps/game` may only import
 * `@gmsim/engine/knowledge`. Per D1's growing rule, the surface that needs more
 * EXTENDS this module.
 *
 * ## The boundary here is unusually crisp, and unusually important
 *
 * §8.3 splits this surface cleanly:
 *
 * **Never crosses — every component of a rival's bid.** `cashValuation`,
 * `cashValuationBaseline`, `preferenceMultiplier`, `perceivedBid`,
 * `capRoomAtTime`, `preferenceFactors`, `watchListMultiplier`,
 * `watchListPriority`, `watchListReason`. Those let a player COMPUTE what a
 * rival GM will do. The entire "you learn which GMs overpay by watching free
 * agency" mechanic depends on them being unavailable.
 *
 * **Must cross, once a signing resolves** — destination, terms, and the
 * runner-up context. Real contracts are public, and a player who loses a bid
 * has to be able to see what the player went for or there is nothing to learn
 * from. That asymmetry IS the mechanic: the outcome is public, the reasoning
 * never is.
 *
 * So a signing is reported with the price and the fact that you were outbid —
 * never with the number that beat you, because in the real sport you do not
 * learn the losing bids either.
 */

import type { PlayerId, TeamId } from '../types/ids.js';
import type { Position } from '../types/enums.js';
import type { LeagueState } from '../types/league.js';
import {
  beginFreeAgency,
  stepFreeAgency as stepSession,
  submitOffers,
  finishFreeAgency,
  isFreeAgencyComplete,
  type FaSession,
  type FaWave,
  type FaOffer,
} from '../transactions/offseason.js';
import { asGameLeague, unwrapGameLeague, type GameLeague } from './game-session.js';
import type { TeamIdentityView } from './league-view.js';
import { playerCard, type RosterPlayerView } from './roster-view.js';

/** A free agent on the market, as your club reads him. */
export interface FaPlayerView {
  playerId: PlayerId;
  firstName: string;
  lastName: string;
  position: Position;
  ageYears: number;
  experienceYears: number;
  /**
   * Your club's read on him — the D2b coach's card, exposure-scaled. A rival's
   * veteran is game tape only, so he reads foggier than your own roster, which
   * is exactly the tension a free-agency decision should carry.
   */
  card: RosterPlayerView;
}

/** A signing that has resolved. Public, because real contracts are public. */
export interface FaSigningView {
  playerId: PlayerId;
  firstName: string;
  lastName: string;
  position: Position;
  team: TeamIdentityView;
  /** What he signed for — the raw material of the learning loop. */
  firstYearCapHit: number;
  years: number;
  /**
   * Whether YOUR club was among the losing bidders. Deliberately a boolean and
   * not a number: in the real sport you learn you were outbid, not by how much.
   */
  youWereOutbid: boolean;
}

export interface FaMarketView {
  /** The wave currently resolving, or null between waves. */
  openWave: FaWave | null;
  /** Free agents still available in the open wave, best first. */
  available: readonly FaPlayerView[];
  /** Signings so far this period, newest first. */
  signings: readonly FaSigningView[];
  /** Your club's cap room right now — your own book, so a real number. */
  capSpace: number;
  complete: boolean;
}

/** A market in progress. Opaque, like `DraftRoom`. */
export interface FaMarket {
  /** @internal */ session: FaSession;
  /** @internal */ viewerTeamId: TeamId;
  /** @internal */ openWave: FaWave | null;
  /** @internal */ available: PlayerId[];
  /** @internal */ signings: FaSigningView[];
  /** @internal Players this club offered on, to report "you were outbid". */
  offeredOn: Set<string>;
}

export type FaMarketStep =
  | { kind: 'wave-open'; wave: FaWave }
  | { kind: 'signing'; signing: FaSigningView }
  | { kind: 'wave-closed'; wave: FaWave }
  | { kind: 'complete' };

function identityOf(league: LeagueState, teamId: TeamId): TeamIdentityView {
  const t = league.teams[teamId]!;
  return {
    teamId: t.identity.id,
    abbreviation: t.identity.abbreviation,
    location: t.identity.location,
    nickname: t.identity.nickname,
    fullName: t.identity.fullName,
    conference: t.identity.conference,
    division: t.identity.division,
  };
}

/** Open the market with your club registered as supplying its own decisions. */
export function openFreeAgency(
  handle: GameLeague,
  options: { viewerTeamId: TeamId; signedOnTick?: number },
): FaMarket {
  const league = unwrapGameLeague(handle);
  const session = beginFreeAgency(league, {
    signedOnTick: options.signedOnTick ?? league.tick,
    externallyControlledTeamIds: [options.viewerTeamId],
  });
  return {
    session,
    viewerTeamId: options.viewerTeamId,
    openWave: null,
    available: [],
    signings: [],
    offeredOn: new Set(),
  };
}

/** Advance the market by one event. */
export function stepFreeAgencyMarket(market: FaMarket): FaMarketStep {
  if (isFreeAgencyComplete(market.session)) return { kind: 'complete' };
  const step = stepSession(market.session);

  switch (step.kind) {
    case 'wave-open':
      market.openWave = step.wave;
      market.available = [...step.availablePlayerIds];
      return { kind: 'wave-open', wave: step.wave };

    case 'wave-closed':
      market.openWave = null;
      market.available = [];
      return { kind: 'wave-closed', wave: step.wave };

    case 'signing':
    case 'fill-up': {
      const league = market.session.working;
      const player = league.players[step.playerId];
      const contract = player?.contractId ? league.contracts[player.contractId] : undefined;
      const signing: FaSigningView = {
        playerId: step.playerId,
        firstName: player?.firstName ?? 'Unknown',
        lastName: player?.lastName ?? 'Player',
        position: player?.position ?? 'WR',
        team: identityOf(league, step.teamId),
        firstYearCapHit: contract?.baseSalaries[0] ?? 0,
        years: contract?.realYears ?? 0,
        youWereOutbid:
          market.offeredOn.has(String(step.playerId)) && step.teamId !== market.viewerTeamId,
      };
      market.signings.unshift(signing);
      market.available = market.available.filter(
        (id) => String(id) !== String(step.playerId),
      );
      return { kind: 'signing', signing };
    }

    default:
      return isFreeAgencyComplete(market.session)
        ? { kind: 'complete' }
        : stepFreeAgencyMarket(market);
  }
}

/**
 * Submit your offers for the open wave.
 *
 * Offers expire with the wave, because each one targets a player who is signed
 * or not by the time it closes. Cap room is what carries forward, and a losing
 * bid never spent any.
 */
export function submitFaOffers(market: FaMarket, offers: readonly FaOffer[]): void {
  for (const o of offers) market.offeredOn.add(String(o.playerId));
  submitOffers(market.session, market.viewerTeamId, offers);
}

/** The market as your club sees it. */
export function faMarketView(market: FaMarket): FaMarketView {
  const league = market.session.working;
  const team = league.teams[market.viewerTeamId];

  const available: FaPlayerView[] = [];
  for (const playerId of market.available) {
    const player = league.players[playerId];
    if (!player || player.teamId !== null) continue;
    const card = playerCard(league, market.viewerTeamId, player);
    available.push({
      playerId: player.id,
      firstName: player.firstName,
      lastName: player.lastName,
      position: player.position,
      ageYears: card.ageYears,
      experienceYears: card.experienceYears,
      card,
    });
  }

  let capSpace = 0;
  if (team) {
    let used = 0;
    for (const contract of Object.values(league.contracts)) {
      if (contract.teamId === market.viewerTeamId) used += contract.baseSalaries[0] ?? 0;
    }
    capSpace = league.salaryCap - used;
  }

  return {
    openWave: market.openWave,
    available,
    signings: market.signings,
    capSpace,
    complete: isFreeAgencyComplete(market.session),
  };
}

/** Close the market and fold its signings into the league. */
export function closeFreeAgency(market: FaMarket): GameLeague {
  return asGameLeague(finishFreeAgency(market.session));
}
