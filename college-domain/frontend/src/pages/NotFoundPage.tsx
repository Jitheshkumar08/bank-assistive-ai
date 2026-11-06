import { Compass } from 'lucide-react'
import AuthLayout from '../components/layout/AuthLayout'
import PlaceholderCard from '../components/layout/PlaceholderCard'
import { useI18n } from '../i18n/I18nProvider'

export default function NotFoundPage() {
  const { t } = useI18n()
  return (
    <AuthLayout>
      <title>{t('common.pageTitle', { page: t('notFound.pageTitle') })}</title>
      <PlaceholderCard icon={Compass} title={t('notFound.title')} description={t('notFound.text')} noticeTitle={t('notFound.noticeTitle')}>
        {t('notFound.notice')}
      </PlaceholderCard>
    </AuthLayout>
  )
}
