import { jest } from '@jest/globals'
import { AdmissionService } from '../admission/admission.service.js'
import type { AuditService } from '../audit/audit.service.js'
import type { AuthenticatedAccount } from '../auth/session.service.js'
import type { AppConfig } from '../config/app-config.service.js'
import { ContextService } from '../context/context.service.js'
import { FeeService } from '../fees/fee.service.js'
import type { PrismaService } from '../prisma/prisma.service.js'
import { ADMISSION_STATUS_OUTCOMES, AssistantAdmissionStatusService, engineWorkflowResult } from './admission-status.service.js'

/**
 * The REAL AdmissionService, ContextService and FeeService over an in-memory stand-in for the database, so these tests
 * exercise the portal's own authorisation rules, not a mock of them. Synthetic data only.
 */
type Record_ = {
  id: string; institutionId: string; officialEmail: string | null; studentAccountId: string | null; nucatReference: string
  studentName: string; nucatRank: number | null; admissionStatus: string | null; verifiedAt: Date | null; admissionYear: number
  allocatedBranch: null; feeCategory: null
}

const record = (over: Partial<Record_>): Record_ => ({
  id: 'r', institutionId: 'test-college', officialEmail: null, studentAccountId: null, nucatReference: 'REF',
  studentName: 'Synthetic Student', nucatRank: null, admissionStatus: 'PROVISIONAL', verifiedAt: null, admissionYear: 2026,
  allocatedBranch: null, feeCategory: null, ...over,
})

const account = (over: Partial<AuthenticatedAccount> = {}): AuthenticatedAccount => ({
  id: 'student-a', email: 'a.student@example.test', role: 'STUDENT', displayName: null, institutionId: null, sessionId: 's', ...over,
})

function setup(records: Record_[]) {
  const queries: unknown[] = []
  const prisma = {
    institution: {
      findFirst: async ({ where }: { where: { id: string } }) => (['test-college', 'other-college'].includes(where.id)
        ? { id: where.id, name: 'Synthetic College', shortName: 'SC' } : null),
    },
    institutionQrCode: {
      findFirst: async ({ where }: { where: { institutionId: string; areaSlug: string } }) =>
        (where.areaSlug === 'admissions-desk' ? { id: 'qr' } : null),
    },
    admissionRecord: {
      findMany: async (args: { where: { institutionId: string; officialEmail: { equals: string }; OR: { studentAccountId: string | null }[] } }) => {
        queries.push(args.where)
        const { institutionId, officialEmail, OR } = args.where
        return records
          .filter((r) => r.institutionId === institutionId && r.officialEmail?.toLowerCase() === officialEmail.equals.toLowerCase()
            && OR.some((clause) => clause.studentAccountId === r.studentAccountId))
          .sort((x, y) => y.admissionYear - x.admissionYear)
      },
    },
    feeSchedule: { findMany: async () => [] },
  } as unknown as PrismaService
  const audit = { record: jest.fn(async () => undefined) } as unknown as AuditService
  const admission = new AdmissionService(prisma, new ContextService(prisma, {} as AppConfig), audit, new FeeService(prisma, audit))
  return { service: new AssistantAdmissionStatusService(admission), queries }
}

describe('assistant admission status (uses the portal’s AdmissionService rules)', () => {
  const own = record({ id: 'own', officialEmail: 'A.Student@example.test', studentName: 'Synthetic Student A' })
  const other = record({ id: 'other', officialEmail: 'b.student@example.test', studentName: 'Synthetic Student B', nucatReference: 'B-REF' })

  it('an authenticated student gets only their own record', async () => {
    const { service } = setup([own, other])
    const result = await service.lookup(account(), 'test-college', 'admissions-desk')
    expect(result.outcome).toBe('details_available')
    expect(result.details?.studentName).toBe('Synthetic Student A')
    expect(JSON.stringify(result)).not.toContain('Synthetic Student B')
  })

  it('the record is found by the session account’s email, never by anything typed', async () => {
    const { service, queries } = setup([own, other])
    await service.lookup(account(), 'test-college', null)
    expect(queries).toHaveLength(1)
    const where = JSON.stringify(queries[0])
    expect(where).toContain('a.student@example.test')
    expect(where).not.toContain('nucatReference')
    // The lookup has no parameter through which a reference number could be passed.
    expect(service.lookup.length).toBe(3)
  })

  it('another student’s email or a record claimed by another account is never returned', async () => {
    const claimed = record({ id: 'claimed', officialEmail: 'a.student@example.test', studentAccountId: 'someone-else' })
    const { service } = setup([claimed, other])
    expect(await service.lookup(account(), 'test-college', null)).toEqual({ outcome: 'no_record' })
  })

  it('an unauthenticated request is refused before any lookup', async () => {
    const { service, queries } = setup([own])
    expect(await service.lookup(null, 'test-college', null)).toEqual({ outcome: 'not_signed_in' })
    expect(queries).toHaveLength(0)
  })

  it.each(['COLLEGE_ADMIN', 'SUPER_ADMIN'] as const)('a %s account gets no student record', async (role) => {
    const { service, queries } = setup([own])
    expect(await service.lookup(account({ role }), 'test-college', null)).toEqual({ outcome: 'not_a_student' })
    expect(queries).toHaveLength(0)
  })

  it('records are scoped to the scanned college', async () => {
    const { service } = setup([own])
    expect(await service.lookup(account(), 'other-college', null)).toEqual({ outcome: 'no_record' })
  })

  it('an inactive college or QR placement is context_invalid, with no lookup', async () => {
    const { service, queries } = setup([own])
    expect(await service.lookup(account(), 'unknown-college', null)).toEqual({ outcome: 'context_invalid' })
    expect(await service.lookup(account(), 'test-college', 'retired-desk')).toEqual({ outcome: 'context_invalid' })
    expect(queries).toHaveLength(0)
  })

  it('two records for the same email in the newest year are ambiguous, and nothing is shown', async () => {
    const { service } = setup([own, record({ id: 'dup', officialEmail: 'a.student@example.test' })])
    expect(await service.lookup(account(), 'test-college', null)).toEqual({ outcome: 'ambiguous_record' })
  })

  it('an unexpected failure is "unavailable", never an error leaking details', async () => {
    const { service } = setup([own])
    ;(service as unknown as { admission: { getDetails: () => Promise<never> } }).admission.getDetails = async () => {
      throw new Error('database down: connection string ...')
    }
    expect(await service.lookup(account(), 'test-college', null)).toEqual({ outcome: 'unavailable' })
  })

  it('only the outcome code is ever sent to the language engine', async () => {
    const { service } = setup([own])
    const lookup = await service.lookup(account(), 'test-college', null)
    expect(engineWorkflowResult('action-123', lookup)).toEqual({ action_id: 'action-123', outcome: 'details_available' })
    expect(ADMISSION_STATUS_OUTCOMES).toContain(lookup.outcome)
  })
})
