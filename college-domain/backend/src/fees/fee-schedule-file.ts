import { z } from 'zod'
import type { FeeCategory } from '../generated/prisma/client.js'
import { normalizeProgramName } from './fee-calculation.js'

const amount = z.number().int().nonnegative().max(10_000_000)

/** A fee schedule transcribed from an official fee document (see data/fee-schedules/). */
export const feeScheduleFileSchema = z.object({
  institutionId: z.string().regex(/^[a-z0-9][a-z0-9-]{1,39}$/),
  admissionYear: z.number().int().min(2000).max(2100),
  academicYear: z.string().regex(/^\d{4}-\d{2}$/),
  sourceUrl: z.url().max(300),
  sourceSha256: z.string().regex(/^[0-9a-f]{64}$/),
  confirmation: z.object({ status: z.enum(['PENDING', 'CONFIRMED']), confirmedBy: z.string().nullable(), confirmedOn: z.string().nullable() }).loose(),
  programmes: z.array(z.object({
    programName: z.string().trim().min(1).max(160),
    aliases: z.array(z.string().trim().min(1).max(160)).default([]),
    general: amount.nullable(),
    scholarship: amount.nullable(),
    nri: amount.nullable(),
    examFee: amount,
  })).min(1),
}).loose()

export type FeeScheduleFile = z.infer<typeof feeScheduleFileSchema>

export type FeeScheduleRowInput = {
  institutionId: string; admissionYear: number; academicYear: string; programName: string; programKey: string; aliasKeys: string[]
  category: FeeCategory; annualTuition: number | null; annualExamFee: number; sourceUrl: string; sourceSha256: string
}

/**
 * Validates a schedule file and expands it to one row per programme and category. Refuses files that nobody has
 * confirmed, and programme names/aliases that would match more than one programme.
 */
export function feeRowsFromFile(raw: unknown): FeeScheduleRowInput[] {
  const file = feeScheduleFileSchema.parse(raw)
  if (file.confirmation.status !== 'CONFIRMED' || !file.confirmation.confirmedBy?.trim() || !file.confirmation.confirmedOn?.trim()) {
    throw new Error('The fee schedule has not been confirmed. Compare every amount with the official document, then set confirmation.status to "CONFIRMED" with confirmedBy and confirmedOn.')
  }
  const owners = new Map<string, string>()
  for (const programme of file.programmes) {
    for (const key of [programme.programName, ...programme.aliases].map(normalizeProgramName)) {
      const owner = owners.get(key)
      if (owner && owner !== programme.programName) throw new Error(`"${key}" matches both "${owner}" and "${programme.programName}".`)
      owners.set(key, programme.programName)
    }
  }
  return file.programmes.flatMap((programme) => {
    const programKey = normalizeProgramName(programme.programName)
    const aliasKeys = [...new Set(programme.aliases.map(normalizeProgramName))].filter((key) => key !== programKey)
    const amounts: [FeeCategory, number | null][] = [['GENERAL', programme.general], ['SCHOLARSHIP', programme.scholarship], ['NRI', programme.nri]]
    return amounts.map(([category, annualTuition]) => ({
      institutionId: file.institutionId, admissionYear: file.admissionYear, academicYear: file.academicYear, programName: programme.programName,
      programKey, aliasKeys, category, annualTuition, annualExamFee: programme.examFee, sourceUrl: file.sourceUrl, sourceSha256: file.sourceSha256,
    }))
  })
}
