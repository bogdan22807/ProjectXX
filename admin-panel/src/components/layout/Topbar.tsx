import { useLocation } from 'react-router-dom'

const titles: Record<string, string> = {
  '/': 'Dashboard',
  '/proxies': 'Proxies',
  '/profiles': 'Browser Profiles',
  '/logs': 'Logs',
  '/settings': 'Settings',
}

type Props = {
  onMenuClick?: () => void
}

export function Topbar({ onMenuClick }: Props) {
  const { pathname } = useLocation()
  const normalizedPath =
    pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
  const title = titles[normalizedPath] ?? 'Account Control'

  return (
    <header className="flex min-h-14 shrink-0 items-center justify-between border-b border-zinc-800/80 bg-zinc-950/50 px-4 py-2 backdrop-blur sm:px-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onMenuClick}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/70 text-zinc-200 md:hidden"
          aria-label="Open navigation"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
        <h1 className="text-sm font-semibold text-zinc-100">{title}</h1>
        <p className="hidden text-xs text-zinc-500 sm:block">Local state · ready for automation hooks</p>
      </div>
      <div className="flex items-center gap-3">
        <span className="hidden rounded-md border border-zinc-800 bg-zinc-900/50 px-2 py-1 text-xs text-zinc-500 sm:inline">
          v0.1
        </span>
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-violet-600 to-fuchsia-600 text-xs font-medium text-white ring-2 ring-zinc-900">
          A
        </div>
      </div>
    </header>
  )
}
