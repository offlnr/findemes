// Applies database migrations and (optionally) creates the services' login roles.
// Usage: pnpm db:migrate  (MIGRATION_DATABASE_URL must use the owner role)
// Set API_DB_PASSWORD / ADMIN_DB_PASSWORD to also create or update the login roles.
import { runMigrations } from '../adapters/postgres/migrator.ts';

const ownerUrl = process.env['MIGRATION_DATABASE_URL'];
if (ownerUrl === undefined || ownerUrl === '') {
  throw new Error('MIGRATION_DATABASE_URL is required');
}

const { applied } = await runMigrations({
  ownerUrl,
  apiPassword: process.env['API_DB_PASSWORD'],
  adminPassword: process.env['ADMIN_DB_PASSWORD'],
});
process.stdout.write(applied.length > 0 ? `Applied: ${applied.join(', ')}\n` : 'Database is up to date\n');
