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

export function ProxiesPage() {
  const {
    proxies,
    accounts,
    addProxy,
    deleteSelectedProxies,
    checkSelectedProxies,
    selectedProxyIds,
    setSelectedProxyIds,
  } = useAppState()

  const [userAddOpen, setUserAddOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [form, setForm] = useState({
    provider: 'SOAX',
    host: '',
    port: '',
    username: '',
    password: '',
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

  function assignedTo(proxyId: string): string {
    const acc = accounts.find((a) => a.proxyId === proxyId)
    return acc ? acc.name : '—'
  }

  function toggleRow(id: string) {
    setSelectedProxyIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (selectedProxyIds.size === proxies.length) {
      setSelectedProxyIds(new Set())
    } else {
      setSelectedProxyIds(new Set(proxies.map((p) => p.id)))
    }
  }

  function confirmDelete() {
    deleteSelectedProxies()
    setDeleteConfirmOpen(false)
  }

  function submitAdd() {
    if (!form.host.trim()) return
    addProxy({
      provider: form.provider.trim() || 'SOAX',
      host: form.host.trim(),
      port: form.port.trim(),
      username: form.username.trim(),
      password: form.password.trim(),
    })
    closeAddModal()
    setForm({ provider: 'SOAX', host: '', port: '', username: '', password: '' })
  }

  return (
    <div className={uiPageStack}>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={openAddModal}>
          Add Proxy
        </Button>
        <Button disabled={selectedProxyIds.size === 0} onClick={checkSelectedProxies}>
          Проверить
        </Button>
        <Button
          variant="danger"
          disabled={selectedProxyIds.size === 0}
          onClick={() => setDeleteConfirmOpen(true)}
        >
          Удалить
        </Button>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className={`${uiTable} min-w-[720px]`}>
            <thead>
              <tr className={uiTableHeadRow}>
                <th className={`${uiTableTh} w-12`}>
                  <input
                    type="checkbox"
                    className={uiTableCheckbox}
                    checked={proxies.length > 0 && selectedProxyIds.size === proxies.length}
                    onChange={toggleAll}
                    aria-label="Select all"
                  />
                </th>
                <th className={uiTableTh}>ID</th>
                <th className={uiTableTh}>Provider</th>
                <th className={uiTableTh}>Host</th>
                <th className={uiTableTh}>Status</th>
                <th className={uiTableTh}>Assigned To</th>
              </tr>
            </thead>
            <tbody>
              {proxies.map((p) => (
                <tr key={p.id} className={uiTableBodyRow}>
                  <td className={uiTableTd}>
                    <input
                      type="checkbox"
                      className={uiTableCheckbox}
                      checked={selectedProxyIds.has(p.id)}
                      onChange={() => toggleRow(p.id)}
                      aria-label={`Select ${p.host}`}
                    />
                  </td>
                  <td className={`${uiTableTd} font-mono text-xs text-zinc-500`}>{p.id}</td>
                  <td className={`${uiTableTd} text-zinc-200`}>{p.provider}</td>
                  <td className={uiTableTd}>
                    <span className="text-zinc-300">{p.host}</span>
                    {p.port ? (
                      <span className="text-zinc-500">:{p.port}</span>
                    ) : null}
                  </td>
                  <td className={uiTableTd}>
                    <StatusBadge status={p.status} />
                  </td>
                  <td className={`${uiTableTd} text-zinc-400`}>{assignedTo(p.id)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {proxies.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-zinc-500">No proxies yet.</p>
        ) : null}
      </Card>

      <Modal
        open={deleteConfirmOpen}
        title="Удалить прокси"
        onClose={() => setDeleteConfirmOpen(false)}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleteConfirmOpen(false)}>
              Отмена
            </Button>
            <Button variant="danger" onClick={confirmDelete}>
              Удалить
            </Button>
          </div>
        }
      >
        <p className="text-sm leading-relaxed text-zinc-400">
          Удалить выбранные прокси ({selectedProxyIds.size})? Связи с аккаунтами и профилями будут сброшены.
        </p>
      </Modal>

      <Modal
        open={addOpen}
        title="Add Proxy"
        onClose={closeAddModal}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={closeAddModal}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submitAdd} disabled={!form.host.trim()}>
              Add Proxy
            </Button>
          </div>
        }
      >
        <div className={uiFormStack}>
          <label className={uiLabel}>
            Provider
            <input
              className={uiInputField}
              value={form.provider}
              onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))}
              placeholder="SOAX"
            />
          </label>
          <label className={uiLabel}>
            Host
            <input
              className={uiInputField}
              value={form.host}
              onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
              placeholder="proxy.example.com"
              required
            />
          </label>
          <label className={uiLabel}>
            Port <span className="font-normal text-zinc-600">(optional)</span>
            <input
              className={uiInputField}
              value={form.port}
              onChange={(e) => setForm((f) => ({ ...f, port: e.target.value }))}
              placeholder="9000"
            />
          </label>
          <label className={uiLabel}>
            Username <span className="font-normal text-zinc-600">(optional)</span>
            <input
              className={uiInputField}
              value={form.username}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
            />
          </label>
          <label className={uiLabel}>
            Password <span className="font-normal text-zinc-600">(optional)</span>
            <input
              type="password"
              className={uiInputField}
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              autoComplete="new-password"
            />
          </label>
        </div>
      </Modal>
    </div>
  )
}
