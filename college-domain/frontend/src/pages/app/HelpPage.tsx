import { ExternalLink } from 'lucide-react'
import HelpCard from '../../components/app/HelpCard'
import PageHeader from '../../components/app/PageHeader'
import { useI18n, type MessageKey } from '../../i18n/I18nProvider'

const faqs: { q: MessageKey; a: MessageKey }[] = [
  { q: 'help.faq1.q', a: 'help.faq1.a' },
  { q: 'help.faq2.q', a: 'help.faq2.a' },
  { q: 'help.faq3.q', a: 'help.faq3.a' },
  { q: 'help.faq4.q', a: 'help.faq4.a' },
]

/** Help & Support: FAQs and where to find official information. No invented contact details. */
export default function HelpPage() {
  const { t } = useI18n()
  return (
    <div className="page-narrow stack">
      <title>{t('common.pageTitle', { page: t('nav.help') })}</title>
      <PageHeader title={t('nav.help')} />
      <section className="content-card" aria-labelledby="help-faq">
        <h2 id="help-faq">{t('help.faqTitle')}</h2>
        <div className="stack">
          {faqs.map((item) => <div key={item.q}><p><strong>{t(item.q)}</strong></p><p>{t(item.a)}</p></div>)}
        </div>
      </section>
      <section className="content-card" aria-labelledby="help-official">
        <h2 id="help-official">{t('help.officialTitle')}</h2>
        <p>{t('help.officialText')}</p>
        <a className="button-outline" href="https://nitte.edu.in" target="_blank" rel="noopener noreferrer">{t('help.visit')} <ExternalLink size={14} aria-hidden="true" /><span className="visually-hidden"> {t('common.opensNewTab')}</span></a>
      </section>
      <div className="panel"><HelpCard /></div>
    </div>
  )
}
