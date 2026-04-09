import { formatTime } from '../utils/format'
import { useAppState } from '../context/AppState'

export function LogsPage() {
  const { logs } = useAppState()

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-900/30">
      <div className="overflow-x-auto">
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
              <tr key={l.id} className="hover:bg-zinc-900/40">
                <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-zinc-500">
                  {formatTime(l.time)}
                </td>
                <td className="px-4 py-3 font-medium text-zinc-200">{l.action}</td>
                <td className="px-4 py-3 text-zinc-400">{l.details}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {logs.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-zinc-500">No log entries yet.</p>
      ) : null}
    </div>
  )
}
