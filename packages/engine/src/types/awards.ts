/**
 * Year-end award snapshot stored on Player + HeadCoach records so the
 * inspector (and future systems) can show "Patrick Mahomes: 4× MVP"
 * style histories without re-running the league.
 *
 * Player.careerAwards only ever contains player kinds (MVP, OPOY,
 * DPOY, OROY, DROY); HeadCoach.careerAwards only ever contains COY.
 * The shared type is for ergonomics — there's no type-level
 * enforcement of the partition for Phase 2.
 */
export type AwardKind =
  | 'MVP'
  | 'OPOY'
  | 'DPOY'
  | 'OROY'
  | 'DROY'
  | 'COY'
  // Skill Adjudicator (2b): per-position season accolades, multiple winners.
  // A 1st/2nd-team All-Pro is also credited PRO_BOWL (mirrors the NFL), so the
  // PRO_BOWL count is directly comparable to the real probowls metric.
  | 'PRO_BOWL'
  | 'ALL_PRO_1ST'
  | 'ALL_PRO_2ND';

export interface CareerAward {
  kind: AwardKind;
  /** League season number (1-indexed) the award was earned in. */
  seasonNumber: number;
}
