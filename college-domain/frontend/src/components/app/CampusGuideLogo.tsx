/** Line-art CampusGuide mark from the reference: a shield-hexagon holding a graduation cap. */
export default function CampusGuideLogo({ size = 34, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true" focusable="false">
      <path d="M20 2.8 35 11v18L20 37.2 5 29V11z" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M9.5 16.5 20 11.8l10.5 4.7L20 21.2z" fill="currentColor" />
      <path d="M13.5 19v5.2c0 1.9 2.9 3.6 6.5 3.6s6.5-1.7 6.5-3.6V19L20 21.9z" fill="currentColor" opacity="0.85" />
      <path d="M30.5 16.5v6.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="30.5" cy="23.6" r="1.2" fill="currentColor" />
    </svg>
  )
}
