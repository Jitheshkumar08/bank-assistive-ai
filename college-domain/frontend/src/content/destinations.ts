import { BookOpenCheck, FileText, IndianRupee, LayoutList, MessageCircleQuestion, ShieldCheck, Trophy } from 'lucide-react'
import type { LinkCard } from './types'

/** Main destinations, reused by the sidebar, quick-access grids, resources page and search. Text: src/i18n catalogs. */
export const destinations = {
  documents: { id: 'documents', title: 'nav.documents', description: 'dest.documents.description', path: '/documents', icon: FileText, tone: 'purple' },
  process: { id: 'process', title: 'nav.process', description: 'dest.process.description', path: '/admission-process', icon: LayoutList, tone: 'blue' },
  fees: { id: 'fees', title: 'nav.fees', description: 'dest.fees.description', path: '/fees', icon: IndianRupee, tone: 'green' },
  result: { id: 'result', title: 'nav.result', description: 'dest.result.description', path: '/result', icon: Trophy, tone: 'red', requiresQr: true },
  assistant: { id: 'assistant', title: 'nav.assistant', description: 'dest.assistant.description', path: '/assistant', icon: MessageCircleQuestion, tone: 'purple', requiresQr: true },
} satisfies Record<string, LinkCard>

/** Shorter descriptions used on the post-scan dashboard (as in the reference). */
export const compactDestinations: LinkCard[] = [
  { ...destinations.process, icon: ShieldCheck, description: 'dest.compact.process', tone: 'blue' },
  { ...destinations.documents, description: 'dest.compact.documents', tone: 'purple' },
  { ...destinations.fees, description: 'dest.compact.fees', tone: 'orange' },
  { ...destinations.assistant, description: 'dest.compact.assistant', tone: 'purple' },
]

export const resourceDestinations: LinkCard[] = [
  { ...destinations.process, icon: ShieldCheck, description: 'dest.resources.process', tone: 'blue' },
  { ...destinations.documents, description: 'dest.resources.documents', tone: 'purple' },
  { ...destinations.fees, description: 'dest.resources.fees', tone: 'orange' },
  { ...destinations.assistant, description: 'dest.resources.assistant', tone: 'purple' },
]

export const bannerShortcuts: LinkCard[] = [
  { ...destinations.process, id: 'info', title: 'dest.banner.info', icon: BookOpenCheck, tone: 'blue' },
  { ...destinations.documents, tone: 'red' },
  { ...destinations.fees, tone: 'green' },
  { ...destinations.result, id: 'guidance', title: 'dest.banner.guidance', tone: 'purple' },
]
