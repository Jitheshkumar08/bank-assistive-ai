/** CampusGuide mark: a pillared campus building under a guiding star. */
export default function BrandMark({ size = 40, title }: { size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role={title ? 'img' : 'presentation'} aria-hidden={title ? undefined : true} aria-label={title}>
      <defs>
        <linearGradient id="cg-mark-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3b74ef" />
          <stop offset="1" stopColor="#1a3463" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="13" fill="url(#cg-mark-bg)" />
      <path d="M24 7.5l1.6 3.4 3.4 1.6-3.4 1.6L24 17.5l-1.6-3.4-3.4-1.6 3.4-1.6z" fill="#c7d8ff" />
      <path d="M11 22.5L24 17l13 5.5z" fill="#ffffff" />
      <rect x="12" y="23.5" width="24" height="2.2" rx="0.6" fill="#ffffff" />
      {[14, 19.3, 24.6, 29.9].map((x) => <rect key={x} x={x} y="27" width="3.1" height="9" rx="0.8" fill="#ffffff" />)}
      <rect x="10" y="37" width="28" height="3" rx="1" fill="#ffffff" />
    </svg>
  )
}
