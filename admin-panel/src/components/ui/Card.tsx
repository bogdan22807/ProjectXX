import type { ReactNode } from 'react'

export function Card({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={`rounded-xl border border-zinc-800/80 bg-zinc-900/40 shadow-sm shadow-black/20 transition-shadow duration-200 ease-out ${className}`}
    >
      {children}
    </div>
  )
}
