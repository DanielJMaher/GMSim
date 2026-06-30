import type { Prng } from '../prng/index.js';
import type { LeagueState } from '../types/league.js';
import type { Player, TalentGrade } from '../types/player.js';
import type { PlayerId, ContractId } from '../types/ids.js';
import { ageOfPlayer } from './development.js';
import { keySkillAverage } from '../archetypes/key-skill.js';

/**
 * Age-based retirement + low-skill free-agent washout. As of v0.37.0
 * (Doc 3 slice 5b) the in-place rookie-replacement step has been removed —
 * retirements only open roster slots. The draft event fills most of them;
 * `refillRosters` brings any sub-53 teams back from the FA market
 * afterwards.
 *
 * v0.93 adds a washout pass (`rollWashout`) so unsigned low-skill players
 * don't pile up in `league.players` forever — fringe/depth FAs who can't
 * catch on retire after a year or two instead of aging in limbo.
 */

/**
 * Probability that a player of `age` retires this offseason.
 *
 * Tuned so the league-wide population doesn't crater — across 32 teams ×
 * 53 players, the existing age distribution puts roughly 5% of players
 * in the 34+ band, so per-year retirement counts settle around 30–60
 * leaguewide once the player base stabilizes.
 */
export function retirementProbabilityForAge(age: number): number {
  if (age <= 33) return 0;
  if (age === 34) return 0.05;
  if (age === 35) return 0.15;
  if (age === 36) return 0.3;
  if (age === 37) return 0.5;
  if (age === 38) return 0.7;
  if (age === 39) return 0.9;
  return 1.0; // 40+
}

export function rollRetirement(prng: Prng, age: number): boolean {
  const p = retirementProbabilityForAge(age);
  if (p <= 0) return false;
  if (p >= 1) return true;
  return prng.next() < p;
}

/**
 * Decline-aware retirement probability (Living Careers S5). The age table
 * alone meant a cratered 31-year-old played until 34 no matter how far his
 * body had gone — real broken-down vets hang it up when the league tells
 * them they're done. Fringe/backup-tier vets get an added hazard from 29.
 */
export function retirementProbability(age: number, player: Player): number {
  let p = retirementProbabilityForAge(age);
  if (age >= 29 && (player.tier === 'FRINGE' || player.tier === 'BACKUP')) {
    p += age >= 32 ? 0.3 : 0.12;
  }
  return Math.min(1, p);
}

export function rollRetirementFor(prng: Prng, age: number, player: Player): boolean {
  const p = retirementProbability(age, player);
  if (p <= 0) return false;
  if (p >= 1) return true;
  return prng.next() < p;
}

/**
 * Low-skill free-agent **washout** (v0.93). Without this, unsigned
 * low-skill players accumulate in `league.players` indefinitely — they're
 * too young for age-retirement (<34) yet never good enough to be signed,
 * so the store balloons over a long sim. Real low-end players who can't
 * catch on hang it up after a year or two.
 *
 * Applies ONLY to free agents (no team) past rookie age whose tier marks
 * them as fringe/depth; starters and better never wash out (they get
 * signed or retire on the age curve). Because a player cut in an offseason
 * doesn't enter the FA pool until *after* that offseason's retirement
 * pass, every washout candidate gets at least one full year in the pool
 * first — so the effective horizon is "a year or two." Probabilities are
 * per-offseason; tune to taste.
 */
const WASHOUT_MIN_AGE = 23;
/**
 * Per-offseason washout odds, keyed by the 8-tier `talentGrade` (v0.130.1;
 * previously keyed by the coarse 4-tier `tier` — rates below preserve the
 * v0.93 effective behavior: 8-tier BACKUP/FRINGE rolled up to 4-tier FRINGE
 * at 0.6, WEAK_STARTER/ROTATIONAL rolled up to 4-tier BACKUP at 0.35).
 */
const WASHOUT_PROB_BY_TIER: Record<string, number> = {
  FRINGE: 0.6,
  BACKUP: 0.6,
  ROTATIONAL: 0.35,
  WEAK_STARTER: 0.35,
};

/**
 * Age floor for ANY unsigned vet (v0.130.1) — the fix for the measured
 * pool leak. Instrumented over 12 seasons: `league.players` grew
 * ~150/season, and the lingering cohort was almost entirely unsigned
 * STARTER/HIGH_STARTER-grade players (~1,600 of ~3,400 unsigned at season
 * 12, including ~530 aged 30–33) — starter-caliber surplus the rosters
 * can't absorb, exempt from the per-grade table and too young for the age
 * curve, idling for up to a decade. In the real NFL a vet who goes
 * unsigned for an entire season rarely returns — going unsigned a whole
 * year IS the signal, at any talent grade. Under 27 keeps the original
 * never-wash protection (recent draftees grinding on the fringe).
 */
function unsignedVetWashoutFloor(age: number): number {
  if (age >= 30) return 0.6;
  if (age >= 27) return 0.25;
  return 0;
}

/**
 * ABSOLUTE current-ability grade from the player's key-skill average — "can he
 * still play at NFL level?" Washout (and the broken-down-vet retirement hazard)
 * are absolute replacement-level judgments, NOT the relative/sticky
 * `talentGrade` (PFF model): a player can rank well at his position and still be
 * below NFL-roster caliber if the whole position is thin, and a just-cut star
 * keeps a high sticky grade for years. Without an absolute signal here, weak
 * free agents dodge washout and the FA pool grows unbounded. Thresholds are the
 * legacy key-skill-average cuts the washout rates were calibrated against.
 */
export function currentAbilityGrade(player: Player): TalentGrade {
  const ksa = keySkillAverage(player.current, player.archetype);
  if (ksa >= 86) return 'ELITE';
  if (ksa >= 80) return 'STAR';
  if (ksa >= 75) return 'HIGH_STARTER';
  if (ksa >= 70) return 'STARTER';
  if (ksa >= 65) return 'WEAK_STARTER';
  if (ksa >= 60) return 'ROTATIONAL';
  if (ksa >= 54) return 'BACKUP';
  return 'FRINGE';
}

export function rollWashout(
  prng: Prng,
  grade: string,
  age: number,
  isFreeAgent: boolean,
): boolean {
  if (!isFreeAgent || age < WASHOUT_MIN_AGE) return false;
  const p = Math.max(WASHOUT_PROB_BY_TIER[grade] ?? 0, unsignedVetWashoutFloor(age));
  if (p <= 0) return false;
  return prng.next() < p;
}

export interface RetirementOutcome {
  /** New rosterIds per team (retirees REMOVED, no replacements). */
  rosterIdsByTeam: Map<string, readonly PlayerId[]>;
  /** Player IDs removed from the league. */
  retiredPlayerIds: readonly PlayerId[];
  /** Contract IDs to drop (the retirees' contracts). */
  dropContractIds: readonly ContractId[];
}

/**
 * Process retirement across all 32 teams. Retirees are filtered out of
 * team rosters; no replacement rookies are generated. As of v0.37.0
 * (Doc 3 slice 5b) the draft event is responsible for filling vacated
 * slots — `processRetirements` only opens them. Anything still under
 * 53 after the draft gets backfilled by `refillRosters` from the FA
 * market.
 *
 * Caller is responsible for merging the outcome into the next
 * LeagueState (drop retired entries from `players`/`contracts`, swap
 * teams' rosterIds).
 */
export function processRetirements(
  prng: Prng,
  league: LeagueState,
  nextSeasonNumber: number,
  _nextTick: number,
): RetirementOutcome {
  const rosterIdsByTeam = new Map<string, readonly PlayerId[]>();
  const retiredPlayerIds: PlayerId[] = [];
  const dropContractIds: ContractId[] = [];
  const retiredSet = new Set<string>();

  // ─── Active roster: retire (no replacement) ──────────────────────────
  for (const team of Object.values(league.teams)) {
    const teamPrng = prng.fork(`team:${team.identity.id}`);
    const newRoster: PlayerId[] = [];

    for (const playerId of team.rosterIds) {
      const player = league.players[playerId]!;
      // Use the upcoming season's age (player will be one year older
      // post-advance), so a 33→34 transition retires correctly. S5:
      // decline-aware — broken-down vets exit before the age table alone
      // would let them.
      const ageNext = ageOfPlayer(player, nextSeasonNumber);
      const retires = rollRetirementFor(teamPrng.fork(`retire:${playerId}`), ageNext, player);

      if (retires) {
        retiredPlayerIds.push(playerId);
        retiredSet.add(playerId);
        if (player.contractId) dropContractIds.push(player.contractId);
      } else {
        newRoster.push(playerId);
      }
    }

    rosterIdsByTeam.set(team.identity.id, newRoster);
  }

  // ─── Non-rostered retirees: PS + free agents retire too. Without this
  //     pass, aged-out PS players and unsigned FAs would accumulate in
  //     `league.players` past age 40.
  const offRosterPrng = prng.fork('off-roster');
  for (const player of Object.values(league.players)) {
    if (retiredSet.has(player.id)) continue;
    // Skip players still on an active roster — already covered above.
    if (player.teamId !== null && league.teams[player.teamId]?.rosterIds.includes(player.id)) {
      continue;
    }
    const ageNext = ageOfPlayer(player, nextSeasonNumber);
    const isFreeAgent = player.teamId === null;
    const retires =
      rollRetirementFor(offRosterPrng.fork(`retire:${player.id}`), ageNext, player) ||
      rollWashout(
        offRosterPrng.fork(`washout:${player.id}`),
        // ABSOLUTE current-ability grade, not the relative/sticky `talentGrade`
        // (PFF model): washout is a "below NFL caliber" judgment, and a sticky
        // grade would let a just-cut player dodge washout for years (FA pool
        // then grows unbounded). See `currentAbilityGrade`.
        currentAbilityGrade(player),
        ageNext,
        isFreeAgent,
      );
    if (retires) {
      retiredPlayerIds.push(player.id);
      retiredSet.add(player.id);
      if (player.contractId) dropContractIds.push(player.contractId);
    }
  }

  return {
    rosterIdsByTeam,
    retiredPlayerIds,
    dropContractIds,
  };
}
