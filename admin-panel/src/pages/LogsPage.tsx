import { formatTime } from '../utils/format'
import { EmptyState } from '../components/ui/EmptyState'
import { useAppState } from '../context/AppState'

function parseStructuredErrorDetails(details: string): {
  errorType?: string
  errorMessage?: string
  errorStack?: string
  context?: string
} | null {
  const lines = details.split('\n')
  const pick = (prefix: string) => {
    const line = lines.find((l) => l.startsWith(prefix))
    if (!line) return undefined
    return line.slice(prefix.length).trim() || undefined
  }
  const errorType = pick('ERROR_TYPE=')
  const errorMessage = pick('ERROR_MESSAGE=')
  const errorStack = pick('ERROR_STACK=')
  const context = pick('CONTEXT=')
  if (!errorType && !errorMessage && !errorStack && !context) return null
  return { errorType, errorMessage, errorStack, context }
}

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
            {logs.map((l) => {
              const parsed = parseStructuredErrorDetails(l.details)
              return (
              <tr
                key={l.id}
                className="transition-[background-color] duration-200 ease-out hover:bg-zinc-900/40"
              >
                <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-zinc-500">
                  {formatTime(l.time)}
                </td>
                <td className="px-4 py-3 font-medium text-zinc-200">{l.action}</td>
                <td className="px-4 py-3 text-zinc-400">
                  {parsed ? (
                    <div className="space-y-2">
                      <dl className="grid gap-1 rounded-md border border-red-900/40 bg-red-950/20 p-3 font-mono text-xs text-red-100/90">
                        {parsed.errorType != null ? (
                          <div>
                            <dt className="text-red-400/80">ERROR_TYPE</dt>
                            <dd className="whitespace-pre-wrap break-all">{parsed.errorType}</dd>
                          </div>
                        ) : null}
                        {parsed.errorMessage != null ? (
                          <div>
                            <dt className="text-red-400/80">ERROR_MESSAGE</dt>
                            <dd className="whitespace-pre-wrap break-all">{parsed.errorMessage}</dd>
                          </div>
                        ) : null}
                        {parsed.errorStack != null ? (
                          <div>
                            <dt className="text-red-400/80">ERROR_STACK</dt>
                            <dd className="max-h-48 overflow-y-auto whitespace-pre-wrap break-all text-zinc-300">
                              {parsed.errorStack}
                            </dd>
                          </div>
                        ) : null}
                        {parsed.context != null ? (
                          <div>
                            <dt className="text-red-400/80">CONTEXT</dt>
                            <dd className="whitespace-pre-wrap break-all">{parsed.context}</dd>
                          </div>
                        ) : null}
                      </dl>
                      <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-all text-xs text-zinc-500">
                        {l.details}
                      </pre>
                    </div>
                  ) : (
                    <span className="whitespace-pre-wrap break-all">{l.details}</span>
                  )}
                </td>
              </tr>
              )
            })}
          </tbody>
        </table>
        )}
      </div>
    </div>
  )
}
