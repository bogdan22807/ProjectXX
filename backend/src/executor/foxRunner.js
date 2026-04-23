/**
 * Fox / Camoufox path — Python bridge launches Camoufox WS server; Node connects via Playwright firefox.connect.
 */

import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { firefox } from 'playwright'
import {
  errorMessage,
  errorStack,
  formatStructuredErrorDetails,
  serializeErrorJson,
} from './errorLogFormat.js'
import { logFoxProxyDiagnostics, normalizePlaywrightProxyForFox } from './foxProxyBridge.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CREATE_BROWSER_SCRIPT = path.join(__dirname, 'CreateBrowse.py')

const IPIFY_URL = 'https://api.ipify.org/?format=json'
const HTTPBIN_IP_URL = 'https://httpbin.org/ip'

function gotoTimeoutMs() {
  const n = Number(process.env.PLAYWRIGHT_GOTO_TIMEOUT_MS)
  return Number.isFinite(n) && n > 0 ? n : 60_000
}

function gotoWaitUntil() {
  const w = String(process.env.PLAYWRIGHT_GOTO_WAIT_UNTIL ?? '').trim().toLowerCase()
  if (w === 'domcontentloaded' || w === 'load' || w === 'networkidle' || w === 'commit') {
    return /** @type {'commit' | 'domcontentloaded' | 'load' | 'networkidle'} */ (w)
  }
  return 'commit'
}

/**
 * @param {string} msg
 * @param {string} [phase]
 */
function classifyFoxProxyConnectivityFailure(msg, phase = '') {
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

/**
 * @param {import('playwright').BrowserContext} context
 * @param {string} accountId
 * @param {(id: string, action: string, details?: string) => void} logStep
 */
async function runFoxProxyConnectivityCheck(context, accountId, logStep) {
  const ipifyMs = Math.min(30_000, Math.max(5_000, Math.floor(gotoTimeoutMs() * 0.5)))
  let diagPage
  try {
    diagPage = await context.newPage()
    const ipResp = await diagPage.goto(IPIFY_URL, {
      waitUntil: gotoWaitUntil(),
      timeout: ipifyMs,
    })
    const ipStatus = ipResp?.status() ?? null
    if (ipStatus === 407) {
      logStep(accountId, 'FOX_PROXY_CONNECTIVITY_FAILED', `phase=ipify type=invalid_auth HTTP 407`)
      throw new Error('HTTP 407 from proxy on ipify')
    }
    const ipText = (await diagPage.textContent('body').catch(() => '')) ?? ''
    const ipSnippet = String(ipText).replace(/\s+/g, ' ').trim().slice(0, 500)
    logStep(
      accountId,
      'FOX_PROXY_IP_CHECK',
      `url=${IPIFY_URL} HTTP ${ipStatus ?? '?'} body=${ipSnippet || '(empty)'}`,
    )

    const hbResp = await diagPage.goto(HTTPBIN_IP_URL, {
      waitUntil: gotoWaitUntil(),
      timeout: gotoTimeoutMs(),
    })
    const hbStatus = hbResp?.status() ?? null
    if (hbStatus === 407) {
      logStep(accountId, 'FOX_PROXY_CONNECTIVITY_FAILED', `phase=httpbin type=invalid_auth HTTP 407`)
      throw new Error('HTTP 407 from proxy on httpbin')
    }
    const hbBody = (await diagPage.textContent('body').catch(() => null)) ?? ''
    const hbSnippet = String(hbBody).replace(/\s+/g, ' ').trim().slice(0, 2000)
    logStep(
      accountId,
      'FOX_PROXY_IP_CHECK',
      `url=${HTTPBIN_IP_URL} HTTP ${hbStatus ?? '?'} body=${hbSnippet || '(empty)'}`,
    )
    logStep(accountId, 'FOX_PROXY_CONNECTIVITY_OK', 'ipify_then_httpbin')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const errType = classifyFoxProxyConnectivityFailure(msg, 'goto')
    logStep(accountId, 'FOX_PROXY_CONNECTIVITY_FAILED', `phase=ipify_or_httpbin type=${errType} ${msg}`)
    throw err
  } finally {
    try {
      await diagPage?.close()
    } catch {
      /* ignore */
    }
  }
}

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

/**
 * @param {{
 *   headless?: boolean
 *   proxy?: import('playwright').BrowserContextOptions['proxy'] | null
 *   cookies?: string
 *   cookieUrl?: string
 *   userAgent?: string
 *   onPhase?: (phase: string, detail?: string) => void
 * }} config
 * @param {{
 *   accountId?: string | null
 *   runId?: string | null
 *   logStep?: (accountId: string, action: string, details?: string) => void
 *   proxySource?: 'database' | 'env' | 'none'
 *   proxyRow?: Record<string, unknown> | null
 * }} [ctx]
 * @returns {Promise<{ browser: import('playwright').Browser, context: import('playwright').BrowserContext, page: import('playwright').Page }>}
 */
export async function launchFoxBrowserSession(config, ctx = {}) {
  const phase =
    typeof config?.onPhase === 'function'
      ? /** @type {(p: string, d?: string) => void} */ (config.onPhase)
      : () => {}

  const accountId = ctx.accountId ?? null
  const runId = ctx.runId ?? null
  const logStep = ctx.logStep
  const proxySource = ctx.proxySource ?? 'none'
  const proxyRow = ctx.proxyRow ?? null

  const logFox = (line) => {
    console.error(`[foxRunner] ${line}`)
  }

  try {
    phase('fox_python_spawn', CREATE_BROWSER_SCRIPT)

    const pyBin = String(process.env.FOX_PYTHON ?? process.env.PYTHON ?? 'python3').trim() || 'python3'

    const username =
      String(process.env.FOX_USERNAME ?? ctx.accountId ?? 'default').trim() || 'default'
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

    const rawProxy = config.proxy ?? null
    const { normalized: foxProxy, note: proxyNormalizeNote } = normalizePlaywrightProxyForFox(rawProxy)

    if (accountId && typeof logStep === 'function') {
      logFoxProxyDiagnostics(accountId, logStep, {
        proxySource,
        proxyRow,
        launchProxy: foxProxy,
      })
      if (proxyNormalizeNote) {
        logStep(accountId, 'FOX_PROXY_DETAIL_VERBOSE', `normalize_note=${proxyNormalizeNote}`)
      }
    }

    const bridgePayload = {
      username,
      headless,
      proxy: foxProxy,
      userAgent: config.userAgent && String(config.userAgent).trim() ? String(config.userAgent).trim() : null,
      actions,
    }

    const child = spawn(pyBin, [CREATE_BROWSER_SCRIPT], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        FOX_BRIDGE_JSON: JSON.stringify(bridgePayload),
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

    const existing = browser.contexts()[0]
    const context =
      existing ??
      (await browser.newContext({
        ignoreHTTPSErrors: process.env.PLAYWRIGHT_IGNORE_HTTPS_ERRORS === '1',
      }))
    const pages = context.pages()
    const page = pages[0] ?? (await context.newPage())

    phase('fox_ws_connected', `pid=${serverPid ?? 'unknown'}`)

    if (foxProxy?.server && accountId && typeof logStep === 'function') {
      await runFoxProxyConnectivityCheck(context, accountId, logStep)
    }

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
