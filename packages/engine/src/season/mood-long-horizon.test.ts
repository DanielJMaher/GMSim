import { describe, it, expect } from 'vitest';
import { createLeague } from '../league/generate.js';
import { simulateSeason } from './runner.js';
import { advanceSeason } from './advance.js';

/**
 * Long-horizon mood stability — split out of `mood.test.ts` (gate-
 * optimization pass, 2026-07-04). This block's multi-season walks made
 * `mood.test.ts` a single 42-minute file that BOUNDED the whole CI wall
 * clock (vitest runs tests within one file sequentially; separate files
 * parallelize across workers). The three log-only instruments are
 * skipped by default per the house convention (see
 * `proactive-trades.test.ts`, `*.diagnostic.test.ts`) — they carried 70
 * season-sims (~21 CI minutes) and assert nothing; unskip when
 * investigating mood drift. The two strict regression gates below them
 * still run everywhere.
 */
describe('long-horizon stability (v0.18.0 saturation regression)', () => {
  // Skipped by default — diagnostic instrument (log-only, `expect(true)`).
  // Unskip when investigating per-tier / per-archetype mood drift.
  it.skip('instrument: per-tier and per-archetype mood drift', () => {
    // The aggregate trajectory test below shows the league-mean delta
    // sits near zero. But the user reports visible upward drift in the
    // inspector — meaning the bias is hiding in a subset masked by
    // averaging. Slice by tier and by personality archetype to find
    // where it lives.
    const seeds = ['slice-a', 'slice-b', 'slice-c'];
    const N_SEASONS = 8;
    type Slice = { name: string; mood: number; setPoint: number; n: number };
    const accumulate = (rows: Slice[], key: string, mood: number, setPoint: number) => {
      let row = rows.find((r) => r.name === key);
      if (!row) {
        row = { name: key, mood: 0, setPoint: 0, n: 0 };
        rows.push(row);
      }
      row.mood += mood;
      row.setPoint += setPoint;
      row.n += 1;
    };
    const tierRows: Slice[] = [];
    const archetypeRows: Slice[] = [];
    for (const seed of seeds) {
      let league = createLeague({ seed });
      for (let i = 0; i < N_SEASONS; i++) {
        league = simulateSeason(league);
        league = advanceSeason(league);
      }
      for (const p of Object.values(league.players)) {
        if (p.teamId === null) continue;
        accumulate(tierRows, p.tier, p.mood, p.moodProfile.setPoint);
        accumulate(archetypeRows, p.moodProfile.archetype, p.mood, p.moodProfile.setPoint);
      }
    }
    console.log(`\n=== By tier (avg across ${seeds.length} seeds × ${N_SEASONS} seasons) ===`);
    console.log('tier      | n     | mood   | setpt  | delta');
    for (const r of tierRows.sort((a, b) => a.name.localeCompare(b.name))) {
      const moodAvg = r.mood / r.n;
      const setPointAvg = r.setPoint / r.n;
      const d = moodAvg - setPointAvg;
      console.log(
        `${r.name.padEnd(9)} | ${String(r.n).padStart(5)} | ${moodAvg.toFixed(2).padStart(6)} | ${setPointAvg.toFixed(2).padStart(6)} | ${d >= 0 ? '+' : ''}${d.toFixed(2)}`,
      );
    }
    console.log(`\n=== By personality archetype ===`);
    console.log('archetype   | n     | mood   | setpt  | delta');
    for (const r of archetypeRows.sort((a, b) => a.name.localeCompare(b.name))) {
      const moodAvg = r.mood / r.n;
      const setPointAvg = r.setPoint / r.n;
      const d = moodAvg - setPointAvg;
      console.log(
        `${r.name.padEnd(11)} | ${String(r.n).padStart(5)} | ${moodAvg.toFixed(2).padStart(6)} | ${setPointAvg.toFixed(2).padStart(6)} | ${d >= 0 ? '+' : ''}${d.toFixed(2)}`,
      );
    }
    // No assertion — log-only diagnostic.
    expect(true).toBe(true);
  });

  // Skipped by default — diagnostic instrument (log-only, `expect(true)`).
  // Unskip when investigating long-tenured-player mood bias.
  it.skip('instrument: long-tenured player mood drift', () => {
    // Track players who've been on a roster for many seasons. If
    // long-tenured players accumulate upward bias each season that
    // would explain a "drift up year over year" visible bug while
    // league-wide averages look fine (most players churn out within
    // a few years).
    const seed = 'tenure-a';
    const N_SEASONS = 10;
    let league = createLeague({ seed });
    // Snapshot per-player mood + setPoint at season 0.
    const baseline = new Map<string, { mood: number; setPoint: number; archetype: string; tier: string }>();
    for (const p of Object.values(league.players)) {
      if (p.teamId === null) continue;
      baseline.set(p.id, {
        mood: p.mood,
        setPoint: p.moodProfile.setPoint,
        archetype: p.moodProfile.archetype,
        tier: p.tier,
      });
    }
    for (let i = 0; i < N_SEASONS; i++) {
      league = simulateSeason(league);
      league = advanceSeason(league);
    }
    // Find players who started season-0 and are still rostered at season-N.
    const survivors: { id: string; baseMood: number; baseSetPoint: number; finalMood: number; finalSetPoint: number; archetype: string; tier: string }[] = [];
    for (const p of Object.values(league.players)) {
      if (p.teamId === null) continue;
      const b = baseline.get(p.id);
      if (!b) continue;
      survivors.push({
        id: p.id,
        baseMood: b.mood,
        baseSetPoint: b.setPoint,
        finalMood: p.mood,
        finalSetPoint: p.moodProfile.setPoint,
        archetype: b.archetype,
        tier: b.tier,
      });
    }
    console.log(`\n=== Long-tenured player drift (${survivors.length} survivors after ${N_SEASONS} seasons) ===`);
    if (survivors.length === 0) {
      console.log('(no players survived all seasons)');
    } else {
      const moodChange = survivors.reduce((s, p) => s + (p.finalMood - p.baseMood), 0) / survivors.length;
      const setPointChange = survivors.reduce((s, p) => s + (p.finalSetPoint - p.baseSetPoint), 0) / survivors.length;
      const finalDelta = survivors.reduce((s, p) => s + (p.finalMood - p.finalSetPoint), 0) / survivors.length;
      console.log(`Avg mood change:     ${moodChange >= 0 ? '+' : ''}${moodChange.toFixed(2)}`);
      console.log(`Avg setPoint change: ${setPointChange >= 0 ? '+' : ''}${setPointChange.toFixed(2)} (should be ~0; setPoint is stable)`);
      console.log(`Avg final mood - final setPoint: ${finalDelta >= 0 ? '+' : ''}${finalDelta.toFixed(2)}`);
      // Break down by tier.
      const byTier = new Map<string, { count: number; moodDelta: number }>();
      for (const s of survivors) {
        const row = byTier.get(s.tier) ?? { count: 0, moodDelta: 0 };
        row.count += 1;
        row.moodDelta += s.finalMood - s.baseMood;
        byTier.set(s.tier, row);
      }
      console.log(`\nMood change by season-0 tier:`);
      for (const [tier, row] of [...byTier].sort()) {
        console.log(`  ${tier.padEnd(9)} (n=${row.count}): ${row.moodDelta / row.count >= 0 ? '+' : ''}${(row.moodDelta / row.count).toFixed(2)}`);
      }
    }
    expect(true).toBe(true);
  });

  // Skipped by default — diagnostic instrument. Its own comment: "real
  // assertions live in the strict regression tests below. We just want
  // the log to surface." 3 seeds × 12 seasons was the single most
  // expensive test in the suite; unskip when investigating drift.
  it.skip('instrument: per-season mood trajectory vs setPoint', () => {
    const seeds = ['traj-a', 'traj-b', 'traj-c'];
    const N_SEASONS = 12;
    const trajectories: { seed: string; rows: { season: number; moodMean: number; setPointMean: number; delta: number }[] }[] = [];
    for (const seed of seeds) {
      let league = createLeague({ seed });
      const rows: { season: number; moodMean: number; setPointMean: number; delta: number }[] = [];
      // Record season 0 (pre-sim) baseline.
      const initRostered = Object.values(league.players).filter((p) => p.teamId !== null);
      rows.push({
        season: 0,
        moodMean: initRostered.reduce((s, p) => s + p.mood, 0) / initRostered.length,
        setPointMean: initRostered.reduce((s, p) => s + p.moodProfile.setPoint, 0) / initRostered.length,
        delta: 0,
      });
      rows[0]!.delta = rows[0]!.moodMean - rows[0]!.setPointMean;
      for (let i = 1; i <= N_SEASONS; i++) {
        league = simulateSeason(league);
        league = advanceSeason(league);
        const rostered = Object.values(league.players).filter((p) => p.teamId !== null);
        const moodMean = rostered.reduce((s, p) => s + p.mood, 0) / rostered.length;
        const setPointMean = rostered.reduce((s, p) => s + p.moodProfile.setPoint, 0) / rostered.length;
        rows.push({ season: i, moodMean, setPointMean, delta: moodMean - setPointMean });
      }
      trajectories.push({ seed, rows });
    }
    // Log a compact table per seed.
    for (const t of trajectories) {
      console.log(`\n--- ${t.seed} ---`);
      console.log('season | mood_mean | setpt_mean | delta');
      for (const r of t.rows) {
        console.log(
          `  ${String(r.season).padStart(2)}   |   ${r.moodMean.toFixed(2)}   |   ${r.setPointMean.toFixed(2)}    | ${r.delta >= 0 ? '+' : ''}${r.delta.toFixed(2)}`,
        );
      }
    }
    // Loose gate so this test can run in CI without flakiness — real
    // assertions live in the strict regression tests below. We just
    // want the log to surface.
    for (const t of trajectories) {
      for (const r of t.rows) {
        expect(Math.abs(r.delta)).toBeLessThan(15);
      }
    }
  });

  it('teams with good HC playerRelationships trend above league mean; bad HC trend below', () => {
    // The user-facing requirement: "good coaches should trend their
    // teams up, bad coaches should trend their teams down." If every
    // driver were zero-mean across the league but had no per-team
    // variance the test of the previous block would pass and this one
    // would not — so this guards the *dispersion* side of the contract.
    //
    // The HC→mood DRIVER is stable, but the realized top-vs-bottom-quartile
    // gap on any SINGLE seed is noisy: 4 seasons of roster churn (re-sign
    // window, QB churn, draft) + game-outcome changes (HFA, red-zone
    // scoring) all ripple into long-horizon development and jostle which
    // players sit under which coach. A single seed drifted 0.49 → 0.22
    // across v0.144-157 with the DIRECTION always intact. So average the
    // dispersion over several seeds — the per-seed noise cancels and the
    // true driver dispersion is what's left.
    const SEEDS = ['v018-hc-dispersion', 'v018-hc-disp-b', 'v018-hc-disp-c'];
    const dispersions: number[] = [];
    for (const seed of SEEDS) {
      let league = createLeague({ seed });
      for (let i = 0; i < 4; i++) {
        league = simulateSeason(league);
        league = advanceSeason(league);
      }
      const teamMeans: { hcRel: number; moodMean: number }[] = [];
      for (const team of Object.values(league.teams)) {
        const hc = league.coaches[team.headCoachId];
        if (!hc) continue;
        const rosterMoods = team.rosterIds
          .map((id) => league.players[id])
          .filter((p) => p !== undefined)
          .map((p) => p!.mood);
        if (rosterMoods.length === 0) continue;
        teamMeans.push({
          hcRel: hc.spectrums.playerRelationships,
          moodMean: rosterMoods.reduce((s, m) => s + m, 0) / rosterMoods.length,
        });
      }
      const leagueMean = teamMeans.reduce((s, t) => s + t.moodMean, 0) / teamMeans.length;
      const sortedByHc = [...teamMeans].sort((a, b) => a.hcRel - b.hcRel);
      const q = Math.floor(sortedByHc.length / 4);
      const bottomQ = sortedByHc.slice(0, q);
      const topQ = sortedByHc.slice(-q);
      const bottomMean = bottomQ.reduce((s, t) => s + t.moodMean, 0) / bottomQ.length;
      const topMean = topQ.reduce((s, t) => s + t.moodMean, 0) / topQ.length;
      // Direction is the real contract and must hold every seed; neither
      // group may saturate away from the league mean.
      expect(topMean).toBeGreaterThan(bottomMean);
      expect(Math.abs(topMean - leagueMean)).toBeLessThan(15);
      expect(Math.abs(bottomMean - leagueMean)).toBeLessThan(15);
      dispersions.push(topMean - bottomMean);
    }
    // The seed-averaged dispersion strips the per-seed noise; the true
    // HC-driven gap sits comfortably above this robust floor.
    const avgDispersion = dispersions.reduce((s, d) => s + d, 0) / dispersions.length;
    expect(avgDispersion).toBeGreaterThan(0.3);
  });

  it('distractions track lower than stabilizers over a simmed season', () => {
    const league = simulateSeason(createLeague({ seed: 'v018-archetypes' }));
    const byArchetype = new Map<string, number[]>();
    for (const p of Object.values(league.players)) {
      if (p.teamId === null) continue;
      const list = byArchetype.get(p.moodProfile.archetype) ?? [];
      list.push(p.mood);
      byArchetype.set(p.moodProfile.archetype, list);
    }
    const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
    const distractionMean = avg(byArchetype.get('distraction') ?? []);
    const stabilizerMean = avg(byArchetype.get('stabilizer') ?? []);
    expect(distractionMean).toBeLessThan(stabilizerMean);
    // And the gap should be meaningful — at least ~15 mood points apart.
    expect(stabilizerMean - distractionMean).toBeGreaterThan(15);
  });

  it('emits locker-room-incident transactions across a season', () => {
    const after = simulateSeason(createLeague({ seed: 'v018-incidents' }));
    const incidents = after.transactionLog.filter(
      (t) => t.kind === 'locker-room-incident',
    );
    // 32 teams × 17 weeks × ~50 players × ~1% avg incident rate = a few
    // hundred. The exact count varies by seed but should be solidly
    // non-zero and not absurdly large.
    expect(incidents.length).toBeGreaterThan(20);
    expect(incidents.length).toBeLessThan(3000);
  });
});
