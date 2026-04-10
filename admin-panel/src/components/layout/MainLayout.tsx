import { Outlet } from 'react-router-dom'
import { Button } from '../ui/Button'
import { useAppState } from '../../context/AppState'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'

export function MainLayout() {
  const { lastError, dismissLastError } = useAppState()

  return (
    <div className="flex min-h-screen bg-[#0c0e14]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        {lastError ? (
          <div
            role="alert"
            className="flex shrink-0 items-start justify-between gap-3 border-b border-rose-900/50 bg-rose-950/40 px-6 py-3 text-sm text-rose-100"
          >
            <p className="min-w-0 pt-0.5 leading-snug">{lastError}</p>
            <Button variant="ghost" className="shrink-0 py-1.5 text-xs text-rose-200" onClick={dismissLastError}>
              Dismiss
            </Button>
          </div>
        ) : null}
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
