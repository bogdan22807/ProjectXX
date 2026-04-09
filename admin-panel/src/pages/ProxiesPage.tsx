import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={openAddModal}>
          Add Proxy
        </Button>
        <Button disabled={proxies.length === 0} onClick={checkSelectedProxies}>
          Check
        </Button>
        <Button
          variant="danger"
          disabled={proxies.length === 0}
          onClick={deleteSelectedProxies}
        >
          Delete
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-900/30">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-950/50 text-xs uppercase tracking-wide text-zinc-500">
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    className="rounded border-zinc-600 bg-zinc-900"
                    checked={proxies.length > 0 && selectedProxyIds.size === proxies.length}
                    onChange={toggleAll}
                    aria-label="Select all"
                  />
                </th>
                <th className="px-4 py-3">ID</th>
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Host</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Assigned To</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/80">
              {proxies.map((p) => (
                <tr key={p.id} className="hover:bg-zinc-900/40">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      className="rounded border-zinc-600 bg-zinc-900"
                      checked={selectedProxyIds.has(p.id)}
                      onChange={() => toggleRow(p.id)}
                      aria-label={`Select ${p.host}`}
                    />
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-500">{p.id}</td>
                  <td className="px-4 py-3 text-zinc-200">{p.provider}</td>
                  <td className="px-4 py-3">
                    <span className="text-zinc-300">{p.host}</span>
                    {p.port ? (
                      <span className="text-zinc-500">:{p.port}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="px-4 py-3 text-zinc-400">{assignedTo(p.id)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {proxies.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-zinc-500">No proxies yet.</p>
        ) : null}
      </div>

      <Modal
        open={addOpen}
        title="Add Proxy"
        onClose={closeAddModal}
        footer={
          <div className="flex flex-col-reverse justify-end gap-2 sm:flex-row">
            <Button variant="ghost" onClick={closeAddModal}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submitAdd} disabled={!form.host.trim()}>
              Add Proxy
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <label className="block text-xs font-medium text-zinc-400">
            Provider
            <input
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none ring-violet-500/30 focus:ring-2"
              value={form.provider}
              onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))}
              placeholder="SOAX"
            />
          </label>
          <label className="block text-xs font-medium text-zinc-400">
            Host
            <input
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none ring-violet-500/30 focus:ring-2"
              value={form.host}
              onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
              placeholder="proxy.example.com"
              required
            />
          </label>
          <label className="block text-xs font-medium text-zinc-400">
            Port <span className="font-normal text-zinc-600">(optional)</span>
            <input
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none ring-violet-500/30 focus:ring-2"
              value={form.port}
              onChange={(e) => setForm((f) => ({ ...f, port: e.target.value }))}
              placeholder="9000"
            />
          </label>
          <label className="block text-xs font-medium text-zinc-400">
            Username <span className="font-normal text-zinc-600">(optional)</span>
            <input
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none ring-violet-500/30 focus:ring-2"
              value={form.username}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
            />
          </label>
          <label className="block text-xs font-medium text-zinc-400">
            Password <span className="font-normal text-zinc-600">(optional)</span>
            <input
              type="password"
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none ring-violet-500/30 focus:ring-2"
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
