import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pkgPath = fileURLToPath(new URL('./package.json', import.meta.url));
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));

/**
 * `__APP_VERSION__` is a `define` baked when the config loads, so after a
 * `pnpm version:sync` a long-lived dev server kept reporting the old version
 * (the stale-badge half of the old "relaunch the inspector clean" ritual).
 * Watch package.json and restart the server in place — the restart re-reads
 * the config, so the badge is always current.
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
  // was the stale-engine half of the relaunch ritual: edits to
  // packages/engine/src were served from a frozen optimizeDeps snapshot
  // until node_modules/.vite was wiped by hand.)
  optimizeDeps: {
    exclude: ['@gmsim/engine'],
  },
  // Relative asset paths so the inspector deploys cleanly under any
  // GitHub Pages subpath (e.g. https://<user>.github.io/GMSim/).
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    port: 5173,
    strictPort: false,
    // Bind on all interfaces (0.0.0.0) so the inspector is reachable from
    // other devices on the LAN — e.g. viewing it on a phone over home
    // WiFi at http://<this-machine-LAN-IP>:5173. Vite prints the Network
    // URL on startup. (Windows Firewall may prompt to allow Node on
    // private networks the first time.)
    host: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
  },
});
