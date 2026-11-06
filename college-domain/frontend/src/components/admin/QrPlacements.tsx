import { Download, QrCode } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type { QrCodeReader, QrImageFormat, QrPlacement } from '../../services/admin/adminTypes'
import { errorMessage } from '../../services/errors'
import { Badge, Notice } from './AdminUi'
import { formatDate } from './format'

/** Loads the server-rendered PNG with the session cookie and shows it (the same bytes a download returns). */
function QrPreview({ reader, placement }: { reader: QrCodeReader; placement: QrPlacement }) {
  const [state, setState] = useState<{ url: string } | { error: string } | null>(null)
  useEffect(() => {
    let url: string | null = null
    let active = true
    reader.image(placement.id, 'png')
      .then((blob) => { url = URL.createObjectURL(blob); if (active) setState({ url }); else URL.revokeObjectURL(url) })
      .catch((error: unknown) => { if (active) setState({ error: errorMessage(error, 'The QR preview could not be loaded.') }) })
    return () => { active = false; if (url) URL.revokeObjectURL(url) }
  }, [reader, placement.id])
  return (
    <div className={`adm-qr__preview${placement.isActive ? '' : ' is-inactive'}`}>
      {state && 'url' in state ? <img src={state.url} alt={`QR code for ${placement.label}`} width={168} height={168} />
        : state && 'error' in state ? <span className="adm-qr__preview-error" role="alert">{state.error}</span>
        : <span className="adm-qr__preview-loading" role="status" aria-label="Loading QR preview"><QrCode size={40} aria-hidden="true" /></span>}
    </div>
  )
}

/**
 * One placement: preview, details and PNG / SVG downloads. `actions` holds role-specific controls (Super Admin only);
 * the College Admin page passes none, and the backend refuses changes from College Admins anyway.
 */
export function QrPlacementCard({ placement, reader, actions, onError }: { placement: QrPlacement; reader: QrCodeReader; actions?: ReactNode; onError: (message: string) => void }) {
  const [busy, setBusy] = useState<QrImageFormat | null>(null)
  async function download(format: QrImageFormat) {
    setBusy(format)
    try { await reader.download(placement, format) } catch (error) { onError(errorMessage(error, `The ${format.toUpperCase()} file could not be downloaded.`)) } finally { setBusy(null) }
  }
  return (
    <article className="adm-qr" aria-labelledby={`qr-${placement.id}-title`}>
      <QrPreview reader={reader} placement={placement} />
      <div className="adm-qr__body">
        <div className="adm-qr__head">
          <h3 id={`qr-${placement.id}-title`}>{placement.label}</h3>
          {placement.isActive ? <Badge tone="green">Active</Badge> : <Badge tone="grey">Inactive</Badge>}
        </div>
        <dl className="adm-qr__facts">
          <div><dt>College</dt><dd>{placement.institution.shortName}</dd></div>
          <div><dt>Location id</dt><dd><code>{placement.areaSlug}</code></dd></div>
          <div className="adm-qr__wide"><dt>Context identifier</dt><dd><code>{placement.payload}</code></dd></div>
          <div className="adm-qr__wide"><dt>Opens</dt><dd><code>{placement.scanUrl}</code></dd></div>
          <div><dt>Created</dt><dd>{formatDate(placement.createdAt)}{placement.createdBy ? ` by ${placement.createdBy}` : ''}</dd></div>
        </dl>
        {!placement.isActive && <Notice tone="warn">Inactive: scans of this code are rejected until a Super Admin reactivates it.</Notice>}
        <div className="adm-qr__actions">
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => void download('png')} disabled={busy !== null} aria-label={`Download PNG for ${placement.label}`}>
            <Download size={14} aria-hidden="true" /> {busy === 'png' ? 'Preparing…' : 'PNG'}
          </button>
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => void download('svg')} disabled={busy !== null} aria-label={`Download SVG for ${placement.label}`}>
            <Download size={14} aria-hidden="true" /> {busy === 'svg' ? 'Preparing…' : 'SVG'}
          </button>
          {actions}
        </div>
      </div>
    </article>
  )
}

/** Warns when generated codes would point at a development address instead of the public site. */
export function PublicUrlNotice({ publicAppUrl }: { publicAppUrl: string }) {
  let host = ''
  try { host = new URL(publicAppUrl).hostname } catch { /* shown as is below */ }
  const local = host === 'localhost' || host.endsWith('.localhost') || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || host === '[::1]'
  return local
    ? <Notice tone="warn" title="Development address">Codes generated here open <code>{publicAppUrl}</code>, which only works on this computer or network. Before printing for the college, deploy CampusGuide and set the backend’s FRONTEND_ORIGIN to the public https address.</Notice>
    : <Notice tone="info">Codes open <code>{publicAppUrl}/scan</code>. Students can scan them with the phone camera or inside CampusGuide; codes printed earlier keep working.</Notice>
}
