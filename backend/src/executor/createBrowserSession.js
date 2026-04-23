/**
 * Single place: launch Chromium → context (UA) → optional cookies → first page.
 * When `config.proxy` is set, it is passed to `chromium.launch({ proxy })` (same as isolated diagnostic).
 * Does not replace runPlaywrightTestRun orchestration — used by it and available for future scenarios.
 */

import { chromium } from 'playwright'
import { parseCookiesForUrlStrict } from './cookieParse.js'
import { errorMessage, errorStack, serializeErrorJson } from './errorLogFormat.js'

function launchTimeoutMs() {
  const n = Number(process.env.PLAYWRIGHT_LAUNCH_TIMEOUT_MS)
  return Number.isFinite(n) && n > 0 ? n : 60_000
}

/**
 * @typedef {{
 *   headless?: boolean
 *   proxy?: import('playwright').BrowserContextOptions['proxy'] | null
 *   cookies?: string
 *   cookieUrl?: string
 *   userAgent?: string
 *   onPhase?: (phase: string, detail?: string) => void
 * }} CreateBrowserSessionConfig
 */

/**
 * @param {CreateBrowserSessionConfig} config
 * @returns {Promise<{ browser: import('playwright').Browser, context: import('playwright').BrowserContext, page: import('playwright').Page }>}
 */
export async function createBrowserSession(config = {}) {
  try {
    return await createBrowserSessionInner(config)
  } catch (err) {
    const msg = errorMessage(err)
    console.error('[createBrowserSession]', msg)
    console.error(errorStack(err))
    console.error(serializeErrorJson(err))
    throw err
  }
}

/**
 * @param {CreateBrowserSessionConfig} config
 */
async function createBrowserSessionInner(config = {}) {
  const phase =
    typeof config.onPhase === 'function'
      ? /** @type {(p: string, d?: string) => void} */ (config.onPhase)
      : () => {}

  const headless =
    config.headless !== undefined
      ? Boolean(config.headless)
      : process.env.PLAYWRIGHT_HEADED !== '1'

  const launchOpts = {
    headless,
    args: process.env.PLAYWRIGHT_CHROMIUM_ARGS
      ? process.env.PLAYWRIGHT_CHROMIUM_ARGS.split(/\s+/).filter(Boolean)
      : [],
  }
  /** Same shape as isolated diagnostic: proxy on launch (not only on context). */
  if (config.proxy) {
    launchOpts.proxy = config.proxy
  }

  let launchTimeoutId
  const timeoutPromise = new Promise((_, reject) => {
    launchTimeoutId = setTimeout(() => reject(new Error('Launch timed out')), launchTimeoutMs())
  })
  /** @type {import('playwright').Browser | null} */
  let browser = null
  /** @type {import('playwright').BrowserContext | null} */
  let context = null
  try {
    phase('chromium_launch_start', `timeoutMs=${launchTimeoutMs()}`)
    browser = await Promise.race([chromium.launch(launchOpts), timeoutPromise])
    phase('chromium_launched', '')
  } finally {
    if (launchTimeoutId) clearTimeout(launchTimeoutId)
  }

  try {
    /** @type {import('playwright').BrowserContextOptions} */
    const contextOpts = {
      ignoreHTTPSErrors: process.env.PLAYWRIGHT_IGNORE_HTTPS_ERRORS === '1',
    }
    if (config.userAgent && String(config.userAgent).trim()) {
      contextOpts.userAgent = String(config.userAgent).trim()
    }

    context = await browser.newContext(contextOpts)
    phase('context_created', '')

    const rawCookies = String(config.cookies ?? '').trim()
    if (rawCookies) {
      const base =
        String(config.cookieUrl ?? '').trim() || 'https://www.tiktok.com/'
      let pageUrl
      try {
        pageUrl = new URL(base)
      } catch (urlErr) {
        const msg = errorMessage(urlErr)
        console.error('[createBrowserSession] invalid cookieUrl', base, msg)
        console.error(errorStack(urlErr))
        console.error(serializeErrorJson(urlErr))
        throw new Error(`Invalid cookieUrl: ${base} (${msg})`)
      }
      const parsed = parseCookiesForUrlStrict(rawCookies, pageUrl)
      if (parsed.invalid) {
        throw new Error(parsed.invalid)
      }
      if (parsed.cookies.length > 0) {
        await context.addCookies(parsed.cookies)
        phase('cookies_applied', `${parsed.cookies.length}`)
      } else {
        phase('cookies_empty_after_parse', '')
      }
    } else {
      phase('cookies_skipped', 'no cookie string')
    }

    const page = await context.newPage()
    phase('first_page_created', '')
    return { browser, context, page }
  } catch (err) {
    await context?.close().catch((closeErr) => {
      console.error('[createBrowserSession] context.close during rollback', errorMessage(closeErr))
      console.error(errorStack(closeErr))
    })
    await browser?.close().catch((closeErr) => {
      console.error('[createBrowserSession] browser.close during rollback', errorMessage(closeErr))
      console.error(errorStack(closeErr))
    })
    throw err
  }
}
