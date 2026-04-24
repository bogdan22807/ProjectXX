import type { ReactNode } from 'react'
import type { AccountStatus, ProfileStatus, ProxyStatus } from '../../types/domain'

type AnyStatus = AccountStatus | ProxyStatus | ProfileStatus

const styles: Record<string, string> = {
  New: 'bg-zinc-800/90 text-zinc-300 border-zinc-600/60',
  Starting: 'bg-violet-950/80 text-violet-300 border-violet-800/60',
  Ready: 'bg-sky-950/80 text-sky-300 border-sky-800/60',
  Running: 'bg-emerald-950/80 text-emerald-300 border-emerald-800/60',
  Error: 'bg-red-950/80 text-red-300 border-red-800/60',
  challenge_detected: 'bg-amber-950/85 text-amber-200 border-amber-600/70',
  auth_required: 'bg-orange-950/85 text-orange-200 border-orange-600/70',
  Active: 'bg-emerald-950/80 text-emerald-300 border-emerald-800/60',
  'Needs Check': 'bg-amber-950/80 text-amber-300 border-amber-800/60',
  Dead: 'bg-zinc-800 text-zinc-400 border-zinc-700',
  'In Use': 'bg-blue-950/80 text-blue-300 border-blue-800/60',
}

export function StatusBadge({ status, children }: { status: AnyStatus; children?: ReactNode }) {
  const cls = styles[status] ?? 'bg-zinc-800 text-zinc-400 border-zinc-700'
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium transition-[border-color,background-color] duration-200 ${cls}`}
    >
      {children ?? status}
    </span>
  )
}
