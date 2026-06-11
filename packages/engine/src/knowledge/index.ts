/**
 * Knowledge layer — the North Star boundary (docs/NORTH_STAR.md, CLAUDE.md
 * invariant #3).
 *
 * The engine stores ground truth (`Player`, full ratings, hidden ceilings,
 * scout reliability). A *game* UI never reads it. What a game UI reads is this
 * module: attributed, qualitative, source-bylined knowledge — who said what,
 * how firmly, and in words rather than numbers.
 *
 * The raw attributed-observation stores live where their systems live
 * (`types/scout.ts PlayerObservation`, `types/college.ts
 * CollegePlayerObservation` / `CoachVisitObservation`, assembled by
 * `draft/dossier.ts`); this module is the consumption surface over them. The
 * inspector is the sanctioned exception — it reads `ProspectDossier` directly
 * for the perceived/real calibration lens; `ProspectSnapshot` is the
 * game-safe projection of the same assembly.
 *
 * Growing rule: a player-facing surface that needs something not exposed here
 * extends this module — it never imports ground truth around it.
 */

export {
  prospectSnapshot,
  confidenceLabel,
  type ProspectSnapshot,
  type AttributedRemark,
  type ConfidenceLabel,
} from './snapshot.js';

// Front-office knowledge (S3, v0.140): the game-safe hot-seat feed —
// attributed, qualitative heat bands, no seat-pressure numbers.
export {
  hotSeatKnowledge,
  type HotSeatKnowledgeItem,
  type HotSeatKnowledgeOptions,
} from './front-office.js';

// The viewer concept (a team's scouting department, or a media outlet) is
// shared with the dossier assembly.
export type { DossierViewer } from '../draft/dossier.js';
