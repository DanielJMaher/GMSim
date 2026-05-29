/** Real-world draft measurables, parsed to numbers (null when missing). */
export interface Measurables {
  /** Height in inches (e.g. 6'5 1/4" → 77.25). */
  heightInches: number | null;
  weightLbs: number | null;
  /** Arm length in inches (e.g. 34 1/2" → 34.5). */
  armInches: number | null;
  handInches: number | null;
  /** Wingspan in inches. */
  wingInches: number | null;
}

/** NFL Next Gen Stats draft profile scores (0-100ish). */
export interface NgsScores {
  production: number | null;
  athleticism: number | null;
  overall: number | null;
}

/** One real drafted player, as scraped from the round tracker page. */
export interface DraftPickRecord {
  year: number;
  round: number;
  /** Order within the round (1-based, DOM order). */
  pickInRound: number;
  /** Across-draft overall pick number when known (null if not parseable). */
  overallPick: number | null;
  /** Drafting team abbreviation (null if not parseable). */
  team: string | null;
  playerName: string;
  position: string | null;
  college: string | null;
  measurables: Measurables;
  scores: NgsScores;
  /** The scout write-up ("PROSPECT ANALYSIS"). */
  analysis: string | null;
  analyst: string | null;
  /** Slug + GUID from the /prospects/{slug}/{guid} link. */
  prospectSlug: string | null;
  prospectId: string | null;
  prospectUrl: string | null;
}

/** The full structured corpus. */
export interface Corpus {
  generatedAt: string;
  years: readonly number[];
  pickCount: number;
  picks: DraftPickRecord[];
}

/** A write-up embedded for semantic retrieval. */
export interface EmbeddedRecord {
  /** Stable key: `${year}-${round}-${pickInRound}`. */
  key: string;
  year: number;
  round: number;
  playerName: string;
  position: string | null;
  /** The text that was embedded (the analysis). */
  text: string;
  vector: number[];
}

export interface EmbeddingIndex {
  generatedAt: string;
  model: string;
  dim: number;
  records: EmbeddedRecord[];
}
