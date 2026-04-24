import { useState, type Dispatch, type SetStateAction } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { fieldClass, fieldClassMono } from '../components/ui/field-classes'
import { EmptyState } from '../components/ui/EmptyState'
import { Modal } from '../components/ui/Modal'
import {
  cardSectionHeaderClass,
  pageStackClass,
  tableActionButtonClass,
  tableBodyClass,
  tableCellClass,
  tableCellHeaderClass,
  tableClass,
  tableHeadRowClass,
  tableRowClass,
  tableScrollClass,
} from '../components/ui/patterns'
import { StatusBadge } from '../components/ui/StatusBadge'
import { useAppState } from '../context/AppState'
import { formatTime } from '../utils/format'
import type { Account, AccountStatus, BrowserEngine } from '../types/domain'

const accountStatuses: AccountStatus[] = [
  'New',
  'Starting',
  'Ready',
  'Running',
  'Error',
  'challenge_detected',
  'auth_required',
]

type FormState = {
  name: string
  login: string
  cookies: string
  proxyId: string
  profileId: string
  browserEngine: BrowserEngine
  status: AccountStatus
}

const emptyForm = (): FormState => ({
  name: '',
  login: '',
  cookies: '',
  proxyId: '',
  profileId: '',
  browserEngine: 'chromium',
  status: 'New',
})

function formFromAccount(a: Account): FormState {
  return {
    name: a.name,
    login: a.login,
    cookies: a.cookies,
    proxyId: a.proxyId ?? '',
    profileId: a.profileId ?? '',
    browserEngine: a.browserEngine,
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
        Имя (name)
        <input
          className={fieldClass}
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        />
      </label>
      <label className="block text-xs font-medium text-zinc-400">
        Логин (login)
        <input
          className={fieldClass}
          value={form.login}
          onChange={(e) => setForm((f) => ({ ...f, login: e.target.value }))}
        />
      </label>
      <label className="block text-xs font-medium text-zinc-400">
        Cookies
        <textarea
          rows={3}
          className={fieldClassMono}
          value={form.cookies}
          onChange={(e) => setForm((f) => ({ ...f, cookies: e.target.value }))}
          placeholder="Строка cookies"
        />
      </label>
      <p className="text-xs text-zinc-500">
        Платформа в API всегда <span className="font-mono text-zinc-400">TikTok</span> (других значений бэкенд не
        принимает).
      </p>
      <label className="block text-xs font-medium text-zinc-400">
        Прокси (proxy_id)
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
        Профиль браузера (browser_profile_id)
        <select
          className={fieldClass}
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
        Движок браузера (browser_engine)
        <select
          className={fieldClass}
          value={form.browserEngine}
          onChange={(e) =>
            setForm((f) => ({ ...f, browserEngine: e.target.value as BrowserEngine }))
          }
        >
          <option value="chromium">Chromium (Playwright)</option>
          <option value="fox">Fox / Camoufox (скоро)</option>
        </select>
      </label>
      <label className="block text-xs font-medium text-zinc-400">
        Статус
        <select
          className={fieldClass}
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
    warmupPending,
    foxProfileLoginPending,
    startFoxProfileLogin,
    testRunPending,
    startPlaywrightTestRun,
    abortPlaywrightTestRun,
  } = useAppState()

  const recentLogs = logs.slice(0, 8)

  const [addOpen, setAddOpen] = useState(false)
  const [addForm, setAddForm] = useState<FormState>(emptyForm)

  const [editOpen, setEditOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<FormState>(emptyForm)

  const [deleteConfirm, setDeleteConfirm] = useState<Account | null>(null)

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
      platform: 'TikTok',
      proxyId: editForm.proxyId || null,
      profileId: editForm.profileId || null,
      browserEngine: editForm.browserEngine,
      status: editForm.status,
    })
    closeEdit()
  }

  const [addSubmitting, setAddSubmitting] = useState(false)

  async function submitAdd() {
    if (addSubmitting) return
    setAddSubmitting(true)
    try {
      const ok = await addAccount({
        name: addForm.name.trim() || 'Unnamed',
        login: addForm.login.trim(),
        cookies: addForm.cookies,
        platform: 'TikTok',
        proxyId: addForm.proxyId || null,
        profileId: addForm.profileId || null,
        browserEngine: addForm.browserEngine,
        status: addForm.status,
      })
      if (ok) {
        setAddOpen(false)
        setAddForm(emptyForm())
      }
    } finally {
      setAddSubmitting(false)
    }
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
    <div className={pageStackClass}>
      <div className="grid auto-rows-fr gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:gap-4">
        {statCards.map((c) => (
          <Card
            key={c.label}
            className="relative flex h-full min-h-[118px] flex-col justify-between overflow-hidden p-5"
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
          Добавить аккаунт
        </Button>
      </div>

      <Card className="overflow-hidden p-0">
        <div className={cardSectionHeaderClass}>
          <h2 className="text-sm font-semibold tracking-tight text-zinc-100">Аккаунты</h2>
          <p className="mt-1 text-xs leading-relaxed text-zinc-500">
            POST /accounts, PATCH /accounts/:id · прогрев: POST /warmup/start|stop · Fox login:
            POST /warmup/fox-profile-login · тест: POST /warmup/test-run
          </p>
        </div>
        <div className={tableScrollClass}>
          {accounts.length === 0 ? (
            <EmptyState
              title="Нет аккаунтов"
              description="Добавьте первый аккаунт. Данные сохраняются на сервере (SQLite) и подтягиваются после перезагрузки."
              action={
                <Button variant="primary" onClick={() => setAddOpen(true)}>
                  Добавить аккаунт
                </Button>
              }
            />
          ) : (
          <table className={`${tableClass} min-w-[1180px] table-fixed border-collapse`}>
            <colgroup>
              <col className="w-[14%]" />
              <col className="w-[15%]" />
              <col className="w-[9%]" />
              <col className="w-[9%]" />
              <col className="w-[18%]" />
              <col className="w-[13%]" />
              <col className="w-[9%]" />
              <col className="w-[13%]" />
            </colgroup>
            <thead>
              <tr className={tableHeadRowClass}>
                <th className={tableCellHeaderClass}>Аккаунт</th>
                <th className={tableCellHeaderClass}>Логин</th>
                <th className={tableCellHeaderClass}>Платф.</th>
                <th className={tableCellHeaderClass}>Движок</th>
                <th className={tableCellHeaderClass}>Прокси</th>
                <th className={tableCellHeaderClass}>Профиль</th>
                <th className={tableCellHeaderClass}>Статус</th>
                <th className={`${tableCellHeaderClass} text-right`}>Действия</th>
              </tr>
            </thead>
            <tbody className={tableBodyClass}>
              {accounts.map((a) => (
                <tr key={a.id} className={tableRowClass}>
                  <td className={tableCellClass}>
                    <div className="min-w-0 font-medium text-zinc-200">
                      <span className="block truncate" title={a.name}>
                        {a.name}
                      </span>
                    </div>
                  </td>
                  <td className={`${tableCellClass} text-zinc-400`}>
                    <div className="min-w-0">
                      <span className="block truncate font-mono text-[13px] leading-snug" title={a.login}>
                        {a.login || '—'}
                      </span>
                    </div>
                  </td>
                  <td className={`${tableCellClass} text-zinc-400`}>
                    <span className="block truncate" title={a.platform}>
                      {a.platform}
                    </span>
                  </td>
                  <td className={`${tableCellClass} text-zinc-400`}>
                    <span
                      className="block truncate font-mono text-[12px] uppercase"
                      title={a.browserEngine}
                    >
                      {a.browserEngine}
                    </span>
                  </td>
                  <td className={`${tableCellClass} text-zinc-400`}>
                    <div className="min-w-0">
                      <span
                        className="block truncate text-[13px] leading-snug text-zinc-400"
                        title={proxyLabel(a.proxyId)}
                      >
                        {proxyLabel(a.proxyId)}
                      </span>
                    </div>
                  </td>
                  <td className={`${tableCellClass} text-zinc-400`}>
                    <div className="min-w-0">
                      <span
                        className="block truncate text-[13px] leading-snug"
                        title={profileLabel(a.profileId)}
                      >
                        {profileLabel(a.profileId)}
                      </span>
                    </div>
                  </td>
                  <td className={tableCellClass}>
                    <StatusBadge status={a.status}>
                      {a.status === 'New' && 'Новая'}
                      {a.status === 'Starting' && 'Запуск'}
                      {a.status === 'Ready' && 'Готово'}
                      {a.status === 'Running' && 'Работает'}
                      {a.status === 'Error' && 'Ошибка'}
                      {a.status === 'challenge_detected' && 'Капча'}
                      {a.status === 'auth_required' && 'Нужен вход'}
                    </StatusBadge>
                  </td>
                  <td className={`${tableCellClass} text-right`}>
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      {a.status === 'New' ||
                      a.status === 'Ready' ||
                      a.status === 'challenge_detected' ||
                      a.status === 'auth_required' ? (
                        <Button
                          className={tableActionButtonClass}
                          variant="primary"
                          disabled={warmupPending[a.id] === 'start'}
                          onClick={() => startAccount(a.id)}
                          title="Запуск в фоне (headless), без отдельного окна браузера"
                        >
                          {warmupPending[a.id] === 'start' ? 'Запуск…' : 'Прогрев'}
                        </Button>
                      ) : null}
                      {a.status === 'Running' || a.status === 'Starting' ? (
                        <Button
                          className={tableActionButtonClass}
                          disabled={warmupPending[a.id] === 'stop'}
                          onClick={() => stopAccount(a.id)}
                        >
                          {warmupPending[a.id] === 'stop' ? 'Остановка…' : 'Стоп прогрева'}
                        </Button>
                      ) : null}
                      <Button
                        className={`${tableActionButtonClass} ${
                          a.status === 'challenge_detected'
                            ? 'border-amber-500/80 bg-amber-950/90 text-amber-100 shadow-[0_0_0_1px_rgba(245,158,11,0.35)] hover:bg-amber-900/90 hover:border-amber-400/80'
                            : ''
                        }`}
                        variant="secondary"
                        disabled={
                          testRunPending[a.id] === true ||
                          a.status === 'Running' ||
                          a.status === 'Starting'
                        }
                        title={
                          a.status === 'challenge_detected'
                            ? 'Обнаружена капча — откройте окно браузера и пройдите проверку вручную'
                            : a.status === 'Running' || a.status === 'Starting'
                              ? 'Сначала остановите прогрев — иначе Playwright уже занят'
                              : 'Видимый браузер (headed) для ручной проверки'
                        }
                        onClick={() => void startPlaywrightTestRun(a.id, { headless: false })}
                      >
                        {testRunPending[a.id] ? 'Тест…' : 'Тест Playwright'}
                      </Button>
                      <Button
                        className={tableActionButtonClass}
                        variant="ghost"
                        onClick={() => void abortPlaywrightTestRun(a.id)}
                        title="POST /warmup/test-run/abort"
                      >
                        Стоп теста
                      </Button>
                      {a.browserEngine === 'fox' ? (
                        <Button
                          className={tableActionButtonClass}
                          variant="secondary"
                          disabled={
                            foxProfileLoginPending[a.id] === true ||
                            a.status === 'Running' ||
                            a.status === 'Starting'
                          }
                          title="Camoufox: окно для ручного входа в TikTok (профиль на диске)"
                          onClick={() => void startFoxProfileLogin(a.id)}
                        >
                          {foxProfileLoginPending[a.id] ? 'Fox…' : 'Open Fox for login'}
                        </Button>
                      ) : null}
                      <Button
                        className={tableActionButtonClass}
                        onClick={() => openEdit(a)}
                      >
                        Изменить
                      </Button>
                      <Button
                        className={tableActionButtonClass}
                        variant="danger"
                        onClick={() => setDeleteConfirm(a)}
                      >
                        Удалить
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          )}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div
          className={`flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4 ${cardSectionHeaderClass}`}
        >
          <div>
            <h2 className="text-sm font-semibold tracking-tight text-zinc-100">Recent activity</h2>
            <p className="mt-0.5 text-xs text-zinc-500">Latest operations and system events</p>
          </div>
          <Link
            to="/logs"
            className="shrink-0 rounded-md text-xs font-medium text-violet-400/90 outline-none transition-colors duration-200 hover:text-violet-300 focus-visible:ring-2 focus-visible:ring-violet-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0c0e14]"
          >
            View all logs →
          </Link>
        </div>
        <div className="p-4">
          {recentLogs.length === 0 ? (
            <EmptyState
              className="py-12"
              title="Событий пока нет"
              description="Здесь появятся действия после работы с аккаунтами и настройками."
            />
          ) : (
            <ul className="space-y-1">
              {recentLogs.map((l) => (
                <li key={l.id}>
                  <div className="group rounded-lg px-3 py-3 transition-[background-color] duration-200 ease-out hover:bg-zinc-800/35">
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
        title="Аккаунт"
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
              Отмена
            </Button>
            <Button variant="primary" disabled={addSubmitting} onClick={() => void submitAdd()}>
              {addSubmitting ? 'Сохранение…' : 'Сохранить'}
            </Button>
          </div>
        }
      >
        <AccountFields form={addForm} setForm={setAddForm} proxies={proxies} profiles={profiles} />
      </Modal>

      <Modal
        open={deleteConfirm !== null}
        title="Удалить аккаунт?"
        onClose={() => setDeleteConfirm(null)}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleteConfirm(null)}>
              Отмена
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (deleteConfirm) {
                  deleteAccountById(deleteConfirm.id)
                  setDeleteConfirm(null)
                }
              }}
            >
              Удалить
            </Button>
          </div>
        }
      >
        {deleteConfirm ? (
          <p className="text-sm text-zinc-400">
            Аккаунт{' '}
            <span className="font-medium text-zinc-200">«{deleteConfirm.name}»</span> будет удалён
            без возможности восстановления.
          </p>
        ) : null}
      </Modal>

      <Modal
        open={editOpen}
        title="Аккаунт"
        onClose={closeEdit}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={closeEdit}>
              Отмена
            </Button>
            <Button variant="primary" onClick={saveEdit}>
              Сохранить
            </Button>
          </div>
        }
      >
        <AccountFields form={editForm} setForm={setEditForm} proxies={proxies} profiles={profiles} />
      </Modal>
    </div>
  )
}
