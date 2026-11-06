import { Plus, QrCode } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { useServices } from '../../app/services'
import { Card, Dialog, EmptyState, ErrorState, Notice, PageHeading, SkeletonRows } from '../../components/admin/AdminUi'
import { formatDate } from '../../components/admin/format'
import { PublicUrlNotice, QrPlacementCard } from '../../components/admin/QrPlacements'
import { useAsync } from '../../lib/useAsync'
import type { QrPlacement } from '../../services/admin/adminTypes'
import { errorMessage, ServiceError } from '../../services/errors'

const slugPattern = /^[a-z0-9][a-z0-9-]{0,39}$/
/** Suggests a location id from the label ("Central Library" → "central-library"); the admin can edit it. */
const suggestSlug = (label: string) => label.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '')

/** Super Admin QR Management: every placement, create, activate / deactivate (confirmed), downloads and activity. */
export default function QrManagementPage() {
  const { superAdmin } = useServices()
  const list = useAsync(() => superAdmin.qrCodes.list(), [superAdmin])
  const activity = useAsync(() => superAdmin.auditEvents({ entityType: 'InstitutionQrCode', pageSize: 10 }), [superAdmin])
  const [creating, setCreating] = useState(false)
  const [confirming, setConfirming] = useState<QrPlacement | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const refresh = () => { list.reload(); activity.reload() }

  async function setActive(placement: QrPlacement, active: boolean) {
    setBusyId(placement.id)
    setMessage(null)
    try {
      await superAdmin.qrCodes.setActive(placement.id, active)
      setMessage({ tone: 'success', text: active ? `“${placement.label}” is active again. Its printed codes open CampusGuide.` : `“${placement.label}” was deactivated. Scans of its codes are now rejected; nothing was deleted.` })
      refresh()
    } catch (error) {
      setMessage({ tone: 'error', text: errorMessage(error, 'The placement could not be updated.') })
    } finally {
      setBusyId(null)
      setConfirming(null)
    }
  }

  return (
    <>
      <PageHeading title="QR Management" subtitle="Create, download and activate the QR codes printed at college locations"
        actions={<button type="button" className="adm-btn" onClick={() => setCreating(true)}><Plus size={16} aria-hidden="true" /> New QR placement</button>} />
      {message && <div style={{ marginBottom: 16 }} role={message.tone === 'error' ? 'alert' : 'status'}><Notice tone={message.tone}>{message.text}</Notice></div>}
      {list.state.status === 'error' && !list.state.data ? <Card><ErrorState message={list.state.message} onRetry={list.reload} /></Card>
        : !list.state.data ? <Card><SkeletonRows rows={3} columns={3} label="Loading QR placements…" /></Card>
        : (
          <div className="adm-stack">
            <PublicUrlNotice publicAppUrl={list.state.data.publicAppUrl} />
            {list.state.data.items.length ? (
              <div className="adm-qr-grid">
                {list.state.data.items.map((placement) => (
                  <QrPlacementCard key={placement.id} placement={placement} reader={superAdmin.qrCodes} onError={(text) => setMessage({ tone: 'error', text })}
                    actions={placement.isActive
                      ? <button type="button" className="adm-btn adm-btn--sm adm-btn--danger" disabled={busyId === placement.id} onClick={() => setConfirming(placement)}>Deactivate</button>
                      : <button type="button" className="adm-btn adm-btn--sm adm-btn--navy" disabled={busyId === placement.id} onClick={() => void setActive(placement, true)}>{busyId === placement.id ? 'Activating…' : 'Activate'}</button>} />
                ))}
              </div>
            ) : <Card><EmptyState icon={QrCode} title="No QR placements yet">Create one for each location where a QR code will be displayed.</EmptyState></Card>}
          </div>
        )}

      <div style={{ marginTop: 16 }}>
        <Card title="Recent QR activity" bodyless actions={<Link to="/super-admin/audit-log" className="adm-btn adm-btn--ghost adm-btn--sm">Audit log</Link>}>
          {activity.state.status === 'error' && !activity.state.data ? <ErrorState message={activity.state.message} onRetry={activity.reload} />
            : !activity.state.data ? <SkeletonRows rows={3} columns={3} label="Loading QR activity…" />
            : !activity.state.data.items.length ? <EmptyState title="No QR changes recorded yet" />
            : (
              <div className="adm-table-wrap">
                <table className="adm-table">
                  <thead><tr><th>Date &amp; Time</th><th>Actor</th><th>Action</th><th>Placement</th></tr></thead>
                  <tbody>
                    {activity.state.data.items.map((event) => {
                      const meta = (event.metadata ?? {}) as { label?: unknown; areaSlug?: unknown }
                      return (
                        <tr key={event.id}>
                          <td style={{ whiteSpace: 'nowrap' }}>{formatDate(event.createdAt, true)}</td>
                          <td>{event.actorName}</td>
                          <td>{event.description}</td>
                          <td className="muted">{typeof meta.label === 'string' ? meta.label : '—'}{typeof meta.areaSlug === 'string' ? ` (${meta.areaSlug})` : ''}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
        </Card>
      </div>

      {creating && <CreateDialog onClose={() => setCreating(false)} onCreated={(placement) => { setCreating(false); setMessage({ tone: 'success', text: `QR placement “${placement.label}” was created. Download its PNG or SVG below.` }); refresh() }} />}
      {confirming && (
        <Dialog title="Deactivate this QR placement?" onClose={() => setConfirming(null)} footer={
          <>
            <button type="button" className="adm-btn adm-btn--ghost" onClick={() => setConfirming(null)} disabled={busyId !== null}>Cancel</button>
            <button type="button" className="adm-btn adm-btn--danger" onClick={() => void setActive(confirming, false)} disabled={busyId !== null}>{busyId ? 'Deactivating…' : 'Deactivate'}</button>
          </>
        }>
          <p><strong>{confirming.label}</strong> ({confirming.institution.shortName}, <code>{confirming.areaSlug}</code>) — every printed copy of this code stops working: students who scan it see “not an approved QR code”. The placement is kept and can be reactivated later.</p>
        </Dialog>
      )}
    </>
  )
}

function CreateDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (placement: QrPlacement) => void }) {
  const { superAdmin } = useServices()
  const overview = useAsync(() => superAdmin.overview(), [superAdmin])
  const colleges = overview.state.status === 'ready' ? overview.state.data.institutions : []
  const [form, setForm] = useState({ institutionId: '', label: '', areaSlug: '' })
  const [slugEdited, setSlugEdited] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const institutionId = form.institutionId || (colleges.length === 1 ? colleges[0].id : '')
  const areaSlug = slugEdited ? form.areaSlug : suggestSlug(form.label)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const problems: Record<string, string> = {}
    if (!institutionId) problems.institutionId = 'Choose the college.'
    if (form.label.trim().length < 2) problems.label = 'Enter where the code will be displayed (at least 2 characters).'
    if (!slugPattern.test(areaSlug)) problems.areaSlug = 'Use 1–40 lower-case letters, digits or “-”, starting with a letter or digit.'
    setErrors(problems)
    if (Object.keys(problems).length || busy) return
    setBusy(true)
    setFailure(null)
    try {
      onCreated(await superAdmin.qrCodes.create({ institutionId, label: form.label.trim(), areaSlug }))
    } catch (error) {
      if (error instanceof ServiceError && error.code === 'VALIDATION_FAILED' && error.details?.length) setErrors(Object.fromEntries(error.details.map((detail) => [detail.field, detail.messages[0] ?? 'Invalid value.'])))
      else setFailure(errorMessage(error, 'The placement could not be created.'))
    } finally {
      setBusy(false)
    }
  }

  const describedBy = (key: string) => (errors[key] ? `qr-${key}-error` : undefined)
  return (
    <Dialog title="New QR placement" onClose={onClose} footer={
      <>
        <button type="button" className="adm-btn adm-btn--ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="submit" form="qr-form" className="adm-btn adm-btn--navy" disabled={busy} aria-busy={busy || undefined}>{busy ? 'Creating…' : 'Create placement'}</button>
      </>
    }>
      <p>The code identifies only the college and this location — never a student. The location id is printed inside the code and cannot be changed later.</p>
      <form id="qr-form" className="adm-form" onSubmit={submit} noValidate>
        <div className="adm-field">
          <label htmlFor="qr-institutionId">College</label>
          <select id="qr-institutionId" value={institutionId} aria-invalid={errors.institutionId ? true : undefined} aria-describedby={describedBy('institutionId')}
            onChange={(event) => setForm({ ...form, institutionId: event.target.value })}>
            <option value="">Choose a college</option>
            {colleges.map((college) => <option key={college.id} value={college.id}>{college.name}</option>)}
          </select>
          {errors.institutionId && <span className="adm-field__error" id="qr-institutionId-error">{errors.institutionId}</span>}
          {overview.state.status === 'error' && <span className="adm-field__error">{overview.state.message}</span>}
        </div>
        <div className="adm-field">
          <label htmlFor="qr-label">Location name</label>
          <input id="qr-label" value={form.label} maxLength={120} autoComplete="off" placeholder="e.g. Central Library entrance" aria-invalid={errors.label ? true : undefined} aria-describedby={describedBy('label')}
            onChange={(event) => setForm({ ...form, label: event.target.value })} />
          {errors.label && <span className="adm-field__error" id="qr-label-error">{errors.label}</span>}
        </div>
        <div className="adm-field">
          <label htmlFor="qr-areaSlug">Location id</label>
          <input id="qr-areaSlug" value={areaSlug} maxLength={40} autoComplete="off" spellCheck={false} aria-invalid={errors.areaSlug ? true : undefined} aria-describedby={describedBy('areaSlug') ?? 'qr-areaSlug-hint'}
            onChange={(event) => { setSlugEdited(true); setForm({ ...form, areaSlug: event.target.value.toLowerCase() }) }} />
          {errors.areaSlug ? <span className="adm-field__error" id="qr-areaSlug-error">{errors.areaSlug}</span>
            : <span className="muted" id="qr-areaSlug-hint" style={{ fontSize: '0.75rem' }}>Code content: campusguide:college/{institutionId || '…'}?area={areaSlug || '…'}</span>}
        </div>
        {failure && <Notice tone="error">{failure}</Notice>}
      </form>
    </Dialog>
  )
}
