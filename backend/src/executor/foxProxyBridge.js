/**
 * Playwright `proxy` → same shape for Fox bridge / saved["proxy"] (server + optional username/password).
 * Supports http/https with auth in fields or embedded in server URL (normalized to separate fields).
 */

import {
  describeLaunchProxySafe,
  describeProxyForLog,
  formatProxyDiagnosticDetail,
  proxySchemeForDiagnostics,
} from './proxyConfig.js'

/** @typedef {{ host?: unknown, port?: unknown, username?: unknown, password?: unknown, provider?: unknown, proxy_scheme?: unknown }} FoxProxyRow */

const HTTP_SCHEMES = new Set(['http', 'https'])

/**
 * @param {string} server
 * @returns {{ protocol: string; bare: string; user: string; pass: string } | null}
 */
function parseProxyServerUrl(server) {
  const s = String(server ?? '').trim()
  if (!s) return null
  try {
    const u = new URL(s)
    const protocol = u.protocol.replace(':', '').toLowerCase()
    const port = u.port || ''
    const user = u.username ? decodeURIComponent(u.username) : ''
    const pass = u.password ? decodeURIComponent(u.password) : ''
    u.username = ''
    u.password = ''
    const host = u.hostname
    if (!host) return null
    const path = u.pathname && u.pathname !== '/' ? u.pathname : ''
    const hostPart = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
    const bare = `${protocol}://${hostPart}${port ? `:${port}` : ''}${path}`
    return { protocol, bare, user, pass }
  } catch {
    return null
  }
}

/**
 * Normalize Node Playwright proxy to Fox/Camoufox expected dict (only server / username / password).
 * @param {import('playwright').LaunchOptions['proxy'] | null | undefined} proxy
 * @returns {{ normalized: import('playwright').LaunchOptions['proxy'] | null; note?: string }}
 */
export function normalizePlaywrightProxyForFox(proxy) {
  if (proxy == null) return { normalized: null }
  if (typeof proxy !== 'object') return { normalized: null, note: 'proxy_not_object' }
  const serverRaw = String(/** @type {{ server?: unknown }} */ (proxy).server ?? '').trim()
  if (!serverRaw) return { normalized: null, note: 'missing_server' }

  let username =
    /** @type {{ username?: unknown }} */ (proxy).username != null
      ? String(/** @type {{ username?: unknown }} */ (proxy).username).trim()
      : ''
  let password =
    /** @type {{ password?: unknown }} */ (proxy).password != null
      ? String(/** @type {{ password?: unknown }} */ (proxy).password).trim()
      : ''

  const parsed = parseProxyServerUrl(serverRaw)
  if (!parsed) return { normalized: null, note: 'invalid_server_url' }

  if (!HTTP_SCHEMES.has(parsed.protocol)) {
    /** @type {import('playwright').LaunchOptions['proxy']} */
    const passthrough = { server: serverRaw }
    if (username) passthrough.username = username
    if (password) passthrough.password = password
    return { normalized: passthrough, note: `scheme_${parsed.protocol}_passed_through` }
  }

  let server = serverRaw
  if (!username && parsed.user) username = parsed.user
  if (!password && parsed.pass) password = parsed.pass
  if (parsed.user || parsed.pass) {
    server = parsed.bare
  }

  /** @type {import('playwright').LaunchOptions['proxy']} */
  const out = { server }
  if (username) out.username = username
  if (password) out.password = password
  const note = parsed.user || parsed.pass ? 'stripped_embedded_server_creds' : undefined
  return { normalized: out, ...(note ? { note } : {}) }
}

/**
 * @param {string} accountId
 * @param {(id: string, action: string, details?: string) => void} logStep
 * @param {{
 *   proxySource: 'database' | 'env' | 'none'
 *   proxyRow: FoxProxyRow | null | undefined
 *   launchProxy: import('playwright').LaunchOptions['proxy'] | null | undefined
 * }} meta
 */
export function logFoxProxyDiagnostics(accountId, logStep, meta) {
  const { proxySource, proxyRow, launchProxy } = meta
  const src =
    proxySource === 'database' || proxySource === 'env' || proxySource === 'none' ? proxySource : 'none'
  logStep(accountId, 'FOX_PROXY_SOURCE', src)

  const scheme = launchProxy?.server
    ? proxySchemeForDiagnostics(proxyRow, launchProxy)
    : 'none'
  logStep(accountId, 'FOX_PROXY_SCHEME', scheme)

  const hasUser = launchProxy?.username != null && String(launchProxy.username).trim() !== ''
  const hasPass = launchProxy?.password != null && String(launchProxy.password).trim() !== ''
  const authMode = hasUser && hasPass ? 'username_password' : hasUser ? 'username_only' : 'none'
  logStep(accountId, 'FOX_PROXY_AUTH_MODE', authMode)

  const detail = launchProxy
    ? formatProxyDiagnosticDetail(launchProxy)
    : 'server=(none) user=(omitted)'
  logStep(accountId, 'FOX_PROXY_DETAIL', detail)

  if (launchProxy?.server && proxyRow && src === 'database') {
    logStep(accountId, 'FOX_PROXY_DETAIL_VERBOSE', describeProxyForLog(proxyRow, launchProxy))
  } else if (launchProxy?.server) {
    logStep(
      accountId,
      'FOX_PROXY_DETAIL_VERBOSE',
      describeLaunchProxySafe(launchProxy, {
        provider: src === 'env' ? 'env' : String(proxyRow?.provider ?? '').trim() || '(none)',
      }),
    )
  }
}
