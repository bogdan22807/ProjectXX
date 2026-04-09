import { useNavigate } from 'react-router-dom'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { StatusBadge } from '../components/ui/StatusBadge'
import { useAppState } from '../context/AppState'
import { formatTime } from '../utils/format'

export function DashboardPage() {
  const { stats, logs, accounts } = useAppState()
  const navigate = useNavigate()

  const recentLogs = logs.slice(0, 5)
  const recentAccounts = accounts.slice(0, 5)

  const cards = [
    { label: 'Total Accounts', value: stats.totalAccounts },
    { label: 'Active', value: stats.activeAccounts },
    { label: 'Running', value: stats.runningAccounts },
    { label: 'Errors', value: stats.errorAccounts },
    { label: 'Total Proxies', value: stats.totalProxies },
  ]

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {cards.map((c) => (
          <Card key={c.label} className="p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">{c.label}</div>
            <div className="mt-2 text-2xl font-semibold tabular-nums text-zinc-100">{c.value}</div>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => navigate('/accounts', { state: { openAdd: true } })}>
          Add Account
        </Button>
        <Button onClick={() => navigate('/proxies', { state: { openAdd: true } })}>Add Proxy</Button>
        <Button onClick={() => navigate('/profiles', { state: { openAdd: true } })}>Create Profile</Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <div className="border-b border-zinc-800/80 px-4 py-3">
            <h2 className="text-sm font-semibold text-zinc-200">Recent logs</h2>
          </div>
          <div className="divide-y divide-zinc-800/60">
            {recentLogs.length === 0 ? (
              <p className="px-4 py-6 text-sm text-zinc-500">No logs yet.</p>
            ) : (
              recentLogs.map((l) => (
                <div key={l.id} className="px-4 py-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-zinc-200">{l.action}</span>
                    <span className="shrink-0 text-xs text-zinc-500">{formatTime(l.time)}</span>
                  </div>
                  <p className="mt-1 text-zinc-500">{l.details}</p>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b border-zinc-800/80 px-4 py-3">
            <h2 className="text-sm font-semibold text-zinc-200">Recent accounts</h2>
          </div>
          <div className="divide-y divide-zinc-800/60">
            {recentAccounts.length === 0 ? (
              <p className="px-4 py-6 text-sm text-zinc-500">No accounts yet.</p>
            ) : (
              recentAccounts.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-zinc-200">{a.name}</div>
                    <div className="truncate text-xs text-zinc-500">{a.login}</div>
                  </div>
                  <StatusBadge status={a.status} />
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}
