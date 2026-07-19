import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'dev-dist'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.strict],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // Service-worker glue code and API client wrappers legitimately use
      // untyped payloads at the network boundary.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Downgraded from `strict`'s hard error to a warning: every existing
      // use (main.tsx's getElementById('root')!, useSSE's already-null-
      // checked path!, StudentRealtime's seenRejected map lookup right
      // after unconditionally setting that same key) is a reviewed, correct
      // non-null assertion — not the pattern this rule exists to catch.
      '@typescript-eslint/no-non-null-assertion': 'warn',
      // Promise<void>/apiFetch<void> is the established, idiomatic way this
      // codebase types a "fire and ignore the response body" API call.
      '@typescript-eslint/no-invalid-void-type': 'off',
      // Deleting a computed key off a plain-object-as-map (cart state,
      // touched-order tracking) is this codebase's established pattern for
      // "remove an entry" — not a hot path, so the V8 de-opt this rule
      // guards against doesn't apply here.
      '@typescript-eslint/no-dynamic-delete': 'off',
    },
  },
  {
    // sw.ts runs in the service worker global scope, not the browser window.
    files: ['src/sw.ts'],
    languageOptions: {
      globals: globals.serviceworker,
    },
  },
);
