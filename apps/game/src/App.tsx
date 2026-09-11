/**
 * `apps/game` — the player-facing game, distinct from the `apps/web`
 * inspector (GAME_UI_FOUNDATION.md D3a: "the game is its own thing separate
 * from the inspector").
 *
 * The screens themselves are W4 step 5 and are deliberately not here yet.
 * What this shell establishes first is the part §1 calls expensive to rework
 * later: the knowledge boundary (enforced by `boundary/engine-imports.test.ts`)
 * and the version stamp every alpha bug report is triaged against (§5).
 */
export function App(): JSX.Element {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-6 py-4">
        <h1 className="text-lg font-semibold tracking-tight">GMSim</h1>
        <p className="mt-1 text-xs text-zinc-500">
          alpha walking skeleton · v{__APP_VERSION__}
        </p>
      </header>
      <main className="px-6 py-8">
        <p className="text-sm text-zinc-400">
          Shell only. Screens land with W4 step 5.
        </p>
      </main>
    </div>
  );
}
