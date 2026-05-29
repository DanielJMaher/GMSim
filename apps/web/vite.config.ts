import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf-8'),
);

export default defineConfig({
  plugins: [react()],
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
