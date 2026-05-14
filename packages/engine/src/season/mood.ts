import type { LeagueState } from '../types/league.js';
import type { Player } from '../types/player.js';
import type { HeadCoach, Owner } from '../types/personnel.js';
import type { ScheduledGame } from '../types/game.js';
import type { TeamState } from '../types/team.js';
import type {
  Transaction,
  MoodBucket,
  LockerRoomIncidentFlavor,
} from '../types/transaction.js';
import type { TeamId, PlayerId } from '../types/ids.js';
import { Position, MarketSize } from '../types/enums.js';
import type { Prng } from '../prng/index.js';
import { schemeFitForPlayer } from '../scheme/fit.js';

export type { MoodBucket } from '../types/transaction.js';

/**
 * Coarse mood buckets in ascending order. Index in this list is its
 * severity rank; consumers can compare adjacent labels with the order
 * provided by `MOOD_BUCKETS`.
 */
export const MOOD_BUCKETS: readonly MoodBucket[] = [
  'wants_out',
  'frustrated',
  'unsettled',
  'content',
  'happy',
];

/**
 * Map a 0..100 mood number to its coarse bucket label. Boundaries:
 *   0..19   wants_out
 *   20..39  frustrated
 *   40..59  unsettled
 *   60..79  content
 *   80..100 happy
 */
export function moodBucket(mood: number): MoodBucket {
  if (mood < 20) return 'wants_out';
  if (mood < 40) return 'frustrated';
  if (mood < 60) return 'unsettled';
  if (mood < 80) return 'content';
  return 'happy';
}

/**
 * League-level baseline retained for bucket math and for downstream
 * systems that need a fixed reference (e.g., `moodMultiplier`). The
 * per-player target is `Player.moodProfile.setPoint`, which varies by
 * personality archetype — see `MoodArchetype` in types/player.ts.
 */
export const MOOD_BASELINE = 75;

/** Mood at-or-below which a STAR / STARTER demands a trade out. */
export const TRADE_REQUEST_THRESHOLD = 15;

/** Mood at-or-above which an outstanding trade request is withdrawn. */
export const TRADE_REQUEST_RESOLVE_THRESHOLD = 40;

/**
 * Locker-room contagion thresholds. Players with mood below the
 * `DRAG_CEILING` contribute negative pressure (frustration spreads).
 * Players with mood above the `LIFT_FLOOR` who *also* clear the
 * veteran-leadership bar (see below) contribute positive lift
 * (vet leadership stabilizes the room).
 *
 * Thresholds are symmetric around the league-mean setPoint (~67) so
 * contagion fires equally often in both directions across the league.
 * Previously LIFT_FLOOR sat at 75 (only 8 above mean) while DRAG_CEILING
 * sat at 50 (17 below mean) — that asymmetry meant happy clusters
 * triggered lift far more often than unhappy clusters triggered drag,
 * which amplified the v0.17.0/v0.18.0 upward saturation bug.
 *
 * Asymmetric *participation* requirements still match Doc 7:
 *   - Negative drag spreads from anyone unhappy — the bad apple in the
 *     locker room can be any tier or experience level.
 *   - Positive lift comes specifically from "veterans with high
 *     Integrity and Leadership" (Doc 7's exact language). We
 *     approximate integrity via `workEthic` since the integrity
 *     personality trait sits on owner/GM/HC, not Player.
 */
const LOCKER_ROOM_DRAG_CEILING = 50;
const LOCKER_ROOM_LIFT_FLOOR = 84;
const VETERAN_EXPERIENCE_THRESHOLD = 4; // years past rookie deal
const VETERAN_LEADERSHIP_FLOOR = 60; // (leadership + workEthic) / 2 must clear this

/**
 * Per-player effort multiplier applied to that player's contribution
 * to team/unit strength. Asymmetric — frustrated players cost more
 * than happy players gain, matching Doc 7's "low morale may affect
 * on-field performance in subtle ways" + "winning covers many sins":
 *
 *   mood   0 → 0.940  (wants out — clear effort drop)
 *   mood  30 → 0.964
 *   mood  50 → 0.980
 *   mood  75 → 1.000  (baseline / content — neutral)
 *   mood  90 → 1.009
 *   mood 100 → 1.015  (happy — small effort boost)
 *
 * Range is intentionally narrow so chemistry isn't decisive on its own —
 * a STAR with collapsed mood is still better than a BACKUP, but a roster
 * of frustrated stars is meaningfully worse than the same roster happy.
 */
export function moodMultiplier(mood: number): number {
  if (mood >= MOOD_BASELINE) {
    return 1.0 + ((mood - MOOD_BASELINE) / (100 - MOOD_BASELINE)) * 0.015;
  }
  return 1.0 - ((MOOD_BASELINE - mood) / MOOD_BASELINE) * 0.06;
}

/**
 * Rough "expected number of starters" per position. Used to decide
 * whether a player ranks ahead of or behind the team's depth-chart
 * starter slots for their position. This is a coarse stand-in until
 * Doc 7's depth-chart UI lands and starter slots become explicit.
 */
const STARTER_SLOTS: Record<Position, number> = {
  QB: 1,
  RB: 1,
  FB: 1,
  WR: 3,
  TE: 1,
  LT: 1,
  LG: 1,
  C: 1,
  RG: 1,
  RT: 1,
  EDGE: 2,
  DT: 1,
  NT: 1,
  ILB: 2,
  OLB: 2,
  CB: 2,
  S: 2,
  NICKEL: 1,
  K: 1,
  P: 1,
  LS: 1,
};

interface WeeklyMoodInput {
  league: LeagueState;
  /** All weeks played in this season so far (including the one that just finished). */
  playedWeeks: readonly (readonly ScheduledGame[])[];
  /** Sim tick the just-finished week occurred on. Used for transaction stamps. */
  tick: number;
  /**
   * Fork PRNG dedicated to mood noise + incident rolls. Required since
   * v0.18.0 — without it the noise pass is deterministically zero and
   * locker-room incidents never fire. Callers in the season runner
   * supply a fork; tests can pass a fixed-seed PRNG for determinism.
   */
  prng: Prng;
}

export interface WeeklyMoodResult {
  players: Record<PlayerId, Player>;
  transactionLog: readonly Transaction[];
}

/**
 * Per-week noise envelope at the high end of volatility (vol 10).
 * Most weekly nudges fall well below this — gaussian draws are clamped
 * to ±NOISE_CAP × volatility / 10 to keep things bounded.
 */
const NOISE_CAP = 6;

/**
 * Soft ceiling positive contagion respects, expressed as a delta above
 * the recipient's personal setPoint. This is the key fix for v0.18.0's
 * predecessor saturation bug — vet leaders can lift teammates within
 * a normal high-end mood band, but cannot push a "distraction" with
 * setPoint 45 up to a Manning-level 95 just by being in the room.
 */
const POSITIVE_LIFT_CEILING_OFFSET = 15;

/**
 * Distribution of incident flavors when a volatility roll fires.
 * Mostly negative beats (media blowups, social posts, disputes); a
 * minority positive (team-bonding) so it's not pure misery noise.
 */
const INCIDENT_FLAVOR_WEIGHTS: readonly { value: LockerRoomIncidentFlavor; weight: number }[] = [
  { value: 'media_blowup', weight: 25 },
  { value: 'social_media_post', weight: 22 },
  { value: 'practice_conflict', weight: 15 },
  { value: 'coach_dispute', weight: 15 },
  { value: 'off_field_issue', weight: 13 },
  { value: 'positive_moment', weight: 10 },
];

/**
 * Apply one week's worth of mood drift to every rostered player
 * (active 53 + IR). Practice-squad players are skipped for now — their
 * developmental dynamics get their own slice later.
 *
 * Drift inputs per player:
 *   - regression toward 75 baseline
 *   - last-week team W/L (and current 3+ streak amplifier)
 *   - HC `playerRelationships` spectrum (positive bias)
 *   - HC `CULTURE_CARRIER` quirk (additive bonus)
 *   - IR penalty proportional to tier (stars hurt most)
 *   - depth-chart penalty when a high-tier player is buried behind
 *     same-position peers occupying the starter slots
 *   - `composure` skill dampens or amplifies negative deltas
 *
 * Returns the updated players map plus any `mood-shift` transactions
 * appended for bucket-boundary crossings. Determinism: pure function of
 * its inputs — no PRNG dependence.
 */
export function weeklyMoodUpdate(input: WeeklyMoodInput): WeeklyMoodResult {
  const { league, playedWeeks, tick, prng } = input;
  if (playedWeeks.length === 0) {
    return { players: { ...league.players }, transactionLog: league.transactionLog };
  }
  const streaks = computeStreaks(playedWeeks);
  const lastWeek = playedWeeks[playedWeeks.length - 1]!;
  const lastWeekByTeam = new Map<TeamId, 'W' | 'L' | 'T'>();
  for (const game of lastWeek) {
    if (!game.result) continue;
    const home = game.result.homeScore;
    const away = game.result.awayScore;
    if (home === away) {
      lastWeekByTeam.set(game.homeTeamId, 'T');
      lastWeekByTeam.set(game.awayTeamId, 'T');
    } else if (home > away) {
      lastWeekByTeam.set(game.homeTeamId, 'W');
      lastWeekByTeam.set(game.awayTeamId, 'L');
    } else {
      lastWeekByTeam.set(game.homeTeamId, 'L');
      lastWeekByTeam.set(game.awayTeamId, 'W');
    }
  }

  // Pass 1 — primary drift: drift toward baseline, team W/L + streak,
  // HC fit, IR penalty, depth-chart penalty, composure modifier.
  // Results are staged so pass 2 can apply contagion against a
  // consistent post-drift snapshot (otherwise iteration order would
  // affect which teammates' new vs old mood drove the contagion).
  const stagedMoods = new Map<PlayerId, number>();
  for (const team of Object.values(league.teams)) {
    const hc = league.coaches[team.headCoachId];
    if (!hc) continue;
    const hcDelta = hcMoodDelta(hc);
    const result = lastWeekByTeam.get(team.identity.id) ?? null;
    const streak = streaks.get(team.identity.id) ?? 0;
    const teamDelta = teamResultDelta(result, streak);

    const activeRoster = team.rosterIds
      .map((id) => league.players[id])
      .filter((p): p is Player => Boolean(p));
    const byPosition = new Map<Position, Player[]>();
    for (const p of activeRoster) {
      const list = byPosition.get(p.position) ?? [];
      list.push(p);
      byPosition.set(p.position, list);
    }

    const owner = league.owners[team.ownerId];
    const ownerD = owner ? ownerMoodDelta(owner) : 0;

    for (const playerId of [...team.rosterIds, ...team.injuredReserveIds]) {
      const player = league.players[playerId];
      if (!player) continue;
      const onIr = team.injuredReserveIds.includes(playerId);

      const depthD = onIr
        ? 0
        : depthChartDelta(player, byPosition.get(player.position) ?? []);
      const irD = onIr ? irPenalty(player) : 0;
      const schemeD = schemeFitDelta(player, hc);
      // Drift pulls toward the player's personal setPoint, not a
      // league-flat baseline. Stabilizers (high resilience) snap back
      // hard; distractions (low resilience) drift loosely so noise
      // dominates their week-to-week behavior.
      const { setPoint, resilience } = player.moodProfile;
      const drift = (setPoint - player.mood) * resilience * 0.05;

      const positiveSum = Math.max(0, teamDelta) + Math.max(0, hcDelta)
        + Math.max(0, depthD) + Math.max(0, schemeD) + Math.max(0, ownerD);
      const negativeSum = Math.min(0, teamDelta) + Math.min(0, hcDelta)
        + Math.min(0, depthD) + Math.min(0, schemeD) + Math.min(0, ownerD) + irD;
      const composureMul = composureModifier(player);
      const total = drift + positiveSum + negativeSum * composureMul;

      stagedMoods.set(playerId, clamp(player.mood + total, 0, 100));
    }
  }

  // Pass 2 — locker-room contagion: for each team, sum negative
  // pressure (frustration spreads from anyone below the drag ceiling)
  // AND positive lift (veteran leaders above the lift floor stabilize
  // the room). Apply the net delta to every teammate's mood, weighted
  // by their composure resistance (negative) and coachability
  // receptivity (positive). Per Doc 7: "chemistry problems can spread
  // to other players" + "veterans with high Integrity and Leadership
  // help stabilize locker room." Practice-squad players don't
  // participate — they're separate from the active locker room.
  for (const team of Object.values(league.teams)) {
    const rosterIds = [...team.rosterIds, ...team.injuredReserveIds];
    if (rosterIds.length === 0) continue;

    let negativePressure = 0;
    let positiveLift = 0;
    for (const playerId of rosterIds) {
      const player = league.players[playerId];
      if (!player) continue;
      const staged = stagedMoods.get(playerId) ?? player.mood;
      if (staged < LOCKER_ROOM_DRAG_CEILING) {
        const deviation = LOCKER_ROOM_DRAG_CEILING - staged;
        const voice = 0.3 + (player.current.leadership / 100) * 0.7; // 0.3..1.0
        negativePressure += deviation * voice;
      } else if (
        staged > LOCKER_ROOM_LIFT_FLOOR &&
        player.experienceYears >= VETERAN_EXPERIENCE_THRESHOLD
      ) {
        const integrityProxy =
          (player.current.leadership + player.current.workEthic) / 2;
        if (integrityProxy >= VETERAN_LEADERSHIP_FLOOR) {
          const excess = staged - LOCKER_ROOM_LIFT_FLOOR;
          const voice = integrityProxy / 100; // 0.6..1.0 for qualifiers
          positiveLift += excess * voice;
        }
      }
    }
    if (negativePressure === 0 && positiveLift === 0) continue;
    // Coefficients equal in both directions — keeping them asymmetric
    // was the dominant source of upward drift after the v0.18.0 rework.
    const negPerTeammate = (negativePressure / rosterIds.length) * 0.15;
    const posPerTeammate = (positiveLift / rosterIds.length) * 0.15;

    for (const playerId of rosterIds) {
      const player = league.players[playerId];
      if (!player) continue;
      const susceptibility = 1.0 - (player.current.composure / 100) * 0.7; // 0.3..1.0
      const receptivity = 0.3 + (player.current.coachability / 100) * 0.7; // 0.3..1.0
      const positivePart = posPerTeammate * receptivity;
      const negativePart = negPerTeammate * susceptibility;
      if (positivePart === 0 && negativePart === 0) continue;
      const staged = stagedMoods.get(playerId) ?? player.mood;

      // Positive contagion respects a personal ceiling: vet leaders
      // can lift a teammate inside a normal high-end band, but cannot
      // push a setPoint-45 distraction up to a Manning-tier 95 just by
      // being in the locker room. Negative drag is uncapped — bad
      // chemistry can pull anyone down regardless of setPoint.
      const personalCeiling = Math.min(100, player.moodProfile.setPoint + POSITIVE_LIFT_CEILING_OFFSET);
      const headroom = Math.max(0, personalCeiling - staged);
      const cappedPositive = Math.min(positivePart, headroom);
      const delta = cappedPositive - negativePart;
      if (delta === 0) continue;
      stagedMoods.set(playerId, clamp(staged + delta, 0, 100));
    }
  }

  // Pass 3 — weekly noise + locker-room incidents. Per Doc 7 and the
  // user's note on v0.17.0: real NFL rooms are intense and dynamic
  // even on winning teams. Random per-player noise scaled by personal
  // volatility produces normal week-to-week churn; with a small
  // volatility-scaled probability the noise escalates into a logged
  // `locker-room-incident` transaction tagged with a flavor and a
  // media-leak flag so future news / media surfaces (Doc 12) can pick
  // up on it. Players with `MoodArchetype.distraction` see this fire
  // far more often than stabilizers.
  const newTransactions: Transaction[] = [];
  for (const team of Object.values(league.teams)) {
    const owner = league.owners[team.ownerId];
    const hc = league.coaches[team.headCoachId];
    if (!owner || !hc) continue;
    for (const playerId of [...team.rosterIds, ...team.injuredReserveIds]) {
      const player = league.players[playerId];
      if (!player) continue;
      const vol = player.moodProfile.volatility;

      // Standard weekly noise — small for stabilizers, big for
      // distractions. Gaussian draw clamped so a 4-sigma tail doesn't
      // single-handedly flip a player's mood bucket on a quiet week.
      const noise = clamp(
        prng.gaussian() * (vol * 0.3),
        -NOISE_CAP * (vol / 10),
        NOISE_CAP * (vol / 10),
      );
      const stagedMood = stagedMoods.get(playerId) ?? player.mood;
      let next = clamp(stagedMood + noise, 0, 100);

      // Incident roll. Probability scales non-linearly with volatility
      // so the gap between an "anchor" and a "distraction" is wide.
      const incidentProb = Math.pow(vol / 10, 1.5) * 0.04;
      if (prng.next() < incidentProb) {
        const flavor = prng.weighted(INCIDENT_FLAVOR_WEIGHTS);
        const isPositive = flavor === 'positive_moment';
        const magnitude = Math.abs(prng.gaussian()) * (vol * 0.5) + 2;
        const signedDelta = isPositive ? magnitude : -magnitude;
        next = clamp(next + signedDelta, 0, 100);
        const mediaLeak = rollMediaLeak(prng, flavor, team, owner, hc);
        newTransactions.push({
          kind: 'locker-room-incident',
          tick,
          seasonNumber: league.seasonNumber,
          teamId: team.identity.id,
          playerId,
          flavor,
          mediaLeak,
          moodDelta: Math.round(signedDelta * 10) / 10,
        });
      }
      stagedMoods.set(playerId, next);
    }
  }

  // Pass 4 — emit transactions + finalize player updates based on the
  // post-contagion, post-noise mood. Trade-request transitions
  // intentionally fire against the final mood so a player dragged into
  // the wants-out band by locker-room contagion or an incident (not
  // just their own drivers) still generates the demand.
  const updatedPlayers: Record<PlayerId, Player> = {};
  for (const team of Object.values(league.teams)) {
    for (const playerId of [...team.rosterIds, ...team.injuredReserveIds]) {
      const player = league.players[playerId];
      if (!player) continue;
      const finalMood = stagedMoods.get(playerId) ?? player.mood;

      let nextPlayer: Player = player;
      if (finalMood !== player.mood) {
        nextPlayer = { ...nextPlayer, mood: finalMood };
        const before = moodBucket(player.mood);
        const after = moodBucket(finalMood);
        if (before !== after) {
          newTransactions.push({
            kind: 'mood-shift',
            tick,
            seasonNumber: league.seasonNumber,
            teamId: team.identity.id,
            playerId,
            fromBucket: before,
            toBucket: after,
            mood: finalMood,
          });
        }
      }

      const hasOpenRequest = player.tradeRequestedOnTick !== null;
      const tierEligible = player.tier === 'STAR' || player.tier === 'STARTER';
      if (!hasOpenRequest && tierEligible && finalMood <= TRADE_REQUEST_THRESHOLD) {
        nextPlayer = { ...nextPlayer, tradeRequestedOnTick: tick };
        newTransactions.push({
          kind: 'trade-request',
          tick,
          seasonNumber: league.seasonNumber,
          teamId: team.identity.id,
          playerId,
          state: 'requested',
          mood: finalMood,
          tier: player.tier,
        });
      } else if (hasOpenRequest && finalMood >= TRADE_REQUEST_RESOLVE_THRESHOLD) {
        nextPlayer = { ...nextPlayer, tradeRequestedOnTick: null };
        newTransactions.push({
          kind: 'trade-request',
          tick,
          seasonNumber: league.seasonNumber,
          teamId: team.identity.id,
          playerId,
          state: 'resolved',
          mood: finalMood,
          tier: player.tier,
        });
      }

      if (nextPlayer !== player) {
        updatedPlayers[playerId] = nextPlayer;
      }
    }
  }

  return {
    players: { ...league.players, ...updatedPlayers },
    transactionLog:
      newTransactions.length === 0
        ? league.transactionLog
        : [...league.transactionLog, ...newTransactions],
  };
}

/**
 * Per-team current-result streak length (positive = winning streak,
 * negative = losing streak, 0 = streak broken by tie or no games).
 * Walks `playedWeeks` from most-recent backward until the result flips.
 */
function computeStreaks(
  playedWeeks: readonly (readonly ScheduledGame[])[],
): Map<TeamId, number> {
  const teamResults = new Map<TeamId, ('W' | 'L' | 'T')[]>();
  for (const week of playedWeeks) {
    for (const game of week) {
      if (!game.result) continue;
      const home = game.result.homeScore;
      const away = game.result.awayScore;
      const homeRes: 'W' | 'L' | 'T' = home === away ? 'T' : home > away ? 'W' : 'L';
      const awayRes: 'W' | 'L' | 'T' = home === away ? 'T' : away > home ? 'W' : 'L';
      const h = teamResults.get(game.homeTeamId) ?? [];
      h.push(homeRes);
      teamResults.set(game.homeTeamId, h);
      const a = teamResults.get(game.awayTeamId) ?? [];
      a.push(awayRes);
      teamResults.set(game.awayTeamId, a);
    }
  }
  const streaks = new Map<TeamId, number>();
  for (const [teamId, results] of teamResults) {
    let streak = 0;
    for (let i = results.length - 1; i >= 0; i--) {
      const r = results[i]!;
      if (r === 'T') break;
      if (streak === 0) {
        streak = r === 'W' ? 1 : -1;
      } else if ((streak > 0 && r === 'W') || (streak < 0 && r === 'L')) {
        streak = streak > 0 ? streak + 1 : streak - 1;
      } else {
        break;
      }
    }
    streaks.set(teamId, streak);
  }
  return streaks;
}

function teamResultDelta(result: 'W' | 'L' | 'T' | null, streak: number): number {
  let delta = 0;
  if (result === 'W') delta += 0.6;
  else if (result === 'L') delta -= 0.6;
  else if (result === 'T') delta -= 0.1;
  if (streak >= 3) delta += 0.8;
  if (streak <= -3) delta -= 1.0;
  return delta;
}

/**
 * HC contribution. `playerRelationships` is the spectrum the design doc
 * highlights as the chemistry-management lever — centered at 5.5 with
 * coefficient 0.3 it gives ±1.35 per week, the biggest single weekly
 * driver. The user-facing requirement is "good coaches should trend
 * their teams up, bad coaches should trend their teams down" — that
 * dispersion lives almost entirely in this term, so it has to bite.
 *
 * Quirks layer on top SYMMETRICALLY: `CULTURE_CARRIER` is the explicit
 * "holds the room together" coach (+0.6), `PRESS_CONFERENCE_DISASTER`
 * is the locker-room poison coach whose pressers leak frustration and
 * whose room loses trust week by week (-0.6). Both quirks have the
 * same selection probability (~30% from the HC quirk pool of 10), so
 * the expected league-wide quirk contribution is zero.
 */
function hcMoodDelta(hc: HeadCoach): number {
  const fit = (hc.spectrums.playerRelationships - 5.5) * 0.3;
  let quirkBonus = 0;
  if (hc.quirks.includes('CULTURE_CARRIER')) quirkBonus += 0.6;
  if (hc.quirks.includes('PRESS_CONFERENCE_DISASTER')) quirkBonus -= 0.6;
  return fit + quirkBonus;
}

/**
 * Penalty for sitting on IR. Stars expect to play and chafe hardest
 * when sidelined; fringe players are less invested in their snap count.
 */
function irPenalty(player: Player): number {
  switch (player.tier) {
    case 'STAR':
      return -1.2;
    case 'STARTER':
      return -0.7;
    case 'BACKUP':
      return -0.3;
    case 'FRINGE':
      return -0.1;
  }
}

/**
 * Depth-chart satisfaction. The player's rank within their position
 * group on the active roster decides whether they're "starting" or
 * "buried". Rank is by tier (STAR > STARTER > BACKUP > FRINGE); within
 * a tier ordering is left to the caller's stable iteration order, which
 * for v0.17.0 is roster-insertion order (stable across re-sims).
 */
function depthChartDelta(player: Player, samePosition: readonly Player[]): number {
  const slots = STARTER_SLOTS[player.position] ?? 1;
  const peers = samePosition.filter((p) => p.id !== player.id);
  const tierRank: Record<Player['tier'], number> = {
    STAR: 0,
    STARTER: 1,
    BACKUP: 2,
    FRINGE: 3,
  };
  const ahead = peers.filter((p) => tierRank[p.tier] < tierRank[player.tier]).length;
  const sameTierAhead = peers.filter((p) => tierRank[p.tier] === tierRank[player.tier]).length;
  // Conservative interpretation: a player is "starting" when their
  // rank-among-peers (strictly-better ahead) leaves them in a slot.
  // Same-tier peers split the remaining slots — we treat any same-tier
  // competition at a 1-slot position as a mild dissatisfaction signal.
  const starting = ahead < slots;
  if (starting) {
    // Small bonus for being the clear starter when no same-tier peer
    // is competing; rookies / FRINGE players are also happy just to
    // make the active 53.
    if (sameTierAhead === 0) return 0.2;
    return 0;
  }
  switch (player.tier) {
    case 'STAR':
      return -1.5;
    case 'STARTER':
      return -0.5;
    case 'BACKUP':
      return 0;
    case 'FRINGE':
      return 0.1;
  }
}

/**
 * Owner contribution. Owners shape mood through stability signals
 * (financial commitment, patience) and quirk-driven culture cues.
 * Quirks are picked to net to zero across the league — four positives
 * (`LOYALTY_BLIND`, `COMMUNITY_CHAMPION`, `TALENT_MAGNET`, `RING_CHASER`)
 * and four negatives (`MICRO_MANAGER`, `PANIC_SELLER`,
 * `RELOCATION_THREAT`, `PR_OBSESSED`) of equal magnitude, with the
 * remaining two (`HEADLINE_HUNGRY`, `RELIC`) treated as neutral.
 *
 * Spectrum coefficients are small (0.05) per spectrum — owner is the
 * background presence in a player's life, not the day-to-day driver
 * the way HC or scheme is. Patience and financial commitment are the
 * two spectrums players are most attuned to: an impatient
 * trigger-happy owner makes the room edgy; a stingy one alienates
 * agents. Centered at 5.5 to keep the spectrum contribution roughly
 * zero-mean across the league.
 */
function ownerMoodDelta(owner: Owner): number {
  const patience = (owner.spectrums.patience - 5.5) * 0.05;
  const money = (owner.spectrums.financialCommitment - 5.5) * 0.05;
  let quirkBonus = 0;
  if (owner.quirks.includes('LOYALTY_BLIND')) quirkBonus += 0.4;
  if (owner.quirks.includes('COMMUNITY_CHAMPION')) quirkBonus += 0.3;
  if (owner.quirks.includes('TALENT_MAGNET')) quirkBonus += 0.3;
  if (owner.quirks.includes('RING_CHASER')) quirkBonus += 0.2;
  if (owner.quirks.includes('MICRO_MANAGER')) quirkBonus -= 0.4;
  if (owner.quirks.includes('PANIC_SELLER')) quirkBonus -= 0.3;
  if (owner.quirks.includes('RELOCATION_THREAT')) quirkBonus -= 0.3;
  if (owner.quirks.includes('PR_OBSESSED')) quirkBonus -= 0.2;
  return patience + money + quirkBonus;
}

/**
 * Scheme-fit contribution. A player whose archetype suits the head
 * coach's scheme loves their role and gets a small weekly lift; a
 * mismatched player feels miscast and drifts down. `schemeFitForPlayer`
 * returns a multiplier in roughly [0.85, 1.7]; the *league-wide
 * catalog mean fit is ~1.15*, not 1.0, so the v0.18.0 mapping (fit -
 * 1.0) introduced a structural +0.15/wk upward bias across the
 * league. Recentering on `SCHEME_FIT_CATALOG_MEAN` makes the driver
 * zero-mean: well-cast players still gain, miscast players still
 * lose, and the league average doesn't drift.
 *
 * Coefficient 0.7 keeps the per-week range in roughly ±0.4 — enough
 * to matter over a 17-game season, small enough that no single
 * driver dominates.
 *
 * Special-teams archetypes (K / P / LS) always return 1.0 — they sit
 * below the catalog mean and so produce a small *negative* delta
 * (~-0.1/wk). That's intentional: kickers don't get the role
 * satisfaction skill players feel when their scheme suits them, and
 * the mild penalty is dwarfed by their personalities' setPoint
 * drift, so the long-term equilibrium for a stable kicker still
 * tracks their setPoint.
 */
const SCHEME_FIT_CATALOG_MEAN = 1.15;
function schemeFitDelta(player: Player, hc: HeadCoach): number {
  const fit = schemeFitForPlayer(player, {
    offensiveScheme: hc.offensiveScheme,
    defensiveScheme: hc.defensiveScheme,
  });
  return (fit - SCHEME_FIT_CATALOG_MEAN) * 0.7;
}

/**
 * Composure dampens or amplifies *negative* deltas only. High-composure
 * veterans take losing streaks in stride; low-composure players
 * spiral faster. Positives are unchanged so a high-composure player
 * doesn't get a smaller W bump than a volatile one — that asymmetry
 * matches how the design doc frames composure as a resilience trait.
 */
function composureModifier(player: Player): number {
  const c = player.current.composure;
  if (c >= 80) return 0.7;
  if (c <= 30) return 1.3;
  return 1.0;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Probability that a locker-room incident leaks to media. Built from
 * factors the design highlighted as future hooks: market size, owner
 * involvement / quirks, HC press dynamics. Positive moments leak
 * easily (good news always travels); negative ones depend on team
 * context. Returns a boolean by rolling the PRNG against the computed
 * probability.
 */
function rollMediaLeak(
  prng: Prng,
  flavor: LockerRoomIncidentFlavor,
  team: TeamState,
  owner: Owner,
  hc: HeadCoach,
): boolean {
  if (flavor === 'positive_moment') {
    return prng.next() < 0.7;
  }
  let p = 0.15;
  switch (team.identity.marketSize) {
    case MarketSize.LARGE:
      p += 0.30;
      break;
    case MarketSize.MEDIUM:
      p += 0.15;
      break;
    case MarketSize.SMALL:
      p += 0.05;
      break;
  }
  p += (owner.spectrums.involvement - 5.5) * 0.03;
  if (owner.quirks.includes('PR_OBSESSED')) p += 0.20;
  if (owner.quirks.includes('HEADLINE_HUNGRY')) p += 0.15;
  if (hc.quirks.includes('PRESS_CONFERENCE_DISASTER')) p += 0.20;
  // Coach-dispute and off-field issues are harder to keep quiet;
  // social media posts already self-leak.
  if (flavor === 'social_media_post') p += 0.40;
  if (flavor === 'coach_dispute') p += 0.10;
  if (flavor === 'off_field_issue') p += 0.15;
  p = clamp(p, 0.05, 0.95);
  return prng.next() < p;
}

/**
 * Offseason mood adjustment. Called from `advanceSeason` after roster
 * churn so retired players are gone and fresh rookies are in.
 *
 * Pulls every remaining player's mood ~70% of the way back to their
 * personal setPoint — the months away from the locker room reset
 * accumulated frustration / euphoria toward each player's baseline
 * personality. Trade requests that no longer reflect the player's
 * current mood (after the regression) clear silently.
 *
 * Pure of any PRNG — same league in → same league out.
 */
export function offseasonMoodDrift(league: LeagueState): LeagueState {
  const updated: Record<PlayerId, Player> = {};
  for (const [id, player] of Object.entries(league.players)) {
    if (!player.moodProfile) continue;
    const { setPoint } = player.moodProfile;
    const newMood = clamp(
      player.mood + (setPoint - player.mood) * 0.7,
      0,
      100,
    );
    let next: Player = player;
    if (newMood !== player.mood) {
      next = { ...next, mood: newMood };
    }
    if (
      next.tradeRequestedOnTick !== null &&
      newMood >= TRADE_REQUEST_RESOLVE_THRESHOLD
    ) {
      next = { ...next, tradeRequestedOnTick: null };
    }
    if (next !== player) {
      updated[id as PlayerId] = next;
    }
  }
  if (Object.keys(updated).length === 0) return league;
  return {
    ...league,
    players: { ...league.players, ...updated },
  };
}
