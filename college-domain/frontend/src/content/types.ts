import type { LucideIcon } from 'lucide-react'
import type { MessageKey } from '../i18n/catalog'

/** Colour family used by icon tiles; maps to the --tone-* tokens. */
export type Tone = 'blue' | 'purple' | 'green' | 'red' | 'orange' | 'teal'

/**
 * Where a piece of admission content comes from:
 * - 'official'          – taken directly from an official Nitte/NMAMIT document (with a link)
 * - 'general-guidance'  – general explanation written for students; confirm details officially
 * - 'provisional'       – example list not yet checked against current official instructions
 */
export type Provenance = 'official' | 'general-guidance' | 'provisional'

/** Content text lives in the Student Portal catalogs (src/i18n); content entries hold the keys. */
export type LinkCard = {
  id: string
  title: MessageKey
  description: MessageKey
  path: string
  icon: LucideIcon
  tone: Tone
  /** Needs a validated NMAMIT QR context (personalised features). */
  requiresQr?: boolean
}
