import { readFileSync } from 'node:fs'
import { parse } from 'dotenv'

/**
 * Loads .env.test and refuses to continue unless DATABASE_URL points at a database whose name ends in "_test".
 * This guard makes it impossible for the destructive test setup to touch the development database.
 */
export function loadTestDatabaseUrl() {
  const values = parse(readFileSync(new URL('../.env.test', import.meta.url)))
  const url = process.env.DATABASE_URL_OVERRIDE ?? values.DATABASE_URL
  const name = url ? new URL(url).pathname.replace(/^\//, '') : ''
  if (!/_test$/.test(name)) {
    throw new Error(`Refusing to run e2e tests: the test database name must end in "_test" (got "${name || 'none'}"). Check .env.test.`)
  }
  return { url, values }
}
