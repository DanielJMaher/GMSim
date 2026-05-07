import { TeamId } from '@gmsim/engine/types';
import type { TeamIdentity } from '@gmsim/engine/types';
import { Conference, Division, MarketSize } from '@gmsim/engine/types';

/**
 * Static identity for the 32 NFL franchises. Real names are used because
 * GMSim is single-player and internal — see `docs/NORTH_STAR.md` for scope.
 *
 * Market-size classification per Personnel Generation doc requirement
 * (8 LARGE / 14 MEDIUM / 10 SMALL):
 *
 *   LARGE  (8): NYG NYJ LAR LAC CHI DAL PHI SF
 *   MEDIUM (14): HOU ATL WAS NE  ARI TB  DET SEA MIN MIA DEN CLE BAL PIT
 *   SMALL  (10): CAR IND JAX TEN KC  NO  CIN LV  BUF GB
 *
 * Classification is approximate (driven by combined TV market rank +
 * NFL pressure-market reputation). It is tunable; the design only
 * requires the count distribution match.
 */
export const NFL_TEAMS: readonly TeamIdentity[] = [
  // ─── AFC EAST ─────────────────────────────────────────────────────────────
  team('BUF', 'Buffalo', 'Bills', Conference.AFC, Division.AFC_EAST, MarketSize.SMALL),
  team('MIA', 'Miami', 'Dolphins', Conference.AFC, Division.AFC_EAST, MarketSize.MEDIUM),
  team('NE', 'New England', 'Patriots', Conference.AFC, Division.AFC_EAST, MarketSize.MEDIUM),
  team('NYJ', 'New York', 'Jets', Conference.AFC, Division.AFC_EAST, MarketSize.LARGE),

  // ─── AFC NORTH ────────────────────────────────────────────────────────────
  team('BAL', 'Baltimore', 'Ravens', Conference.AFC, Division.AFC_NORTH, MarketSize.MEDIUM),
  team('CIN', 'Cincinnati', 'Bengals', Conference.AFC, Division.AFC_NORTH, MarketSize.SMALL),
  team('CLE', 'Cleveland', 'Browns', Conference.AFC, Division.AFC_NORTH, MarketSize.MEDIUM),
  team('PIT', 'Pittsburgh', 'Steelers', Conference.AFC, Division.AFC_NORTH, MarketSize.MEDIUM),

  // ─── AFC SOUTH ────────────────────────────────────────────────────────────
  team('HOU', 'Houston', 'Texans', Conference.AFC, Division.AFC_SOUTH, MarketSize.MEDIUM),
  team('IND', 'Indianapolis', 'Colts', Conference.AFC, Division.AFC_SOUTH, MarketSize.SMALL),
  team('JAX', 'Jacksonville', 'Jaguars', Conference.AFC, Division.AFC_SOUTH, MarketSize.SMALL),
  team('TEN', 'Tennessee', 'Titans', Conference.AFC, Division.AFC_SOUTH, MarketSize.SMALL),

  // ─── AFC WEST ─────────────────────────────────────────────────────────────
  team('DEN', 'Denver', 'Broncos', Conference.AFC, Division.AFC_WEST, MarketSize.MEDIUM),
  team('KC', 'Kansas City', 'Chiefs', Conference.AFC, Division.AFC_WEST, MarketSize.SMALL),
  team('LV', 'Las Vegas', 'Raiders', Conference.AFC, Division.AFC_WEST, MarketSize.SMALL),
  team('LAC', 'Los Angeles', 'Chargers', Conference.AFC, Division.AFC_WEST, MarketSize.LARGE),

  // ─── NFC EAST ─────────────────────────────────────────────────────────────
  team('DAL', 'Dallas', 'Cowboys', Conference.NFC, Division.NFC_EAST, MarketSize.LARGE),
  team('NYG', 'New York', 'Giants', Conference.NFC, Division.NFC_EAST, MarketSize.LARGE),
  team('PHI', 'Philadelphia', 'Eagles', Conference.NFC, Division.NFC_EAST, MarketSize.LARGE),
  team('WAS', 'Washington', 'Commanders', Conference.NFC, Division.NFC_EAST, MarketSize.MEDIUM),

  // ─── NFC NORTH ────────────────────────────────────────────────────────────
  team('CHI', 'Chicago', 'Bears', Conference.NFC, Division.NFC_NORTH, MarketSize.LARGE),
  team('DET', 'Detroit', 'Lions', Conference.NFC, Division.NFC_NORTH, MarketSize.MEDIUM),
  team('GB', 'Green Bay', 'Packers', Conference.NFC, Division.NFC_NORTH, MarketSize.SMALL),
  team('MIN', 'Minnesota', 'Vikings', Conference.NFC, Division.NFC_NORTH, MarketSize.MEDIUM),

  // ─── NFC SOUTH ────────────────────────────────────────────────────────────
  team('ATL', 'Atlanta', 'Falcons', Conference.NFC, Division.NFC_SOUTH, MarketSize.MEDIUM),
  team('CAR', 'Carolina', 'Panthers', Conference.NFC, Division.NFC_SOUTH, MarketSize.SMALL),
  team('NO', 'New Orleans', 'Saints', Conference.NFC, Division.NFC_SOUTH, MarketSize.SMALL),
  team('TB', 'Tampa Bay', 'Buccaneers', Conference.NFC, Division.NFC_SOUTH, MarketSize.MEDIUM),

  // ─── NFC WEST ─────────────────────────────────────────────────────────────
  team('ARI', 'Arizona', 'Cardinals', Conference.NFC, Division.NFC_WEST, MarketSize.MEDIUM),
  team('LAR', 'Los Angeles', 'Rams', Conference.NFC, Division.NFC_WEST, MarketSize.LARGE),
  team('SF', 'San Francisco', '49ers', Conference.NFC, Division.NFC_WEST, MarketSize.LARGE),
  team('SEA', 'Seattle', 'Seahawks', Conference.NFC, Division.NFC_WEST, MarketSize.MEDIUM),
] as const;

function team(
  abbr: string,
  location: string,
  nickname: string,
  conference: Conference,
  division: Division,
  marketSize: MarketSize,
): TeamIdentity {
  return {
    id: TeamId(abbr),
    abbreviation: abbr,
    location,
    nickname,
    fullName: `${location} ${nickname}`,
    conference,
    division,
    marketSize,
  };
}

export function getTeamByAbbreviation(abbr: string): TeamIdentity | undefined {
  return NFL_TEAMS.find((t) => t.abbreviation === abbr);
}

export function getTeamsByDivision(division: Division): readonly TeamIdentity[] {
  return NFL_TEAMS.filter((t) => t.division === division);
}

export function getTeamsByConference(conference: Conference): readonly TeamIdentity[] {
  return NFL_TEAMS.filter((t) => t.conference === conference);
}
