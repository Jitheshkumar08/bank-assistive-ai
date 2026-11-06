import type { MessageKey, Vars } from '../i18n/catalog'
import { admissionProcessSteps, stepText } from './admissionProcess'
import { destinations } from './destinations'
import { documentText, requiredDocuments } from './documents'
import { feeInfoSections } from './fees'

export type SearchEntry = { id: string; title: string; context: string; path: string }
type T = (key: MessageKey, vars?: Vars) => string

/** Small client-side index over the app's own content, in the selected language (no external search). */
export function buildSearchIndex(t: T): SearchEntry[] {
  return [
    ...Object.values(destinations).map((item) => ({ id: `page-${item.id}`, title: t(item.title), context: t(item.description), path: item.path })),
    { id: 'page-scan', title: t('dest.scan.title'), context: t('dest.scan.description'), path: '/scan' },
    { id: 'page-resources', title: t('dest.resources.title'), context: t('dest.resources.description'), path: '/resources' },
    ...requiredDocuments.map((doc) => {
      const text = documentText(doc.id)
      return { id: `doc-${doc.id}`, title: t(text.title), context: t('search.ctx.documents', { detail: t(text.summary) }), path: `/documents#${doc.id}` }
    }),
    ...admissionProcessSteps.map((step) => {
      const text = stepText(step.id)
      return { id: `step-${step.id}`, title: t(text.title), context: t('search.ctx.process', { detail: t(text.subtitle) }), path: '/admission-process' }
    }),
    ...feeInfoSections.map((section) => ({ id: `fee-${section.id}`, title: t(section.title), context: t('nav.fees'), path: '/fees' })),
  ]
}

export function searchContent(query: string, t: T, limit = 6): SearchEntry[] {
  const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return []
  return buildSearchIndex(t)
    .filter((entry) => terms.every((term) => `${entry.title} ${entry.context}`.toLocaleLowerCase().includes(term)))
    .slice(0, limit)
}
