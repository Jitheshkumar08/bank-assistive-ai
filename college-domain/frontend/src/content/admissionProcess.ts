import type { MessageKey } from '../i18n/catalog'
import type { Provenance } from './types'

export type ProcessStep = { id: 'about' | 'apply' | 'exam' | 'allotment' | 'admission'; provenance: Provenance }

export const stepText = (id: ProcessStep['id']) => ({
  title: `step.${id}.title` as MessageKey,
  subtitle: `step.${id}.subtitle` as MessageKey,
  details: `step.${id}.details` as MessageKey,
})

/**
 * General guidance only: no dates, deadlines, fees or eligibility rules are stated because they change every year.
 * Text lives in the Student Portal catalogs (src/i18n). Replace with official content when it is available.
 */
export const admissionProcessSteps: ProcessStep[] = [
  { id: 'about', provenance: 'general-guidance' },
  { id: 'apply', provenance: 'general-guidance' },
  { id: 'exam', provenance: 'general-guidance' },
  { id: 'allotment', provenance: 'general-guidance' },
  { id: 'admission', provenance: 'general-guidance' },
]
