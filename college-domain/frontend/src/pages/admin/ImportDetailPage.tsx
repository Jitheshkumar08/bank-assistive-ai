import { AlertTriangle, CheckCircle2, Copy, Download, FileText, XCircle } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { useServices } from '../../app/services'
import { Badge, Card, Dialog, EmptyState, ErrorState, Notice, PageHeading, Pagination, SkeletonRows, StatCard } from '../../components/admin/AdminUi'
import { formatDate, formatNumber } from '../../components/admin/format'
import ImportStepper from '../../components/admin/ImportStepper'
import { useAsync } from '../../lib/useAsync'
import type { DuplicatePolicy, ImportDetail, ImportRow, RowFilter } from '../../services/admin/adminTypes'
import { errorMessage, ServiceError } from '../../services/errors'

const filters: { value: RowFilter; label: string }[] = [
  { value: 'all', label: 'All rows' }, { value: 'issues', label: 'Needs attention' }, { value: 'invalid', label: 'Invalid' },
  { value: 'duplicate', label: 'Duplicates' }, { value: 'new', label: 'New' }, { value: 'changed', label: 'Changed' }, { value: 'unchanged', label: 'Unchanged' },
]

/** Steps 2–4 of an import (validation results → review & confirm → result), and the detail view in Import History. */
export default function ImportDetailPage() {
  const { id = '' } = useParams()
  const location = useLocation()
  const { admin } = useServices()
  const batch = useAsync(() => admin.importDetail(id), [admin, id])
  const [stage, setStage] = useState<'validate' | 'review'>('validate')
  const [rowsVersion, setRowsVersion] = useState(0)
  const justValidated = Boolean((location.state as { justValidated?: boolean } | null)?.justValidated)

  const crumbs = [{ label: 'Import History', to: '/admin/imports' }, { label: batch.state.data?.fileName ?? 'Import' }]
  if (batch.state.status === 'error' && !batch.state.data) {
    return <><PageHeading title="Import Results" crumbs={crumbs} /><Card>{batch.state.code === 'NOT_FOUND' ? <EmptyState title="Import not found" /> : <ErrorState message={batch.state.message} onRetry={batch.reload} />}</Card></>
  }
  if (!batch.state.data) return <><PageHeading title="Import Results" crumbs={crumbs} /><Card><SkeletonRows rows={5} label="Loading import…" /></Card></>

  const data = batch.state.data
  const awaiting = data.status === 'awaiting_confirmation'
  const step = awaiting ? (stage === 'validate' ? 2 : 3) : data.status === 'completed' || data.status === 'partial' ? 5 : 4
  const onCommitted = (updated: ImportDetail) => { batch.setData(updated); setRowsVersion((value) => value + 1) }

  return (
    <>
      <PageHeading
        title={awaiting ? 'Import Results' : 'Import Details'}
        subtitle={awaiting ? 'Review validation results before importing' : `${data.fileName} · admission year ${data.admissionYear}`}
        crumbs={crumbs}
        actions={<button type="button" className="adm-btn" onClick={() => admin.downloadReport(data.id).catch(() => undefined)}><Download size={15} aria-hidden="true" /> Download Report</button>}
      />
      <ImportStepper current={step} />
      {justValidated && awaiting && stage === 'validate' && <div style={{ marginBottom: 16 }}><Notice tone="info">The file was validated. Nothing has been imported yet — review the rows below, then continue.</Notice></div>}
      <Outcome data={data} />

      <div className="adm-grid adm-grid--stats">
        <StatCard icon={FileText} tone="blue" label="Total Rows" value={formatNumber(data.counts.total)} note={`Admission year ${data.admissionYear}`} />
        <StatCard icon={CheckCircle2} tone="green" label="Valid Rows" value={formatNumber(data.counts.valid)} note={`${formatNumber(data.counts.new)} new · ${formatNumber(data.counts.changed)} changed · ${formatNumber(data.counts.unchanged)} unchanged`} />
        <StatCard icon={Copy} tone="orange" label="Duplicates" value={formatNumber(data.counts.duplicates)} note="Same reference more than once in the file" />
        <StatCard icon={XCircle} tone="red" label="Invalid Rows" value={formatNumber(data.counts.invalid)} note="Missing or wrongly formatted values" />
      </div>

      {awaiting && data.columns.notices.length > 0 && <div className="adm-stack" style={{ gap: 8, marginBottom: 16 }}>{data.columns.notices.map((notice) => <Notice key={notice} tone="warn">{notice}</Notice>)}</div>}

      {awaiting && stage === 'review'
        ? <ReviewAndConfirm data={data} onBack={() => setStage('validate')} onCommitted={onCommitted} onFailed={batch.reload} />
        : (
          <div className="adm-stack">
            <ValidationResults id={data.id} version={rowsVersion} done={!awaiting} />
            <ColumnsCard data={data} />
            {awaiting && <ValidateActions data={data} onContinue={() => setStage('review')} onCancelled={(updated) => batch.setData(updated)} />}
          </div>
        )}
    </>
  )
}

function Outcome({ data }: { data: ImportDetail }) {
  const box = (node: ReactNode) => <div style={{ marginBottom: 16 }}>{node}</div>
  if (data.status === 'completed' || data.status === 'partial') {
    return box(
      <Notice tone={data.status === 'completed' ? 'success' : 'warn'} title={data.status === 'completed' ? 'Import completed.' : 'Import completed with rejected rows.'}>
        {formatNumber(data.counts.inserted)} inserted · {formatNumber(data.counts.updated)} updated · {formatNumber(data.counts.skipped)} skipped · {formatNumber(data.counts.rejected)} rejected
        {' '}— by {data.importedBy} on {formatDate(data.appliedAt, true)} ({data.duplicatePolicy === 'UPDATE_EXISTING' ? 'existing records updated' : 'existing records kept'}).
        {data.counts.rejected > 0 && ' Download the report to correct rejected rows and import them in a new file.'}
      </Notice>,
    )
  }
  if (data.status === 'failed') return box(<Notice tone="error" title="Import failed.">{data.failureReason ?? 'No records were changed.'} <Link className="adm-link" to={`/admin/imports/new?year=${data.admissionYear}`}>Upload the file again</Link></Notice>)
  if (data.status === 'cancelled') return box(<Notice tone="info">This import was cancelled. No records were changed.</Notice>)
  if (data.status === 'expired') return box(<Notice tone="warn">This preview expired before it was confirmed. No records were changed. <Link className="adm-link" to={`/admin/imports/new?year=${data.admissionYear}`}>Upload the file again</Link></Notice>)
  return null
}

const outcomeBadge = (row: ImportRow) => row.outcome === 'VALID' ? <Badge tone="green">Valid</Badge> : row.outcome === 'DUPLICATE_IN_FILE' ? <Badge tone="orange">Duplicate</Badge> : <Badge tone="red">Invalid</Badge>
const actionText: Record<string, string> = { INSERT: 'Insert', UPDATE: 'Update (if chosen)', UNCHANGED: 'No change' }
const resultBadge: Record<string, ReactNode> = {
  INSERTED: <Badge tone="green">Inserted</Badge>, UPDATED: <Badge tone="blue">Updated</Badge>, SKIPPED: <Badge tone="grey">Skipped</Badge>, REJECTED: <Badge tone="red">Rejected</Badge>,
}

function ValidationResults({ id, version, done }: { id: string; version: number; done: boolean }) {
  const { admin } = useServices()
  const [filter, setFilter] = useState<RowFilter>('all')
  const [page, setPage] = useState(1)
  const rows = useAsync(() => admin.importRows(id, { filter, page, pageSize: 25 }), [admin, id, filter, page, version])
  return (
    <Card title="Validation Results" bodyless actions={
      <div className="adm-segment" role="group" aria-label="Show rows">
        {filters.map((option) => <button key={option.value} type="button" aria-pressed={filter === option.value} onClick={() => { setFilter(option.value); setPage(1) }}>{option.label}</button>)}
      </div>
    }>
      {rows.state.status === 'error' && !rows.state.data ? <ErrorState message={rows.state.message} onRetry={rows.reload} />
        : !rows.state.data ? <SkeletonRows rows={6} columns={5} label="Loading rows…" />
        : !rows.state.data.items.length ? <EmptyState title="No rows in this view" />
        : (
          <>
            <div className="adm-table-wrap" aria-busy={rows.state.status === 'loading'}>
              <table className="adm-table">
                <thead><tr><th className="num">Row</th><th>Status</th><th>NUCAT Reference</th><th>Student Name</th><th>{done ? 'Result' : 'Planned action'}</th><th>Issue</th></tr></thead>
                <tbody>
                  {rows.state.data.items.map((row) => (
                    <tr key={row.rowNumber}>
                      <td className="num">{row.rowNumber}</td>
                      <td>{outcomeBadge(row)}</td>
                      <td>{row.nucatReference ?? <span className="muted">—</span>}</td>
                      <td>{row.studentName ?? <span className="muted">—</span>}</td>
                      <td>{done ? (row.result ? resultBadge[row.result] : '—') : row.action ? actionText[row.action] : <span className="muted">Rejected</span>}</td>
                      <td>
                        {row.messages.length ? (
                          <ul className="adm-messages">{row.messages.map((message) => <li key={message.text} className={message.level === 'error' ? 'is-error' : ''}>{message.text}</li>)}</ul>
                        ) : <span className="muted">—</span>}
                        {row.changes && <ul className="adm-messages">{Object.entries(row.changes).map(([field, change]) => <li key={field}>{field}: {String(change.from ?? 'empty')} → {String(change.to ?? 'empty')}</li>)}</ul>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={rows.state.data.page} pageSize={rows.state.data.pageSize} total={rows.state.data.total} noun="rows" onPage={setPage} />
          </>
        )}
    </Card>
  )
}

function ColumnsCard({ data }: { data: ImportDetail }) {
  return (
    <Card title="Detected columns">
      <div className="adm-chips">{data.columns.matched.map((column) => <span key={column.field} className="adm-chip">{column.header} → {column.label}</span>)}</div>
      {data.columns.ignored.length > 0 && <p className="adm-field__hint" style={{ marginTop: 10 }}>Ignored (not recognised): {data.columns.ignored.join(', ')}</p>}
    </Card>
  )
}

function ValidateActions({ data, onContinue, onCancelled }: { data: ImportDetail; onContinue: () => void; onCancelled: (batch: ImportDetail) => void }) {
  const { admin } = useServices()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const cancel = async () => {
    setBusy(true)
    try { onCancelled(await admin.cancelImport(data.id)); setConfirming(false) } catch (error) { setFailure(errorMessage(error)) } finally { setBusy(false) }
  }
  return (
    <Card>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingTop: 16 }}>
        <span className="adm-field__hint">Preview expires {formatDate(data.previewExpiresAt, true)}. Nothing is imported until you confirm.</span>
        <div className="adm-head__actions">
          <button type="button" className="adm-btn adm-btn--ghost" onClick={() => setConfirming(true)}>Cancel import</button>
          <button type="button" className="adm-btn adm-btn--navy" onClick={onContinue} disabled={data.counts.valid === 0}>Continue to review</button>
        </div>
      </div>
      {data.counts.valid === 0 && <div style={{ marginTop: 12 }}><Notice tone="warn">This file has no valid rows. Correct it using the report and upload it again.</Notice></div>}
      {failure && <div style={{ marginTop: 12 }}><Notice tone="error">{failure}</Notice></div>}
      {confirming && (
        <Dialog title="Cancel this import?" onClose={() => setConfirming(false)} footer={
          <>
            <button type="button" className="adm-btn adm-btn--ghost" onClick={() => setConfirming(false)} disabled={busy}>Keep it</button>
            <button type="button" className="adm-btn adm-btn--danger" onClick={cancel} disabled={busy}>{busy ? 'Cancelling…' : 'Cancel import'}</button>
          </>
        }>
          <p>The validated file <strong>{data.fileName}</strong> will be discarded. No admission records are changed.</p>
        </Dialog>
      )}
    </Card>
  )
}

/** Step 3: explicit summary of the database changes and the duplicate policy, then a single confirmed commit. */
function ReviewAndConfirm({ data, onBack, onCommitted, onFailed }: { data: ImportDetail; onBack: () => void; onCommitted: (batch: ImportDetail) => void; onFailed: () => void }) {
  const { admin } = useServices()
  const [policy, setPolicy] = useState<DuplicatePolicy>('SKIP_EXISTING')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const updates = policy === 'UPDATE_EXISTING' ? data.counts.changed : 0
  const skipped = data.counts.unchanged + (policy === 'SKIP_EXISTING' ? data.counts.changed : 0)
  const rejected = data.counts.invalid + data.counts.duplicates

  async function commit() {
    if (busy) return
    setBusy(true)
    setFailure(null)
    try {
      onCommitted(await admin.commitImport(data.id, policy))
    } catch (error) {
      setFailure(errorMessage(error, 'The import could not be completed. No records were changed.'))
      if (error instanceof ServiceError && ['IMPORT_STALE', 'IMPORT_ALREADY_PROCESSED', 'IMPORT_PREVIEW_EXPIRED'].includes(error.code)) onFailed()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Review and confirm">
      <div className="adm-stack">
        <p style={{ margin: 0 }}>Importing <strong>{data.fileName}</strong> into admission year <strong>{data.admissionYear}</strong>. Records of other years are not affected.</p>
        {data.counts.changed > 0 && (
          <fieldset className="adm-radio-group" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="adm-label" style={{ marginBottom: 8, fontWeight: 650 }}>{formatNumber(data.counts.changed)} row{data.counts.changed === 1 ? '' : 's'} already exist for {data.admissionYear} with different values</legend>
            <label className="adm-radio">
              <input type="radio" name="policy" value="SKIP_EXISTING" checked={policy === 'SKIP_EXISTING'} onChange={() => setPolicy('SKIP_EXISTING')} />
              <span><strong>Keep existing records</strong><span>Skip these rows; only new references are added.</span></span>
            </label>
            <label className="adm-radio">
              <input type="radio" name="policy" value="UPDATE_EXISTING" checked={policy === 'UPDATE_EXISTING'} onChange={() => setPolicy('UPDATE_EXISTING')} />
              <span><strong>Update existing records</strong><span>Replace the changed values with the file’s values. Every change is recorded in the record’s history. Blank cells never clear stored values.</span></span>
            </label>
          </fieldset>
        )}
        <dl className="adm-summary" aria-label="Proposed changes">
          <div><dt>Records to insert</dt><dd>{formatNumber(data.counts.new)}</dd></div>
          <div><dt>Records to update</dt><dd>{formatNumber(updates)}</dd></div>
          <div><dt>Rows skipped</dt><dd>{formatNumber(skipped)}</dd></div>
          <div><dt>Rows rejected</dt><dd>{formatNumber(rejected)}</dd></div>
        </dl>
        {rejected > 0 && <Notice tone="warn">{formatNumber(rejected)} invalid or duplicate row{rejected === 1 ? '' : 's'} will not be imported. You can download the report to fix them.</Notice>}
        {failure && <Notice tone="error" title="Import not completed.">{failure}</Notice>}
        <div className="adm-head__actions" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="adm-btn adm-btn--ghost" onClick={onBack} disabled={busy}>Back to results</button>
          <button type="button" className="adm-btn adm-btn--navy" onClick={commit} disabled={busy} aria-busy={busy || undefined}>
            {busy ? 'Importing…' : <><AlertTriangle size={15} aria-hidden="true" /> Confirm import</>}
          </button>
        </div>
        <span className="adm-field__hint">The import runs as a single transaction: either every change above is saved, or none is.</span>
      </div>
    </Card>
  )
}
