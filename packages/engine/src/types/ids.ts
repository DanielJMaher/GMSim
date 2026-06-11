// Branded ID types — prevent passing a TeamId where a PlayerId is expected.
// At runtime they are plain strings; at compile time they are distinct.

declare const __brand: unique symbol;
type Brand<K, T> = K & { readonly [__brand]: T };

export type TeamId = Brand<string, 'TeamId'>;
export type PlayerId = Brand<string, 'PlayerId'>;
export type CoachId = Brand<string, 'CoachId'>;
export type OwnerId = Brand<string, 'OwnerId'>;
export type GmId = Brand<string, 'GmId'>;
export type ScoutId = Brand<string, 'ScoutId'>;
export type ContractId = Brand<string, 'ContractId'>;
export type DraftPickId = Brand<string, 'DraftPickId'>;
export type GameId = Brand<string, 'GameId'>;
export type SeasonId = Brand<string, 'SeasonId'>;
export type MediaOutletId = Brand<string, 'MediaOutletId'>;
export type MediaReportId = Brand<string, 'MediaReportId'>;
export type CoordinatorId = Brand<string, 'CoordinatorId'>;

export const TeamId = (s: string): TeamId => s as TeamId;
export const PlayerId = (s: string): PlayerId => s as PlayerId;
export const CoachId = (s: string): CoachId => s as CoachId;
export const OwnerId = (s: string): OwnerId => s as OwnerId;
export const GmId = (s: string): GmId => s as GmId;
export const ScoutId = (s: string): ScoutId => s as ScoutId;
export const ContractId = (s: string): ContractId => s as ContractId;
export const DraftPickId = (s: string): DraftPickId => s as DraftPickId;
export const GameId = (s: string): GameId => s as GameId;
export const SeasonId = (s: string): SeasonId => s as SeasonId;
export const MediaOutletId = (s: string): MediaOutletId => s as MediaOutletId;
export const MediaReportId = (s: string): MediaReportId => s as MediaReportId;
export const CoordinatorId = (s: string): CoordinatorId => s as CoordinatorId;
