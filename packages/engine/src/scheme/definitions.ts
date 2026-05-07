import type {
  OffensiveSchemeArchetype,
  DefensiveSchemeArchetype,
} from '../types/personnel.js';

/**
 * Scheme metadata. Each scheme has structural attributes (tempo, pace,
 * personnel preferences) used by NPC AI to decide what to draft, who to
 * sign, and how to handle scheme transitions.
 *
 * The scheme-fit *math* — how well a player fits a scheme — lives in
 * the Player Archetype catalog (see `packages/engine/src/archetypes/`).
 * This file is the supplementary descriptor layer.
 *
 * Source: Offensive/Defensive Scheme Identity System Design Document
 * (Drive ID `1_iSDl53p2g0EtKO_jGZvV197ZHtoZuSeM8Pmz8CxrsQ`).
 */

export interface OffensiveSchemeDefinition {
  id: OffensiveSchemeArchetype;
  label: string;
  philosophy: string;
  /** 1 = ultra-slow huddle/clock-grinder, 10 = up-tempo no-huddle */
  pace: number;
  /** 1 = pure run-first, 10 = pure pass-first */
  passRunBalance: number;
  /** Notable real-world coordinator/HC examples for designer reference. */
  examples: readonly string[];
}

export interface DefensiveSchemeDefinition {
  id: DefensiveSchemeArchetype;
  label: string;
  philosophy: string;
  /** 1 = pure base/zone-soft, 10 = blitz-heavy/aggressive */
  pressureRate: number;
  /** 1 = single-high (Cover 1/3), 10 = two-high disguise (Quarters/Cover 2) */
  coverageShell: number;
  examples: readonly string[];
}

export const OFFENSIVE_SCHEMES: Record<OffensiveSchemeArchetype, OffensiveSchemeDefinition> = {
  WEST_COAST: {
    id: 'WEST_COAST',
    label: 'West Coast',
    philosophy:
      'Short, horizontal passing within ~10-15 yards of the LOS that stretches the defense and opens up bigger run plays and longer passes. Timing, precision, and quick release.',
    pace: 5,
    passRunBalance: 6,
    examples: ['Bill Walsh', 'Andy Reid', 'Mike Holmgren'],
  },
  AIR_RAID: {
    id: 'AIR_RAID',
    label: 'Air Raid',
    philosophy:
      'Vertical and intermediate passing across the entire field. Forces defenses to defend everything. High pass rate, deep shots, multiple receiver concepts.',
    pace: 8,
    passRunBalance: 9,
    examples: ['Mike Leach', 'Kliff Kingsbury', 'Lincoln Riley'],
  },
  PRO_STYLE: {
    id: 'PRO_STYLE',
    label: 'Pro Style',
    philosophy:
      'Concept-based attack built on flexible groupings of routes (Erhardt-Perkins lineage). Versatile personnel, no-huddle capable, formation adaptability.',
    pace: 5,
    passRunBalance: 5,
    examples: ['Bill Belichick', 'Sean Payton', 'Peyton Manning offenses'],
  },
  RUN_HEAVY_POWER: {
    id: 'RUN_HEAVY_POWER',
    label: 'Run-Heavy / Power',
    philosophy:
      'Establish the run game first, with downhill physical blocking schemes. Play-action and short-pass concepts off run looks. Field-position-conscious.',
    pace: 3,
    passRunBalance: 2,
    examples: ['Mike Vrabel-era Titans', 'Bears under Matt Nagy 2018', 'classic Steelers'],
  },
  SPREAD: {
    id: 'SPREAD',
    label: 'Spread',
    philosophy:
      'Stretch the defense horizontally and vertically with multiple receivers, motion, and tempo. 11-personnel dominance. Speed and separation prioritized.',
    pace: 7,
    passRunBalance: 7,
    examples: ['Sean McVay', 'Ben Johnson', 'Kyle Shanahan offshoots'],
  },
  RPO_BASED: {
    id: 'RPO_BASED',
    label: 'RPO-Based',
    philosophy:
      'Run-Pass Option concepts force defenders into conflict. Mobile QB, intelligent OL, versatile skill players. Tempo + constraint plays.',
    pace: 8,
    passRunBalance: 6,
    examples: ['Andy Reid (Mahomes)', 'Greg Roman (Lamar Jackson)', 'Jalen Hurts offense'],
  },
  MULTIPLE_HYBRID: {
    id: 'MULTIPLE_HYBRID',
    label: 'Multiple / Hybrid',
    philosophy:
      'No single dominant identity — adapts week to week, blends concepts from multiple lineages. High personnel-package variety. Demands intelligent versatile players.',
    pace: 6,
    passRunBalance: 5,
    examples: ['Bill Belichick situationally', 'Doug Pederson', 'modern multiple offenses'],
  },
};

export const DEFENSIVE_SCHEMES: Record<DefensiveSchemeArchetype, DefensiveSchemeDefinition> = {
  BASE_4_3: {
    id: 'BASE_4_3',
    label: '4-3 Base',
    philosophy:
      'Four down linemen + three linebackers. Single-gap penetration, athletic MLB, suited for elite four-man pass rush.',
    pressureRate: 4,
    coverageShell: 5,
    examples: ['Tampa 2 lineage', 'classic Cowboys / 49ers', 'Lovie Smith defenses'],
  },
  BASE_3_4: {
    id: 'BASE_3_4',
    label: '3-4 Base',
    philosophy:
      'Three down linemen + four linebackers, two-gap responsibility up front, flexible LB deployment. Zone-blitz friendly.',
    pressureRate: 6,
    coverageShell: 5,
    examples: ['Dick LeBeau Steelers', 'Bill Belichick early Patriots', 'Wade Phillips'],
  },
  NICKEL_HEAVY_3_3_5: {
    id: 'NICKEL_HEAVY_3_3_5',
    label: 'Nickel-Heavy 3-3-5',
    philosophy:
      'Five-DB base in response to spread offense dominance. Hybrid defenders, athletic LBs, coverage versatility.',
    pressureRate: 5,
    coverageShell: 6,
    examples: ['modern NFL nickel-default defenses', 'Dean Pees', 'modern college-influenced NFL'],
  },
  COVER_2_SHELL: {
    id: 'COVER_2_SHELL',
    label: 'Cover 2 Shell',
    philosophy:
      'Two-deep safety shell. Underneath disciplined coverage. Limits big plays at cost of intermediate windows.',
    pressureRate: 3,
    coverageShell: 9,
    examples: ['Tony Dungy Tampa 2', 'Lovie Smith', 'classic Cover 2'],
  },
  AGGRESSIVE_BLITZ_PRESS: {
    id: 'AGGRESSIVE_BLITZ_PRESS',
    label: 'Aggressive Blitz / Press',
    philosophy:
      'High blitz rate, press man coverage, exotic pressure packages. Demands lockdown corners and creative DC.',
    pressureRate: 9,
    coverageShell: 3,
    examples: ['Brian Flores', 'Steve Spagnuolo', 'Wink Martindale'],
  },
  HYBRID_MULTIPLE: {
    id: 'HYBRID_MULTIPLE',
    label: 'Hybrid / Multiple',
    philosophy:
      'Coverage disguise via two-high shells rotating to Cover 3 / Cover 1. Pre-snap deception, communication-heavy, smart safeties.',
    pressureRate: 5,
    coverageShell: 8,
    examples: ['Vic Fangio', 'Brandon Staley', 'Sean Desai'],
  },
};
