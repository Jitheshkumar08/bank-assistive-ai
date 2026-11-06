import { BadgeCheck, Camera, FileSpreadsheet, FileUser, IdCard, ScrollText } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { MessageKey } from '../i18n/catalog'
import type { Provenance, Tone } from './types'

export type DocumentCategory = 'personal' | 'academic' | 'category' | 'final'

export const documentCategories: Array<{ id: DocumentCategory | 'all'; label: MessageKey }> = [
  { id: 'all', label: 'documents.cat.all' },
  { id: 'personal', label: 'documents.cat.personal' },
  { id: 'academic', label: 'documents.cat.academic' },
  { id: 'category', label: 'documents.cat.category' },
  { id: 'final', label: 'documents.cat.final' },
]

export type RequiredDocument = {
  id: 'photos' | 'identity' | 'puc' | 'qualifying' | 'nucat' | 'category'
  category: DocumentCategory
  /** Applies only to some students (e.g. reserved categories). */
  conditional: boolean
  icon: LucideIcon
  tone: Tone
  provenance: Provenance
}

/** Catalog keys for a document's title, summary and details (text in src/i18n). */
export const documentText = (id: RequiredDocument['id']) => ({
  title: `doc.${id}.title` as MessageKey,
  summary: `doc.${id}.summary` as MessageKey,
  details: `doc.${id}.details` as MessageKey,
})

/**
 * EXAMPLE checklist for orientation only — not a confirmed official list. Every entry is 'provisional' until checked
 * against the current official Nitte / NMAMIT admission instructions. Edit the catalog entries (or replace with an
 * API) once the official list is available.
 */
export const requiredDocuments: RequiredDocument[] = [
  { id: 'photos', category: 'personal', conditional: false, icon: Camera, tone: 'green', provenance: 'provisional' },
  { id: 'identity', category: 'personal', conditional: false, icon: IdCard, tone: 'green', provenance: 'provisional' },
  { id: 'puc', category: 'academic', conditional: false, icon: FileSpreadsheet, tone: 'blue', provenance: 'provisional' },
  { id: 'qualifying', category: 'academic', conditional: false, icon: ScrollText, tone: 'orange', provenance: 'provisional' },
  { id: 'nucat', category: 'final', conditional: false, icon: FileUser, tone: 'orange', provenance: 'provisional' },
  { id: 'category', category: 'category', conditional: true, icon: BadgeCheck, tone: 'red', provenance: 'provisional' },
]
