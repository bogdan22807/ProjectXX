/**
 * Fox / Camoufox path — Python bridge launches Camoufox WS server; Node connects via Playwright firefox.connect.
 */

import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { firefox } from 'playwright'
import { parseCookiesForUrlStrict } from './cookieParse.js'
import {
  errorMessage,
  errorStack,
  formatStructuredErrorDetails,
  serializeErrorJson,
} from './errorLogFormat.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CREATE_BROWSER_SCRIPT = path.join(__dirname, 'CreateBrowse.py')

/**
 * @param {import('playwright').Browser} browser
 * @param {number | null} serverPid
 */
function wrapBrowserCloseForFoxServer(browser, serverPid) {
  if (serverPid == null || serverPid <= 0) return
  const orig = browser.close.bind(browser)
  browser.close = async (...args) => {
    try {
      await orig(...args)
    } finally {
      try {
        process.kill(serverPid, 'SIGTERM')
      } catch {
        /* process may already exit */
      }
    }
  }
}

/**
 * Last complete JSON object on a line in buffer (for stdout parsing).
 * @param {string} buf
 * @returns {{ obj: Record<string, unknown> | null; rest: string }}
 */
function extractLastJsonLine(buf) {
  const lines = buf.split('\n')
  let rest = ''
  /** @type {Record<string, unknown> | null} */
  let last = null
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim()
    if (!line) continue
    try {
      last = /** @type {Record<string, unknown>} */ (JSON.parse(line))
      rest = lines.slice(i + 1).join('\n')
    } catch {
      /* not JSON — keep scanning */
    }
  }
  return { obj: last, rest }
}

const DEFAULT_FOX_OUTER_W = 1366
const DEFAULT_FOX_OUTER_H = 768

/**
 * TikTok-friendly layout: outer window 1366×768, inner viewport 1280×720 or 1366×768, DPR 1.
 * Env: FOX_VIEWPORT_PRESET = `1280x720` | `1366x768` (default 1366x768).
 * Env: FOX_WINDOW_WIDTH, FOX_WINDOW_HEIGHT (default 1366×768) — passed to Python for Camoufox fingerprint screen/window.
 * @returns {{ outerW: number; outerH: number; viewportW: number; viewportH: number }}
 */
function parseFoxDisplayLayout() {
  const outerW = Math.min(
    3840,
    Math.max(800, Number(process.env.FOX_WINDOW_WIDTH) || DEFAULT_FOX_OUTER_W),
  )
  const outerH = Math.min(
    2160,
    Math.max(600, Number(process.env.FOX_WINDOW_HEIGHT) || DEFAULT_FOX_OUTER_H),
  )
  const preset = String(process.env.FOX_VIEWPORT_PRESET ?? '1366x768')
    .trim()
    .toLowerCase()
    .replace(/×/g, 'x')
    .replace(/\s+/g, '')
  let viewportW = outerW
  let viewportH = outerH
  if (preset === '1280x720') {
    viewportW = 1280
    viewportH = 720
  }
  viewportW = Math.min(viewportW, outerW)
  viewportH = Math.min(viewportH, outerH)
  return { outerW, outerH, viewportW, viewportH }
}

/**
 * @param {{
 *   headless?: boolean
 *   proxy?: import('playwright').BrowserContextOptions['proxy'] | null
 *   cookies?: string
 *   cookieUrl?: string
 *   skipCookies?: boolean
 *   userAgent?: string
 *   onPhase?: (phase: string, detail?: string) => void
 * }} config
 * @param {{ accountId?: string | null; runId?: string | null; profileLabel?: string | null }} [ctx]
 * @returns {Promise<{ browser: import('playwright').Browser, context: import('playwright').BrowserContext, page: import('playwright').Page }>}
 */
export async function launchFoxBrowserSession(config, ctx = {}) {
  const phase =
    typeof config?.onPhase === 'function'
      ? /** @type {(p: string, d?: string) => void} */ (config.onPhase)
      : () => {}

  const accountId = ctx.accountId ?? null
  const runId = ctx.runId ?? null

  const logFox = (line) => {
    console.error(`[foxRunner] ${line}`)
  }

  try {
    phase('fox_python_spawn', CREATE_BROWSER_SCRIPT)

    const pyBin = String(process.env.FOX_PYTHON ?? process.env.PYTHON ?? 'python3').trim() || 'python3'

    const profileFromCtx =
      ctx.profileLabel != null && String(ctx.profileLabel).trim() !== ''
        ? String(ctx.profileLabel).trim()
        : ''
    const username =
      profileFromCtx ||
      String(process.env.FOX_USERNAME ?? ctx.accountId ?? 'default').trim() ||
      'default'
    const headless =
      config.headless !== undefined
        ? Boolean(config.headless)
        : String(process.env.FOX_HEADLESS ?? '1').trim() !== '0'

    const actionsRaw = String(process.env.FOX_ACTIONS_JSON ?? '').trim()
    /** @type {unknown} */
    let actions = null
    if (actionsRaw) {
      try {
        actions = JSON.parse(actionsRaw)
      } catch (e) {
        throw new Error(`FOX_ACTIONS_JSON is not valid JSON: ${errorMessage(e)}`)
      }
    }

    const bridgePayload = {
      username,
      headless,
      proxy: config.proxy ?? null,
      userAgent: config.userAgent && String(config.userAgent).trim() ? String(config.userAgent).trim() : null,
      actions,
    }

    const launchProxy = config.proxy ?? null

    const { outerW, outerH, viewportW, viewportH } = parseFoxDisplayLayout()
    phase(
      'fox_window_config',
      `outer=${outerW}x${outerH} (FOX_WINDOW_WIDTH/HEIGHT; Camoufox launch_options window + screen)`,
    )
    phase(
      'fox_viewport_config',
      `viewport=${viewportW}x${viewportH} deviceScaleFactor=1 (Playwright context; FOX_VIEWPORT_PRESET)`,
    )

    const child = spawn(pyBin, [CREATE_BROWSER_SCRIPT], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        FOX_BRIDGE_JSON: JSON.stringify(bridgePayload),
        FOX_WINDOW_WIDTH: String(outerW),
        FOX_WINDOW_HEIGHT: String(outerH),
      },
    })

    const payloadLine = `${JSON.stringify(bridgePayload)}\n`
    child.stdin?.write(payloadLine)
    child.stdin?.end()

    let stdoutBuf = ''
    let stderrBuf = ''

    const exitCode = await new Promise((resolve, reject) => {
      child.stdout?.on('data', (chunk) => {
        const s = chunk.toString()
        stdoutBuf += s
        logFox(`PYTHON_STDOUT_CHUNK ${s}`)
      })
      child.stderr?.on('data', (chunk) => {
        const s = chunk.toString()
        stderrBuf += s
        logFox(`PYTHON_STDERR_CHUNK ${s}`)
      })
      child.on('error', reject)
      child.on('close', (code) => resolve(code ?? 0))
    })

    logFox(`PYTHON_STDOUT_FULL\n${stdoutBuf || '(empty)'}`)
    logFox(`PYTHON_STDERR_FULL\n${stderrBuf || '(empty)'}`)

    const { obj: parsed } = extractLastJsonLine(stdoutBuf)

    if (exitCode !== 0 || !parsed || typeof parsed.error === 'string') {
      const synthetic = new Error(
        `Fox Python exited with code ${exitCode}. See FOX_PYTHON_ERROR / PYTHON_TRACEBACK logs.`,
      )
      synthetic.name = 'FoxPythonExitError'
      const errMsg = parsed && typeof parsed.error === 'string' ? parsed.error : ''
      const errTrace = parsed && typeof parsed.trace === 'string' ? parsed.trace : ''
      const details = [
        `FOX_PYTHON_ERROR exitCode=${exitCode}`,
        errMsg && `PARSED_ERROR=${errMsg}`,
        errTrace && `PARSED_TRACE=${errTrace}`,
        `STDERR=\n${stderrBuf || '(empty)'}`,
        `STDOUT=\n${stdoutBuf || '(empty)'}`,
        formatStructuredErrorDetails({
          err: synthetic,
          scope: 'launchFoxBrowserSession',
          accountId,
          runId,
        }),
      ]
        .filter(Boolean)
        .join('\n')
      logFox(details)
      phase('fox_python_failed', `exit=${exitCode}`)
      const err = new Error(details)
      err.cause = synthetic
      /** @type {Error & { foxStderr?: string; foxStdout?: string }} */
      const enriched = err
      enriched.foxStderr = stderrBuf
      enriched.foxStdout = stdoutBuf
      throw enriched
    }

    const wsEndpoint = parsed.wsEndpoint
    const camPid = parsed.camoufoxServerPid
    if (typeof wsEndpoint !== 'string' || !wsEndpoint.startsWith('ws')) {
      const bad = new Error(
        `Fox bridge returned invalid payload (missing wsEndpoint): ${JSON.stringify(parsed)}`,
      )
      bad.name = 'FoxBridgePayloadError'
      throw bad
    }

    phase('fox_python_ok', `wsEndpoint=${wsEndpoint.slice(0, 48)}…`)

    const connectTimeout = Math.min(
      120_000,
      Math.max(10_000, Number(process.env.FOX_WS_CONNECT_TIMEOUT_MS) || 60_000),
    )
    const browser = await firefox.connect(wsEndpoint, { timeout: connectTimeout })
    const serverPid = typeof camPid === 'number' && Number.isFinite(camPid) ? camPid : null
    wrapBrowserCloseForFoxServer(browser, serverPid)

    for (const c of browser.contexts()) {
      try {
        await c.close()
      } catch {
        /* ignore */
      }
    }

    /** @type {import('playwright').BrowserContextOptions} */
    const foxContextOpts = {
      ignoreHTTPSErrors: process.env.PLAYWRIGHT_IGNORE_HTTPS_ERRORS === '1',
      viewport: { width: viewportW, height: viewportH },
      deviceScaleFactor: 1,
      screen: { width: outerW, height: outerH },
    }
    const context = await browser.newContext(foxContextOpts)

    if (launchProxy) {
      phase('fox_proxy_connected', 'proxy active on Camoufox launch')
    } else {
      phase('fox_proxy_connected', 'no proxy')
    }

    const cookieBase =
      String(config.cookieUrl ?? '').trim() || 'https://www.tiktok.com/foryou'
    let cookieUrl
    try {
      cookieUrl = new URL(cookieBase)
    } catch (urlErr) {
      const bad = new Error(`Invalid cookieUrl for fox: ${cookieBase} (${errorMessage(urlErr)})`)
      bad.name = 'FoxCookieUrlError'
      throw bad
    }

    const skipCookies = config.skipCookies === true
    const rawCookies = String(config.cookies ?? '').trim()
    if (skipCookies) {
      phase('fox_cookies_applied', 'skipped_profile_or_explicit_skip')
    } else if (rawCookies) {
      const parsed = parseCookiesForUrlStrict(rawCookies, cookieUrl)
      if (parsed.invalid) {
        const err = new Error(parsed.invalid)
        err.name = 'FoxCookiesInvalidError'
        throw err
      }
      if (parsed.cookies.length > 0) {
        await context.addCookies(parsed.cookies)
        phase('fox_cookies_applied', `${parsed.cookies.length}`)
      } else {
        phase('fox_cookies_applied', '0 parsed_empty')
      }
    } else {
      phase('fox_cookies_applied', 'skipped_empty_string')
    }

    for (const p of context.pages()) {
      try {
        await p.close()
      } catch {
        /* ignore */
      }
    }
    const page = await context.newPage()

    phase('fox_ws_connected', `pid=${serverPid ?? 'unknown'}`)

    return { browser, context, page }
  } catch (err) {
    const msg = errorMessage(err)
    const stack = errorStack(err)
    const json = serializeErrorJson(err)
    console.error('[FOX_RUNNER_ERROR]', msg)
    console.error(stack)
    console.error(json)
    const structured = formatStructuredErrorDetails({
      err,
      scope: 'launchFoxBrowserSession',
      accountId,
      runId,
    })
    console.error(structured)
    throw err
  }
}
