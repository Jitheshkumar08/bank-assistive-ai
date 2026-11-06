import { spawnSync } from 'node:child_process'
import { loadTestDatabaseUrl } from './test-database.js'

/** Applies migrations to the disposable test database before the e2e run (never `migrate reset`). */
export default function globalSetup() {
  const { url } = loadTestDatabaseUrl()
  const result = spawnSync('npx', ['prisma', 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8', shell: true })
  if (result.status !== 0) throw new Error(`prisma migrate deploy failed for the test database:\n${(result.stderr || result.stdout).replace(/postgres(ql)?:\/\/\S+/g, '<redacted>')}`)
}
