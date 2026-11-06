/**
 * One-time provisioning of the first CampusGuide Super Admin. Server-side only (needs shell + database access);
 * there is deliberately no HTTP endpoint that grants Super Admin rights.
 *
 *   npm run build
 *   npm run admin:bootstrap -- --email it-admin@college.edu --name "Full Name" [--replace-pending]
 *
 * It refuses to run once any Super Admin account exists. It never accepts or prints a password or token: it emails a
 * single-use activation link (72 h) through the configured email provider. With EMAIL_TRANSPORT=dev-outbox
 * (development only) the message is written to backend/.dev-outbox/.
 */
import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { parseArgs } from 'node:util'
import { AppModule } from '../app.module.js'
import { StaffInvitationsService } from '../staff/staff-invitations.service.js'

const { values } = parseArgs({
  options: { email: { type: 'string' }, name: { type: 'string' }, 'replace-pending': { type: 'boolean', default: false } },
  strict: true,
})

if (!values.email || !values.name) {
  process.stderr.write('Usage: npm run admin:bootstrap -- --email <address> --name "<full name>" [--replace-pending]\n')
  process.exit(2)
}

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] })
try {
  const result = await app.get(StaffInvitationsService).bootstrapSuperAdmin({ email: values.email, displayName: values.name, replacePending: values['replace-pending'] === true })
  const where = result.delivery === 'dev-outbox' ? ' (development: see backend/.dev-outbox/)' : ''
  process.stdout.write(`Super Admin activation link sent to ${result.email}${where}. It expires ${result.expiresAt.toUTCString()} and works once.\n`)
} catch (error) {
  process.stderr.write(`Super Admin provisioning refused: ${error instanceof Error ? error.message : 'unknown error'}\n`)
  process.exitCode = 1
} finally {
  await app.close()
}
