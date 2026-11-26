// ImgVault repo lint config for the SHARED packages (ESLint 8, eslintrc
// format).
//
// WHY THIS FILE EXISTS: the extension's own config
// (nextgen-extension/.eslintrc.cjs) has `root: true`, so `eslint .` inside
// nextgen-extension lints THAT APP ONLY — `packages/ui` and
// `packages/shared` (the code both apps share, including the photo zoom
// component) were never linted at all. A runtime crash slipped through
// `pnpm lint` there: the zoom component referenced an undefined variable
// (`maxLevel`), the modal threw a ReferenceError when it opened, and the
// whole gallery went blank. `no-undef` catches exactly that — it just never
// ran on those files.
//
// Keep the rule set in sync with nextgen-extension/.eslintrc.cjs.
module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
    node: true,
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
  rules: {
    'react/react-in-jsx-scope': 'off',
    'react/prop-types': 'off',
    'react/no-unescaped-entities': 'off',
    'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true }],
    'no-console': 'off',
    'no-empty': ['error', { allowEmptyCatch: true }],
  },
  ignorePatterns: ['**/node_modules/**', '**/dist/**'],
};
