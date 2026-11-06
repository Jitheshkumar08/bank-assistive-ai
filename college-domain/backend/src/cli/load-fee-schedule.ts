/**
 * Loads a confirmed official fee schedule (data/fee-schedules/*.json) into the database.
 *
 *   npm run build
 *   npm run fees:load -- --file data/fee-schedules/nmamit-btech-2026-27.json
 *
 * It refuses files whose confirmation.status is not "CONFIRMED": amounts transcribed from a PDF must be checked by a
 * person first. Rows are inserted or updated (never deleted) and the load is recorded in the audit log.
 */
import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { AppModule } from '../app.module.js'
import { feeRowsFromFile } from '../fees/fee-schedule-file.js'
import { FeeService } from '../fees/fee.service.js'

const { values } = parseArgs({ options: { file: { type: 'string' } }, strict: true })

if (!values.file) {
  process.stderr.write('Usage: npm run fees:load -- --file <schedule.json>\n')
  process.exit(2)
}

let rows
try {
  rows = feeRowsFromFile(JSON.parse(readFileSync(values.file, 'utf8')))
} catch (error) {
  process.stderr.write(`Fee schedule refused: ${error instanceof Error ? error.message : 'unreadable file'}\n`)
  process.exit(1)
}

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] })
try {
  const result = await app.get(FeeService).load(rows)
  process.stdout.write(`Fee schedule ${rows[0].academicYear} for ${rows[0].institutionId}: ${result.created} rows added, ${result.updated} rows updated.\n`)
} catch (error) {
  process.stderr.write(`Fee schedule load failed: ${error instanceof Error ? error.message : 'unknown error'}\n`)
  process.exitCode = 1
} finally {
  await app.close()
}
