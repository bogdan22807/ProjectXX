/**
 * Single config object for one executor run (browser session + view/scroll scenario).
 * `proxy` is Playwright `BrowserContextOptions['proxy']` or null — set from DB via buildPlaywrightProxyConfig when wiring.
 */

import { buildPlaywrightProxyConfig } from './proxyConfig.js'

const DEFAULT_START = 'https://example.com'

function envStartUrl() {
  const u = process.env.SOCIAL_TEST_URL ?? process.env.TEST_SOCIAL_URL ?? DEFAULT_START
  return String(u).trim() || DEFAULT_START
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
  const server = String(process.env.PLAYWRIGHT_PROXY_SERVER ?? '').trim()
  if (!server) return null
  const username = String(process.env.PLAYWRIGHT_PROXY_USERNAME ?? '').trim()
  const password = String(process.env.PLAYWRIGHT_PROXY_PASSWORD ?? '').trim()
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
 * }} ExecutorRunConfig
 */

/** Defaults for docs / overrides (`proxy: null` until you pass a built proxy). */
export function getDefaultExecutorRunConfig() {
  return {
    startUrl: envStartUrl(),
    headless: envHeadless(),
    proxy: null,
    cookies: '',
    selectors: {},
    timeouts: { pageLoad: envPageLoadMs() },
    readySelector: null,
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
  }
}

/**
 * Build config from DB account + linked proxy (proxy slot filled here for future use).
 * @param {{ account: Record<string, unknown>, proxy: Record<string, unknown> | null }} ctx
 * @param {{ targetUrl?: string, readySelector?: string, clickTarget?: string }} [routeOptions]
 * @returns {ExecutorRunConfig}
 */
export function buildExecutorRunConfigFromContext(ctx, routeOptions = {}) {
  const startUrl =
    String(routeOptions.targetUrl ?? envStartUrl()).trim() || envStartUrl()
  const readyRaw = routeOptions.readySelector
  const readySelector =
    readyRaw != null && String(readyRaw).trim() !== '' ? String(readyRaw).trim() : null
  const clickRaw = routeOptions.clickTarget
  const clickTarget =
    clickRaw != null && String(clickRaw).trim() !== '' ? String(clickRaw).trim() : undefined

  const fromDb = buildPlaywrightProxyConfig(ctx.proxy)
  const launchProxy = fromDb ?? proxyFromEnv()

  return {
    startUrl,
    headless: envHeadless(),
    proxy: launchProxy ?? null,
    cookies: String(ctx.account.cookies ?? '').trim(),
    selectors: clickTarget ? { clickTarget } : {},
    timeouts: { pageLoad: envPageLoadMs() },
    readySelector,
  }
}
