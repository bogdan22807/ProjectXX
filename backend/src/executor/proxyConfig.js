/**
 * Normalize DB proxy rows into Playwright launch `proxy` option.
 * @typedef {{ host?: unknown, port?: unknown, username?: unknown, password?: unknown, provider?: unknown, proxy_scheme?: unknown }} ProxyLike
 */

const PLAYWRIGHT_SCHEMES = new Set(['http', 'https', 'socks4', 'socks5'])

/** Resolved Playwright proxy scheme (http / socks5 / …) for logs and diagnostics. */
export function resolvePlaywrightProxyScheme(proxy) {
  return schemeFromRow(proxy)
}

/**
 * Scheme label for logs: DB row when present, otherwise parsed from `launchProxy.server`.
 * @param {ProxyLike | null | undefined} proxyRow
 * @param {import('playwright').LaunchOptions['proxy'] | null | undefined} launchProxy
 */
export function proxySchemeForDiagnostics(proxyRow, launchProxy) {
  if (proxyRow && String(proxyRow.host ?? '').trim()) {
    return resolvePlaywrightProxyScheme(proxyRow)
  }
  const server = String(launchProxy?.server ?? '').trim()
  if (!server) return 'http'
  try {
    const u = new URL(server)
    const p = u.protocol.replace(':', '').toLowerCase()
    if (PLAYWRIGHT_SCHEMES.has(p)) return p
  } catch {
    /* ignore */
  }
  return 'http'
}

function schemeFromRow(proxy) {
  const fromCol = String(proxy?.proxy_scheme ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
  if (fromCol === 'socks5' || fromCol === 'socks4' || fromCol === 'http' || fromCol === 'https') {
    return fromCol
  }
  const fromEnv = String(process.env.PLAYWRIGHT_PROXY_SCHEME ?? '').trim().toLowerCase()
  if (fromEnv && PLAYWRIGHT_SCHEMES.has(fromEnv)) return fromEnv
  const prov = String(proxy?.provider ?? '').toLowerCase()
  if (prov.includes('socks')) return 'socks5'
  return 'http'
}

/**
 * Hostname may be IPv6 (::). URL.hostname returns IPv6 without brackets.
 * @param {string} hostname
 */
function hostForProxyServerUrl(hostname) {
  if (!hostname) return ''
  if (hostname.includes(':')) return `[${hostname}]`
  return hostname
}

/**
 * Parse host (+ optional port / credentials) from form / DB and build Playwright proxy config.
 * @param {ProxyLike | null | undefined} proxy
 * @returns {import('playwright').LaunchOptions['proxy'] | undefined}
 */
export function buildPlaywrightProxyConfig(proxy) {
  if (!proxy) return undefined

  let rawHost = String(proxy.host ?? '').trim()
  const rawPort = String(proxy.port ?? '').trim()
  let username = String(proxy.username ?? '').trim()
  let password = String(proxy.password ?? '').trim()
  if (!rawHost) return undefined

  let explicitScheme = ''
  let parsedFromUrl = null

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(rawHost)) {
    try {
      const u = new URL(rawHost)
      explicitScheme = u.protocol.replace(':', '').toLowerCase()
      parsedFromUrl = u
      rawHost = u.hostname + (u.pathname && u.pathname !== '/' ? u.pathname : '')
    } catch {
      return undefined
    }
  } else {
    try {
      parsedFromUrl = new URL(`http://${rawHost}`)
    } catch {
      return undefined
    }
  }

  const hostname = parsedFromUrl.hostname
  if (!hostname) return undefined

  let port = rawPort
  if (!port && parsedFromUrl.port) {
    port = parsedFromUrl.port
  }

  if (!username && parsedFromUrl.username) {
    username = decodeURIComponent(parsedFromUrl.username)
  }
  if (!password && parsedFromUrl.password) {
    password = decodeURIComponent(parsedFromUrl.password)
  }

  const scheme = explicitScheme && PLAYWRIGHT_SCHEMES.has(explicitScheme)
    ? explicitScheme
    : schemeFromRow(proxy)

  const hostPart = hostForProxyServerUrl(hostname)
  const server = port ? `${scheme}://${hostPart}:${port}` : `${scheme}://${hostPart}`

  /** @type {import('playwright').LaunchOptions['proxy']} */
  const out = { server }
  if (username || password) {
    if (username) out.username = username
    if (password) out.password = password
  }
  return out
}

/**
 * Safe log line (no password). For executor logs.
 * @param {ProxyLike | null | undefined} proxy
 * @param {import('playwright').LaunchOptions['proxy'] | undefined} launchProxy
 */
/**
 * Mask username for logs (never log password).
 * @param {string | undefined} username
 */
export function maskProxyUsernameForLog(username) {
  const u = String(username ?? '').trim()
  if (!u) return '(omitted)'
  if (u.length <= 2) return '***'
  return `${u.slice(0, 2)}***${u.slice(-1)}`
}

/**
 * Safe one-line description of the Playwright `proxy` object passed to launch (no password).
 * @param {import('playwright').LaunchOptions['proxy'] | null | undefined} launchProxy
 * @param {{ provider?: string }} [meta]
 */
export function describeLaunchProxySafe(launchProxy, meta = {}) {
  const provider = String(meta.provider ?? '').trim() || '(none)'
  if (!launchProxy?.server) {
    return `provider=${provider} server=(none) user=(omitted)`
  }
  let serverForLog = launchProxy.server
  try {
    const parsed = new URL(serverForLog)
    if (parsed.username || parsed.password) {
      parsed.username = ''
      parsed.password = ''
      serverForLog = parsed.toString().replace(/\/$/, '')
    }
  } catch {
    /* keep raw server string */
  }
  const userField = launchProxy.username
  const userSafe =
    userField != null && String(userField).trim()
      ? `user=${maskProxyUsernameForLog(String(userField))}`
      : 'user=(omitted)'
  return `provider=${provider} server=${serverForLog} ${userSafe}`
}

/**
 * One-line diagnostic for logs (no password): `server=http://host:port user=ma***ed`
 * @param {import('playwright').LaunchOptions['proxy'] | null | undefined} launchProxy
 */
export function formatProxyDiagnosticDetail(launchProxy) {
  if (!launchProxy?.server) {
    return 'server=(none) user=(omitted)'
  }
  let serverForLog = launchProxy.server
  try {
    const parsed = new URL(serverForLog)
    if (parsed.username || parsed.password) {
      parsed.username = ''
      parsed.password = ''
      serverForLog = parsed.toString().replace(/\/$/, '')
    }
  } catch {
    /* keep */
  }
  const u = launchProxy.username != null ? String(launchProxy.username).trim() : ''
  const userPart = u ? `user=${maskProxyUsernameForLog(u)}` : 'user=(omitted)'
  return `server=${serverForLog} ${userPart}`
}

export function describeProxyForLog(proxy, launchProxy) {
  if (!proxy || !launchProxy?.server) {
    return 'proxy: none'
  }
  const u = String(launchProxy.username ?? proxy.username ?? '').trim()
  const hasUser = Boolean(u)
  const hasPass = Boolean(String(launchProxy.password ?? proxy.password ?? '').trim())
  let serverForLog = launchProxy.server
  try {
    const parsed = new URL(serverForLog)
    if (parsed.username || parsed.password) {
      parsed.username = ''
      parsed.password = ''
      serverForLog = parsed.toString().replace(/\/$/, '')
    }
  } catch {
    /* keep raw */
  }
  const mode =
    launchProxy.username || launchProxy.password
      ? 'username/password fields'
      : 'no auth'
  return `proxy server=${serverForLog} auth=${hasUser ? `user=${u}` : 'none'}${hasPass ? ' password=***' : ''} (${mode})`
}
