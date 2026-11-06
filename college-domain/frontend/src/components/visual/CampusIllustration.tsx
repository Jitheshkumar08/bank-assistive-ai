/** Static SVG version of the campus scene: shown while 3D loads, when WebGL is unavailable, or on small screens. */
export default function CampusIllustration({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 400 300" role="presentation" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="cg-stone" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f3f6fd" />
          <stop offset="1" stopColor="#d3dcef" />
        </linearGradient>
        <radialGradient id="cg-glow" cx="0.5" cy="0.55" r="0.5">
          <stop offset="0" stopColor="#3b74ef" stopOpacity="0.35" />
          <stop offset="1" stopColor="#3b74ef" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="200" cy="170" rx="190" ry="120" fill="url(#cg-glow)" />
      <ellipse cx="200" cy="168" rx="165" ry="44" fill="none" stroke="#6b9bff" strokeOpacity="0.55" strokeWidth="1.2" transform="rotate(-8 200 168)" />
      <ellipse cx="200" cy="168" rx="186" ry="58" fill="none" stroke="#6b9bff" strokeOpacity="0.3" strokeWidth="1" transform="rotate(6 200 168)" />
      <ellipse cx="200" cy="246" rx="128" ry="12" fill="#020817" opacity="0.35" />
      {/* Steps */}
      <rect x="92" y="226" width="216" height="12" rx="2" fill="#c9d4ea" />
      <rect x="100" y="216" width="200" height="11" rx="2" fill="url(#cg-stone)" />
      <rect x="108" y="206" width="184" height="11" rx="2" fill="url(#cg-stone)" />
      {/* Wall and windows */}
      <rect x="118" y="132" width="164" height="75" fill="#d5def0" />
      {[146, 192, 238].map((x) => (
        <path key={x} d={`M${x} 196 v-32 a8 8 0 0 1 16 0 v32 z`} fill="#3b74ef" opacity="0.85" />
      ))}
      {/* Columns */}
      {[124, 152, 180, 208, 236, 264].map((x) => (
        <rect key={x} x={x} y="134" width="12" height="73" rx="2" fill="url(#cg-stone)" />
      ))}
      {/* Entablature and pediment */}
      <rect x="110" y="122" width="180" height="12" rx="1.5" fill="#eef3fb" />
      <rect x="110" y="131" width="180" height="2" fill="#3b74ef" />
      <path d="M106 123 L200 84 L294 123 Z" fill="url(#cg-stone)" />
      {/* Graduation cap */}
      <g transform="translate(200 52)">
        <path d="M-34 0 L0 -14 L34 0 L0 14 Z" fill="#13284f" />
        <path d="M-15 6 v9 a15 6 0 0 0 30 0 v-9" fill="#1a3463" />
        <path d="M22 5 v14" stroke="#6b9bff" strokeWidth="2" />
        <circle cx="22" cy="20" r="3" fill="#6b9bff" />
      </g>
      <path d="M58 92 l7 -11 l7 11 l-7 11 z" fill="#9fbcff" opacity="0.8" />
      <path d="M336 128 l6 -9 l6 9 l-6 9 z" fill="#9fbcff" opacity="0.7" />
      <circle cx="80" cy="200" r="4" fill="#9fbcff" opacity="0.7" />
    </svg>
  )
}
