import type {
  Account,
  BrowserProfile,
  LogEntry,
  Proxy,
} from '../types/domain'

export const initialProxies: Proxy[] = [
  {
    id: 'p1',
    provider: 'SOAX',
    host: 'gate.soax.com',
    port: '9000',
    username: 'user-demo',
    password: '••••••••',
    status: 'Active',
  },
  {
    id: 'p2',
    provider: 'SOAX',
    host: 'res.proxy.net',
    port: '',
    username: '',
    password: '',
    status: 'Needs Check',
  },
]

export const initialProfiles: BrowserProfile[] = [
  {
    id: 'bp1',
    name: 'Chrome — US East',
    proxyId: 'p1',
    status: 'Ready',
  },
  {
    id: 'bp2',
    name: 'Chrome — Mobile',
    proxyId: 'p2',
    status: 'In Use',
  },
]

export const initialAccounts: Account[] = [
  {
    id: 'a1',
    name: 'Brand Alpha',
    login: 'brand.alpha@mail.com',
    cookies: 'session=…',
    platform: 'Twitter',
    proxyId: 'p1',
    profileId: 'bp1',
    status: 'Ready',
  },
  {
    id: 'a2',
    name: 'Growth Lab',
    login: 'growth.lab',
    cookies: '',
    platform: 'Instagram',
    proxyId: 'p2',
    profileId: 'bp2',
    status: 'Running',
  },
  {
    id: 'a3',
    name: 'Archive',
    login: 'archive.old',
    cookies: '',
    platform: 'Facebook',
    proxyId: null,
    profileId: null,
    status: 'New',
  },
  {
    id: 'a4',
    name: 'Legacy',
    login: 'legacy.err',
    cookies: '',
    platform: 'LinkedIn',
    proxyId: 'p1',
    profileId: 'bp1',
    status: 'Error',
  },
]

const now = () => new Date().toISOString()

export const initialLogs: LogEntry[] = [
  {
    id: 'l1',
    time: now(),
    action: 'System',
    details: 'Local session started (mock data loaded)',
  },
  {
    id: 'l2',
    time: now(),
    action: 'Account',
    details: 'Loaded sample accounts for UI preview',
  },
]
