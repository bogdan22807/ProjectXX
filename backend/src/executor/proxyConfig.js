/**
 * Normalize DB proxy rows into Playwright launch `proxy` option.
 * @typedef {{ host?: unknown, port?: unknown, username?: unknown, password?: unknown, provider?: unknown }} ProxyLike
 */

const PLAYWRIGHT_SCHEMES = new Set(['http', 'https', 'socks4', 'socks5'])

/**
 * Scheme for proxy server when host has no explicit scheme.
 * SOAX often uses HTTP CONNECT; override with PLAYWRIGHT_PROXY_SCHEME=socks5 if needed.
 */
function defaultSchemeForProvider(provider) {
  const fromEnv = String(process.env.PLAYWRIGHT_PROXY_SCHEME ?? '').trim().toLowerCase()
  if (fromEnv && PLAYWRIGHT_SCHEMES.has(fromEnv)) return fromEnv
  void provider
  return 'http'
}

/** Many HTTP proxies expect auth in the proxy URL; separate username/password can yield 407 in Chromium. */
function embedAuthInServerUrl() {
  const v = String(process.env.PLAYWRIGHT_PROXY_EMBED_AUTH_IN_URL ?? '1').trim().toLowerCase()
  return v !== '0' && v !== 'false' && v !== 'off' && v !== 'no'
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
  const provider = String(proxy.provider ?? '').trim()

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
    : defaultSchemeForProvider(provider.toLowerCase())

  const hostPart = hostForProxyServerUrl(hostname)
  let server = port ? `${scheme}://${hostPart}:${port}` : `${scheme}://${hostPart}`

  /** @type {import('playwright').LaunchOptions['proxy']} */
  const out = { server }
  const canEmbed =
    embedAuthInServerUrl() &&
    username &&
    password &&
    (scheme === 'http' || scheme === 'https')

  if (canEmbed) {
    const u = encodeURIComponent(username)
    const pw = encodeURIComponent(password)
    server = port
      ? `${scheme}://${u}:${pw}@${hostPart}:${port}`
      : `${scheme}://${u}:${pw}@${hostPart}`
    out.server = server
    return out
  }

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
export function describeProxyForLog(proxy, launchProxy) {
  if (!proxy || !launchProxy?.server) {
    return 'proxy: none'
  }
  const u = String(proxy.username ?? '').trim()
  const hasUser = Boolean(u)
  const hasPass = Boolean(String(proxy.password ?? '').trim())
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
    hasUser && hasPass && !launchProxy.username && !launchProxy.password
      ? 'credentials embedded in server URL'
      : 'username/password fields'
  return `proxy server=${serverForLog} auth=${hasUser ? `user=${u}` : 'none'}${hasPass ? ' password=***' : ''} (${mode})`
}
