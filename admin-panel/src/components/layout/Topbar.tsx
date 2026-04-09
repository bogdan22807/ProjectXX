import { useLocation } from 'react-router-dom'

const titles: Record<string, string> = {
  '/': 'Dashboard',
  '/proxies': 'Proxies',
  '/profiles': 'Browser Profiles',
  '/logs': 'Logs',
  '/settings': 'Settings',
}

export function Topbar() {
  const { pathname } = useLocation()
  const title = titles[pathname] ?? 'Account Control'

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-800/80 bg-zinc-950/50 px-6 backdrop-blur">
      <div>
        <h1 className="text-sm font-semibold text-zinc-100">{title}</h1>
        <p className="text-xs text-zinc-500">Local state · ready for automation hooks</p>
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
