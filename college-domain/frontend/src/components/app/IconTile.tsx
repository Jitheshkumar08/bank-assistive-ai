import type { LucideIcon } from 'lucide-react'
import type { Tone } from '../../content/types'

type IconTileProps = { icon: LucideIcon; tone: Tone; variant?: 'solid' | 'soft'; size?: 'sm' | 'md' | 'lg'; className?: string }

const iconSizes = { sm: 16, md: 20, lg: 24 } as const

/** Rounded square icon in one of the shared tones (solid fill or soft tint), as used throughout the reference. */
export default function IconTile({ icon: Icon, tone, variant = 'soft', size = 'md', className }: IconTileProps) {
  return (
    <span className={['icon-tile', `icon-tile--${variant}`, `icon-tile--${size}`, `tone-${tone}`, className].filter(Boolean).join(' ')} aria-hidden="true">
      <Icon size={iconSizes[size]} strokeWidth={2} />
    </span>
  )
}
