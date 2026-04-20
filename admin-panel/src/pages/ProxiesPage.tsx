import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { checkboxClass, fieldClass } from '../components/ui/field-classes'
import { EmptyState } from '../components/ui/EmptyState'
import { Modal } from '../components/ui/Modal'
import { StatusBadge } from '../components/ui/StatusBadge'
import { useAppState } from '../context/AppState'

/** Поля POST /api/proxies: provider, host, port, username, password, proxy_scheme, proxy_line, credential_order */
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
    provider: '',
    host: '',
    port: '',
    username: '',
    password: '',
    proxyScheme: 'http' as 'http' | 'socks5' | '',
  })
  const [pasteLine, setPasteLine] = useState('')
  const [credentialOrder, setCredentialOrder] = useState<'pass_user' | 'user_pass'>('pass_user')

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

  const schemeForApi = form.proxyScheme === 'socks5' ? 'socks5' : form.proxyScheme === 'http' ? 'http' : ''

  async function submitAdd() {
    const line = pasteLine.trim()
    if (line) {
      await addProxy({
        provider: form.provider.trim(),
        host: '',
        port: '',
        username: '',
        password: '',
        proxyScheme: schemeForApi || undefined,
        proxyLine: line,
        credentialOrder,
      })
    } else if (form.host.trim()) {
      await addProxy({
        provider: form.provider.trim(),
        host: form.host.trim(),
        port: form.port.trim(),
        username: form.username.trim(),
        password: form.password.trim(),
        proxyScheme: schemeForApi || undefined,
      })
    } else {
      return
    }
    closeAddModal()
    setForm({ provider: '', host: '', port: '', username: '', password: '', proxyScheme: 'http' })
    setPasteLine('')
  }

  async function submitAddAllLines() {
    const lines = pasteLine
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    if (lines.length === 0) return
    for (const line of lines) {
      await addProxy({
        provider: form.provider.trim(),
        host: '',
        port: '',
        username: '',
        password: '',
        proxyScheme: schemeForApi || undefined,
        proxyLine: line,
        credentialOrder,
      })
    }
    closeAddModal()
    setForm({ provider: '', host: '', port: '', username: '', password: '', proxyScheme: 'http' })
    setPasteLine('')
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={openAddModal}>
          Добавить прокси
        </Button>
        <Button disabled={proxies.length === 0} onClick={checkSelectedProxies}>
          Отметить проверенными
        </Button>
        <Button
          variant="danger"
          disabled={proxies.length === 0}
          onClick={() => setDeleteOpen(true)}
        >
          Удалить
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-900/30">
        <div className="overflow-x-auto">
          {proxies.length === 0 ? (
            <EmptyState
              title="Нет прокси"
              description="Добавьте запись: host, port, опционально логин/пароль или строка host:port:…:…"
              action={
                <Button variant="primary" onClick={openAddModal}>
                  Добавить прокси
                </Button>
              }
            />
          ) : (
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-950/50 text-xs uppercase tracking-wide text-zinc-500">
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      className={checkboxClass}
                      checked={proxies.length > 0 && selectedProxyIds.size === proxies.length}
                      onChange={toggleAll}
                      aria-label="Выбрать все"
                    />
                  </th>
                  <th className="px-4 py-3">ID</th>
                  <th className="px-4 py-3">Провайдер</th>
                  <th className="px-4 py-3">Хост:порт</th>
                  <th className="px-4 py-3">Схема</th>
                  <th className="px-4 py-3">Статус</th>
                  <th className="px-4 py-3">Аккаунт</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/80">
                {proxies.map((p) => (
                  <tr
                    key={p.id}
                    className="transition-[background-color] duration-200 ease-out hover:bg-zinc-900/40"
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        className={checkboxClass}
                        checked={selectedProxyIds.has(p.id)}
                        onChange={() => toggleRow(p.id)}
                        aria-label={`Выбрать ${p.host}`}
                      />
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-500">{p.id}</td>
                    <td className="px-4 py-3 text-zinc-200">{p.provider || '—'}</td>
                    <td className="px-4 py-3">
                      <span className="text-zinc-300">{p.host}</span>
                      {p.port ? <span className="text-zinc-500">:{p.port}</span> : null}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs uppercase text-zinc-400">
                      {p.proxyScheme?.trim() || 'http'}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={p.status} />
                    </td>
                    <td className="px-4 py-3 text-zinc-400">{assignedTo(p.id)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <Modal
        open={deleteOpen}
        title="Удалить прокси?"
        onClose={() => setDeleteOpen(false)}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
              Отмена
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                deleteSelectedProxies()
                setDeleteOpen(false)
              }}
            >
              Удалить
            </Button>
          </div>
        }
      >
        <p className="text-sm text-zinc-400">
          {selectedProxyIds.size > 0
            ? `Удалить выбранные: ${selectedProxyIds.size}. Связи аккаунтов и профилей сбросятся.`
            : 'Удалить все прокси в таблице. Связи сбросятся.'}
        </p>
      </Modal>

      <Modal
        open={addOpen}
        title="Прокси (API)"
        onClose={closeAddModal}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={closeAddModal}>
              Отмена
            </Button>
            <Button
              variant="secondary"
              onClick={() => void submitAddAllLines()}
              disabled={pasteLine.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).length < 2}
            >
              Добавить все строки
            </Button>
            <Button
              variant="primary"
              onClick={() => void submitAdd()}
              disabled={!pasteLine.trim() && !form.host.trim()}
            >
              Сохранить
            </Button>
          </div>
        }
      >
        <div className="space-y-3 text-sm text-zinc-300">
          <p className="text-xs text-zinc-500">
            Либо одна строка <code className="text-zinc-400">IPv4:port:…:…</code> (4 части), либо поля ниже.
            Порядок 3–4 сегмента задаётся переключателем. Для Playwright executor обычно нужен{' '}
            <strong className="text-zinc-300">HTTP</strong> (SOCKS5 с логином в Chromium часто не поддерживается).
          </p>
          <label className="block text-xs font-medium text-zinc-400">
            Строка (proxy_line)
            <textarea
              className={`${fieldClass} mt-1 min-h-[72px] resize-y font-mono text-xs`}
              value={pasteLine}
              onChange={(e) => setPasteLine(e.target.value)}
              placeholder="91.228.13.48:50100:takeit32:dont1"
              spellCheck={false}
            />
          </label>
          <fieldset className="space-y-1 text-xs text-zinc-400">
            <legend className="font-medium text-zinc-400">credential_order (4 части)</legend>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="credOrder"
                checked={credentialOrder === 'pass_user'}
                onChange={() => setCredentialOrder('pass_user')}
              />
              <code className="text-zinc-500">host:port:password:username</code> (SOAX)
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="credOrder"
                checked={credentialOrder === 'user_pass'}
                onChange={() => setCredentialOrder('user_pass')}
              />
              <code className="text-zinc-500">host:port:username:password</code>
            </label>
          </fieldset>
          <label className="block text-xs font-medium text-zinc-400">
            proxy_scheme
            <select
              className={fieldClass}
              value={form.proxyScheme || 'http'}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  proxyScheme: e.target.value as 'http' | 'socks5',
                }))
              }
            >
              <option value="http">http</option>
              <option value="socks5">socks5</option>
            </select>
          </label>
          <label className="block text-xs font-medium text-zinc-400">
            provider <span className="font-normal text-zinc-600">(необязательно)</span>
            <input
              className={fieldClass}
              value={form.provider}
              onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))}
            />
          </label>
          <p className="text-xs font-medium text-zinc-500">Если строка пустая — ручной ввод (host обязателен)</p>
          <label className="block text-xs font-medium text-zinc-400">
            host <span className="text-rose-400/90">*</span>
            <input
              className={fieldClass}
              value={form.host}
              onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
              placeholder="91.228.13.48"
            />
          </label>
          <label className="block text-xs font-medium text-zinc-400">
            port
            <input
              className={fieldClass}
              value={form.port}
              onChange={(e) => setForm((f) => ({ ...f, port: e.target.value }))}
              placeholder="50100"
            />
          </label>
          <label className="block text-xs font-medium text-zinc-400">
            username <span className="font-normal text-zinc-600">(необязательно)</span>
            <input
              className={fieldClass}
              value={form.username}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
            />
          </label>
          <label className="block text-xs font-medium text-zinc-400">
            password <span className="font-normal text-zinc-600">(необязательно)</span>
            <input
              type="password"
              className={fieldClass}
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
