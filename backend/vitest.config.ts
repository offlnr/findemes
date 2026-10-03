import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      reporter: ['text', 'lcov'],
      thresholds: {
        // CLAUDE.md "Calidad": core line coverage above 90 % blocks integration if it drops.
        'src/core/**': { lines: 90 },
      },
    },
  },
});
