import { useState, type Dispatch, type SetStateAction } from 'react'
import { Link } from 'react-router-dom'
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

  const statCards: {
    label: string
    value: number
    accent: 'violet' | 'emerald' | 'sky' | 'rose' | 'amber'
  }[] = [
    { label: 'Total Accounts', value: stats.totalAccounts, accent: 'violet' },
    { label: 'Active', value: stats.activeAccounts, accent: 'emerald' },
    { label: 'Running', value: stats.runningAccounts, accent: 'sky' },
    { label: 'Errors', value: stats.errorAccounts, accent: 'rose' },
    { label: 'Total Proxies', value: stats.totalProxies, accent: 'amber' },
  ]

  const accentBar: Record<(typeof statCards)[number]['accent'], string> = {
    violet: 'bg-violet-500/80',
    emerald: 'bg-emerald-500/80',
    sky: 'bg-sky-500/80',
    rose: 'bg-rose-500/80',
    amber: 'bg-amber-500/80',
  }

  const accentGlow: Record<(typeof statCards)[number]['accent'], string> = {
    violet: 'from-violet-500/15',
    emerald: 'from-emerald-500/12',
    sky: 'from-sky-500/12',
    rose: 'from-rose-500/12',
    amber: 'from-amber-500/12',
  }

  return (
    <div className="space-y-6">
      <div className="grid auto-rows-fr gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:gap-4">
        {statCards.map((c) => (
          <Card
            key={c.label}
            className="relative flex h-full min-h-[118px] flex-col justify-between overflow-hidden p-5 ring-1 ring-inset ring-white/[0.04]"
          >
            <div
              className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${accentGlow[c.accent]} to-transparent opacity-90`}
              aria-hidden
            />
            <div
              className={`absolute left-0 top-0 h-full w-[3px] ${accentBar[c.accent]}`}
              aria-hidden
            />
            <div className="relative pl-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                {c.label}
              </p>
              <p
                className={`mt-3 text-3xl font-semibold tracking-tight tabular-nums ${
                  c.accent === 'rose' && c.value > 0 ? 'text-rose-100' : 'text-zinc-50'
                }`}
              >
                {c.value}
              </p>
            </div>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={() => setAddOpen(true)}>
          Add Account
        </Button>
      </div>

      <Card className="overflow-hidden p-0 ring-1 ring-inset ring-white/[0.03]">
        <div className="border-b border-zinc-800/80 bg-zinc-950/25 px-5 py-4">
          <h2 className="text-sm font-semibold tracking-tight text-zinc-100">Accounts</h2>
          <p className="mt-1 text-xs leading-relaxed text-zinc-500">
            Manage all accounts from the dashboard
          </p>
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

      <Card className="overflow-hidden ring-1 ring-inset ring-white/[0.03]">
        <div className="flex flex-col gap-1 border-b border-zinc-800/80 bg-zinc-950/25 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div>
            <h2 className="text-sm font-semibold tracking-tight text-zinc-100">Recent activity</h2>
            <p className="mt-0.5 text-xs text-zinc-500">Latest operations and system events</p>
          </div>
          <Link
            to="/logs"
            className="shrink-0 text-xs font-medium text-violet-400/90 transition hover:text-violet-300"
          >
            View all logs →
          </Link>
        </div>
        <div className="p-2">
          {recentLogs.length === 0 ? (
            <p className="px-3 py-10 text-center text-sm text-zinc-500">No logs yet.</p>
          ) : (
            <ul className="space-y-1">
              {recentLogs.map((l) => (
                <li key={l.id}>
                  <div className="group rounded-lg px-3 py-3 transition-colors hover:bg-zinc-800/35">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center rounded-md border border-zinc-700/80 bg-zinc-900/60 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-zinc-300">
                            {l.action}
                          </span>
                        </div>
                        <p className="mt-2 text-sm leading-snug text-zinc-400">{l.details}</p>
                      </div>
                      <time
                        dateTime={l.time}
                        className="shrink-0 rounded-md bg-zinc-950/80 px-2 py-1 font-mono text-[10px] tabular-nums text-zinc-500 ring-1 ring-zinc-800/80"
                      >
                        {formatTime(l.time)}
                      </time>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
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
