import type { Prng } from '../prng/index.js';
import type { TeamIdentity } from '../types/team.js';
import type { FranchiseHistory } from '../types/enums.js';
import type {
  Owner,
  Gm,
  HeadCoach,
  TeamPersonality,
  FanBaseProfile,
} from '../types/personnel.js';
import { generateOwner } from './owner.js';
import { generateGm } from './gm.js';
import { generateHeadCoach } from './hc.js';
import { generateFanBase } from './fan-base.js';
import { computeTeamPersonality } from './team-personality.js';

export interface TeamPersonnelBundle {
  owner: Owner;
  gm: Gm;
  headCoach: HeadCoach;
  fanBase: FanBaseProfile;
  teamPersonality: TeamPersonality;
}

/**
 * Generate the full personnel bundle for a single team:
 *   owner → GM (owner-influenced) → HC (owner+GM-influenced) →
 *   fan base (market+history) → team personality (50/20/20/10 blend)
 *
 * Each generation step takes a child PRNG forked from the team-level
 * stream so that adding new sub-systems later (e.g. position coaches)
 * doesn't shift previously-generated data for the same seed.
 *
 * @param teamPrng     Per-team forked PRNG. Pass the result of
 *                     `leaguePrng.fork(\`team:${abbr}\`)`.
 * @param identity     Team identity from @gmsim/data.
 * @param franchiseHistory  Pre-rolled franchise history archetype.
 *                          (Rolled at the league level so each
 *                          archetype can appear at most once if we
 *                          want — caller's choice.)
 */
export function generateTeamPersonnel(
  teamPrng: Prng,
  identity: TeamIdentity,
  franchiseHistory: FranchiseHistory,
): TeamPersonnelBundle {
  const idSeed = identity.abbreviation;
  const owner = generateOwner(teamPrng.fork('owner'), idSeed);
  const gm = generateGm(teamPrng.fork('gm'), idSeed, owner);
  const headCoach = generateHeadCoach(teamPrng.fork('hc'), idSeed, owner, gm);
  const fanBase = generateFanBase(teamPrng.fork('fan-base'), identity.marketSize, franchiseHistory);
  const teamPersonality = computeTeamPersonality(owner, gm, headCoach, fanBase);

  return { owner, gm, headCoach, fanBase, teamPersonality };
}
