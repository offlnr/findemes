/** Layer rules from CLAUDE.md (rules 1, 2, 7, 9; RNF16). Paths are relative to backend/. */

const TEST_FILE = '\\.test\\.ts$';

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'core-is-pure',
      comment:
        'Rule 1: the core only imports files from the core itself (no npm packages, no Node.js built-ins, no other layers).',
      severity: 'error',
      from: { path: '^src/core/', pathNot: TEST_FILE },
      to: { pathNot: '^src/core/' },
    },
    {
      name: 'core-tests-only-use-vitest',
      comment: 'Core tests may import the core and the test runner, nothing else.',
      severity: 'error',
      from: { path: `^src/core/.+${TEST_FILE}` },
      to: { pathNot: ['^src/core/', '(^|/)node_modules/(vitest|@vitest)/'] },
    },
    {
      name: 'modules-do-not-depend-on-outer-layers',
      comment: 'Rule 2: modules depend on the core and on their own ports, never on adapters or entry points.',
      severity: 'error',
      from: { path: '^src/modules/' },
      to: { path: '^src/(adapters|api|admin-api|composition)/' },
    },
    {
      name: 'adapters-do-not-depend-on-entry-points',
      severity: 'error',
      from: { path: '^src/adapters/' },
      to: { path: '^src/(api|admin-api|composition)/' },
    },
    {
      name: 'only-composition-wires-adapters',
      comment: 'Rule 7: entry points and modules reach integrations only through ports wired in composition.',
      severity: 'error',
      from: { path: '^src/', pathNot: '^src/(adapters|composition)/' },
      to: { path: '^src/adapters/' },
    },
    {
      name: 'integration-packages-only-in-adapters',
      comment: 'Rule 7: database, payment, bank and email libraries are used only inside src/adapters.',
      severity: 'error',
      from: { path: '^src/', pathNot: '^src/adapters/' },
      to: {
        path: '(^|/)node_modules/(pg|pg-[^/]+|kysely|fintoc|plaid|transbank-sdk|nodemailer|resend|postmark|@sendgrid/[^/]+)/',
      },
    },
    {
      name: 'http-helpers-are-generic',
      comment: 'src/http holds framework helpers shared by both APIs; it knows nothing of the app.',
      severity: 'error',
      from: { path: '^src/http/' },
      to: { path: '^src/(core|modules|adapters|api|admin-api|composition)/' },
    },
    {
      name: 'core-only-through-public-api',
      comment: 'Other layers import the core through src/core/index.ts, never its internals.',
      severity: 'error',
      from: { pathNot: '^src/core/' },
      to: { path: '^src/core/', pathNot: '^src/core/index\\.ts$' },
    },
    {
      name: 'public-api-does-not-reach-admin-api',
      comment: 'Rule 9: no administrative route inside the public API.',
      severity: 'error',
      from: { path: '^src/api/' },
      to: { path: '^src/admin-api/' },
    },
    {
      name: 'admin-api-does-not-reach-public-api',
      severity: 'error',
      from: { path: '^src/admin-api/' },
      to: { path: '^src/api/' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'no-dev-deps-in-production-code',
      severity: 'error',
      from: { path: '^src/', pathNot: TEST_FILE },
      to: { dependencyTypes: ['npm-dev'] },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.js'],
    },
  },
};
