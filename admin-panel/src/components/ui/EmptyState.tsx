import type { ReactNode } from 'react'

export function EmptyState({
  title,
  description,
  action,
  className = '',
}: {
  title: string
  description?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center px-6 py-14 text-center ${className}`}
    >
      <div
        className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-zinc-800/90 bg-zinc-900/40 text-zinc-500 shadow-inner shadow-black/20 transition-colors duration-200"
        aria-hidden
      >
        <svg className="h-7 w-7 opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.25}
            d="M20 13V7a2 2 0 00-2-2H6a2 2 0 00-2 2v6m16 0v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-4m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
          />
        </svg>
      </div>
      <p className="text-sm font-medium text-zinc-300">{title}</p>
      {description ? (
        <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-zinc-500">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}
