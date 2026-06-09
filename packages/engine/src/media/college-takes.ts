/**
 * CFB in-season sensationalized media takes (v0.128) — the college calendar
 * gets a player voice.
 *
 * Until now the college season only produced numeric media reads (the weekly
 * board stock-tracker) and the Heisman-race narrative. This brings the Scribe's
 * player-take voice — already live for the NFL (`nfl-takes.ts`) — into the
 * college weeks: each week the genuine standout games (good OR bad) by notable
 * prospects, plus any freak individual line by anyone, get a SENSATIONALIZED
 * take. The angle is framed by the prospect's stature (recruiting pedigree) and
 * how outlying the performance is:
 *
 *   - BREAKOUT   — a lightly-recruited prospect posts a monster line: "a name to
 *                  know", forcing his way onto boards.
 *   - SPOTLIGHT  — a blue-chip lives up to the billing: first-round buzz grows.
 *   - STRUGGLING — a touted prospect lays an egg (picks, a dud in a loss): the
 *                  draft-stock questions mount, "stock in free fall".
 *
 * Selection is world-seeded (the week's box scores); the WORDS ride `voiceSeed`
 * (Living Voice), so the same season is narrated differently each playthrough.
 * Headlines cite the public box-score line (as the NFL takes do); the scouting
 * body stays qualitative (North Star — no rating/grade number in the prose).
 */

import type { Prng } from '../prng/index.js';
import type { LeagueState } from '../types/league.js';
import type { CollegePlayer } from '../types/college.js';
import type { CollegeGame, CollegePlayerGameStats } from '../types/college-season.js';
import type { MediaOutlet, MediaReport, MediaTone, ScoutReportBody } from '../types/media.js';
import { MediaReportId } from '../types/ids.js';
import { getSchoolById } from '../data/colleges/index.js';
import { voicePrng } from './voice.js';
import { scoutTraitsFor, scoutConcernFor } from './scout-vocabulary.js';

type TakeAngle = 'BREAKOUT' | 'SPOTLIGHT' | 'STRUGGLING';

type TakeKind =
  | 'qb-monster'
  | 'qb-picks'
  | 'rb-monster'
  | 'wr-monster'
  | 'sack-storm'
  | 'pick-storm'
  | 'star-dud';

// College box-score thresholds — higher than the NFL's; CFB games run up.
const QB_MONSTER_YDS = 375;
const QB_MONSTER_TDS = 5;
const QB_PICKS = 3;
const RB_MONSTER_YDS = 180;
const WR_MONSTER_YDS = 150;
const SACK_STORM = 3;
const PICK_STORM = 2;
/** Recruiting stars at/above which a prospect is "touted" (drives angle + dud). */
const TOUTED_STARS = 4;

const KIND_PRIORITY: Record<TakeKind, number> = {
  'qb-monster': 100,
  'qb-picks': 85,
  'rb-monster': 80,
  'wr-monster': 70,
  'sack-storm': 65,
  'pick-storm': 60,
  'star-dud': 55,
};

interface WeekLeaders {
  passYds: ReadonlySet<string>;
  rushYds: ReadonlySet<string>;
  recYds: ReadonlySet<string>;
  passTds: ReadonlySet<string>;
  sacks: ReadonlySet<string>;
  ints: ReadonlySet<string>;
}

function topK(
  lines: readonly CollegePlayerGameStats[],
  k: number,
  get: (l: CollegePlayerGameStats) => number,
): ReadonlySet<string> {
  return new Set(
    [...lines]
      .filter((l) => get(l) > 0)
      .sort((a, b) => get(b) - get(a))
      .slice(0, k)
      .map((l) => l.playerId as string),
  );
}

function computeWeekLeaders(lines: readonly CollegePlayerGameStats[], k = 5): WeekLeaders {
  return {
    passYds: topK(lines, k, (l) => l.passingYards),
    rushYds: topK(lines, k, (l) => l.rushingYards),
    recYds: topK(lines, k, (l) => l.receivingYards),
    passTds: topK(lines, k, (l) => l.passingTds),
    sacks: topK(lines, k, (l) => l.sacks),
    ints: topK(lines, k, (l) => l.interceptions),
  };
}

interface Classified {
  kind: TakeKind;
  statPhrase: string;
  positive: boolean;
}

/** Classify a college line into its biggest story (or null). Leader-gated for
 *  the volume kinds; incident kinds (picks) are threshold-only. `lost` enables
 *  the touted-prospect dud angle. */
function classify(
  line: CollegePlayerGameStats,
  prospect: CollegePlayer,
  leaders: WeekLeaders,
  lost: boolean,
): Classified | null {
  const id = line.playerId as string;
  // Monster passing line.
  if (
    (line.passingYards >= QB_MONSTER_YDS && leaders.passYds.has(id)) ||
    (line.passingTds >= QB_MONSTER_TDS && leaders.passTds.has(id))
  ) {
    const tdWord = line.passingTds === 1 ? 'touchdown' : 'touchdowns';
    const phrase =
      line.passingTds >= QB_MONSTER_TDS && line.passingYards < QB_MONSTER_YDS
        ? `${line.passingTds} touchdown passes`
        : `${line.passingYards} yards and ${line.passingTds} ${tdWord}`;
    return { kind: 'qb-monster', statPhrase: phrase, positive: true };
  }
  // Interception-heavy day — always news, louder for a touted name.
  if (line.interceptionsThrown >= QB_PICKS) {
    return { kind: 'qb-picks', statPhrase: `${line.interceptionsThrown} interceptions`, positive: false };
  }
  if (line.rushingYards >= RB_MONSTER_YDS && leaders.rushYds.has(id)) {
    return { kind: 'rb-monster', statPhrase: `${line.rushingYards} rushing yards`, positive: true };
  }
  if (line.receivingYards >= WR_MONSTER_YDS && leaders.recYds.has(id)) {
    return { kind: 'wr-monster', statPhrase: `${line.receivingYards} receiving yards`, positive: true };
  }
  if (line.sacks >= SACK_STORM && leaders.sacks.has(id)) {
    return { kind: 'sack-storm', statPhrase: `${line.sacks} sacks`, positive: true };
  }
  if (line.interceptions >= PICK_STORM && leaders.ints.has(id)) {
    return { kind: 'pick-storm', statPhrase: `${line.interceptions} interceptions`, positive: true };
  }
  // A touted prospect who laid an egg in a loss — the "stock dip" story. Only
  // for blue-chips (a nobody's quiet day is not news), and only a genuine dud.
  if (lost && prospect.recruiting.starRating >= TOUTED_STARS) {
    const pos = prospect.nflProjectedPosition;
    const dud =
      (pos === 'QB' && line.passAttempts >= 20 && line.passingYards < 180) ||
      (pos === 'RB' && line.rushingAttempts >= 12 && line.rushingYards < 45) ||
      ((pos === 'WR' || pos === 'TE') && line.targets >= 5 && line.receivingYards < 35);
    if (dud) {
      const phrase =
        pos === 'QB'
          ? `just ${line.passingYards} yards`
          : pos === 'RB'
            ? `held to ${line.rushingYards} yards on the ground`
            : `just ${line.receivingYards} receiving yards`;
      return { kind: 'star-dud', statPhrase: phrase, positive: false };
    }
  }
  return null;
}

function angleFor(c: Classified, prospect: CollegePlayer): TakeAngle {
  if (!c.positive) return 'STRUGGLING';
  return prospect.recruiting.starRating >= TOUTED_STARS ? 'SPOTLIGHT' : 'BREAKOUT';
}

const HEADLINES: Record<TakeAngle, readonly string[]> = {
  BREAKOUT: [
    'Nobody had {name} circled — {statPhrase} for {school} against {opp}, and they do now.',
    '{name} is forcing his way onto draft boards: {statPhrase} in {school}’s win over {opp}.',
    'Remember the name — {name} ({school}) just went off for {statPhrase} against {opp}.',
  ],
  SPOTLIGHT: [
    'The hype is real: {name} ({school}) drops {statPhrase} on {opp} — first-round buzz only grows.',
    '{name} keeps cashing checks — {statPhrase} against {opp}. The blue-chip billing was no fluke.',
    'Statement game from {name}: {statPhrase} as {school} handles {opp}.',
  ],
  STRUGGLING: [
    'Rough day for {name} ({school}) — {statPhrase} in the loss to {opp}. The stock questions are mounting.',
    '{name}’s draft stock took a hit: {statPhrase} against {opp}. Scouts wanted more.',
    'The shine came off {name} a little — {statPhrase} in {school}’s loss to {opp}.',
  ],
};

function fillHeadline(
  template: string,
  v: { name: string; school: string; opp: string; statPhrase: string },
): string {
  return template
    .replace(/\{name\}/g, v.name)
    .replace(/\{school\}/g, v.school)
    .replace(/\{opp\}/g, v.opp)
    .replace(/\{statPhrase\}/g, v.statPhrase);
}

const SUMMARY: Record<TakeAngle, readonly string[]> = {
  BREAKOUT: [
    'A name to file away now — the production showed up against real competition.',
    'The kind of breakout that turns an unknown into a Saturday-night regular.',
  ],
  SPOTLIGHT: [
    'Exactly the kind of tape the high ranking promised.',
    'Another week, another reminder of why he is so coveted.',
  ],
  STRUGGLING: [
    'A performance the evaluators will replay — and not in a good way.',
    'One bad night does not sink a résumé, but the questions are fair.',
  ],
};

/** A light, qualitative Scribe body so the take also surfaces on the prospect
 *  card. No numbers/bands in the prose (North Star) — the headline carries the
 *  box score. */
function buildBody(prng: Prng, prospect: CollegePlayer, angle: TakeAngle): ScoutReportBody {
  const pos = prospect.nflProjectedPosition;
  const traits = scoutTraitsFor(prng.fork('traits'), pos, 2);
  const strengths =
    angle === 'STRUGGLING' ? traits.slice(0, 1) : traits.map((t) => `flashes ${t}`.replace(/^./, (c) => c.toUpperCase()));
  const concern = `The watch-out is ${scoutConcernFor(prng.fork('concern'), pos)}.`;
  const summary = prng.fork('summary').pick(SUMMARY[angle]);
  const bottomLine =
    angle === 'STRUGGLING'
      ? 'A dip on the stock chart — not a verdict.'
      : angle === 'SPOTLIGHT'
        ? 'The arrow stays pointed up.'
        : 'An arrow-up week that gets people watching the tape.';
  return { summary, strengths, concern, bottomLine };
}

/**
 * Generate the week's sensationalized college player takes from the just-played
 * games. World-seeded selection (box scores + week leaders); voice-seeded words.
 * Returns reports to append to `league.mediaReports`.
 */
export function generateCollegeWeeklyTakes(
  league: LeagueState,
  weekGames: readonly CollegeGame[],
  weekStats: readonly CollegePlayerGameStats[],
  weekNumber: number,
  filedOnTick: number,
  maxTakes = 5,
): readonly MediaReport[] {
  if (weekStats.length === 0) return [];

  const prospectById = new Map<string, CollegePlayer>();
  for (const cp of league.collegePool) prospectById.set(cp.id as string, cp);

  // School → (result, opponent) for this week's games.
  const gameBySchool = new Map<string, { won: boolean; oppSchoolId: string }>();
  for (const g of weekGames) {
    if (!g.result) continue;
    const homeWon = g.result.homeScore > g.result.awayScore;
    gameBySchool.set(g.homeSchoolId, { won: homeWon, oppSchoolId: g.awaySchoolId });
    gameBySchool.set(g.awaySchoolId, { won: !homeWon, oppSchoolId: g.homeSchoolId });
  }

  const leaders = computeWeekLeaders(weekStats);

  interface Candidate {
    line: CollegePlayerGameStats;
    prospect: CollegePlayer;
    c: Classified;
    angle: TakeAngle;
    oppName: string;
    rank: number;
  }
  const candidates: Candidate[] = [];
  for (const line of weekStats) {
    const prospect = prospectById.get(line.playerId as string);
    if (!prospect) continue;
    const game = gameBySchool.get(line.schoolId);
    const lost = game ? !game.won : false;
    const c = classify(line, prospect, leaders, lost);
    if (!c) continue;
    const angle = angleFor(c, prospect);
    const oppName = game ? getSchoolById(game.oppSchoolId)?.name ?? game.oppSchoolId : 'their opponent';
    // Newsworthiness — kind priority, nudged up by the prospect's stature so a
    // touted name's story outranks an equal line from an unknown.
    const rank = KIND_PRIORITY[c.kind] + prospect.recruiting.starRating * 3;
    candidates.push({ line, prospect, c, angle, oppName, rank });
  }
  if (candidates.length === 0) return [];

  candidates.sort((a, b) => b.rank - a.rank || (a.prospect.id < b.prospect.id ? -1 : 1));
  const seen = new Set<string>();
  const picked: Candidate[] = [];
  for (const cand of candidates) {
    if (seen.has(cand.prospect.id as string)) continue;
    seen.add(cand.prospect.id as string);
    picked.push(cand);
    if (picked.length >= maxTakes) break;
  }

  const collegeOutlets = Object.values(league.mediaOutlets).filter(
    (o) => o.focus === 'COLLEGE' || o.focus === 'BOTH',
  );
  if (collegeOutlets.length === 0) return [];

  const reports: MediaReport[] = [];
  let idx = 0;
  for (const cand of picked) {
    const outlet: MediaOutlet = collegeOutlets[idx % collegeOutlets.length]!;
    const school = getSchoolById(cand.prospect.schoolId)?.name ?? cand.prospect.schoolId;
    const vp = voicePrng(
      league.voiceSeed,
      'cfb-take',
      league.seasonNumber,
      weekNumber,
      cand.prospect.id as string,
    );
    const headline = fillHeadline(vp.fork('headline').pick(HEADLINES[cand.angle]), {
      name: `${cand.prospect.firstName} ${cand.prospect.lastName}`,
      school,
      opp: cand.oppName,
      statPhrase: cand.c.statPhrase,
    });
    const tone: MediaTone = cand.angle === 'STRUGGLING' ? 'CRITICAL' : 'POSITIVE';
    reports.push({
      kind: 'player-take',
      id: MediaReportId(`CWTAKE_S${league.seasonNumber}_W${weekNumber}_${cand.prospect.id}`),
      outletId: outlet.id,
      filedOnTick,
      seasonNumber: league.seasonNumber,
      weekNumber,
      lifecyclePhase: 'COLLEGE_WEEK',
      tone,
      headline,
      subjectPlayerId: cand.prospect.id,
      subjectIsCollegeProspect: true,
      scoutReport: buildBody(vp.fork('body'), cand.prospect, cand.angle),
    });
    idx++;
  }
  return reports;
}
