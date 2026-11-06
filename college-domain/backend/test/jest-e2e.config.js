/** End-to-end tests against the disposable test database configured in .env.test (name must end in _test). */
export default {
  rootDir: '..',
  testEnvironment: 'node',
  testRegex: 'test/.*\\.e2e-spec\\.ts$',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  transform: { '^.+\\.ts$': ['ts-jest', { useESM: true, tsconfig: 'tsconfig.json' }] },
  globalSetup: '<rootDir>/test/global-setup.js',
  testTimeout: 60_000,
}
