import { describe, expect, it } from 'vitest';
import { Prng } from '../prng/index.js';
import { createLeague } from '../league/generate.js';
import { simulateSeason } from '../season/runner.js';
import { advanceSeason } from '../season/advance.js';
import { runDraft } from './event.js';
import { rollJuniorDeclarations } from './declaration.js';
import { hasDesperateQbNeed } from './team-needs.js';
import type { TeamId } from '../types/ids.js';

describe('hasDesperateQbNeed', () => {
  it('is true exactly when a team has no starter-quality QB and no franchise dev QB', () => {
    const league = createLeague({ seed: 'qb-need' });
    for (const team of Object.values(league.teams)) {
      const desperate = hasDesperateQbNeed(team, league.players);
      const qbs = team.rosterIds
        .map((id) => league.players[id])
        .filter((p) => p && p.position === 'QB');
      const hasStarter = qbs.some((p) => p!.tier === 'STAR' || p!.tier === 'STARTER');
      const hasFranchiseDev = qbs.some((p) => p!.draftRound === 1 && p!.experienceYears <= 4);
      // Desperation must agree with the underlying roster facts.
      expect(desperate).toBe(!hasStarter && !hasFranchiseDev);
    }
  });

  it('flips to desperate when every QB is stripped from the roster', () => {
    const league = createLeague({ seed: 'qb-strip' });
    const team = Object.values(league.teams)[0]!;
    const stripped = {
      ...team,
      rosterIds: team.rosterIds.filter((id) => league.players[id]?.position !== 'QB'),
    };
    expect(hasDesperateQbNeed(stripped, league.players)).toBe(true);
  });
});

describe('QB-need reach in the draft', () => {
  it('keeps round-1 QB volume realistic while still drafting QBs', () => {
    const base = createLeague({ seed: 'qb-draft' });
    const league = {
      ...base,
      collegePool: rollJuniorDeclarations(new Prng('decl'), base.collegePool),
    };
    const order = Object.keys(league.teams) as TeamId[];
    const result = runDraft(new Prng('draft'), league, {
      draftOrder: order,
      pickedOnTick: 0,
      seasonNumber: league.seasonNumber + 1,
      round: 1,
      startingOverallPick: 1,
    });
    const qbPicks = result.newPlayers.filter((p) => p.position === 'QB');
    // The reach must not flood round 1 with QBs (the bug it replaced grabbed a
    // camp arm for every QB-needy team). Real round-1 QB counts run ~1-6.
    expect(qbPicks.length).toBeLessThanOrEqual(8);
  });

  it('over a full season draft, a QB-desperate team that drafts a passer may take one below board #1', () => {
    let league = createLeague({ seed: 'qb-reach-fire' });
    // Snapshot desperation BEFORE the draft adds rookies.
    const desperateBefore = new Set(
      Object.values(league.teams)
        .filter((t) => hasDesperateQbNeed(t, league.players))
        .map((t) => t.identity.id),
    );
    league = simulateSeason(league);
    league = advanceSeason(league);
    const season = Math.max(...league.draftHistory.map((p) => p.seasonNumber));
    let reaches = 0;
    for (const pick of league.draftHistory) {
      if (pick.seasonNumber !== season) continue;
      const player = league.players[pick.promotedPlayerId];
      if (player?.position !== 'QB') continue;
      if (!desperateBefore.has(pick.teamId)) continue;
      if (pick.boardRankAtPick !== null && pick.boardRankAtPick > 1) reaches++;
    }
    // At least one QB-desperate team reached past its board #1 for a passer.
    expect(reaches).toBeGreaterThan(0);
  });
});
