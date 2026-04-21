/**
 * Playwright test run for an in-house / test social URL only.
 * Stable single-account flow: launch → proxy → cookies → page → optional ready selector → scroll → done.
 */

import {
  describeLaunchProxySafe,
  describeProxyForLog,
  formatProxyDiagnosticDetail,
  proxySchemeForDiagnostics,
} from './proxyConfig.js'
import { buildExecutorRunConfigFromContext } from './executorRunConfig.js'
import { parseCookiesForUrlStrict } from './cookieParse.js'
import { createBrowserSession } from './createBrowserSession.js'
import { db, newId } from '../db.js'
import { getExecutionContext, logStep, updateStatus } from './runner.js'
import {
  inferTikTokAuthState,
  runViewAndScrollScenario,
} from './scenarios/viewAndScrollScenario.js'
import { ExecutorHaltError, isExecutorHaltError } from './executorHalt.js'
import { sleepRandom } from './asyncUtils.js'

/**
 * @typedef {'idle' | 'running' | 'stop_requested' | 'stopped' | 'completed' | 'failed' | 'max_duration_reached'} ExecutorLifecycle
 */

/**
 * @typedef {{
 *   cancelled: boolean
 *   abortedByUser: boolean
 *   stopRequested: boolean
 *   forceAbort: boolean
 *   lifecycle: ExecutorLifecycle
 *   runId: string
 *   startedAt: number
 *   maxDurationMs: number
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
  state.lifecycle = 'failed'
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

/**
 * @param {string} msg
 * @param {string} [phase]
 */
function classifyProxyConnectivityFailure(msg, phase = '') {
  const lower = msg.toLowerCase()
  const p = phase.toLowerCase()
  if (lower.includes('407') || lower.includes('proxy authentication')) {
    return 'invalid_auth'
  }
  if (lower.includes('net::err_invalid_auth_credentials')) {
    return 'invalid_auth'
  }
  if (lower.includes('econnrefused') || lower.includes('enotfound') || lower.includes('eaddrnotavail')) {
    return 'network'
  }
  if (lower.includes('err_proxy') || lower.includes('tunnel') || lower.includes('proxy connection')) {
    return 'proxy'
  }
  if (lower.includes('timeout') || p.includes('timeout')) {
    return 'timeout'
  }
  if (lower.includes('proxy')) {
    return 'proxy'
  }
  return 'unknown'
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

const DEFAULT_MAX_DURATION_MS = 900_000

/**
 * Graceful stop: scenario exits on next shouldAbort check; logs STOP_REQUESTED.
 * @param {string} accountId
 * @returns {boolean}
 */
export function requestPlaywrightStop(accountId) {
  const run = playwrightRuns.get(accountId)
  if (!run) return false
  run.stopRequested = true
  run.lifecycle = 'stop_requested'
  logStep(accountId, 'STOP_REQUESTED', run.runId)
  return true
}

/**
 * @param {string} accountId
 * @returns {{ lifecycle: ExecutorLifecycle, runId: string, startedAt: number, maxDurationMs: number } | null}
 */
export function getPlaywrightRunMeta(accountId) {
  const run = playwrightRuns.get(accountId)
  if (!run) return null
  return {
    lifecycle: run.lifecycle,
    runId: run.runId,
    startedAt: run.startedAt,
    maxDurationMs: run.maxDurationMs,
  }
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

function resolveMaxDurationMs(options) {
  const raw = options?.maxDurationMs ?? process.env.PLAYWRIGHT_MAX_DURATION_MS
  const n = Number(raw)
  if (Number.isFinite(n) && n > 0) return Math.min(n, 24 * 60 * 60 * 1000)
  return DEFAULT_MAX_DURATION_MS
}

/**
 * @param {string} accountId
 * @param {{ targetUrl?: string; readySelector?: string; debugCheckProxy?: boolean; debugScreenshots?: boolean; headless?: boolean; maxDurationMs?: number }} [options]
 */
export async function runPlaywrightTestRun(accountId, options = {}) {
  if (playwrightRuns.has(accountId)) {
    throw new Error('Playwright test run already active for this account')
  }

  const runId = newId('run')
  const startedAt = Date.now()
  const maxDurationMs = resolveMaxDurationMs(options)

  /** @type {PlaywrightRunState} */
  const state = {
    cancelled: false,
    abortedByUser: false,
    stopRequested: false,
    forceAbort: false,
    lifecycle: 'running',
    runId,
    startedAt,
    maxDurationMs,
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
    logStep(
      accountId,
      'EXECUTOR_STARTED',
      `url=${runConfig.startUrl} | runId=${runId} | maxDurationMs=${maxDurationMs}`,
    )

    const elapsedMs = () => Date.now() - startedAt
    /** @returns {Promise<false | 'stop' | 'max_duration'>} */
    async function shouldHalt() {
      if (state.forceAbort || state.cancelled) return 'stop'
      if (elapsedMs() >= maxDurationMs) return 'max_duration'
      if (state.stopRequested) return 'stop'
      return false
    }

    const launchProxy = runConfig.proxy ?? undefined

    const sourceLabel =
      runConfig.proxySource === 'database'
        ? 'database'
        : runConfig.proxySource === 'env'
          ? 'env'
          : 'none'
    const schemeLabel = launchProxy
      ? proxySchemeForDiagnostics(ctx.proxy, launchProxy)
      : 'none'
    const hasLaunchUser =
      launchProxy?.username != null && String(launchProxy.username).trim() !== ''
    const hasLaunchPass =
      launchProxy?.password != null && String(launchProxy.password).trim() !== ''
    const authMode =
      hasLaunchUser && hasLaunchPass ? 'username_password' : 'none'
    const proxyDetailFormatted = launchProxy
      ? formatProxyDiagnosticDetail(launchProxy)
      : 'server=(none) user=(omitted)'

    logStep(accountId, 'PROXY_SOURCE', sourceLabel)
    logStep(accountId, 'PROXY_SCHEME', schemeLabel)
    logStep(accountId, 'PROXY_AUTH_MODE', authMode)
    logStep(accountId, 'PROXY_DETAIL', proxyDetailFormatted)

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
    logStep(accountId, 'PROXY_DETAIL_VERBOSE', proxyDetail)

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
      let diagPage
      try {
        diagPage = await context.newPage()
        const ipResp = await diagPage.goto(IPIFY_URL, {
          waitUntil: gotoWaitUntil(),
          timeout: ipifyMs,
        })
        const ipStatus = ipResp?.status() ?? null
        if (ipStatus === 407) {
          const errType = 'invalid_auth'
          logStep(
            accountId,
            'PROXY_CONNECTIVITY_FAILED',
            `phase=ipify type=${errType} HTTP 407`,
          )
          failRun(
            accountId,
            state,
            'proxy authentication rejected',
            'HTTP 407 from proxy on HTTPS request — Chromium did not get a valid authenticated tunnel. Fix credentials/session (SOAX sub-user, whitelist IP) or proxy product type; not a page.goto URL bug.',
          )
          return
        }
        const ipText = (await diagPage.textContent('body').catch(() => '')) ?? ''
        const ipSnippet = String(ipText).replace(/\s+/g, ' ').trim().slice(0, 500)
        logStep(
          accountId,
          'PROXY_IP_CHECK',
          `url=${IPIFY_URL} HTTP ${ipStatus ?? '?'} body=${ipSnippet || '(empty)'}`,
        )

        const hbResp = await diagPage.goto(DEBUG_PROXY_IP_URL, {
          waitUntil: gotoWaitUntil(),
          timeout: gotoTimeoutMs(),
        })
        const hbStatus = hbResp?.status() ?? null
        if (hbStatus === 407) {
          const errType = 'invalid_auth'
          logStep(
            accountId,
            'PROXY_CONNECTIVITY_FAILED',
            `phase=httpbin type=${errType} HTTP 407`,
          )
          failRun(
            accountId,
            state,
            'proxy authentication rejected',
            'HTTP 407 from proxy on HTTPS request (httpbin) — check credentials or whitelist.',
          )
          return
        }
        const hbBody = (await diagPage.textContent('body').catch(() => null)) ?? ''
        const hbSnippet = String(hbBody).replace(/\s+/g, ' ').trim().slice(0, 2000)
        logStep(
          accountId,
          'PROXY_IP_CHECK',
          `url=${DEBUG_PROXY_IP_URL} HTTP ${hbStatus ?? '?'} body=${hbSnippet || '(empty)'}`,
        )
        logStep(accountId, 'PROXY_CONNECTIVITY_OK', 'ipify_then_httpbin')
      } catch (err) {
        if (state.abortedByUser) return
        const msg = err instanceof Error ? err.message : String(err)
        const errType = classifyProxyConnectivityFailure(msg, 'goto')
        logStep(accountId, 'PROXY_CONNECTIVITY_FAILED', `phase=ipify_or_httpbin type=${errType} ${msg}`)
        const { action, details, treatAsUserStop } = classifyError(err, { phase: 'goto' })
        if (treatAsUserStop) return
        failRun(
          accountId,
          state,
          action === 'page load timeout' ? 'proxy connectivity failed (ipify/httpbin)' : action,
          `${details} — if credentials/host/port are correct, the proxy is likely unreachable, wrong scheme (try PLAYWRIGHT_PROXY_SCHEME=socks5), or blocked.`,
        )
        return
      } finally {
        try {
          await diagPage?.close()
        } catch {
          /* ignore */
        }
      }
    }

    let loopIteration = 0
    /** @type {'completed' | 'stopped' | 'max_duration_reached' | 'failed' | null} */
    let loopExitReason = null

    for (;;) {
        const halt = await shouldHalt()
        if (halt === 'max_duration') {
          logStep(accountId, 'MAX_DURATION_REACHED', `runId=${runId} elapsedMs=${elapsedMs()}`)
          state.lifecycle = 'max_duration_reached'
          loopExitReason = 'max_duration_reached'
          break
        }
        if (halt === 'stop') {
          state.lifecycle = 'stopped'
          loopExitReason = 'stopped'
          break
        }

        loopIteration += 1
        logStep(
          accountId,
          'LOOP_ITERATION_STARTED',
          `iteration=${loopIteration} runId=${runId} elapsedMs=${elapsedMs()}`,
        )

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

        const haltMid = await shouldHalt()
        if (haltMid === 'max_duration') {
          logStep(accountId, 'MAX_DURATION_REACHED', `runId=${runId} elapsedMs=${elapsedMs()}`)
          state.lifecycle = 'max_duration_reached'
          loopExitReason = 'max_duration_reached'
          break
        }
        if (haltMid === 'stop') {
          state.lifecycle = 'stopped'
          loopExitReason = 'stopped'
          break
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
              shouldAbort: shouldHalt,
              onAfterBlock: async () => {
                const h = await shouldHalt()
                if (h === 'max_duration') {
                  logStep(accountId, 'MAX_DURATION_REACHED', `runId=${runId} elapsedMs=${elapsedMs()}`)
                  throw new ExecutorHaltError('max_duration')
                }
                if (h === 'stop') {
                  throw new ExecutorHaltError('stop')
                }
              },
            },
          )
        } catch (err) {
          if (isExecutorHaltError(err)) {
            if (err.reason === 'max_duration') {
              state.lifecycle = 'max_duration_reached'
              loopExitReason = 'max_duration_reached'
            } else {
              state.lifecycle = 'stopped'
              loopExitReason = 'stopped'
            }
            break
          }
          if (state.abortedByUser) return
          const { treatAsUserStop } = classifyError(err, { phase: 'goto' })
          if (treatAsUserStop) return
          const msg = err instanceof Error ? err.message : String(err)
          failRun(accountId, state, 'EXECUTOR_FAILED', msg)
          loopExitReason = 'failed'
          return
        }

        const haltAfter = await shouldHalt()
        if (haltAfter === 'max_duration') {
          logStep(accountId, 'MAX_DURATION_REACHED', `runId=${runId} elapsedMs=${elapsedMs()}`)
          state.lifecycle = 'max_duration_reached'
          loopExitReason = 'max_duration_reached'
          break
        }
        if (haltAfter === 'stop') {
          state.lifecycle = 'stopped'
          loopExitReason = 'stopped'
          break
        }

        logStep(accountId, 'WAITING', 'between loop iterations 2000–5000ms')
        await sleepRandom(2000, 5000)
    }

    if (state.cancelled && state.forceAbort) return

    if (loopExitReason === 'stopped' || loopExitReason === 'max_duration_reached') {
      logStep(accountId, 'EXECUTOR_STOPPED', `reason=${loopExitReason} runId=${runId} iterations=${loopIteration}`)
    }

    if (state.lifecycle === 'failed') return

    if (loopExitReason === 'stopped' || loopExitReason === 'max_duration_reached') {
      state.lifecycle = loopExitReason === 'stopped' ? 'stopped' : 'max_duration_reached'
    } else {
      state.lifecycle = 'completed'
    }

    logStep(accountId, 'EXECUTOR_FINISHED', `${runConfig.startUrl} | runId=${runId} | outcome=${state.lifecycle}`)
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

/**
 * Hard abort: closes browser immediately (e.g. test-run /abort). Prefer /warmup/stop for graceful loop exit.
 */
export async function abortPlaywrightTestRun(accountId) {
  const run = playwrightRuns.get(accountId)
  if (!run) return false
  run.forceAbort = true
  run.cancelled = true
  run.abortedByUser = true
  run.lifecycle = 'stopped'
  logStep(accountId, 'STOP_REQUESTED', `${run.runId} (force abort)`)
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
  logStep(accountId, 'EXECUTOR_STOPPED', `reason=force_abort runId=${run.runId}`)
  return true
}
