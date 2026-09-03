/**
 * Shared inspector helpers used across multiple tabs (League, Draft,
 * Free Agency, College Games, Draft Audit, Scout Reports): measurable
 * formatting, skill/accuracy color tones, key-skill aggregation, and
 * perceived-vs-real prospect grading. Split out of App.tsx — pure code
 * motion, no behavior change.
 */
import { getArchetypeById } from '@gmsim/engine';
import { PositionGroup, Position } from '@gmsim/engine/types';
import type {
  Player,
  PlayerSkills,
  PlayerSeasonStats,
  CollegePlayer,
  LeagueState,
  WatchListReason,
  ClassYear,
} from '@gmsim/engine/types';

export const POSITION_GROUPS_ORDERED: readonly PositionGroup[] = [
  PositionGroup.QB,
  PositionGroup.SKILL,
  PositionGroup.OL,
  PositionGroup.DL,
  PositionGroup.LB,
  PositionGroup.DB,
  PositionGroup.ST,
];

export function accuracyTone(value: number): string {
  if (value >= 0.8) return 'text-emerald-400';
  if (value >= 0.65) return 'text-zinc-200';
  if (value >= 0.5) return 'text-zinc-400';
  return 'text-zinc-600';
}

export function skillDeltaTone(delta: number): string {
  const abs = Math.abs(delta);
  if (abs <= 3) return 'text-zinc-600';
  if (abs <= 8) return 'text-zinc-400';
  if (delta > 0) return 'text-emerald-400';
  return 'text-rose-400';
}

export function skillTone(value: number): string {
  if (value >= 85) return 'text-emerald-400';
  if (value >= 70) return 'text-zinc-200';
  if (value >= 55) return 'text-zinc-400';
  return 'text-zinc-600';
}

export function skillWeightChip(weight: number): { className: string; label: string } | null {
  if (weight >= 1.4) return { className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300', label: 'key' };
  if (weight >= 1.2) return { className: 'border-zinc-600 bg-zinc-800/60 text-zinc-300', label: 'core' };
  if (weight < 0.85) return { className: 'border-zinc-800 bg-zinc-900 text-zinc-600', label: 'minor' };
  return null;
}

// Numeric count keys only — excludes the identity fields (playerId, teamId).
export type StatColumn = { key: Exclude<keyof PlayerSeasonStats, 'playerId' | 'teamId'>; label: string };

export function careerStatColumns(position: Position): readonly StatColumn[] {
  switch (position) {
    case Position.QB:
      return [
        { key: 'passAttempts', label: 'att' },
        { key: 'passCompletions', label: 'cmp' },
        { key: 'passingYards', label: 'yds' },
        { key: 'passingTds', label: 'TD' },
        { key: 'interceptionsThrown', label: 'INT' },
      ];
    case Position.RB:
    case Position.FB:
      return [
        { key: 'rushingAttempts', label: 'att' },
        { key: 'rushingYards', label: 'yds' },
        { key: 'rushingTds', label: 'TD' },
        { key: 'receptions', label: 'rec' },
        { key: 'receivingYards', label: 'recYds' },
      ];
    case Position.WR:
    case Position.TE:
      return [
        { key: 'targets', label: 'tgt' },
        { key: 'receptions', label: 'rec' },
        { key: 'receivingYards', label: 'yds' },
        { key: 'receivingTds', label: 'TD' },
      ];
    case Position.EDGE:
    case Position.DT:
    case Position.NT:
      return [
        { key: 'tackles', label: 'tkl' },
        { key: 'sacks', label: 'sk' },
      ];
    case Position.ILB:
    case Position.OLB:
      return [
        { key: 'tackles', label: 'tkl' },
        { key: 'sacks', label: 'sk' },
        { key: 'interceptions', label: 'INT' },
      ];
    case Position.CB:
    case Position.S:
    case Position.NICKEL:
      return [
        { key: 'tackles', label: 'tkl' },
        { key: 'interceptions', label: 'INT' },
      ];
    default:
      return [];
  }
}

// Combine measurements are reported to the nearest 1/8 inch. These format the
// raw (possibly float) inch values as eighths fractions — e.g. 77.625 → 6'5 5/8".
const EIGHTH_FRAC = ['', '1/8', '1/4', '3/8', '1/2', '5/8', '3/4', '7/8'] as const;

// Height in inches → feet'inches" to the nearest 1/8 (e.g. 77.6 → 6'5 5/8").
export function formatHeight(inches: number): string {
  const totalEighths = Math.round(inches * 8);
  const ft = Math.floor(totalEighths / 96);
  const rem = totalEighths - ft * 96;
  const whole = Math.floor(rem / 8);
  const frac = EIGHTH_FRAC[rem % 8];
  return `${ft}'${whole}${frac ? ` ${frac}` : ''}"`;
}

// A plain inch measurement (arm, hand, vertical, broad) to the nearest 1/8
// (e.g. 34.13 → 34 1/8").
export function formatInches(inches: number): string {
  const totalEighths = Math.round(inches * 8);
  const whole = Math.floor(totalEighths / 8);
  const frac = EIGHTH_FRAC[totalEighths % 8];
  return `${whole}${frac ? ` ${frac}` : ''}"`;
}

export function avgKeySkill(p: Player): number {
  // For dev-inspector, take average of skills with archetype weight ≥ 1.2
  // (the skills that actually matter for this player). Falls back to a
  // small default set if archetype is unknown.
  const archetype = getArchetypeById(p.archetype);
  const keys = archetype
    ? Object.entries(archetype.skillWeights)
        .filter(([, w]) => (w ?? 1) >= 1.2)
        .map(([k]) => k as keyof typeof p.current)
    : (['technicalSkill', 'footballIq', 'speed'] as (keyof typeof p.current)[]);
  if (keys.length === 0) return 0;
  const sum = keys.reduce((s, k) => s + p.current[k], 0);
  return Math.round(sum / keys.length);
}

export function avgKeyCeiling(p: Player): number {
  const archetype = getArchetypeById(p.archetype);
  const keys = archetype
    ? Object.entries(archetype.skillWeights)
        .filter(([, w]) => (w ?? 1) >= 1.2)
        .map(([k]) => k as keyof typeof p.ceiling)
    : (['technicalSkill', 'footballIq', 'speed'] as (keyof typeof p.ceiling)[]);
  if (keys.length === 0) return 0;
  const sum = keys.reduce((s, k) => s + p.ceiling[k], 0);
  return Math.round(sum / keys.length);
}
// ─── Prospect grades: perceived vs real (v0.75) ─────────────────────────
//
// Every board shows a 0-100 PERCEIVED grade (what the scouts/media
// believe — observed) next to the REAL grade (ground truth: the mean of
// the prospect's true current skills). The gap is the whole story —
// amber = inflated (hype), cyan = slept on, green = the read is honest.

/** Real overall (0-100): mean of a prospect's true current skills. */
export function prospectRealGradeFromCp(cp: CollegePlayer): number | null {
  const vals = Object.values(cp.current) as number[];
  if (vals.length === 0) return null;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

/** Real overall by id. null if the prospect isn't in the pool anymore
 * (e.g. already drafted). */
export function prospectRealGrade(league: LeagueState, prospectId: string): number | null {
  const cp = league.collegePool.find((p) => p.id === prospectId);
  return cp ? prospectRealGradeFromCp(cp) : null;
}

/** League's perceived grade per prospect — mean of teams' observed-skill
 * scores across the 32 boards (the consensus big-board belief). */
export function consensusPerceivedGrades(league: LeagueState): Map<string, number> {
  const agg = new Map<string, { s: number; n: number }>();
  for (const board of Object.values(league.draftBoards)) {
    for (const e of board) {
      const cur = agg.get(e.collegePlayerId) ?? { s: 0, n: 0 };
      cur.s += e.observedSkillScore;
      cur.n += 1;
      agg.set(e.collegePlayerId, cur);
    }
  }
  const m = new Map<string, number>();
  for (const [id, { s, n }] of agg) m.set(id, Math.round(s / n));
  return m;
}

export const SKILL_GROUPS: ReadonlyArray<{
  label: string;
  skills: ReadonlyArray<keyof PlayerSkills>;
  forGroups?: ReadonlyArray<PositionGroup>;
}> = [
  {
    label: 'Physical',
    skills: ['speed', 'acceleration', 'agility', 'changeOfDirection', 'strength', 'jumping', 'stamina', 'durability'],
  },
  {
    label: 'Mental',
    skills: ['footballIq', 'playRecognition', 'decisionMaking', 'composure', 'leadership', 'competitiveness', 'workEthic', 'coachability'],
  },
  {
    label: 'Technique (umbrella)',
    skills: ['technicalSkill', 'handsBallSkills', 'blockingTechnique', 'passRushTechnique', 'coverageTechnique', 'tacklingTechnique'],
  },
  {
    label: 'QB passing',
    forGroups: [PositionGroup.QB],
    skills: ['throwPower', 'accuracyShort', 'accuracyMedium', 'accuracyDeep', 'accuracyLeft', 'accuracyMiddle', 'accuracyRight', 'throwOnRun', 'throwUnderPressure', 'spectacularThrow', 'breakSack', 'playAction'],
  },
  {
    label: 'Ball carrier',
    forGroups: [PositionGroup.QB, PositionGroup.SKILL],
    skills: ['carrying', 'ballCarrierVision', 'jukeMove', 'spinMove', 'stiffArm', 'trucking', 'breakTackle', 'elusiveness'],
  },
  {
    label: 'Receiving',
    forGroups: [PositionGroup.SKILL],
    skills: ['routeShort', 'routeMedium', 'routeDeep', 'releaseVsPress', 'releaseVsOff', 'catching', 'catchInTraffic', 'contestedCatch'],
  },
  {
    label: 'Blocking',
    forGroups: [PositionGroup.OL, PositionGroup.SKILL],
    skills: ['runBlockPower', 'runBlockFinesse', 'passBlockPower', 'passBlockFinesse', 'impactBlock', 'leadBlock'],
  },
  {
    label: 'Pass rush',
    forGroups: [PositionGroup.DL, PositionGroup.LB],
    skills: ['getOff', 'bend', 'handTechnique', 'bullRush', 'longArm', 'pushPull', 'swimMove', 'ripMove', 'spinRush', 'crossChop', 'ghostMove'],
  },
  {
    label: 'Run defense / tackling',
    forGroups: [PositionGroup.DL, PositionGroup.LB, PositionGroup.DB],
    skills: ['blockShedding', 'tackle', 'hitPower', 'pursuit'],
  },
  {
    label: 'Coverage',
    forGroups: [PositionGroup.DB, PositionGroup.LB],
    skills: ['manCoverage', 'zoneCoverage', 'pressCoverage', 'ballSkills'],
  },
  {
    label: 'Special teams',
    forGroups: [PositionGroup.ST],
    skills: ['kickPower', 'kickAccuracy', 'puntPower', 'puntAccuracy'],
  },
];

export const SKILL_LABELS: Record<keyof PlayerSkills, string> = {
  speed: 'Speed',
  acceleration: 'Acceleration',
  agility: 'Agility',
  changeOfDirection: 'Change of direction',
  strength: 'Strength',
  jumping: 'Jumping',
  stamina: 'Stamina',
  durability: 'Durability',
  technicalSkill: 'Technical skill',
  footballIq: 'Football IQ',
  playRecognition: 'Play recognition',
  decisionMaking: 'Decision making',
  handsBallSkills: 'Hands / ball skills',
  blockingTechnique: 'Blocking technique',
  passRushTechnique: 'Pass-rush technique',
  coverageTechnique: 'Coverage technique',
  tacklingTechnique: 'Tackling technique',
  leadership: 'Leadership',
  competitiveness: 'Competitiveness',
  workEthic: 'Work ethic',
  coachability: 'Coachability',
  composure: 'Composure',
  // QB
  throwPower: 'Throw power',
  accuracyShort: 'Accuracy: short',
  accuracyMedium: 'Accuracy: medium',
  accuracyDeep: 'Accuracy: deep',
  accuracyLeft: 'Accuracy: left',
  accuracyMiddle: 'Accuracy: middle',
  accuracyRight: 'Accuracy: right',
  throwOnRun: 'Throw on run',
  throwUnderPressure: 'Throw under pressure',
  spectacularThrow: 'Spectacular throw',
  breakSack: 'Break sack',
  playAction: 'Play action',
  // Ball carrier
  carrying: 'Carrying',
  ballCarrierVision: 'Vision',
  jukeMove: 'Juke move',
  spinMove: 'Spin move',
  stiffArm: 'Stiff arm',
  trucking: 'Trucking',
  breakTackle: 'Break tackle',
  elusiveness: 'Elusiveness',
  // Receiving
  routeShort: 'Route: short',
  routeMedium: 'Route: medium',
  routeDeep: 'Route: deep',
  releaseVsPress: 'Release vs press',
  releaseVsOff: 'Release vs off',
  catching: 'Catching',
  catchInTraffic: 'Catch in traffic',
  contestedCatch: 'Contested catch',
  // Blocking
  runBlockPower: 'Run block: power',
  runBlockFinesse: 'Run block: finesse',
  passBlockPower: 'Pass block: power',
  passBlockFinesse: 'Pass block: finesse',
  impactBlock: 'Impact block',
  leadBlock: 'Lead block',
  // Pass rush
  bullRush: 'Bull rush',
  longArm: 'Long arm',
  pushPull: 'Push/pull',
  swimMove: 'Swim move',
  ripMove: 'Rip move',
  spinRush: 'Spin (rush)',
  crossChop: 'Cross chop',
  ghostMove: 'Ghost / euro',
  getOff: 'Get-off',
  bend: 'Bend',
  handTechnique: 'Hand technique',
  // Run D / tackling
  blockShedding: 'Block shedding',
  tackle: 'Tackle',
  hitPower: 'Hit power',
  pursuit: 'Pursuit',
  // Coverage
  manCoverage: 'Man coverage',
  zoneCoverage: 'Zone coverage',
  pressCoverage: 'Press coverage',
  ballSkills: 'Ball skills (def)',
  // Special teams
  kickPower: 'Kick power',
  kickAccuracy: 'Kick accuracy',
  puntPower: 'Punt power',
  puntAccuracy: 'Punt accuracy',
  specialTeams: 'Coverage craft',
};

export const WATCH_LIST_REASON: Record<WatchListReason, { label: string; description: string; className: string }> = {
  SCHEME_FIT: {
    label: 'scheme fit',
    description: 'Strong archetype match for the team\'s scheme — high projected upside in this system.',
    className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  },
  POSITIONAL_NEED: {
    label: 'positional need',
    description: 'Team is thin at this position group — talent matters more than fit at this slot.',
    className: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  },
  MISCAST_ELEVATION: {
    label: 'miscast elevation',
    description: 'Talented player on a team whose scheme poorly suits them — they\'d elevate in ours. Highest-value target type per Doc 4.',
    className: 'border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-300',
  },
  ROLE_PLAYER: {
    label: 'role player',
    description: 'Observed skill is high relative to tier — could fill a targeted role.',
    className: 'border-zinc-700 bg-zinc-900 text-zinc-300',
  },
};

export const CLASS_YEAR_LABELS: Record<ClassYear, string> = {
  TRUE_FR: 'True FR',
  RS_FR: 'RS FR',
  SO: 'SO',
  JR: 'JR',
  SR: 'SR',
  RS_SR: 'RS SR',
};
