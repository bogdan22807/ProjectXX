import { Card } from '../components/ui/Card'
import { useAppState } from '../context/AppState'

export function SettingsPage() {
  const { settings, setSettings } = useAppState()

  const rows = [
    { key: 'notifications' as const, title: 'Notifications' },
    { key: 'autoRetryFailed' as const, title: 'Auto retry failed' },
    { key: 'strictWarmup' as const, title: 'Strict warmup' },
  ]

  return (
    <div className="max-w-xl space-y-4">
      <Card className="divide-y divide-zinc-800/80">
        {rows.map((row) => (
          <div key={row.key} className="flex items-start justify-between gap-4 px-5 py-4">
            <div className="text-sm font-medium text-zinc-200">{row.title}</div>
            <button
              type="button"
              role="switch"
              aria-checked={settings[row.key]}
              onClick={() => setSettings({ [row.key]: !settings[row.key] })}
              className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border transition-colors ${
                settings[row.key]
                  ? 'border-violet-500/50 bg-violet-600'
                  : 'border-zinc-700 bg-zinc-800'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-6 w-6 translate-y-0 rounded-full bg-white shadow transition-transform ${
                  settings[row.key] ? 'translate-x-5' : 'translate-x-0.5'
                } mt-0.5`}
              />
            </button>
          </div>
        ))}
      </Card>
    </div>
  )
}
