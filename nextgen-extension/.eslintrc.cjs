// ImgVault extension lint config (ESLint 8, eslintrc format).
//
// Gating rules: this config runs in CI (Tests workflow, lint job) and a
// failure blocks the release — see .github/workflows/test.yml. Keep the
// rule set to bug-catchers, not style: every rule turned off below has a
// reason, and re-enabling one means fixing every hit first.
module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
  },
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
  ],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  settings: {
    react: { version: 'detect' },
  },
  globals: {
    // Extension pages + service worker: chrome.* is provided by the browser.
    chrome: 'readonly',
  },
  rules: {
    // React 17+ JSX transform (Vite): no React import needed in scope.
    'react/react-in-jsx-scope': 'off',
    // No propTypes in this codebase (plain JS, no TS).
    'react/prop-types': 'off',
    // JSX text uses natural apostrophes/quotes ("don't", "Bob's"); escaping
    // them hurts readability and catches no bug.
    'react/no-unescaped-entities': 'off',
    // Underscore-prefixed bindings are intentionally unused (e.g. catch (_)).
    // Rest siblings are intentional omission (const { dropped, ...rest }).
    'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true }],
    // Logging is the diagnostics channel for this extension — never lint it.
    'no-console': 'off',
    // Empty catch blocks are idiomatic here (best-effort cleanup/teardown).
    'no-empty': ['error', { allowEmptyCatch: true }],
  },
  overrides: [
    {
      // Node scripts, test runners and configs run under Node, not the browser.
      files: [
        '*.mjs',
        '*.cjs',
        'test/**/*.mjs',
        'scripts/**/*.mjs',
        'vite.config.*',
        'postcss.config.js',
        'tailwind.config.js',
      ],
      env: { node: true },
    },
  ],
  ignorePatterns: ['dist/**', 'artifacts/**', 'coverage/**', 'node_modules/**'],
};
