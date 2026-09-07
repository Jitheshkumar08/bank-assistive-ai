/**
 * End-to-end test configuration.
 *
 * A .js config rather than JSON so the transform pattern does not have
 * to survive JSON backslash escaping.
 *
 * These tests boot the real application against the real database, so
 * they run one worker at a time -- parallel workers would race each
 * other over the same rows.
 */

// @nestjs/jwt and @nestjs/passport ship ESM only. Jest's CommonJS
// runtime cannot require them, so they are compiled alongside our own
// sources instead of being skipped like the rest of node_modules.
const ESM_ONLY_DEPENDENCIES = ['@nestjs/jwt', '@nestjs/passport'];

module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '..',
  testEnvironment: 'node',
  testRegex: '\\.e2e-spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: { allowJs: true, esModuleInterop: true } }],
  },
  transformIgnorePatterns: [`/node_modules/(?!(${ESM_ONLY_DEPENDENCIES.join('|')})/)`],
  testTimeout: 30000,
  maxWorkers: 1,
};
