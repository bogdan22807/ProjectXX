/**
 * Fox / Camoufox path — separate core from Chromium.
 * Spawns Python `CreateBrowse.py`; parent attaches via Playwright when wired.
 */

import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  errorMessage,
  errorStack,
  errorType,
  formatStructuredErrorDetails,
  serializeErrorJson,
} from './errorLogFormat.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CREATE_BROWSER_SCRIPT = path.join(__dirname, 'CreateBrowse.py')

/**
 * @param {{
 *   headless?: boolean
 *   proxy?: import('playwright').BrowserContextOptions['proxy'] | null
 *   cookies?: string
 *   cookieUrl?: string
 *   userAgent?: string
 *   onPhase?: (phase: string, detail?: string) => void
 * }} _config
 * @param {{ accountId?: string | null; runId?: string | null }} [ctx]
 * @returns {Promise<{ browser: import('playwright').Browser, context: import('playwright').BrowserContext, page: import('playwright').Page }>}
 */
export async function launchFoxBrowserSession(_config, ctx = {}) {
  const phase =
    typeof _config?.onPhase === 'function'
      ? /** @type {(p: string, d?: string) => void} */ (_config.onPhase)
      : () => {}

  const accountId = ctx.accountId ?? null
  const runId = ctx.runId ?? null

  const logFox = (line) => {
    console.error(`[foxRunner] ${line}`)
  }

  try {
    phase('fox_python_spawn', CREATE_BROWSER_SCRIPT)

    const pyBin = String(process.env.FOX_PYTHON ?? process.env.PYTHON ?? 'python3').trim() || 'python3'

    const child = spawn(pyBin, [CREATE_BROWSER_SCRIPT], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    })

    let stdoutBuf = ''
    let stderrBuf = ''

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

    const exitCode = await new Promise((resolve, reject) => {
      child.on('error', reject)
      child.on('close', (code) => resolve(code ?? 0))
    })

    logFox(`PYTHON_STDOUT_FULL\n${stdoutBuf || '(empty)'}`)
    logFox(`PYTHON_STDERR_FULL\n${stderrBuf || '(empty)'}`)

    if (exitCode !== 0) {
      const synthetic = new Error(
        `Fox Python exited with code ${exitCode}. See FOX_PYTHON_ERROR / PYTHON_TRACEBACK logs.`,
      )
      synthetic.name = 'FoxPythonExitError'
      const details = [
        `FOX_PYTHON_ERROR exitCode=${exitCode}`,
        `STDERR=\n${stderrBuf || '(empty)'}`,
        `STDOUT=\n${stdoutBuf || '(empty)'}`,
        formatStructuredErrorDetails({
          err: synthetic,
          scope: 'launchFoxBrowserSession',
          accountId,
          runId,
        }),
      ].join('\n')
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

    phase('fox_python_ok', 'process exited 0 (Playwright attach not implemented)')
    const notWired = new Error(
      'FOX_PLAYWRIGHT_ATTACH_NOT_IMPLEMENTED: Python exited successfully but Node has no CDP/socket wiring yet.',
    )
    notWired.name = 'FoxPlaywrightAttachError'
    throw notWired
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
