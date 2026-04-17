/**
 * Single place: launch Chromium → context (UA) → optional cookies → first page.
 * When `config.proxy` is set, it is passed to `chromium.launch({ proxy })` (same as isolated diagnostic).
 * Does not replace runPlaywrightTestRun orchestration — used by it and available for future scenarios.
 */

import { chromium } from 'playwright'
import { parseCookiesForUrlStrict } from './cookieParse.js'

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
 * }} CreateBrowserSessionConfig
 */

/**
 * @param {CreateBrowserSessionConfig} config
 * @returns {Promise<{ browser: import('playwright').Browser, context: import('playwright').BrowserContext, page: import('playwright').Page }>}
 */
export async function createBrowserSession(config = {}) {
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
    browser = await Promise.race([chromium.launch(launchOpts), timeoutPromise])
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

    const rawCookies = String(config.cookies ?? '').trim()
    if (rawCookies) {
      const base =
        String(config.cookieUrl ?? '').trim() || 'https://example.com/'
      let pageUrl
      try {
        pageUrl = new URL(base)
      } catch {
        throw new Error(`Invalid cookieUrl: ${base}`)
      }
      const parsed = parseCookiesForUrlStrict(rawCookies, pageUrl)
      if (parsed.invalid) {
        throw new Error(parsed.invalid)
      }
      if (parsed.cookies.length > 0) {
        await context.addCookies(parsed.cookies)
      }
    }

    const page = await context.newPage()
    return { browser, context, page }
  } catch (err) {
    await context?.close().catch(() => {})
    await browser?.close().catch(() => {})
    throw err
  }
}
