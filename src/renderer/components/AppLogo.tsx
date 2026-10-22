import { useId } from 'react'

/**
 * Verso mark: an open page forming a V monogram (same artwork as
 * resources/icon.svg, inlined so it scales crisply).
 */
export function AppLogo({
  size = 24,
  className = '',
}: {
  size?: number
  className?: string
}): React.JSX.Element {
  const id = useId()
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      className={className}
      aria-hidden="true"
      focusable="false"
      data-testid="app-logo"
    >
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--logo-bg-top)' }} />
          <stop offset="1" style={{ stopColor: 'var(--logo-bg-bottom)' }} />
        </linearGradient>
        <linearGradient id={`${id}-page`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--logo-page-start)' }} />
          <stop offset="1" style={{ stopColor: 'var(--logo-page-end)' }} />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="112" fill={`url(#${id}-bg)`} />
      <path d="M128 124 L 222 112 L 270 382 L 176 394 Z" fill={`url(#${id}-page)`} />
      <path d="M384 124 L 290 112 L 242 382 L 336 394 Z" fill={`url(#${id}-page)`} />
      <path d="M250 236 L 262 236 L 270 390 L 242 390 Z" fill="var(--logo-ink)" opacity="0.16" />
      <path d="M384 124 L 326 117 L 352 178 Z" fill="var(--logo-fold)" />
      <path
        d="M172 208 L 230 200"
        stroke="var(--logo-ink)"
        strokeWidth="7"
        strokeLinecap="round"
        opacity="0.32"
      />
      <path
        d="M180 250 L 238 242"
        stroke="var(--logo-ink)"
        strokeWidth="7"
        strokeLinecap="round"
        opacity="0.32"
      />
      <path
        d="M188 292 L 246 284"
        stroke="var(--logo-ink)"
        strokeWidth="7"
        strokeLinecap="round"
        opacity="0.32"
      />
    </svg>
  )
}
