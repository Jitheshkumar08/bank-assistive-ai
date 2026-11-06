/** Friendly student-with-question illustration for "Need Further Help?" (decorative). */
export default function SupportIllustration({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 96 104" aria-hidden="true" focusable="false">
      <ellipse cx="48" cy="99" rx="30" ry="4" fill="#0c1f4f" opacity="0.08" />
      <path d="M18 98c2-20 14-30 30-30s28 10 30 30z" fill="#2f6bff" />
      <path d="M38 69l10 14 10-14" fill="#e8efff" />
      <rect x="42" y="56" width="12" height="14" rx="5" fill="#f2b98d" />
      <ellipse cx="48" cy="40" rx="17" ry="19" fill="#f6c69f" />
      <path d="M30 40c-2-16 8-25 19-25 12 0 20 8 18 24-3-7-9-11-16-12-6 4-14 6-21 13z" fill="#1d2433" />
      <circle cx="41.5" cy="42" r="1.8" fill="#1d2433" />
      <circle cx="54.5" cy="42" r="1.8" fill="#1d2433" />
      <path d="M43 50c3 2.4 7 2.4 10 0" stroke="#b5643c" strokeWidth="1.8" strokeLinecap="round" fill="none" />
      <rect x="62" y="4" width="28" height="22" rx="8" fill="#7c4dff" />
      <path d="M68 26l-2 7 8-7z" fill="#7c4dff" />
      <text x="76" y="20" textAnchor="middle" fontSize="14" fontWeight="700" fill="#fff" fontFamily="Inter Variable, sans-serif">?</text>
    </svg>
  )
}
