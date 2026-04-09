import { formatTime } from '../utils/format'
import { EmptyState } from '../components/ui/EmptyState'
import { useAppState } from '../context/AppState'

export function LogsPage() {
  const { logs } = useAppState()

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-900/30 transition-[border-color] duration-200">
      <div className="overflow-x-auto">
        {logs.length === 0 ? (
          <EmptyState
            className="py-16"
            title="Журнал пуст"
            description="Здесь появятся события после действий в панели."
          />
        ) : (
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-950/50 text-xs uppercase tracking-wide text-zinc-500">
              <th className="px-4 py-3">Time</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/80">
            {logs.map((l) => (
              <tr
                key={l.id}
                className="transition-[background-color] duration-200 ease-out hover:bg-zinc-900/40"
              >
                <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-zinc-500">
                  {formatTime(l.time)}
                </td>
                <td className="px-4 py-3 font-medium text-zinc-200">{l.action}</td>
                <td className="px-4 py-3 text-zinc-400">{l.details}</td>
              </tr>
            ))}
          </tbody>
        </table>
        )}
      </div>
    </div>
  )
}
