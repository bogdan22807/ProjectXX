import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { checkboxClass, fieldClass } from '../components/ui/field-classes'
import { EmptyState } from '../components/ui/EmptyState'
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
  /** Paste SOAX export: IP:port:password:username (one or many lines) */
  const [pasteLine, setPasteLine] = useState('')
  /** SOAX list = pass before user; many tools use user before pass */
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

  function submitAdd() {
    const line = pasteLine.trim()
    if (line) {
      addProxy({
        provider: form.provider.trim() || 'SOAX',
        host: '',
        port: '',
        username: '',
        password: '',
        proxyLine: line,
        credentialOrder,
      })
    } else if (form.host.trim()) {
      addProxy({
        provider: form.provider.trim() || 'SOAX',
        host: form.host.trim(),
        port: form.port.trim(),
        username: form.username.trim(),
        password: form.password.trim(),
      })
    } else {
      return
    }
    closeAddModal()
    setForm({ provider: 'SOAX', host: '', port: '', username: '', password: '' })
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
        provider: form.provider.trim() || 'SOAX',
        host: '',
        port: '',
        username: '',
        password: '',
        proxyLine: line,
        credentialOrder,
      })
    }
    closeAddModal()
    setForm({ provider: 'SOAX', host: '', port: '', username: '', password: '' })
    setPasteLine('')
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
          onClick={() => setDeleteOpen(true)}
        >
          Delete
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-900/30">
        <div className="overflow-x-auto">
          {proxies.length === 0 ? (
            <EmptyState
              title="Нет прокси"
              description="Добавьте прокси или импортируйте список позже."
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
            ? `Будет удалено выбранных строк: ${selectedProxyIds.size}. Связи с аккаунтами и профилями будут сброшены.`
            : 'Будут удалены все прокси в списке. Связи с аккаунтами и профилями будут сброшены.'}
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
            <Button
              variant="primary"
              onClick={submitAdd}
              disabled={!pasteLine.trim() && !form.host.trim()}
            >
              Add Proxy
            </Button>
            <Button
              variant="secondary"
              onClick={() => void submitAddAllLines()}
              disabled={pasteLine.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).length < 2}
            >
              Add all lines
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="rounded-lg border border-amber-900/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-100/90">
            <strong className="text-amber-200">SOAX из списка:</strong> формат строки{' '}
            <code className="rounded bg-zinc-950 px-1">IP:порт:пароль:логин</code> (сначала пароль, потом логин).
            Выбери порядок ниже или вставь строку целиком — поля заполнятся на сервере.
          </div>
          <label className="block text-xs font-medium text-zinc-400">
            Вставить строку прокси <span className="font-normal text-zinc-500">(опционально)</span>
            <textarea
              className={`${fieldClass} mt-1 min-h-[72px] resize-y font-mono text-xs`}
              value={pasteLine}
              onChange={(e) => setPasteLine(e.target.value)}
              placeholder="91.246.222.146:50100:dont1:takeit32"
              spellCheck={false}
            />
          </label>
          <fieldset className="space-y-1 text-xs text-zinc-400">
            <legend className="font-medium text-zinc-400">Порядок логина и пароля в строке</legend>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="credOrder"
                checked={credentialOrder === 'pass_user'}
                onChange={() => setCredentialOrder('pass_user')}
              />
              SOAX: <code className="text-zinc-500">host:port:password:username</code>
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="credOrder"
                checked={credentialOrder === 'user_pass'}
                onChange={() => setCredentialOrder('user_pass')}
              />
              Обычный: <code className="text-zinc-500">host:port:username:password</code>
            </label>
          </fieldset>
          <label className="block text-xs font-medium text-zinc-400">
            Provider
            <input
              className={fieldClass}
              value={form.provider}
              onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))}
              placeholder="SOAX"
            />
          </label>
          <label className="block text-xs font-medium text-zinc-400">
            Host
            <input
              className={fieldClass}
              value={form.host}
              onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
              placeholder="или вставь строку выше"
            />
          </label>
          <label className="block text-xs font-medium text-zinc-400">
            Port <span className="font-normal text-zinc-600">(optional)</span>
            <input
              className={fieldClass}
              value={form.port}
              onChange={(e) => setForm((f) => ({ ...f, port: e.target.value }))}
              placeholder="9000"
            />
          </label>
          <label className="block text-xs font-medium text-zinc-400">
            Username <span className="font-normal text-zinc-600">(optional)</span>
            <input
              className={fieldClass}
              value={form.username}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
            />
          </label>
          <label className="block text-xs font-medium text-zinc-400">
            Password <span className="font-normal text-zinc-600">(optional)</span>
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
