import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pkgPath = fileURLToPath(new URL('./package.json', import.meta.url));
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));

/**
 * `__APP_VERSION__` is a `define` baked when the config loads, so after a
 * `pnpm version:sync` a long-lived dev server kept reporting the old version.
 * Watch package.json and restart in place — the restart re-reads the config,
 * so the badge is always current. (Same fix as apps/web's, and the game needs
 * it more: the version stamp is what a tester's bug report is triaged against,
 * per GAME_UI_FOUNDATION.md §5.)
 */
function versionWatch(): PluginOption {
  return {
    name: 'gmsim-version-watch',
    apply: 'serve',
    configureServer(server) {
      server.watcher.add(pkgPath);
      server.watcher.on('change', (file) => {
        if (file === pkgPath) void server.restart();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), versionWatch()],
  // The linked engine workspace is plain TS source — keep it OUT of the
  // pre-bundle so engine edits hot-update like app source. (Pre-bundling it
  // is the stale-engine trap documented in CLAUDE.md's inspector section.)
  optimizeDeps: {
    exclude: ['@gmsim/engine'],
  },
  // Relative asset paths so the game deploys cleanly under any GitHub Pages
  // subpath (the alpha distribution story — GAME_UI_FOUNDATION.md §3/D5).
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    // 5273, NOT the 5173-5190 block the inspector lives in. The house ritual
    // for a stale inspector is "kill every listener on 5173-5190 and
    // relaunch" (CLAUDE.md); putting the game outside that range means that
    // sweep can never take the game server down with it, and a stray
    // auto-incremented inspector can never squat the game's port.
    port: 5273,
    strictPort: false,
    // Bind all interfaces so the alpha build is reachable from a phone on
    // the LAN, same as the inspector.
    host: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
  },
});
