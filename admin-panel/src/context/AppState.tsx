/* eslint-disable react-refresh/only-export-components -- context module exports provider and hook */
import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react'
import { apiDelete, apiGet, apiPatch, apiPost } from '../api/client'
import {
  accountPatchToApi,
  accountToApiBody,
  mapAccount,
  mapLog,
  mapProfile,
  mapProxy,
  type ApiAccount,
  type ApiLog,
  type ApiProfile,
  type ApiProxy,
} from '../api/mappers'
import type {
  Account,
  AccountStatus,
  AppSettings,
  BrowserProfile,
  LogEntry,
  Platform,
  ProfileStatus,
  Proxy,
  ProxyStatus,
} from '../types/domain'

interface AppStateValue {
  accounts: Account[]
  proxies: Proxy[]
  profiles: BrowserProfile[]
  logs: LogEntry[]
  settings: AppSettings
  setSettings: (patch: Partial<AppSettings>) => void
  selectedAccountIds: Set<string>
  setSelectedAccountIds: Dispatch<SetStateAction<Set<string>>>
  selectedProxyIds: Set<string>
  setSelectedProxyIds: Dispatch<SetStateAction<Set<string>>>
  selectedProfileIds: Set<string>
  setSelectedProfileIds: Dispatch<SetStateAction<Set<string>>>
  addAccount: (input: {
    name: string
    login: string
    cookies: string
    platform: Platform
    proxyId: string | null
    profileId: string | null
    status: AccountStatus
  }) => Promise<void>
  updateAccount: (id: string, patch: Partial<Omit<Account, 'id'>>) => Promise<void>
  deleteAccountById: (id: string) => Promise<void>
  startAccount: (id: string) => Promise<void>
  stopAccount: (id: string) => Promise<void>
  /** Per-account warmup request: which action is in flight */
  warmupPending: Partial<Record<string, 'start' | 'stop'>>
  deleteSelectedAccounts: () => Promise<void>
  addProxy: (input: {
    provider: string
    host: string
    port: string
    username: string
    password: string
  }) => Promise<void>
  deleteSelectedProxies: () => Promise<void>
  checkSelectedProxies: () => Promise<void>
  addProfile: (input: {
    name: string
    proxyId: string | null
    status: ProfileStatus
  }) => Promise<void>
  deleteSelectedProfiles: () => Promise<void>
  startWarmupSelected: () => Promise<void>
  appendLog: (action: string, details: string) => Promise<void>
  /** Lightweight refetch for dashboard polling (accounts + logs only) */
  refreshAccountsAndLogs: () => Promise<void>
  stats: {
    totalAccounts: number
    activeAccounts: number
    runningAccounts: number
    errorAccounts: number
    totalProxies: number
  }
}

const AppStateContext = createContext<AppStateValue | null>(null)

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [proxies, setProxies] = useState<Proxy[]>([])
  const [profiles, setProfiles] = useState<BrowserProfile[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [settings, setSettingsState] = useState<AppSettings>({
    notifications: true,
    autoRetryFailed: false,
    strictWarmup: true,
  })

  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(new Set())
  const [selectedProxyIds, setSelectedProxyIds] = useState<Set<string>>(new Set())
  const [selectedProfileIds, setSelectedProfileIds] = useState<Set<string>>(new Set())
  const [warmupPending, setWarmupPending] = useState<Partial<Record<string, 'start' | 'stop'>>>({})

  const refreshAll = useCallback(async () => {
    const [a, p, prof, l] = await Promise.all([
      apiGet<ApiAccount[]>('/accounts'),
      apiGet<ApiProxy[]>('/proxies'),
      apiGet<ApiProfile[]>('/profiles'),
      apiGet<ApiLog[]>('/logs'),
    ])
    setAccounts(a.map(mapAccount))
    setProxies(p.map(mapProxy))
    setProfiles(prof.map(mapProfile))
    setLogs(l.map(mapLog))
  }, [])

  const refreshAccountsAndLogs = useCallback(async () => {
    const [a, l] = await Promise.all([
      apiGet<ApiAccount[]>('/accounts'),
      apiGet<ApiLog[]>('/logs'),
    ])
    setAccounts(a.map(mapAccount))
    setLogs(l.map(mapLog))
  }, [])

  useEffect(() => {
    startTransition(() => {
      void refreshAll().catch((e) => console.error('Failed to load data', e))
    })
  }, [refreshAll])

  const appendLog = useCallback(async (action: string, details: string) => {
    const row = await apiPost<ApiLog>('/logs', {
      account_id: null,
      action,
      details,
    })
    setLogs((prev) => [mapLog(row), ...prev].slice(0, 500))
  }, [])

  const setSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettingsState((s) => ({ ...s, ...patch }))
  }, [])

  const addAccount = useCallback(
    async (input: {
      name: string
      login: string
      cookies: string
      platform: Platform
      proxyId: string | null
      profileId: string | null
      status: AccountStatus
    }) => {
      const row = await apiPost<ApiAccount>(
        '/accounts',
        accountToApiBody({
          name: input.name,
          login: input.login,
          cookies: input.cookies,
          platform: input.platform,
          proxyId: input.proxyId,
          profileId: input.profileId,
          status: input.status,
        }),
      )
      setAccounts((prev) => [mapAccount(row), ...prev])
      await appendLog(
        'Add account',
        `Created "${row.name}" (${row.platform}) as ${row.status}`,
      )
    },
    [appendLog],
  )

  const deleteAccountById = useCallback(
    async (id: string) => {
      const acc = accounts.find((a) => a.id === id)
      if (!acc) return
      await apiDelete(`/accounts/${id}`)
      setAccounts((prev) => prev.filter((a) => a.id !== id))
      setSelectedAccountIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      await appendLog('Delete account', `Removed "${acc.name}"`)
    },
    [accounts, appendLog],
  )

  const updateAccount = useCallback(
    async (id: string, patch: Partial<Omit<Account, 'id'>>) => {
      const acc = accounts.find((a) => a.id === id)
      if (!acc) return
      const body = accountPatchToApi(patch)
      if (Object.keys(body).length === 0) return
      const row = await apiPatch<ApiAccount>(`/accounts/${id}`, body)
      setAccounts((prev) => prev.map((a) => (a.id === id ? mapAccount(row) : a)))
      await appendLog('Update account', `Saved changes for "${acc.name}"`)
    },
    [accounts, appendLog],
  )

  const startAccount = useCallback(
    async (id: string) => {
      const acc = accounts.find((a) => a.id === id)
      if (!acc || acc.status === 'Running') return
      if (acc.status !== 'New' && acc.status !== 'Ready') return
      if (warmupPending[id]) return
      setWarmupPending((p) => ({ ...p, [id]: 'start' }))
      try {
        await apiPost<{ ok?: boolean }>('/warmup/start', { accountId: id })
        await refreshAll()
      } catch (e) {
        console.error('Warmup start failed', e)
        await refreshAll()
      } finally {
        setWarmupPending((p) => {
          const next = { ...p }
          delete next[id]
          return next
        })
      }
    },
    [accounts, warmupPending, refreshAll],
  )

  const stopAccount = useCallback(
    async (id: string) => {
      const acc = accounts.find((a) => a.id === id)
      if (!acc || acc.status !== 'Running') return
      if (warmupPending[id]) return
      setWarmupPending((p) => ({ ...p, [id]: 'stop' }))
      try {
        await apiPost<{ ok?: boolean }>('/warmup/stop', { accountId: id })
        await refreshAll()
      } catch (e) {
        console.error('Warmup stop failed', e)
        await refreshAll()
      } finally {
        setWarmupPending((p) => {
          const next = { ...p }
          delete next[id]
          return next
        })
      }
    },
    [accounts, warmupPending, refreshAll],
  )

  const deleteSelectedAccounts = useCallback(async () => {
    if (selectedAccountIds.size === 0) return
    const ids = [...selectedAccountIds]
    for (const id of ids) {
      await apiDelete(`/accounts/${id}`)
    }
    const idSet = new Set(ids)
    setAccounts((prev) => prev.filter((a) => !idSet.has(a.id)))
    await appendLog('Delete accounts', `Removed ${ids.length} account(s)`)
    setSelectedAccountIds(new Set())
  }, [selectedAccountIds, appendLog])

  const addProxy = useCallback(
    async (input: {
      provider: string
      host: string
      port: string
      username: string
      password: string
    }) => {
      const row = await apiPost<ApiProxy>('/proxies', {
        provider: input.provider || 'SOAX',
        host: input.host,
        port: input.port,
        username: input.username,
        password: input.password,
        status: 'Needs Check',
      })
      setProxies((prev) => [mapProxy(row), ...prev])
      await appendLog(
        'Add proxy',
        `${row.provider} ${row.host}${row.port ? `:${row.port}` : ''}`,
      )
    },
    [appendLog],
  )

  const deleteSelectedProxies = useCallback(async () => {
    const ids =
      selectedProxyIds.size > 0
        ? selectedProxyIds
        : new Set(proxies.map((p) => p.id))
    if (ids.size === 0) return
    for (const id of ids) {
      await apiDelete(`/proxies/${id}`)
    }
    await refreshAll()
    await appendLog('Delete proxies', `Removed ${ids.size} proxy row(s)`)
    setSelectedProxyIds(new Set())
  }, [selectedProxyIds, proxies, appendLog, refreshAll])

  const checkSelectedProxies = useCallback(async () => {
    const targetIds =
      selectedProxyIds.size > 0
        ? selectedProxyIds
        : new Set(proxies.map((p) => p.id))
    if (targetIds.size === 0) return
    const nextStatus: ProxyStatus = 'Active'
    const now = new Date().toISOString()
    for (const id of targetIds) {
      await apiPatch(`/proxies/${id}`, { status: nextStatus, last_check: now })
    }
    await refreshAll()
    await appendLog('Check proxies', `Marked ${targetIds.size} proxy row(s) as ${nextStatus}`)
  }, [selectedProxyIds, proxies, appendLog, refreshAll])

  const addProfile = useCallback(
    async (input: { name: string; proxyId: string | null; status: ProfileStatus }) => {
      const row = await apiPost<ApiProfile>('/profiles', {
        name: input.name,
        linked_proxy_id: input.proxyId,
        linked_account_id: null,
        status: input.status,
      })
      setProfiles((prev) => [mapProfile(row), ...prev])
      await appendLog('Create profile', `Profile "${row.name}" (${row.status})`)
    },
    [appendLog],
  )

  const deleteSelectedProfiles = useCallback(async () => {
    if (selectedProfileIds.size === 0) return
    const ids = [...selectedProfileIds]
    for (const id of ids) {
      await apiDelete(`/profiles/${id}`)
    }
    await refreshAll()
    await appendLog('Delete profiles', `Removed ${ids.length} profile(s)`)
    setSelectedProfileIds(new Set())
  }, [selectedProfileIds, appendLog, refreshAll])

  const startWarmupSelected = useCallback(async () => {
    const targets = accounts.filter((a) => selectedAccountIds.has(a.id) && a.status === 'New')
    if (targets.length === 0) {
      await appendLog('Start warmup', 'No selected accounts in New status')
      return
    }
    for (const acc of targets) {
      await startAccount(acc.id)
    }
  }, [accounts, selectedAccountIds, appendLog, startAccount])

  const stats = useMemo(() => {
    const totalAccounts = accounts.length
    const activeAccounts = accounts.filter((a) => a.status === 'Ready' || a.status === 'Running').length
    const runningAccounts = accounts.filter((a) => a.status === 'Running').length
    const errorAccounts = accounts.filter((a) => a.status === 'Error').length
    const totalProxies = proxies.length
    return {
      totalAccounts,
      activeAccounts,
      runningAccounts,
      errorAccounts,
      totalProxies,
    }
  }, [accounts, proxies])

  const value = useMemo<AppStateValue>(
    () => ({
      accounts,
      proxies,
      profiles,
      logs,
      settings,
      setSettings,
      selectedAccountIds,
      setSelectedAccountIds,
      selectedProxyIds,
      setSelectedProxyIds,
      selectedProfileIds,
      setSelectedProfileIds,
      addAccount,
      updateAccount,
      deleteAccountById,
      startAccount,
      stopAccount,
      warmupPending,
      deleteSelectedAccounts,
      addProxy,
      deleteSelectedProxies,
      checkSelectedProxies,
      addProfile,
      deleteSelectedProfiles,
      startWarmupSelected,
      appendLog,
      refreshAccountsAndLogs,
      stats,
    }),
    [
      accounts,
      proxies,
      profiles,
      logs,
      settings,
      setSettings,
      selectedAccountIds,
      selectedProxyIds,
      selectedProfileIds,
      addAccount,
      updateAccount,
      deleteAccountById,
      startAccount,
      stopAccount,
      warmupPending,
      deleteSelectedAccounts,
      addProxy,
      deleteSelectedProxies,
      checkSelectedProxies,
      addProfile,
      deleteSelectedProfiles,
      startWarmupSelected,
      appendLog,
      refreshAccountsAndLogs,
      stats,
    ],
  )

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
}

export function useAppState(): AppStateValue {
  const ctx = useContext(AppStateContext)
  if (!ctx) throw new Error('useAppState must be used within AppStateProvider')
  return ctx
}
