/**
 * Deterministic seeded PRNG for the entire simulation.
 *
 * Algorithm: sfc32 (Simple Fast Counter, 4×32-bit state, period ≥ 2^96).
 * Seed mixing: cyrb128 (4×32-bit hash from a string seed).
 *
 * Both are public-domain / MIT-licensed designs. sfc32 has good statistical
 * properties (passes BigCrush) and is fast in V8. We do not use Math.random.
 *
 * # Forks
 *
 * Subsystems should fork the root PRNG with a stable label:
 *
 *   const draftPrng = leaguePrng.fork('draft');
 *   const tradePrng = leaguePrng.fork('trade');
 *
 * Forks produce statistically independent streams, so changing logic in
 * one subsystem doesn't shift random outcomes in another. This keeps
 * regression diffs scoped.
 */

export class Prng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: string | number);
  constructor(state: PrngState, _internal: 'state');
  constructor(seedOrState: string | number | PrngState, _internal?: 'state') {
    if (_internal === 'state' && typeof seedOrState === 'object') {
      this.a = seedOrState.a >>> 0;
      this.b = seedOrState.b >>> 0;
      this.c = seedOrState.c >>> 0;
      this.d = seedOrState.d >>> 0;
      return;
    }
    const seedStr = typeof seedOrState === 'number' ? String(seedOrState) : (seedOrState as string);
    const [a, b, c, d] = cyrb128(seedStr);
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    let { a, b, c, d } = this;
    a |= 0;
    b |= 0;
    c |= 0;
    d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    return (t >>> 0) / 4294967296;
  }

  /** Integer in [0, maxExclusive). */
  nextInt(maxExclusive: number): number {
    if (maxExclusive <= 0 || !Number.isInteger(maxExclusive)) {
      throw new RangeError(`nextInt requires positive integer, got ${maxExclusive}`);
    }
    return Math.floor(this.next() * maxExclusive);
  }

  /** Integer in [min, maxExclusive). */
  nextRange(min: number, maxExclusive: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(maxExclusive)) {
      throw new RangeError(`nextRange requires integers`);
    }
    if (maxExclusive <= min) {
      throw new RangeError(`nextRange requires max > min`);
    }
    return min + this.nextInt(maxExclusive - min);
  }

  /** Pick a random element. Throws if the array is empty. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('pick called on empty array');
    return items[this.nextInt(items.length)]!;
  }

  /** Fisher-Yates shuffle, in-place, deterministic. */
  shuffle<T>(items: T[]): void {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.nextInt(i + 1);
      const tmp = items[i]!;
      items[i] = items[j]!;
      items[j] = tmp;
    }
  }

  /** Weighted pick. Weights may be any positive numbers; they need not sum to 1. */
  weighted<T>(items: ReadonlyArray<{ value: T; weight: number }>): T {
    if (items.length === 0) throw new RangeError('weighted called on empty array');
    let total = 0;
    for (const item of items) {
      if (item.weight < 0 || !Number.isFinite(item.weight)) {
        throw new RangeError(`weighted: invalid weight ${item.weight}`);
      }
      total += item.weight;
    }
    if (total === 0) throw new RangeError('weighted: all weights zero');
    let roll = this.next() * total;
    for (const item of items) {
      roll -= item.weight;
      if (roll <= 0) return item.value;
    }
    return items[items.length - 1]!.value;
  }

  /** Standard normal (mean 0, stdev 1) via Box-Muller. */
  gaussian(): number {
    let u = 0;
    let v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Normal distribution with given mean/stdev, optionally clamped. */
  normal(mean: number, stdev: number, clamp?: { min: number; max: number }): number {
    const v = mean + this.gaussian() * stdev;
    if (!clamp) return v;
    return Math.max(clamp.min, Math.min(clamp.max, v));
  }

  /**
   * Create an independent child PRNG with a stable label.
   * Calling fork('foo') from the same parent state always produces the
   * same child stream, regardless of how many other forks have been made.
   */
  fork(label: string): Prng {
    const childSeed = `${this.a.toString(16)}:${this.b.toString(16)}:${this.c.toString(16)}:${this.d.toString(16)}::${label}`;
    return new Prng(childSeed);
  }

  /** Snapshot the current state for save/load. */
  serialize(): PrngState {
    return { a: this.a, b: this.b, c: this.c, d: this.d };
  }

  /** Restore from a snapshot. */
  static deserialize(state: PrngState): Prng {
    return new Prng(state, 'state');
  }
}

export interface PrngState {
  a: number;
  b: number;
  c: number;
  d: number;
}

/** cyrb128 string hash → 4×32-bit state. */
function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}
