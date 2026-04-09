/* eslint-disable react-refresh/only-export-components -- context module exports provider and hook */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react'
import { initialAccounts, initialLogs, initialProfiles, initialProxies } from '../data/mock'
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

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

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
  }) => void
  deleteSelectedAccounts: () => void
  addProxy: (input: {
    provider: string
    host: string
    port: string
    username: string
    password: string
  }) => void
  deleteSelectedProxies: () => void
  checkSelectedProxies: () => void
  addProfile: (input: {
    name: string
    proxyId: string | null
    status: ProfileStatus
  }) => void
  deleteSelectedProfiles: () => void
  startWarmupSelected: () => void
  appendLog: (action: string, details: string) => void
  /** Derived stats for dashboard */
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
  const [accounts, setAccounts] = useState<Account[]>(initialAccounts)
  const [proxies, setProxies] = useState<Proxy[]>(initialProxies)
  const [profiles, setProfiles] = useState<BrowserProfile[]>(initialProfiles)
  const [logs, setLogs] = useState<LogEntry[]>(initialLogs)
  const [settings, setSettingsState] = useState<AppSettings>({
    notifications: true,
    autoRetryFailed: false,
    strictWarmup: true,
  })

  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(new Set())
  const [selectedProxyIds, setSelectedProxyIds] = useState<Set<string>>(new Set())
  const [selectedProfileIds, setSelectedProfileIds] = useState<Set<string>>(new Set())

  const warmupTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => {
    const timers = warmupTimers.current
    return () => {
      timers.forEach((t) => clearTimeout(t))
      timers.clear()
    }
  }, [])

  const appendLog = useCallback((action: string, details: string) => {
    const entry: LogEntry = {
      id: newId('log'),
      time: new Date().toISOString(),
      action,
      details,
    }
    setLogs((prev) => [entry, ...prev].slice(0, 500))
  }, [])

  const setSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettingsState((s) => ({ ...s, ...patch }))
  }, [])

  const addAccount = useCallback(
    (input: {
      name: string
      login: string
      cookies: string
      platform: Platform
      proxyId: string | null
      profileId: string | null
      status: AccountStatus
    }) => {
      const acc: Account = {
        id: newId('acc'),
        name: input.name,
        login: input.login,
        cookies: input.cookies,
        platform: input.platform,
        proxyId: input.proxyId,
        profileId: input.profileId,
        status: input.status,
      }
      setAccounts((prev) => [acc, ...prev])
      appendLog('Add account', `Created "${acc.name}" (${acc.platform}) as ${acc.status}`)
    },
    [appendLog],
  )

  const deleteSelectedAccounts = useCallback(() => {
    if (selectedAccountIds.size === 0) return
    const ids = selectedAccountIds
    setAccounts((prev) => prev.filter((a) => !ids.has(a.id)))
    appendLog('Delete accounts', `Removed ${ids.size} account(s)`)
    setSelectedAccountIds(new Set())
  }, [selectedAccountIds, appendLog])

  const addProxy = useCallback(
    (input: {
      provider: string
      host: string
      port: string
      username: string
      password: string
    }) => {
      const proxy: Proxy = {
        id: newId('px'),
        provider: input.provider || 'SOAX',
        host: input.host,
        port: input.port,
        username: input.username,
        password: input.password,
        status: 'Needs Check',
      }
      setProxies((prev) => [proxy, ...prev])
      appendLog('Add proxy', `${proxy.provider} ${proxy.host}${proxy.port ? `:${proxy.port}` : ''}`)
    },
    [appendLog],
  )

  const deleteSelectedProxies = useCallback(() => {
    if (selectedProxyIds.size === 0) return
    const ids = selectedProxyIds
    setProxies((prev) => prev.filter((p) => !ids.has(p.id)))
    setAccounts((prev) =>
      prev.map((a) => (a.proxyId && ids.has(a.proxyId) ? { ...a, proxyId: null } : a)),
    )
    setProfiles((prev) =>
      prev.map((p) => (p.proxyId && ids.has(p.proxyId) ? { ...p, proxyId: null } : p)),
    )
    appendLog('Delete proxies', `Removed ${ids.size} proxy row(s)`)
    setSelectedProxyIds(new Set())
  }, [selectedProxyIds, appendLog])

  const checkSelectedProxies = useCallback(() => {
    if (selectedProxyIds.size === 0) return
    const nextStatus: ProxyStatus = 'Active'
    setProxies((prev) =>
      prev.map((p) => (selectedProxyIds.has(p.id) ? { ...p, status: nextStatus } : p)),
    )
    appendLog(
      'Check proxies',
      `Marked ${selectedProxyIds.size} proxy row(s) as ${nextStatus} (mock)`,
    )
  }, [selectedProxyIds, appendLog])

  const addProfile = useCallback(
    (input: { name: string; proxyId: string | null; status: ProfileStatus }) => {
      const profile: BrowserProfile = {
        id: newId('bp'),
        name: input.name,
        proxyId: input.proxyId,
        status: input.status,
      }
      setProfiles((prev) => [profile, ...prev])
      appendLog('Create profile', `Profile "${profile.name}" (${profile.status})`)
    },
    [appendLog],
  )

  const deleteSelectedProfiles = useCallback(() => {
    if (selectedProfileIds.size === 0) return
    const ids = selectedProfileIds
    setProfiles((prev) => prev.filter((p) => !ids.has(p.id)))
    setAccounts((prev) =>
      prev.map((a) => (a.profileId && ids.has(a.profileId) ? { ...a, profileId: null } : a)),
    )
    appendLog('Delete profiles', `Removed ${ids.size} profile(s)`)
    setSelectedProfileIds(new Set())
  }, [selectedProfileIds, appendLog])

  const startWarmupSelected = useCallback(() => {
    const targets = accounts.filter((a) => selectedAccountIds.has(a.id) && a.status === 'New')
    if (targets.length === 0) {
      appendLog('Start warmup', 'No selected accounts in New status (mock)')
      return
    }

    targets.forEach((acc) => {
      const existing = warmupTimers.current.get(acc.id)
      if (existing) clearTimeout(existing)

      setAccounts((prev) =>
        prev.map((a) => (a.id === acc.id ? { ...a, status: 'Running' as const } : a)),
      )
      appendLog('Start warmup', `Account "${acc.name}" → Running (mock)`)

      const t1 = setTimeout(() => {
        setAccounts((prev) =>
          prev.map((a) => (a.id === acc.id ? { ...a, status: 'Ready' as const } : a)),
        )
        appendLog('Start warmup', `Account "${acc.name}" → Ready (mock)`)
        warmupTimers.current.delete(acc.id)
      }, 1800)

      warmupTimers.current.set(acc.id, t1)
    })
  }, [accounts, selectedAccountIds, appendLog])

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
      deleteSelectedAccounts,
      addProxy,
      deleteSelectedProxies,
      checkSelectedProxies,
      addProfile,
      deleteSelectedProfiles,
      startWarmupSelected,
      appendLog,
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
      deleteSelectedAccounts,
      addProxy,
      deleteSelectedProxies,
      checkSelectedProxies,
      addProfile,
      deleteSelectedProfiles,
      startWarmupSelected,
      appendLog,
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
