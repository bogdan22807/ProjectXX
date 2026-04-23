/**
 * Single config object for one executor run (browser session + view/scroll scenario).
 * `proxy` is Playwright `BrowserContextOptions['proxy']` or null — set from DB via buildPlaywrightProxyConfig when wiring.
 */

import { buildPlaywrightProxyConfig } from './proxyConfig.js'
import { normalizeBrowserEngine } from './browserEngine.js'

const TIKTOK_START = 'https://www.tiktok.com/'

/** Env test URL only if set and not example.com (never use example.com as fallback). */
function readEnvSocialUrl() {
  const raw = process.env.SOCIAL_TEST_URL ?? process.env.TEST_SOCIAL_URL
  if (raw == null) return null
  const s = String(raw).trim()
  if (!s) return null
  try {
    if (new URL(s).hostname === 'example.com') return null
  } catch {
    return null
  }
  return s
}

function envHeadless() {
  return process.env.PLAYWRIGHT_HEADED !== '1'
}

function envPageLoadMs() {
  const n = Number(process.env.PLAYWRIGHT_GOTO_TIMEOUT_MS)
  return Number.isFinite(n) && n > 0 ? n : 60_000
}

/** Optional default proxy from env when account has no linked proxy row. */
function proxyFromEnv() {
  let server = String(process.env.PLAYWRIGHT_PROXY_SERVER ?? '').trim()
  if (!server) return null
  let username = String(process.env.PLAYWRIGHT_PROXY_USERNAME ?? '').trim()
  let password = String(process.env.PLAYWRIGHT_PROXY_PASSWORD ?? '').trim()
  if (server.includes('@')) {
    try {
      const u = new URL(server)
      if (!username && u.username) username = decodeURIComponent(u.username)
      if (!password && u.password) password = decodeURIComponent(u.password)
      u.username = ''
      u.password = ''
      server = u.toString().replace(/\/$/, '')
    } catch {
      /* keep raw server */
    }
  }
  /** @type {import('playwright').BrowserContextOptions['proxy']} */
  const out = { server }
  if (username) out.username = username
  if (password) out.password = password
  return out
}

/**
 * @typedef {{
 *   startUrl: string
 *   headless: boolean
 *   proxy: import('playwright').BrowserContextOptions['proxy'] | null
 *   cookies: string
 *   selectors: { clickTarget?: string }
 *   timeouts: { pageLoad: number }
 *   readySelector: string | null
 *   debugCheckProxy?: boolean
 *   proxySource: 'none' | 'database' | 'env'
 *   platform: string
 *   startUrlSource: 'platform' | 'env' | 'override' | 'default'
 *   browserEngine: import('./browserEngine.js').BrowserEngine
 * }} ExecutorRunConfig
 */

/** Defaults for docs / overrides (`proxy: null` until you pass a built proxy). */
export function getDefaultExecutorRunConfig() {
  return {
    startUrl: TIKTOK_START,
    headless: envHeadless(),
    proxy: null,
    cookies: '',
    selectors: {},
    timeouts: { pageLoad: envPageLoadMs() },
    readySelector: null,
    debugCheckProxy: false,
    proxySource: 'none',
    platform: 'TikTok',
    startUrlSource: 'default',
    browserEngine: 'chromium',
  }
}

/**
 * Shallow merge: top-level + `selectors` + `timeouts`.
 * @param {Partial<ExecutorRunConfig>} base
 * @param {Partial<ExecutorRunConfig>} patch
 * @returns {ExecutorRunConfig}
 */
export function mergeExecutorRunConfig(base, patch) {
  const b = { ...getDefaultExecutorRunConfig(), ...base }
  const p = patch ?? {}
  return {
    ...b,
    ...p,
    selectors: { ...b.selectors, ...(p.selectors ?? {}) },
    timeouts: { ...b.timeouts, ...(p.timeouts ?? {}) },
    proxySource: p.proxySource ?? b.proxySource,
    platform: p.platform ?? b.platform,
    startUrlSource: p.startUrlSource ?? b.startUrlSource,
    browserEngine: p.browserEngine != null ? normalizeBrowserEngine(p.browserEngine) : b.browserEngine,
  }
}

/**
 * Build config from DB account + linked proxy (proxy slot filled here for future use).
 * @param {{ account: Record<string, unknown>, proxy: Record<string, unknown> | null }} ctx
 * @param {{ targetUrl?: string, readySelector?: string, clickTarget?: string, debugCheckProxy?: boolean, browserEngine?: string }} [routeOptions]
 * @returns {ExecutorRunConfig}
 */
export function buildExecutorRunConfigFromContext(ctx, routeOptions = {}) {
  const platform = 'TikTok'

  const explicitTarget =
    routeOptions.targetUrl != null && String(routeOptions.targetUrl).trim() !== ''

  /** Platform wins over env: TikTok → fixed URL; never example.com as fallback. */
  let startUrl = TIKTOK_START
  /** @type {'platform' | 'env' | 'override' | 'default'} */
  let startUrlSource = 'platform'

  if (explicitTarget) {
    startUrl = String(routeOptions.targetUrl).trim()
    startUrlSource = 'override'
    try {
      if (new URL(startUrl).hostname === 'example.com') {
        startUrl = TIKTOK_START
        startUrlSource = 'platform'
      }
    } catch {
      /* keep startUrl; validation elsewhere */
    }
  } else if (platform === 'TikTok') {
    startUrl = TIKTOK_START
    startUrlSource = 'platform'
  } else {
    const fromEnv = readEnvSocialUrl()
    if (fromEnv) {
      startUrl = fromEnv
      startUrlSource = 'env'
    } else {
      startUrl = TIKTOK_START
      startUrlSource = 'default'
    }
  }

  const readyRaw = routeOptions.readySelector
  const readySelector =
    readyRaw != null && String(readyRaw).trim() !== '' ? String(readyRaw).trim() : null
  const clickRaw = routeOptions.clickTarget
  const clickTarget =
    clickRaw != null && String(clickRaw).trim() !== '' ? String(clickRaw).trim() : undefined

  const fromDb = buildPlaywrightProxyConfig(ctx.proxy)
  const fromEnv = proxyFromEnv()
  const launchProxy = fromDb ?? fromEnv

  /** `database` if built from linked proxy row; `env` only if env filled the gap. */
  let proxySource = /** @type {'none' | 'database' | 'env'} */ ('none')
  if (fromDb) {
    proxySource = 'database'
  } else if (fromEnv) {
    proxySource = 'env'
  }

  const debugCheckProxy =
    routeOptions.debugCheckProxy === true ||
    String(process.env.PLAYWRIGHT_DEBUG_PROXY_IP_CHECK ?? '').trim() === '1' ||
    true

  const browserEngine = normalizeBrowserEngine(
    routeOptions.browserEngine ?? ctx.account.browser_engine,
  )

  return {
    startUrl,
    headless: envHeadless(),
    proxy: launchProxy ?? null,
    cookies: String(ctx.account.cookies ?? '').trim(),
    selectors: clickTarget ? { clickTarget } : {},
    timeouts: { pageLoad: envPageLoadMs() },
    readySelector,
    debugCheckProxy,
    proxySource,
    platform,
    startUrlSource,
    browserEngine,
  }
}
