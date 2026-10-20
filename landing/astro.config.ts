import { defineConfig } from 'astro/config';

// Static output: the landing has no server code. Payments, demo and accounts live in the
// backend and the app (CLAUDE.md rules 6 and 8); the landing only links to them.
export default defineConfig({
  output: 'static',
  // 4321 is taken by the clickable prototype (prototype/serve.mjs).
  server: { port: 4322, host: '127.0.0.1' },
  build: { inlineStylesheets: 'auto' },
});
