import { useState, type Dispatch, type SetStateAction } from 'react'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Modal } from '../components/ui/Modal'
import { StatusBadge } from '../components/ui/StatusBadge'
import { useAppState } from '../context/AppState'
import { formatTime } from '../utils/format'
import type { Account, AccountStatus, Platform } from '../types/domain'

const platforms: Platform[] = [
  'Twitter',
  'Instagram',
  'Facebook',
  'TikTok',
  'LinkedIn',
  'Other',
]

const accountStatuses: AccountStatus[] = ['New', 'Ready', 'Running', 'Error']

type FormState = {
  name: string
  login: string
  cookies: string
  platform: Platform
  proxyId: string
  profileId: string
  status: AccountStatus
}

const emptyForm = (): FormState => ({
  name: '',
  login: '',
  cookies: '',
  platform: 'Twitter',
  proxyId: '',
  profileId: '',
  status: 'New',
})

function formFromAccount(a: Account): FormState {
  return {
    name: a.name,
    login: a.login,
    cookies: a.cookies,
    platform: a.platform,
    proxyId: a.proxyId ?? '',
    profileId: a.profileId ?? '',
    status: a.status,
  }
}

function AccountFields({
  form,
  setForm,
  proxies,
  profiles,
}: {
  form: FormState
  setForm: Dispatch<SetStateAction<FormState>>
  proxies: { id: string; provider: string; host: string; port: string }[]
  profiles: { id: string; name: string }[]
}) {
  return (
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
  )
}

export function DashboardPage() {
  const {
    stats,
    logs,
    accounts,
    proxies,
    profiles,
    addAccount,
    updateAccount,
    deleteAccountById,
    startAccount,
    stopAccount,
  } = useAppState()

  const recentLogs = logs.slice(0, 8)

  const [addOpen, setAddOpen] = useState(false)
  const [addForm, setAddForm] = useState<FormState>(emptyForm)

  const [editOpen, setEditOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<FormState>(emptyForm)

  function openEdit(a: Account) {
    setEditId(a.id)
    setEditForm(formFromAccount(a))
    setEditOpen(true)
  }

  function closeEdit() {
    setEditOpen(false)
    setEditId(null)
  }

  function saveEdit() {
    if (!editId) return
    updateAccount(editId, {
      name: editForm.name.trim() || 'Unnamed',
      login: editForm.login.trim(),
      cookies: editForm.cookies,
      platform: editForm.platform,
      proxyId: editForm.proxyId || null,
      profileId: editForm.profileId || null,
      status: editForm.status,
    })
    closeEdit()
  }

  function submitAdd() {
    addAccount({
      name: addForm.name.trim() || 'Unnamed',
      login: addForm.login.trim(),
      cookies: addForm.cookies,
      platform: addForm.platform,
      proxyId: addForm.proxyId || null,
      profileId: addForm.profileId || null,
      status: addForm.status,
    })
    setAddOpen(false)
    setAddForm(emptyForm())
  }

  function proxyLabel(id: string | null) {
    if (!id) return '—'
    const p = proxies.find((x) => x.id === id)
    return p ? `${p.provider} · ${p.host}${p.port ? `:${p.port}` : ''}` : '—'
  }

  function profileLabel(id: string | null) {
    if (!id) return '—'
    const bp = profiles.find((x) => x.id === id)
    return bp?.name ?? '—'
  }

  const cards = [
    { label: 'Total Accounts', value: stats.totalAccounts },
    { label: 'Active', value: stats.activeAccounts },
    { label: 'Running', value: stats.runningAccounts },
    { label: 'Errors', value: stats.errorAccounts },
    { label: 'Total Proxies', value: stats.totalProxies },
  ]

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {cards.map((c) => (
          <Card key={c.label} className="p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">{c.label}</div>
            <div className="mt-2 text-2xl font-semibold tabular-nums text-zinc-100">{c.value}</div>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={() => setAddOpen(true)}>
          Add Account
        </Button>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="border-b border-zinc-800/80 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-200">Accounts</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-950/50 text-xs uppercase tracking-wide text-zinc-500">
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
                  <td className="px-4 py-3 font-medium text-zinc-200">{a.name}</td>
                  <td className="max-w-[140px] truncate px-4 py-3 text-zinc-400" title={a.login}>
                    {a.login}
                  </td>
                  <td className="px-4 py-3 text-zinc-400">{a.platform}</td>
                  <td
                    className="max-w-[200px] truncate px-4 py-3 text-zinc-500"
                    title={proxyLabel(a.proxyId)}
                  >
                    {proxyLabel(a.proxyId)}
                  </td>
                  <td
                    className="max-w-[160px] truncate px-4 py-3 text-zinc-500"
                    title={profileLabel(a.profileId)}
                  >
                    {profileLabel(a.profileId)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={a.status} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1">
                      {a.status === 'New' || a.status === 'Ready' ? (
                        <Button
                          className="!px-2 !py-1 text-xs"
                          variant="primary"
                          onClick={() => startAccount(a.id)}
                        >
                          Start
                        </Button>
                      ) : null}
                      {a.status === 'Running' ? (
                        <Button className="!px-2 !py-1 text-xs" onClick={() => stopAccount(a.id)}>
                          Stop
                        </Button>
                      ) : null}
                      <Button className="!px-2 !py-1 text-xs" onClick={() => openEdit(a)}>
                        Edit
                      </Button>
                      <Button
                        className="!px-2 !py-1 text-xs"
                        variant="danger"
                        onClick={() => {
                          if (confirm(`Delete account "${a.name}"?`)) deleteAccountById(a.id)
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {accounts.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-zinc-500">No accounts yet. Add one above.</p>
        ) : null}
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-zinc-800/80 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-200">Recent logs</h2>
        </div>
        <div className="divide-y divide-zinc-800/60">
          {recentLogs.length === 0 ? (
            <p className="px-4 py-6 text-sm text-zinc-500">No logs yet.</p>
          ) : (
            recentLogs.map((l) => (
              <div key={l.id} className="px-4 py-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-zinc-200">{l.action}</span>
                  <span className="shrink-0 text-xs text-zinc-500">{formatTime(l.time)}</span>
                </div>
                <p className="mt-1 text-zinc-500">{l.details}</p>
              </div>
            ))
          )}
        </div>
      </Card>

      <Modal
        open={addOpen}
        title="Add Account"
        onClose={() => {
          setAddOpen(false)
          setAddForm(emptyForm())
        }}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setAddOpen(false)
                setAddForm(emptyForm())
              }}
            >
              Cancel
            </Button>
            <Button variant="primary" onClick={submitAdd}>
              Save
            </Button>
          </div>
        }
      >
        <AccountFields form={addForm} setForm={setAddForm} proxies={proxies} profiles={profiles} />
      </Modal>

      <Modal
        open={editOpen}
        title="Edit Account"
        onClose={closeEdit}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={closeEdit}>
              Cancel
            </Button>
            <Button variant="primary" onClick={saveEdit}>
              Save
            </Button>
          </div>
        }
      >
        <AccountFields form={editForm} setForm={setEditForm} proxies={proxies} profiles={profiles} />
      </Modal>
    </div>
  )
}
