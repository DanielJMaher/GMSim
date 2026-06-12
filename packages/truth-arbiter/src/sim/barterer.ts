import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DATA_DIR } from '../lib/config.js';
import { csvNum, csvRows } from '../lib/csv.js';
import { ensureContractsCsv, CONTRACTS_CSV_PATH, OTC_BUCKET } from '../lib/otc.js';
import {
  loadLeagueContracts,
  tradeValuePrimitives,
  type TradeValuePrimitives,
} from '../lib/engine-bridge.js';

/**
 * The Barterer — the TRADE-REALISM authority (2026-06-09, Daniel-directed).
 *
 * Sibling to the Liquidator (cap), Magistrate (drives), Skill Adjudicator
 * (talent) and Ombudsman (media spread). The Barterer ingests real NFL trades
 * and derives the bar GMSim's simulated GMs must echo across many seeds.
 *
 * Slice 1 measured deal STRUCTURE (shape / traded-player age / pick packages)
 * from spotrac's public ledger — which turned out to serve the same ~29
 * recent trades for every year URL. Slice 2 (this) replaces the source with
 * the open nflverse `nfldata` trade dataset (Lee Sharpe): every NFL trade
 * 2002→present, one row per asset, with exact pick numbers and PFR player
 * ids — and builds the layer Daniel asked for on top of it:
 *
 *   THE DEVIATION-FROM-FAIR ENVELOPE. Each real trade's two sides are valued
 *   by OUR OWN chart (engine `trade/value.ts` + Doc 5 pick chart, via the
 *   engine bridge): picks at chart points, players at the engine's neutral
 *   value (tier base × positional hierarchy × age curve × contract length).
 *   The per-trade imbalance ratio distribution tells us how far from
 *   chart-fair real GMs actually stray (win-now overpays, salary dumps,
 *   bust write-offs) — the envelope GMSim's simulated trades must live in.
 *
 * Tier oracle for real players — the market's own verdict, no scouting takes:
 *   - veteran contract at trade time → APY-vs-cap percentile within position
 *     bucket among contracts active that season; percentile→tier cutoffs come
 *     from GMSim's OWN league tier mix (engine bridge), so "STAR" means the
 *     same fraction of a position group in both worlds.
 *   - player still on his ROOKIE deal (slot-priced, not market-priced) → the
 *     verdict of his NEXT contract (retrospective oracle). Busts get cheap or
 *     no next deal and correctly tier low — which is what makes real bust-dump
 *     trades score as fair instead of lopsided. No next deal ever → FRINGE;
 *     too recent to know → his rookie APY percentile (draft-slot prior).
 *
 * Joins: pfr_id → nflverse players master (age, position); normalized name →
 * OTC historical contracts (APY, years, draft year). Raw data is disk-cached
 * in data/ (gitignored); the report prints join coverage before any
 * conclusions — a thin join invalidates the envelope, not the other way round.
 *
 *   pnpm --filter @gmsim/truth-arbiter run barterer [startSeason endSeason]
 *
 * Slice 3 (next): read GMSim's simulated trades from the engine transaction
 * log and compare them to this bar + envelope in `run gates`.
 */

const TRADES_URL = 'https://github.com/nflverse/nfldata/raw/master/data/trades.csv';
const TRADES_PATH = resolve(DATA_DIR, 'nfldata-trades.csv');
const PLAYERS_URL =
  'https://github.com/nflverse/nflverse-data/releases/download/players/players.csv';
const PLAYERS_PATH = resolve(DATA_DIR, 'players_master.csv');

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function ensureCsv(url: string, path: string, label: string): Promise<string> {
  if (!(await exists(path))) {
    process.stdout.write(`  fetching ${label}…`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${label} → HTTP ${res.status}`);
    const text = await res.text();
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(path, text, 'utf8');
    process.stdout.write(` ${(text.length / 1e6).toFixed(1)}MB\n`);
  }
  return readFile(path, 'utf8');
}

// ── Real trades (nflverse nfldata) ───────────────────────────────────────────

interface PlayerAsset {
  kind: 'player';
  pfrId: string;
  name: string;
}
interface PickAsset {
  kind: 'pick';
  season: number;
  round: number | null;
  number: number | null;
  conditional: boolean;
}
type Asset = PlayerAsset | PickAsset;

interface RealTrade {
  id: number;
  season: number;
  date: string;
  /** team → assets that team RECEIVED. */
  received: Map<string, Asset[]>;
}

async function loadRealTrades(start: number, end: number): Promise<RealTrade[]> {
  const csv = await ensureCsv(TRADES_URL, TRADES_PATH, 'nfldata trades.csv');
  const byId = new Map<number, RealTrade>();
  for (const row of csvRows(csv)) {
    const id = csvNum(row.get('trade_id'));
    const season = csvNum(row.get('season'));
    if (id === null || season === null || season < start || season > end) continue;
    let t = byId.get(id);
    if (!t) {
      t = { id, season, date: row.get('trade_date') ?? '', received: new Map() };
      byId.set(id, t);
    }
    const team = row.get('received') ?? '';
    if (!team) continue;
    const assets = t.received.get(team) ?? [];
    if (!t.received.has(team)) t.received.set(team, assets);

    const pickSeason = csvNum(row.get('pick_season'));
    if (pickSeason !== null) {
      // Pick rows carry the eventually-drafted player in the pfr columns —
      // that's draft-day hindsight, not a player asset; ignore it.
      assets.push({
        kind: 'pick',
        season: pickSeason,
        round: csvNum(row.get('pick_round')),
        number: csvNum(row.get('pick_number')),
        conditional: csvNum(row.get('conditional')) === 1,
      });
    } else {
      const pfrId = row.get('pfr_id') ?? '';
      const name = row.get('pfr_name') ?? '';
      if (pfrId || name) assets.push({ kind: 'player', pfrId, name });
    }
  }
  return [...byId.values()];
}

// ── nflverse players master: pfr_id → age / position / draft year ───────────

interface MasterPlayer {
  name: string;
  birthDate: string | null;
  position: string;
  draftYear: number | null;
  gsisId: string | null;
}

async function loadPlayersMaster(): Promise<Map<string, MasterPlayer>> {
  const csv = await ensureCsv(PLAYERS_URL, PLAYERS_PATH, 'nflverse players master');
  const byPfr = new Map<string, MasterPlayer>();
  for (const row of csvRows(csv)) {
    const pfr = row.get('pfr_id');
    if (!pfr) continue;
    byPfr.set(pfr, {
      name: row.get('display_name') ?? '',
      birthDate: row.get('birth_date') || null,
      position: row.get('position') ?? '',
      draftYear: csvNum(row.get('draft_year')),
      gsisId: row.get('gsis_id') || null,
    });
  }
  return byPfr;
}

// ── OTC contracts: the market's tier verdict ─────────────────────────────────

interface OtcRow {
  otcId: string;
  bucket: string;
  yearSigned: number;
  years: number;
  apyCapPct: number | null;
  draftYear: number | null;
}

interface OtcIndex {
  byName: Map<string, OtcRow[]>;
  byOtcId: Map<string, OtcRow[]>;
  byBucket: Map<string, OtcRow[]>;
  /** nflverse gsis_id → otc_ids seen for it (ID join beats the name join). */
  byGsis: Map<string, Set<string>>;
}

/** lowercase, strip punctuation/spaces and generational suffixes. */
function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\.?$/g, '')
    .replace(/[^a-z]/g, '');
}

async function loadOtcContracts(): Promise<OtcIndex> {
  await ensureContractsCsv();
  const csv = await readFile(CONTRACTS_CSV_PATH, 'utf8');
  const byName = new Map<string, OtcRow[]>();
  const byOtcId = new Map<string, OtcRow[]>();
  const byBucket = new Map<string, OtcRow[]>();
  const byGsis = new Map<string, Set<string>>();
  for (const row of csvRows(csv)) {
    const yearSigned = csvNum(row.get('year_signed'));
    const otcId = row.get('otc_id') ?? '';
    if (yearSigned === null || !otcId) continue;
    const gsis = row.get('gsis_id');
    if (gsis) {
      const set = byGsis.get(gsis) ?? new Set<string>();
      set.add(otcId);
      if (set.size === 1) byGsis.set(gsis, set);
    }
    const r: OtcRow = {
      otcId,
      bucket: row.get('position') ?? '',
      yearSigned,
      years: Math.max(1, csvNum(row.get('years')) ?? 1),
      apyCapPct: csvNum(row.get('apy_cap_pct')),
      draftYear: csvNum(row.get('draft_year')),
    };
    const key = nameKey(row.get('player') ?? '');
    if (key) {
      const a = byName.get(key) ?? [];
      a.push(r);
      if (a.length === 1) byName.set(key, a);
    }
    const b = byOtcId.get(otcId) ?? [];
    b.push(r);
    if (b.length === 1) byOtcId.set(otcId, b);
    const c = byBucket.get(r.bucket) ?? [];
    c.push(r);
    if (c.length === 1) byBucket.set(r.bucket, c);
  }
  for (const rows of byOtcId.values()) rows.sort((a, b) => a.yearSigned - b.yearSigned);
  return { byName, byOtcId, byBucket, byGsis };
}

const activeIn = (r: OtcRow, season: number): boolean =>
  r.yearSigned <= season && season < r.yearSigned + r.years;

/** OTC buckets that can plausibly label the same player across sources/years. */
const COMPAT_GROUPS: readonly (readonly string[])[] = [
  ['ED', 'LB', 'IDL'],
  ['CB', 'S'],
  ['LT', 'RT', 'LG', 'RG', 'C'],
  ['RB', 'FB'],
];
function bucketsCompatible(a: string, b: string): boolean {
  if (a === b) return true;
  return COMPAT_GROUPS.some((g) => g.includes(a) && g.includes(b));
}

// ── Position mapping: nflverse master position → engine Position ────────────

/** Tackles map by tier: traded STAR tackles are blindside (LT), rest RT. */
function enginePositionFor(masterPos: string, otcBucket: string | null, tier: string): string | null {
  const p = masterPos.toUpperCase();
  const direct: Record<string, string> = {
    QB: 'QB', RB: 'RB', HB: 'RB', FB: 'FB', WR: 'WR', TE: 'TE',
    LT: 'LT', RT: 'RT', G: 'LG', OG: 'LG', LG: 'LG', RG: 'RG', C: 'C', OL: 'LG',
    DE: 'EDGE', EDGE: 'EDGE', OLB: 'EDGE',
    DT: 'DT', NT: 'NT', DL: 'DT', IDL: 'DT',
    LB: 'ILB', ILB: 'ILB', MLB: 'ILB',
    CB: 'CB', DB: 'CB', S: 'S', FS: 'S', SS: 'S', SAF: 'S',
    K: 'K', P: 'P', LS: 'LS',
  };
  if (p === 'T' || p === 'OT') return tier === 'STAR' ? 'LT' : 'RT';
  if (direct[p]) return direct[p]!;
  // Fall back to the OTC contract bucket when the master position is odd.
  const fromOtc: Record<string, string> = {
    QB: 'QB', RB: 'RB', FB: 'FB', WR: 'WR', TE: 'TE',
    LT: 'LT', RT: 'RT', LG: 'LG', RG: 'RG', C: 'C',
    ED: 'EDGE', IDL: 'DT', LB: 'ILB', CB: 'CB', S: 'S', K: 'K', P: 'P', LS: 'LS',
  };
  if (otcBucket && fromOtc[otcBucket]) return fromOtc[otcBucket]!;
  return null;
}

/** Engine position → OTC bucket (for pool lookups from a master position). */
function otcBucketForMaster(masterPos: string): string | null {
  const eng = enginePositionFor(masterPos, null, 'STARTER');
  return eng ? (OTC_BUCKET[eng] ?? null) : null;
}

// ── Tier oracle ──────────────────────────────────────────────────────────────

type Tier = 'STAR' | 'STARTER' | 'BACKUP' | 'FRINGE';
type TierSource =
  | 'vet-apy'
  | 'next-contract'
  | 'rookie-apy'
  | 'washout'
  | 'no-master'
  | 'no-contract'
  | 'ambiguous';

interface TierShares {
  star: number;
  starter: number;
  backup: number;
}

/** Per-bucket tier mix of a generated GMSim league — the percentile cutoffs. */
async function tierSharesFromEngine(): Promise<Map<string, TierShares>> {
  const rows = await loadLeagueContracts('barterer-tier-shares');
  const counts = new Map<string, { star: number; starter: number; backup: number; n: number }>();
  for (const r of rows) {
    const bucket = OTC_BUCKET[r.position];
    if (!bucket) continue;
    const c = counts.get(bucket) ?? { star: 0, starter: 0, backup: 0, n: 0 };
    if (r.tier === 'STAR') c.star++;
    else if (r.tier === 'STARTER') c.starter++;
    else if (r.tier === 'BACKUP') c.backup++;
    c.n++;
    counts.set(bucket, c);
  }
  const shares = new Map<string, TierShares>();
  for (const [bucket, c] of counts) {
    if (c.n < 10) continue;
    shares.set(bucket, { star: c.star / c.n, starter: c.starter / c.n, backup: c.backup / c.n });
  }
  return shares;
}

const DEFAULT_SHARES: TierShares = { star: 0.05, starter: 0.32, backup: 0.43 };

/** Last season the OTC ledger can render a verdict on — a rookie-deal player
 *  traded within 2 seasons of this can't be called a washout yet. */
const DATA_HORIZON = 2026;

class TierOracle {
  private pools = new Map<string, number[]>();

  constructor(
    private otc: OtcIndex,
    private shares: Map<string, TierShares>,
  ) {}

  /** APY-cap-pct values of contracts active in `season` at `bucket`, widened
   *  ±1 season when thin. apy_cap_pct is relative to the SIGNING-year cap, so
   *  long-running deals read slightly high in later pool years — second-order
   *  for deals signed within a few years of each other. */
  private pool(bucket: string, season: number): number[] {
    const key = `${bucket}:${season}`;
    const hit = this.pools.get(key);
    if (hit) return hit;
    const rows = this.otc.byBucket.get(bucket) ?? [];
    let values: number[] = [];
    for (let widen = 0; widen <= 2; widen++) {
      values = [];
      for (const r of rows) {
        if (r.apyCapPct === null || r.apyCapPct <= 0) continue;
        for (let s = season - widen; s <= season + widen; s++) {
          if (activeIn(r, s)) {
            values.push(r.apyCapPct);
            break;
          }
        }
      }
      if (values.length >= 25) break;
    }
    values.sort((a, b) => b - a);
    this.pools.set(key, values);
    return values;
  }

  private tierFromApy(bucket: string, season: number, apyCapPct: number): Tier {
    const pool = this.pool(bucket, season);
    if (pool.length === 0) return 'BACKUP';
    let above = 0;
    while (above < pool.length && pool[above]! > apyCapPct) above++;
    const pctile = (above + 0.5) / pool.length;
    const s = this.shares.get(bucket) ?? DEFAULT_SHARES;
    if (pctile <= s.star) return 'STAR';
    if (pctile <= s.star + s.starter) return 'STARTER';
    if (pctile <= s.star + s.starter + s.backup) return 'BACKUP';
    return 'FRINGE';
  }

  /**
   * The market's tier verdict for one traded player at `season`, plus the
   * contract context the valuation needs (years remaining at trade).
   */
  read(
    name: string,
    gsisId: string | null,
    masterPos: string | null,
    masterDraftYear: number | null,
    season: number,
  ): { tier: Tier; source: TierSource; yearsRemaining: number | null; bucket: string | null } {
    const none = { tier: 'FRINGE' as Tier, yearsRemaining: null, bucket: null };
    // ID join first; fall back to name + position/draft-year disambiguation.
    let ids = gsisId ? [...(this.otc.byGsis.get(gsisId) ?? [])] : [];
    if (ids.length !== 1) {
      let candidates = this.otc.byName.get(nameKey(name)) ?? [];
      const masterBucket = masterPos ? otcBucketForMaster(masterPos) : null;
      if (masterBucket) {
        const filtered = candidates.filter((c) => bucketsCompatible(masterBucket, c.bucket));
        if (filtered.length > 0) candidates = filtered;
      }
      ids = [...new Set(candidates.map((c) => c.otcId))];
      if (ids.length > 1 && masterDraftYear !== null) {
        const matched = candidates.filter(
          (c) => c.draftYear !== null && c.draftYear === masterDraftYear,
        );
        const matchedIds = [...new Set(matched.map((c) => c.otcId))];
        if (matchedIds.length >= 1) ids = matchedIds;
      }
    }
    if (ids.length === 0) return { ...none, source: 'no-contract' };
    if (ids.length > 1) return { ...none, source: 'ambiguous' };

    const rows = this.otc.byOtcId.get(ids[0]!) ?? [];
    let active = rows.filter((r) => activeIn(r, season)).pop() ?? null;
    if (!active) {
      // Data gap: most recent deal that ended within 2 seasons of the trade.
      const recent = rows.filter(
        (r) => r.yearSigned <= season && season - (r.yearSigned + r.years - 1) <= 2,
      );
      active = recent.pop() ?? null;
    }
    if (!active) {
      // Trade recorded just before the signing landed in OTC's ledger.
      const upcoming = rows.find((r) => r.yearSigned > season && r.yearSigned <= season + 3);
      if (upcoming && upcoming.apyCapPct !== null) {
        return {
          tier: this.tierFromApy(upcoming.bucket, upcoming.yearSigned, upcoming.apyCapPct),
          source: 'next-contract',
          yearsRemaining: null,
          bucket: upcoming.bucket,
        };
      }
      return { ...none, source: 'no-contract' };
    }

    const yearsRemaining = Math.max(0, active.yearSigned + active.years - season);
    const isRookieDeal = active.draftYear !== null && active.yearSigned === active.draftYear;
    if (isRookieDeal) {
      const next = rows.find((r) => r.yearSigned > active!.yearSigned);
      if (next && next.apyCapPct !== null) {
        return {
          tier: this.tierFromApy(next.bucket, next.yearSigned, next.apyCapPct),
          source: 'next-contract',
          yearsRemaining,
          bucket: active.bucket,
        };
      }
      // No next deal. For recent trades that's "not knowable yet" — fall back
      // to the rookie deal's slot-priced APY as a draft-pedigree prior; for
      // older trades it's the market's washout verdict.
      if (season + 2 >= DATA_HORIZON) {
        if (active.apyCapPct !== null) {
          return {
            tier: this.tierFromApy(active.bucket, season, active.apyCapPct),
            source: 'rookie-apy',
            yearsRemaining,
            bucket: active.bucket,
          };
        }
      }
      return { tier: 'FRINGE', source: 'washout', yearsRemaining, bucket: active.bucket };
    }

    if (active.apyCapPct === null) return { ...none, source: 'no-contract' };
    return {
      tier: this.tierFromApy(active.bucket, season, active.apyCapPct),
      source: 'vet-apy',
      yearsRemaining,
      bucket: active.bucket,
    };
  }
}

// ── Valuation ────────────────────────────────────────────────────────────────

/** Same round-midpoint slots the engine uses for future picks (trade/value.ts). */
const ROUND_MIDPOINT: Record<number, number> = { 1: 16, 2: 48, 3: 80, 4: 112, 5: 144, 6: 176, 7: 224 };

interface ValuedAsset {
  asset: Asset;
  points: number | null;
  tier?: Tier;
  tierSource?: TierSource;
  age?: number | null;
}

interface ValuedTrade {
  trade: RealTrade;
  sides: { team: string; assets: ValuedAsset[]; points: number }[];
  /** max/min of the two side totals; null when ineligible. */
  ratio: number | null;
  /** Like `ratio`, after converting player points at the fitted market
   *  exchange rate — the residual deviation, i.e. THE envelope. */
  residualRatio: number | null;
  excluded: string | null;
}

function ageAt(birthDate: string, onDate: string): number | null {
  const b = new Date(birthDate);
  const d = new Date(onDate);
  if (Number.isNaN(b.getTime()) || Number.isNaN(d.getTime())) return null;
  let age = d.getFullYear() - b.getFullYear();
  if (
    d.getMonth() < b.getMonth() ||
    (d.getMonth() === b.getMonth() && d.getDate() < b.getDate())
  ) {
    age--;
  }
  return age >= 15 && age <= 50 ? age : null;
}

interface JoinStats {
  players: number;
  noMaster: number;
  ageEstimated: number;
  tierSources: Map<TierSource, number>;
  /** Same counters restricted to trades in the modern era (≥ ERA_SPLIT) —
   *  the era the envelope headline is computed on. */
  playersModern: number;
  tierSourcesModern: Map<TierSource, number>;
  picks: number;
  picksExact: number;
  picksNoRound: number;
  picksConditional: number;
}

function valueTrades(
  trades: RealTrade[],
  master: Map<string, MasterPlayer>,
  oracle: TierOracle,
  tv: TradeValuePrimitives,
  stats: JoinStats,
): ValuedTrade[] {
  const out: ValuedTrade[] = [];
  for (const trade of trades) {
    const sides: ValuedTrade['sides'] = [];
    let excluded: string | null = trade.received.size === 2 ? null : `${trade.received.size}-team`;
    for (const [team, assets] of trade.received) {
      const valued: ValuedAsset[] = [];
      for (const asset of assets) {
        if (asset.kind === 'pick') {
          stats.picks++;
          if (asset.conditional) stats.picksConditional++;
          const yearsOut = Math.max(0, asset.season - trade.season);
          const round = asset.round ?? 5;
          if (asset.round === null) stats.picksNoRound++;
          // Exact slot only for current-year picks — a future pick's eventual
          // number is hindsight the traders didn't have (engine uses midpoints).
          let overall: number;
          if (yearsOut === 0 && asset.number !== null) {
            overall = Math.min(asset.number, 257);
            stats.picksExact++;
          } else {
            overall = ROUND_MIDPOINT[Math.min(round, 7)] ?? 224;
          }
          valued.push({ asset, points: tv.pickValue(overall, yearsOut) });
        } else {
          stats.players++;
          const isModern = trade.season >= ERA_SPLIT;
          if (isModern) stats.playersModern++;
          const m = asset.pfrId ? (master.get(asset.pfrId) ?? null) : null;
          if (!m) {
            stats.noMaster++;
            valued.push({ asset, points: null, tierSource: 'no-master' });
            continue;
          }
          const read = oracle.read(
            m.name || asset.name,
            m.gsisId,
            m.position,
            m.draftYear,
            trade.season,
          );
          stats.tierSources.set(read.source, (stats.tierSources.get(read.source) ?? 0) + 1);
          if (isModern) {
            stats.tierSourcesModern.set(
              read.source,
              (stats.tierSourcesModern.get(read.source) ?? 0) + 1,
            );
          }
          if (read.source === 'no-contract' || read.source === 'ambiguous') {
            valued.push({ asset, points: null, tierSource: read.source });
            continue;
          }
          let age = m.birthDate ? ageAt(m.birthDate, trade.date) : null;
          if (age === null) {
            stats.ageEstimated++;
            age = 27;
          }
          const enginePos = enginePositionFor(m.position, read.bucket, read.tier);
          if (!enginePos) {
            valued.push({ asset, points: null, tier: read.tier, tierSource: read.source });
            continue;
          }
          const millions = tv.neutralPlayerValueMillions(
            read.tier,
            enginePos,
            age,
            read.yearsRemaining ?? undefined,
          );
          valued.push({
            asset,
            points: (millions * 1e6) / tv.chartPointToDollars,
            tier: read.tier,
            tierSource: read.source,
            age,
          });
        }
      }
      if (!excluded && valued.some((v) => v.points === null)) excluded = 'unvalued-player';
      sides.push({ team, assets: valued, points: valued.reduce((s, v) => s + (v.points ?? 0), 0) });
    }
    if (!excluded && sides.length === 2) {
      const [a, b] = [sides[0]!.points, sides[1]!.points];
      if (a <= 0 || b <= 0) excluded = 'zero-side';
    }
    const ratio =
      excluded === null && sides.length === 2
        ? Math.max(sides[0]!.points, sides[1]!.points) / Math.min(sides[0]!.points, sides[1]!.points)
        : null;
    out.push({ trade, sides, ratio, residualRatio: null, excluded });
  }
  return out;
}

// ── Market exchange rate: pick-points paid per neutral player point ─────────
//
// The first run surfaced the real finding: the picks-only segment hugs our
// chart (median 1.14) but player↔pick trades land at 30-50x — the market
// pays picks worth only a FRACTION of the engine's $-anchored neutral player
// value, and the fraction collapses with age and toward the bottom tiers
// (a $2M backup is ~700 chart points but trades for a 7th ≈ 36). That
// player↔pick exchange rate is a calibration CURVE, not noise — so we fit
// it (median rate per tier × age band on the pure player↔picks trades) and
// report the deviation envelope on the RESIDUAL, where chart-fair means
// "fair given how the real market prices players in pick currency".

type AgeBand = 'prime' | 'post30';
const bandOf = (age: number | null | undefined): AgeBand =>
  age !== null && age !== undefined && age >= 30 ? 'post30' : 'prime';

const MIN_CELL_N = 8;

class ExchangeRates {
  cells = new Map<string, number[]>();
  private cellMedians = new Map<string, number>();
  private tierMedians = new Map<Tier, number>();
  private globalMedian = 1;
  fittedOn = 0;

  static fit(valued: ValuedTrade[]): ExchangeRates {
    const er = new ExchangeRates();
    const all: number[] = [];
    const byTier = new Map<Tier, number[]>();
    for (const v of valued) {
      if (v.ratio === null || v.trade.season < ERA_SPLIT || v.sides.length !== 2) continue;
      const [a, b] = [v.sides[0]!, v.sides[1]!];
      const allPlayers = (s: typeof a): boolean =>
        s.assets.length > 0 && s.assets.every((x) => x.asset.kind === 'player');
      const allPicks = (s: typeof a): boolean =>
        s.assets.length > 0 && s.assets.every((x) => x.asset.kind === 'pick');
      let players: typeof a | null = null;
      let picks: typeof a | null = null;
      if (allPlayers(a) && allPicks(b)) [players, picks] = [a, b];
      else if (allPlayers(b) && allPicks(a)) [players, picks] = [b, a];
      if (!players || !picks || players.points <= 0 || picks.points <= 0) continue;
      const dominant = players.assets.reduce((best, x) =>
        (x.points ?? 0) > (best.points ?? 0) ? x : best,
      );
      if (!dominant.tier) continue;
      const rate = picks.points / players.points;
      const key = `${dominant.tier}:${bandOf(dominant.age)}`;
      const cell = er.cells.get(key) ?? [];
      cell.push(rate);
      if (cell.length === 1) er.cells.set(key, cell);
      const t = byTier.get(dominant.tier) ?? [];
      t.push(rate);
      if (t.length === 1) byTier.set(dominant.tier, t);
      all.push(rate);
      er.fittedOn++;
    }
    const median = (xs: number[]): number => quantile([...xs].sort((x, y) => x - y), 0.5);
    for (const [key, rates] of er.cells) er.cellMedians.set(key, median(rates));
    for (const [tier, rates] of byTier) er.tierMedians.set(tier, median(rates));
    if (all.length > 0) er.globalMedian = median(all);
    return er;
  }

  rate(tier: Tier, band: AgeBand): number {
    const key = `${tier}:${band}`;
    if ((this.cells.get(key)?.length ?? 0) >= MIN_CELL_N) return this.cellMedians.get(key)!;
    const tierRates = this.tierMedians.get(tier);
    return tierRates ?? this.globalMedian;
  }
}

/** Recompute each eligible trade's side totals with player points converted
 *  at the market exchange rate, filling `residualRatio`. */
function applyExchangeRates(valued: ValuedTrade[], er: ExchangeRates): void {
  for (const v of valued) {
    if (v.ratio === null || v.sides.length !== 2) continue;
    const totals = v.sides.map((s) =>
      s.assets.reduce((sum, x) => {
        if (x.points === null) return sum;
        if (x.asset.kind === 'pick') return sum + x.points;
        const tier = x.tier ?? 'BACKUP';
        return sum + x.points * er.rate(tier, bandOf(x.age));
      }, 0),
    );
    const [a, b] = [totals[0]!, totals[1]!];
    v.residualRatio = a > 0 && b > 0 ? Math.max(a, b) / Math.min(a, b) : null;
  }
}

// ── Classification (shared by the bar + the envelope) ────────────────────────

type Shape = 'player-for-picks' | 'player-for-player' | 'picks-only' | 'other';

function classify(t: RealTrade): Shape {
  const sides = [...t.received.values()];
  const withPlayers = sides.filter((a) => a.some((x) => x.kind === 'player')).length;
  const withPicks = sides.filter((a) => a.some((x) => x.kind === 'pick')).length;
  const totalPlayers = sides.reduce((n, a) => n + a.filter((x) => x.kind === 'player').length, 0);
  if (totalPlayers === 0) return 'picks-only';
  if (withPlayers >= 2) return 'player-for-player';
  if (withPlayers === 1 && withPicks >= 1) return 'player-for-picks';
  return 'other';
}

const month = (t: RealTrade): number => Number(t.date.slice(5, 7)) || 0;
const inSeason = (t: RealTrade): boolean => month(t) >= 9;
const ERA_SPLIT = 2015; // the Doc 5 chart is calibrated on 2015-2024 trades

// ── Reports ──────────────────────────────────────────────────────────────────

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const i = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[i]!;
}
const pctStr = (n: number, d: number): string => (d ? `${((n / d) * 100).toFixed(0)}%` : '—');

function reportIngest(trades: RealTrade[], stats: JoinStats, start: number, end: number): void {
  const assetCount = trades.reduce(
    (n, t) => n + [...t.received.values()].reduce((m, a) => m + a.length, 0),
    0,
  );
  console.log(`\n=== THE BARTERER — real NFL trades ${start}-${end} (nflverse nfldata) ===`);
  console.log(
    `trades: ${trades.length}  ·  asset rows: ${assetCount} (players ${stats.players}, picks ${stats.picks})`,
  );
  const tieredOf = (ts: Map<TierSource, number>): number =>
    (ts.get('vet-apy') ?? 0) +
    (ts.get('next-contract') ?? 0) +
    (ts.get('rookie-apy') ?? 0) +
    (ts.get('washout') ?? 0);
  const ts = stats.tierSources;
  console.log(
    `player joins: master ${pctStr(stats.players - stats.noMaster, stats.players)} · tiered ${pctStr(tieredOf(ts), stats.players)} ` +
      `(vet-apy ${ts.get('vet-apy') ?? 0} / next-contract ${ts.get('next-contract') ?? 0} / rookie-apy ${ts.get('rookie-apy') ?? 0} / washout→FRINGE ${ts.get('washout') ?? 0})`,
  );
  console.log(
    `        ${ERA_SPLIT}+ era (the envelope's): tiered ${pctStr(tieredOf(stats.tierSourcesModern), stats.playersModern)} of ${stats.playersModern} traded players`,
  );
  console.log(
    `        unjoined: no-master ${stats.noMaster} · no-contract ${ts.get('no-contract') ?? 0} · ambiguous-name ${ts.get('ambiguous') ?? 0} · age-estimated ${stats.ageEstimated}`,
  );
  console.log(
    `pick rows: exact slot ${stats.picksExact} · conditional ${stats.picksConditional} · round-unknown→R5 ${stats.picksNoRound}`,
  );
}

/** Slice-1 structural bar, recomputed on the full multi-year source. */
function reportBar(trades: RealTrade[], master: Map<string, MasterPlayer>): void {
  const seasons = new Set(trades.map((t) => t.season));
  const shapes = new Map<Shape, number>();
  const ages: number[] = [];
  const posGroup = new Map<string, number>();
  const pickPkgSizes: number[] = [];
  let tradesWithR1 = 0;
  let players = 0;

  const GROUP: Record<string, string> = {
    QB: 'QB', RB: 'RB', HB: 'RB', FB: 'RB', WR: 'WR', TE: 'TE',
    T: 'OL', OT: 'OL', LT: 'OL', RT: 'OL', G: 'OL', OG: 'OL', LG: 'OL', RG: 'OL', C: 'OL', OL: 'OL',
    DE: 'EDGE', EDGE: 'EDGE', OLB: 'EDGE',
    DT: 'DL', NT: 'DL', DL: 'DL', IDL: 'DL',
    LB: 'LB', ILB: 'LB', MLB: 'LB',
    CB: 'DB', DB: 'DB', S: 'DB', FS: 'DB', SS: 'DB',
    K: 'ST', P: 'ST', LS: 'ST',
  };

  for (const t of trades) {
    shapes.set(classify(t), (shapes.get(classify(t)) ?? 0) + 1);
    let hasR1 = false;
    for (const assets of t.received.values()) {
      const picks = assets.filter((a): a is PickAsset => a.kind === 'pick');
      if (picks.length > 0) pickPkgSizes.push(picks.length);
      if (picks.some((p) => p.round === 1)) hasR1 = true;
      for (const a of assets) {
        if (a.kind !== 'player') continue;
        players++;
        const m = master.get(a.pfrId);
        if (!m) continue;
        const age = m.birthDate ? ageAt(m.birthDate, t.date) : null;
        if (age !== null) ages.push(age);
        const g = GROUP[m.position.toUpperCase()];
        if (g) posGroup.set(g, (posGroup.get(g) ?? 0) + 1);
      }
    }
    if (hasR1) tradesWithR1++;
  }

  const perYear = (subset: RealTrade[], from: number, to: number): string => {
    const inEra = subset.filter((t) => t.season >= from && t.season <= to);
    const years = new Set(inEra.map((t) => t.season)).size;
    return years ? (inEra.length / years).toFixed(0) : '—';
  };

  console.log(`\n=== structural bar (real NFL, ${seasons.size} seasons) ===`);
  console.log(
    `  volume: ${perYear(trades, 0, 9999)}/yr  ·  ${ERA_SPLIT}+: ${perYear(trades, ERA_SPLIT, 9999)}/yr  ·  pre-${ERA_SPLIT}: ${perYear(trades, 0, ERA_SPLIT - 1)}/yr`,
  );
  console.log('  deal shape:');
  for (const k of ['player-for-picks', 'player-for-player', 'picks-only', 'other'] as Shape[]) {
    const c = shapes.get(k) ?? 0;
    console.log(`    ${k.padEnd(20)} ${pctStr(c, trades.length).padStart(5)}  (${c})`);
  }
  console.log(
    `  traded-player AGE: mean ${mean(ages).toFixed(1)}  ·  ≥28: ${pctStr(ages.filter((a) => a >= 28).length, ages.length)}  ·  ≤25: ${pctStr(ages.filter((a) => a <= 25).length, ages.length)}`,
  );
  console.log('  traded-player POSITION group:');
  const posLine = [...posGroup.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([g, c]) => `${g} ${pctStr(c, players)}`)
    .join(' · ');
  console.log(`    ${posLine}`);
  console.log(
    `  pick packages: mean ${mean(pickPkgSizes).toFixed(1)} picks/side  ·  trades incl. a 1st: ${pctStr(tradesWithR1, trades.length)}`,
  );
}

function envelopeLine(label: string, ratios: number[]): void {
  const sorted = [...ratios].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) {
    console.log(`  ${label.padEnd(26)}    —`);
    return;
  }
  const q = (p: number): string => quantile(sorted, p).toFixed(2);
  const fair = sorted.filter((r) => r <= 1.1).length;
  const beyond2 = sorted.filter((r) => r > 2).length;
  console.log(
    `  ${label.padEnd(26)} ${String(n).padStart(4)}  ${q(0.25).padStart(6)} ${q(0.5).padStart(6)} ${q(0.75).padStart(6)} ${q(0.9).padStart(6)} ${q(0.95).padStart(6)}   ${pctStr(fair, n).padStart(5)}  ${pctStr(beyond2, n).padStart(5)}`,
  );
}

function reportExchangeRates(er: ExchangeRates): void {
  console.log(
    `\n=== market exchange rate — pick-points paid per neutral player point (${ERA_SPLIT}+) ===`,
  );
  console.log(
    `fitted on ${er.fittedOn} pure player↔picks trades · median [IQR] (n) per tier × age:`,
  );
  for (const tier of ['STAR', 'STARTER', 'BACKUP', 'FRINGE'] as Tier[]) {
    const parts: string[] = [];
    for (const band of ['prime', 'post30'] as AgeBand[]) {
      const rates = er.cells.get(`${tier}:${band}`);
      if (!rates || rates.length === 0) {
        parts.push(`${band === 'prime' ? '≤29' : '30+'}: —`);
        continue;
      }
      const sorted = [...rates].sort((a, b) => a - b);
      parts.push(
        `${band === 'prime' ? '≤29' : '30+'}: ${quantile(sorted, 0.5).toFixed(2)} [${quantile(sorted, 0.25).toFixed(2)}-${quantile(sorted, 0.75).toFixed(2)}] (${sorted.length})`,
      );
    }
    console.log(`    ${tier.padEnd(8)} ${parts.join('  ·  ')}`);
  }
  console.log(
    '  ENGINE FINDING: a rate well under 1.00 means the engine prices players in $-anchored',
  );
  console.log(
    '  points far above what the real pick market pays — the player↔pick exchange rate is',
  );
  console.log(
    '  the calibration target for player-for-pick NPC trade logic (named follow-up slice).',
  );
}

function reportEnvelope(valued: ValuedTrade[]): void {
  const eligible = valued.filter((v) => v.residualRatio !== null);
  const excludedWhy = new Map<string, number>();
  for (const v of valued) {
    if (v.excluded) excludedWhy.set(v.excluded, (excludedWhy.get(v.excluded) ?? 0) + 1);
  }

  console.log('\n=== THE ENVELOPE — residual deviation from chart-fair, at market rates ===');
  console.log('(picks at our Doc 5 chart; players at neutral value × fitted exchange rate)');
  console.log(
    `eligible 2-team fully-valued trades: ${eligible.length}/${valued.length}  ` +
      `(excluded: ${[...excludedWhy.entries()].map(([k, c]) => `${k} ${c}`).join(' · ') || 'none'})`,
  );
  console.log(
    `\n  ${'segment'.padEnd(26)}    n     p25    p50    p75    p90    p95   ≤1.10   >2:1`,
  );

  const ratios = (pred: (v: ValuedTrade) => boolean): number[] =>
    eligible.filter(pred).map((v) => v.residualRatio!);

  const modern = (v: ValuedTrade): boolean => v.trade.season >= ERA_SPLIT;
  envelopeLine(`ALL ${ERA_SPLIT}-2026`, ratios(modern));
  envelopeLine('  picks-only', ratios((v) => modern(v) && classify(v.trade) === 'picks-only'));
  envelopeLine(
    '  player-for-picks',
    ratios((v) => modern(v) && classify(v.trade) === 'player-for-picks'),
  );
  envelopeLine(
    '  player-for-player',
    ratios((v) => modern(v) && classify(v.trade) === 'player-for-player'),
  );
  envelopeLine('  in-season (Sep+)', ratios((v) => modern(v) && inSeason(v.trade)));
  envelopeLine('  offseason', ratios((v) => modern(v) && !inSeason(v.trade)));
  envelopeLine(`ALL 2002-${ERA_SPLIT - 1}`, ratios((v) => !modern(v)));

  const modernRatios = ratios(modern).sort((a, b) => a - b);
  if (modernRatios.length > 0) {
    console.log(
      `\n  → GMSim GM acceptance envelope (${ERA_SPLIT}+): median deviation ${quantile(modernRatios, 0.5).toFixed(2)}x, ` +
        `90% of real trades within ${quantile(modernRatios, 0.9).toFixed(2)}x, 95% within ${quantile(modernRatios, 0.95).toFixed(2)}x of market-rate fair`,
    );
  }
}

// ── Ledger ───────────────────────────────────────────────────────────────────

async function writeLedger(valued: ValuedTrade[], start: number, end: number): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  const out = resolve(DATA_DIR, 'barterer-trades.json');
  const trades = valued.map((v) => ({
    id: v.trade.id,
    season: v.trade.season,
    date: v.trade.date,
    shape: classify(v.trade),
    ratio: v.ratio === null ? null : Math.round(v.ratio * 100) / 100,
    residualRatio: v.residualRatio === null ? null : Math.round(v.residualRatio * 100) / 100,
    excluded: v.excluded,
    sides: v.sides.map((s) => ({
      team: s.team,
      points: Math.round(s.points),
      assets: s.assets.map((a) =>
        a.asset.kind === 'pick'
          ? {
              pick: `${a.asset.season} R${a.asset.round ?? '?'}${a.asset.number ? ` #${a.asset.number}` : ''}${a.asset.conditional ? ' (cond)' : ''}`,
              points: a.points === null ? null : Math.round(a.points),
            }
          : {
              player: a.asset.name,
              tier: a.tier ?? null,
              tierSource: a.tierSource ?? null,
              age: a.age ?? null,
              points: a.points === null ? null : Math.round(a.points),
            },
      ),
    })),
  }));
  await writeFile(
    out,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString().slice(0, 10),
        source: 'nflverse nfldata trades.csv',
        start,
        end,
        trades,
      },
      null,
      2,
    ),
  );
  console.log(`\n→ wrote data/barterer-trades.json (${trades.length} trades — the valued ledger)`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const start = Number(process.argv[2]) || 2002;
  const end = Number(process.argv[3]) || 2026;
  console.log(`\nIngesting real NFL trades ${start}-${end} (nflverse nfldata)…`);
  const trades = await loadRealTrades(start, end);
  const master = await loadPlayersMaster();
  const otc = await loadOtcContracts();
  console.log('  deriving tier cutoffs from a generated GMSim league…');
  const shares = await tierSharesFromEngine();
  const avg = (f: (s: TierShares) => number): string =>
    pctStr(
      [...shares.values()].reduce((s, v) => s + f(v), 0),
      shares.size,
    );
  console.log(
    `  engine tier mix (avg across position buckets): STAR ${avg((s) => s.star)} · STARTER ${avg((s) => s.starter)} · BACKUP ${avg((s) => s.backup)}`,
  );
  const tv = await tradeValuePrimitives();
  const oracle = new TierOracle(otc, shares);

  const stats: JoinStats = {
    players: 0,
    noMaster: 0,
    ageEstimated: 0,
    tierSources: new Map(),
    playersModern: 0,
    tierSourcesModern: new Map(),
    picks: 0,
    picksExact: 0,
    picksNoRound: 0,
    picksConditional: 0,
  };
  const valued = valueTrades(trades, master, oracle, tv, stats);
  const er = ExchangeRates.fit(valued);
  applyExchangeRates(valued, er);

  reportIngest(trades, stats, start, end);
  reportBar(trades, master);
  reportExchangeRates(er);
  reportEnvelope(valued);
  await writeLedger(valued, start, end);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
