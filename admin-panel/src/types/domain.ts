export type AccountStatus =
  | 'New'
  | 'Starting'
  | 'Ready'
  | 'Running'
  | 'Error'
  /** TikTok captcha / verify — run stopped; open visible test browser to solve manually */
  | 'challenge_detected'

/** Stored in DB `proxies.status` — human labels in UI */
export type ProxyStatus =
  | 'unknown'
  | 'checking'
  | 'ok'
  | 'auth_failed'
  | 'timeout'
  | 'network'
  | 'bad_request'

export type ProfileStatus = 'Ready' | 'In Use' | 'Error'

export type Platform = 'TikTok'

export interface Account {
  id: string
  name: string
  login: string
  cookies: string
  platform: Platform
  proxyId: string | null
  profileId: string | null
  status: AccountStatus
}

export interface Proxy {
  id: string
  provider: string
  host: string
  port: string
  username: string
  password: string
  /** http | https | socks5 | socks4 — empty = http */
  proxyScheme: string
  status: ProxyStatus
  /** JSON: { outboundIp?: string } or { error?, message? } */
  checkResult: string
}

export interface BrowserProfile {
  id: string
  name: string
  proxyId: string | null
  status: ProfileStatus
}

export interface LogEntry {
  id: string
  time: string
  action: string
  details: string
}
