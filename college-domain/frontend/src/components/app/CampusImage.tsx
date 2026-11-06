import { useState } from 'react'
import { config } from '../../config'
import { useI18n } from '../../i18n/I18nProvider'

/**
 * Campus picture for banners. Uses a licensed photo when VITE_CAMPUS_IMAGE_URL is set; otherwise (or if the photo
 * fails to load) an illustrative drawing that does not claim to depict a specific real building.
 */
export default function CampusImage({ className }: { className?: string }) {
  const [photoFailed, setPhotoFailed] = useState(false)
  const { t } = useI18n()
  if (config.campusImageUrl && !photoFailed) {
    return <img className={className} src={config.campusImageUrl} alt={t('common.campusAlt')} loading="lazy" decoding="async" onError={() => setPhotoFailed(true)} />
  }
  return <CampusIllustrationSvg className={className} label={t('common.campusIllustrationAlt')} />
}

function CampusIllustrationSvg({ className, label }: { className?: string; label: string }) {
  const upperWindows = Array.from({ length: 7 }, (_, index) => 214 + index * 26)
  return (
    <svg className={className} viewBox="0 0 480 220" preserveAspectRatio="xMidYMid slice" role="img" aria-label={label}>
      <defs>
        <linearGradient id="ci-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#8fc1ff" /><stop offset="0.7" stopColor="#d6e8ff" /><stop offset="1" stopColor="#eef5ff" /></linearGradient>
        <linearGradient id="ci-glass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#bfe0ff" /><stop offset="1" stopColor="#5d93d6" /></linearGradient>
        <linearGradient id="ci-brick" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#c9573f" /><stop offset="1" stopColor="#a8432f" /></linearGradient>
        <linearGradient id="ci-cream" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#f7efe1" /><stop offset="1" stopColor="#e7dbc6" /></linearGradient>
        <linearGradient id="ci-lawn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7cc36b" /><stop offset="1" stopColor="#4f9a4a" /></linearGradient>
      </defs>
      <rect width="480" height="220" fill="url(#ci-sky)" />
      <g fill="#fff" opacity="0.85">
        <ellipse cx="96" cy="38" rx="34" ry="10" /><ellipse cx="120" cy="32" rx="22" ry="11" />
        <ellipse cx="390" cy="28" rx="30" ry="9" /><ellipse cx="410" cy="23" rx="18" ry="9" />
      </g>
      {/* distant trees */}
      <g fill="#5e9f5a" opacity="0.75">
        <ellipse cx="40" cy="150" rx="40" ry="34" /><ellipse cx="455" cy="148" rx="42" ry="36" /><ellipse cx="160" cy="138" rx="26" ry="22" />
      </g>
      {/* left cream wing */}
      <rect x="120" y="92" width="96" height="86" fill="url(#ci-cream)" />
      <rect x="116" y="86" width="104" height="8" fill="#d9ccb5" />
      {[0, 1, 2].map((row) => [0, 1, 2, 3].map((col) => (
        <rect key={`l${row}${col}`} x={128 + col * 22} y={100 + row * 24} width="14" height="15" rx="1.5" fill="url(#ci-glass)" />
      )))}
      {/* central brick block */}
      <rect x="206" y="62" width="190" height="116" fill="url(#ci-brick)" />
      <rect x="200" y="54" width="202" height="10" fill="#8f3a2a" />
      {upperWindows.map((x) => <rect key={`u${x}`} x={x} y="74" width="16" height="20" rx="1.5" fill="url(#ci-glass)" />)}
      {upperWindows.map((x) => <rect key={`m${x}`} x={x} y="104" width="16" height="20" rx="1.5" fill="url(#ci-glass)" />)}
      {/* glass entrance tower */}
      <rect x="276" y="44" width="52" height="134" fill="url(#ci-glass)" />
      <g stroke="#ffffff" strokeOpacity="0.55" strokeWidth="1.2">
        {[60, 78, 96, 114, 132, 150].map((y) => <line key={y} x1="276" y1={y} x2="328" y2={y} />)}
        <line x1="302" y1="44" x2="302" y2="178" />
      </g>
      <rect x="270" y="38" width="64" height="8" fill="#e8eef8" />
      <rect x="262" y="146" width="80" height="6" fill="#e8eef8" />
      <rect x="290" y="152" width="24" height="26" fill="#2f5d9a" />
      {/* right cream wing */}
      <rect x="392" y="96" width="70" height="82" fill="url(#ci-cream)" />
      <rect x="388" y="90" width="78" height="8" fill="#d9ccb5" />
      {[0, 1, 2].map((row) => [0, 1, 2].map((col) => (
        <rect key={`r${row}${col}`} x={400 + col * 20} y={104 + row * 23} width="12" height="14" rx="1.5" fill="url(#ci-glass)" />
      )))}
      {/* lawn, path, trees */}
      <rect y="176" width="480" height="44" fill="url(#ci-lawn)" />
      <path d="M286 178 L318 178 L360 220 L246 220 Z" fill="#e8e1d2" />
      <g>
        <rect x="88" y="150" width="5" height="34" fill="#6b4a2f" /><ellipse cx="90" cy="140" rx="26" ry="24" fill="#3f8a3e" />
        <rect x="448" y="152" width="5" height="32" fill="#6b4a2f" /><ellipse cx="450" cy="142" rx="24" ry="22" fill="#3f8a3e" />
        <ellipse cx="200" cy="182" rx="18" ry="8" fill="#4c9a46" /><ellipse cx="384" cy="182" rx="20" ry="8" fill="#4c9a46" />
      </g>
    </svg>
  )
}
