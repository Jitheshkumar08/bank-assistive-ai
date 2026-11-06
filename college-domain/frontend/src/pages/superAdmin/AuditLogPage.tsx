import { useSearchParams } from 'react-router'
import { useServices } from '../../app/services'
import { Badge, Card, EmptyState, ErrorState, PageHeading, Pagination, SkeletonRows } from '../../components/admin/AdminUi'
import { formatDate } from '../../components/admin/format'
import { useAsync } from '../../lib/useAsync'
import type { AuditEntry } from '../../services/admin/adminTypes'

const actorTypes = [{ value: '', label: 'All actors' }, { value: 'SUPER_ADMIN', label: 'Super Admin' }, { value: 'ADMIN', label: 'College Admin' }, { value: 'STUDENT', label: 'Student' }, { value: 'SYSTEM', label: 'System' }]
const actorBadge: Record<string, 'blue' | 'green' | 'orange' | 'grey'> = { SUPER_ADMIN: 'blue', ADMIN: 'green', STUDENT: 'grey', SYSTEM: 'orange' }

/** Read-only audit log. Entries are written by the server and cannot be edited or deleted (enforced in the database). */
export default function AuditLogPage() {
  const { superAdmin } = useServices()
  const [params, setParams] = useSearchParams()
  const page = Math.max(1, Number(params.get('page')) || 1)
  const actorType = params.get('actor') ?? ''
  const events = useAsync(() => superAdmin.auditEvents({ page, pageSize: 25, actorType: actorType || undefined }), [superAdmin, page, actorType])
  const set = (key: string, value?: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value); else next.delete(key)
    if (key !== 'page') next.delete('page')
    setParams(next, { replace: true })
  }
  return (
    <>
      <PageHeading title="Audit Log" subtitle="Administrative and security events recorded by the server" />
      <Card bodyless>
        <div className="adm-filters" style={{ gridTemplateColumns: 'minmax(160px, 220px)' }}>
          <div className="adm-field">
            <label htmlFor="audit-actor">Actor</label>
            <select id="audit-actor" value={actorType} onChange={(event) => set('actor', event.target.value || undefined)}>
              {actorTypes.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
        </div>
        {events.state.status === 'error' && !events.state.data ? <ErrorState message={events.state.message} onRetry={events.reload} />
          : !events.state.data ? <SkeletonRows rows={8} columns={4} label="Loading audit log…" />
          : !events.state.data.items.length ? <EmptyState title="No events" />
          : (
            <>
              <div className="adm-table-wrap">
                <table className="adm-table">
                  <thead><tr><th>Date &amp; Time</th><th>Actor</th><th>Action</th><th>Target</th><th>Details</th></tr></thead>
                  <tbody>
                    {events.state.data.items.map((event) => (
                      <tr key={event.id}>
                        <td style={{ whiteSpace: 'nowrap' }}>{formatDate(event.createdAt, true)}</td>
                        <td><Badge tone={actorBadge[event.actorType] ?? 'grey'}>{actorTypes.find((type) => type.value === event.actorType)?.label ?? event.actorType}</Badge> {event.actorName}</td>
                        <td>{event.description}</td>
                        <td className="muted">{event.entityType}</td>
                        <td className="muted">{details(event)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={events.state.data.page} pageSize={events.state.data.pageSize} total={events.state.data.total} noun="events" onPage={(next) => set('page', String(next))} />
            </>
          )}
      </Card>
    </>
  )
}

/** A short, non-sensitive summary of the event metadata (reasons and counts only). */
function details(event: AuditEntry) {
  const meta = event.metadata ?? {}
  const parts: string[] = []
  if (typeof meta.reason === 'string') parts.push(`Reason: ${meta.reason}`)
  if (typeof meta.admissionYear === 'number') parts.push(`Year ${meta.admissionYear}`)
  for (const key of ['inserted', 'updated', 'skipped', 'rejected', 'rows'] as const) if (typeof meta[key] === 'number') parts.push(`${meta[key]} ${key}`)
  if (meta.changes && typeof meta.changes === 'object') parts.push(`Changed: ${Object.keys(meta.changes).join(', ')}`)
  return parts.join(' · ') || '—'
}
