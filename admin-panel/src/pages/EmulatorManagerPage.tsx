import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { fieldClass } from '../components/ui/field-classes'
import { Modal } from '../components/ui/Modal'
import { pageStackClass } from '../components/ui/patterns'
import { StatusBadge } from '../components/ui/StatusBadge'
import { useAppState } from '../context/AppState'
import type { Account, EmulatorFarmStatus, FarmEmulator, ProxyStatus } from '../types/domain'

function statusBadgeStatus(s: EmulatorFarmStatus): 'ok' | 'unknown' | 'network' {
  if (s === 'online') return 'ok'
  if (s === 'busy') return 'unknown'
  return 'network'
}

export function EmulatorManagerPage() {
  const {
    emulators,
    refreshEmulators,
    syncEmulators,
    createFarmEmulator,
    launchFarmEmulator,
    shutdownFarmEmulator,
    openFarmEmulatorWindow,
    bindFarmEmulator,
    accounts,
    lastError,
    dismissLastError,
  } = useAppState()

  const [addOpen, setAddOpen] = useState(false)
  const [addName, setAddName] = useState('')
  const [addMumu, setAddMumu] = useState('')
  const [addBusy, setAddBusy] = useState(false)

  const [bindEmu, setBindEmu] = useState<FarmEmulator | null>(null)
  const [bindAccountId, setBindAccountId] = useState('')
  const [bindBusy, setBindBusy] = useState(false)

  const [actionBusy, setActionBusy] = useState<Record<string, string>>({})

  useEffect(() => {
    void refreshEmulators()
    const t = window.setInterval(() => {
      void refreshEmulators()
    }, 4000)
    return () => window.clearInterval(t)
  }, [refreshEmulators])

  const mobileAccounts = accounts.filter((a) => a.accountType === 'mobile')

  const setEmuBusy = useCallback((id: string, label: string | null) => {
    setActionBusy((prev) => {
      const next = { ...prev }
      if (label == null) delete next[id]
      else next[id] = label
      return next
    })
  }, [])

  async function onSync() {
    await syncEmulators()
  }

  async function onAdd() {
    if (addBusy) return
    setAddBusy(true)
    try {
      await createFarmEmulator(addName.trim(), addMumu.trim())
      setAddOpen(false)
      setAddName('')
      setAddMumu('')
    } finally {
      setAddBusy(false)
    }
  }

  async function onBind() {
    if (!bindEmu || bindBusy) return
    const acc = bindAccountId.trim()
    if (!acc) return
    setBindBusy(true)
    try {
      await bindFarmEmulator(bindEmu.id, acc)
      setBindEmu(null)
      setBindAccountId('')
    } finally {
      setBindBusy(false)
    }
  }

  return (
    <div className={pageStackClass}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-zinc-100">Emulator Manager</h1>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-zinc-500">
            Ферма MuMu: устройства из <span className="font-mono text-zinc-400">adb devices</span>, без ручного ввода
            serial. Привяжите аккаунт к карточке эмулятора после появления ADB.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void refreshEmulators()}>
            Обновить
          </Button>
          <Button variant="secondary" onClick={() => void onSync()}>
            Синхронизировать
          </Button>
          <Button variant="primary" onClick={() => setAddOpen(true)}>
            Добавить эмулятор
          </Button>
          <Link
            to="/"
            className="inline-flex items-center rounded-lg border border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-900"
          >
            ← Аккаунты
          </Link>
        </div>
      </div>

      {lastError ? (
        <div className="rounded-lg border border-rose-900/40 bg-rose-950/30 px-3 py-2 text-sm text-rose-100">
          <span>{lastError}</span>{' '}
          <button type="button" className="text-rose-300 underline" onClick={dismissLastError}>
            скрыть
          </button>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {emulators.length === 0 ? (
          <Card className="p-6 text-sm text-zinc-500">
            Нет записей эмуляторов. Нажмите «Добавить эмулятор», затем «Запустить» — ADB serial подставится автоматически
            после появления в <span className="font-mono">adb devices</span>.
          </Card>
        ) : (
          emulators.map((e) => {
            const busy = actionBusy[e.id]
            const linkedLabel =
              e.linkedAccountId != null && String(e.linkedAccountId).trim() !== ''
                ? `${e.linkedAccountName ?? e.linkedAccountId}${
                    e.linkedAccountLogin ? ` (${e.linkedAccountLogin})` : ''
                  }`
                : null
            return (
              <Card key={e.id} className="flex flex-col gap-3 p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-zinc-100">{e.emulatorName}</p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      MuMu: <span className="font-mono text-zinc-400">{e.mumuInstanceName}</span>
                    </p>
                  </div>
                  <StatusBadge status={statusBadgeStatus(e.status) as ProxyStatus}>{e.status}</StatusBadge>
                </div>
                <dl className="space-y-1.5 text-xs text-zinc-400">
                  <div>
                    <dt className="text-zinc-600">ADB Serial</dt>
                    <dd className="font-mono text-zinc-200">{e.adbSerial?.trim() ? e.adbSerial : '— ожидание'}</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-600">Аккаунт</dt>
                    <dd className="truncate text-zinc-200">{linkedLabel ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-600">last_seen</dt>
                    <dd className="font-mono text-zinc-500">
                      {e.lastSeen ? new Date(e.lastSeen).toLocaleString() : '—'}
                    </dd>
                  </div>
                </dl>
                {busy ? <p className="text-xs text-amber-200/90">{busy}…</p> : null}
                <div className="mt-auto flex flex-wrap gap-2">
                  <Button
                    variant="primary"
                    className="text-xs"
                    disabled={!!busy}
                    onClick={async () => {
                      setEmuBusy(e.id, 'Запуск')
                      try {
                        await launchFarmEmulator(e.id)
                        await refreshEmulators()
                      } finally {
                        setEmuBusy(e.id, null)
                      }
                    }}
                  >
                    Запустить
                  </Button>
                  <Button
                    variant="secondary"
                    className="text-xs"
                    disabled={!!busy}
                    onClick={async () => {
                      setEmuBusy(e.id, 'Выключение')
                      try {
                        await shutdownFarmEmulator(e.id)
                        await refreshEmulators()
                      } finally {
                        setEmuBusy(e.id, null)
                      }
                    }}
                  >
                    Выключить
                  </Button>
                  <Button
                    variant="secondary"
                    className="text-xs"
                    disabled={!!busy}
                    onClick={async () => {
                      setEmuBusy(e.id, 'Окно')
                      try {
                        await openFarmEmulatorWindow(e.id)
                      } finally {
                        setEmuBusy(e.id, null)
                      }
                    }}
                  >
                    Открыть
                  </Button>
                  <Button
                    variant="ghost"
                    className="text-xs"
                    disabled={!!busy || !e.adbSerial}
                    onClick={() => {
                      setBindEmu(e)
                      setBindAccountId('')
                    }}
                  >
                    Привязать аккаунт
                  </Button>
                </div>
              </Card>
            )
          })
        )}
      </div>

      <Modal
        open={addOpen}
        title="Новый эмулятор"
        onClose={() => setAddOpen(false)}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAddOpen(false)}>
              Отмена
            </Button>
            <Button
              variant="primary"
              disabled={addBusy || !addName.trim() || !addMumu.trim()}
              onClick={() => void onAdd()}
            >
              {addBusy ? 'Сохранение…' : 'Сохранить'}
            </Button>
          </div>
        }
      >
        <div className="space-y-3 text-xs">
          <label className="block font-medium text-zinc-400">
            Имя (например telegram_acc_1)
            <input className={fieldClass} value={addName} onChange={(ev) => setAddName(ev.target.value)} />
          </label>
          <label className="block font-medium text-zinc-400">
            MuMu instance (например MuMuPlayer-2 или индекс ВМ)
            <input className={fieldClass} value={addMumu} onChange={(ev) => setAddMumu(ev.target.value)} />
          </label>
        </div>
      </Modal>

      <Modal
        open={bindEmu !== null}
        title="Привязать mobile-аккаунт"
        onClose={() => setBindEmu(null)}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setBindEmu(null)}>
              Отмена
            </Button>
            <Button variant="primary" disabled={bindBusy || !bindAccountId} onClick={() => void onBind()}>
              {bindBusy ? '…' : 'Привязать'}
            </Button>
          </div>
        }
      >
        {bindEmu ? (
          <div className="space-y-3 text-xs text-zinc-400">
            <p>
              Эмулятор: <span className="font-medium text-zinc-200">{bindEmu.emulatorName}</span> · ADB:{' '}
              <span className="font-mono text-zinc-300">{bindEmu.adbSerial}</span>
            </p>
            <label className="block font-medium text-zinc-400">
              Аккаунт
              <select
                className={fieldClass}
                value={bindAccountId}
                onChange={(ev) => setBindAccountId(ev.target.value)}
              >
                <option value="">— выберите —</option>
                {mobileAccounts.map((a: Account) => (
                  <option key={a.id} value={a.id}>
                    {a.name} {a.login ? `· ${a.login}` : ''}
                  </option>
                ))}
              </select>
            </label>
            {mobileAccounts.length === 0 ? (
              <p className="text-rose-300">Нет mobile-аккаунтов. Создайте аккаунт на главной.</p>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
