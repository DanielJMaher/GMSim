import { Position, PositionGroup } from '../types/enums.js';
import type { PlayerArchetype } from './types.js';

/**
 * Canonical player archetype catalog. Multipliers and skill weights
 * are designer-tunable. See `types.ts` for the interface contract.
 *
 * Source: Player Archetypes by Scheme Identity Design Document.
 * Specific scheme-fit % values track the doc's stated impacts where
 * documented; otherwise filled in to plausibly extend the system.
 *
 * Unspecified scheme-fit defaults to 1.0 (neutral). Skill weights
 * default to 1.0 for unspecified skills.
 */

const OL_POSITIONS = [Position.LT, Position.LG, Position.C, Position.RG, Position.RT] as const;
const DL_INTERIOR = [Position.DT, Position.NT] as const;
const LB_OUTSIDE = [Position.OLB, Position.EDGE] as const;
const DB_CORNERS = [Position.CB, Position.NICKEL] as const;
const DB_SAFETIES = [Position.S] as const;

// ─── QB ARCHETYPES ──────────────────────────────────────────────────────────

const QB_PRECISION_PASSER: PlayerArchetype = {
  id: 'QB_PRECISION_PASSER',
  label: 'West Coast Precision Passer',
  description:
    'Accuracy-first QB with quick release and pocket mobility. Tom Brady (prime), Joe Montana profile.',
  side: 'OFFENSE',
  positionGroup: PositionGroup.QB,
  positions: [Position.QB],
  offensiveSchemeFit: {
    WEST_COAST: 1.4,
    PRO_STYLE: 1.2,
    SPREAD: 1.1,
    AIR_RAID: 0.85,
    RPO_BASED: 0.9,
    RUN_HEAVY_POWER: 1.0,
    MULTIPLE_HYBRID: 1.1,
  },
  skillWeights: {
    technicalSkill: 1.5,
    footballIq: 1.5,
    decisionMaking: 1.5,
    composure: 1.3,
    handsBallSkills: 1.2,
    speed: 0.7,
    strength: 0.7,
  },
};

const QB_VERTICAL_PASSER: PlayerArchetype = {
  id: 'QB_VERTICAL_PASSER',
  label: 'Vertical Field General',
  description:
    'Big-armed downfield passer. Strong-arm, deep accuracy, pocket presence. Aaron Rodgers, Josh Allen, Mahomes profile.',
  side: 'OFFENSE',
  positionGroup: PositionGroup.QB,
  positions: [Position.QB],
  offensiveSchemeFit: {
    AIR_RAID: 1.5,
    SPREAD: 1.25,
    PRO_STYLE: 1.1,
    MULTIPLE_HYBRID: 1.2,
    WEST_COAST: 0.9,
    RPO_BASED: 1.1,
    RUN_HEAVY_POWER: 0.85,
  },
  skillWeights: {
    technicalSkill: 1.5,
    strength: 1.3,
    decisionMaking: 1.2,
    composure: 1.2,
    footballIq: 1.2,
  },
};

const QB_POCKET_PASSER: PlayerArchetype = {
  id: 'QB_POCKET_PASSER',
  label: 'Concept-Master Pocket Passer',
  description:
    'High-IQ pocket QB built for concept-based offenses. Pre/post-snap adjustment master. Peyton Manning, Matt Ryan profile.',
  side: 'OFFENSE',
  positionGroup: PositionGroup.QB,
  positions: [Position.QB],
  offensiveSchemeFit: {
    PRO_STYLE: 1.35,
    WEST_COAST: 1.15,
    AIR_RAID: 1.05,
    MULTIPLE_HYBRID: 1.2,
    SPREAD: 1.0,
    RPO_BASED: 0.85,
    RUN_HEAVY_POWER: 1.0,
  },
  skillWeights: {
    footballIq: 1.6,
    decisionMaking: 1.5,
    technicalSkill: 1.3,
    leadership: 1.3,
    composure: 1.2,
    speed: 0.6,
  },
};

const QB_DUAL_THREAT: PlayerArchetype = {
  id: 'QB_DUAL_THREAT',
  label: 'Dual-Threat RPO Master',
  description:
    'Mobile QB built around RPO and option concepts. Lamar Jackson, Jalen Hurts profile.',
  side: 'OFFENSE',
  positionGroup: PositionGroup.QB,
  positions: [Position.QB],
  offensiveSchemeFit: {
    RPO_BASED: 1.7,
    SPREAD: 1.3,
    MULTIPLE_HYBRID: 1.15,
    AIR_RAID: 1.1,
    PRO_STYLE: 0.85,
    WEST_COAST: 0.9,
    RUN_HEAVY_POWER: 0.85,
  },
  skillWeights: {
    speed: 1.5,
    agility: 1.5,
    decisionMaking: 1.3,
    technicalSkill: 1.1,
    durability: 1.2,
    composure: 1.1,
  },
};

// ─── RB ARCHETYPES ──────────────────────────────────────────────────────────

const RB_POWER_BACK: PlayerArchetype = {
  id: 'RB_POWER_BACK',
  label: 'Power Back',
  description:
    'Downhill bruiser. Goal-line and short-yardage specialist. Derrick Henry, Marshawn Lynch profile.',
  side: 'OFFENSE',
  positionGroup: PositionGroup.SKILL,
  positions: [Position.RB],
  offensiveSchemeFit: {
    RUN_HEAVY_POWER: 1.5,
    PRO_STYLE: 1.15,
    MULTIPLE_HYBRID: 1.05,
    WEST_COAST: 0.95,
    SPREAD: 0.85,
    AIR_RAID: 0.75,
    RPO_BASED: 0.95,
  },
  skillWeights: {
    strength: 1.5,
    durability: 1.4,
    technicalSkill: 1.2,
    speed: 1.0,
    agility: 0.95,
    handsBallSkills: 0.8,
  },
};

const RB_RECEIVING_BACK: PlayerArchetype = {
  id: 'RB_RECEIVING_BACK',
  label: 'Receiving Back',
  description:
    'Pass-catching specialist out of the backfield. Third-down weapon. Christian McCaffrey, Alvin Kamara profile.',
  side: 'OFFENSE',
  positionGroup: PositionGroup.SKILL,
  positions: [Position.RB],
  offensiveSchemeFit: {
    WEST_COAST: 1.3,
    SPREAD: 1.25,
    PRO_STYLE: 1.1,
    MULTIPLE_HYBRID: 1.1,
    RPO_BASED: 1.05,
    AIR_RAID: 0.95,
    RUN_HEAVY_POWER: 0.9,
  },
  skillWeights: {
    handsBallSkills: 1.5,
    agility: 1.4,
    speed: 1.3,
    technicalSkill: 1.2,
    footballIq: 1.2,
    durability: 1.1,
  },
};

const RB_ZONE_RUNNER: PlayerArchetype = {
  id: 'RB_ZONE_RUNNER',
  label: 'Zone-Scheme Runner',
  description:
    'Patient one-cut runner who thrives in outside zone. Vision and burst over raw power. Saquon, Bijan profile.',
  side: 'OFFENSE',
  positionGroup: PositionGroup.SKILL,
  positions: [Position.RB],
  offensiveSchemeFit: {
    SPREAD: 1.4,
    RPO_BASED: 1.35,
    MULTIPLE_HYBRID: 1.15,
    WEST_COAST: 1.1,
    PRO_STYLE: 1.0,
    RUN_HEAVY_POWER: 0.95,
    AIR_RAID: 0.9,
  },
  skillWeights: {
    agility: 1.5,
    speed: 1.3,
    footballIq: 1.3,
    technicalSkill: 1.2,
    handsBallSkills: 1.1,
  },
};

const FB_LEAD_BLOCKER: PlayerArchetype = {
  id: 'FB_LEAD_BLOCKER',
  label: 'Lead-Blocking Fullback',
  description:
    'Old-school FB. Lead blocker, short-yardage thumper, occasional safety-valve receiver.',
  side: 'OFFENSE',
  positionGroup: PositionGroup.SKILL,
  positions: [Position.FB],
  offensiveSchemeFit: {
    RUN_HEAVY_POWER: 1.55,
    PRO_STYLE: 1.15,
    MULTIPLE_HYBRID: 1.0,
    WEST_COAST: 0.95,
    SPREAD: 0.7,
    AIR_RAID: 0.6,
    RPO_BASED: 0.7,
  },
  skillWeights: {
    strength: 1.5,
    blockingTechnique: 1.5,
    durability: 1.3,
    speed: 0.7,
    handsBallSkills: 0.8,
  },
};

// ─── WR ARCHETYPES ──────────────────────────────────────────────────────────

const WR_POSSESSION: PlayerArchetype = {
  id: 'WR_POSSESSION',
  label: 'Possession Route Runner',
  description:
    'Reliable underneath/intermediate WR. Precise routes, strong hands, willing blocker. Edelman, Kupp, Keenan Allen profile.',
  side: 'OFFENSE',
  positionGroup: PositionGroup.SKILL,
  positions: [Position.WR],
  offensiveSchemeFit: {
    WEST_COAST: 1.35,
    PRO_STYLE: 1.2,
    SPREAD: 1.05,
    MULTIPLE_HYBRID: 1.1,
    AIR_RAID: 0.85,
    RPO_BASED: 1.05,
    RUN_HEAVY_POWER: 1.0,
  },
  skillWeights: {
    technicalSkill: 1.5,
    handsBallSkills: 1.5,
    footballIq: 1.3,
    agility: 1.2,
    speed: 1.0,
  },
};

const WR_DEEP_THREAT: PlayerArchetype = {
  id: 'WR_DEEP_THREAT',
  label: 'Vertical Deep Threat',
  description:
    'Burner with size for contested catches. Deep ball specialist. Calvin Johnson, DK Metcalf, Mike Evans profile.',
  side: 'OFFENSE',
  positionGroup: PositionGroup.SKILL,
  positions: [Position.WR],
  offensiveSchemeFit: {
    AIR_RAID: 1.6,
    SPREAD: 1.25,
    MULTIPLE_HYBRID: 1.2,
    PRO_STYLE: 1.1,
    WEST_COAST: 0.85,
    RPO_BASED: 1.0,
    RUN_HEAVY_POWER: 0.9,
  },
  skillWeights: {
    speed: 1.5,
    strength: 1.3,
    handsBallSkills: 1.3,
    technicalSkill: 1.2,
    acceleration: 1.4,
  },
};

const WR_SLOT_TECHNICIAN: PlayerArchetype = {
  id: 'WR_SLOT_TECHNICIAN',
  label: 'Slot Technician',
  description:
    'Quick-twitch slot WR who manipulates leverage. Versatile concept player. Wes Welker, Amon-Ra St. Brown profile.',
  side: 'OFFENSE',
  positionGroup: PositionGroup.SKILL,
  positions: [Position.WR],
  offensiveSchemeFit: {
    PRO_STYLE: 1.35,
    SPREAD: 1.3,
    WEST_COAST: 1.2,
    MULTIPLE_HYBRID: 1.15,
    RPO_BASED: 1.1,
    AIR_RAID: 1.05,
    RUN_HEAVY_POWER: 0.85,
  },
  skillWeights: {
    agility: 1.5,
    technicalSkill: 1.4,
    handsBallSkills: 1.3,
    footballIq: 1.3,
    speed: 1.1,
  },
};

const WR_YAC_SPECIALIST: PlayerArchetype = {
  id: 'WR_YAC_SPECIALIST',
  label: 'YAC Specialist',
  description:
    'Receiver who creates after the catch. Vision, physicality, breakaway speed. Deebo Samuel, Aiyuk profile.',
  side: 'OFFENSE',
  positionGroup: PositionGroup.SKILL,
  positions: [Position.WR],
  offensiveSchemeFit: {
    SPREAD: 1.55,
    MULTIPLE_HYBRID: 1.25,
    WEST_COAST: 1.15,
    RPO_BASED: 1.1,
    PRO_STYLE: 1.0,
    AIR_RAID: 0.95,
    RUN_HEAVY_POWER: 1.0,
  },
  skillWeights: {
    speed: 1.4,
    agility: 1.5,
    strength: 1.3,
    handsBallSkills: 1.2,
    blockingTechnique: 1.1,
  },
};

// ─── TE ARCHETYPES ──────────────────────────────────────────────────────────

const TE_RECEIVING: PlayerArchetype = {
  id: 'TE_RECEIVING',
  label: 'Receiving Tight End',
  description:
    'Big-bodied receiving threat with route-running chops. Mismatch nightmare. Travis Kelce, George Kittle, Mark Andrews profile.',
  side: 'OFFENSE',
  positionGroup: PositionGroup.SKILL,
  positions: [Position.TE],
  offensiveSchemeFit: {
    WEST_COAST: 1.4,
    AIR_RAID: 1.3,
    SPREAD: 1.25,
    MULTIPLE_HYBRID: 1.2,
    PRO_STYLE: 1.15,
    RPO_BASED: 1.1,
    RUN_HEAVY_POWER: 0.9,
  },
  skillWeights: {
    technicalSkill: 1.4,
    handsBallSkills: 1.5,
    footballIq: 1.3,
    speed: 1.2,
    strength: 1.15,
  },
};

const TE_BLOCKING: PlayerArchetype = {
  id: 'TE_BLOCKING',
  label: 'Blocking Tight End',
  description:
    'In-line blocker first. Run-game enabler with safety-valve receiving. Y-tight end build.',
  side: 'OFFENSE',
  positionGroup: PositionGroup.SKILL,
  positions: [Position.TE],
  offensiveSchemeFit: {
    RUN_HEAVY_POWER: 1.45,
    PRO_STYLE: 1.15,
    MULTIPLE_HYBRID: 1.05,
    WEST_COAST: 0.95,
    SPREAD: 0.85,
    AIR_RAID: 0.8,
    RPO_BASED: 0.95,
  },
  skillWeights: {
    blockingTechnique: 1.5,
    strength: 1.4,
    durability: 1.2,
    handsBallSkills: 0.85,
    speed: 0.8,
  },
};

const TE_VERSATILE: PlayerArchetype = {
  id: 'TE_VERSATILE',
  label: 'Versatile Y-Tight End',
  description:
    'Multi-tool TE who can line up inline, in slot, or wide. Erhardt-Perkins / 12-personnel staple. Gronk, Higbee profile.',
  side: 'OFFENSE',
  positionGroup: PositionGroup.SKILL,
  positions: [Position.TE],
  offensiveSchemeFit: {
    PRO_STYLE: 1.4,
    MULTIPLE_HYBRID: 1.3,
    WEST_COAST: 1.2,
    SPREAD: 1.1,
    RPO_BASED: 1.05,
    RUN_HEAVY_POWER: 1.15,
    AIR_RAID: 1.0,
  },
  skillWeights: {
    technicalSkill: 1.3,
    handsBallSkills: 1.3,
    blockingTechnique: 1.25,
    footballIq: 1.3,
    strength: 1.15,
  },
};

// ─── OL ARCHETYPES ──────────────────────────────────────────────────────────

const OL_ZONE_BLOCKER: PlayerArchetype = {
  id: 'OL_ZONE_BLOCKER',
  label: 'Zone-Scheme Lineman',
  description:
    'Athletic, lateral movement, combo-block specialist. Built for outside zone. Jason Kelce profile.',
  side: 'OFFENSE',
  positionGroup: PositionGroup.OL,
  positions: [...OL_POSITIONS],
  offensiveSchemeFit: {
    SPREAD: 1.45,
    RPO_BASED: 1.3,
    WEST_COAST: 1.25,
    MULTIPLE_HYBRID: 1.15,
    AIR_RAID: 1.1,
    PRO_STYLE: 1.05,
    RUN_HEAVY_POWER: 0.85,
  },
  skillWeights: {
    agility: 1.5,
    technicalSkill: 1.4,
    blockingTechnique: 1.4,
    footballIq: 1.3,
    strength: 1.0,
  },
};

const OL_POWER_BLOCKER: PlayerArchetype = {
  id: 'OL_POWER_BLOCKER',
  label: 'Power-Scheme Lineman',
  description:
    'Mass and strength priority. Drive blocker, gap puller. Quenton Nelson profile.',
  side: 'OFFENSE',
  positionGroup: PositionGroup.OL,
  positions: [...OL_POSITIONS],
  offensiveSchemeFit: {
    RUN_HEAVY_POWER: 1.55,
    PRO_STYLE: 1.2,
    MULTIPLE_HYBRID: 1.05,
    WEST_COAST: 1.0,
    SPREAD: 0.85,
    AIR_RAID: 0.85,
    RPO_BASED: 0.95,
  },
  skillWeights: {
    strength: 1.5,
    blockingTechnique: 1.4,
    durability: 1.3,
    technicalSkill: 1.1,
    agility: 0.85,
  },
};

const OL_PASS_PROTECTOR: PlayerArchetype = {
  id: 'OL_PASS_PROTECTOR',
  label: 'Elite Pass Protector',
  description:
    'Premium tackle build — length, quick feet, hand technique. Joe Thomas, Trent Williams profile.',
  side: 'OFFENSE',
  positionGroup: PositionGroup.OL,
  positions: [Position.LT, Position.RT, Position.C],
  offensiveSchemeFit: {
    AIR_RAID: 1.55,
    PRO_STYLE: 1.3,
    SPREAD: 1.25,
    WEST_COAST: 1.2,
    MULTIPLE_HYBRID: 1.2,
    RPO_BASED: 1.15,
    RUN_HEAVY_POWER: 1.05,
  },
  skillWeights: {
    blockingTechnique: 1.5,
    agility: 1.3,
    technicalSkill: 1.3,
    footballIq: 1.2,
    strength: 1.15,
  },
};

// ─── DL ARCHETYPES ──────────────────────────────────────────────────────────

const DL_PENETRATING_DT: PlayerArchetype = {
  id: 'DL_PENETRATING_DT',
  label: '4-3 Penetrating DT',
  description:
    'Single-gap interior disruptor. First-step quickness over mass. Aaron Donald, Chris Jones profile.',
  side: 'DEFENSE',
  positionGroup: PositionGroup.DL,
  positions: [...DL_INTERIOR],
  defensiveSchemeFit: {
    BASE_4_3: 1.6,
    HYBRID_MULTIPLE: 1.25,
    NICKEL_HEAVY_3_3_5: 1.2,
    AGGRESSIVE_BLITZ_PRESS: 1.15,
    COVER_2_SHELL: 1.1,
    BASE_3_4: 0.85,
  },
  skillWeights: {
    acceleration: 1.5,
    passRushTechnique: 1.5,
    technicalSkill: 1.3,
    strength: 1.2,
    agility: 1.2,
  },
};

const DL_NOSE_TACKLE: PlayerArchetype = {
  id: 'DL_NOSE_TACKLE',
  label: '3-4 Nose Tackle',
  description:
    'Two-gap space-eater. Anchors against double teams. Vince Wilfork, D.J. Reader profile.',
  side: 'DEFENSE',
  positionGroup: PositionGroup.DL,
  positions: [Position.NT, Position.DT],
  defensiveSchemeFit: {
    BASE_3_4: 1.7,
    HYBRID_MULTIPLE: 1.15,
    NICKEL_HEAVY_3_3_5: 1.0,
    BASE_4_3: 0.7,
    AGGRESSIVE_BLITZ_PRESS: 0.9,
    COVER_2_SHELL: 0.95,
  },
  skillWeights: {
    strength: 1.6,
    durability: 1.4,
    tacklingTechnique: 1.2,
    technicalSkill: 1.2,
    speed: 0.6,
  },
};

const DL_EDGE_PASS_RUSHER: PlayerArchetype = {
  id: 'DL_EDGE_PASS_RUSHER',
  label: 'Edge Pass Rusher',
  description:
    'Speed off the edge. Bend, hand technique, counter moves. J.J. Watt, Myles Garrett profile.',
  side: 'DEFENSE',
  positionGroup: PositionGroup.DL,
  positions: [Position.EDGE, Position.OLB],
  defensiveSchemeFit: {
    BASE_4_3: 1.5,
    BASE_3_4: 1.45,
    AGGRESSIVE_BLITZ_PRESS: 1.4,
    HYBRID_MULTIPLE: 1.2,
    NICKEL_HEAVY_3_3_5: 1.15,
    COVER_2_SHELL: 1.0,
  },
  skillWeights: {
    speed: 1.5,
    passRushTechnique: 1.5,
    acceleration: 1.5,
    agility: 1.3,
    strength: 1.2,
  },
};

const DL_TWO_GAP_DE: PlayerArchetype = {
  id: 'DL_TWO_GAP_DE',
  label: '3-4 Two-Gap DE',
  description:
    'Big-bodied 5-tech. Holds the point of attack. Cameron Heyward, Calais Campbell profile.',
  side: 'DEFENSE',
  positionGroup: PositionGroup.DL,
  positions: [Position.DT, Position.EDGE],
  defensiveSchemeFit: {
    BASE_3_4: 1.5,
    HYBRID_MULTIPLE: 1.2,
    NICKEL_HEAVY_3_3_5: 1.0,
    BASE_4_3: 0.95,
    AGGRESSIVE_BLITZ_PRESS: 1.0,
    COVER_2_SHELL: 1.0,
  },
  skillWeights: {
    strength: 1.5,
    tacklingTechnique: 1.3,
    technicalSkill: 1.3,
    durability: 1.2,
    passRushTechnique: 1.0,
  },
};

// ─── LB ARCHETYPES ──────────────────────────────────────────────────────────

const LB_4_3_MIKE: PlayerArchetype = {
  id: 'LB_4_3_MIKE',
  label: '4-3 Mike Linebacker',
  description:
    'Athletic middle linebacker. Sideline-to-sideline range, coverage capable. Luke Kuechly profile.',
  side: 'DEFENSE',
  positionGroup: PositionGroup.LB,
  positions: [Position.ILB, Position.OLB],
  defensiveSchemeFit: {
    BASE_4_3: 1.5,
    HYBRID_MULTIPLE: 1.25,
    NICKEL_HEAVY_3_3_5: 1.2,
    COVER_2_SHELL: 1.2,
    AGGRESSIVE_BLITZ_PRESS: 1.1,
    BASE_3_4: 0.95,
  },
  skillWeights: {
    speed: 1.4,
    tacklingTechnique: 1.4,
    coverageTechnique: 1.2,
    leadership: 1.3,
    footballIq: 1.4,
  },
};

const LB_3_4_ILB: PlayerArchetype = {
  id: 'LB_3_4_ILB',
  label: '3-4 Inside Linebacker',
  description:
    'Run-stopping ILB with adequate coverage. Physical, downhill. Ray Lewis, C.J. Mosley profile.',
  side: 'DEFENSE',
  positionGroup: PositionGroup.LB,
  positions: [Position.ILB],
  defensiveSchemeFit: {
    BASE_3_4: 1.55,
    HYBRID_MULTIPLE: 1.2,
    NICKEL_HEAVY_3_3_5: 1.05,
    AGGRESSIVE_BLITZ_PRESS: 1.15,
    BASE_4_3: 1.05,
    COVER_2_SHELL: 1.05,
  },
  skillWeights: {
    tacklingTechnique: 1.5,
    strength: 1.3,
    leadership: 1.3,
    footballIq: 1.4,
    coverageTechnique: 1.0,
  },
};

const LB_COVERAGE: PlayerArchetype = {
  id: 'LB_COVERAGE',
  label: 'Coverage Linebacker',
  description:
    'Athletic LB built for nickel-era pass coverage. Speed and length. Fred Warner, Roquan Smith profile.',
  side: 'DEFENSE',
  positionGroup: PositionGroup.LB,
  positions: [Position.ILB, Position.OLB],
  defensiveSchemeFit: {
    NICKEL_HEAVY_3_3_5: 1.55,
    HYBRID_MULTIPLE: 1.4,
    AGGRESSIVE_BLITZ_PRESS: 1.2,
    COVER_2_SHELL: 1.25,
    BASE_4_3: 1.15,
    BASE_3_4: 1.05,
  },
  skillWeights: {
    speed: 1.5,
    coverageTechnique: 1.5,
    agility: 1.4,
    footballIq: 1.3,
    tacklingTechnique: 1.2,
  },
};

const LB_EDGE_3_4: PlayerArchetype = {
  id: 'LB_EDGE_3_4',
  label: '3-4 Outside Linebacker / Edge',
  description:
    'Standing edge rusher with coverage range. T.J. Watt, Khalil Mack profile.',
  side: 'DEFENSE',
  positionGroup: PositionGroup.LB,
  positions: [...LB_OUTSIDE],
  defensiveSchemeFit: {
    BASE_3_4: 1.6,
    AGGRESSIVE_BLITZ_PRESS: 1.4,
    HYBRID_MULTIPLE: 1.25,
    NICKEL_HEAVY_3_3_5: 1.15,
    BASE_4_3: 1.1,
    COVER_2_SHELL: 0.95,
  },
  skillWeights: {
    passRushTechnique: 1.5,
    speed: 1.4,
    strength: 1.3,
    coverageTechnique: 1.0,
    agility: 1.3,
  },
};

// ─── DB ARCHETYPES ──────────────────────────────────────────────────────────

const DB_PRESS_CB: PlayerArchetype = {
  id: 'DB_PRESS_CB',
  label: 'Press-Man Corner',
  description:
    'Length, physicality, hip flexibility. Designed for man coverage and press disruption. Jalen Ramsey, Stephon Gilmore profile.',
  side: 'DEFENSE',
  positionGroup: PositionGroup.DB,
  positions: [Position.CB],
  defensiveSchemeFit: {
    AGGRESSIVE_BLITZ_PRESS: 1.55,
    BASE_3_4: 1.2,
    BASE_4_3: 1.15,
    HYBRID_MULTIPLE: 1.15,
    NICKEL_HEAVY_3_3_5: 1.1,
    COVER_2_SHELL: 0.85,
  },
  skillWeights: {
    coverageTechnique: 1.5,
    strength: 1.3,
    speed: 1.4,
    agility: 1.3,
    handsBallSkills: 1.2,
  },
};

const DB_ZONE_CB: PlayerArchetype = {
  id: 'DB_ZONE_CB',
  label: 'Zone-Coverage Corner',
  description:
    'Pattern-reading corner with ball skills. Excels in disguise/rotation systems. Asante Samuel, Devin McCourty profile.',
  side: 'DEFENSE',
  positionGroup: PositionGroup.DB,
  positions: [Position.CB],
  defensiveSchemeFit: {
    HYBRID_MULTIPLE: 1.5,
    COVER_2_SHELL: 1.4,
    BASE_4_3: 1.2,
    NICKEL_HEAVY_3_3_5: 1.2,
    BASE_3_4: 1.1,
    AGGRESSIVE_BLITZ_PRESS: 0.85,
  },
  skillWeights: {
    coverageTechnique: 1.5,
    footballIq: 1.5,
    handsBallSkills: 1.4,
    speed: 1.2,
    agility: 1.2,
  },
};

const DB_SLOT_CB: PlayerArchetype = {
  id: 'DB_SLOT_CB',
  label: 'Nickel / Slot Corner',
  description:
    'Quick-twitch slot specialist. Tackles in space, blitzes off the slot. Tyrann Mathieu, Chris Harris Jr. profile.',
  side: 'DEFENSE',
  positionGroup: PositionGroup.DB,
  positions: [...DB_CORNERS],
  defensiveSchemeFit: {
    NICKEL_HEAVY_3_3_5: 1.65,
    HYBRID_MULTIPLE: 1.3,
    AGGRESSIVE_BLITZ_PRESS: 1.25,
    BASE_4_3: 1.05,
    BASE_3_4: 1.05,
    COVER_2_SHELL: 1.1,
  },
  skillWeights: {
    agility: 1.5,
    coverageTechnique: 1.4,
    tacklingTechnique: 1.3,
    footballIq: 1.3,
    speed: 1.2,
  },
};

const DB_BALL_HAWK_S: PlayerArchetype = {
  id: 'DB_BALL_HAWK_S',
  label: 'Single-High Ball-Hawk Safety',
  description:
    'Range, instincts, ball skills. The free safety in single-high or two-high disguise. Earl Thomas, Harrison Smith profile.',
  side: 'DEFENSE',
  positionGroup: PositionGroup.DB,
  positions: [...DB_SAFETIES],
  defensiveSchemeFit: {
    HYBRID_MULTIPLE: 1.55,
    COVER_2_SHELL: 1.35,
    NICKEL_HEAVY_3_3_5: 1.25,
    BASE_4_3: 1.15,
    BASE_3_4: 1.1,
    AGGRESSIVE_BLITZ_PRESS: 1.0,
  },
  skillWeights: {
    speed: 1.4,
    handsBallSkills: 1.4,
    coverageTechnique: 1.4,
    footballIq: 1.5,
    agility: 1.2,
  },
};

const DB_BOX_S: PlayerArchetype = {
  id: 'DB_BOX_S',
  label: 'Box / Strong Safety',
  description:
    'Run-support safety with TE-coverage chops. The big-nickel hybrid. Kam Chancellor, Jamal Adams profile.',
  side: 'DEFENSE',
  positionGroup: PositionGroup.DB,
  positions: [...DB_SAFETIES],
  defensiveSchemeFit: {
    NICKEL_HEAVY_3_3_5: 1.5,
    AGGRESSIVE_BLITZ_PRESS: 1.4,
    BASE_3_4: 1.2,
    BASE_4_3: 1.15,
    HYBRID_MULTIPLE: 1.2,
    COVER_2_SHELL: 1.0,
  },
  skillWeights: {
    tacklingTechnique: 1.5,
    strength: 1.3,
    coverageTechnique: 1.2,
    speed: 1.2,
    footballIq: 1.2,
  },
};

// ─── SPECIAL TEAMS ──────────────────────────────────────────────────────────

const ST_KICKER: PlayerArchetype = {
  id: 'ST_KICKER',
  label: 'Kicker',
  description: 'Placekicker. Field goals, PATs, kickoffs.',
  side: 'SPECIAL_TEAMS',
  positionGroup: PositionGroup.ST,
  positions: [Position.K],
  skillWeights: {
    technicalSkill: 1.6,
    composure: 1.5,
    strength: 1.2,
  },
};

const ST_PUNTER: PlayerArchetype = {
  id: 'ST_PUNTER',
  label: 'Punter',
  description: 'Field-position weapon. Hang time, directional kicking, holder duties.',
  side: 'SPECIAL_TEAMS',
  positionGroup: PositionGroup.ST,
  positions: [Position.P],
  skillWeights: {
    technicalSkill: 1.6,
    composure: 1.4,
    strength: 1.2,
  },
};

const ST_LONG_SNAPPER: PlayerArchetype = {
  id: 'ST_LONG_SNAPPER',
  label: 'Long Snapper',
  description: 'Specialist for FG/punt snaps. Highly specialized but low overall trade value.',
  side: 'SPECIAL_TEAMS',
  positionGroup: PositionGroup.ST,
  positions: [Position.LS],
  skillWeights: {
    technicalSkill: 1.7,
    composure: 1.4,
  },
};

// ─── EXPORTED CATALOG ───────────────────────────────────────────────────────

export const PLAYER_ARCHETYPES: readonly PlayerArchetype[] = [
  // QB
  QB_PRECISION_PASSER,
  QB_VERTICAL_PASSER,
  QB_POCKET_PASSER,
  QB_DUAL_THREAT,
  // RB / FB
  RB_POWER_BACK,
  RB_RECEIVING_BACK,
  RB_ZONE_RUNNER,
  FB_LEAD_BLOCKER,
  // WR
  WR_POSSESSION,
  WR_DEEP_THREAT,
  WR_SLOT_TECHNICIAN,
  WR_YAC_SPECIALIST,
  // TE
  TE_RECEIVING,
  TE_BLOCKING,
  TE_VERSATILE,
  // OL
  OL_ZONE_BLOCKER,
  OL_POWER_BLOCKER,
  OL_PASS_PROTECTOR,
  // DL
  DL_PENETRATING_DT,
  DL_NOSE_TACKLE,
  DL_EDGE_PASS_RUSHER,
  DL_TWO_GAP_DE,
  // LB
  LB_4_3_MIKE,
  LB_3_4_ILB,
  LB_COVERAGE,
  LB_EDGE_3_4,
  // DB
  DB_PRESS_CB,
  DB_ZONE_CB,
  DB_SLOT_CB,
  DB_BALL_HAWK_S,
  DB_BOX_S,
  // ST
  ST_KICKER,
  ST_PUNTER,
  ST_LONG_SNAPPER,
] as const;
