/**
 * Unified launch entrypoint: route by `browserEngine` without changing scenario code.
 */

import { createBrowserSession } from './createBrowserSession.js'
import { normalizeBrowserEngine } from './browserEngine.js'
import { launchFoxBrowserSession } from './foxRunner.js'
import { errorMessage, errorStack, serializeErrorJson } from './errorLogFormat.js'

/**
 * @param {import('./browserEngine.js').BrowserEngine | string | undefined} engine
 * @param {Parameters<typeof createBrowserSession>[0]} sessionConfig
 * @param {{
 *   accountId: string
 *   runId?: string | null
 *   logStep: (accountId: string, action: string, details?: string) => void
 *   proxySource?: 'database' | 'env' | 'none'
 *   proxyRow?: Record<string, unknown> | null
 * }} ctx
 * @returns {Promise<{ browser: import('playwright').Browser, context: import('playwright').BrowserContext, page: import('playwright').Page }>}
 */
export async function launchBrowserSession(engine, sessionConfig, ctx) {
  try {
    const e = normalizeBrowserEngine(engine)
    if (e === 'fox') {
      ctx.logStep(ctx.accountId, 'FOX_LAUNCH_ROUTED', 'dispatching to fox runner (python subprocess)')
      return await launchFoxBrowserSession(sessionConfig, {
        accountId: ctx.accountId,
        runId: ctx.runId ?? null,
        logStep: ctx.logStep,
        proxySource: ctx.proxySource ?? 'none',
        proxyRow: ctx.proxyRow ?? null,
      })
    }
    return await createBrowserSession(sessionConfig)
  } catch (err) {
    const msg = errorMessage(err)
    console.error('[launchBrowserSession]', msg)
    console.error(errorStack(err))
    console.error(serializeErrorJson(err))
    throw err
  }
}
