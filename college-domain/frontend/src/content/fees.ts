import { BadgeIndianRupee, CircleAlert, GraduationCap, RotateCcw } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { MessageKey } from '../i18n/catalog'
import type { Tone } from './types'

/** Official B.Tech fee document published by Nitte (opened in a new tab; CampusGuide does not host or alter it). */
export const officialFeeDocument = {
  title: 'fees.docTitle',
  source: 'fees.docSource',
  url: 'https://nitte.edu.in/fee/BTECH.pdf',
} as const satisfies { title: MessageKey; source: MessageKey; url: string }

export type FeeInfoSection = { id: string; title: MessageKey; text: MessageKey; icon: LucideIcon; tone: Tone }

/** General pointers only; amounts, refund rules and scholarships are defined solely by the official documents. */
export const feeInfoSections: FeeInfoSection[] = [
  { id: 'payment', title: 'fee.payment.title', text: 'fee.payment.text', icon: BadgeIndianRupee, tone: 'red' },
  { id: 'refund', title: 'fee.refund.title', text: 'fee.refund.text', icon: RotateCcw, tone: 'orange' },
  { id: 'scholarships', title: 'fee.scholarships.title', text: 'fee.scholarships.text', icon: GraduationCap, tone: 'teal' },
  { id: 'notes', title: 'fee.notes.title', text: 'fee.notes.text', icon: CircleAlert, tone: 'purple' },
]
