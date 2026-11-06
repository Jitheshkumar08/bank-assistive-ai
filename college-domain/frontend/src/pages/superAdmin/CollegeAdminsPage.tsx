import { UserPlus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router'
import { useServices } from '../../app/services'
import { Badge, Card, Dialog, EmptyState, ErrorState, Notice, PageHeading, SkeletonRows } from '../../components/admin/AdminUi'
import { formatDate } from '../../components/admin/format'
import { useAsync } from '../../lib/useAsync'
import type { CollegeAdminAccount, StaffInvitation } from '../../services/admin/adminTypes'
import { errorMessage, ServiceError } from '../../services/errors'

type Pending =
  | { kind: 'suspend' | 'restore'; account: CollegeAdminAccount }
  | { kind: 'resend' | 'revoke'; invitation: StaffInvitation }

const invitationBadge = { pending: <Badge tone="blue">Pending</Badge>, expired: <Badge tone="orange">Expired</Badge>, revoked: <Badge tone="grey">Revoked</Badge>, accepted: <Badge tone="green">Accepted</Badge> }

/** College Admin accounts and invitations. Only a Super Admin reaches this page — and the API enforces it. */
export default function CollegeAdminsPage() {
  const { superAdmin } = useServices()
  const [params, setParams] = useSearchParams()
  const list = useAsync(() => superAdmin.collegeAdmins(), [superAdmin])
  const overview = useAsync(() => superAdmin.overview(), [superAdmin])
  const [pending, setPending] = useState<Pending | null>(null)
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const inviting = params.get('invite') === '1'
  const setInviting = (open: boolean) => { const next = new URLSearchParams(params); if (open) next.set('invite', '1'); else next.delete('invite'); setParams(next, { replace: true }) }

  return (
    <>
      <PageHeading title="College Admins" subtitle="Create, activate and manage College Admin access"
        actions={<button type="button" className="adm-btn" onClick={() => setInviting(true)}><UserPlus size={16} aria-hidden="true" /> Invite College Admin</button>} />
      {message && <div style={{ marginBottom: 16 }}><Notice tone={message.tone}>{message.text}</Notice></div>}
      {list.state.status === 'error' && !list.state.data ? <Card><ErrorState message={list.state.message} onRetry={list.reload} /></Card>
        : !list.state.data ? <Card><SkeletonRows rows={5} columns={5} label="Loading College Admins…" /></Card>
        : (
          <div className="adm-stack">
            <Card title="Accounts" bodyless>
              {list.state.data.accounts.length ? (
                <div className="adm-table-wrap">
                  <table className="adm-table">
                    <thead><tr><th>Name</th><th>Email</th><th>College</th><th>Status</th><th>Last active</th><th>Created</th><th>Actions</th></tr></thead>
                    <tbody>
                      {list.state.data.accounts.map((account) => (
                        <tr key={account.id}>
                          <td><strong>{account.displayName ?? '—'}</strong></td>
                          <td>{account.email}</td>
                          <td>{account.college?.shortName ?? '—'}</td>
                          <td>{account.status === 'active' ? <Badge tone="green">Active</Badge> : <Badge tone="red">Suspended</Badge>}</td>
                          <td>{formatDate(account.lastActiveAt, true)}</td>
                          <td>{formatDate(account.createdAt)}</td>
                          <td>
                            {account.status === 'active'
                              ? <button type="button" className="adm-link" style={{ color: '#c62828' }} onClick={() => setPending({ kind: 'suspend', account })}>Suspend access</button>
                              : <button type="button" className="adm-link" onClick={() => setPending({ kind: 'restore', account })}>Restore access</button>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <EmptyState title="No College Admin accounts yet">Invite a staff member; their account is created when they activate the emailed link.</EmptyState>}
            </Card>
            <Card title="Invitations" bodyless>
              {list.state.data.invitations.length ? (
                <div className="adm-table-wrap">
                  <table className="adm-table">
                    <thead><tr><th>Name</th><th>Email</th><th>College</th><th>Status</th><th>Invited by</th><th>Sent</th><th>Expires</th><th>Actions</th></tr></thead>
                    <tbody>
                      {list.state.data.invitations.map((invitation) => (
                        <tr key={invitation.id}>
                          <td>{invitation.displayName}</td>
                          <td>{invitation.email}</td>
                          <td>{invitation.college?.shortName ?? '—'}</td>
                          <td>{invitationBadge[invitation.state]}</td>
                          <td>{invitation.invitedBy}</td>
                          <td>{formatDate(invitation.createdAt)}</td>
                          <td>{formatDate(invitation.expiresAt, true)}</td>
                          <td style={{ display: 'flex', gap: 12 }}>
                            {(invitation.state === 'pending' || invitation.state === 'expired') && <>
                              <button type="button" className="adm-link" onClick={() => setPending({ kind: 'resend', invitation })}>Resend</button>
                              <button type="button" className="adm-link" style={{ color: '#c62828' }} onClick={() => setPending({ kind: 'revoke', invitation })}>Revoke</button>
                            </>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <EmptyState title="No open invitations" />}
            </Card>
          </div>
        )}

      {inviting && (
        <InviteDialog colleges={overview.state.status === 'ready' ? overview.state.data.institutions : []} collegesError={overview.state.status === 'error' ? overview.state.message : null}
          onClose={() => setInviting(false)}
          onInvited={(email) => { setInviting(false); setMessage({ tone: 'success', text: `Invitation sent to ${email}. The account is created when they open the link and set a password.` }); list.reload() }} />
      )}
      {pending && <ConfirmAction pending={pending} onClose={() => setPending(null)} onDone={(text) => { setPending(null); setMessage({ tone: 'success', text }); list.reload() }} />}
    </>
  )
}

function InviteDialog({ colleges, collegesError, onClose, onInvited }: { colleges: { id: string; name: string }[]; collegesError: string | null; onClose: () => void; onInvited: (email: string) => void }) {
  const { superAdmin } = useServices()
  const [form, setForm] = useState({ displayName: '', email: '', institutionId: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const institutionId = form.institutionId || (colleges.length === 1 ? colleges[0].id : '')

  async function submit(event: FormEvent) {
    event.preventDefault()
    const problems: Record<string, string> = {}
    if (form.displayName.trim().length < 2) problems.displayName = 'Enter the staff member’s full name.'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) problems.email = 'Enter a valid email address.'
    if (!institutionId) problems.institutionId = 'Choose the college they will manage.'
    setErrors(problems)
    if (Object.keys(problems).length || busy) return
    setBusy(true)
    setFailure(null)
    try {
      const invitation = await superAdmin.invite({ displayName: form.displayName.trim(), email: form.email.trim(), institutionId })
      onInvited(invitation.email)
    } catch (error) {
      if (error instanceof ServiceError && error.code === 'VALIDATION_FAILED' && error.details) setErrors(Object.fromEntries(error.details.map((detail) => [detail.field, detail.messages[0] ?? 'Invalid value.'])))
      else setFailure(errorMessage(error, 'The invitation could not be sent.'))
    } finally {
      setBusy(false)
    }
  }

  const describedBy = (key: string) => (errors[key] ? `invite-${key}-error` : undefined)
  return (
    <Dialog title="Invite a College Admin" onClose={onClose} footer={
      <>
        <button type="button" className="adm-btn adm-btn--ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="submit" form="invite-form" className="adm-btn adm-btn--navy" disabled={busy} aria-busy={busy || undefined}>{busy ? 'Sending…' : 'Send invitation'}</button>
      </>
    }>
      <p>The staff member receives a single-use link (valid for 72 hours) to set their own password. You never see or set their password.</p>
      <form id="invite-form" className="adm-form" onSubmit={submit} noValidate>
        <div className="adm-field">
          <label htmlFor="invite-displayName">Full name</label>
          <input id="invite-displayName" value={form.displayName} maxLength={120} autoComplete="off" aria-invalid={errors.displayName ? true : undefined} aria-describedby={describedBy('displayName')}
            onChange={(event) => setForm({ ...form, displayName: event.target.value })} />
          {errors.displayName && <span className="adm-field__error" id="invite-displayName-error">{errors.displayName}</span>}
        </div>
        <div className="adm-field">
          <label htmlFor="invite-email">Email address</label>
          <input id="invite-email" type="email" value={form.email} maxLength={254} autoComplete="off" aria-invalid={errors.email ? true : undefined} aria-describedby={describedBy('email')}
            onChange={(event) => setForm({ ...form, email: event.target.value })} />
          {errors.email && <span className="adm-field__error" id="invite-email-error">{errors.email}</span>}
        </div>
        <div className="adm-field">
          <label htmlFor="invite-institutionId">College</label>
          <select id="invite-institutionId" value={institutionId} aria-invalid={errors.institutionId ? true : undefined} aria-describedby={describedBy('institutionId')}
            onChange={(event) => setForm({ ...form, institutionId: event.target.value })}>
            <option value="">Choose a college</option>
            {colleges.map((college) => <option key={college.id} value={college.id}>{college.name}</option>)}
          </select>
          {errors.institutionId && <span className="adm-field__error" id="invite-institutionId-error">{errors.institutionId}</span>}
          {collegesError && <span className="adm-field__error">{collegesError}</span>}
        </div>
        {failure && <Notice tone="error">{failure}</Notice>}
      </form>
    </Dialog>
  )
}

function ConfirmAction({ pending, onClose, onDone }: { pending: Pending; onClose: () => void; onDone: (message: string) => void }) {
  const { superAdmin } = useServices()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const copy = {
    suspend: { title: 'Suspend access?', button: 'Suspend access', danger: true, body: 'They are signed out immediately and cannot sign in until access is restored. Their past actions stay in the audit log.' },
    restore: { title: 'Restore access?', button: 'Restore access', danger: false, body: 'They will be able to sign in to the College Admin portal again.' },
    resend: { title: 'Resend invitation?', button: 'Resend', danger: false, body: 'A new activation link is emailed and the previous link stops working.' },
    revoke: { title: 'Revoke invitation?', button: 'Revoke invitation', danger: true, body: 'The activation link stops working. You can invite them again later.' },
  }[pending.kind]
  const who = 'account' in pending ? (pending.account.displayName ?? pending.account.email) : pending.invitation.displayName

  async function run() {
    setBusy(true)
    setFailure(null)
    try {
      if (pending.kind === 'suspend') { await superAdmin.suspend(pending.account.id, reason.trim() || undefined); onDone(`${who}’s access was suspended.`) }
      if (pending.kind === 'restore') { await superAdmin.restore(pending.account.id, reason.trim() || undefined); onDone(`${who}’s access was restored.`) }
      if (pending.kind === 'resend') { await superAdmin.resendInvitation(pending.invitation.id); onDone(`A new invitation link was sent to ${pending.invitation.email}.`) }
      if (pending.kind === 'revoke') { await superAdmin.revokeInvitation(pending.invitation.id); onDone(`The invitation for ${pending.invitation.email} was revoked.`) }
    } catch (error) {
      setFailure(errorMessage(error, 'This action could not be completed.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title={copy.title} onClose={onClose} footer={
      <>
        <button type="button" className="adm-btn adm-btn--ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className={`adm-btn${copy.danger ? ' adm-btn--danger' : ' adm-btn--navy'}`} onClick={run} disabled={busy}>{busy ? 'Working…' : copy.button}</button>
      </>
    }>
      <p><strong>{who}</strong> — {copy.body}</p>
      {(pending.kind === 'suspend' || pending.kind === 'restore') && (
        <div className="adm-field">
          <label htmlFor="access-reason">Reason (optional, recorded in the audit log)</label>
          <textarea id="access-reason" value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} />
        </div>
      )}
      {failure && <Notice tone="error">{failure}</Notice>}
    </Dialog>
  )
}
