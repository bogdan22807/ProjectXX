/**
 * Playwright test run for an in-house / test social URL only.
 * Stable single-account flow: launch → proxy → cookies → page → optional ready selector → scroll → done.
 */

import { describeLaunchProxySafe, describeProxyForLog } from './proxyConfig.js'
import { buildExecutorRunConfigFromContext } from './executorRunConfig.js'
import { parseCookiesForUrlStrict } from './cookieParse.js'
import { createBrowserSession } from './createBrowserSession.js'
import { getExecutionContext, logStep, updateStatus } from './runner.js'
import {
  inferTikTokAuthState,
  runViewAndScrollScenario,
} from './scenarios/viewAndScrollScenario.js'

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

const DEFAULT_TEST_PAGE_URL = 'https://www.tiktok.com/'

export function getDefaultSocialTestUrl() {
  const raw = process.env.SOCIAL_TEST_URL ?? process.env.TEST_SOCIAL_URL
  const fallback = DEFAULT_TEST_PAGE_URL
  if (raw == null || String(raw).trim() === '') return fallback
  const u = String(raw).trim()
  try {
    if (new URL(u).hostname === 'example.com') return fallback
  } catch {
    return fallback
  }
  return u
}

export function getReadySelector() {
  const s = process.env.SOCIAL_TEST_READY_SELECTOR ?? process.env.TEST_SOCIAL_READY_SELECTOR ?? ''
  return String(s).trim()
}

export function isPlaywrightTestRunActive(accountId) {
  return playwrightRuns.has(accountId)
}

/** @see ./proxyConfig.js */
const IPIFY_URL = 'https://api.ipify.org/?format=json'

export { parseCookiesForUrl, parseCookiesForUrlStrict } from './cookieParse.js'

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

const DEBUG_PROXY_IP_URL = 'https://httpbin.org/ip'

/**
 * @param {string} accountId
 * @param {{ targetUrl?: string; readySelector?: string; debugCheckProxy?: boolean; debugScreenshots?: boolean }} [options]
 */
export async function runPlaywrightTestRun(accountId, options = {}) {
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

  try {
    const ctx = getExecutionContext(accountId)
    if (!ctx) {
      throw new Error(`Account not found: ${accountId}`)
    }

    const readySelector =
      String(options.readySelector ?? getReadySelector()).trim() || null

    const explicitTargetOverride =
      options.targetUrl != null && String(options.targetUrl).trim() !== ''
    const runConfig = buildExecutorRunConfigFromContext(ctx, {
      ...(explicitTargetOverride ? { targetUrl: String(options.targetUrl).trim() } : {}),
      readySelector,
      debugCheckProxy: options.debugCheckProxy === true,
    })

    let pageUrl
    try {
      pageUrl = new URL(runConfig.startUrl)
    } catch {
      throw new Error(`Invalid target URL: ${runConfig.startUrl}`)
    }

    updateStatus(accountId, 'Running')
    logStep(accountId, 'EXECUTOR_STARTED', runConfig.startUrl)

    const launchProxy = runConfig.proxy ?? undefined

    const sourceLabel =
      runConfig.proxySource === 'database'
        ? 'database'
        : runConfig.proxySource === 'env'
          ? 'env'
          : 'none'
    logStep(accountId, 'PROXY_SOURCE', sourceLabel)

    const proxyDetail =
      runConfig.proxySource === 'database' && launchProxy
        ? describeProxyForLog(ctx.proxy, launchProxy)
        : launchProxy
          ? describeLaunchProxySafe(launchProxy, {
              provider:
                runConfig.proxySource === 'env'
                  ? 'env'
                  : String(ctx.proxy?.provider ?? '').trim() || '(none)',
            })
          : 'provider=(none) server=(none) user=(omitted)'
    logStep(accountId, 'PROXY_DETAIL', proxyDetail)

    const proxyLogLine =
      runConfig.proxySource === 'database'
        ? describeProxyForLog(ctx.proxy, launchProxy)
        : launchProxy
          ? describeLaunchProxySafe(launchProxy, { provider: 'env' })
          : 'proxy: none'
    const rawCookies = String(runConfig.cookies ?? '').trim()
    const parsed = parseCookiesForUrlStrict(rawCookies, pageUrl)
    if (parsed.invalid) {
      failRun(accountId, state, 'cookies invalid', parsed.invalid)
      return
    }

    let browser
    let context
    let page
    /** Default visible browser for real-site debug unless overridden. */
    const headlessForSession =
      options.headless === true
        ? true
        : options.headless === false
          ? false
          : String(process.env.PLAYWRIGHT_HEADLESS ?? '').trim() === '1'
            ? true
            : false

    const debugScreenshots =
      options.debugScreenshots === true ||
      String(process.env.PLAYWRIGHT_DEBUG_SCREENSHOTS ?? '').trim() === '1'

    logStep(accountId, 'playwright launch prep', [
      `headless=${headlessForSession ? '1' : '0'}`,
      `targetUrl=${runConfig.startUrl}`,
      `platform=${runConfig.platform}`,
      `cookiesLen=${String(runConfig.cookies ?? '').trim().length}`,
      proxyLogLine,
      `provider=${String(ctx.proxy?.provider ?? '').trim() || '(none)'}`,
    ].join(' | '))

    logStep(accountId, 'START_URL_SELECTED', runConfig.startUrl)
    logStep(
      accountId,
      'START_URL_SOURCE',
      String(runConfig.startUrlSource ?? 'default'),
    )

    try {
      ;({ browser, context, page } = await createBrowserSession({
        headless: headlessForSession,
        proxy: launchProxy,
        cookies: rawCookies || undefined,
        cookieUrl: runConfig.startUrl,
      }))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (parsed.cookies.length > 0 || rawCookies) {
        failRun(accountId, state, 'cookies invalid', msg)
      } else {
        const { action, details } = classifyError(err, { phase: 'launch' })
        failRun(accountId, state, action, details)
      }
      return
    }

    state.browser = browser
    state.context = context
    if (state.cancelled) return

    logStep(
      accountId,
      'BROWSER_STARTED',
      launchProxy ? `with proxy | ${proxyLogLine}` : 'no proxy',
    )

    if (parsed.cookies.length > 0) {
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

    try {
      const dbgResp = await page.goto(DEBUG_PROXY_IP_URL, {
        waitUntil: gotoWaitUntil(),
        timeout: gotoTimeoutMs(),
      })
      const dbgStatus = dbgResp?.status() ?? null
      const dbgBody = (await page.textContent('body').catch(() => null)) ?? ''
      const snippet = String(dbgBody).replace(/\s+/g, ' ').trim().slice(0, 2000)
      console.log(`[playwright executor ${accountId}] PROXY_IP_CHECK: ${snippet}`)
      logStep(accountId, 'PROXY_IP_CHECK', snippet || '(empty)')
      if (dbgStatus === 407) {
        logStep(accountId, 'PROXY_IP_CHECK_ERROR', 'type=proxy HTTP 407 Proxy Authentication Required')
      } else if (dbgStatus != null && dbgStatus >= 400) {
        logStep(accountId, 'PROXY_IP_CHECK_ERROR', `type=network HTTP ${dbgStatus}`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const lower = msg.toLowerCase()
      let errType = 'network'
      if (lower.includes('timeout')) errType = 'timeout'
      else if (lower.includes('407') || lower.includes('proxy') || lower.includes('tunnel')) {
        errType = 'proxy'
      }
      console.error(`[playwright executor ${accountId}] PROXY_IP_CHECK_ERROR type=${errType}`, msg)
      logStep(accountId, 'PROXY_IP_CHECK_ERROR', `type=${errType} ${msg}`)
    }

    if (runConfig.platform === 'TikTok') {
      try {
        const nav = await page.goto(runConfig.startUrl, {
          waitUntil: gotoWaitUntil(),
          timeout: gotoTimeoutMs(),
        })
        const st = nav?.status() ?? null
        if (st === 407) {
          logStep(accountId, 'TIKTOK_OPEN_ERROR', 'HTTP 407')
        } else if (st != null && st >= 400) {
          logStep(accountId, 'TIKTOK_OPEN_ERROR', `HTTP ${st}`)
        }
        const u = page.url()
        const ti = (await page.title().catch(() => '')) ?? ''
        logStep(accountId, 'CURRENT_URL', u)
        logStep(accountId, 'PAGE_TITLE', ti || '(empty)')
        const auth0 = inferTikTokAuthState('TikTok', u, ti)
        logStep(accountId, 'AUTH_STATE', auth0)
        if (auth0 === 'redirected_to_login') {
          logStep(
            accountId,
            'TIKTOK_AUTH_REDIRECT',
            'cookies invalid or session expired — login/verify/captcha flow detected',
          )
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        const lower = msg.toLowerCase()
        let errType = 'network'
        if (lower.includes('timeout')) errType = 'timeout'
        else if (lower.includes('407') || lower.includes('proxy') || lower.includes('tunnel')) {
          errType = 'proxy'
        }
        logStep(accountId, 'TIKTOK_OPEN_ERROR', `type=${errType} ${msg}`)
      }
    }

    try {
      await runViewAndScrollScenario(
        page,
        (action, details) => logStep(accountId, action, details ?? ''),
        {
          startUrl: runConfig.startUrl,
          readySelector: runConfig.readySelector,
          selectors: runConfig.selectors,
          timeouts: runConfig.timeouts,
          debugScreenshots,
          platform: runConfig.platform,
          skipInitialNavigation: runConfig.platform === 'TikTok',
        },
      )
    } catch (err) {
      if (state.abortedByUser) return
      const { treatAsUserStop } = classifyError(err, { phase: 'goto' })
      if (treatAsUserStop) return
      const msg = err instanceof Error ? err.message : String(err)
      failRun(accountId, state, 'EXECUTOR_FAILED', msg)
      return
    }

    if (state.cancelled) return

    logStep(accountId, 'EXECUTOR_FINISHED', runConfig.startUrl)
    logStep(accountId, 'completed', runConfig.startUrl)
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
