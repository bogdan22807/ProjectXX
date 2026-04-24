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
import { launchBrowserSession } from './launchBrowserSession.js'
import { normalizeBrowserEngine } from './browserEngine.js'
import { db, newId } from '../db.js'
import {
  getExecutionContext,
  logStep,
  logStepChunked,
  logStructuredExecutorError,
  updateStatus,
} from './runner.js'
import { errorMessage, errorStack, serializeErrorJson } from './errorLogFormat.js'
import {
  inferTikTokAuthState,
  runViewAndScrollScenario,
} from './scenarios/viewAndScrollScenario.js'
import { runTikTokHumanFeedIteration } from './scenarios/tiktokFeedHumanScenario.js'
import { runSafeTikTokFeedIteration } from './scenarios/safeTikTokFeedMode.js'
import { ExecutorHaltError, isExecutorHaltError } from './executorHalt.js'
import { interruptibleRandomDelay, randomDelay, sleepRandom } from './asyncUtils.js'
import { isTikTokLogInControlVisible } from './foxTikTokAuth.js'

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

/**
 * Log + status for executor failures (not user stop).
 * @param {{ err?: unknown; runId?: string | null; diagnosticAction?: string; skipStructured?: boolean }} [opts]
 */
function failRun(accountId, state, action, details, opts = {}) {
  if (state.abortedByUser) return
  state.lifecycle = 'failed'
  logStepChunked(accountId, action, String(details ?? ''))
  if (opts.err != null && opts.skipStructured !== true) {
    logStructuredExecutorError(accountId, opts.diagnosticAction ?? 'EXECUTOR_ERROR', opts.err, {
      runId: opts.runId ?? state.runId,
      scope: String(action ?? ''),
    })
  }
  try {
    updateStatus(accountId, 'Error')
  } catch (statusErr) {
    logStepChunked(
      accountId,
      'UPDATE_STATUS_FAILED',
      `${errorMessage(statusErr)}\n${errorStack(statusErr)}\n${serializeErrorJson(statusErr)}`,
    )
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
  return 'unclassified'
}

const DEFAULT_TEST_PAGE_URL = 'https://www.tiktok.com/'

export function getDefaultSocialTestUrl() {
  const raw = process.env.SOCIAL_TEST_URL ?? process.env.TEST_SOCIAL_URL
  const fallback = DEFAULT_TEST_PAGE_URL
  if (raw == null || String(raw).trim() === '') return fallback
  const u = String(raw).trim()
  try {
    if (new URL(u).hostname === 'example.com') return fallback
  } catch (urlErr) {
    console.error('[getDefaultSocialTestUrl] invalid URL, using fallback', u, errorMessage(urlErr))
    console.error(errorStack(urlErr))
    console.error(serializeErrorJson(urlErr))
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
  if (options && options.maxDurationMs != null) {
    const n = Number(options.maxDurationMs)
    if (Number.isFinite(n) && n > 0) return Math.min(n, 24 * 60 * 60 * 1000)
  }
  const fromEnv = Number(process.env.PLAYWRIGHT_MAX_DURATION_MS)
  if (Number.isFinite(fromEnv) && fromEnv > 0) return Math.min(fromEnv, 24 * 60 * 60 * 1000)
  return DEFAULT_MAX_DURATION_MS
}

/**
 * @param {string} accountId
 * @param {{ targetUrl?: string; readySelector?: string; debugCheckProxy?: boolean; debugScreenshots?: boolean; headless?: boolean; maxDurationMs?: number; tiktokHumanFeedLoop?: boolean; safeTikTokFeedMode?: boolean; screenshotDir?: string; browserEngine?: string }} [options]
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
      ...(options.browserEngine != null && String(options.browserEngine).trim() !== ''
        ? { browserEngine: String(options.browserEngine).trim() }
        : {}),
    })

    logStep(
      accountId,
      'BROWSER_ENGINE_SELECTED',
      String(runConfig.browserEngine ?? 'chromium'),
    )

    const engineIsFox = normalizeBrowserEngine(runConfig.browserEngine) === 'fox'
    const profileLabel =
      String(ctx.account.login ?? '').trim() ||
      String(ctx.account.name ?? '').trim() ||
      accountId

    let pageUrl
    try {
      pageUrl = new URL(runConfig.startUrl)
    } catch (urlErr) {
      console.error('[runPlaywrightTestRun] invalid start URL', runConfig.startUrl, errorMessage(urlErr))
      console.error(errorStack(urlErr))
      console.error(serializeErrorJson(urlErr))
      throw new Error(`Invalid target URL: ${runConfig.startUrl} (${errorMessage(urlErr)})`)
    }

    /**
     * Real FYP: one `goto`, then human feed loop (no reload). Set `tiktokHumanFeedLoop: false` to force classic
     * goto+scenario loop (e.g. tests when startUrl is forced to tiktok.com).
     */
    const useTikTokFeedLoop =
      runConfig.platform === 'TikTok' &&
      pageUrl.hostname.includes('tiktok.com') &&
      options.tiktokHumanFeedLoop !== false

    /** SAFE_TIKTOK_FEED_MODE is default for TikTok FYP loop; set `TIKTOK_LEGACY_HUMAN_FEED=1` or pass `safeTikTokFeedMode: false` for old human feed. */
    const useSafeTikTokFeedMode =
      useTikTokFeedLoop &&
      options.safeTikTokFeedMode !== false &&
      String(process.env.TIKTOK_LEGACY_HUMAN_FEED ?? '').trim() !== '1'

    updateStatus(accountId, 'Running')
    logStep(
      accountId,
      'EXECUTOR_STARTED',
      `url=${runConfig.startUrl} | runId=${runId} | maxDurationMs=${maxDurationMs}${useSafeTikTokFeedMode ? ' | SAFE_TIKTOK_FEED_MODE=1' : ''}`,
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
      if (engineIsFox && runConfig.platform === 'TikTok') {
        logStep(accountId, 'FOX_AUTH_CHECK', 'cookie_parse_failed')
        logStep(accountId, 'AUTH_STATE', 'logged_out')
        logStep(accountId, 'FOX_AUTH_REQUIRED', String(parsed.invalid))
        try {
          updateStatus(accountId, 'auth_required')
        } catch (statusErr) {
          logStructuredExecutorError(accountId, 'EXECUTOR_ERROR', statusErr, {
            runId,
            scope: 'updateStatus(auth_required)',
          })
        }
        state.lifecycle = 'completed'
        logStep(
          accountId,
          'EXECUTOR_FINISHED',
          `${runConfig.startUrl} | runId=${runId} | outcome=${state.lifecycle} | fox_cookie_parse`,
        )
        logStep(accountId, 'completed', runConfig.startUrl)
        return
      }
      failRun(accountId, state, 'cookies invalid', parsed.invalid, {
        err: new Error(String(parsed.invalid)),
        runId,
      })
      return
    }

    let browser
    let context
    let page
    /** Default headless unless caller passes headless: false (e.g. test-run with visible window). */
    const headlessForSession =
      options.headless === true
        ? true
        : options.headless === false
          ? false
          : String(process.env.PLAYWRIGHT_HEADLESS ?? '').trim() === '1'
            ? true
            : String(process.env.PLAYWRIGHT_HEADLESS ?? '').trim() === '0'
              ? false
              : true

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

    logStep(
      accountId,
      'PLAYWRIGHT_LAUNCHING',
      `launchBrowserSession engine=${runConfig.browserEngine} headless=${headlessForSession ? 1 : 0} cookies=${parsed.cookies.length} hasProxy=${launchProxy ? 1 : 0}`,
    )
    const sessionPhaseToAction = {
      chromium_launch_start: 'CHROMIUM_LAUNCH_START',
      chromium_launched: 'CHROMIUM_LAUNCHED',
      context_created: 'CONTEXT_CREATED',
      cookies_applied: 'COOKIES_APPLIED',
      cookies_empty_after_parse: 'COOKIES_EMPTY_AFTER_PARSE',
      cookies_skipped: 'COOKIES_SKIPPED',
      first_page_created: 'FIRST_PAGE_READY',
      fox_proxy_connected: 'FOX_PROXY_CONNECTED',
      fox_cookies_applied: 'FOX_COOKIES_APPLIED',
      fox_python_spawn: 'FOX_PYTHON_SPAWN',
      fox_python_ok: 'FOX_PYTHON_OK',
      fox_python_failed: 'FOX_PYTHON_FAILED',
      fox_ws_connected: 'FOX_WS_CONNECTED',
      fox_window_config: 'FOX_WINDOW_CONFIG',
      fox_viewport_config: 'FOX_VIEWPORT_CONFIG',
    }
    try {
      ;({ browser, context, page } = await launchBrowserSession(
        runConfig.browserEngine,
        {
          headless: headlessForSession,
          proxy: launchProxy,
          cookies: rawCookies || undefined,
          cookieUrl: runConfig.startUrl,
          onPhase: (p, d) => {
            const action = sessionPhaseToAction[p] ?? 'BROWSER_SESSION_PHASE'
            logStep(accountId, action, d ?? '')
          },
        },
        {
          accountId,
          logStep,
          runId,
          ...(engineIsFox ? { profileLabel } : {}),
        },
      ))
      logStep(accountId, 'PLAYWRIGHT_LAUNCHED', 'launchBrowserSession finished')
    } catch (err) {
      console.error('[launchBrowserSession caller]', errorMessage(err))
      console.error(errorStack(err))
      console.error(serializeErrorJson(err))
      logStructuredExecutorError(accountId, 'PLAYWRIGHT_ERROR', err, {
        runId,
        scope: 'launchBrowserSession',
      })
      const engineNorm = normalizeBrowserEngine(runConfig.browserEngine)
      if (engineNorm === 'fox') {
        /** @type {{ foxStderr?: string; foxStdout?: string }} */
        const foxErr = err
        const stderr = foxErr?.foxStderr != null ? String(foxErr.foxStderr) : ''
        const stdout = foxErr?.foxStdout != null ? String(foxErr.foxStdout) : ''
        logStepChunked(
          accountId,
          'FOX_PYTHON_ERROR',
          stderr || `stderr empty; stdout=\n${stdout}\nserialized=\n${serializeErrorJson(err)}`,
        )
        logStepChunked(
          accountId,
          'PYTHON_TRACEBACK',
          stderr || `no python stderr captured; ${serializeErrorJson(err)}`,
        )
        logStructuredExecutorError(accountId, 'FOX_RUNNER_ERROR', err, { runId, scope: 'fox_launch' })
      }
      const msg = err instanceof Error ? err.message : String(err)
      if (parsed.cookies.length > 0 || rawCookies) {
        failRun(accountId, state, 'cookies invalid', msg, { err, runId, skipStructured: true })
      } else {
        const { action, details } = classifyError(err, { phase: 'launch' })
        failRun(accountId, state, action, details, { err, runId, skipStructured: true })
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
            { err: new Error('HTTP 407 from proxy on ipify'), runId },
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
            { err: new Error('HTTP 407 from proxy on httpbin'), runId },
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
          { err, runId },
        )
        return
      } finally {
        try {
          await diagPage?.close()
        } catch (closeErr) {
          logStructuredExecutorError(accountId, 'PLAYWRIGHT_ERROR', closeErr, {
            runId,
            scope: 'diagPage.close',
          })
        }
      }
    }

    /** TikTok FYP: single navigation; loop uses scroll only (no goto/reload). */
    if (useTikTokFeedLoop) {
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

        if (engineIsFox && runConfig.platform === 'TikTok') {
          logStep(accountId, 'FOX_AUTH_CHECK', 'after_goto_foryou')
          const noSessionCookies = rawCookies === '' || parsed.cookies.length === 0
          if (noSessionCookies) {
            logStep(accountId, 'AUTH_STATE', 'logged_out')
            logStep(accountId, 'FOX_AUTH_REQUIRED', 'no_cookies_or_empty_after_parse')
            try {
              updateStatus(accountId, 'auth_required')
            } catch (statusErr) {
              logStructuredExecutorError(accountId, 'EXECUTOR_ERROR', statusErr, {
                runId,
                scope: 'updateStatus(auth_required)',
              })
            }
            state.lifecycle = 'completed'
            logStep(
              accountId,
              'EXECUTOR_FINISHED',
              `${runConfig.startUrl} | runId=${runId} | outcome=${state.lifecycle} | fox_no_cookies`,
            )
            logStep(accountId, 'completed', runConfig.startUrl)
            return
          }

          const inferred = inferTikTokAuthState('TikTok', u, ti)
          let loginVisible = false
          try {
            loginVisible = await isTikTokLogInControlVisible(page)
          } catch {
            loginVisible = false
          }
          if (loginVisible) {
            logStep(accountId, 'FOX_LOGIN_VISIBLE', 'header_or_nav_log_in')
          }
          if (loginVisible || inferred === 'redirected_to_login') {
            logStep(accountId, 'AUTH_STATE', 'logged_out')
            logStep(
              accountId,
              'FOX_AUTH_REQUIRED',
              loginVisible ? 'log_in_control_visible' : 'redirect_or_challenge_flow',
            )
            try {
              updateStatus(accountId, 'auth_required')
            } catch (statusErr) {
              logStructuredExecutorError(accountId, 'EXECUTOR_ERROR', statusErr, {
                runId,
                scope: 'updateStatus(auth_required)',
              })
            }
            state.lifecycle = 'completed'
            logStep(
              accountId,
              'EXECUTOR_FINISHED',
              `${runConfig.startUrl} | runId=${runId} | outcome=${state.lifecycle} | fox_auth_required`,
            )
            logStep(accountId, 'completed', runConfig.startUrl)
            return
          }

          logStep(accountId, 'AUTH_STATE', 'logged_in')
          logStep(accountId, 'FOX_AUTH_OK', 'no_log_in_control_session_ok')
        } else {
          const auth0 = inferTikTokAuthState('TikTok', u, ti)
          logStep(accountId, 'AUTH_STATE', auth0)
          if (auth0 === 'redirected_to_login') {
            logStep(
              accountId,
              'TIKTOK_AUTH_REDIRECT',
              'cookies invalid or session expired — login/verify/captcha flow detected',
            )
          }
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
        if (engineIsFox && runConfig.platform === 'TikTok') {
          logStep(accountId, 'FOX_AUTH_CHECK', 'goto_failed')
          logStep(accountId, 'FOX_AUTH_REQUIRED', `navigation_error type=${errType}`)
          try {
            updateStatus(accountId, 'auth_required')
          } catch (statusErr) {
            logStructuredExecutorError(accountId, 'EXECUTOR_ERROR', statusErr, {
              runId,
              scope: 'updateStatus(auth_required)',
            })
          }
          state.lifecycle = 'completed'
          logStep(
            accountId,
            'EXECUTOR_FINISHED',
            `${runConfig.startUrl} | runId=${runId} | outcome=${state.lifecycle} | fox_open_failed`,
          )
          logStep(accountId, 'completed', runConfig.startUrl)
          return
        }
      }
      const haltAfterOpen = await shouldHalt()
      if (haltAfterOpen === 'max_duration') {
        logStep(accountId, 'MAX_DURATION_REACHED', `runId=${runId} elapsedMs=${elapsedMs()}`)
        state.lifecycle = 'max_duration_reached'
        logStep(accountId, 'EXECUTOR_STOPPED', `reason=max_duration_reached runId=${runId} iterations=0`)
        logStep(
          accountId,
          'EXECUTOR_FINISHED',
          `${runConfig.startUrl} | runId=${runId} | outcome=${state.lifecycle}`,
        )
        logStep(accountId, 'completed', runConfig.startUrl)
        updateStatus(accountId, 'Ready')
        return
      }
      if (haltAfterOpen === 'stop') {
        state.lifecycle = 'stopped'
        logStep(accountId, 'EXECUTOR_STOPPED', `reason=stopped runId=${runId} iterations=0`)
        logStep(
          accountId,
          'EXECUTOR_FINISHED',
          `${runConfig.startUrl} | runId=${runId} | outcome=${state.lifecycle}`,
        )
        logStep(accountId, 'completed', runConfig.startUrl)
        updateStatus(accountId, 'Ready')
        return
      }
      logStep(accountId, 'WAITING', 'initial TikTok settle 3–7s')
      try {
        await interruptibleRandomDelay(3000, 7000, shouldHalt)
      } catch (e) {
        if (isExecutorHaltError(e)) {
          if (e.reason === 'max_duration') {
            logStep(accountId, 'MAX_DURATION_REACHED', `runId=${runId} elapsedMs=${elapsedMs()}`)
            state.lifecycle = 'max_duration_reached'
          } else {
            state.lifecycle = 'stopped'
          }
          logStep(
            accountId,
            'EXECUTOR_STOPPED',
            `reason=${state.lifecycle} runId=${runId} iterations=0`,
          )
          logStep(
            accountId,
            'EXECUTOR_FINISHED',
            `${runConfig.startUrl} | runId=${runId} | outcome=${state.lifecycle}`,
          )
          logStep(accountId, 'completed', runConfig.startUrl)
          updateStatus(accountId, 'Ready')
          return
        }
        throw e
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

        if (useTikTokFeedLoop) {
          try {
            if (useSafeTikTokFeedMode) {
              await runSafeTikTokFeedIteration(
                page,
                (action, details) => logStep(accountId, action, details ?? ''),
                shouldHalt,
                {
                  debugScreenshots,
                  screenshotDir: options.screenshotDir,
                },
              )
            } else {
              await runTikTokHumanFeedIteration(
                page,
                (action, details) => logStep(accountId, action, details ?? ''),
                shouldHalt,
                {
                  debugScreenshots,
                  screenshotDir: options.screenshotDir,
                },
              )
            }
          } catch (err) {
            if (isExecutorHaltError(err)) {
              if (err.reason === 'max_duration') {
                logStep(accountId, 'MAX_DURATION_REACHED', `runId=${runId} elapsedMs=${elapsedMs()} phase=tiktok_feed`)
                state.lifecycle = 'max_duration_reached'
                loopExitReason = 'max_duration_reached'
              } else if (err.reason === 'challenge') {
                logStep(
                  accountId,
                  'EXECUTOR_STOPPED',
                  `reason=challenge_detected runId=${runId} phase=tiktok_feed`,
                )
                try {
                  updateStatus(accountId, 'challenge_detected')
                } catch (statusErr) {
                  logStructuredExecutorError(accountId, 'EXECUTOR_ERROR', statusErr, {
                    runId,
                    scope: 'updateStatus(challenge_detected)',
                  })
                }
                state.lifecycle = 'stopped'
                loopExitReason = 'stopped'
              } else {
                state.lifecycle = 'stopped'
                loopExitReason = 'stopped'
              }
              break
            }
            const msg = err instanceof Error ? err.message : String(err)
            logStepChunked(accountId, 'TIKTOK_FEED_ERROR', msg)
            logStructuredExecutorError(accountId, 'PLAYWRIGHT_ERROR', err, {
              runId,
              scope: 'tiktok_feed_iteration',
            })
          }
        } else if (runConfig.platform === 'TikTok') {
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
        } else {
          try {
            const nav = await page.goto(runConfig.startUrl, {
              waitUntil: gotoWaitUntil(),
              timeout: gotoTimeoutMs(),
            })
            const st = nav?.status() ?? null
            if (st === 407) {
              logStep(accountId, 'PAGE_OPEN_ERROR', 'HTTP 407')
            } else if (st != null && st >= 400) {
              logStep(accountId, 'PAGE_OPEN_ERROR', `HTTP ${st}`)
            }
            const u = page.url()
            const ti = (await page.title().catch(() => '')) ?? ''
            logStep(accountId, 'CURRENT_URL', u)
            logStep(accountId, 'PAGE_TITLE', ti || '(empty)')
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            const lower = msg.toLowerCase()
            let errType = 'network'
            if (lower.includes('timeout')) errType = 'timeout'
            else if (lower.includes('407') || lower.includes('proxy') || lower.includes('tunnel')) {
              errType = 'proxy'
            }
            logStep(accountId, 'PAGE_OPEN_ERROR', `type=${errType} ${msg}`)
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
          if (!useTikTokFeedLoop) {
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
          }
        } catch (err) {
          if (isExecutorHaltError(err)) {
            if (err.reason === 'max_duration') {
              logStep(accountId, 'MAX_DURATION_REACHED', `runId=${runId} elapsedMs=${elapsedMs()} phase=scenario`)
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
          logStructuredExecutorError(accountId, 'PLAYWRIGHT_ERROR', err, {
            runId,
            scope: 'runViewAndScrollScenario',
          })
          failRun(accountId, state, 'EXECUTOR_FAILED', msg, { err, runId, skipStructured: true })
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
    console.error('[runPlaywrightTestRun]', errorMessage(err))
    console.error(errorStack(err))
    console.error(serializeErrorJson(err))
    if (state.abortedByUser) {
      return
    }
    logStructuredExecutorError(accountId, 'PLAYWRIGHT_ERROR', err, {
      runId,
      scope: 'runPlaywrightTestRun',
    })
    const msg = err instanceof Error ? err.message : String(err)
    const { action, details, treatAsUserStop } = classifyError(err, { phase: 'unknown' })
    if (treatAsUserStop) return
    failRun(accountId, state, action, details, { err, runId, skipStructured: true })
  } finally {
    const run = playwrightRuns.get(accountId)
    if (run) {
      run.sleepWake?.()
      run.sleepWake = null
      try {
        await run.context?.close()
      } catch (closeErr) {
        logStructuredExecutorError(accountId, 'PLAYWRIGHT_ERROR', closeErr, {
          runId: run.runId,
          scope: 'finally.context.close',
        })
      }
      try {
        await run.browser?.close()
      } catch (closeErr) {
        logStructuredExecutorError(accountId, 'PLAYWRIGHT_ERROR', closeErr, {
          runId: run.runId,
          scope: 'finally.browser.close',
        })
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
  } catch (closeErr) {
    logStructuredExecutorError(accountId, 'PLAYWRIGHT_ERROR', closeErr, {
      runId: run.runId,
      scope: 'abort.context.close',
    })
  }
  try {
    await run.browser?.close()
  } catch (closeErr) {
    logStructuredExecutorError(accountId, 'PLAYWRIGHT_ERROR', closeErr, {
      runId: run.runId,
      scope: 'abort.browser.close',
    })
  }
  logStep(accountId, 'EXECUTOR_STOPPED', `reason=force_abort runId=${run.runId}`)
  return true
}
