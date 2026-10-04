import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist/', 'dist-sea/', 'node_modules/', 'data/', 'cache/', 'public/vendor/', 'tray/'] },

  js.configs.recommended,

  // Server and tests: TypeScript on Node
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    extends: [...tseslint.configs.recommended],
    languageOptions: { globals: globals.node },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      '@typescript-eslint/no-explicit-any': 'off'
    }
  },

  // The panel and the overlay: plain browser modules
  {
    files: ['public/js/**/*.js'],
    // YT is the YouTube player API, QRCode comes from vendor/qrcode.min.js
    languageOptions: { globals: { ...globals.browser, YT: 'readonly', QRCode: 'readonly' } },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }] }
  },

  // Scripts: Node
  {
    files: ['scripts/**/*.mjs', 'eslint.config.js'],
    // smoke-frontend.mjs also runs code inside a browser page
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }] }
  },

  // Frontend tests run in jsdom, so they see the browser's globals as well
  {
    files: ['tests/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } }
  },

  // Tests: leftovers in test files are reported, they do not fail the build
  {
    files: ['tests/**'],
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: { 'no-unused-vars': 'warn', '@typescript-eslint/no-unused-vars': 'warn', 'prefer-const': 'warn' }
  }
)
