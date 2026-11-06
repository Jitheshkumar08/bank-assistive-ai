import { BellRing, FileText, QrCode } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { MessageKey } from '../i18n/catalog'
import type { Tone } from './types'

export type Announcement = { id: string; title: MessageKey; text: MessageKey; icon: LucideIcon; tone: Tone; path?: string; external?: string }

/**
 * CampusGuide tips (not institutional news). Official announcements will come from the backend once it exists;
 * none are invented here. Text: src/i18n catalogs.
 */
export const announcements: Announcement[] = [
  { id: 'scan', title: 'announce.scan.title', text: 'announce.scan.text', icon: QrCode, tone: 'blue', path: '/scan' },
  { id: 'documents', title: 'announce.documents.title', text: 'announce.documents.text', icon: FileText, tone: 'purple', path: '/documents' },
  { id: 'official', title: 'announce.official.title', text: 'announce.official.text', icon: BellRing, tone: 'orange', external: 'https://nitte.edu.in' },
]
