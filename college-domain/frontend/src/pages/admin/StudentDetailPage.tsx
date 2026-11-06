import { Pencil } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { useServices } from '../../app/services'
import { AdmissionStatusBadge, Badge, Card, Dialog, EmptyState, ErrorState, Notice, PageHeading, SkeletonRows } from '../../components/admin/AdminUi'
import { formatDate, formatNumber } from '../../components/admin/format'
import { useAsync } from '../../lib/useAsync'
import type { AuditEntry, RecordFilters, RecordUpdate, StudentRecordDetail } from '../../services/admin/adminTypes'
import { errorMessage, ServiceError } from '../../services/errors'

const fieldLabels: Record<string, string> = { studentName: 'Student name', nucatRank: 'NUCAT rank', allocatedBranch: 'Branch', admissionStatus: 'Status', officialEmail: 'Official email' }

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join('') || '?'

/** One official admission record: details, change history and an audited, confirmed edit. */
export default function StudentDetailPage() {
  const { id = '' } = useParams()
  const { admin } = useServices()
  const record = useAsync(() => admin.record(id), [admin, id])
  const [tab, setTab] = useState<'details' | 'history'>('details')
  const [historyVersion, setHistoryVersion] = useState(0)
  const history = useAsync(() => (tab === 'history' ? admin.recordHistory(id) : Promise.resolve(null)), [admin, id, tab, historyVersion])
  const [editing, setEditing] = useState(false)
  const [saved, setSaved] = useState(false)

  const crumbs = [{ label: 'Student Records', to: '/admin/students' }, { label: record.state.data?.nucatReference ?? 'Record' }]
  if (record.state.status === 'error' && !record.state.data) {
    return <><PageHeading title="Student Details" crumbs={crumbs} /><Card>{record.state.code === 'NOT_FOUND' ? <EmptyState title="Record not found">It may belong to another college or no longer exist.</EmptyState> : <ErrorState message={record.state.message} onRetry={record.reload} />}</Card></>
  }
  if (!record.state.data) return <><PageHeading title="Student Details" crumbs={crumbs} /><Card><SkeletonRows rows={6} columns={2} label="Loading record…" /></Card></>
  const data = record.state.data

  return (
    <>
      <PageHeading title="Student Details" subtitle="View and manage student admission information" crumbs={crumbs}
        actions={<button type="button" className="adm-btn adm-btn--navy" onClick={() => { setSaved(false); setEditing(true) }}><Pencil size={15} aria-hidden="true" /> Edit Record</button>} />
      {saved && <div style={{ marginBottom: 16 }}><Notice tone="success">The record was updated and the change was added to its history.</Notice></div>}
      <div className="adm-grid adm-grid--split">
        <Card>
          <div className="adm-profile-card" style={{ paddingTop: 18 }}>
            <div className="adm-profile-card__top">
              <span className="adm-avatar adm-avatar--lg" aria-hidden="true">{initials(data.studentName)}</span>
              <div>
                <h2>{data.studentName} <AdmissionStatusBadge status={data.admissionStatus} /></h2>
                <span className="muted">{data.nucatReference}</span>
              </div>
            </div>
            <dl className="adm-dl">
              <div><dt>Admission Year</dt><dd>{data.admissionYear}</dd></div>
              <div><dt>Branch</dt><dd>{data.branch?.name ?? 'Not allocated'}</dd></div>
              <div><dt>Email</dt><dd>{data.officialEmail ?? 'Not in the official data'}</dd></div>
              <div><dt>Student verification</dt><dd>{data.verifiedByStudent ? <Badge tone="green">Verified {formatDate(data.verifiedAt)}</Badge> : <Badge tone="grey">Not verified yet</Badge>}</dd></div>
              <div><dt>Last import</dt><dd>{data.lastImport ? <Link className="adm-link" to={`/admin/imports/${data.lastImport.id}`}>{data.lastImport.fileName}</Link> : '—'}</dd></div>
            </dl>
          </div>
        </Card>
        <Card bodyless labelledBy="record-tabs">
          <div className="adm-tabs" role="tablist" id="record-tabs" aria-label="Record sections">
            <button type="button" role="tab" className="adm-tab" aria-selected={tab === 'details'} aria-controls="record-panel" onClick={() => setTab('details')}>Admission Details</button>
            <button type="button" role="tab" className="adm-tab" aria-selected={tab === 'history'} aria-controls="record-panel" onClick={() => setTab('history')}>Change History</button>
          </div>
          <div id="record-panel" role="tabpanel" className="adm-card__body" style={{ paddingTop: 8 }}>
            {tab === 'details' ? (
              <dl className="adm-dl">
                <div><dt>NUCAT Reference</dt><dd>{data.nucatReference}</dd></div>
                <div><dt>Admission Year</dt><dd>{data.admissionYear}</dd></div>
                <div><dt>Branch</dt><dd>{data.branch?.name ?? 'Not allocated'}</dd></div>
                <div><dt>Admission Status</dt><dd><AdmissionStatusBadge status={data.admissionStatus} /></dd></div>
                <div><dt>NUCAT Rank</dt><dd>{data.nucatRank === null ? 'Not published' : formatNumber(data.nucatRank)}</dd></div>
                <div><dt>Record created</dt><dd>{formatDate(data.createdAt, true)}</dd></div>
                <div><dt>Last updated</dt><dd>{formatDate(data.updatedAt, true)}</dd></div>
              </dl>
            ) : <History state={history.state} onRetry={history.reload} />}
          </div>
        </Card>
      </div>
      {editing && (
        <EditRecordDialog record={data} onClose={() => setEditing(false)} onSaved={(updated) => {
          record.setData(updated); setEditing(false); setSaved(true); setHistoryVersion((value) => value + 1)
        }} onStale={() => { setEditing(false); record.reload() }} />
      )}
    </>
  )
}

function History({ state, onRetry }: { state: ReturnType<typeof useAsync<{ items: AuditEntry[] } | null>>['state']; onRetry: () => void }) {
  if (state.status === 'error') return <ErrorState message={state.message} onRetry={onRetry} />
  if (!state.data) return <SkeletonRows rows={3} columns={1} label="Loading history…" />
  if (!state.data.items.length) return <EmptyState title="No changes recorded" />
  return (
    <ul className="adm-timeline">
      {state.data.items.map((event) => {
        const changes = (event.metadata?.changes ?? null) as Record<string, { from: unknown; to: unknown }> | null
        const reason = typeof event.metadata?.reason === 'string' ? event.metadata.reason : null
        return (
          <li key={event.id}>
            <strong>{event.description}</strong>
            <span className="adm-timeline__meta">{event.actorName} · {formatDate(event.createdAt, true)}</span>
            {reason && <span className="adm-change">Reason: {reason}</span>}
            {changes && Object.entries(changes).map(([field, change]) => (
              <span key={field} className="adm-change">{fieldLabels[field] ?? field}: <del>{String(change.from ?? 'empty')}</del> → <ins>{String(change.to ?? 'empty')}</ins></span>
            ))}
          </li>
        )
      })}
    </ul>
  )
}

type Draft = { studentName: string; nucatRank: string; allocatedBranchId: string; admissionStatus: string; officialEmail: string; reason: string }

/** Two steps: edit the fields, then review exactly what changes before it is saved (and audited). */
function EditRecordDialog({ record, onClose, onSaved, onStale }: { record: StudentRecordDetail; onClose: () => void; onSaved: (record: StudentRecordDetail) => void; onStale: () => void }) {
  const { admin } = useServices()
  const filters = useAsync<RecordFilters>(() => admin.recordFilters(), [admin])
  const [draft, setDraft] = useState<Draft>({
    studentName: record.studentName, nucatRank: record.nucatRank === null ? '' : String(record.nucatRank), allocatedBranchId: record.branch?.id ?? '',
    admissionStatus: record.admissionStatus ?? '', officialEmail: record.officialEmail ?? '', reason: '',
  })
  const [step, setStep] = useState<'edit' | 'confirm'>('edit')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [failure, setFailure] = useState<{ message: string; stale: boolean } | null>(null)
  const [saving, setSaving] = useState(false)
  const branches = filters.state.status === 'ready' ? filters.state.data.branches : record.branch ? [record.branch] : []

  const update: RecordUpdate = { expectedUpdatedAt: record.updatedAt, reason: draft.reason.trim() }
  const changes: { field: string; from: string; to: string }[] = []
  const name = draft.studentName.trim().replace(/\s+/g, ' ')
  if (name !== record.studentName) { update.studentName = name; changes.push({ field: 'Student name', from: record.studentName, to: name }) }
  const rank = draft.nucatRank.trim() ? Number(draft.nucatRank) : null
  if (rank !== record.nucatRank) { update.nucatRank = rank; changes.push({ field: 'NUCAT rank', from: formatNumber(record.nucatRank), to: rank === null ? 'Not published' : formatNumber(rank) }) }
  if ((draft.allocatedBranchId || null) !== (record.branch?.id ?? null)) {
    update.allocatedBranchId = draft.allocatedBranchId || null
    changes.push({ field: 'Branch', from: record.branch?.name ?? 'Not allocated', to: branches.find((branch) => branch.id === draft.allocatedBranchId)?.name ?? 'Not allocated' })
  }
  const status = draft.admissionStatus.trim() || null
  if (status !== record.admissionStatus) { update.admissionStatus = status; changes.push({ field: 'Status', from: record.admissionStatus ?? 'Not published', to: status ?? 'Not published' }) }
  const email = draft.officialEmail.trim().toLowerCase() || null
  if (email !== record.officialEmail) { update.officialEmail = email; changes.push({ field: 'Official email', from: record.officialEmail ?? 'None', to: email ?? 'None' }) }

  function review(event: FormEvent) {
    event.preventDefault()
    const problems: Record<string, string> = {}
    if (!name) problems.studentName = 'Enter the student name.'
    else if (name.length > 160) problems.studentName = 'Use at most 160 characters.'
    if (draft.nucatRank.trim() && !(Number.isInteger(rank) && rank! > 0)) problems.nucatRank = 'Enter a positive whole number, or leave it empty if not published.'
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) problems.officialEmail = 'Enter a valid email address.'
    if (draft.reason.trim().length < 5) problems.reason = 'Explain the correction (at least 5 characters).'
    if (!changes.length) problems.form = 'Nothing has changed yet.'
    setErrors(problems)
    if (!Object.keys(problems).length) setStep('confirm')
  }

  async function save() {
    setSaving(true)
    setFailure(null)
    try {
      onSaved(await admin.updateRecord(record.id, update))
    } catch (error) {
      if (error instanceof ServiceError && error.code === 'VALIDATION_FAILED' && error.details) {
        setErrors(Object.fromEntries(error.details.map((detail) => [detail.field === 'allocatedBranchId' ? 'allocatedBranchId' : detail.field, detail.messages[0] ?? 'Invalid value.'])))
        setStep('edit')
      } else {
        setFailure({ message: errorMessage(error, 'The record could not be saved.'), stale: error instanceof ServiceError && error.code === 'CONFLICT' })
      }
    } finally {
      setSaving(false)
    }
  }

  const field = (key: keyof Draft, label: string, input: ReactNode, hint?: string) => (
    <div className="adm-field">
      <label htmlFor={`edit-${key}`}>{label}</label>
      {input}
      {hint && <span className="adm-field__hint">{hint}</span>}
      {errors[key] && <span className="adm-field__error" id={`edit-${key}-error`}>{errors[key]}</span>}
    </div>
  )
  const bind = (key: keyof Draft) => ({
    id: `edit-${key}`, value: draft[key], 'aria-invalid': errors[key] ? true : undefined, 'aria-describedby': errors[key] ? `edit-${key}-error` : undefined,
    onChange: (event: { target: { value: string } }) => setDraft((current) => ({ ...current, [key]: event.target.value })),
  })

  if (step === 'confirm') {
    return (
      <Dialog title="Confirm changes" onClose={onClose} wide footer={
        <>
          <button type="button" className="adm-btn adm-btn--ghost" onClick={() => setStep('edit')} disabled={saving}>Back</button>
          {failure?.stale
            ? <button type="button" className="adm-btn" onClick={onStale}>Reload record</button>
            : <button type="button" className="adm-btn adm-btn--navy" onClick={save} disabled={saving} aria-busy={saving || undefined}>{saving ? 'Saving…' : 'Confirm and save'}</button>}
        </>
      }>
        <p>These official values for <strong>{record.nucatReference}</strong> ({record.admissionYear}) will change. The change and your reason are recorded in the audit history.</p>
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead><tr><th>Field</th><th>Current</th><th>New</th></tr></thead>
            <tbody>{changes.map((change) => <tr key={change.field}><td>{change.field}</td><td>{change.from}</td><td><strong>{change.to}</strong></td></tr>)}</tbody>
          </table>
        </div>
        <p><strong>Reason:</strong> {draft.reason.trim()}</p>
        {record.verifiedByStudent && update.officialEmail !== undefined && <Notice tone="warn">This student has already verified the record; changing the email does not unlink their account.</Notice>}
        {failure && <Notice tone="error">{failure.message}</Notice>}
      </Dialog>
    )
  }

  return (
    <Dialog title={`Edit ${record.nucatReference}`} onClose={onClose} wide footer={
      <>
        <button type="button" className="adm-btn adm-btn--ghost" onClick={onClose}>Cancel</button>
        <button type="submit" form="edit-record-form" className="adm-btn adm-btn--navy">Review changes</button>
      </>
    }>
      <p>NUCAT reference and admission year identify the record and can’t be edited.</p>
      <form id="edit-record-form" className="adm-form" onSubmit={review} noValidate>
        {errors.form && <Notice tone="warn">{errors.form}</Notice>}
        {field('studentName', 'Student name', <input {...bind('studentName')} maxLength={160} />)}
        <div className="adm-grid adm-grid--two">
          {field('nucatRank', 'NUCAT rank', <input {...bind('nucatRank')} inputMode="numeric" />, 'Leave empty if not published.')}
          {field('allocatedBranchId', 'Branch', (
            <select {...bind('allocatedBranchId')}>
              <option value="">Not allocated</option>
              {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          ))}
        </div>
        <div className="adm-grid adm-grid--two">
          {field('admissionStatus', 'Status', (
            <>
              <input {...bind('admissionStatus')} maxLength={80} list="edit-status-options" />
              <datalist id="edit-status-options">{(filters.state.status === 'ready' ? filters.state.data.statuses : []).map((value) => <option key={value} value={value} />)}</datalist>
            </>
          ))}
          {field('officialEmail', 'Official email', <input {...bind('officialEmail')} type="email" maxLength={254} />)}
        </div>
        {field('reason', 'Reason for the correction', <textarea {...bind('reason')} maxLength={300} placeholder="e.g. Rank corrected by the admission office" />, 'Required. Stored in the record’s change history.')}
      </form>
    </Dialog>
  )
}
