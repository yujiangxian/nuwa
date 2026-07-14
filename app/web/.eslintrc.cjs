module.exports = {
  root: true,
  env: { browser: true, es2020: true, node: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  // `legacy/` is pre-React vanilla-JS code kept for reference only; it isn't referenced
  // by any HTML entry point or built by Vite, so it's excluded rather than "fixed".
  ignorePatterns: ['dist', 'coverage', 'node_modules', '.eslintrc.cjs', 'playwright-report', 'legacy'],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  plugins: ['react-refresh'],
  rules: {
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true },
    ],
    // tsconfig already enforces unused locals/params via noUnusedLocals/noUnusedParameters;
    // keep this at warn so eslint doesn't duplicate-fail what tsc already catches.
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'off',
    'no-empty': ['error', { allowEmptyCatch: true }],
  },
};
