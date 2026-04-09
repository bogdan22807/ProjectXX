import { Card } from '../components/ui/Card'
import {
  uiPageStack,
  uiTable,
  uiTableBodyRow,
  uiTableHeadRow,
  uiTableTd,
  uiTableTh,
} from '../components/ui/primitives'
import { useAppState } from '../context/AppState'
import { formatTime } from '../utils/format'

export function LogsPage() {
  const { logs } = useAppState()

  return (
    <div className={uiPageStack}>
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className={`${uiTable} min-w-[640px]`}>
            <thead>
              <tr className={uiTableHeadRow}>
                <th className={uiTableTh}>Time</th>
                <th className={uiTableTh}>Action</th>
                <th className={uiTableTh}>Details</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className={uiTableBodyRow}>
                  <td className={`${uiTableTd} whitespace-nowrap font-mono text-xs text-zinc-500`}>
                    {formatTime(l.time)}
                  </td>
                  <td className={`${uiTableTd} font-medium text-zinc-200`}>{l.action}</td>
                  <td className={`${uiTableTd} text-zinc-400`}>{l.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {logs.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-zinc-500">No log entries yet.</p>
        ) : null}
      </Card>
    </div>
  )
}
