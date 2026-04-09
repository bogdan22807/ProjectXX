import type { ReactNode } from 'react'
import { uiCardSurface } from './primitives'

export function Card({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={`${uiCardSurface} ${className}`}>{children}</div>
}
