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
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from '../api/client'
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
  BrowserProfile,
  LogEntry,
  Platform,
  ProfileStatus,
  Proxy,
} from '../types/domain'

interface AppStateValue {
  accounts: Account[]
  proxies: Proxy[]
  profiles: BrowserProfile[]
  logs: LogEntry[]
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
  }) => Promise<boolean>
  updateAccount: (id: string, patch: Partial<Omit<Account, 'id'>>) => Promise<void>
  deleteAccountById: (id: string) => Promise<void>
  startAccount: (id: string) => Promise<void>
  stopAccount: (id: string) => Promise<void>
  /** Per-account warmup request: which action is in flight */
  warmupPending: Partial<Record<string, 'start' | 'stop'>>
  testRunPending: Partial<Record<string, boolean>>
  deleteSelectedAccounts: () => Promise<void>
  startPlaywrightTestRun: (
    accountId: string,
    options?: {
      targetUrl?: string
      readySelector?: string
      debugCheckProxy?: boolean
      debugScreenshots?: boolean
      headless?: boolean
    },
  ) => Promise<void>
  abortPlaywrightTestRun: (accountId: string) => Promise<void>
  addProxy: (input: {
    provider: string
    host: string
    port: string
    username: string
    password: string
    proxyScheme?: string
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
  lastError: string | null
  dismissLastError: () => void
  stats: {
    totalAccounts: number
    activeAccounts: number
    runningAccounts: number
    errorAccounts: number
    totalProxies: number
  }
}

const AppStateContext = createContext<AppStateValue | null>(null)

const POLL_MS = 3000

function formatApiFailure(e: unknown): string {
  if (e instanceof ApiError) return e.message
  if (e instanceof Error) return e.message
  return 'Something went wrong'
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [proxies, setProxies] = useState<Proxy[]>([])
  const [profiles, setProfiles] = useState<BrowserProfile[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])

  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(new Set())
  const [selectedProxyIds, setSelectedProxyIds] = useState<Set<string>>(new Set())
  const [selectedProfileIds, setSelectedProfileIds] = useState<Set<string>>(new Set())
  const [warmupPending, setWarmupPending] = useState<Partial<Record<string, 'start' | 'stop'>>>({})
  const [testRunPending, setTestRunPending] = useState<Partial<Record<string, boolean>>>({})
  const [lastError, setLastError] = useState<string | null>(null)

  const dismissLastError = useCallback(() => setLastError(null), [])

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

  const refreshAccountsLogsProxies = useCallback(async () => {
    const [a, p, l] = await Promise.all([
      apiGet<ApiAccount[]>('/accounts'),
      apiGet<ApiProxy[]>('/proxies'),
      apiGet<ApiLog[]>('/logs'),
    ])
    setAccounts(a.map(mapAccount))
    setProxies(p.map(mapProxy))
    setLogs(l.map(mapLog))
  }, [])

  useEffect(() => {
    startTransition(() => {
      void refreshAll().catch((e) => {
        console.error('Failed to load data', e)
        setLastError(formatApiFailure(e))
      })
    })
  }, [refreshAll])

  useEffect(() => {
    const id = window.setInterval(() => {
      void refreshAccountsLogsProxies().catch((e) => {
        console.error('Poll failed', e)
        setLastError(formatApiFailure(e))
      })
    }, POLL_MS)
    return () => window.clearInterval(id)
  }, [refreshAccountsLogsProxies])

  const appendLog = useCallback(async (action: string, details: string) => {
    try {
      const row = await apiPost<ApiLog>('/logs', {
        account_id: null,
        action,
        details,
      })
      setLogs((prev) => [mapLog(row), ...prev].slice(0, 500))
    } catch (e) {
      console.error('appendLog failed', e)
      setLastError(formatApiFailure(e))
    }
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
      try {
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
      } catch (e) {
        console.error('addAccount failed', e)
        setLastError(formatApiFailure(e))
        return false
      }
      return true
    },
    [appendLog],
  )

  const deleteAccountById = useCallback(
    async (id: string) => {
      const acc = accounts.find((a) => a.id === id)
      if (!acc) return
      try {
        await apiDelete(`/accounts/${id}`)
        setAccounts((prev) => prev.filter((a) => a.id !== id))
        setSelectedAccountIds((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
        await appendLog('Delete account', `Removed "${acc.name}"`)
      } catch (e) {
        console.error('deleteAccountById failed', e)
        setLastError(formatApiFailure(e))
      }
    },
    [accounts, appendLog],
  )

  const updateAccount = useCallback(
    async (id: string, patch: Partial<Omit<Account, 'id'>>) => {
      const acc = accounts.find((a) => a.id === id)
      if (!acc) return
      const body = accountPatchToApi(patch)
      if (Object.keys(body).length === 0) return
      try {
        const row = await apiPatch<ApiAccount>(`/accounts/${id}`, body)
        setAccounts((prev) => prev.map((a) => (a.id === id ? mapAccount(row) : a)))
        await appendLog('Update account', `Saved changes for "${acc.name}"`)
      } catch (e) {
        console.error('updateAccount failed', e)
        setLastError(formatApiFailure(e))
      }
    },
    [accounts, appendLog],
  )

  const startAccount = useCallback(
    async (id: string) => {
      const acc = accounts.find((a) => a.id === id)
      if (!acc || acc.status === 'Running' || acc.status === 'Starting') return
      if (acc.status !== 'New' && acc.status !== 'Ready') return
      if (warmupPending[id]) return
      setWarmupPending((p) => ({ ...p, [id]: 'start' }))
      try {
        await apiPost<{ ok?: boolean }>('/warmup/start', { accountId: id })
        await refreshAll()
      } catch (e) {
        console.error('Warmup start failed', e)
        setLastError(formatApiFailure(e))
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
      if (!acc || (acc.status !== 'Running' && acc.status !== 'Starting')) return
      if (warmupPending[id]) return
      setWarmupPending((p) => ({ ...p, [id]: 'stop' }))
      try {
        await apiPost<{ ok?: boolean }>('/warmup/stop', { accountId: id })
        await refreshAll()
      } catch (e) {
        console.error('Warmup stop failed', e)
        setLastError(formatApiFailure(e))
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
    try {
      for (const id of ids) {
        await apiDelete(`/accounts/${id}`)
      }
      const idSet = new Set(ids)
      setAccounts((prev) => prev.filter((a) => !idSet.has(a.id)))
      await appendLog('Delete accounts', `Removed ${ids.length} account(s)`)
      setSelectedAccountIds(new Set())
    } catch (e) {
      console.error('deleteSelectedAccounts failed', e)
      setLastError(formatApiFailure(e))
    }
  }, [selectedAccountIds, appendLog])

  const addProxy = useCallback(
    async (input: {
      provider: string
      host: string
      port: string
      username: string
      password: string
      proxyScheme?: string
    }) => {
      try {
        const body: Record<string, unknown> = {
          provider: input.provider.trim() || '',
          host: input.host,
          port: input.port,
          username: input.username,
          password: input.password,
        }
        if (input.proxyScheme?.trim()) {
          body.proxy_scheme = input.proxyScheme.trim().toLowerCase()
        }
        const row = await apiPost<ApiProxy>('/proxies', body)
        setProxies((prev) => [mapProxy(row), ...prev])
        await appendLog(
          'Add proxy',
          `${row.provider} ${row.host}${row.port ? `:${row.port}` : ''}`,
        )
      } catch (e) {
        console.error('addProxy failed', e)
        setLastError(formatApiFailure(e))
      }
    },
    [appendLog],
  )

  const deleteSelectedProxies = useCallback(async () => {
    const ids =
      selectedProxyIds.size > 0
        ? selectedProxyIds
        : new Set(proxies.map((p) => p.id))
    if (ids.size === 0) return
    try {
      for (const id of ids) {
        await apiDelete(`/proxies/${id}`)
      }
      await refreshAll()
      await appendLog('Delete proxies', `Removed ${ids.size} proxy row(s)`)
      setSelectedProxyIds(new Set())
    } catch (e) {
      console.error('deleteSelectedProxies failed', e)
      setLastError(formatApiFailure(e))
    }
  }, [selectedProxyIds, proxies, appendLog, refreshAll])

  const checkSelectedProxies = useCallback(async () => {
    const targetIds =
      selectedProxyIds.size > 0
        ? selectedProxyIds
        : new Set(proxies.map((p) => p.id))
    if (targetIds.size === 0) return
    try {
      for (const id of targetIds) {
        await apiPost(`/proxies/${id}/check`, {})
      }
      await refreshAll()
      await appendLog('Check proxies', `Started check for ${targetIds.size} proxy row(s)`)
    } catch (e) {
      console.error('checkSelectedProxies failed', e)
      setLastError(formatApiFailure(e))
    }
  }, [selectedProxyIds, proxies, appendLog, refreshAll])

  const addProfile = useCallback(
    async (input: { name: string; proxyId: string | null; status: ProfileStatus }) => {
      try {
        const row = await apiPost<ApiProfile>('/profiles', {
          name: input.name,
          linked_proxy_id: input.proxyId,
          linked_account_id: null,
          status: input.status,
        })
        setProfiles((prev) => [mapProfile(row), ...prev])
        await appendLog('Create profile', `Profile "${row.name}" (${row.status})`)
      } catch (e) {
        console.error('addProfile failed', e)
        setLastError(formatApiFailure(e))
      }
    },
    [appendLog],
  )

  const deleteSelectedProfiles = useCallback(async () => {
    if (selectedProfileIds.size === 0) return
    const ids = [...selectedProfileIds]
    try {
      for (const id of ids) {
        await apiDelete(`/profiles/${id}`)
      }
      await refreshAll()
      await appendLog('Delete profiles', `Removed ${ids.length} profile(s)`)
      setSelectedProfileIds(new Set())
    } catch (e) {
      console.error('deleteSelectedProfiles failed', e)
      setLastError(formatApiFailure(e))
    }
  }, [selectedProfileIds, appendLog, refreshAll])

  const startPlaywrightTestRun = useCallback(
    async (
      accountId: string,
      options?: {
        targetUrl?: string
        readySelector?: string
        debugCheckProxy?: boolean
        debugScreenshots?: boolean
        headless?: boolean
      },
    ) => {
      if (testRunPending[accountId]) return
      setTestRunPending((p) => ({ ...p, [accountId]: true }))
      try {
        await apiPost('/warmup/test-run', {
          accountId,
          targetUrl: options?.targetUrl,
          readySelector: options?.readySelector,
          debugCheckProxy: options?.debugCheckProxy,
          debugScreenshots: options?.debugScreenshots,
          headless: options?.headless,
        })
        await appendLog('Playwright test-run', `Запущен для аккаунта ${accountId}`)
        void refreshAccountsLogsProxies()
      } catch (e) {
        console.error('startPlaywrightTestRun failed', e)
        setLastError(formatApiFailure(e))
      } finally {
        setTestRunPending((p) => {
          const next = { ...p }
          delete next[accountId]
          return next
        })
      }
    },
    [testRunPending, appendLog, refreshAccountsLogsProxies],
  )

  const abortPlaywrightTestRun = useCallback(
    async (accountId: string) => {
      try {
        await apiPost('/warmup/test-run/abort', { accountId })
        await appendLog('Playwright test-run abort', accountId)
        void refreshAccountsLogsProxies()
      } catch (e) {
        console.error('abortPlaywrightTestRun failed', e)
        setLastError(formatApiFailure(e))
      }
    },
    [appendLog, refreshAccountsLogsProxies],
  )

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
    const activeAccounts = accounts.filter(
      (a) => a.status === 'Ready' || a.status === 'Running' || a.status === 'Starting',
    ).length
    const runningAccounts = accounts.filter(
      (a) => a.status === 'Running' || a.status === 'Starting',
    ).length
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
      testRunPending,
      deleteSelectedAccounts,
      startPlaywrightTestRun,
      abortPlaywrightTestRun,
      addProxy,
      deleteSelectedProxies,
      checkSelectedProxies,
      addProfile,
      deleteSelectedProfiles,
      startWarmupSelected,
      appendLog,
      lastError,
      dismissLastError,
      stats,
    }),
    [
      accounts,
      proxies,
      profiles,
      logs,
      selectedAccountIds,
      selectedProxyIds,
      selectedProfileIds,
      addAccount,
      updateAccount,
      deleteAccountById,
      startAccount,
      stopAccount,
      warmupPending,
      testRunPending,
      deleteSelectedAccounts,
      startPlaywrightTestRun,
      abortPlaywrightTestRun,
      addProxy,
      deleteSelectedProxies,
      checkSelectedProxies,
      addProfile,
      deleteSelectedProfiles,
      startWarmupSelected,
      appendLog,
      lastError,
      dismissLastError,
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
