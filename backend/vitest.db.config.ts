import { defineConfig } from 'vitest/config';

// Database integration tests (`pnpm test:db`). Need PostgreSQL: `docker compose up -d`.
export default defineConfig({
  test: {
    include: ['test/db/**/*.test.ts'],
    globalSetup: ['test/db/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
