/**
 * Scout-report prose generator (v0.118) — the Scribe, deepened into the engine.
 *
 * Slice 1 (v0.71) gave each take a single headline; the Scribe agent then
 * measured the REAL scouting voice (Beast + PFF): reports run a lead read, a
 * couple of position-specific strengths, an honest concern, and a bottom-line
 * projection — and two outlets do not sound alike (Brugler is long and hedged,
 * PFF is terse and comp-happy). This builds that fuller writeup for the engine,
 * grounded in the Scribe's measured fingerprints:
 *
 *   - VOICE by outlet hype. A loud outlet (hypeSpectrum ≥ 6) reaches for
 *     intensifiers ("rare", "elite") and a bolder projection; a measured outlet
 *     stays grounded and hedges ("projects as", "should").
 *   - POSITION-AWARE strengths. Reuses the per-position trait vocabulary so a QB
 *     report cites pocket/arm and an EDGE report cites bend/first-step.
 *   - An HONEST concern always present. A report with no weakness is hype, not
 *     scouting — so every body carries one (loud outlets soften it).
 *   - An occasional archetype-style COMP ("in the mold of a prototypical move
 *     tight end"). No real NFL names (engine purity); honors the measured comp
 *     rate without a name pool. (A generated-legend name pool is a future slice.)
 *
 * Per North Star: observable media output, but QUALITATIVE only — never cites a
 * true rating / grade / tier number. Deterministic from the supplied PRNG.
 */

import type { Prng } from '../prng/index.js';
import type { CollegePlayer } from '../types/college.js';
import type { MediaOutlet, ScoutReportBody } from '../types/media.js';
import { getArchetypeById } from '../archetypes/index.js';
import { scoutTraitsFor } from './scout-vocabulary.js';

// Lead reads — frame the prospect at his projected position. `{pos}` only.
const SUMMARY_TEMPLATES: readonly string[] = [
  'On tape, {name} looks the part at {pos}.',
  '{name} is a {pos} who shows up when you turn the tape on.',
  "There's a real NFL projection here at {pos}.",
  '{name} plays the {pos} spot the way the league is trending.',
];

// Strength lead-ins. Measured stays plain; loud reaches for the hype register
// (matching the Scribe's higher PFF/loud intensifier rate). Each is followed by
// a bare trait noun phrase, e.g. "flashes corner-bending ability".
export const STRENGTH_LEADS_MEASURED: readonly string[] = [
  'flashes',
  'shows natural',
  'plays with real',
  'wins with',
  'has clear',
];
export const STRENGTH_LEADS_LOUD: readonly string[] = [
  'has rare',
  'shows elite',
  'flashes special',
  'plays with explosive',
  'flat-out wins with',
];

// Concern phrasings. Measured states it plainly; loud minimizes it. `{trait}`.
const CONCERN_MEASURED: readonly string[] = [
  'Needs to clean up his {trait}.',
  'Can be inconsistent with his {trait}.',
  'Questions remain about the {trait}.',
  'Has to prove the {trait} holds up against better competition.',
];
const CONCERN_LOUD: readonly string[] = [
  'The only nit is the odd lapse in {trait} — nothing that scares you.',
  "You'd like more polish in his {trait}, but that's coaching.",
  'If you push, the {trait} can come and go — minor stuff.',
];

// Bottom-line projections. Qualitative buzz — no true tier leak.
const BOTTOM_MEASURED: readonly string[] = [
  'Projects as a rotational piece with starter upside.',
  'A mid-round value who fits a patient room.',
  'The kind of bet that pays off in year two.',
  'Should carve out a role if the development hits.',
];
const BOTTOM_LOUD: readonly string[] = [
  "Don't be shocked when he's a steal of this class.",
  'This is starter talent flying under the radar.',
  'A future starter — bank it.',
  'Someone is going to look very smart for taking him early.',
];

const COMP_ADJECTIVES: readonly string[] = ['prototypical', 'classic', 'modern', 'high-floor'];

function fill(template: string, name: string, pos: string, trait: string): string {
  return template
    .replace(/\{name\}/g, name)
    .replace(/\{pos\}/g, pos)
    .replace(/\{trait\}/g, trait);
}

/**
 * Build the fuller scouting writeup for a take. `outlet.hypeSpectrum` drives the
 * voice; the prospect's projected position drives the trait vocabulary; the
 * outlet's loudness drives how often it reaches for a comp.
 */
export function buildScoutReport(
  prng: Prng,
  args: { prospect: CollegePlayer; outlet: MediaOutlet },
): ScoutReportBody {
  const { prospect, outlet } = args;
  const loud = outlet.hypeSpectrum >= 6;
  const name = `${prospect.firstName} ${prospect.lastName}`;
  const pos = prospect.nflProjectedPosition;

  // Two distinct traits → one or two strength bullets (loud outlets write the
  // extra one). Plus a separate trait for the concern.
  const traits = scoutTraitsFor(prng.fork('traits'), pos, 3);
  const strengthLeads = loud ? STRENGTH_LEADS_LOUD : STRENGTH_LEADS_MEASURED;
  const leadPrng = prng.fork('leads');
  const strengthCount = loud ? 2 : 1 + (prng.fork('count').next() < 0.4 ? 1 : 0);
  const strengths: string[] = [];
  for (let i = 0; i < strengthCount && i < traits.length; i++) {
    strengths.push(`${leadPrng.pick(strengthLeads)} ${traits[i]}`.replace(/^./, (c) => c.toUpperCase()));
  }

  // Concern uses the last trait so it never repeats a strength.
  const concernTrait = traits[traits.length - 1] ?? 'his overall game';
  const concern = fill(prng.fork('concern').pick(loud ? CONCERN_LOUD : CONCERN_MEASURED), name, pos, concernTrait);

  const summary = fill(prng.fork('summary').pick(SUMMARY_TEMPLATES), name, pos, traits[0] ?? '');
  const bottomLine = prng.fork('bottom').pick(loud ? BOTTOM_LOUD : BOTTOM_MEASURED);

  // Comp: media reads the ASSUMED archetype (what college coaching is calling
  // him), never the true one. Loud outlets comp more often (PFF-style).
  const compPrng = prng.fork('comp');
  let comp: string | undefined;
  if (compPrng.next() < (loud ? 0.5 : 0.3)) {
    // Keep the archetype label's own case — many carry acronyms ("3-4 Two-Gap
    // DE", "Move TE") that read wrong lowercased.
    const label = getArchetypeById(prospect.assumedArchetype)?.label;
    if (label) comp = `In the mold of a ${compPrng.pick(COMP_ADJECTIVES)} ${label}.`;
  }

  return comp === undefined
    ? { summary, strengths, concern, bottomLine }
    : { summary, strengths, concern, bottomLine, comp };
}
