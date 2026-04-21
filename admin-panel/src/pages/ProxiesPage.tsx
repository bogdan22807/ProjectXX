import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { checkboxClass, fieldClass } from '../components/ui/field-classes'
import { EmptyState } from '../components/ui/EmptyState'
import { Modal } from '../components/ui/Modal'
import { ProxyStatusLine } from '../components/ProxyStatusLine'
import { useAppState } from '../context/AppState'

/** POST /api/proxies: provider, host, port, username, password, proxy_scheme */
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
    proxyScheme: 'http' as 'http' | 'socks5',
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

  const schemeForApi = form.proxyScheme === 'socks5' ? 'socks5' : 'http'

  const canSubmit = Boolean(form.host.trim() && form.port.trim())

  async function submitAdd() {
    if (!canSubmit) return
    await addProxy({
      provider: form.provider.trim(),
      host: form.host.trim(),
      port: form.port.trim(),
      username: form.username.trim(),
      password: form.password.trim(),
      proxyScheme: schemeForApi,
    })
    closeAddModal()
    setForm({
      provider: '',
      host: '',
      port: '',
      username: '',
      password: '',
      proxyScheme: 'http',
    })
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
              description="Укажите host и port, при необходимости — логин и пароль."
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
                      <ProxyStatusLine proxy={p} />
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
        title="Новый прокси"
        onClose={closeAddModal}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={closeAddModal}>
              Отмена
            </Button>
            <Button variant="primary" onClick={() => void submitAdd()} disabled={!canSubmit}>
              Сохранить
            </Button>
          </div>
        }
      >
        <div className="space-y-3 text-sm text-zinc-300">
          <p className="text-xs text-zinc-500">
            Для Playwright обычно выбирайте <strong className="text-zinc-300">http</strong>. SOCKS5 с логином в
            Chromium может не поддерживаться.
          </p>
          <label className="block text-xs font-medium text-zinc-400">
            Схема (proxy_scheme)
            <select
              className={fieldClass}
              value={form.proxyScheme}
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
            Провайдер <span className="font-normal text-zinc-600">(необязательно)</span>
            <input
              className={fieldClass}
              value={form.provider}
              onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))}
            />
          </label>
          <label className="block text-xs font-medium text-zinc-400">
            Host <span className="text-rose-400/90">*</span>
            <input
              className={fieldClass}
              value={form.host}
              onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
              placeholder="91.228.13.48"
            />
          </label>
          <label className="block text-xs font-medium text-zinc-400">
            Port <span className="text-rose-400/90">*</span>
            <input
              className={fieldClass}
              value={form.port}
              onChange={(e) => setForm((f) => ({ ...f, port: e.target.value }))}
              placeholder="50100"
              inputMode="numeric"
            />
          </label>
          <label className="block text-xs font-medium text-zinc-400">
            Username <span className="font-normal text-zinc-600">(необязательно)</span>
            <input
              className={fieldClass}
              value={form.username}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
            />
          </label>
          <label className="block text-xs font-medium text-zinc-400">
            Password <span className="font-normal text-zinc-600">(необязательно)</span>
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
