/**
 * Unit test configuration.
 *
 * Unlike the e2e suite, nothing here boots the application or opens a
 * database connection: services are constructed directly with stubbed
 * collaborators. These tests are safe to run against any checkout,
 * whatever DATABASE_URL happens to point at.
 */

// Same reason as jest-e2e.js: these ship ESM only and must be compiled.
const ESM_ONLY_DEPENDENCIES = ['@nestjs/jwt', '@nestjs/passport'];

module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '..',
  testEnvironment: 'node',
  testRegex: '\\.unit-spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: { allowJs: true, esModuleInterop: true } }],
  },
  transformIgnorePatterns: [`/node_modules/(?!(${ESM_ONLY_DEPENDENCIES.join('|')})/)`],
};
