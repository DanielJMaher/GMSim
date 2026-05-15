import type { Prng } from '../prng/index.js';
import type { Scout, PlayerObservation } from '../types/scout.js';
import type { Player, PlayerSkills } from '../types/player.js';
import type { TeamState } from '../types/team.js';
import type { TeamId } from '../types/ids.js';
import { composedQuirkEffect } from './quirks.js';

/** Number of players each scout assesses in the initial league sweep. */
const OBSERVATIONS_PER_SCOUT = 8;

/**
 * Base noise stdev (in raw 0..100 skill points) at zero accuracy.
 * Scaled by `(1 - scout.trueAccuracy[group])` — perfect scout (1.0)
 * has zero noise; floor-accuracy scout has full BASE_NOISE_STDEV.
 */
const BASE_NOISE_STDEV = 15;

const PLAYER_SKILL_KEYS: readonly (keyof PlayerSkills)[] = [
  'speed',
  'acceleration',
  'agility',
  'strength',
  'durability',
  'technicalSkill',
  'footballIq',
  'decisionMaking',
  'handsBallSkills',
  'blockingTechnique',
  'passRushTechnique',
  'coverageTechnique',
  'tacklingTechnique',
  'leadership',
  'competitiveness',
  'workEthic',
  'coachability',
  'composure',
];

/**
 * One-time league-creation sweep: every scout assesses some players
 * outside their own team in their known specialty group. Produces
 * attributed observations stored on `LeagueState.observations`.
 *
 * Only own-team-excluding players are observed because NFL scouts
 * evaluate other organizations' rosters, not their own (own-roster
 * eval is what coaches/practice are for). Per Doc 4.
 */
export function generateInitialObservations(
  prng: Prng,
  teams: Readonly<Record<TeamId, TeamState>>,
  scoutsByTeam: Readonly<Record<TeamId, readonly Scout[]>>,
  players: Readonly<Record<string, Player>>,
  observedOnTick: number,
): PlayerObservation[] {
  const observations: PlayerObservation[] = [];

  // Pre-bucket all rostered players by position group + team for fast
  // sampling — keys: `${PositionGroup}|${TeamId}`. The doc emphasizes
  // 32-team scale, so this needs to be O(1) per scout sample.
  const playersByGroupByTeam = bucketPlayers(teams, players);

  for (const teamId of Object.keys(teams) as TeamId[]) {
    const scouts = scoutsByTeam[teamId] ?? [];
    for (const scout of scouts) {
      const scoutPrng = prng.fork(`obs:${scout.id}`);
      const candidates = collectCandidates(
        playersByGroupByTeam,
        scout.knownSpecialty,
        teamId,
      );
      if (candidates.length === 0) continue;

      const targets = sampleWithoutReplacement(
        scoutPrng.fork('sample'),
        candidates,
        Math.min(OBSERVATIONS_PER_SCOUT, candidates.length),
      );

      for (const target of targets) {
        observations.push(
          generateObservation(scoutPrng.fork(`p:${target.id}`), scout, target, observedOnTick),
        );
      }
    }
  }

  return observations;
}

function generateObservation(
  prng: Prng,
  scout: Scout,
  player: Player,
  observedOnTick: number,
): PlayerObservation {
  const accuracy = scout.trueAccuracy[player.positionGroup] ?? 0.4;
  const skills: Partial<Record<keyof PlayerSkills, number>> = {};
  const confidence: Partial<Record<keyof PlayerSkills, number>> = {};

  for (const skill of PLAYER_SKILL_KEYS) {
    const trueValue = player.current[skill];
    const quirk = composedQuirkEffect(scout.quirks, player, skill);
    const noiseStdev = BASE_NOISE_STDEV * (1 - accuracy) * quirk.noiseMultiplier;
    const observed = clampSkill(trueValue + prng.normal(0, noiseStdev) + quirk.bias);
    const skillConfidence = clampUnit(accuracy + quirk.confidenceDelta);
    skills[skill] = Math.round(observed);
    confidence[skill] = Number(skillConfidence.toFixed(2));
  }

  return {
    scoutId: scout.id,
    playerId: player.id,
    observedOnTick,
    skills,
    confidence,
  };
}

function bucketPlayers(
  teams: Readonly<Record<TeamId, TeamState>>,
  players: Readonly<Record<string, Player>>,
): Map<string, Player[]> {
  const buckets = new Map<string, Player[]>();
  for (const [teamId, team] of Object.entries(teams) as [TeamId, TeamState][]) {
    for (const pid of team.rosterIds) {
      const player = players[pid];
      if (!player) continue;
      const key = `${player.positionGroup}|${teamId}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = [];
        buckets.set(key, bucket);
      }
      bucket.push(player);
    }
  }
  return buckets;
}

function collectCandidates(
  playersByGroupByTeam: Map<string, Player[]>,
  group: Player['positionGroup'],
  excludeTeamId: TeamId,
): Player[] {
  const out: Player[] = [];
  for (const [key, bucket] of playersByGroupByTeam) {
    const [g, tid] = key.split('|') as [string, string];
    if (g !== group) continue;
    if (tid === excludeTeamId) continue;
    out.push(...bucket);
  }
  return out;
}

function sampleWithoutReplacement<T>(prng: Prng, items: readonly T[], k: number): T[] {
  // Partial Fisher-Yates: shuffle just the prefix we'll return.
  const arr = [...items];
  const n = arr.length;
  const limit = Math.min(k, n);
  for (let i = 0; i < limit; i++) {
    const j = i + prng.nextInt(n - i);
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr.slice(0, limit);
}

function clampSkill(v: number): number {
  return Math.max(0, Math.min(100, v));
}

function clampUnit(v: number): number {
  return Math.max(0, Math.min(1, v));
}
