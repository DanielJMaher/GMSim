import type { Prng } from '../prng/index.js';
import type { CollegePlayer } from '../types/college.js';
import type { TalentTier } from '../types/player.js';

/**
 * Per-tier base declaration probability for juniors. Real NFL: elite
 * juniors leave at high rates; tier-3 prospects more often return to
 * improve their stock. Tuned to roughly match real declaration counts:
 *   STAR     ~85% (most elite juniors declare)
 *   STARTER  ~55%
 *   BACKUP   ~25%
 *   FRINGE   ~5%  (FRINGE-tier juniors almost always return — they'd
 *                  be UDFAs at best)
 *
 * Seniors / RS-seniors auto-declare regardless of tier (they're out of
 * eligibility otherwise).
 */
const JR_DECLARATION_RATE: Record<TalentTier, number> = {
  STAR: 0.85,
  STARTER: 0.55,
  BACKUP: 0.25,
  FRINGE: 0.05,
};

/**
 * Roll declaration status for every JR-eligible prospect in the pool.
 * Seniors are forced to true (no eligibility left). Non-eligible
 * classes stay false.
 *
 * Returns a NEW pool — original is not mutated. Deterministic for a
 * given (prng, pool) pair.
 *
 * Junior decision model is tier-only for slice 5a; future slices can
 * layer in media hype, projected draft slot, eligibility for graduate
 * transfer, NIL-money pressure, etc.
 */
export function rollJuniorDeclarations(
  prng: Prng,
  pool: readonly CollegePlayer[],
): readonly CollegePlayer[] {
  return pool.map((cp) => {
    // Already declared? Leave it.
    if (cp.hasDeclared) return cp;
    // SR / RS_SR — out of eligibility, auto-declare.
    if (cp.classYear === 'SR' || cp.classYear === 'RS_SR') {
      return { ...cp, hasDeclared: true };
    }
    // JR — tier-based roll. A JR who rolls non-declare is
    // explicitly RETURNING to college; flag them so boards filter
    // them out until they age into SR (next cycle).
    if (cp.classYear === 'JR') {
      const p = JR_DECLARATION_RATE[cp.tier];
      const declares = prng.fork(`decl:${cp.id}`).next() < p;
      return declares
        ? { ...cp, hasDeclared: true }
        : { ...cp, hasReturnedToSchool: true };
    }
    // Pre-JR: not eligible to declare yet.
    return cp;
  });
}
