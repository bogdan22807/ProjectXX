/**
 * Fox / Camoufox: launch server (same stdin protocol as camoufox.server) + Playwright firefox.connect.
 * Python bridge: backend/fox/camoufox_bridge.py (uses camoufox.utils.launch_options like the user's CreateBrowser flow).
 */

import { parseCookiesForUrlStrict } from './cookieParse.js'
import { launchCamoufoxServerAndConnect } from './camoufoxLaunch.js'

/**
 * @param {{
 *   headless?: boolean
 *   proxy?: import('playwright').BrowserContextOptions['proxy'] | null
 *   cookies?: string
 *   cookieUrl?: string
 *   userAgent?: string
 *   onPhase?: (phase: string, detail?: string) => void
 * }} config
 * @returns {Promise<{ browser: import('playwright').Browser, context: import('playwright').BrowserContext, page: import('playwright').Page }>}
 */
export async function launchFoxBrowserSession(config) {
  const phase =
    typeof config.onPhase === 'function'
      ? /** @type {(p: string, d?: string) => void} */ (config.onPhase)
      : () => {}

  phase('fox_bridge_start', `python=${String(process.env.FOX_PYTHON ?? process.env.CAMOUFOX_PYTHON ?? 'python3')}`)

  const headless = config.headless !== undefined ? Boolean(config.headless) : true

  const { browser } = await launchCamoufoxServerAndConnect({
    headless,
    proxy: config.proxy ?? null,
  })

  phase('fox_server_connected', 'playwright firefox.connect ok')

  let context =
    browser.contexts().length > 0 ? browser.contexts()[0] : await browser.newContext()
  phase('fox_context_ready', `contexts=${browser.contexts().length}`)

  const rawCookies = String(config.cookies ?? '').trim()
  const base = String(config.cookieUrl ?? '').trim() || 'https://www.tiktok.com/'
  let pageUrl
  try {
    pageUrl = new URL(base)
  } catch {
    await browser.close().catch(() => {})
    throw new Error(`Invalid cookieUrl: ${base}`)
  }

  if (rawCookies) {
    const parsed = parseCookiesForUrlStrict(rawCookies, pageUrl)
    if (parsed.invalid) {
      await browser.close().catch(() => {})
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

  let page = context.pages().length > 0 ? context.pages()[0] : null
  if (!page) {
    page = await context.newPage()
    phase('first_page_created', '')
  } else {
    phase('first_page_created', 'reusing default page from Camoufox server')
  }

  return { browser, context, page }
}
