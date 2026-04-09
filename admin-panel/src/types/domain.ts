export type AccountStatus = 'New' | 'Ready' | 'Running' | 'Error'

export type ProxyStatus = 'Active' | 'Needs Check' | 'Dead'

export type ProfileStatus = 'Ready' | 'In Use' | 'Error'

/** Extend when more platforms are enabled in the UI */
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
  status: ProxyStatus
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

export interface AppSettings {
  notifications: boolean
  autoRetryFailed: boolean
  strictWarmup: boolean
}
