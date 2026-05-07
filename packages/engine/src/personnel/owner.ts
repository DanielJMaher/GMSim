import { OwnerId } from '../types/ids.js';
import type { Owner, OwnerSpectrums } from '../types/personnel.js';
import type { Prng } from '../prng/index.js';
import { OWNER_ARCHETYPES, type Archetype } from './archetypes/index.js';
import { rollSpectrumsForArchetype } from './spectrums.js';
import { OWNER_QUIRK_POOL, pickQuirks } from './quirks.js';
import { rollPersonalityTraits } from './traits.js';
import { generateName } from './name-generator.js';

const OWNER_SPECTRUM_KEYS: readonly (keyof OwnerSpectrums)[] = [
  'involvement',
  'patience',
  'financialCommitment',
  'footballKnowledge',
  'legacyMotivation',
  'fanConnection',
  'riskTolerance',
  'ego',
];

/**
 * Generate an Owner.
 *
 * Sampling: an owner archetype is drawn uniformly from `OWNER_ARCHETYPES`,
 * unless the caller supplies one. Owner generation has no hiring-tendency
 * input — owners aren't hired, they own.
 *
 * @param idSeed  String fragment that becomes part of the OwnerId.
 *                Typically the team abbreviation so IDs are stable
 *                and human-readable in saves/logs.
 */
export function generateOwner(
  prng: Prng,
  idSeed: string,
  archetype?: Archetype<keyof OwnerSpectrums>,
): Owner {
  const chosen = archetype ?? prng.pick(OWNER_ARCHETYPES);
  const spectrums = rollSpectrumsForArchetype(prng, chosen, OWNER_SPECTRUM_KEYS) as OwnerSpectrums;
  const quirks = pickQuirks(prng, OWNER_QUIRK_POOL);
  const personality = rollPersonalityTraits(prng);
  const name = generateName(prng);

  return {
    id: OwnerId(`OWNER_${idSeed}`),
    name: name.fullName,
    spectrums,
    quirks,
    personality,
  };
}
