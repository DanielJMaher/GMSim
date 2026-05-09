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
export type AwardKind = 'MVP' | 'OPOY' | 'DPOY' | 'OROY' | 'DROY' | 'COY';

export interface CareerAward {
  kind: AwardKind;
  /** League season number (1-indexed) the award was earned in. */
  seasonNumber: number;
}
