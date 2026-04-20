import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { checkboxClass, fieldClass } from '../components/ui/field-classes'
import { EmptyState } from '../components/ui/EmptyState'
import { Modal } from '../components/ui/Modal'
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

  const [deleteOpen, setDeleteOpen] = useState(false)

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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={openAddModal}>
          Создать профиль
        </Button>
        <Button
          variant="danger"
          disabled={selectedProfileIds.size === 0}
          onClick={() => setDeleteOpen(true)}
        >
          Delete
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-900/30">
        <div className="overflow-x-auto">
          {profiles.length === 0 ? (
            <EmptyState
              title="Нет профилей"
              description="Создайте профиль браузера и привяжите к нему прокси."
              action={
                <Button variant="primary" onClick={openAddModal}>
                  Создать профиль
                </Button>
              }
            />
          ) : (
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-950/50 text-xs uppercase tracking-wide text-zinc-500">
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    className={checkboxClass}
                    checked={profiles.length > 0 && selectedProfileIds.size === profiles.length}
                    onChange={toggleAll}
                    aria-label="Select all"
                  />
                </th>
                <th className="px-4 py-3">ID</th>
                <th className="px-4 py-3">Profile Name</th>
                <th className="px-4 py-3">Linked Proxy</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/80">
              {profiles.map((bp) => (
                <tr
                  key={bp.id}
                  className="transition-[background-color] duration-200 ease-out hover:bg-zinc-900/40"
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      className={checkboxClass}
                      checked={selectedProfileIds.has(bp.id)}
                      onChange={() => toggleRow(bp.id)}
                      aria-label={`Select ${bp.name}`}
                    />
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-500">{bp.id}</td>
                  <td className="px-4 py-3 font-medium text-zinc-200">{bp.name}</td>
                  <td className="max-w-[220px] truncate px-4 py-3 text-zinc-400" title={proxyLabel(bp.proxyId)}>
                    {proxyLabel(bp.proxyId)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={bp.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          )}
        </div>
      </div>

      <Modal
        open={deleteOpen}
        title="Удалить профили?"
        onClose={() => setDeleteOpen(false)}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
              Отмена
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                deleteSelectedProfiles()
                setDeleteOpen(false)
              }}
            >
              Удалить
            </Button>
          </div>
        }
      >
        <p className="text-sm text-zinc-400">
          Будет удалено профилей: {selectedProfileIds.size}. Связи с аккаунтами будут сброшены.
        </p>
      </Modal>

      <Modal
        open={addOpen}
        title="Профиль (POST /profiles)"
        onClose={closeAddModal}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={closeAddModal}>
              Отмена
            </Button>
            <Button variant="primary" onClick={submitAdd}>
              Сохранить
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <label className="block text-xs font-medium text-zinc-400">
            name
            <input
              className={fieldClass}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </label>
          <label className="block text-xs font-medium text-zinc-400">
            linked_proxy_id
            <select
              className={fieldClass}
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
          <label className="block text-xs font-medium text-zinc-400">
            status
            <select
              className={fieldClass}
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
