import type {
  Owner,
  Gm,
  HeadCoach,
  TeamPersonality,
  FanBaseProfile,
} from '../types/personnel.js';

/**
 * Compute Team Personality per the L/L-01 resolution:
 *
 *   Team Personality = (50% × Owner) + (20% × GM) + (20% × HC) + (10% × Fans)
 *
 * Each of the six output dimensions has a specified component-input
 * formula in the L/L-01 doc. We average within each component
 * (when multiple spectrums contribute) before applying the 50/20/20/10
 * blend.
 *
 * All inputs are 1..10; outputs are also 1..10 by construction.
 *
 * # Recomputation
 *
 * This must be re-called any time a team's owner, GM, HC, or fan-base
 * profile changes. The league simulator drives those events; the
 * recompute itself is cheap enough to run on every change.
 */
export function computeTeamPersonality(
  owner: Owner,
  gm: Gm,
  hc: HeadCoach,
  fans: FanBaseProfile,
): TeamPersonality {
  const o = owner.spectrums;
  const g = gm.spectrums;
  const h = hc.spectrums;

  return {
    riskTolerance: blend({
      owner: o.riskTolerance,
      gm: avg(g.tradeAggressiveness, g.draftConviction),
      hc: avg(h.playCallingAggression, h.schemeFlexibility),
      fan: fans.riskTolerance,
    }),
    analyticsOrientation: blend({
      owner: avg(o.footballKnowledge, o.involvement),
      gm: g.analyticsReliance,
      hc: avg(h.adaptability, h.gameManagement),
      fan: fans.analyticsOrientation,
    }),
    patienceLevel: blend({
      owner: o.patience,
      gm: g.patienceUnderPressure,
      hc: avg(h.experience, h.pressureResponse),
      fan: fans.patienceLevel,
    }),
    financialAggressiveness: blend({
      // Owner: high financial commitment OR high legacy motivation drive aggressiveness.
      owner: avg(o.financialCommitment, o.legacyMotivation),
      // GM: low free-agency discipline (i.e. willingness to spend) plus cap savvy
      // means the team can throw money around effectively.
      gm: avg(11 - g.freeAgencyDiscipline, g.capManagement),
      // HC: high player-relationships HCs attract free agents → financial leverage.
      hc: h.playerRelationships,
      fan: fans.financialAggressiveness,
    }),
    championshipUrgency: blend({
      owner: avg(o.legacyMotivation, 11 - o.patience),
      gm: avg(g.tradeAggressiveness, 11 - g.freeAgencyDiscipline),
      hc: avg(h.playCallingAggression, h.pressureResponse),
      fan: fans.championshipUrgency,
    }),
    organizationalStability: blend({
      // Hands-off, low-ego, patient owners contribute to stability.
      owner: avg3(11 - o.involvement, 11 - o.ego, o.patience),
      gm: avg(g.relationshipQuality, g.patienceUnderPressure),
      hc: avg(h.playerRelationships, h.staffDevelopment),
      fan: fans.organizationalStability,
    }),
  };
}

function blend(parts: { owner: number; gm: number; hc: number; fan: number }): number {
  const v = parts.owner * 0.5 + parts.gm * 0.2 + parts.hc * 0.2 + parts.fan * 0.1;
  // Round to nearest tenth so results are clean for tests/inspector but
  // preserve some granularity for downstream consumers. The actual
  // numeric is never displayed; this is for engine-internal sanity.
  return Math.round(v * 10) / 10;
}

function avg(a: number, b: number): number {
  return (a + b) / 2;
}

function avg3(a: number, b: number, c: number): number {
  return (a + b + c) / 3;
}
