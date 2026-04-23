/**
 * Fox / Camoufox path — separate core from Chromium.
 * Stub: implement subprocess or RPC to Python Camoufox and return a Playwright-compatible session.
 *
 * @param {{
 *   headless?: boolean
 *   proxy?: import('playwright').BrowserContextOptions['proxy'] | null
 *   cookies?: string
 *   cookieUrl?: string
 *   userAgent?: string
 *   onPhase?: (phase: string, detail?: string) => void
 * }} _config
 * @returns {Promise<{ browser: import('playwright').Browser, context: import('playwright').BrowserContext, page: import('playwright').Page }>}
 */
export async function launchFoxBrowserSession(_config) {
  throw new Error(
    'FOX_BROWSER_NOT_IMPLEMENTED: Camoufox/Python runner is not wired yet. Set account browser_engine to chromium.',
  )
}
