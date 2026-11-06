import { KeyRound, LogOut } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { roleLabel } from '../../app/roles'
import { useSession } from '../../app/session'
import { Card, Notice, PageHeading } from '../../components/admin/AdminUi'

/** Settings & Profile for staff: the account as the server knows it, password change and sign-out. */
export default function StaffProfilePage() {
  const { session, logout } = useSession()
  const navigate = useNavigate()
  if (session.status !== 'signed-in') return null
  const user = session.user
  return (
    <>
      <PageHeading title="Settings & Profile" subtitle="Your staff account" />
      <div className="adm-grid adm-grid--two">
        <Card title="Account">
          <dl className="adm-dl">
            <div><dt>Name</dt><dd>{user.displayName ?? '—'}</dd></div>
            <div><dt>Email</dt><dd>{user.email}</dd></div>
            <div><dt>Role</dt><dd>{roleLabel[user.role]}</dd></div>
          </dl>
          <p className="adm-field__hint" style={{ marginTop: 12 }}>Your role is assigned by the CampusGuide Super Admin and can’t be changed here.</p>
        </Card>
        <Card title="Security">
          <div className="adm-stack" style={{ gap: 12 }}>
            <Notice tone="info">Your session is kept in a secure, HttpOnly cookie. Signing out ends it on the server.</Notice>
            <div className="adm-head__actions">
              <Link to="/forgot-password" className="adm-btn adm-btn--ghost"><KeyRound size={15} aria-hidden="true" /> Change password by email</Link>
              <button type="button" className="adm-btn adm-btn--navy" onClick={async () => { await logout(); navigate('/login', { replace: true }) }}><LogOut size={15} aria-hidden="true" /> Logout</button>
            </div>
            <p className="adm-field__hint">Changing your password signs you out on every device.</p>
          </div>
        </Card>
      </div>
    </>
  )
}
