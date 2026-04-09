import { NavLink } from 'react-router-dom'
import { useAppState } from '../../context/AppState'

const mainNav = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/proxies', label: 'Proxies' },
  { to: '/profiles', label: 'Browser Profiles' },
  { to: '/logs', label: 'Logs' },
  { to: '/settings', label: 'Settings' },
] as const

export function Sidebar() {
  const { accounts } = useAppState()

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-800/80 bg-zinc-950/80">
      <div className="flex h-14 items-center gap-2 border-b border-zinc-800/80 px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600/20 text-violet-400 ring-1 ring-violet-500/30">
          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z" />
          </svg>
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-zinc-100">Account Control</div>
          <div className="truncate text-xs text-zinc-500">Admin</div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <nav className="shrink-0 space-y-0.5 p-3">
          {mainNav.map((item) => (
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

        <div className="mx-3 border-t border-zinc-800/80 pt-2">
          <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
            Accounts
          </div>
          <NavLink
            to="/accounts"
            end
            className={({ isActive }) =>
              `mb-1 flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                isActive
                  ? 'bg-zinc-800/80 text-zinc-100'
                  : 'text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300'
              }`
            }
          >
            All accounts
          </NavLink>
          <nav className="max-h-[min(40vh,320px)] space-y-0.5 overflow-y-auto px-1 pb-2">
            {accounts.length === 0 ? (
              <p className="px-2 py-2 text-xs text-zinc-600">No accounts yet</p>
            ) : (
              accounts.map((a) => (
                <NavLink
                  key={a.id}
                  to={`/accounts/${a.id}`}
                  className={({ isActive }) =>
                    `flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors ${
                      isActive
                        ? 'bg-violet-950/50 text-violet-100 ring-1 ring-violet-500/30'
                        : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                    }`
                  }
                  title={a.login}
                >
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      a.status === 'Running'
                        ? 'bg-emerald-400'
                        : a.status === 'Error'
                          ? 'bg-red-400'
                          : a.status === 'Ready'
                            ? 'bg-sky-400'
                            : 'bg-zinc-500'
                    }`}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate">{a.name}</span>
                </NavLink>
              ))
            )}
          </nav>
        </div>
      </div>

      <div className="border-t border-zinc-800/80 p-3 text-xs text-zinc-600">
        Frontend mock · API later
      </div>
    </aside>
  )
}
