import { ArrowDown, ArrowUp, ArrowUpDown, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useServices } from '../../app/services'
import { AdmissionStatusBadge, Card, EmptyState, ErrorState, PageHeading, Pagination, SkeletonRows } from '../../components/admin/AdminUi'
import { formatNumber } from '../../components/admin/format'
import { useAsync } from '../../lib/useAsync'
import type { RecordSort, StudentRecordQuery } from '../../services/admin/adminTypes'

const sortable: RecordSort[] = ['nucatReference', 'studentName', 'admissionYear', 'nucatRank', 'admissionStatus', 'updatedAt']

/** Searchable, filterable, sortable and paginated list of this college's official admission records. */
export default function StudentRecordsPage() {
  const { admin } = useServices()
  const [params, setParams] = useSearchParams()
  const query: StudentRecordQuery = {
    search: params.get('search') ?? undefined,
    admissionYear: Number(params.get('year')) || undefined,
    branchId: params.get('branch') ?? undefined,
    status: params.get('status') ?? undefined,
    sort: sortable.includes(params.get('sort') as RecordSort) ? params.get('sort') as RecordSort : 'nucatReference',
    order: params.get('order') === 'desc' ? 'desc' : 'asc',
    page: Math.max(1, Number(params.get('page')) || 1),
    pageSize: [10, 20, 50, 100].includes(Number(params.get('size'))) ? Number(params.get('size')) : 20,
  }
  const key = params.toString()
  const records = useAsync(() => admin.records(query), [admin, key])
  const filters = useAsync(() => admin.recordFilters(), [admin])
  const [search, setSearch] = useState(query.search ?? '')
  // The top-bar search changes the URL directly; keep the box in step (adjusting state during render, not in an effect).
  const [urlSearch, setUrlSearch] = useState(query.search ?? '')
  if ((query.search ?? '') !== urlSearch) {
    setUrlSearch(query.search ?? '')
    setSearch(query.search ?? '')
  }

  const update = (changes: Record<string, string | number | undefined>, resetPage = true) => {
    const next = new URLSearchParams(params)
    for (const [name, value] of Object.entries(changes)) {
      if (value === undefined || value === '') next.delete(name)
      else next.set(name, String(value))
    }
    if (resetPage) next.delete('page')
    setParams(next, { replace: true })
  }

  // Search as you type, after a short pause.
  useEffect(() => {
    if ((query.search ?? '') === search.trim()) return
    const timer = setTimeout(() => update({ search: search.trim() || undefined }), 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the typed text triggers this
  }, [search])

  const toggleSort = (column: RecordSort) => update({ sort: column, order: query.sort === column && query.order === 'asc' ? 'desc' : 'asc' }, false)
  const header = (column: RecordSort, label: string, numeric = false) => {
    const active = query.sort === column
    const Icon = !active ? ArrowUpDown : query.order === 'asc' ? ArrowUp : ArrowDown
    return (
      <th className={numeric ? 'num' : undefined} aria-sort={active ? (query.order === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <button type="button" className="adm-sort" onClick={() => toggleSort(column)}>{label} <Icon size={13} aria-hidden="true" /></button>
      </th>
    )
  }
  const filterValues = filters.state.status === 'ready' ? filters.state.data : { admissionYears: [], branches: [], statuses: [] }
  const filtered = Boolean(query.search || query.admissionYear || query.branchId || query.status)

  return (
    <>
      <PageHeading title="Student Records" subtitle="Search, filter and manage admission records" />
      <Card bodyless>
        <form className="adm-filters" role="search" onSubmit={(event) => { event.preventDefault(); update({ search: search.trim() || undefined }) }}>
          <div className="adm-field">
            <label htmlFor="records-search">Search</label>
            <div className="adm-input-icon">
              <Search size={15} aria-hidden="true" />
              <input id="records-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by NUCAT reference or name..." maxLength={80} />
            </div>
          </div>
          <div className="adm-field">
            <label htmlFor="records-year">Admission Year</label>
            <select id="records-year" value={query.admissionYear ?? ''} onChange={(event) => update({ year: event.target.value || undefined })}>
              <option value="">All Years</option>
              {filterValues.admissionYears.map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
          </div>
          <div className="adm-field">
            <label htmlFor="records-branch">Branch</label>
            <select id="records-branch" value={query.branchId ?? ''} onChange={(event) => update({ branch: event.target.value || undefined })}>
              <option value="">All Branches</option>
              {filterValues.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          </div>
          <div className="adm-field">
            <label htmlFor="records-status">Status</label>
            <select id="records-status" value={query.status ?? ''} onChange={(event) => update({ status: event.target.value || undefined })}>
              <option value="">All Status</option>
              {filterValues.statuses.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </div>
          <button type="button" className="adm-btn adm-btn--ghost" onClick={() => { setSearch(''); setParams(new URLSearchParams(), { replace: true }) }} disabled={!filtered}>Reset</button>
        </form>

        {records.state.status === 'error' && !records.state.data ? <ErrorState message={records.state.message} onRetry={records.reload} />
          : !records.state.data ? <SkeletonRows rows={8} columns={6} label="Loading student records…" />
          : records.state.data.total === 0 ? (
            filtered
              ? <EmptyState title="No records match these filters"><button type="button" className="adm-link" onClick={() => { setSearch(''); setParams(new URLSearchParams(), { replace: true }) }}>Clear filters</button></EmptyState>
              : <EmptyState title="No admission records yet"><Link className="adm-link" to="/admin/imports/new">Import the official admission file</Link></EmptyState>
          ) : (
            <>
              <div className="adm-table-wrap" aria-busy={records.state.status === 'loading'}>
                <table className="adm-table">
                  <caption className="visually-hidden">Admission records, sorted by {query.sort} {query.order === 'asc' ? 'ascending' : 'descending'}</caption>
                  <thead>
                    <tr>
                      <th>#</th>
                      {header('nucatReference', 'NUCAT Reference')}
                      {header('studentName', 'Student Name')}
                      {header('admissionYear', 'Year')}
                      <th>Branch</th>
                      {header('nucatRank', 'Rank', true)}
                      {header('admissionStatus', 'Status')}
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.state.data.items.map((record, index) => (
                      <tr key={record.id}>
                        <td className="muted">{((query.page ?? 1) - 1) * (query.pageSize ?? 20) + index + 1}</td>
                        <td><Link className="ref adm-link" to={`/admin/students/${record.id}`}>{record.nucatReference}</Link></td>
                        <td>{record.studentName}</td>
                        <td>{record.admissionYear}</td>
                        <td>{record.branch?.name ?? <span className="muted">Not allocated</span>}</td>
                        <td className="num">{formatNumber(record.nucatRank)}</td>
                        <td><AdmissionStatusBadge status={record.admissionStatus} /></td>
                        <td><Link className="adm-link" to={`/admin/students/${record.id}`} aria-label={`View ${record.nucatReference}`}>View</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={records.state.data.page} pageSize={records.state.data.pageSize} total={records.state.data.total} noun="records"
                onPage={(page) => update({ page }, false)} onPageSize={(size) => update({ size })} />
            </>
          )}
        {records.state.status === 'error' && records.state.data && <div style={{ padding: '0 18px 18px' }}><ErrorState message={records.state.message} onRetry={records.reload} /></div>}
      </Card>
    </>
  )
}
