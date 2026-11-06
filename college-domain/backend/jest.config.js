// Unit tests: every *.spec.ts file under src. Native ESM: run through `npm test`, which enables --experimental-vm-modules.
export default {
  testEnvironment: 'node',
  testRegex: 'src/.*\\.spec\\.ts$',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  transform: { '^.+\\.ts$': ['ts-jest', { useESM: true, tsconfig: 'tsconfig.json' }] },
}
