import type { TeamId, OwnerId, GmId, CoachId, PlayerId } from './ids.js';
import type { Conference, Division, MarketSize, FranchiseHistory, CompetitiveWindow } from './enums.js';
import type { FanBaseProfile } from './personnel.js';

/**
 * Base team identity — the immutable parts of a franchise (city, division,
 * conference, market size). These come from `packages/data/src/team-base`.
 *
 * Real NFL team names are used because GMSim is single-player and internal
 * (per project scope). If distribution ever expands, this is the layer that
 * needs to switch to fictional naming.
 */
export interface TeamIdentity {
  id: TeamId;
  /** Three-letter NFL abbreviation, e.g. 'KC', 'PHI', 'NYG'. */
  abbreviation: string;
  /** City or region, e.g. 'Kansas City', 'New England'. */
  location: string;
  /** Nickname, e.g. 'Chiefs', 'Patriots'. */
  nickname: string;
  /** Full name, e.g. 'Kansas City Chiefs'. Convenience field; equals `${location} ${nickname}`. */
  fullName: string;
  conference: Conference;
  division: Division;
  /** Per Personnel Generation doc: 8 LARGE, 14 MEDIUM, 10 SMALL. Drives fan-base baseline. */
  marketSize: MarketSize;
}

/**
 * Per-game-instance team state. Generated fresh at league creation and
 * mutated throughout the simulation. Personnel (owner/gm/hc), roster,
 * scheme, and modifiers come together here.
 *
 * Note: this is the **ground truth** record. The UI must not read this
 * directly — it must read from the knowledge layer. See docs/NORTH_STAR.md.
 */
export interface TeamState {
  identity: TeamIdentity;
  ownerId: OwnerId;
  gmId: GmId;
  headCoachId: CoachId;
  /** Current 53-man active roster. Practice squad and reserve lists tracked separately. */
  rosterIds: readonly PlayerId[];
  /** Procedurally generated franchise history archetype. Affects fan baseline. */
  franchiseHistory: FranchiseHistory;
  /** Per-team fan-base profile. Evolves slowly with results. Feeds Team Personality. */
  fanBase: FanBaseProfile;
  /** Current competitive window state. Updated by Dynasty Cycles module each offseason. */
  competitiveWindow: CompetitiveWindow;
  /** Year-end win-loss across all simulated seasons; indexed by season number from league start. */
  seasonHistory: readonly TeamSeasonRecord[];
}

export interface TeamSeasonRecord {
  seasonNumber: number;
  wins: number;
  losses: number;
  ties: number;
  divisionFinish: number;
  madePlayoffs: boolean;
  championshipResult?: 'won_super_bowl' | 'lost_super_bowl' | 'lost_conference' | 'lost_divisional' | 'lost_wildcard';
}
