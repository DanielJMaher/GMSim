import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Cap parallel workers — unbounded forks (vitest's default is one per
    // CPU core) let heavy multi-season sim test files pile up concurrently
    // and saturate every core + all available memory at once.
    poolOptions: {
      forks: {
        maxForks: 4,
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/index.ts'],
    },
  },
});
