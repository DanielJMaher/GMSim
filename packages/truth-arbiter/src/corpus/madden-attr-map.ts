/**
 * Maddeninator M1 CHECKPOINT 1 — the REVIEWED Madden-attribute → PlayerSkills map.
 *
 * Drafted by Ollama embeddings (`madden-attr-draft.ts` → attribute-map-review.json),
 * then reviewed and signed off by Daniel (2026-07-15). The embedding draft's top-1
 * was correct for the direct 1:1 codes; this table records the human decisions on
 * the ambiguous ones and drops the one code with no analog. Consumed by family-1.1
 * roster-shape work once the corpus carries the full per-player attribute set (the
 * year/posGroup scrape currently supplies only OVR + ~5-6 attrs per player).
 *
 * A Madden code maps to an ARRAY of our PlayerSkills keys: usually one, but our
 * blocking + throw-accuracy models split what Madden keeps as a single rating, so
 * those fan out to several (average the split facets when back-projecting).
 */

export const MADDEN_ATTR_MAP: Record<string, readonly string[]> = {
  // --- clean 1:1 (embedding top-1 correct) ---
  SPD: ['speed'],
  ACC: ['acceleration'],
  AGI: ['agility'],
  COD: ['changeOfDirection'],
  STR: ['strength'],
  JMP: ['jumping'],
  CAR: ['carrying'],
  CTH: ['catching'],
  TKL: ['tackle'],
  MCV: ['manCoverage'],
  THP: ['throwPower'],
  TAS: ['accuracyShort'],
  TAM: ['accuracyMedium'],
  TAD: ['accuracyDeep'],
  TOR: ['throwOnRun'],
  TUP: ['throwUnderPressure'],
  KPW: ['kickPower'],
  KAC: ['kickAccuracy'],

  // --- reviewed judgment calls ---
  // AWR (Awareness) → football IQ (over playRecognition); the general-awareness read.
  AWR: ['footballIq'],
  // Madden keeps ONE pass/run block rating; our model splits power vs finesse.
  // Fan out to both facets; average them when back-projecting a single Madden value.
  PBK: ['passBlockPower', 'passBlockFinesse'],
  RBK: ['runBlockPower', 'runBlockFinesse'],
  // THA is legacy-Madden's single "Throw Accuracy" (older years only; superseded by
  // TAS/TAM/TAD in modern data). Map to all three of our range-split accuracies.
  THA: ['accuracyShort', 'accuracyMedium', 'accuracyDeep'],

  // --- no analog (dropped, reviewed) ---
  // KRT = Kick Return (a returner skill). We have no return rating; the embedding
  // guessed kickAccuracy/kickPower, all wrong. Intentionally maps to nothing.
  KRT: [],
};
