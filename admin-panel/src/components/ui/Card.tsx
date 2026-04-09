import type { ReactNode } from 'react'
import { cardRootClass } from './patterns'

export function Card({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={`${cardRootClass} ${className}`}>{children}</div>
}
