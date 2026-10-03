// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

const CORE_FILES = ['backend/src/core/**/*.ts'];
const CORE_TEST_FILES = ['backend/src/core/**/*.test.ts'];

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', 'app/**', 'admin/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      eqeqeq: ['error', 'always'],
      'no-console': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      // Agree with tsconfig noPropertyAccessFromIndexSignature (index signatures use obj['key']).
      '@typescript-eslint/dot-notation': ['error', { allowIndexSignaturePropertyAccess: true }],
    },
  },
  {
    files: ['**/*.js', '**/*.cjs'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { module: 'writable', require: 'readonly' },
    },
  },

  // Rule 1 (CLAUDE.md): the core is pure, deterministic and free of I/O.
  // dependency-cruiser enforces the same boundary on the resolved import graph.
  {
    files: CORE_FILES,
    ignores: CORE_TEST_FILES,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(?!\\.{1,2}/)',
              message: 'El núcleo solo puede importar archivos relativos del propio núcleo.',
            },
            {
              group: [
                '**/modules/**',
                '**/adapters/**',
                '**/api/**',
                '**/admin-api/**',
                '**/composition/**',
              ],
              message: 'El núcleo no puede depender de módulos, adaptadores ni APIs (RNF16).',
            },
          ],
        },
      ],
      // Whole globals are banned (not usage patterns) so aliasing such as `const D = Date`
      // or `Reflect.construct(Date, [])` cannot bypass the rule.
      'no-restricted-globals': [
        'error',
        {
          name: 'Date',
          message:
            'El núcleo no usa Date (reloj y zona horaria): los meses llegan como valores YearMonth de entrada.',
        },
        ...[
          'process',
          'require',
          'fetch',
          'setTimeout',
          'setInterval',
          'setImmediate',
          'queueMicrotask',
          'crypto',
          'performance',
          'console',
          'globalThis',
          'Intl',
          'Reflect',
          'WeakRef',
          'FinalizationRegistry',
          'SharedArrayBuffer',
          'Atomics',
        ].map((name) => ({
          name,
          message: 'El núcleo es determinista y no realiza E/S.',
        })),
      ],
      'no-eval': 'error',
      'no-new-func': 'error',
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'El núcleo es determinista: no usa aleatoriedad.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportExpression',
          message: 'El núcleo no usa importaciones dinámicas.',
        },
        {
          selector: ":matches(VariableDeclarator, AssignmentExpression) > Identifier.init[name='Math'], AssignmentExpression > Identifier.right[name='Math']",
          message: 'No se asigna Math a otra variable: oculta usos prohibidos como Math.random.',
        },
        {
          selector: 'CallExpression[callee.property.name=/^(toLocale|localeCompare$)/]',
          message:
            'El formato dependiente del entorno (toLocale*, localeCompare) no es determinista en el núcleo.',
        },
      ],
      '@typescript-eslint/require-array-sort-compare': ['error', { ignoreStringArrays: true }],
    },
  },
);
