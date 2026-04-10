import type { Account, BrowserProfile, LogEntry, Platform, Proxy } from '../types/domain'

export type ApiAccount = {
  id: string
  name: string
  login: string
  cookies: string
  platform: string
  proxy_id: string | null
  browser_profile_id: string | null
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
  status: Proxy['status']
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

const platforms: Platform[] = [
  'Twitter',
  'Instagram',
  'Facebook',
  'TikTok',
  'LinkedIn',
  'Other',
]

function asPlatform(p: string): Platform {
  return platforms.includes(p as Platform) ? (p as Platform) : 'Other'
}

export function mapAccount(row: ApiAccount): Account {
  return {
    id: row.id,
    name: row.name,
    login: row.login ?? '',
    cookies: row.cookies ?? '',
    platform: asPlatform(row.platform),
    proxyId: row.proxy_id ?? null,
    profileId: row.browser_profile_id ?? null,
    status: row.status,
  }
}

export function mapProxy(row: ApiProxy): Proxy {
  return {
    id: row.id,
    provider: row.provider ?? '',
    host: row.host,
    port: row.port ?? '',
    username: row.username ?? '',
    password: row.password ?? '',
    status: row.status,
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
  proxyId: string | null
  profileId: string | null
  status: Account['status']
}) {
  return {
    name: input.name,
    login: input.login,
    cookies: input.cookies,
    platform: input.platform,
    proxy_id: input.proxyId,
    browser_profile_id: input.profileId,
    status: input.status,
  }
}

export function accountPatchToApi(patch: Partial<Omit<Account, 'id'>>) {
  const body: Record<string, unknown> = {}
  if (patch.name !== undefined) body.name = patch.name
  if (patch.login !== undefined) body.login = patch.login
  if (patch.cookies !== undefined) body.cookies = patch.cookies
  if (patch.platform !== undefined) body.platform = patch.platform
  if (patch.proxyId !== undefined) body.proxy_id = patch.proxyId
  if (patch.profileId !== undefined) body.browser_profile_id = patch.profileId
  if (patch.status !== undefined) body.status = patch.status
  return body
}
