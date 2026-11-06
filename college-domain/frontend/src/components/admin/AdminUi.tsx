import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, CircleAlert, Info, Inbox, RefreshCcw, X, type LucideIcon } from 'lucide-react'
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Link } from 'react-router'

/** Page title, subtitle, breadcrumbs and actions (reference: "Dashboard / Overview of admission data…"). */
export function PageHeading({ title, subtitle, crumbs, actions }: { title: string; subtitle?: string; crumbs?: { label: string; to?: string }[]; actions?: ReactNode }) {
  return (
    <>
      <title>{`${title} · CampusGuide Admin`}</title>
      {crumbs && (
        <nav aria-label="Breadcrumb">
          <ol className="adm-crumbs">
            {crumbs.map((crumb) => <li key={crumb.label}>{crumb.to ? <Link to={crumb.to}>{crumb.label}</Link> : <span aria-current="page">{crumb.label}</span>}</li>)}
          </ol>
        </nav>
      )}
      <div className="adm-head">
        <div>
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {actions && <div className="adm-head__actions">{actions}</div>}
      </div>
    </>
  )
}

export function Card({ title, actions, children, className, bodyless = false, labelledBy }: { title?: string; actions?: ReactNode; children: ReactNode; className?: string; bodyless?: boolean; labelledBy?: string }) {
  const id = useId()
  return (
    <section className={['adm-card', className].filter(Boolean).join(' ')} aria-labelledby={title ? id : labelledBy}>
      {(title || actions) && (
        <div className="adm-card__head">
          {title && <h2 id={id}>{title}</h2>}
          {actions}
        </div>
      )}
      {bodyless ? children : <div className="adm-card__body">{children}</div>}
    </section>
  )
}

export type Tone = 'blue' | 'purple' | 'green' | 'red' | 'orange' | 'teal'

export function StatCard({ icon: Icon, tone, label, value, note, small = false }: { icon: LucideIcon; tone: Tone; label: string; value: ReactNode; note?: ReactNode; small?: boolean }) {
  return (
    <div className="adm-card adm-stat">
      <span className={`adm-stat__icon tone-bg-${tone}`} aria-hidden="true"><Icon size={22} strokeWidth={2} /></span>
      <div>
        <p className="adm-stat__label">{label}</p>
        <p className={`adm-stat__value${small ? ' adm-stat__value--sm' : ''}`}>{value}</p>
        {note && <p className="adm-stat__note">{note}</p>}
      </div>
    </div>
  )
}

type BadgeTone = 'green' | 'orange' | 'red' | 'blue' | 'grey'
export function Badge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return <span className={`adm-badge adm-badge--${tone}`}>{children}</span>
}

const importStatus: Record<string, [BadgeTone, string]> = {
  completed: ['green', 'Completed'], partial: ['orange', 'Partial'], failed: ['red', 'Failed'], awaiting_confirmation: ['blue', 'Awaiting confirmation'],
  processing: ['blue', 'Processing'], cancelled: ['grey', 'Cancelled'], expired: ['grey', 'Expired'], pending: ['grey', 'Pending'],
}
export function ImportStatusBadge({ status }: { status: string }) {
  const [tone, label] = importStatus[status] ?? ['grey', status]
  return <Badge tone={tone}>{label}</Badge>
}

/** Admission status text is official free text; common words get the reference's colours, anything else stays neutral. */
export function AdmissionStatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="muted">Not published</span>
  const text = status.toLowerCase()
  const tone: BadgeTone = /admit|confirm|allot|join/.test(text) ? 'green' : /pend|wait|process|provisional/.test(text) ? 'orange' : /reject|cancel|withdr|declin/.test(text) ? 'red' : 'grey'
  return <Badge tone={tone}>{status}</Badge>
}

export function EmptyState({ icon: Icon = Inbox, title, children }: { icon?: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="adm-state">
      <Icon size={32} aria-hidden="true" />
      <strong>{title}</strong>
      {children && <div>{children}</div>}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="adm-state adm-state--error" role="alert">
      <CircleAlert size={30} aria-hidden="true" />
      <strong>Something went wrong</strong>
      <div>{message}</div>
      {onRetry && <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={onRetry}><RefreshCcw size={14} aria-hidden="true" /> Try again</button>}
    </div>
  )
}

export function Notice({ tone = 'info', children, title }: { tone?: 'info' | 'warn' | 'error' | 'success'; title?: string; children: ReactNode }) {
  const Icon = tone === 'error' ? CircleAlert : tone === 'warn' ? AlertTriangle : tone === 'success' ? CheckCircle2 : Info
  return (
    <div className={`adm-notice adm-notice--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon size={17} aria-hidden="true" />
      <div>{title && <strong>{title} </strong>}{children}</div>
    </div>
  )
}

export function SkeletonRows({ rows = 5, columns = 5, label = 'Loading…' }: { rows?: number; columns?: number; label?: string }) {
  return (
    <div role="status" aria-live="polite" style={{ display: 'grid', gap: 14, padding: 18 }}>
      <span className="visually-hidden">{label}</span>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: 16 }} aria-hidden="true">
          {Array.from({ length: columns }, (_, column) => <span key={column} className="adm-skeleton" />)}
        </div>
      ))}
    </div>
  )
}

/** "Showing 1 to 5 of 5,284 records" + numbered pages + page size, as in the reference. */
export function Pagination({ page, pageSize, total, noun, onPage, onPageSize }: { page: number; pageSize: number; total: number; noun: string; onPage: (page: number) => void; onPageSize?: (size: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const first = total ? (page - 1) * pageSize + 1 : 0
  const last = Math.min(total, page * pageSize)
  const numbers = pageNumbers(page, pages)
  return (
    <div className="adm-footer-bar">
      <span>Showing {first.toLocaleString('en-IN')} to {last.toLocaleString('en-IN')} of {total.toLocaleString('en-IN')} {noun}</span>
      <nav className="adm-pager" aria-label="Pagination">
        <button type="button" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page"><ChevronLeft size={14} /></button>
        {numbers.map((value, index) => value === null
          ? <span key={`gap-${index}`} aria-hidden="true">…</span>
          : <button key={value} type="button" onClick={() => onPage(value)} aria-current={value === page ? 'page' : undefined} aria-label={`Page ${value}`}>{value.toLocaleString('en-IN')}</button>)}
        <button type="button" onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="Next page"><ChevronRight size={14} /></button>
        {onPageSize && (
          <select aria-label="Rows per page" value={pageSize} onChange={(event) => onPageSize(Number(event.target.value))}>
            {[10, 20, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        )}
      </nav>
    </div>
  )
}

function pageNumbers(page: number, pages: number): (number | null)[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, index) => index + 1)
  const set = new Set([1, 2, page - 1, page, page + 1, pages])
  const sorted = [...set].filter((value) => value >= 1 && value <= pages).sort((a, b) => a - b)
  return sorted.flatMap((value, index) => (index && value - sorted[index - 1] > 1 ? [null, value] : [value]))
}

/** Accessible modal: focus moves in, Escape closes, focus returns to the trigger. */
export function Dialog({ title, onClose, children, footer, wide = false }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  useEffect(() => { close.current = onClose }, [onClose])
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const first = panel.current?.querySelector<HTMLElement>('input, select, textarea, button:not([data-close])')
    ;(first ?? panel.current)?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close.current()
      if (event.key === 'Tab' && panel.current) {
        const focusable = [...panel.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select, textarea')]
        if (!focusable.length) return
        const [start, end] = [focusable[0], focusable[focusable.length - 1]]
        if (event.shiftKey && document.activeElement === start) { event.preventDefault(); end.focus() }
        else if (!event.shiftKey && document.activeElement === end) { event.preventDefault(); start.focus() }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); previous?.focus?.() }
  }, [])
  return (
    <div className="adm-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div ref={panel} className={`adm-dialog${wide ? ' adm-dialog--wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="adm-dialog__head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="adm-icon-btn" onClick={onClose} aria-label="Close" data-close><X size={18} /></button>
        </div>
        <div className="adm-dialog__body">{children}</div>
        {footer && <div className="adm-dialog__foot">{footer}</div>}
      </div>
    </div>
  )
}

