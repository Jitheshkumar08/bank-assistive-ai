import { FileUp } from 'lucide-react'
import { Link, useSearchParams } from 'react-router'
import { useServices } from '../../app/services'
import { Card, EmptyState, ErrorState, ImportStatusBadge, PageHeading, Pagination, SkeletonRows } from '../../components/admin/AdminUi'
import { formatDate, formatNumber } from '../../components/admin/format'
import { useAsync } from '../../lib/useAsync'

const importLabel = (id: string, year: number) => `IMP-${year}-${id.slice(0, 6).toUpperCase()}`

/** Every upload with who imported it, when, and its accurate inserted / updated / skipped / rejected counts. */
export default function ImportHistoryPage() {
  const { admin } = useServices()
  const [params, setParams] = useSearchParams()
  const page = Math.max(1, Number(params.get('page')) || 1)
  const year = Number(params.get('year')) || undefined
  const years = useAsync(() => admin.admissionYears(), [admin])
  const imports = useAsync(() => admin.imports({ page, pageSize: 20, admissionYear: year }), [admin, page, year])
  const setQuery = (next: Record<string, string | undefined>) => {
    const search = new URLSearchParams(params)
    for (const [key, value] of Object.entries(next)) if (value) search.set(key, value); else search.delete(key)
    setParams(search, { replace: true })
  }

  return (
    <>
      <PageHeading title="Import History" subtitle="View previous imports and their status"
        actions={<Link to="/admin/imports/new" className="adm-btn"><FileUp size={16} aria-hidden="true" /> New import</Link>} />
      <Card bodyless>
        <div className="adm-filters" style={{ gridTemplateColumns: 'minmax(160px, 220px)' }}>
          <div className="adm-field">
            <label htmlFor="history-year">Admission Year</label>
            <select id="history-year" value={year ?? ''} onChange={(event) => setQuery({ year: event.target.value || undefined, page: undefined })}>
              <option value="">All Years</option>
              {(years.state.status === 'ready' ? years.state.data.items : []).map((item) => <option key={item.admissionYear} value={item.admissionYear}>{item.admissionYear}</option>)}
            </select>
          </div>
        </div>
        {imports.state.status === 'error' && !imports.state.data ? <ErrorState message={imports.state.message} onRetry={imports.reload} />
          : !imports.state.data ? <SkeletonRows rows={6} columns={7} label="Loading import history…" />
          : !imports.state.data.items.length ? <EmptyState title="No imports yet"><Link className="adm-link" to="/admin/imports/new">Import the official admission file</Link></EmptyState>
          : (
            <>
              <div className="adm-table-wrap">
                <table className="adm-table">
                  <thead>
                    <tr>
                      <th>Import ID</th><th>Date &amp; Time</th><th>Year</th><th>File Name</th><th>Imported by</th><th>Status</th>
                      <th className="num">Rows</th><th className="num">Inserted</th><th className="num">Updated</th><th className="num">Skipped</th><th className="num">Rejected</th><th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {imports.state.data.items.map((batch) => (
                      <tr key={batch.id}>
                        <td className="ref">{importLabel(batch.id, batch.admissionYear)}</td>
                        <td>{formatDate(batch.createdAt, true)}</td>
                        <td>{batch.admissionYear}</td>
                        <td>{batch.fileName}</td>
                        <td>{batch.importedBy}</td>
                        <td><ImportStatusBadge status={batch.status} /></td>
                        <td className="num">{formatNumber(batch.counts.total)}</td>
                        <td className="num">{formatNumber(batch.counts.inserted)}</td>
                        <td className="num">{formatNumber(batch.counts.updated)}</td>
                        <td className="num">{formatNumber(batch.counts.skipped)}</td>
                        <td className="num">{formatNumber(batch.status === 'completed' || batch.status === 'partial' ? batch.counts.rejected : batch.counts.invalid + batch.counts.duplicates)}</td>
                        <td><Link className="adm-link" to={`/admin/imports/${batch.id}`} aria-label={`View import ${batch.fileName}`}>{batch.status === 'awaiting_confirmation' ? 'Review' : 'View'}</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={imports.state.data.page} pageSize={imports.state.data.pageSize} total={imports.state.data.total} noun="imports" onPage={(next) => setQuery({ page: String(next) })} />
            </>
          )}
      </Card>
    </>
  )
}
