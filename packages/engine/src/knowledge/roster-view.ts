/**
 * `rosterView` — the D2b "coach's card" (GAME_UI_FOUNDATION.md §2, RULED
 * 2026-07-10).
 *
 * This is the vision-central half of the knowledge boundary. Standings are
 * public facts that merely pass through (`league-view.ts`); a player's QUALITY
 * is hidden truth, and this file is where the engine decides how much of it a
 * given club can honestly claim to know.
 *
 * **Daniel's governing principle: knowledge scales with EXPOSURE.**
 *
 *     your own veterans  >  your own young players
 *                        >  other teams' veterans
 *                        >  other teams' young players
 *
 * Your own veteran has been in your building for years of practice tape; a
 * rival's rookie you have seen on film a handful of times. `exposureOf` below
 * reproduces that ordering as a strict inequality, and `roster-view.test.ts`
 * gates it — if a future edit lets a rival's rookie read as well-known as your
 * own ten-year captain, the suite fails.
 *
 * What crosses the boundary:
 *   - a LETTER grade from the coaching staff, never a number. The real
 *     `keySkillAverage` is perturbed by an exposure-scaled error and then
 *     banded; the number is destroyed at the band, not merely hidden behind
 *     one. ("A React prop typed as `{ speed: 88 }` is broken by definition.")
 *   - a qualitative confidence label, sharing `snapshot.ts`'s vocabulary so
 *     the whole knowledge layer speaks one dialect of certainty.
 *   - strengths/concerns as prose phrases, drawn from the archetype's KEY
 *     skills (the ones that actually define the position) and perceived
 *     through the same error.
 *
 * What does not: `current`/`ceiling` skills, `talentScore`, `talentGrade`,
 * `tier`, `developmentArchetype`, mood internals, conditioning. None of these
 * appear on the view types, so a UI cannot render them by accident.
 *
 * **The card is STABLE.** D2b calls for "a stable qualitative card", so the
 * perception error must not be redrawn on every render. It comes from a Prng
 * seeded on (league seed, viewer, player) — deterministic, reproducible from a
 * save, and identical across repeated calls. Per CLAUDE.md invariant #2 this
 * routes through `prng/`; `Math.random()` would make the card flicker and
 * break save reproducibility at the same time.
 */

import type { LeagueState } from '../types/league.js';
import type { PlayerId, TeamId } from '../types/ids.js';
import type { Player, PlayerSkills } from '../types/player.js';
import type { Position, PositionGroup } from '../types/enums.js';
import type { TalentGrade } from '../types/player.js';
import { Prng } from '../prng/index.js';
import { keySkillAverage } from '../archetypes/key-skill.js';
import { getArchetypeById } from '../archetypes/index.js';
import { gradeFromOverall } from '../players/skills.js';
import { ageOfPlayer } from '../season/development.js';
import { confidenceLabel, type ConfidenceLabel } from './snapshot.js';
import type { TeamIdentityView } from './league-view.js';

/** The coaching staff's letter band. The only quality signal that crosses. */
export type CoachLetterGrade = 'A+' | 'A' | 'B+' | 'B' | 'C+' | 'C' | 'D' | 'F';

/**
 * One letter per engine grade band, so the numeric thresholds live in exactly
 * one place (`gradeFromOverall`) and this file cannot drift from them.
 */
const LETTER_BY_GRADE: Record<TalentGrade, CoachLetterGrade> = {
  ELITE: 'A+',
  STAR: 'A',
  HIGH_STARTER: 'B+',
  STARTER: 'B',
  WEAK_STARTER: 'C+',
  ROTATIONAL: 'C',
  BACKUP: 'D',
  FRINGE: 'F',
};

/** Which of D2b's four exposure tiers this read comes from. */
export type ExposureTier = 'own-veteran' | 'own-young' | 'other-veteran' | 'other-young';

/** Service years at or above which a player counts as a veteran for exposure. */
export const VETERAN_SERVICE_YEARS = 4;

/**
 * Exposure weights. Own-roster membership is the dominant term (you practise
 * against him daily); league service adds tape that everyone can see; tenure
 * with the club adds the private tape only his own building has.
 *
 * The numbers are chosen so D2b's four-tier ordering holds at the extremes:
 * own veteran 1.00 > own rookie 0.55 > rival veteran 0.45 > rival rookie 0.20.
 */
const EXPOSURE_OWN_BASE = 0.55;
const EXPOSURE_OTHER_BASE = 0.2;
const EXPOSURE_SERVICE_MAX = 0.25;
const EXPOSURE_SERVICE_SATURATION_YEARS = 6;
const EXPOSURE_TENURE_MAX = 0.2;
const EXPOSURE_TENURE_SATURATION_YEARS = 4;

/**
 * Widest perception error, in overall points, at zero exposure. At full
 * exposure the error is zero — your own long-tenured veteran reads true,
 * which is exactly D2b's "honest-but-coarse... rarely wrong for veterans".
 * Coarseness for those players comes from the LETTER BANDING, not from noise.
 */
const MAX_PERCEPTION_ERROR_SD = 9;

/**
 * The perception error splits into a SHARED bias and per-skill noise, by
 * variance: 60% bias, 40% idiosyncratic (the two weights sum to 1, so total
 * per-skill error still has sd `MAX_PERCEPTION_ERROR_SD` at zero exposure).
 *
 * The split exists to keep the card internally COHERENT. Drawing the overall
 * grade independently of the per-skill reads let a rival's card come back
 * graded B+ with an empty strengths list and every defining skill filed as a
 * concern — two unrelated draws describing the same man. With a shared bias the
 * overall is literally the mean of the perceived key skills, so grade and prose
 * can never contradict each other, and the bias term is what a scout's read
 * actually looks like: he is high or low on the guy as a whole, then noisy
 * about the details.
 */
const PERCEPTION_BIAS_VARIANCE_SHARE = 0.6;

/**
 * `league.tick` is weeks since league epoch and advances a FULL CALENDAR YEAR
 * per league year — verified against `dist`: createLeague → 0, then 52, 104.
 * It is emphatically NOT the 18-week regular season; dividing by 18 overstates
 * tenure by ~2.9× and saturates the tenure term in ~1.4 real years.
 */
const TICKS_PER_LEAGUE_YEAR = 52;

/** Tenure with the current club, in seasons, from the active contract.
 *
 * Caveat worth stating rather than hiding: an extension re-stamps
 * `signedOnTick`, so a re-signed veteran's tenure reads low until the new deal
 * ages. This is a FLOOR on true tenure, never an overstatement — it can make
 * the club know a player slightly less well than it should, never more. The
 * safe direction for a knowledge boundary to err. (That argument only holds
 * with the correct divisor above; with the wrong one the error ran the other
 * way, which is precisely why the constant carries its own provenance note.) */
function tenureSeasons(league: LeagueState, player: Player): number {
  if (!player.contractId) return 0;
  const contract = league.contracts[player.contractId];
  if (!contract) return 0;
  const weeks = league.tick - contract.signedOnTick;
  if (weeks <= 0) return 0;
  return weeks / TICKS_PER_LEAGUE_YEAR;
}

/**
 * How well the viewing club knows this player, 0..1. See the file header for
 * the principle; `roster-view.test.ts` gates the tier ordering.
 */
export function exposureOf(league: LeagueState, viewerTeamId: TeamId, player: Player): number {
  const own = player.teamId === viewerTeamId;
  const base = own ? EXPOSURE_OWN_BASE : EXPOSURE_OTHER_BASE;

  const service =
    Math.min(player.experienceYears, EXPOSURE_SERVICE_SATURATION_YEARS) /
    EXPOSURE_SERVICE_SATURATION_YEARS;

  const tenure = own
    ? Math.min(tenureSeasons(league, player), EXPOSURE_TENURE_SATURATION_YEARS) /
      EXPOSURE_TENURE_SATURATION_YEARS
    : 0;

  const raw = base + service * EXPOSURE_SERVICE_MAX + tenure * EXPOSURE_TENURE_MAX;
  return Math.max(0, Math.min(1, raw));
}

function exposureTier(viewerTeamId: TeamId, player: Player): ExposureTier {
  const own = player.teamId === viewerTeamId;
  const vet = player.experienceYears >= VETERAN_SERVICE_YEARS;
  if (own) return vet ? 'own-veteran' : 'own-young';
  return vet ? 'other-veteran' : 'other-young';
}

/**
 * A stable per-(viewer, player) Prng. Seeded on the league seed so the same
 * save always produces the same card, and on both ids so two clubs hold
 * genuinely different reads on the same man — the information asymmetry the
 * North Star is built around.
 */
function perceptionPrng(league: LeagueState, viewerTeamId: TeamId, playerId: PlayerId): Prng {
  return new Prng(`${league.seed}::roster-view::${String(viewerTeamId)}::${String(playerId)}`);
}

/** Skill keys the archetype actually weights — what a coach would talk about. */
function keySkillsOf(player: Player): readonly (keyof PlayerSkills)[] {
  const archetype = getArchetypeById(player.archetype);
  if (!archetype) return ['technicalSkill', 'footballIq', 'speed'];
  const keys = Object.entries(archetype.skillWeights)
    .filter(([, w]) => (w ?? 1) >= 1.2)
    .map(([k]) => k as keyof PlayerSkills);
  return keys.length > 0 ? keys : ['technicalSkill', 'footballIq', 'speed'];
}

/**
 * Readable phrase for a skill key, derived from the key itself.
 *
 * Deliberately NOT an exhaustive `Record<keyof PlayerSkills, string>` like the
 * inspector's `SKILL_LABELS`. That shape has a standing failure mode in this
 * repo: adding a skill to `PlayerSkills` breaks every exhaustive map, and the
 * W5 `specialTeams` addition did exactly that to the web build. Deriving the
 * phrase means a new skill is describable the moment it exists, with an
 * override only where camelCase reads badly.
 */
const PHRASE_OVERRIDES: Readonly<Record<string, string>> = {
  footballIq: 'football IQ',
  handsBallSkills: 'hands and ball skills',
  ballCarrierVision: 'vision as a ball carrier',
  changeOfDirection: 'change of direction',
  releaseVsPress: 'release against press',
  releaseVsOff: 'release against off coverage',
  throwOnRun: 'throwing on the run',
  throwUnderPressure: 'throwing under pressure',
  breakSack: 'escaping sacks',
  specialTeams: 'special-teams craft',
};

export function skillPhrase(key: keyof PlayerSkills): string {
  const override = PHRASE_OVERRIDES[key as string];
  if (override) return override;
  return String(key)
    .replace(/([A-Z])/g, ' $1')
    .toLowerCase()
    .trim();
}

/** Qualifier for a perceived skill level. Words, never numbers. */
function levelPhrase(value: number): string {
  if (value >= 88) return 'elite';
  if (value >= 80) return 'plus';
  if (value >= 72) return 'solid';
  if (value >= 63) return 'adequate';
  if (value >= 55) return 'below-average';
  return 'a real liability in';
}

/** What a game UI may know about one player on one roster. */
export interface RosterPlayerView {
  playerId: PlayerId;
  firstName: string;
  lastName: string;
  position: Position;
  positionGroup: PositionGroup;
  ageYears: number;
  experienceYears: number;
  /** Public: injury reports are league-mandated public information. */
  injury: { type: string; severity: 'MINOR' | 'MODERATE' | 'MAJOR'; weeksOut: number } | null;
  /** The coaching staff's band. Perceived, exposure-scaled, never numeric. */
  grade: CoachLetterGrade;
  /** How firmly the staff holds that read. */
  confidence: ConfidenceLabel;
  /** Which of D2b's four tiers this read comes from. */
  exposureTier: ExposureTier;
  /** Qualitative strengths, strongest first. */
  strengths: readonly string[];
  /** Qualitative concerns, most serious first. */
  concerns: readonly string[];
  /** Byline — whose read this is. */
  sourceLabel: string;
}

export interface RosterView {
  team: TeamIdentityView;
  /** True when the viewer is looking at their own building. */
  isOwnRoster: boolean;
  players: readonly RosterPlayerView[];
}

function identityViewOf(league: LeagueState, teamId: TeamId): TeamIdentityView | null {
  const team = league.teams[teamId];
  if (!team) return null;
  const id = team.identity;
  return {
    teamId: id.id,
    abbreviation: id.abbreviation,
    location: id.location,
    nickname: id.nickname,
    fullName: id.fullName,
    conference: id.conference,
    division: id.division,
  };
}

/**
 * The coach's card for one player, as one club sees him. Exported so the
 * future trade-target surface can price a rival's player through exactly this
 * machinery — D2b's stated reason for deriving confidence from exposure in the
 * first place ("the same machinery later prices trade targets").
 */
export function playerCard(
  league: LeagueState,
  viewerTeamId: TeamId,
  player: Player,
): RosterPlayerView {
  const exposure = exposureOf(league, viewerTeamId, player);
  const prng = perceptionPrng(league, viewerTeamId, player.id);
  const errorSd = MAX_PERCEPTION_ERROR_SD * (1 - exposure);

  // One shared bias for the whole read, then per-skill noise around it. See
  // PERCEPTION_BIAS_VARIANCE_SHARE — this is what keeps grade and prose from
  // describing two different players.
  const biasSd = errorSd * Math.sqrt(PERCEPTION_BIAS_VARIANCE_SHARE);
  const skillSd = errorSd * Math.sqrt(1 - PERCEPTION_BIAS_VARIANCE_SHARE);
  const bias = errorSd <= 0 ? 0 : prng.normal(0, biasSd);

  const perceive = (trueValue: number): number => {
    if (errorSd <= 0) return trueValue;
    const raw = prng.normal(trueValue + bias, skillSd);
    return Math.max(0, Math.min(100, raw));
  };

  const perceivedKeys = keySkillsOf(player)
    .map((key) => ({ key, value: perceive(player.current[key]) }))
    .sort((a, b) => b.value - a.value);

  // The overall IS the mean of the perceived key skills — the same construction
  // `keySkillAverage` uses on the true values — so the letter grade and the
  // strengths/concerns prose are two views of one read, never two draws.
  const perceivedOverall =
    perceivedKeys.length > 0
      ? perceivedKeys.reduce((s, k) => s + k.value, 0) / perceivedKeys.length
      : keySkillAverage(player.current, player.archetype);

  const strengths = perceivedKeys
    .filter((k) => k.value >= 72)
    .slice(0, 3)
    .map((k) => `${levelPhrase(k.value)} ${skillPhrase(k.key)}`);

  const concerns = perceivedKeys
    .filter((k) => k.value < 63)
    .slice(-3)
    .reverse()
    .map((k) => `${levelPhrase(k.value)} ${skillPhrase(k.key)}`);

  const own = player.teamId === viewerTeamId;

  return {
    playerId: player.id,
    firstName: player.firstName,
    lastName: player.lastName,
    position: player.position,
    positionGroup: player.positionGroup,
    ageYears: ageOfPlayer(player, league.seasonNumber),
    experienceYears: player.experienceYears,
    injury: player.injury
      ? {
          type: player.injury.type,
          severity: player.injury.severity,
          weeksOut: Math.max(0, player.injury.estimatedReturnTick - league.tick),
        }
      : null,
    grade: LETTER_BY_GRADE[gradeFromOverall(perceivedOverall)],
    confidence: confidenceLabel(exposure),
    exposureTier: exposureTier(viewerTeamId, player),
    strengths,
    concerns,
    sourceLabel: own ? 'Coaching staff' : 'Pro personnel department',
  };
}

/**
 * One club's roster as another club knows it. `viewerTeamId === subjectTeamId`
 * is the player's own roster screen; a different subject is the scouting view
 * of a rival, and reads measurably foggier by construction.
 */
export function rosterView(
  league: LeagueState,
  viewerTeamId: TeamId,
  subjectTeamId: TeamId,
): RosterView | null {
  const team = league.teams[subjectTeamId];
  const identity = identityViewOf(league, subjectTeamId);
  if (!team || !identity) return null;

  const players = (team.rosterIds as readonly PlayerId[])
    .map((id) => league.players[id])
    .filter((p): p is Player => p !== undefined)
    .map((p) => playerCard(league, viewerTeamId, p));

  return {
    team: identity,
    isOwnRoster: viewerTeamId === subjectTeamId,
    players,
  };
}
