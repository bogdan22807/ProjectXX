import { Card } from '../components/ui/Card'
import { useAppState } from '../context/AppState'

export function SettingsPage() {
  const { settings, setSettings } = useAppState()

  const rows = [
    {
      key: 'notifications' as const,
      title: 'Notifications',
      description: 'Show in-app notices for important events (UI only).',
    },
    {
      key: 'autoRetryFailed' as const,
      title: 'Auto retry failed',
      description: 'When automation is connected, retry failed steps automatically.',
    },
    {
      key: 'strictWarmup' as const,
      title: 'Strict warmup',
      description: 'Stricter checks before marking an account as Ready.',
    },
  ]

  return (
    <div className="max-w-xl space-y-4">
      <Card className="divide-y divide-zinc-800/80">
        {rows.map((row) => (
          <div
            key={row.key}
            className="flex flex-col items-start justify-between gap-3 px-4 py-4 sm:flex-row sm:items-start sm:gap-4 sm:px-5"
          >
            <div>
              <div className="text-sm font-medium text-zinc-200">{row.title}</div>
              <p className="mt-1 text-xs text-zinc-500">{row.description}</p>
            </div>
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
      <p className="text-xs text-zinc-600">
        These preferences are stored in component state only and reset on refresh.
      </p>
    </div>
  )
}
