/**
 * Playwright test run for an in-house / test social URL only.
 * Stable single-account flow: launch → proxy → cookies → page → optional ready selector → scroll → done.
 */

import { chromium } from 'playwright'
import { buildPlaywrightProxyConfig, describeProxyForLog } from './proxyConfig.js'
import { getExecutionContext, logStep, updateStatus } from './runner.js'

/**
 * @typedef {{
 *   cancelled: boolean
 *   abortedByUser: boolean
 *   sleepWake: (() => void) | null
 *   browser: import('playwright').Browser | null
 *   context: import('playwright').BrowserContext | null
 * }} PlaywrightRunState
 */

/** @type {Map<string, PlaywrightRunState>} */
const playwrightRuns = new Map()

/** Log + status for executor failures (not user stop). */
function failRun(accountId, state, action, details) {
  if (state.abortedByUser) return
  logStep(accountId, action, String(details ?? '').slice(0, 2000))
  try {
    updateStatus(accountId, 'Error')
  } catch {
    /* account removed */
  }
}

/**
 * Map Playwright / network errors to stable log actions.
 * @param {unknown} err
 * @param {{ phase: string }} ctx
 */
function classifyError(err, ctx) {
  const msg = err instanceof Error ? err.message : String(err)
  const name = err instanceof Error ? err.name : ''
  const lower = msg.toLowerCase()

  if (stateAbortedMessage(lower)) {
    return { action: 'stopped by user', details: msg, treatAsUserStop: true }
  }

  if (name === 'TimeoutError' || lower.includes('timeout')) {
    if (ctx.phase === 'goto' || ctx.phase === 'navigation') {
      return { action: 'page load timeout', details: msg }
    }
    if (ctx.phase === 'selector') {
      return { action: 'selector not found', details: msg }
    }
  }

  if (
    lower.includes('err_proxy') ||
    lower.includes('proxy') ||
    lower.includes('tunnel') ||
    (lower.includes('econnrefused') && (ctx.phase === 'goto' || ctx.phase === 'navigation'))
  ) {
    return { action: 'proxy connection failed', details: msg }
  }

  if (lower.includes('target page, context or browser has been closed')) {
    return { action: 'stopped by user', details: msg, treatAsUserStop: true }
  }

  if (ctx.phase === 'launch') {
    return { action: 'browser launch failed', details: msg }
  }

  if (ctx.phase === 'goto' || ctx.phase === 'navigation' || ctx.phase === 'scroll') {
    return { action: 'page load timeout', details: msg }
  }

  if (ctx.phase === 'selector') {
    return { action: 'selector not found', details: msg }
  }

  return { action: 'executor error', details: `[${ctx.phase}] ${msg}` }
}

function stateAbortedMessage(lower) {
  return lower.includes('abort') || lower.includes('cancelled')
}

const DEFAULT_TEST_PAGE_URL = 'https://example.com'

export function getDefaultSocialTestUrl() {
  const u = process.env.SOCIAL_TEST_URL ?? process.env.TEST_SOCIAL_URL ?? DEFAULT_TEST_PAGE_URL
  return String(u).trim() || DEFAULT_TEST_PAGE_URL
}

export function getReadySelector() {
  const s = process.env.SOCIAL_TEST_READY_SELECTOR ?? process.env.TEST_SOCIAL_READY_SELECTOR ?? ''
  return String(s).trim()
}

export function isPlaywrightTestRunActive(accountId) {
  return playwrightRuns.has(accountId)
}

function interruptibleSleep(state, ms) {
  return new Promise((resolve) => {
    const tid = setTimeout(() => {
      state.sleepWake = null
      resolve()
    }, ms)
    state.sleepWake = () => {
      clearTimeout(tid)
      state.sleepWake = null
      resolve()
    }
  })
}

function randomInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1))
}

/** @see ./proxyConfig.js */
const IPIFY_URL = 'https://api.ipify.org/?format=json'

/**
 * Parse cookies for addCookies. If user supplied non-empty cookie data that cannot be used → invalid.
 * @returns {{ cookies: import('playwright').Cookie[], invalid?: string }}
 */
export function parseCookiesForUrlStrict(raw, pageUrl) {
  const s = String(raw ?? '').trim()
  if (!s) {
    return { cookies: [] }
  }

  const origin = pageUrl.origin
  const host = pageUrl.hostname

  const trimmed = s.trim()
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) {
        const cookies = normalizeCookieList(parsed, pageUrl)
        if (cookies.length === 0) {
          return { cookies: [], invalid: 'JSON array parsed but no valid cookie entries' }
        }
        return { cookies }
      }
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.cookies)) {
        const cookies = normalizeCookieList(parsed.cookies, pageUrl)
        if (cookies.length === 0) {
          return { cookies: [], invalid: 'storageState.cookies empty or invalid' }
        }
        return { cookies }
      }
      return { cookies: [], invalid: 'JSON is not a cookie array or storageState' }
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      return { cookies: [], invalid: `invalid JSON: ${m}` }
    }
  }

  const headerCookies = []
  for (const part of s.split(';')) {
    const p = part.trim()
    if (!p) continue
    const eq = p.indexOf('=')
    if (eq <= 0) continue
    const name = p.slice(0, eq).trim()
    const value = p.slice(eq + 1).trim()
    if (!name) continue
    headerCookies.push({ name, value, url: origin })
  }

  if (headerCookies.length === 0) {
    return {
      cookies: [],
      invalid: 'cookie string is not valid JSON and has no name=value pairs',
    }
  }
  return { cookies: headerCookies }
}

function normalizeCookieList(list, pageUrl) {
  const host = pageUrl.hostname
  /** @type {import('playwright').Cookie[]} */
  const out = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const o = /** @type {Record<string, unknown>} */ (item)
    const name = o.name != null ? String(o.name) : ''
    if (!name) continue
    const value = o.value != null ? String(o.value) : ''
    const path = o.path != null ? String(o.path) : '/'
    let domain = o.domain != null ? String(o.domain) : host
    if (!domain) domain = host
    /** @type {import('playwright').Cookie} */
    const c =
      o.url != null
        ? { name, value, url: String(o.url) }
        : { name, value, domain, path }
    if (o.expires != null && Number.isFinite(Number(o.expires))) {
      c.expires = Number(o.expires)
    }
    if (o.httpOnly === true) c.httpOnly = true
    if (o.secure === true) c.secure = true
    if (o.sameSite === 'Strict' || o.sameSite === 'Lax' || o.sameSite === 'None') {
      c.sameSite = o.sameSite
    }
    out.push(c)
  }
  return out
}

/** Re-export loose parser name for tests importing parseCookiesForUrl */
export function parseCookiesForUrl(raw, pageUrl) {
  const r = parseCookiesForUrlStrict(raw, pageUrl)
  return r.cookies
}

function launchTimeoutMs() {
  const n = Number(process.env.PLAYWRIGHT_LAUNCH_TIMEOUT_MS)
  return Number.isFinite(n) && n > 0 ? n : 60_000
}

function gotoTimeoutMs() {
  const n = Number(process.env.PLAYWRIGHT_GOTO_TIMEOUT_MS)
  return Number.isFinite(n) && n > 0 ? n : 60_000
}

/** Slow proxies often never fire `domcontentloaded` in time → spurious goto timeout. Default `commit` finishes after navigation is committed. */
function gotoWaitUntil() {
  const w = String(process.env.PLAYWRIGHT_GOTO_WAIT_UNTIL ?? '').trim().toLowerCase()
  if (w === 'domcontentloaded' || w === 'load' || w === 'networkidle' || w === 'commit') {
    return /** @type {'commit' | 'domcontentloaded' | 'load' | 'networkidle'} */ (w)
  }
  return 'commit'
}

function selectorTimeoutMs() {
  const n = Number(process.env.PLAYWRIGHT_SELECTOR_TIMEOUT_MS)
  return Number.isFinite(n) && n > 0 ? n : 15_000
}

/**
 * @param {string} accountId
 * @param {{ targetUrl?: string; readySelector?: string }} [options]
 */
export async function runPlaywrightTestRun(accountId, options = {}) {
  const targetUrl = String(options.targetUrl ?? getDefaultSocialTestUrl()).trim() || DEFAULT_TEST_PAGE_URL

  let pageUrl
  try {
    pageUrl = new URL(targetUrl)
  } catch {
    throw new Error(`Invalid target URL: ${targetUrl}`)
  }

  if (playwrightRuns.has(accountId)) {
    throw new Error('Playwright test run already active for this account')
  }

  const state = {
    cancelled: false,
    abortedByUser: false,
    sleepWake: null,
    browser: null,
    context: null,
  }
  playwrightRuns.set(accountId, state)

  const readySelector =
    String(options.readySelector ?? getReadySelector()).trim() || null

  try {
    const ctx = getExecutionContext(accountId)
    if (!ctx) {
      throw new Error(`Account not found: ${accountId}`)
    }

    updateStatus(accountId, 'Running')
    logStep(accountId, 'executor started', targetUrl)

    const launchProxy = buildPlaywrightProxyConfig(ctx.proxy)
    const proxyLogLine = describeProxyForLog(ctx.proxy, launchProxy)
    logStep(accountId, 'playwright launch prep', [
      `headless=${process.env.PLAYWRIGHT_HEADED === '1' ? '0' : '1'}`,
      `targetUrl=${targetUrl}`,
      `cookiesLen=${String(ctx.account.cookies ?? '').trim().length}`,
      proxyLogLine,
      `provider=${String(ctx.proxy?.provider ?? '').trim() || '(none)'}`,
    ].join(' | '))

    /** Proxy on browser context (not launch) — avoids some HTTP 407 cases with authenticated HTTP proxies. */
    const launchOpts = {
      headless: process.env.PLAYWRIGHT_HEADED === '1' ? false : true,
      args: process.env.PLAYWRIGHT_CHROMIUM_ARGS
        ? process.env.PLAYWRIGHT_CHROMIUM_ARGS.split(/\s+/).filter(Boolean)
        : [],
    }

    let browser
    try {
      let launchTimeoutId
      const timeoutPromise = new Promise((_, reject) => {
        launchTimeoutId = setTimeout(() => reject(new Error('Launch timed out')), launchTimeoutMs())
      })
      try {
        browser = await Promise.race([chromium.launch(launchOpts), timeoutPromise])
      } finally {
        if (launchTimeoutId) clearTimeout(launchTimeoutId)
      }
    } catch (err) {
      const { action, details } = classifyError(err, { phase: 'launch' })
      failRun(accountId, state, action, details)
      return
    }

    state.browser = browser
    if (state.cancelled) return

    let context
    try {
      context = await browser.newContext({
        ignoreHTTPSErrors: process.env.PLAYWRIGHT_IGNORE_HTTPS_ERRORS === '1',
        ...(launchProxy ? { proxy: launchProxy } : {}),
      })
    } catch (err) {
      const { action, details } = classifyError(err, { phase: 'launch' })
      failRun(accountId, state, action, details)
      return
    }

    state.context = context
    logStep(
      accountId,
      'browser started',
      launchProxy ? `with proxy | ${proxyLogLine}` : 'no proxy',
    )

    const rawCookies = String(ctx.account.cookies ?? '').trim()
    const parsed = parseCookiesForUrlStrict(rawCookies, pageUrl)
    if (parsed.invalid) {
      failRun(accountId, state, 'cookies invalid', parsed.invalid)
      return
    }
    if (parsed.cookies.length > 0) {
      try {
        await context.addCookies(parsed.cookies)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        failRun(accountId, state, 'cookies invalid', msg)
        return
      }
      logStep(accountId, 'cookies loaded', `${parsed.cookies.length} cookie(s)`)
    } else {
      logStep(accountId, 'cookies loaded', 'none')
    }

    if (state.cancelled) return

    if (launchProxy) {
      const ipifyMs = Math.min(
        30_000,
        Math.max(5_000, Math.floor(gotoTimeoutMs() * 0.5)),
      )
      let ipPage
      try {
        ipPage = await context.newPage()
        const ipResp = await ipPage.goto(IPIFY_URL, {
          waitUntil: gotoWaitUntil(),
          timeout: ipifyMs,
        })
        const ipStatus = ipResp?.status() ?? null
        if (ipStatus === 407) {
          failRun(
            accountId,
            state,
            'proxy authentication rejected',
            'HTTP 407 from proxy on HTTPS request — Chromium did not get a valid authenticated tunnel. Fix credentials/session (SOAX sub-user, whitelist IP) or proxy product type; not a page.goto URL bug.',
          )
          return
        }
        const text = (await ipPage.textContent('body').catch(() => '')) ?? ''
        const snippet = String(text).replace(/\s+/g, ' ').trim().slice(0, 500)
        logStep(
          accountId,
          'proxy connectivity (ipify)',
          `HTTP ${ipStatus ?? '?'} body=${snippet || '(empty)'}`,
        )
      } catch (err) {
        if (state.abortedByUser) return
        const { action, details, treatAsUserStop } = classifyError(err, { phase: 'goto' })
        if (treatAsUserStop) return
        failRun(
          accountId,
          state,
          action === 'page load timeout' ? 'proxy connectivity failed (ipify)' : action,
          `${details} — if credentials/host/port are correct, the proxy is likely unreachable, wrong scheme (try PLAYWRIGHT_PROXY_SCHEME=socks5), or blocked.`,
        )
        return
      } finally {
        try {
          await ipPage?.close()
        } catch {
          /* ignore */
        }
      }
    }

    let page
    try {
      page = await context.newPage()
    } catch (err) {
      const { action, details } = classifyError(err, { phase: 'launch' })
      failRun(accountId, state, action, details)
      return
    }

    let response
    try {
      response = await page.goto(targetUrl, {
        waitUntil: gotoWaitUntil(),
        timeout: gotoTimeoutMs(),
      })
    } catch (err) {
      if (state.abortedByUser) return
      const { action, details, treatAsUserStop } = classifyError(err, { phase: 'goto' })
      if (treatAsUserStop) return
      failRun(accountId, state, action, details)
      return
    }

    if (state.cancelled) return

    const status = response?.status() ?? null
    if (status === 407) {
      failRun(
        accountId,
        state,
        'proxy authentication rejected',
        `HTTP 407 for ${targetUrl} — proxy refused auth on this request (same class of failure as CONNECT auth).`,
      )
      return
    }
    const ok = response === null || response.ok()
    if (!ok) {
      const st = status ?? 'unknown'
      failRun(accountId, state, 'page load timeout', `HTTP ${st} for ${targetUrl}`)
      return
    }

    logStep(accountId, 'page opened', page.url())

    if (readySelector) {
      try {
        await page.waitForSelector(readySelector, {
          state: 'attached',
          timeout: selectorTimeoutMs(),
        })
      } catch (err) {
        if (state.abortedByUser) return
        const { action, details, treatAsUserStop } = classifyError(err, { phase: 'selector' })
        if (treatAsUserStop) return
        failRun(accountId, state, action, details)
        return
      }
    }

    logStep(accountId, 'waiting', 'before scroll (2–5s)')
    await interruptibleSleep(state, randomInt(2000, 5000))
    if (state.cancelled) return

    const deltaY = randomInt(200, 800)
    try {
      await page.mouse.wheel(0, deltaY)
    } catch (err) {
      if (state.abortedByUser) return
      const { action, details, treatAsUserStop } = classifyError(err, { phase: 'scroll' })
      if (treatAsUserStop) return
      failRun(accountId, state, action, details)
      return
    }

    logStep(accountId, 'waiting', 'after scroll (2–4s)')
    await interruptibleSleep(state, randomInt(2000, 4000))
    if (state.cancelled) return

    logStep(accountId, 'scroll completed', `${deltaY}px`)
    logStep(accountId, 'completed', targetUrl)
    updateStatus(accountId, 'Ready')
  } catch (err) {
    if (state.abortedByUser) {
      return
    }
    const msg = err instanceof Error ? err.message : String(err)
    const { action, details, treatAsUserStop } = classifyError(err, { phase: 'unknown' })
    if (treatAsUserStop) return
    failRun(accountId, state, action, details)
  } finally {
    const run = playwrightRuns.get(accountId)
    if (run) {
      run.sleepWake?.()
      run.sleepWake = null
      try {
        await run.context?.close()
      } catch {
        /* ignore */
      }
      try {
        await run.browser?.close()
      } catch {
        /* ignore */
      }
    }
    playwrightRuns.delete(accountId)
  }
}

export async function abortPlaywrightTestRun(accountId) {
  const run = playwrightRuns.get(accountId)
  if (!run) return false
  run.cancelled = true
  run.abortedByUser = true
  run.sleepWake?.()
  try {
    await run.context?.close()
  } catch {
    /* ignore */
  }
  try {
    await run.browser?.close()
  } catch {
    /* ignore */
  }
  return true
}
