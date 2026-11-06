import { Link } from 'react-router'
import { useServices } from '../../app/services'
import { Card, EmptyState, ErrorState, ImportStatusBadge, Notice, PageHeading, SkeletonRows } from '../../components/admin/AdminUi'
import { formatDate, formatNumber } from '../../components/admin/format'
import { useAsync } from '../../lib/useAsync'

/**
 * Per-year overview of the single shared admissions table: how many records each year holds, how many students have
 * verified theirs, and the latest import — with shortcuts to that year's records and a new import for it.
 */
export default function AdmissionYearsPage() {
  const { admin } = useServices()
  const years = useAsync(() => admin.admissionYears(), [admin])
  return (
    <>
      <PageHeading title="Admission Years" subtitle="Records and imports for each admission year" />
      <div style={{ marginBottom: 16 }}>
        <Notice tone="info">All years are stored together in one admissions table. Importing a year only adds or updates that year’s records — earlier years are never deleted.</Notice>
      </div>
      <Card bodyless>
        {years.state.status === 'error' && !years.state.data ? <ErrorState message={years.state.message} onRetry={years.reload} />
          : !years.state.data ? <SkeletonRows rows={4} columns={6} label="Loading admission years…" />
          : !years.state.data.items.length ? <EmptyState title="No admission years yet"><Link className="adm-link" to="/admin/imports/new">Import the first admission file</Link></EmptyState>
          : (
            <div className="adm-table-wrap">
              <table className="adm-table">
                <thead><tr><th>Admission Year</th><th className="num">Records</th><th className="num">Verified by students</th><th className="num">Imports</th><th>Latest import</th><th>Actions</th></tr></thead>
                <tbody>
                  {years.state.data.items.map((year) => (
                    <tr key={year.admissionYear}>
                      <td><strong>{year.admissionYear}</strong></td>
                      <td className="num">{formatNumber(year.records)}</td>
                      <td className="num">{formatNumber(year.verifiedByStudents)}</td>
                      <td className="num">{formatNumber(year.imports)}</td>
                      <td>{year.latestImport ? <><Link className="adm-link" to={`/admin/imports/${year.latestImport.id}`}>{formatDate(year.latestImport.createdAt)}</Link> <ImportStatusBadge status={year.latestImport.status} /></> : <span className="muted">—</span>}</td>
                      <td style={{ display: 'flex', gap: 14 }}>
                        <Link className="adm-link" to={`/admin/students?year=${year.admissionYear}`}>View records</Link>
                        <Link className="adm-link" to={`/admin/imports/new?year=${year.admissionYear}`}>Import</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </Card>
    </>
  )
}
