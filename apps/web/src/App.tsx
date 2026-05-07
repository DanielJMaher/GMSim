import { NFL_TEAMS } from '@gmsim/data';
import { Prng } from '@gmsim/engine';
import { Division } from '@gmsim/engine/types';

/**
 * Phase 0 placeholder. Proves the cross-package wiring works:
 *   - engine types/PRNG resolve
 *   - data package resolves
 *   - Tailwind builds
 *
 * No game state yet. Phase 1 will replace this with a league inspector.
 */
export function App() {
  // Sanity-check the PRNG is deterministic by using a fixed seed for the demo.
  const prng = new Prng('phase-0-demo');
  const lucky = prng.pick(NFL_TEAMS);

  const divisions = Object.values(Division);

  return (
    <main className="min-h-screen p-8">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">GMSim</h1>
        <p className="mt-1 text-sm text-zinc-400">Phase 0 — scaffolding only. No simulation yet.</p>
      </header>

      <section className="mb-8 rounded border border-zinc-800 bg-zinc-900/50 p-4">
        <p className="text-xs uppercase tracking-wide text-zinc-500">PRNG self-check</p>
        <p className="mt-1">
          With seed <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-sm">phase-0-demo</code>,
          the deterministic pick is{' '}
          <span className="font-medium text-emerald-400">{lucky.fullName}</span>.
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          Reload — the result will not change. (If it does, determinism is broken.)
        </p>
      </section>

      <section>
        <h2 className="mb-4 text-xl font-medium">League ({NFL_TEAMS.length} teams)</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {divisions.map((division) => (
            <div key={division} className="rounded border border-zinc-800 bg-zinc-900/30 p-3">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                {division.replace('_', ' ')}
              </h3>
              <ul className="space-y-1">
                {NFL_TEAMS.filter((t) => t.division === division).map((t) => (
                  <li key={t.id} className="flex justify-between text-sm">
                    <span>{t.fullName}</span>
                    <span className="text-zinc-600">{t.marketSize.toLowerCase()}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
