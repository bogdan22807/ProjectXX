import { useState, type Dispatch, type SetStateAction } from 'react'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Modal } from '../components/ui/Modal'
import { StatusBadge } from '../components/ui/StatusBadge'
import { useAppState } from '../context/AppState'
import { formatTime } from '../utils/format'
import { accountStatusLabelRu } from '../utils/accountStatusLabels'
import type { Account, AccountStatus, Platform } from '../types/domain'

/** Unified compact actions in account table (same height) */
const tableActionBtn =
  '!h-8 !min-h-[2rem] !shrink-0 !px-2.5 !py-0 text-xs font-medium leading-none'

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
              {accountStatusLabelRu[s]}
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
    hint: string
    accent: 'violet' | 'emerald' | 'sky' | 'rose' | 'amber'
  }[] = [
    { label: 'Total accounts', value: stats.totalAccounts, hint: 'In workspace', accent: 'violet' },
    { label: 'Active', value: stats.activeAccounts, hint: 'Ready or running', accent: 'emerald' },
    { label: 'Running', value: stats.runningAccounts, hint: 'Live sessions', accent: 'sky' },
    { label: 'Errors', value: stats.errorAccounts, hint: 'Needs attention', accent: 'rose' },
    { label: 'Proxies', value: stats.totalProxies, hint: 'Configured endpoints', accent: 'amber' },
  ]

  const accentBar: Record<(typeof statCards)[number]['accent'], string> = {
    violet: 'from-violet-500/90 to-fuchsia-500/50',
    emerald: 'from-emerald-400/90 to-teal-500/40',
    sky: 'from-sky-400/80 to-blue-500/40',
    rose: 'from-rose-400/80 to-red-500/35',
    amber: 'from-amber-400/75 to-orange-500/35',
  }

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Overview</h2>
            <p className="mt-1 text-sm text-zinc-400">Fleet health at a glance</p>
          </div>
        </div>
        <div className="grid auto-rows-fr gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {statCards.map((c) => (
            <Card
              key={c.label}
              className="relative flex h-full min-h-[112px] flex-col overflow-hidden p-0"
            >
              <div
                className={`h-0.5 w-full bg-gradient-to-r ${accentBar[c.accent]} opacity-90`}
                aria-hidden
              />
              <div className="flex flex-1 flex-col justify-between p-5">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                    {c.label}
                  </p>
                  <p className="mt-3 text-3xl font-semibold tabular-nums tracking-tight text-zinc-50">
                    {c.value}
                  </p>
                </div>
                <p className="mt-4 text-xs leading-relaxed text-zinc-600">{c.hint}</p>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={() => setAddOpen(true)}>
          Add Account
        </Button>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="border-b border-zinc-800/80 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-200">Accounts</h2>
          <p className="mt-0.5 text-xs text-zinc-500">Manage all accounts from the dashboard</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] table-fixed border-collapse text-left text-sm">
            <colgroup>
              <col style={{ width: '14%' }} />
              <col style={{ width: '17%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '22%' }} />
              <col style={{ width: '17%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '10%' }} />
            </colgroup>
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-950/50 text-xs font-medium uppercase tracking-wide text-zinc-500">
                <th className="px-4 py-3.5 align-middle">Account Name</th>
                <th className="px-4 py-3.5 align-middle">Login</th>
                <th className="px-4 py-3.5 align-middle">Platform</th>
                <th className="px-4 py-3.5 align-middle">Proxy</th>
                <th className="px-4 py-3.5 align-middle">Browser Profile</th>
                <th className="px-4 py-3.5 align-middle">Status</th>
                <th className="px-4 py-3.5 align-middle">Actions</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr
                  key={a.id}
                  className="border-b border-zinc-800/60 transition-colors hover:bg-zinc-900/55"
                >
                  <td
                    className="max-w-0 truncate px-4 py-3 align-middle font-medium text-zinc-200"
                    title={a.name}
                  >
                    {a.name}
                  </td>
                  <td
                    className="max-w-0 truncate px-4 py-3 align-middle font-mono text-[13px] text-zinc-300"
                    title={a.login}
                  >
                    {a.login}
                  </td>
                  <td className="max-w-0 truncate px-4 py-3 align-middle text-zinc-400">{a.platform}</td>
                  <td
                    className="max-w-0 truncate px-4 py-3 align-middle text-[13px] text-zinc-400"
                    title={proxyLabel(a.proxyId)}
                  >
                    {proxyLabel(a.proxyId)}
                  </td>
                  <td
                    className="max-w-0 truncate px-4 py-3 align-middle text-[13px] text-zinc-400"
                    title={profileLabel(a.profileId)}
                  >
                    {profileLabel(a.profileId)}
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <StatusBadge status={a.status} label={accountStatusLabelRu[a.status]} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 align-middle">
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      {a.status === 'New' || a.status === 'Ready' ? (
                        <Button
                          className={tableActionBtn}
                          variant="primary"
                          onClick={() => startAccount(a.id)}
                        >
                          Начать
                        </Button>
                      ) : null}
                      {a.status === 'Running' ? (
                        <Button className={tableActionBtn} onClick={() => stopAccount(a.id)}>
                          Остановить
                        </Button>
                      ) : null}
                      <Button className={tableActionBtn} onClick={() => openEdit(a)}>
                        Редактировать
                      </Button>
                      <Button
                        className={tableActionBtn}
                        variant="danger"
                        onClick={() => {
                          if (confirm(`Удалить аккаунт «${a.name}»?`)) deleteAccountById(a.id)
                        }}
                      >
                        Удалить
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
        <div className="flex items-start justify-between gap-4 border-b border-zinc-800/80 bg-zinc-950/30 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Recent activity</h2>
            <p className="mt-0.5 text-xs text-zinc-500">Latest operations and state changes</p>
          </div>
          {recentLogs.length > 0 ? (
            <span className="shrink-0 rounded-full border border-zinc-700/80 bg-zinc-900/80 px-2.5 py-0.5 text-[11px] font-medium tabular-nums text-zinc-400">
              {recentLogs.length} shown
            </span>
          ) : null}
        </div>
        <div className="divide-y divide-zinc-800/50">
          {recentLogs.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <p className="text-sm font-medium text-zinc-400">No activity yet</p>
              <p className="mt-1 text-xs text-zinc-600">Actions on accounts will appear here.</p>
            </div>
          ) : (
            recentLogs.map((l) => (
              <div
                key={l.id}
                className="group flex gap-3 px-5 py-3.5 transition-colors hover:bg-zinc-900/35"
              >
                <span
                  className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-violet-500/70 ring-2 ring-violet-500/15 group-hover:bg-violet-400"
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="text-sm font-medium text-zinc-100">{l.action}</span>
                    <time
                      className="shrink-0 font-mono text-[11px] tabular-nums text-zinc-500"
                      dateTime={l.time}
                    >
                      {formatTime(l.time)}
                    </time>
                  </div>
                  <p className="mt-1.5 text-sm leading-relaxed text-zinc-500">{l.details}</p>
                </div>
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
