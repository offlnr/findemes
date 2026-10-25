// Regenerates docs/openapi.yaml from the route schemas of the public API.
import { writeFile } from 'node:fs/promises';
import { buildPublicApi } from '../api/build-public-api.ts';

export const OPENAPI_FILE = new URL('../../../docs/openapi.yaml', import.meta.url);

export async function renderOpenApi(): Promise<string> {
  const app = await buildPublicApi({ logger: false });
  try {
    await app.ready();
    return app.swagger({ yaml: true });
  } finally {
    await app.close();
  }
}

if (import.meta.main) {
  await writeFile(OPENAPI_FILE, await renderOpenApi(), 'utf8');
}
