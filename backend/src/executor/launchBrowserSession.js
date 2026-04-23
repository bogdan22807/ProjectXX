/**
 * Unified launch entrypoint: route by `browserEngine` without changing scenario code.
 */

import { createBrowserSession } from './createBrowserSession.js'
import { normalizeBrowserEngine } from './browserEngine.js'
import { launchFoxBrowserSession } from './foxRunner.js'

/**
 * @param {import('./browserEngine.js').BrowserEngine | string | undefined} engine
 * @param {Parameters<typeof createBrowserSession>[0]} sessionConfig
 * @param {{ accountId: string; logStep: (accountId: string, action: string, details?: string) => void }} ctx
 * @returns {Promise<{ browser: import('playwright').Browser, context: import('playwright').BrowserContext, page: import('playwright').Page }>}
 */
export async function launchBrowserSession(engine, sessionConfig, ctx) {
  const e = normalizeBrowserEngine(engine)
  if (e === 'fox') {
    ctx.logStep(ctx.accountId, 'FOX_LAUNCH_ROUTED', 'dispatching to fox runner (stub)')
    return launchFoxBrowserSession(sessionConfig)
  }
  return createBrowserSession(sessionConfig)
}
