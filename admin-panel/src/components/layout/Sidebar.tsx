import { NavLink } from 'react-router-dom'

const nav = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/proxies', label: 'Proxies' },
  { to: '/profiles', label: 'Browser Profiles' },
  { to: '/logs', label: 'Logs' },
  { to: '/settings', label: 'Settings' },
] as const

export function Sidebar() {
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-zinc-800/80 bg-zinc-950/80">
      <div className="flex h-14 items-center gap-2 border-b border-zinc-800/80 px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600/20 text-violet-400 ring-1 ring-violet-500/30">
          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z" />
          </svg>
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-zinc-100">Account Control</div>
          <div className="truncate text-xs text-zinc-500">Локально</div>
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 p-3">
        {nav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={'end' in item ? item.end : false}
            className={({ isActive }) =>
              `flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-zinc-800/90 text-white shadow-sm'
                  : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
              }`
            }
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current opacity-60" aria-hidden />
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-zinc-800/80 p-3 text-xs text-zinc-600">
        Локальная копия · данные только в этом браузере
      </div>
    </aside>
  )
}
