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

/**
 * Combine athletic testing (from the open nflverse combine dataset, joined
 * by draft year + overall pick). These are the raw workout numbers our
 * engine also generates (fortyYardSeconds, benchPress225Reps, …), so they're
 * directly verifiable. Any drill a player skipped is null.
 */
export interface CombineResults {
  /** 40-yard dash, seconds. */
  forty: number | null;
  /** Bench press 225-lb reps. */
  bench: number | null;
  /** Vertical jump, inches. */
  vertical: number | null;
  /** Broad jump, inches. */
  broadJump: number | null;
  /** 3-cone drill, seconds. */
  cone: number | null;
  /** 20-yard shuttle, seconds. */
  shuttle: number | null;
  /** Pro-Football-Reference player id (identity/debug). */
  pfrId: string | null;
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
  /** Combine athletic testing, joined from nflverse (null if no match). */
  combine: CombineResults | null;
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
