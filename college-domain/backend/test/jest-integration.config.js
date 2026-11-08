/**
 * Phase 6 cross-process integration tests: the College backend's real HTTP pipeline and engine client against the REAL
 * language-engine HTTP service (started by the test on synthetic College fixtures; no database, no Groq, no network).
 * Needs the engine's Python environment: language_engine/venv, or ENGINE_PYTHON=<path to python>.
 */
export default {
  rootDir: '..',
  testEnvironment: 'node',
  testRegex: 'test/integration/.*\\.int-spec\\.ts$',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  transform: { '^.+\\.ts$': ['ts-jest', { useESM: true, tsconfig: 'tsconfig.json' }] },
  testTimeout: 120_000,
}
