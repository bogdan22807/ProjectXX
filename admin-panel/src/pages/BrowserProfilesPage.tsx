import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Modal } from '../components/ui/Modal'
import {
  uiFormStack,
  uiInputField,
  uiLabel,
  uiPageStack,
  uiTable,
  uiTableBodyRow,
  uiTableCheckbox,
  uiTableHeadRow,
  uiTableTd,
  uiTableTh,
} from '../components/ui/primitives'
import { StatusBadge } from '../components/ui/StatusBadge'
import { useAppState } from '../context/AppState'
import type { ProfileStatus } from '../types/domain'

const profileStatuses: ProfileStatus[] = ['Ready', 'In Use', 'Error']

export function BrowserProfilesPage() {
  const {
    profiles,
    proxies,
    addProfile,
    deleteSelectedProfiles,
    selectedProfileIds,
    setSelectedProfileIds,
  } = useAppState()

  const [userAddOpen, setUserAddOpen] = useState(false)
  const [form, setForm] = useState({
    name: '',
    proxyId: '' as string,
    status: 'Ready' as ProfileStatus,
  })

  const location = useLocation()
  const navigate = useNavigate()
  const navWantsAdd = (location.state as { openAdd?: boolean } | null)?.openAdd === true
  const addOpen = userAddOpen || navWantsAdd

  function closeAddModal() {
    setUserAddOpen(false)
    if (navWantsAdd) {
      navigate(location.pathname, { replace: true, state: {} })
    }
  }

  function openAddModal() {
    setUserAddOpen(true)
  }

  function proxyLabel(id: string | null) {
    if (!id) return '—'
    const p = proxies.find((x) => x.id === id)
    return p ? `${p.provider} · ${p.host}` : '—'
  }

  function toggleRow(id: string) {
    setSelectedProfileIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (selectedProfileIds.size === profiles.length) {
      setSelectedProfileIds(new Set())
    } else {
      setSelectedProfileIds(new Set(profiles.map((p) => p.id)))
    }
  }

  function submitAdd() {
    addProfile({
      name: form.name.trim() || 'Unnamed profile',
      proxyId: form.proxyId || null,
      status: form.status,
    })
    closeAddModal()
    setForm({ name: '', proxyId: '', status: 'Ready' })
  }

  return (
    <div className={uiPageStack}>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={openAddModal}>
          Create Profile
        </Button>
        <Button
          variant="danger"
          disabled={selectedProfileIds.size === 0}
          onClick={deleteSelectedProfiles}
        >
          Delete
        </Button>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className={`${uiTable} min-w-[640px]`}>
            <thead>
              <tr className={uiTableHeadRow}>
                <th className={`${uiTableTh} w-12`}>
                  <input
                    type="checkbox"
                    className={uiTableCheckbox}
                    checked={profiles.length > 0 && selectedProfileIds.size === profiles.length}
                    onChange={toggleAll}
                    aria-label="Select all"
                  />
                </th>
                <th className={uiTableTh}>ID</th>
                <th className={uiTableTh}>Profile Name</th>
                <th className={uiTableTh}>Linked Proxy</th>
                <th className={uiTableTh}>Status</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((bp) => (
                <tr key={bp.id} className={uiTableBodyRow}>
                  <td className={uiTableTd}>
                    <input
                      type="checkbox"
                      className={uiTableCheckbox}
                      checked={selectedProfileIds.has(bp.id)}
                      onChange={() => toggleRow(bp.id)}
                      aria-label={`Select ${bp.name}`}
                    />
                  </td>
                  <td className={`${uiTableTd} font-mono text-xs text-zinc-500`}>{bp.id}</td>
                  <td className={`${uiTableTd} font-medium text-zinc-200`}>{bp.name}</td>
                  <td
                    className={`${uiTableTd} max-w-[220px] truncate text-zinc-400`}
                    title={proxyLabel(bp.proxyId)}
                  >
                    {proxyLabel(bp.proxyId)}
                  </td>
                  <td className={uiTableTd}>
                    <StatusBadge status={bp.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {profiles.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-zinc-500">No profiles yet.</p>
        ) : null}
      </Card>

      <Modal
        open={addOpen}
        title="Create Profile"
        onClose={closeAddModal}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={closeAddModal}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submitAdd}>
              Create Profile
            </Button>
          </div>
        }
      >
        <div className={uiFormStack}>
          <label className={uiLabel}>
            Profile Name
            <input
              className={uiInputField}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </label>
          <label className={uiLabel}>
            Linked Proxy
            <select
              className={uiInputField}
              value={form.proxyId}
              onChange={(e) => setForm((f) => ({ ...f, proxyId: e.target.value }))}
            >
              <option value="">— None —</option>
              {proxies.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.provider} · {p.host}
                  {p.port ? `:${p.port}` : ''}
                </option>
              ))}
            </select>
          </label>
          <label className={uiLabel}>
            Status
            <select
              className={uiInputField}
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as ProfileStatus }))}
            >
              {profileStatuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Modal>
    </div>
  )
}
