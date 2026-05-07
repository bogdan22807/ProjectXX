import type {
  Account,
  AccountType,
  BrowserEngine,
  BrowserProfile,
  LogEntry,
  MobileAccountMode,
  Platform,
  Proxy,
} from '../types/domain'

export type ApiAccount = {
  id: string
  name: string
  login: string
  cookies: string
  platform: string
  account_type?: string
  proxy_id: string | null
  browser_profile_id: string | null
  browser_engine?: string
  mobile_mode?: string
  mode?: string
  device_id?: string | null
  emulator_name?: string | null
  emulator_index?: string | null
  status: Account['status']
  created_at?: string
}

export type ApiProxy = {
  id: string
  provider: string
  host: string
  port: string
  username: string
  password: string
  proxy_scheme?: string
  status: Proxy['status']
  check_result?: string
  assigned_to?: string
  last_check?: string | null
  created_at?: string
}

export type ApiProfile = {
  id: string
  name: string
  linked_proxy_id: string | null
  linked_account_id: string | null
  status: BrowserProfile['status']
  created_at?: string
}

export type ApiLog = {
  id: string
  account_id: string | null
  action: string
  details: string
  created_at: string
}

function asPlatform(_p: string): Platform {
  return 'TikTok'
}

function asBrowserEngine(raw: string | undefined): BrowserEngine {
  const s = String(raw ?? '').trim().toLowerCase()
  return s === 'fox' ? 'fox' : 'chromium'
}

function asAccountType(raw: string | undefined): AccountType {
  const s = String(raw ?? '').trim().toLowerCase()
  return s === 'mobile' ? 'mobile' : 'browser'
}

function asMobileMode(raw: string | undefined): MobileAccountMode {
  const s = String(raw ?? '').trim().toLowerCase()
  return s === 'manual' ? 'manual' : 'mumu'
}

export function mapAccount(row: ApiAccount): Account {
  return {
    id: row.id,
    name: row.name,
    login: row.login ?? '',
    cookies: row.cookies ?? '',
    platform: asPlatform(row.platform),
    accountType: asAccountType(row.account_type),
    mode: asMobileMode(row.mobile_mode ?? row.mode),
    proxyId: row.proxy_id ?? null,
    profileId: row.browser_profile_id ?? null,
    browserEngine: asBrowserEngine(row.browser_engine),
    deviceId: row.device_id ?? null,
    emulatorName: row.emulator_name ?? null,
    emulatorIndex: row.emulator_index ?? null,
    status: row.status,
  }
}

function normalizeProxyStatus(raw: string | undefined): Proxy['status'] {
  const s = String(raw ?? '').trim()
  const allowed = new Set([
    'unknown',
    'checking',
    'ok',
    'auth_failed',
    'timeout',
    'network',
    'bad_request',
  ])
  if (allowed.has(s)) return s as Proxy['status']
  if (s === 'Active') return 'ok'
  if (s === 'Needs Check') return 'unknown'
  if (s === 'Dead') return 'network'
  return 'unknown'
}

export function mapProxy(row: ApiProxy): Proxy {
  return {
    id: row.id,
    provider: row.provider ?? '',
    host: row.host,
    port: row.port ?? '',
    username: row.username ?? '',
    password: row.password ?? '',
    proxyScheme: row.proxy_scheme ?? '',
    status: normalizeProxyStatus(row.status),
    checkResult: row.check_result ?? '',
  }
}

export function mapProfile(row: ApiProfile): BrowserProfile {
  return {
    id: row.id,
    name: row.name,
    proxyId: row.linked_proxy_id ?? null,
    status: row.status,
  }
}

export function mapLog(row: ApiLog): LogEntry {
  return {
    id: row.id,
    time: row.created_at,
    action: row.action,
    details: row.details ?? '',
  }
}

export function accountToApiBody(input: {
  name: string
  login: string
  cookies: string
  platform: Platform
  accountType?: AccountType
  mode?: MobileAccountMode
  proxyId: string | null
  profileId: string | null
  browserEngine: BrowserEngine
  deviceId?: string | null
  emulatorName?: string | null
  emulatorIndex?: string | null
  status: Account['status']
}) {
  return {
    name: input.name,
    login: input.login,
    cookies: input.cookies,
    platform: input.platform,
    account_type: input.accountType ?? 'browser',
    mobile_mode: input.mode ?? 'mumu',
    proxy_id: input.proxyId,
    browser_profile_id: input.profileId,
    browser_engine: input.browserEngine,
    device_id: input.deviceId ?? null,
    emulator_name: input.emulatorName ?? null,
    emulator_index: input.emulatorIndex ?? null,
    status: input.status,
  }
}

export function accountPatchToApi(patch: Partial<Omit<Account, 'id'>>) {
  const body: Record<string, unknown> = {}
  if (patch.name !== undefined) body.name = patch.name
  if (patch.login !== undefined) body.login = patch.login
  if (patch.cookies !== undefined) body.cookies = patch.cookies
  if (patch.platform !== undefined) body.platform = patch.platform
  if (patch.accountType !== undefined) body.account_type = patch.accountType
  if (patch.mode !== undefined) body.mobile_mode = patch.mode
  if (patch.proxyId !== undefined) body.proxy_id = patch.proxyId
  if (patch.profileId !== undefined) body.browser_profile_id = patch.profileId
  if (patch.browserEngine !== undefined) body.browser_engine = patch.browserEngine
  if (patch.deviceId !== undefined) body.device_id = patch.deviceId
  if (patch.emulatorName !== undefined) body.emulator_name = patch.emulatorName
  if (patch.emulatorIndex !== undefined) body.emulator_index = patch.emulatorIndex
  if (patch.status !== undefined) body.status = patch.status
  return body
}
