import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { StatusBadge } from '../components/ui/StatusBadge'
import { useAppState } from '../context/AppState'
import type { AccountStatus, Platform } from '../types/domain'

const platforms: Platform[] = [
  'Twitter',
  'Instagram',
  'Facebook',
  'TikTok',
  'LinkedIn',
  'Other',
]

const accountStatuses: AccountStatus[] = ['New', 'Ready', 'Running', 'Error']

export function AccountsPage() {
  const {
    accounts,
    proxies,
    profiles,
    addAccount,
    deleteSelectedAccounts,
    startWarmupSelected,
    selectedAccountIds,
    setSelectedAccountIds,
  } = useAppState()

  const [userAddOpen, setUserAddOpen] = useState(false)
  const [form, setForm] = useState({
    name: '',
    login: '',
    cookies: '',
    platform: 'Twitter' as Platform,
    proxyId: '' as string,
    profileId: '' as string,
    status: 'New' as AccountStatus,
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

  function toggleRow(id: string) {
    setSelectedAccountIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (selectedAccountIds.size === accounts.length) {
      setSelectedAccountIds(new Set())
    } else {
      setSelectedAccountIds(new Set(accounts.map((a) => a.id)))
    }
  }

  function proxyLabel(id: string | null) {
    if (!id) return '—'
    const p = proxies.find((x) => x.id === id)
    return p ? `${p.provider} · ${p.host}` : '—'
  }

  function profileLabel(id: string | null) {
    if (!id) return '—'
    const bp = profiles.find((x) => x.id === id)
    return bp?.name ?? '—'
  }

  function submitAdd() {
    addAccount({
      name: form.name.trim() || 'Unnamed',
      login: form.login.trim(),
      cookies: form.cookies,
      platform: form.platform,
      proxyId: form.proxyId || null,
      profileId: form.profileId || null,
      status: form.status,
    })
    closeAddModal()
    setForm({
      name: '',
      login: '',
      cookies: '',
      platform: 'Twitter',
      proxyId: '',
      profileId: '',
      status: 'New',
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={openAddModal}>
          Add Account
        </Button>
        <Button
          variant="danger"
          disabled={selectedAccountIds.size === 0}
          onClick={deleteSelectedAccounts}
        >
          Delete
        </Button>
        <Button disabled={selectedAccountIds.size === 0} onClick={startWarmupSelected}>
          Start Warmup
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-900/30">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-950/50 text-xs uppercase tracking-wide text-zinc-500">
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    className="rounded border-zinc-600 bg-zinc-900"
                    checked={accounts.length > 0 && selectedAccountIds.size === accounts.length}
                    onChange={toggleAll}
                    aria-label="Select all"
                  />
                </th>
                <th className="px-4 py-3">ID</th>
                <th className="px-4 py-3">Account Name</th>
                <th className="px-4 py-3">Login</th>
                <th className="px-4 py-3">Platform</th>
                <th className="px-4 py-3">Proxy</th>
                <th className="px-4 py-3">Browser Profile</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/80">
              {accounts.map((a) => (
                <tr key={a.id} className="hover:bg-zinc-900/40">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      className="rounded border-zinc-600 bg-zinc-900"
                      checked={selectedAccountIds.has(a.id)}
                      onChange={() => toggleRow(a.id)}
                      aria-label={`Select ${a.name}`}
                    />
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-500">{a.id}</td>
                  <td className="px-4 py-3 font-medium text-zinc-200">{a.name}</td>
                  <td className="px-4 py-3 text-zinc-400">{a.login}</td>
                  <td className="px-4 py-3 text-zinc-400">{a.platform}</td>
                  <td className="max-w-[180px] truncate px-4 py-3 text-zinc-500" title={proxyLabel(a.proxyId)}>
                    {proxyLabel(a.proxyId)}
                  </td>
                  <td className="max-w-[160px] truncate px-4 py-3 text-zinc-500" title={profileLabel(a.profileId)}>
                    {profileLabel(a.profileId)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={a.status} />
                  </td>
                  <td className="px-4 py-3 text-zinc-600">—</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {accounts.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-zinc-500">No accounts. Add one to get started.</p>
        ) : null}
      </div>

      <Modal
        open={addOpen}
        title="Add Account"
        onClose={closeAddModal}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={closeAddModal}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submitAdd}>
              Add Account
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <label className="block text-xs font-medium text-zinc-400">
            Account Name
            <input
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none ring-violet-500/30 focus:ring-2"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </label>
          <label className="block text-xs font-medium text-zinc-400">
            Login
            <input
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none ring-violet-500/30 focus:ring-2"
              value={form.login}
              onChange={(e) => setForm((f) => ({ ...f, login: e.target.value }))}
            />
          </label>
          <label className="block text-xs font-medium text-zinc-400">
            Cookies
            <textarea
              rows={3}
              className="mt-1 w-full resize-y rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-xs text-zinc-100 outline-none ring-violet-500/30 focus:ring-2"
              value={form.cookies}
              onChange={(e) => setForm((f) => ({ ...f, cookies: e.target.value }))}
              placeholder="Paste cookie string (local only)"
            />
          </label>
          <label className="block text-xs font-medium text-zinc-400">
            Platform
            <select
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none ring-violet-500/30 focus:ring-2"
              value={form.platform}
              onChange={(e) => setForm((f) => ({ ...f, platform: e.target.value as Platform }))}
            >
              {platforms.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-medium text-zinc-400">
            Proxy
            <select
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none ring-violet-500/30 focus:ring-2"
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
            Browser Profile
            <select
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none ring-violet-500/30 focus:ring-2"
              value={form.profileId}
              onChange={(e) => setForm((f) => ({ ...f, profileId: e.target.value }))}
            >
              <option value="">— None —</option>
              {profiles.map((bp) => (
                <option key={bp.id} value={bp.id}>
                  {bp.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-medium text-zinc-400">
            Status
            <select
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none ring-violet-500/30 focus:ring-2"
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as AccountStatus }))}
            >
              {accountStatuses.map((s) => (
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
