// Regenerates docs/openapi.yaml from the route schemas of the public API.
import { writeFile } from 'node:fs/promises';
import { buildPublicApi } from '../api/build-public-api.ts';
import type { AuthServices } from '../api/v1/auth-routes.ts';
import type { HouseholdService } from '../modules/household/application/household-service.ts';
import type { RegistryService } from '../modules/registry/application/registry-service.ts';
import type { ScenarioService } from '../modules/scenarios/application/scenario-service.ts';

export const OPENAPI_FILE = new URL('../../../docs/openapi.yaml', import.meta.url);

// Only the route schemas matter here: handlers never run, so services are placeholders that fail
// loudly if anything ever calls them.
const notWired = new Proxy(
  {},
  {
    get() {
      throw new Error('Services are not wired in the OpenAPI generator');
    },
  },
);

export async function renderOpenApi(): Promise<string> {
  // The clock is irrelevant to the contract; a fixed one keeps the output reproducible.
  const app = await buildPublicApi({
    logger: false,
    clock: { now: () => new Date(0) },
    registry: notWired as RegistryService,
    scenarios: notWired as ScenarioService,
    households: notWired as HouseholdService,
    auth: { identity: notWired as AuthServices['identity'], accessTokens: notWired as AuthServices['accessTokens'], accounts: notWired as AuthServices['accounts'], secureCookies: true },
  });
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
