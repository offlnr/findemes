export const TEMPLATE_DATABASE = 'findemes_test_template';
export const TEST_DATABASE_PREFIX = 'findemes_test_';
/** Test-only login roles: never the service roles used by `pnpm dev:api`. */
export const TEST_API_ROLE = 'findemes_api_test';
export const TEST_ADMIN_ROLE = 'findemes_admin_test';
export const TEST_ROLE_PASSWORD = 'test_role_password_0123456789';

/**
 * Owner-role connection used to create and drop test databases. Only TEST_DATABASE_URL is read,
 * and only a local server is accepted outside CI, so the suite can never touch a shared database.
 */
export function ownerUrl(): URL {
  const raw = process.env['TEST_DATABASE_URL'];
  if (raw === undefined || raw === '') {
    throw new Error('Set TEST_DATABASE_URL (owner role of a local PostgreSQL) to run database tests');
  }
  const url = new URL(raw);
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (!local && process.env['CI'] !== 'true') {
    throw new Error(`Refusing to run database tests against non-local host ${url.hostname}`);
  }
  return url;
}
