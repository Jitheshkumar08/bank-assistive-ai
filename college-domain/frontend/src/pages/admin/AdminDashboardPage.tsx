import { AlertTriangle, CalendarDays, FileUp, UsersRound } from 'lucide-react'
import { Link } from 'react-router'
import { useServices } from '../../app/services'
import { Card, EmptyState, ErrorState, ImportStatusBadge, PageHeading, SkeletonRows, StatCard } from '../../components/admin/AdminUi'
import BarChart from '../../components/admin/BarChart'
import { formatDate, formatNumber } from '../../components/admin/format'
import { useAsync } from '../../lib/useAsync'

/** College Admin dashboard: every number comes from the backend's records and imports for this college. */
export default function AdminDashboardPage() {
  const { admin } = useServices()
  const { state, reload } = useAsync(() => admin.dashboard(), [admin])
  const actions = (
    <>
      <Link to="/admin/students" className="adm-btn adm-btn--ghost">View student records</Link>
      <Link to="/admin/imports/new" className="adm-btn"><FileUp size={16} aria-hidden="true" /> Import admissions</Link>
    </>
  )

  if (state.status === 'error' && !state.data) {
    return <><PageHeading title="Dashboard" subtitle="Overview of admission data and recent activity" /><Card><ErrorState message={state.message} onRetry={reload} /></Card></>
  }
  if (!state.data) {
    return <><PageHeading title="Dashboard" subtitle="Overview of admission data and recent activity" actions={actions} /><Card><SkeletonRows rows={6} label="Loading dashboard…" /></Card></>
  }

  const data = state.data
  const latest = data.imports.latest
  const issues = data.dataQuality.rejectedRowsInLatestImport
  return (
    <>
      <PageHeading title="Dashboard" subtitle={`Overview of admission data and recent activity${data.college ? ` · ${data.college.name}` : ''}`} actions={actions} />

      <div className="adm-grid adm-grid--stats">
        <StatCard icon={UsersRound} tone="blue" label="Total Admission Records" value={formatNumber(data.totals.records)}
          note={`${formatNumber(data.totals.verifiedByStudents)} verified by students`} />
        <StatCard icon={CalendarDays} tone="purple" label="Admission Years" value={formatNumber(data.totals.admissionYears)}
          note={data.byYear.length ? data.byYear.map((year) => year.admissionYear).join(', ') : 'No records yet'} />
        <StatCard icon={FileUp} tone="blue" label="Latest Import" small value={latest ? formatDate(latest.createdAt) : 'None yet'}
          note={latest ? `${formatNumber(latest.rows)} rows · ${latest.admissionYear}` : 'Import the official spreadsheet to begin'} />
        <StatCard icon={AlertTriangle} tone="red" label="Rows Rejected" value={formatNumber(issues)}
          note={latest ? 'in the latest import' : 'No imports yet'} />
      </div>

      <div className="adm-grid adm-grid--split" style={{ marginBottom: 16 }}>
        <Card title="Records by Admission Year">
          {data.byYear.length
            ? <BarChart label="Admission records per year" data={data.byYear.map((year) => ({ label: String(year.admissionYear), value: year.records }))} />
            : <EmptyState title="No admission records yet"><Link to="/admin/imports/new" className="adm-link">Import the official admission file</Link></EmptyState>}
        </Card>
        <Card title="Recent Imports" bodyless actions={<Link to="/admin/imports" className="adm-btn adm-btn--ghost adm-btn--sm">View all</Link>}>
          {data.imports.recent.length ? (
            <div className="adm-table-wrap">
              <table className="adm-table">
                <thead><tr><th>Date</th><th>Year</th><th>File Name</th><th>Status</th><th className="num">Records</th></tr></thead>
                <tbody>
                  {data.imports.recent.map((batch) => (
                    <tr key={batch.id}>
                      <td>{formatDate(batch.createdAt)}</td>
                      <td>{batch.admissionYear}</td>
                      <td><Link className="adm-link" to={`/admin/imports/${batch.id}`}>{batch.fileName}</Link></td>
                      <td><ImportStatusBadge status={batch.status} /></td>
                      <td className="num">{formatNumber(batch.rows)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyState title="No imports yet">Uploaded files appear here after validation.</EmptyState>}
        </Card>
      </div>

      <div className="adm-grid adm-grid--two">
        <Card title="Imports and Data Quality">
          <dl className="adm-summary">
            <div><dt>Completed imports</dt><dd>{formatNumber(data.imports.completed)}</dd></div>
            <div><dt>Partial imports</dt><dd>{formatNumber(data.imports.partial)}</dd></div>
            <div><dt>Failed imports</dt><dd>{formatNumber(data.imports.failed)}</dd></div>
            <div><dt>Awaiting confirmation</dt><dd>{formatNumber(data.imports.awaitingConfirmation)}</dd></div>
            <div><dt>Records without email</dt><dd>{formatNumber(data.dataQuality.missingEmail)}</dd></div>
            <div><dt>Records without rank</dt><dd>{formatNumber(data.dataQuality.missingRank)}</dd></div>
            <div><dt>Records without branch</dt><dd>{formatNumber(data.dataQuality.missingBranch)}</dd></div>
          </dl>
          {data.dataQuality.missingEmail > 0 && (
            <p className="adm-field__hint" style={{ marginTop: 10 }}>Students can verify their result online only when their record has an email address.</p>
          )}
        </Card>
        <Card title="Recent Activity">
          {data.recentActivity.length ? (
            <ul className="adm-timeline">
              {data.recentActivity.map((event) => (
                <li key={event.id}>
                  <span>{event.description}</span>
                  <span className="adm-timeline__meta">{event.actorName} · {formatDate(event.createdAt, true)}</span>
                </li>
              ))}
            </ul>
          ) : <EmptyState title="No activity yet" />}
        </Card>
      </div>
    </>
  )
}
