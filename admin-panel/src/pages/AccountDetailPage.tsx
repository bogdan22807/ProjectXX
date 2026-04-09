import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { StatusBadge } from '../components/ui/StatusBadge'
import { useAppState } from '../context/AppState'
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

function AccountEditor({ account }: { account: Account }) {
  const { proxies, profiles, updateAccount, deleteAccountById, startAccount, stopAccount } =
    useAppState()
  const navigate = useNavigate()

  const [form, setForm] = useState({
    name: account.name,
    login: account.login,
    cookies: account.cookies,
    platform: account.platform,
    proxyId: account.proxyId ?? '',
    profileId: account.profileId ?? '',
  })

  function save() {
    updateAccount(account.id, {
      name: form.name.trim() || 'Unnamed',
      login: form.login.trim(),
      cookies: form.cookies,
      platform: form.platform,
      proxyId: form.proxyId || null,
      profileId: form.profileId || null,
    })
  }

  function remove() {
    if (!confirm(`Delete account "${account.name}"?`)) return
    deleteAccountById(account.id)
    navigate('/accounts', { replace: true })
  }

  const canStart = account.status !== 'Running'
  const canStop = account.status === 'Running'

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-zinc-100">{account.name}</h2>
            <StatusBadge status={account.status} />
          </div>
          <p className="mt-1 font-mono text-xs text-zinc-500">{account.id}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" disabled={!canStart} onClick={() => startAccount(account.id)}>
            Start
          </Button>
          <Button disabled={!canStop} onClick={() => stopAccount(account.id)}>
            Stop
          </Button>
          <Button variant="danger" onClick={remove}>
            Delete
          </Button>
        </div>
      </div>

      <Card className="p-5">
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
              value={account.status}
              onChange={(e) =>
                updateAccount(account.id, { status: e.target.value as AccountStatus })
              }
            >
              {accountStatuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-6 flex justify-end border-t border-zinc-800/80 pt-4">
          <Button variant="primary" onClick={save}>
            Save changes
          </Button>
        </div>
      </Card>
    </div>
  )
}

export function AccountDetailPage() {
  const { accountId } = useParams<{ accountId: string }>()
  const { accounts } = useAppState()
  const account = accountId ? accounts.find((a) => a.id === accountId) : undefined

  if (!accountId || !account) {
    return (
      <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/30 px-6 py-12 text-center text-sm text-zinc-500">
        <p className="text-zinc-300">Account not found.</p>
        <Link to="/accounts" className="mt-3 inline-block text-violet-400 hover:text-violet-300 hover:underline">
          ← All accounts
        </Link>
      </div>
    )
  }

  return <AccountEditor key={account.id} account={account} />
}
