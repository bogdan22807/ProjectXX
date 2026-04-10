/**
 * Playwright test run for an in-house / test social URL only.
 * Minimal flow: launch → optional proxy → context → cookies → goto → verify → log → close.
 */

import { chromium } from 'playwright'
import { getExecutionContext, logStep, updateStatus } from './runner.js'

/** @typedef {{ cancelled: boolean, browser: import('playwright').Browser | null, context: import('playwright').BrowserContext | null }} PlaywrightRunState */

/** @type {Map<string, PlaywrightRunState>} */
const playwrightRuns = new Map()

/**
 * Base URL of your test social app (same-origin cookies).
 * Override per request via `targetUrl` in {@link runPlaywrightTestRun}.
 */
export function getDefaultSocialTestUrl() {
  const u = process.env.SOCIAL_TEST_URL ?? process.env.TEST_SOCIAL_URL ?? ''
  return String(u).trim()
}

/**
 * @param {string} accountId
 */
export function isPlaywrightTestRunActive(accountId) {
  return playwrightRuns.has(accountId)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Inclusive random integer in [min, max]. */
function randomInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1))
}

/**
 * @param {import('./runner.js').ProxyRow | null} proxy
 * @returns {import('playwright').LaunchOptions['proxy'] | undefined}
 */
function proxyLaunchOptions(proxy) {
  if (!proxy) return undefined
  const host = String(proxy.host ?? '').trim()
  if (!host) return undefined
  const port = String(proxy.port ?? '').trim()
  const server = port ? `http://${host}:${port}` : `http://${host}`
  const username = String(proxy.username ?? '').trim()
  const password = String(proxy.password ?? '').trim()
  if (username || password) {
    return { server, username: username || undefined, password: password || undefined }
  }
  return { server }
}

/**
 * Build Playwright cookie objects for addCookies using page URL origin.
 * Accepts JSON array of cookie objects, or Playwright storageState JSON, or "name=value; name2=value2".
 *
 * @param {string} raw
 * @param {URL} pageUrl
 * @returns {import('playwright').Cookie[]}
 */
export function parseCookiesForUrl(raw, pageUrl) {
  const s = String(raw ?? '').trim()
  if (!s) return []

  try {
    const parsed = JSON.parse(s)
    if (Array.isArray(parsed)) {
      return normalizeCookieList(parsed, pageUrl)
    }
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.cookies)) {
      return normalizeCookieList(parsed.cookies, pageUrl)
    }
  } catch {
    /* fall through */
  }

  const hostname = pageUrl.hostname
  const origin = pageUrl.origin
  const out = []
  for (const part of s.split(';')) {
    const p = part.trim()
    if (!p) continue
    const eq = p.indexOf('=')
    if (eq <= 0) continue
    const name = p.slice(0, eq).trim()
    const value = p.slice(eq + 1).trim()
    if (!name) continue
    out.push({ name, value, url: origin })
  }
  return out
}

/**
 * @param {unknown[]} list
 * @param {URL} pageUrl
 * @returns {import('playwright').Cookie[]}
 */
function normalizeCookieList(list, pageUrl) {
  const host = pageUrl.hostname
  const origin = pageUrl.origin
  /** @type {import('playwright').Cookie[]} */
  const out = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const o = /** @type {Record<string, unknown>} */ (item)
    const name = o.name != null ? String(o.name) : ''
    if (!name) continue
    const value = o.value != null ? String(o.value) : ''
    let domain = o.domain != null ? String(o.domain) : host
    if (!domain) domain = host
    const path = o.path != null ? String(o.path) : '/'
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

/**
 * @param {string} accountId
 * @param {{ targetUrl?: string }} [options]
 */
export async function runPlaywrightTestRun(accountId, options = {}) {
  const targetUrl = String(options.targetUrl ?? getDefaultSocialTestUrl()).trim()
  if (!targetUrl) {
    throw new Error('Set SOCIAL_TEST_URL (or TEST_SOCIAL_URL) or pass targetUrl')
  }

  let pageUrl
  try {
    pageUrl = new URL(targetUrl)
  } catch {
    throw new Error(`Invalid target URL: ${targetUrl}`)
  }

  if (playwrightRuns.has(accountId)) {
    throw new Error('Playwright test run already active for this account')
  }

  const state = { cancelled: false, browser: null, context: null }
  playwrightRuns.set(accountId, state)

  try {
    const ctx = getExecutionContext(accountId)
    if (!ctx) {
      throw new Error(`Account not found: ${accountId}`)
    }

    updateStatus(accountId, 'Starting')

    const launchOpts = {
      headless: process.env.PLAYWRIGHT_HEADED === '1' ? false : true,
      proxy: proxyLaunchOptions(ctx.proxy),
    }

    const browser = await chromium.launch(launchOpts)
    state.browser = browser
    if (state.cancelled) return

    const context = await browser.newContext()
    state.context = context
    logStep(accountId, 'browser started', ctx.proxy?.host ? 'with proxy' : 'no proxy')

    const rawCookies = String(ctx.account.cookies ?? '').trim()
    const cookies = parseCookiesForUrl(rawCookies, pageUrl)
    if (cookies.length > 0) {
      await context.addCookies(cookies)
      logStep(accountId, 'cookies loaded', `${cookies.length} cookie(s)`)
    } else {
      logStep(accountId, 'cookies loaded', rawCookies ? 'unparsed or empty — skipped' : 'none')
    }

    if (state.cancelled) return

    const page = await context.newPage()
    const response = await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    })

    if (state.cancelled) return

    const ok = response === null || response.ok()
    if (!ok) {
      const status = response?.status() ?? 'unknown'
      throw new Error(`HTTP ${status} for ${targetUrl}`)
    }

    const opened = page.url()
    logStep(accountId, 'page opened', opened)

    updateStatus(accountId, 'Running')

    await sleep(randomInt(2000, 5000))
    if (state.cancelled) return

    const deltaY = randomInt(200, 800)
    await page.mouse.wheel(0, deltaY)
    if (state.cancelled) return

    await sleep(randomInt(2000, 4000))
    if (state.cancelled) return

    logStep(accountId, 'scroll completed', `${deltaY}px`)

    logStep(accountId, 'completed', targetUrl)
    updateStatus(accountId, 'Ready')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logStep(accountId, 'playwright error', msg)
    try {
      updateStatus(accountId, 'Error')
    } catch {
      /* account may be gone */
    }
    throw err
  } finally {
    const run = playwrightRuns.get(accountId)
    if (run) {
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

/**
 * Best-effort abort: closes browser/context if still open.
 * @param {string} accountId
 */
export async function abortPlaywrightTestRun(accountId) {
  const run = playwrightRuns.get(accountId)
  if (!run) return false
  run.cancelled = true
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
  playwrightRuns.delete(accountId)
  try {
    logStep(accountId, 'playwright aborted', 'user or stop')
    updateStatus(accountId, 'Ready')
  } catch {
    /* ignore */
  }
  return true
}
