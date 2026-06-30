import type { Position } from '../types/enums.js';
import type { PlayerArchetype, ArchetypeId } from './types.js';
import { PLAYER_ARCHETYPES } from './catalog.js';

export type { PlayerArchetype, ArchetypeId } from './types.js';
export { PLAYER_ARCHETYPES } from './catalog.js';
export { keySkillAverage } from './key-skill.js';

const BY_ID = new Map<ArchetypeId, PlayerArchetype>(
  PLAYER_ARCHETYPES.map((a) => [a.id, a]),
);

const BY_POSITION = new Map<Position, PlayerArchetype[]>();
for (const archetype of PLAYER_ARCHETYPES) {
  for (const position of archetype.positions) {
    const list = BY_POSITION.get(position);
    if (list) list.push(archetype);
    else BY_POSITION.set(position, [archetype]);
  }
}

/** Look up an archetype by its stable ID. Returns undefined if not found. */
export function getArchetypeById(id: ArchetypeId): PlayerArchetype | undefined {
  return BY_ID.get(id);
}

/** All archetypes valid for a given position. Empty array if none registered. */
export function getArchetypesForPosition(position: Position): readonly PlayerArchetype[] {
  return BY_POSITION.get(position) ?? [];
}
