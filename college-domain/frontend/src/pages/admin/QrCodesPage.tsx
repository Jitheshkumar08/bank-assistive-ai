import { QrCode } from 'lucide-react'
import { useState } from 'react'
import { useServices } from '../../app/services'
import { Card, EmptyState, ErrorState, Notice, PageHeading, SkeletonRows } from '../../components/admin/AdminUi'
import { PublicUrlNotice, QrPlacementCard } from '../../components/admin/QrPlacements'
import { useAsync } from '../../lib/useAsync'

/** College Admin: view and download the college's QR codes. Creating or changing placements is Super Admin only. */
export default function QrCodesPage() {
  const { admin } = useServices()
  const list = useAsync(() => admin.qrCodes.list(), [admin])
  const [error, setError] = useState<string | null>(null)
  return (
    <>
      <PageHeading title="QR Codes" subtitle="Download the approved QR codes for your college’s locations" />
      {error && <div style={{ marginBottom: 16 }}><Notice tone="error">{error}</Notice></div>}
      {list.state.status === 'error' && !list.state.data ? <Card><ErrorState message={list.state.message} onRetry={list.reload} /></Card>
        : !list.state.data ? <Card><SkeletonRows rows={3} columns={3} label="Loading QR codes…" /></Card>
        : (
          <div className="adm-stack">
            <PublicUrlNotice publicAppUrl={list.state.data.publicAppUrl} />
            {list.state.data.items.length ? (
              <div className="adm-qr-grid">
                {list.state.data.items.map((placement) => <QrPlacementCard key={placement.id} placement={placement} reader={admin.qrCodes} onError={setError} />)}
              </div>
            ) : <Card><EmptyState icon={QrCode} title="No QR codes yet">Ask the CampusGuide Super Admin to create a QR placement for your college.</EmptyState></Card>}
            <p className="muted" style={{ fontSize: '0.8125rem' }}>New locations, activation and deactivation are managed by the CampusGuide Super Admin.</p>
          </div>
        )}
    </>
  )
}
