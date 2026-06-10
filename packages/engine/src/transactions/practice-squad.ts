import type { LeagueState } from '../types/league.js';
import type { Player } from '../types/player.js';
import type { Contract } from '../types/contract.js';
import type { TeamState } from '../types/team.js';
import type {
  PlayerId,
  TeamId,
  ContractId as ContractIdType,
} from '../types/ids.js';
import { ContractId } from '../types/ids.js';
import type { Position } from '../types/enums.js';
import type { Prng } from '../prng/index.js';
import { generatePlayer } from '../players/generate.js';
import { positionGroupFor } from '../players/position-group.js';
import { ROSTER_BLUEPRINT_53 } from '../players/roster-blueprint.js';
import { PositionGroup } from '../types/enums.js';
import { keySkillAverage } from '../archetypes/key-skill.js';
import {
  PRACTICE_SQUAD_SALARY,
  PRACTICE_SQUAD_SIZE,
} from '../contracts/constants.js';

/**
 * Top each team's practice squad up to PRACTICE_SQUAD_SIZE on 1-year
 * PS-minimum contracts. Existing PS members are preserved.
 *
 * Living Careers S2: squads sign REAL unsigned young free agents first —
 * this year's UDFAs and bounced young fringe (experience <= 2), best
 * key-skill composite per position first. Before this, every PS slot was
 * filled by a freshly *generated* rookie: ~440 invented 21-22-year-olds
 * entered the league each offseason — more than the entire real draft +
 * UDFA cohort — pinning the league's entry-age mix far too young no matter
 * what the college pipeline produced (the Actuary's entry-age gate caught
 * it). Generation remains only as the league-creation bootstrap (no FA
 * pool exists yet) and a last-resort fallback when no eligible FA plays
 * the slot's position.
 *
 * Position selection is weighted by ROSTER_BLUEPRINT_53 so PS allocation
 * mirrors active-roster shape.
 *
 * Determinism: a single Prng is forked per (team, slot) so adding teams
 * later in the season without changing earlier ones produces stable IDs;
 * the FA candidate ranking is a pure sort.
 */
export function refillPracticeSquad(
  prng: Prng,
  league: LeagueState,
  signedOnTick: number,
  seasonNumber: number,
): LeagueState {
  const positionPool = buildWeightedPositionPool();

  // Eligible candidates: unsigned, contract-free, PS-aged. Real-NFL PS
  // eligibility is ~2 accrued seasons + exceptions; GMSim's
  // `experienceYears` ticks on every dev pass (not accrued seasons), so
  // <= 3 is the fair mapping — it keeps the young-fringe layer recycling
  // through squads for ~3 cycles the way real PS journeymen do.
  const candidatesByPosition = new Map<Position, Player[]>();
  for (const p of Object.values(league.players)) {
    if (p.teamId !== null || p.contractId !== null) continue;
    if (p.experienceYears > 3) continue;
    const arr = candidatesByPosition.get(p.position) ?? [];
    arr.push(p);
    candidatesByPosition.set(p.position, arr);
  }
  for (const arr of candidatesByPosition.values()) {
    arr.sort(
      (a, b) =>
        keySkillAverage(b.current, b.archetype) - keySkillAverage(a.current, a.archetype) ||
        (a.id < b.id ? -1 : 1),
    );
  }

  const playersNext: Record<string, Player> = { ...league.players };
  const contractsNext: Record<string, Contract> = { ...league.contracts };
  const teamsNext: Record<string, TeamState> = { ...league.teams };
  let counter = 0;

  for (const team of Object.values(league.teams)) {
    const need = PRACTICE_SQUAD_SIZE - team.practiceSquadIds.length;
    if (need <= 0) continue;

    const teamPrng = prng.fork(`team:${team.identity.id}`);
    const newPsIds: PlayerId[] = [];

    for (let slot = 0; slot < need; slot++) {
      const slotPrng = teamPrng.fork(`slot:${slot}`);
      const position = slotPrng.pick(positionPool);
      const idSuffix = `${team.identity.abbreviation}_PS${seasonNumber}_${counter++}`;

      // Exact-position candidate first; otherwise the deepest remaining
      // position pool (real squads sign whoever's around rather than
      // conjuring a body at the blueprint position); generate only when
      // the whole eligible pool is dry.
      let fromPool = candidatesByPosition.get(position)?.shift();
      if (!fromPool) {
        let deepest: Player[] | undefined;
        for (const arr of candidatesByPosition.values()) {
          if (arr.length > (deepest?.length ?? 0)) deepest = arr;
        }
        fromPool = deepest?.shift();
      }
      let finalPlayer: Player;
      let contract: Contract;
      if (fromPool) {
        contract = makePracticeSquadContract(fromPool, team.identity.id, idSuffix, signedOnTick);
        finalPlayer = { ...fromPool, teamId: team.identity.id, contractId: contract.id };
      } else {
        // Emergency fill = a 23-24-year-old street journeyman (DEVELOPING,
        // experience 1-2), NOT a fake rookie — invented bodies must never
        // masquerade as draft-class entrants (the Actuary's entry-age gate).
        const generated = generatePlayer(slotPrng.fork('gen'), {
          position,
          idSuffix,
          forceAgeStage: 'DEVELOPING',
          simYear: 2026 + (seasonNumber - 1),
          schemeContext: schemeContextFor(team, league, position),
        });
        const player: Player = {
          ...generated,
          teamId: team.identity.id,
        };
        contract = makePracticeSquadContract(player, team.identity.id, idSuffix, signedOnTick);
        finalPlayer = { ...player, contractId: contract.id };
      }

      playersNext[finalPlayer.id] = finalPlayer;
      contractsNext[contract.id] = contract;
      newPsIds.push(finalPlayer.id);
    }

    teamsNext[team.identity.id] = {
      ...team,
      practiceSquadIds: [...team.practiceSquadIds, ...newPsIds],
    };
  }

  return {
    ...league,
    teams: teamsNext as Readonly<Record<TeamId, TeamState>>,
    players: playersNext as Readonly<Record<PlayerId, Player>>,
    contracts: contractsNext as Readonly<Record<ContractIdType, Contract>>,
  };
}

/**
 * Build a weighted position list from ROSTER_BLUEPRINT_53. Each entry
 * appears proportional to its blueprint count; `prng.pick` then samples
 * uniformly across the array, yielding the desired weighted distribution.
 */
function buildWeightedPositionPool(): readonly Position[] {
  const pool: Position[] = [];
  for (const slot of ROSTER_BLUEPRINT_53) {
    for (let i = 0; i < slot.count; i++) pool.push(slot.position);
  }
  return pool;
}

function schemeContextFor(team: TeamState, league: LeagueState, position: Position) {
  const hc = league.coaches[team.headCoachId]!;
  const group = positionGroupFor(position);
  let side: 'OFFENSE' | 'DEFENSE' | 'SPECIAL_TEAMS';
  switch (group) {
    case PositionGroup.QB:
    case PositionGroup.SKILL:
    case PositionGroup.OL:
      side = 'OFFENSE';
      break;
    case PositionGroup.DL:
    case PositionGroup.LB:
    case PositionGroup.DB:
      side = 'DEFENSE';
      break;
    case PositionGroup.ST:
      side = 'SPECIAL_TEAMS';
      break;
  }
  return {
    side,
    offensiveScheme: hc.offensiveScheme,
    defensiveScheme: hc.defensiveScheme,
  };
}

/**
 * Build a 1-year practice-squad contract at PRACTICE_SQUAD_SALARY. No
 * signing bonus, no guarantees, no clauses — the simplest possible deal.
 * PS contracts sit in `league.contracts` like any other contract but are
 * not counted toward `teamCapUsage` (which iterates `rosterIds`).
 */
export function makePracticeSquadContract(
  player: Player,
  teamId: TeamId,
  idSuffix: string,
  signedOnTick: number,
): Contract {
  return {
    id: ContractId(`C_${idSuffix}`),
    playerId: player.id,
    teamId,
    signedOnTick,
    realYears: 1,
    voidYears: 0,
    yearsRemaining: 1,
    baseSalaries: [PRACTICE_SQUAD_SALARY],
    signingBonus: 0,
    rosterBonuses: [0],
    workoutBonuses: [0],
    guarantees: [{ baseGuaranteedPct: 0, type: 'NONE' }],
    incentives: [],
    noTradeClause: false,
  };
}
