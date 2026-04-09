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
      </div>
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-violet-600 to-fuchsia-600 text-xs font-medium text-white ring-2 ring-zinc-900">
          A
        </div>
      </div>
    </header>
  )
}
