import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { OPENAPI_FILE, renderOpenApi } from '../src/composition/generate-openapi.ts';

describe('docs/openapi.yaml', () => {
  it('matches the routes of the public API (run `pnpm openapi:generate` after changing a route)', async () => {
    const committed = await readFile(OPENAPI_FILE, 'utf8');
    expect(committed).toBe(await renderOpenApi());
  });
});
