import { Building2, MailWarning, ScrollText, UserCheck, UserPlus, UserX } from 'lucide-react'
import { Link } from 'react-router'
import { useServices } from '../../app/services'
import { Card, EmptyState, ErrorState, PageHeading, SkeletonRows, StatCard } from '../../components/admin/AdminUi'
import { formatDate, formatNumber } from '../../components/admin/format'
import { useAsync } from '../../lib/useAsync'

/** Super Admin overview: staff access at a glance and the latest administrative actions. */
export default function SuperAdminDashboardPage() {
  const { superAdmin } = useServices()
  const { state, reload } = useAsync(() => superAdmin.overview(), [superAdmin])
  const actions = (
    <>
      <Link to="/super-admin/audit-log" className="adm-btn adm-btn--ghost"><ScrollText size={16} aria-hidden="true" /> Audit log</Link>
      <Link to="/super-admin/college-admins?invite=1" className="adm-btn"><UserPlus size={16} aria-hidden="true" /> Invite College Admin</Link>
    </>
  )
  if (state.status === 'error' && !state.data) return <><PageHeading title="Dashboard" subtitle="Staff access and administrative activity" /><Card><ErrorState message={state.message} onRetry={reload} /></Card></>
  if (!state.data) return <><PageHeading title="Dashboard" subtitle="Staff access and administrative activity" actions={actions} /><Card><SkeletonRows rows={5} label="Loading overview…" /></Card></>
  const data = state.data
  return (
    <>
      <PageHeading title="Dashboard" subtitle="Staff access and administrative activity" actions={actions} />
      <div className="adm-grid adm-grid--stats">
        <StatCard icon={UserCheck} tone="blue" label="College Admins" value={formatNumber(data.collegeAdmins.total)} note={`${formatNumber(data.collegeAdmins.active)} active · ${formatNumber(data.collegeAdmins.suspended)} suspended`} />
        <StatCard icon={UserPlus} tone="purple" label="Pending Invitations" value={formatNumber(data.invitations.pending)} note="Waiting for activation" />
        <StatCard icon={MailWarning} tone="orange" label="Expired Invitations" value={formatNumber(data.invitations.expired)} note="Can be resent" />
        <StatCard icon={Building2} tone="green" label="Colleges" value={formatNumber(data.institutions.length)} note={data.institutions.map((college) => college.shortName).join(', ') || 'None active'} />
      </div>
      <Card title="Recent Administrative Activity" bodyless actions={<Link to="/super-admin/audit-log" className="adm-btn adm-btn--ghost adm-btn--sm">View all</Link>}>
        {data.recentActivity.length ? (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead><tr><th>Date &amp; Time</th><th>Who</th><th>Action</th></tr></thead>
              <tbody>
                {data.recentActivity.map((event) => (
                  <tr key={event.id}><td>{formatDate(event.createdAt, true)}</td><td>{event.actorName}</td><td>{event.description}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState icon={UserX} title="No administrative activity yet">Invite the first College Admin to get started.</EmptyState>}
      </Card>
    </>
  )
}
