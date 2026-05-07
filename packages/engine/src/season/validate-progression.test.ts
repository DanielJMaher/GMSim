/**
 * Multi-season validation harness for the v0.6.0 progression slice.
 *
 * This file is intentionally tagged `validate-progression` (not just
 * `validate`) so it's easy to run in isolation:
 *
 *   pnpm test -- --run validate-progression
 *
 * It does not assert anything — it prints summary stats so we can eyeball
 * dynasty emergence, cap drift, age distribution, and skill bounds across
 * several seeds. Hard-coded as `describe.skip` to keep CI noise down; flip
 * to `describe.only` (or remove `.skip`) when validating progression
 * changes.
 */
import { describe, it } from 'vitest';
import { createLeague } from '../league/generate.js';
import { simulateSeason } from './runner.js';
import { advanceSeason } from './advance.js';
import { ageOfPlayer } from './development.js';
import { summarizeTeamCap } from '../contracts/cap.js';

const SEEDS = ['validate-1', 'validate-2', 'validate-3'];
const SEASONS = 10;

describe.skip('progression validation', () => {
  it('reports multi-season stats across several seeds', () => {
    /* eslint-disable no-console */
    console.log(`\nValidating ${SEASONS}-season progression across ${SEEDS.length} seeds`);
    console.log('='.repeat(72));

    for (const seed of SEEDS) {
      let league = createLeague({ seed });
      for (let i = 0; i < SEASONS; i++) {
        league = simulateSeason(league);
        league = advanceSeason(league);
      }

      console.log(`\nSeed: ${seed}  (after ${SEASONS} seasons)`);

      const teams = Object.values(league.teams);
      const usages = teams.map((t) => summarizeTeamCap(t, league).capUsed);
      const minCap = Math.min(...usages);
      const maxCap = Math.max(...usages);
      const avgCap = usages.reduce((s, v) => s + v, 0) / usages.length;
      console.log(
        `  Cap usage:  avg $${(avgCap / 1e6).toFixed(1)}M  min $${(minCap / 1e6).toFixed(1)}M  max $${(maxCap / 1e6).toFixed(1)}M  (cap $${(league.salaryCap / 1e6).toFixed(0)}M)`,
      );

      const players = Object.values(league.players);
      let outOfBounds = 0;
      for (const p of players) {
        for (const v of Object.values(p.current)) {
          if (v < 1 || v > 99) outOfBounds++;
        }
      }
      console.log(`  Skill bounds violations: ${outOfBounds} (must be 0)`);

      const ages = players.map((p) => ageOfPlayer(p, league.seasonNumber));
      const minAge = Math.min(...ages);
      const maxAge = Math.max(...ages);
      const avgAge = ages.reduce((s, v) => s + v, 0) / ages.length;
      console.log(`  Player ages:  avg ${avgAge.toFixed(1)}  min ${minAge}  max ${maxAge}`);

      const dynasties = teams
        .map((t) => ({
          name: t.identity.fullName,
          sbWins: t.seasonHistory.filter((r) => r.championshipResult === 'won_super_bowl').length,
          playoffApps: t.seasonHistory.filter((r) => r.madePlayoffs).length,
        }))
        .filter((t) => t.sbWins > 0 || t.playoffApps >= 3)
        .sort((a, b) => b.sbWins - a.sbWins || b.playoffApps - a.playoffApps);

      console.log(`  Dynasty candidates:`);
      if (dynasties.length === 0) {
        console.log(`    (none)`);
      } else {
        for (const t of dynasties.slice(0, 5)) {
          console.log(
            `    - ${t.name}: ${t.sbWins} SB${t.sbWins !== 1 ? 's' : ''}, ${t.playoffApps} playoff apps`,
          );
        }
      }

      const badRosters = teams.filter((t) => t.rosterIds.length !== 53).length;
      const badContracts = Object.values(league.contracts).filter(
        (c) => c.yearsRemaining <= 0 || c.yearsRemaining > c.realYears,
      ).length;
      if (badRosters > 0) console.log(`  ⚠ ${badRosters} teams have non-53 rosters`);
      if (badContracts > 0) console.log(`  ⚠ ${badContracts} contracts have invalid yearsRemaining`);
    }

    console.log('\n' + '='.repeat(72));
    console.log('Done.\n');
    /* eslint-enable no-console */
  });
});
