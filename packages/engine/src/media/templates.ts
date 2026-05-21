/**
 * Headline templates for v0.62 team-week reports.
 *
 * Each template is a beat-reporter-style headline with `{slot}`
 * placeholders. Generation picks templates based on the game outcome
 * category (blowout win / blowout loss / OT / close-call / upset /
 * shutout / divisional / playoff) AND the firing outlet's tone
 * affordance.
 *
 * Slot vocabulary:
 *
 *   {team}, {teamAbbr}, {teamNickname}     — winner identifiers
 *   {opp}, {oppAbbr}, {oppNickname}         — loser identifiers
 *   {margin}                                — winning margin (int)
 *   {wScore}, {lScore}                      — points
 *   {streakLen}, {streakKind}               — win/loss streak length+kind
 *   {round}                                 — playoff round name
 *
 * Authenticity hooks: use specific verbs (smother / dismantle /
 * throttle / outlast / steamroll), real-NFL phrasing (statement win,
 * must-win, trap game, gut-check, season on the line), and
 * occasionally include nickname for variety (Bills win → "Buffalo top
 * Patriots" sometimes, "Bills dismantle Patriots" sometimes).
 */

import type { MediaTier, MediaTone } from '../types/media.js';

export interface HeadlineSlots {
  team: string;
  teamAbbr: string;
  teamNickname: string;
  opp: string;
  oppAbbr: string;
  oppNickname: string;
  margin: number;
  wScore: number;
  lScore: number;
  /** Win streak length AT this team (≥3 for the streak templates). */
  streakLen?: number;
  /** "win" or "loss" — narrative direction. */
  streakKind?: 'win' | 'loss';
  /** Playoff round (omitted in regular-season templates). */
  round?: string;
  /** Same-division matchup. */
  isDivisional?: boolean;

  // ─── Player-driven slots (v0.62.1) ───────────────────────────────
  /** Player last name — for headline references. */
  player?: string;
  /** Player position abbreviation (QB, RB, WR, EDGE, etc.). */
  playerPos?: string;
  /** Primary stat value (yards, TDs, sacks, picks). */
  stat?: number;
  /** Secondary stat value (TDs alongside yards, etc.). */
  stat2?: number;
}

export interface HeadlineTemplate {
  pattern: string;
  tone: MediaTone;
  /** Min hype required for an outlet to pick this template. */
  minHype?: number;
  /** Max hype — restrained templates score themselves out for radio. */
  maxHype?: number;
  /** Tiers that prefer this template (others can still pick it but weight lower). */
  preferredTiers?: readonly MediaTier[];
  /**
   * Distinctive-phrase tag (v0.62.1). The report pipeline tracks
   * signatures used in a single tick and won't fire two templates
   * with the same signature in the same week. Use stable lowercase
   * tokens for the dominant verb/phrase ("grind", "dismantle",
   * "gut-check"). Templates with no signature have no uniqueness
   * constraint — useful for generic patterns like "{team} top {opp}".
   */
  signature?: string;
}

// ─── Regular-season templates ───────────────────────────────────────────

/** Blowout win (margin ≥ 17 in regular season). */
export const BLOWOUT_WIN_TEMPLATES: readonly HeadlineTemplate[] = [
  { pattern: '{team} dismantle {opp} {wScore}-{lScore}', tone: 'POSITIVE', preferredTiers: ['BEAT', 'COLUMNIST'], signature: 'dismantle' },
  { pattern: '{team} steamroll {opp} {wScore}-{lScore}', tone: 'POSITIVE', minHype: 4, signature: 'steamroll' },
  { pattern: '{team} throttle {opp} in {margin}-point rout', tone: 'POSITIVE', signature: 'throttle' },
  { pattern: '{team} maul {opp} {wScore}-{lScore}', tone: 'POSITIVE', minHype: 5, signature: 'maul' },
  { pattern: '{team} thump {opp} {wScore}-{lScore}', tone: 'POSITIVE', signature: 'thump' },
  { pattern: '{team} send a message in {wScore}-{lScore} demolition of {opp}', tone: 'POSITIVE', minHype: 5, signature: 'demolition' },
  { pattern: 'Statement win: {team} blow out {opp} {wScore}-{lScore}', tone: 'POSITIVE', minHype: 4, signature: 'statement' },
  { pattern: '{teamNickname} pound {oppNickname} {wScore}-{lScore} — no contest', tone: 'POSITIVE', minHype: 5, preferredTiers: ['RADIO', 'BLOG'], signature: 'pound' },
  { pattern: 'A clinic: {team} run away from {opp} for {margin}-point win', tone: 'POSITIVE', preferredTiers: ['BEAT', 'COLUMNIST'], signature: 'clinic' },
  { pattern: '{team} flex muscles in {wScore}-{lScore} drubbing of {opp}', tone: 'POSITIVE', minHype: 6, signature: 'drubbing' },
  { pattern: '{teamAbbr} rolls {oppAbbr} {wScore}-{lScore}', tone: 'POSITIVE', maxHype: 6, signature: 'rolls' },
  { pattern: '{team} embarrass {opp} on the way to {margin}-point win', tone: 'POSITIVE', minHype: 7, signature: 'embarrass' },
  { pattern: '{team} cruise past {opp} {wScore}-{lScore}', tone: 'POSITIVE', signature: 'cruise' },
  { pattern: 'Wire-to-wire: {team} dominate {opp} {wScore}-{lScore}', tone: 'POSITIVE', minHype: 5, signature: 'wire-to-wire' },
  { pattern: '{team} bury {opp} {wScore}-{lScore}', tone: 'POSITIVE', minHype: 5, signature: 'bury' },
  { pattern: '{team} ride roughshod over {opp}, {wScore}-{lScore}', tone: 'POSITIVE', minHype: 5, signature: 'roughshod' },
];

/** Blowout loss (margin ≥ 17, from loser's perspective). */
export const BLOWOUT_LOSS_TEMPLATES: readonly HeadlineTemplate[] = [
  { pattern: '{team} flattened by {opp} in {lScore}-{wScore} disaster', tone: 'CRITICAL', minHype: 5, signature: 'flattened' },
  { pattern: '{team} embarrassed in {margin}-point loss to {opp}', tone: 'CRITICAL', preferredTiers: ['BEAT', 'COLUMNIST'], signature: 'embarrassed' },
  { pattern: 'No-show: {team} fall flat in {lScore}-{wScore} loss to {opp}', tone: 'CRITICAL', minHype: 6, preferredTiers: ['RADIO', 'BLOG'], signature: 'no-show' },
  { pattern: '{teamAbbr} drop {lScore}-{wScore} decision to {opp}', tone: 'NEUTRAL', maxHype: 5, preferredTiers: ['BEAT'] },
  { pattern: '{team} blown out, {lScore}-{wScore}, in worst showing of the season', tone: 'CRITICAL', minHype: 5, signature: 'worst-showing' },
  { pattern: '{team} have no answer for {opp} in {margin}-point shellacking', tone: 'CRITICAL', minHype: 4, signature: 'shellacking' },
  { pattern: 'Ugly: {teamNickname} routed {lScore}-{wScore} by {oppNickname}', tone: 'CRITICAL', minHype: 7, signature: 'routed' },
  { pattern: '{team} dominated by {opp} {wScore}-{lScore}', tone: 'NEUTRAL', maxHype: 5, preferredTiers: ['BEAT'], signature: 'dominated' },
  { pattern: 'Fans head for the exits as {team} drop {lScore}-{wScore} game to {opp}', tone: 'CRITICAL', minHype: 7, preferredTiers: ['RADIO', 'BLOG'], signature: 'exits' },
  { pattern: '{team} pummeled by {opp}, {lScore}-{wScore}', tone: 'CRITICAL', signature: 'pummeled' },
  { pattern: '{team} have nothing for {opp} in {lScore}-{wScore} loss', tone: 'CRITICAL', minHype: 4, signature: 'nothing-for' },
  { pattern: '{team} pulverized by {opp}, {lScore}-{wScore}', tone: 'CRITICAL', minHype: 6, signature: 'pulverized' },
  { pattern: 'Blowout city: {teamAbbr} fall {lScore}-{wScore} to {oppAbbr}', tone: 'CRITICAL', minHype: 6, signature: 'blowout-city' },
  { pattern: '{team} swept aside by {opp}, {lScore}-{wScore}', tone: 'CRITICAL', minHype: 4, signature: 'swept-aside' },
];

/** Close win (margin ≤ 3). */
export const CLOSE_WIN_TEMPLATES: readonly HeadlineTemplate[] = [
  { pattern: '{team} outlast {opp} {wScore}-{lScore}', tone: 'POSITIVE', signature: 'outlast' },
  { pattern: '{team} edge {opp} in {wScore}-{lScore} nailbiter', tone: 'POSITIVE', signature: 'nailbiter' },
  { pattern: '{team} survive {opp}, {wScore}-{lScore}', tone: 'POSITIVE', maxHype: 7, preferredTiers: ['BEAT'], signature: 'survive' },
  { pattern: '{team} grind out {wScore}-{lScore} win over {opp}', tone: 'POSITIVE', signature: 'grind' },
  { pattern: 'Gut-check win: {team} hold off {opp} {wScore}-{lScore}', tone: 'POSITIVE', minHype: 4, signature: 'gut-check' },
  { pattern: '{teamAbbr} escape {oppAbbr} with {margin}-point win', tone: 'POSITIVE', minHype: 5, signature: 'escape' },
  { pattern: '{team} pull out white-knuckle {wScore}-{lScore} win over {opp}', tone: 'POSITIVE', minHype: 6, signature: 'white-knuckle' },
  { pattern: 'Down to the wire: {team} beat {opp} {wScore}-{lScore}', tone: 'POSITIVE', signature: 'down-to-the-wire' },
  { pattern: '{team} hang on to top {opp} by {margin}', tone: 'POSITIVE', preferredTiers: ['BEAT', 'COLUMNIST'], signature: 'hang-on' },
  { pattern: '{team} squeak by {opp}, {wScore}-{lScore}', tone: 'POSITIVE', signature: 'squeak-by' },
  { pattern: '{team} hold off late charge from {opp}, win {wScore}-{lScore}', tone: 'POSITIVE', signature: 'late-charge' },
  { pattern: 'Photo finish: {team} edge {opp} {wScore}-{lScore}', tone: 'POSITIVE', minHype: 4, signature: 'photo-finish' },
  { pattern: '{team} fend off {opp} for {wScore}-{lScore} win', tone: 'POSITIVE', signature: 'fend-off' },
];

/** Close loss (margin ≤ 3). */
export const CLOSE_LOSS_TEMPLATES: readonly HeadlineTemplate[] = [
  { pattern: '{team} fall just short against {opp}, {lScore}-{wScore}', tone: 'NEUTRAL', signature: 'fall-short' },
  { pattern: '{team} drop heartbreaker to {opp}, {lScore}-{wScore}', tone: 'CRITICAL', minHype: 5, signature: 'heartbreaker' },
  { pattern: '{teamAbbr} edged by {opp} in {margin}-point loss', tone: 'NEUTRAL', preferredTiers: ['BEAT'], signature: 'edged' },
  { pattern: '{team} let one slip away: {lScore}-{wScore} loss to {opp}', tone: 'CRITICAL', minHype: 5, signature: 'slip-away' },
  { pattern: '{team} can\'t finish, fall to {opp} {lScore}-{wScore}', tone: 'CRITICAL', minHype: 4, signature: 'cant-finish' },
  { pattern: 'So close: {team} drop {lScore}-{wScore} decision to {opp}', tone: 'NEUTRAL', signature: 'so-close' },
  { pattern: '{team} done in by {opp} late, {lScore}-{wScore}', tone: 'NEUTRAL', preferredTiers: ['BEAT', 'COLUMNIST'], signature: 'done-in-late' },
  { pattern: 'Painful: {teamAbbr} fall by {margin} to {oppAbbr}', tone: 'CRITICAL', minHype: 7, preferredTiers: ['RADIO', 'BLOG'], signature: 'painful' },
  { pattern: '{team} stumble at the finish in {lScore}-{wScore} loss to {opp}', tone: 'CRITICAL', minHype: 5, signature: 'stumble-finish' },
  { pattern: '{team} unable to close out {opp}, {lScore}-{wScore}', tone: 'CRITICAL', minHype: 4, signature: 'unable-close' },
  { pattern: 'One play short: {team} lose to {opp} {lScore}-{wScore}', tone: 'CRITICAL', minHype: 5, signature: 'one-play' },
];

/** Mid-margin win (4-16 points). */
export const STANDARD_WIN_TEMPLATES: readonly HeadlineTemplate[] = [
  { pattern: '{team} top {opp} {wScore}-{lScore}', tone: 'POSITIVE', preferredTiers: ['BEAT'] },
  { pattern: '{team} handle {opp} in {wScore}-{lScore} win', tone: 'POSITIVE', signature: 'handle' },
  { pattern: '{team} put away {opp} {wScore}-{lScore}', tone: 'POSITIVE', preferredTiers: ['BEAT', 'COLUMNIST'], signature: 'put-away' },
  { pattern: '{teamAbbr} take down {oppAbbr} {wScore}-{lScore}', tone: 'POSITIVE', preferredTiers: ['RADIO', 'BLOG'], signature: 'take-down' },
  { pattern: '{team} take care of {opp}, {wScore}-{lScore}', tone: 'POSITIVE', signature: 'take-care' },
  { pattern: '{team} pull away from {opp} for {wScore}-{lScore} win', tone: 'POSITIVE', signature: 'pull-away' },
  { pattern: '{team} dispatch {opp} {wScore}-{lScore}', tone: 'POSITIVE', preferredTiers: ['BEAT', 'COLUMNIST'], signature: 'dispatch' },
  { pattern: '{teamNickname} handle business: {wScore}-{lScore} over {opp}', tone: 'POSITIVE', minHype: 5, signature: 'handle-business' },
  { pattern: '{team} dispatch {opp} in {wScore}-{lScore} win', tone: 'POSITIVE', signature: 'dispatch-2' },
  { pattern: '{team} send {opp} home {wScore}-{lScore}', tone: 'POSITIVE', minHype: 4, signature: 'send-home' },
  { pattern: '{team} clip {opp} {wScore}-{lScore}', tone: 'POSITIVE', signature: 'clip' },
  { pattern: '{team} best {opp} {wScore}-{lScore}', tone: 'POSITIVE', preferredTiers: ['BEAT', 'COLUMNIST'], signature: 'best' },
  { pattern: '{teamAbbr} get past {oppAbbr} {wScore}-{lScore}', tone: 'POSITIVE', signature: 'get-past' },
];

/** Mid-margin loss. */
export const STANDARD_LOSS_TEMPLATES: readonly HeadlineTemplate[] = [
  { pattern: '{team} fall to {opp}, {lScore}-{wScore}', tone: 'NEUTRAL', preferredTiers: ['BEAT'] },
  { pattern: '{team} drop {lScore}-{wScore} game to {opp}', tone: 'NEUTRAL' },
  { pattern: '{teamAbbr} can\'t answer {oppAbbr} in {margin}-point loss', tone: 'CRITICAL', minHype: 5, signature: 'cant-answer' },
  { pattern: '{team} held back by {opp} in {lScore}-{wScore} loss', tone: 'NEUTRAL', preferredTiers: ['BEAT', 'COLUMNIST'], signature: 'held-back' },
  { pattern: '{team} drop another: {lScore}-{wScore} loss to {opp}', tone: 'CRITICAL', minHype: 5, signature: 'drop-another' },
  { pattern: '{team} run out of gas vs {opp} {lScore}-{wScore}', tone: 'CRITICAL', minHype: 5, signature: 'run-out-gas' },
  { pattern: '{teamNickname} fall short, {lScore}-{wScore}, to {oppNickname}', tone: 'NEUTRAL', signature: 'fall-short-mid' },
  { pattern: '{team} outclassed by {opp} in {lScore}-{wScore} defeat', tone: 'CRITICAL', minHype: 6, signature: 'outclassed' },
  { pattern: '{team} stymied by {opp} in {lScore}-{wScore} loss', tone: 'NEUTRAL', preferredTiers: ['BEAT'], signature: 'stymied' },
  { pattern: '{team} have no rhythm in {lScore}-{wScore} loss to {opp}', tone: 'CRITICAL', minHype: 5, signature: 'no-rhythm' },
  { pattern: '{teamAbbr} beaten {lScore}-{wScore} by {oppAbbr}', tone: 'NEUTRAL', preferredTiers: ['BEAT'] },
  { pattern: '{team} sent packing by {opp} {lScore}-{wScore}', tone: 'CRITICAL', minHype: 5, signature: 'sent-packing' },
  { pattern: 'Quiet day for {team} in {lScore}-{wScore} loss to {opp}', tone: 'NEUTRAL', preferredTiers: ['BEAT', 'COLUMNIST'], signature: 'quiet-day' },
];

/** Win streak ≥ 3. */
export const WIN_STREAK_TEMPLATES: readonly HeadlineTemplate[] = [
  { pattern: '{team} make it {streakLen} straight, beating {opp} {wScore}-{lScore}', tone: 'POSITIVE', signature: 'streak-straight' },
  { pattern: '{streakLen} in a row: {team} dispatch {opp} {wScore}-{lScore}', tone: 'POSITIVE', minHype: 5, signature: 'in-a-row' },
  { pattern: '{teamAbbr} rolling: {streakLen}-game win streak after {wScore}-{lScore} over {opp}', tone: 'POSITIVE', minHype: 6, signature: 'rolling' },
  { pattern: 'Hot streak: {team} push it to {streakLen} with {wScore}-{lScore} win over {opp}', tone: 'POSITIVE', minHype: 4, signature: 'hot-streak' },
  { pattern: '{team} keep rolling, beating {opp} {wScore}-{lScore} for {streakLen}th straight', tone: 'POSITIVE', signature: 'keep-rolling' },
  { pattern: 'Who\'s going to stop them? {team} win their {streakLen}th in a row', tone: 'POSITIVE', minHype: 7, preferredTiers: ['RADIO', 'BLOG'], signature: 'whos-stopping' },
  { pattern: '{teamNickname} on fire: {streakLen} straight wins after taking down {opp}', tone: 'POSITIVE', minHype: 5, signature: 'on-fire' },
  { pattern: '{team} extend streak to {streakLen} with {wScore}-{lScore} win over {opp}', tone: 'POSITIVE', signature: 'extend-streak' },
  { pattern: 'Cant be stopped: {teamAbbr} win {streakLen}th straight', tone: 'POSITIVE', minHype: 7, signature: 'cant-stopped' },
];

/** Loss streak ≥ 3. */
export const LOSS_STREAK_TEMPLATES: readonly HeadlineTemplate[] = [
  { pattern: '{team} drop {streakLen}th straight in {lScore}-{wScore} loss to {opp}', tone: 'CRITICAL', signature: 'streak-drop' },
  { pattern: 'Skid extends: {team} fall to {opp}, now lost {streakLen} in a row', tone: 'CRITICAL', minHype: 5, signature: 'skid-extends' },
  { pattern: 'Where does it stop? {teamAbbr} drop {streakLen}th in a row', tone: 'CRITICAL', minHype: 7, preferredTiers: ['RADIO', 'BLOG'], signature: 'where-stop' },
  { pattern: '{team} on a {streakLen}-game slide after {lScore}-{wScore} loss to {opp}', tone: 'CRITICAL', signature: 'slide' },
  { pattern: 'Free-fall: {teamNickname} lose {streakLen}th straight', tone: 'CRITICAL', minHype: 6, signature: 'free-fall' },
  { pattern: '{streakLen} losses and counting: {team} drop another to {opp}', tone: 'CRITICAL', minHype: 5, signature: 'and-counting' },
  { pattern: '{team} can\'t find a way out — {streakLen} straight losses', tone: 'CRITICAL', minHype: 6, signature: 'find-way-out' },
  { pattern: '{team} sink to {streakLen}-game losing streak after dropping {lScore}-{wScore} to {opp}', tone: 'CRITICAL', signature: 'sink' },
  { pattern: 'Spiraling: {teamAbbr} drop {streakLen}th in a row', tone: 'CRITICAL', minHype: 6, signature: 'spiraling' },
];

/** Shutout win. */
export const SHUTOUT_WIN_TEMPLATES: readonly HeadlineTemplate[] = [
  { pattern: '{team} shut out {opp}, {wScore}-0', tone: 'POSITIVE', signature: 'shut-out' },
  { pattern: '{teamAbbr} defense dominant in {wScore}-0 shutout of {opp}', tone: 'POSITIVE', minHype: 4, signature: 'defense-dominant' },
  { pattern: '{team} pitch a shutout, blanking {opp} {wScore}-0', tone: 'POSITIVE', signature: 'pitch-shutout' },
  { pattern: 'Lights out: {teamNickname} shut down {opp} {wScore}-0', tone: 'POSITIVE', minHype: 5, signature: 'lights-out' },
  { pattern: '{team} defense smothers {opp} in {wScore}-0 win', tone: 'POSITIVE', signature: 'smother' },
  { pattern: '{team} blank {opp} {wScore}-0', tone: 'POSITIVE', signature: 'blank' },
  { pattern: '{team} hold {opp} scoreless in {wScore}-0 win', tone: 'POSITIVE', signature: 'scoreless' },
];

/** Divisional matchup (regular season, when teams share a division). */
export const DIVISIONAL_WIN_TEMPLATES: readonly HeadlineTemplate[] = [
  { pattern: '{team} top division rival {opp} {wScore}-{lScore}', tone: 'POSITIVE', signature: 'div-rival-top' },
  { pattern: '{team} take care of division business, {wScore}-{lScore} over {opp}', tone: 'POSITIVE', signature: 'div-business' },
  { pattern: 'Division dust-up: {team} beat {opp} {wScore}-{lScore}', tone: 'POSITIVE', minHype: 4, signature: 'div-dust-up' },
  { pattern: '{team} hand {opp} another division loss, {wScore}-{lScore}', tone: 'POSITIVE', signature: 'div-hand-loss' },
  { pattern: 'Important one in the books: {team} top {opp} in division clash', tone: 'POSITIVE', preferredTiers: ['BEAT', 'COLUMNIST'], signature: 'div-books' },
  { pattern: '{teamNickname} build division lead with {wScore}-{lScore} win over {opp}', tone: 'POSITIVE', minHype: 4, signature: 'div-lead' },
  { pattern: 'Inside the division: {team} top {opp} {wScore}-{lScore}', tone: 'POSITIVE', signature: 'div-inside' },
];

export const DIVISIONAL_LOSS_TEMPLATES: readonly HeadlineTemplate[] = [
  { pattern: '{team} fall to division rival {opp}, {lScore}-{wScore}', tone: 'CRITICAL', signature: 'div-fall-rival' },
  { pattern: 'Costly: {team} drop division game to {opp}, {lScore}-{wScore}', tone: 'CRITICAL', minHype: 4, signature: 'div-costly' },
  { pattern: '{team} lose ground in division — {lScore}-{wScore} loss to {opp}', tone: 'CRITICAL', signature: 'div-lose-ground' },
  { pattern: '{teamAbbr} drop {oppAbbr} matchup, {lScore}-{wScore}, in tough division loss', tone: 'CRITICAL', preferredTiers: ['BEAT', 'COLUMNIST'], signature: 'div-tough-loss' },
  { pattern: '{team} fall to {opp} in critical division clash', tone: 'CRITICAL', minHype: 5, signature: 'div-critical' },
  { pattern: '{team} slip in division standings after {lScore}-{wScore} loss to {opp}', tone: 'CRITICAL', minHype: 4, signature: 'div-slip-standings' },
];

// ─── Playoff round templates ────────────────────────────────────────────

export const PLAYOFF_WIN_TEMPLATES: readonly HeadlineTemplate[] = [
  { pattern: '{team} advance with {wScore}-{lScore} {round} win over {opp}', tone: 'POSITIVE', signature: 'po-advance' },
  { pattern: '{team} survive {opp} {wScore}-{lScore} in {round}', tone: 'POSITIVE', signature: 'po-survive' },
  { pattern: '{teamAbbr} punch ticket: {wScore}-{lScore} over {oppAbbr} in {round}', tone: 'POSITIVE', minHype: 5, signature: 'po-punch-ticket' },
  { pattern: '{team} move on: {wScore}-{lScore} {round} win over {opp}', tone: 'POSITIVE', signature: 'po-move-on' },
  { pattern: '{teamNickname} keep marching, {wScore}-{lScore}, past {opp}', tone: 'POSITIVE', minHype: 4, signature: 'po-marching' },
  { pattern: '{team} take {round} clash from {opp}, {wScore}-{lScore}', tone: 'POSITIVE', preferredTiers: ['BEAT', 'COLUMNIST'], signature: 'po-take-clash' },
  { pattern: 'Still standing: {team} beat {opp} {wScore}-{lScore} in {round}', tone: 'POSITIVE', minHype: 5, signature: 'po-still-standing' },
  { pattern: '{team} answer the bell, top {opp} {wScore}-{lScore} in {round}', tone: 'POSITIVE', minHype: 4, signature: 'po-answer-bell' },
  { pattern: '{teamAbbr} on to the next round after {wScore}-{lScore} {round} victory', tone: 'POSITIVE', signature: 'po-next-round' },
];

export const PLAYOFF_LOSS_TEMPLATES: readonly HeadlineTemplate[] = [
  { pattern: '{team} season ends in {round}: {lScore}-{wScore} loss to {opp}', tone: 'CRITICAL', signature: 'po-season-ends' },
  { pattern: '{team} eliminated by {opp} in {round}, {lScore}-{wScore}', tone: 'NEUTRAL', preferredTiers: ['BEAT'], signature: 'po-eliminated' },
  { pattern: 'Heartbreak: {teamAbbr} fall {lScore}-{wScore} to {oppAbbr} in {round}', tone: 'CRITICAL', minHype: 6, signature: 'po-heartbreak' },
  { pattern: 'Final whistle for {team}: {lScore}-{wScore} {round} defeat by {opp}', tone: 'NEUTRAL', signature: 'po-final-whistle' },
  { pattern: '{team} bow out of {round} with {lScore}-{wScore} loss to {opp}', tone: 'NEUTRAL', preferredTiers: ['BEAT'], signature: 'po-bow-out' },
  { pattern: '{teamNickname} run ends: {opp} take {round} matchup {wScore}-{lScore}', tone: 'CRITICAL', signature: 'po-run-ends' },
  { pattern: 'One step too far: {team} lose {round} game {lScore}-{wScore} to {opp}', tone: 'CRITICAL', minHype: 5, signature: 'po-one-step' },
  { pattern: '{team} fall in {round}, {lScore}-{wScore} — offseason questions begin', tone: 'CRITICAL', minHype: 4, signature: 'po-offseason-q' },
];

export const SUPER_BOWL_WIN_TEMPLATES: readonly HeadlineTemplate[] = [
  { pattern: '{team} crowned Super Bowl champions, beating {opp} {wScore}-{lScore}', tone: 'POSITIVE', signature: 'sb-crowned' },
  { pattern: 'Champions: {team} top {opp} {wScore}-{lScore} for the title', tone: 'POSITIVE', minHype: 5, signature: 'sb-champions' },
  { pattern: '{teamNickname} hoist the Lombardi: {wScore}-{lScore} win over {opp}', tone: 'POSITIVE', signature: 'sb-lombardi' },
  { pattern: 'World champs: {team} dethrone {opp} {wScore}-{lScore} in Super Bowl', tone: 'POSITIVE', minHype: 4, signature: 'sb-dethrone' },
  { pattern: '{team} cement legacy with {wScore}-{lScore} Super Bowl win over {opp}', tone: 'POSITIVE', signature: 'sb-cement' },
  { pattern: 'Final answer: {teamAbbr} beat {oppAbbr} {wScore}-{lScore} for the ring', tone: 'POSITIVE', minHype: 5, preferredTiers: ['RADIO', 'BLOG'], signature: 'sb-final-answer' },
  { pattern: 'Champions of the league: {team} hold off {opp} {wScore}-{lScore}', tone: 'POSITIVE', preferredTiers: ['BEAT', 'COLUMNIST'], signature: 'sb-champs-league' },
  { pattern: 'A dynasty\'s arrival? {teamNickname} win Super Bowl, beating {opp} {wScore}-{lScore}', tone: 'POSITIVE', minHype: 6, signature: 'sb-dynasty' },
  { pattern: '{team} take home the title: {wScore}-{lScore} Super Bowl win over {opp}', tone: 'POSITIVE', signature: 'sb-take-home' },
  { pattern: '{teamAbbr} are champions: {wScore}-{lScore} over {oppAbbr} in the big one', tone: 'POSITIVE', minHype: 5, signature: 'sb-big-one' },
];

export const SUPER_BOWL_LOSS_TEMPLATES: readonly HeadlineTemplate[] = [
  { pattern: '{team} fall in Super Bowl: {lScore}-{wScore} loss to {opp}', tone: 'CRITICAL', signature: 'sb-fall' },
  { pattern: 'So close: {teamAbbr} drop title game to {oppAbbr}, {lScore}-{wScore}', tone: 'CRITICAL', minHype: 5, signature: 'sb-so-close' },
  { pattern: 'Heartbreak in February: {team} lose Super Bowl {lScore}-{wScore} to {opp}', tone: 'CRITICAL', minHype: 6, signature: 'sb-heartbreak-feb' },
  { pattern: '{team} come up short in Super Bowl, {lScore}-{wScore} to {opp}', tone: 'NEUTRAL', preferredTiers: ['BEAT'], signature: 'sb-come-short' },
  { pattern: 'One game from glory: {teamNickname} fall {lScore}-{wScore} in Super Bowl', tone: 'CRITICAL', minHype: 5, signature: 'sb-one-from-glory' },
  { pattern: '{team} season ends one win short: {lScore}-{wScore} Super Bowl loss to {opp}', tone: 'CRITICAL', signature: 'sb-one-short' },
  { pattern: 'Title slips away: {team} fall {lScore}-{wScore} to {opp} in Super Bowl', tone: 'CRITICAL', minHype: 5, signature: 'sb-title-slips' },
  { pattern: '{team} runner-up: {lScore}-{wScore} Super Bowl loss to {opp}', tone: 'NEUTRAL', preferredTiers: ['BEAT'], signature: 'sb-runner-up' },
];

// ─── Player-driven templates (v0.62.1) ──────────────────────────────────
//
// These templates use `{player}` for the player's last name and `{stat}`
// for the headline stat value. They MUST only be picked when the
// matching headliner type exists. The report pipeline gates this — a
// `qb-huge-win` headliner unlocks the QB_HUGE_WIN templates only.

/** QB with 300+ passing yards in a win. */
export const QB_HUGE_WIN_TEMPLATES: readonly HeadlineTemplate[] = [
  { pattern: '{player} throws for {stat} as {teamNickname} top {oppNickname} {wScore}-{lScore}', tone: 'POSITIVE', signature: 'qb-throws-for' },
  { pattern: '{player}\'s {stat}-yard day powers {team} past {opp}, {wScore}-{lScore}', tone: 'POSITIVE', signature: 'qb-powers' },
  { pattern: '{player} carves up {oppNickname} secondary for {stat} yards in {team} win', tone: 'POSITIVE', minHype: 4, signature: 'qb-carves' },
  { pattern: 'Big day from {player}: {stat} yards, {stat2} TDs in {wScore}-{lScore} win over {opp}', tone: 'POSITIVE', signature: 'qb-big-day' },
  { pattern: '{player} airs it out for {stat} yards, {teamAbbr} take down {oppAbbr}', tone: 'POSITIVE', signature: 'qb-airs-out' },
  { pattern: '{player} ({stat} yards) leads {team} to {wScore}-{lScore} win over {opp}', tone: 'POSITIVE', signature: 'qb-leads-yards' },
  { pattern: '{stat} from {player}: {teamNickname} beat {oppNickname} {wScore}-{lScore}', tone: 'POSITIVE', signature: 'qb-stat-from' },
];

/** QB with 400+ passing yards. */
export const QB_MONSTER_TEMPLATES: readonly HeadlineTemplate[] = [
  { pattern: '{player} throws for {stat}+ as {teamNickname} bury {oppNickname}', tone: 'POSITIVE', minHype: 4, signature: 'qb-throws-plus' },
  { pattern: '{player} goes off for {stat} yards in {team}\'s {wScore}-{lScore} win over {opp}', tone: 'POSITIVE', signature: 'qb-goes-off' },
  { pattern: 'Monster day for {player}: {stat} yards, {stat2} TDs', tone: 'POSITIVE', minHype: 5, signature: 'qb-monster-day' },
  { pattern: '{player} can\'t be stopped: {stat} yards through the air', tone: 'POSITIVE', minHype: 6, signature: 'qb-cant-stopped' },
  { pattern: '{player} torches {oppNickname} for {stat} yards in {team} win', tone: 'POSITIVE', minHype: 5, signature: 'qb-torches' },
  { pattern: '{player}\'s {stat}-yard masterpiece carries {team} past {opp}', tone: 'POSITIVE', minHype: 5, signature: 'qb-masterpiece' },
  { pattern: '{player} lights it up: {stat} yards, {stat2} TDs in {team} win', tone: 'POSITIVE', minHype: 6, signature: 'qb-lights-up' },
];

/** QB with 3+ TD passes in a win. */
export const QB_MULTI_TD_TEMPLATES: readonly HeadlineTemplate[] = [
  { pattern: '{player} throws {stat} TDs as {teamNickname} beat {oppNickname} {wScore}-{lScore}', tone: 'POSITIVE', signature: 'qb-throws-tds' },
  { pattern: '{player} accounts for {stat} touchdowns in {team}\'s win over {opp}', tone: 'POSITIVE', signature: 'qb-accounts' },
  { pattern: '{stat} TDs from {player}: {teamAbbr} top {oppAbbr} {wScore}-{lScore}', tone: 'POSITIVE', signature: 'qb-tds-from' },
  { pattern: '{player} can\'t miss — {stat} TD passes in {wScore}-{lScore} win', tone: 'POSITIVE', minHype: 5, signature: 'qb-cant-miss' },
  { pattern: '{player} keeps connecting: {stat} TD passes in {team} win', tone: 'POSITIVE', signature: 'qb-connecting' },
  { pattern: 'Touchdown machine: {player} throws {stat} TDs in {wScore}-{lScore} win', tone: 'POSITIVE', minHype: 6, signature: 'qb-td-machine' },
];

/** QB with 3+ INTs in a loss. */
export const QB_BLAME_LOSS_TEMPLATES: readonly HeadlineTemplate[] = [
  { pattern: '{player}\'s {stat} interceptions doom {team} in {lScore}-{wScore} loss to {opp}', tone: 'CRITICAL', signature: 'qb-doom-ints' },
  { pattern: '{stat} picks for {player} as {teamNickname} fall to {oppNickname}', tone: 'CRITICAL', signature: 'qb-picks-as' },
  { pattern: '{player} hands it to {opp}: {stat} INTs in {lScore}-{wScore} loss', tone: 'CRITICAL', minHype: 5, signature: 'qb-hands-to' },
  { pattern: 'Disaster for {player}: {stat} interceptions in {team}\'s loss to {opp}', tone: 'CRITICAL', minHype: 6, signature: 'qb-disaster' },
  { pattern: '{player} can\'t stop turning it over — {stat} picks in {teamAbbr}\'s loss', tone: 'CRITICAL', minHype: 7, preferredTiers: ['RADIO', 'BLOG'], signature: 'qb-cant-stop' },
  { pattern: '{player} self-destructs with {stat} picks in {lScore}-{wScore} loss', tone: 'CRITICAL', minHype: 6, signature: 'qb-self-destruct' },
];

/** QB with 300+ yards but team lost. */
export const QB_LEAD_LOSS_TEMPLATES: readonly HeadlineTemplate[] = [
  { pattern: '{player} throws for {stat} in losing effort, {team} fall to {opp} {lScore}-{wScore}', tone: 'NEUTRAL', signature: 'qb-losing-effort' },
  { pattern: '{stat} yards from {player} not enough as {teamNickname} drop {lScore}-{wScore} game to {opp}', tone: 'NEUTRAL', signature: 'qb-not-enough' },
  { pattern: '{player} ({stat} yards) does what he can in {team} loss', tone: 'NEUTRAL', preferredTiers: ['BEAT', 'COLUMNIST'], signature: 'qb-does-what' },
  { pattern: '{player} solo act: {stat} yards but {team} fall to {opp}', tone: 'NEUTRAL', minHype: 4, signature: 'qb-solo-act' },
];

/** RB with 100+ rushing yards in a win. */
export const RB_BIG_WIN_TEMPLATES: readonly HeadlineTemplate[] = [
  { pattern: '{player} runs for {stat} as {team} beat {opp} {wScore}-{lScore}', tone: 'POSITIVE', signature: 'rb-runs-for' },
  { pattern: '{player}\'s {stat}-yard day fuels {teamNickname} win over {oppNickname}', tone: 'POSITIVE', signature: 'rb-fuels' },
  { pattern: '{player} pounds out {stat} yards in {teamAbbr} win', tone: 'POSITIVE', signature: 'rb-pounds' },
  { pattern: '{player} ({stat} rushing) leads {team} past {opp} {wScore}-{lScore}', tone: 'POSITIVE', signature: 'rb-leads' },
  { pattern: 'Workhorse: {player} carries {team} with {stat} yards', tone: 'POSITIVE', minHype: 4, signature: 'rb-workhorse' },
  { pattern: '{player} powers {team} past {opp} with {stat}-yard day', tone: 'POSITIVE', signature: 'rb-powers' },
];

/** RB with 150+ rushing yards. */
export const RB_MONSTER_TEMPLATES: readonly HeadlineTemplate[] = [
  { pattern: '{player} runs wild for {stat} yards in {team}\'s win', tone: 'POSITIVE', minHype: 4, signature: 'rb-runs-wild' },
  { pattern: '{player} gashes {oppNickname} for {stat} yards, {stat2} TDs', tone: 'POSITIVE', minHype: 5, signature: 'rb-gashes' },
  { pattern: '{player} can\'t be tackled — {stat} yards on the ground for {team}', tone: 'POSITIVE', minHype: 6, signature: 'rb-cant-tackled' },
  { pattern: 'Workhorse day for {player}: {stat} rushing yards in {wScore}-{lScore} win', tone: 'POSITIVE', signature: 'rb-workhorse-day' },
  { pattern: '{player} bulldozes {oppNickname} for {stat} yards', tone: 'POSITIVE', minHype: 5, signature: 'rb-bulldozes' },
];

/** WR/TE with 100+ receiving yards. */
export const WR_BIG_DAY_TEMPLATES: readonly HeadlineTemplate[] = [
  { pattern: '{player} hauls in {stat} yards in {team}\'s {wScore}-{lScore} game vs {opp}', tone: 'POSITIVE', signature: 'wr-hauls' },
  { pattern: '{player}\'s {stat}-yard day a bright spot for {teamAbbr}', tone: 'POSITIVE', signature: 'wr-bright-spot' },
  { pattern: '{player} ({stat} receiving) shines as {team} face {opp}', tone: 'POSITIVE', signature: 'wr-shines' },
  { pattern: 'Big game from {player}: {stat} yards, {stat2} TDs', tone: 'POSITIVE', minHype: 4, signature: 'wr-big-game' },
  { pattern: '{player} torches {oppNickname} secondary for {stat} yards', tone: 'POSITIVE', signature: 'wr-torches' },
  { pattern: '{player} unstoppable: {stat} yards in {team} game vs {opp}', tone: 'POSITIVE', minHype: 5, signature: 'wr-unstoppable' },
];

/** Defender with 3+ sacks. */
export const SACK_STORM_TEMPLATES: readonly HeadlineTemplate[] = [
  { pattern: '{player} terrorizes the backfield in {teamNickname}\'s {wScore}-{lScore} win', tone: 'POSITIVE', minHype: 4, signature: 'sack-terrorize' },
  { pattern: '{player} with {stat} sacks as {team} top {opp}', tone: 'POSITIVE', signature: 'sack-with' },
  { pattern: '{player} lives in the backfield: {stat} sacks in {teamAbbr} win', tone: 'POSITIVE', minHype: 5, signature: 'sack-lives' },
  { pattern: '{stat}-sack day for {player} fuels {team} win over {opp}', tone: 'POSITIVE', signature: 'sack-fuels' },
  { pattern: 'Unblockable: {player} drops the QB {stat} times in {team} win', tone: 'POSITIVE', minHype: 6, signature: 'sack-unblockable' },
  { pattern: '{player} wrecks {oppNickname}\'s pocket — {stat} sacks in {team} win', tone: 'POSITIVE', minHype: 5, signature: 'sack-wrecks' },
];

/** Defender with 2+ INTs. */
export const PICK_STORM_TEMPLATES: readonly HeadlineTemplate[] = [
  { pattern: '{player} picks off {stat} as {team} beat {opp} {wScore}-{lScore}', tone: 'POSITIVE', signature: 'pick-picks-off' },
  { pattern: '{stat} interceptions from {player} key {teamNickname} win', tone: 'POSITIVE', signature: 'pick-key-win' },
  { pattern: '{player} ball-hawks {opp}: {stat} picks in {teamAbbr} win', tone: 'POSITIVE', minHype: 5, signature: 'pick-ball-hawks' },
  { pattern: '{player} jumps everything: {stat} INTs in {team} win', tone: 'POSITIVE', minHype: 5, signature: 'pick-jumps' },
];

/** Anemic-offense loss — team ≤10 points. */
export const ANEMIC_LOSS_TEMPLATES: readonly HeadlineTemplate[] = [
  { pattern: '{player} leads anemic {teamAbbr} offense in {lScore}-{wScore} loss to {opp}', tone: 'CRITICAL', signature: 'anemic-leads' },
  { pattern: '{team} can\'t move the ball: {lScore}-{wScore} loss to {opp}, {player} held in check', tone: 'CRITICAL', signature: 'anemic-move' },
  { pattern: '{stat} points isn\'t going to win it — {team} fall to {opp} {lScore}-{wScore}', tone: 'CRITICAL', minHype: 5, signature: 'anemic-isnt-enough' },
  { pattern: 'Offense stalls again: {teamNickname} score {stat} in loss to {opp}', tone: 'CRITICAL', minHype: 4, signature: 'anemic-stalls' },
  { pattern: 'Where\'s the offense? {team} muster {stat} in {lScore}-{wScore} loss', tone: 'CRITICAL', minHype: 5, signature: 'anemic-wheres' },
];

/**
 * Fill template slots from `HeadlineSlots`. Missing optional slots
 * leave their placeholders blank — but templates SHOULD only use
 * slots they know are present.
 */
export function fillTemplate(template: string, slots: HeadlineSlots): string {
  return template
    .replace(/\{team\}/g, slots.team)
    .replace(/\{teamAbbr\}/g, slots.teamAbbr)
    .replace(/\{teamNickname\}/g, slots.teamNickname)
    .replace(/\{opp\}/g, slots.opp)
    .replace(/\{oppAbbr\}/g, slots.oppAbbr)
    .replace(/\{oppNickname\}/g, slots.oppNickname)
    .replace(/\{margin\}/g, String(slots.margin))
    .replace(/\{wScore\}/g, String(slots.wScore))
    .replace(/\{lScore\}/g, String(slots.lScore))
    .replace(/\{streakLen\}/g, String(slots.streakLen ?? ''))
    .replace(/\{streakKind\}/g, slots.streakKind ?? '')
    .replace(/\{round\}/g, slots.round ?? '')
    .replace(/\{player\}/g, slots.player ?? '')
    .replace(/\{playerPos\}/g, slots.playerPos ?? '')
    .replace(/\{stat\}/g, String(slots.stat ?? ''))
    .replace(/\{stat2\}/g, String(slots.stat2 ?? ''));
}

/**
 * Filter a template pool by the outlet's hype affordance + tier
 * preferences. A high-hype outlet skips low-hype-cap templates;
 * preferred-tier matching gives matching outlets weight.
 */
export function filterTemplatesForOutlet(
  templates: readonly HeadlineTemplate[],
  outletHype: number,
  outletTier: MediaTier,
): HeadlineTemplate[] {
  const matching: HeadlineTemplate[] = [];
  for (const t of templates) {
    if (t.minHype !== undefined && outletHype < t.minHype) continue;
    if (t.maxHype !== undefined && outletHype > t.maxHype) continue;
    matching.push(t);
  }
  const tierMatches = matching.filter(
    (t) => !t.preferredTiers || t.preferredTiers.includes(outletTier),
  );
  return tierMatches.length > 0 ? tierMatches : matching;
}
