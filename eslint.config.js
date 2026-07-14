import js from '@eslint/js';
import globals from 'globals';

/**
 * Flat ESLint config (ESLint 9). The app is browser-side vanilla JS shipped as
 * ES modules and bundled by Vite. Rules are intentionally pragmatic: catch real
 * mistakes (undeclared vars, unreachable code) without drowning the existing
 * codebase in style noise that Prettier already owns.
 */
export default [
  {
    ignores: ['dist/**', 'dev-dist/**', 'node_modules/**', 'backend/**', 'scripts/icons.js'],
  },
  js.configs.recommended,
  {
    files: ['scripts/**/*.js', 'scripts/**/*.mjs', 'vite.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        // CDN/global libs still referenced via window shims.
        SockJS: 'readonly',
        StompJs: 'readonly',
        lucide: 'readonly',
      },
    },
    rules: {
      // `catch (_) {}` and `const _ = …` are deliberate throwaways in this code.
      'no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-console': 'off',
      'no-prototype-builtins': 'off',
    },
  },
];
