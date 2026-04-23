/**
 * Fox mode: delegates browser launch to Python `CreateBrowse.CreateBrowser` (Camoufox).
 * Node invokes CreateBrowse.py with FOX_BRIDGE_STDOUT=1; script prints wsEndpoint JSON;
 * Node connects with playwright.firefox.connect and applies cookies (scenarios unchanged).
 */

import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { firefox } from 'playwright'
import { parseCookiesForUrlStrict } from './cookieParse.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function createBrowseScriptPath() {
  return path.join(__dirname, '..', '..', 'fox', 'CreateBrowse.py')
}

function defaultPythonBin() {
  return String(process.env.FOX_PYTHON ?? process.env.CAMOUFOX_PYTHON ?? 'python3').trim() || 'python3'
}

/**
 * @param {{
 *   headless?: boolean
 *   proxy?: import('playwright').BrowserContextOptions['proxy'] | null
 *   cookies?: string
 *   cookieUrl?: string
 *   userAgent?: string
 *   onPhase?: (phase: string, detail?: string) => void
 *   foxUsername?: string
 *   foxActions?: unknown
 *   foxLog?: (action: string, details?: string) => void
 * }} config
 * @returns {Promise<{ browser: import('playwright').Browser, context: import('playwright').BrowserContext, page: import('playwright').Page; _camoufoxServerPid?: number }>}
 */
export async function launchFoxBrowserSession(config) {
  const phase =
    typeof config.onPhase === 'function'
      ? /** @type {(p: string, d?: string) => void} */ (config.onPhase)
      : () => {}
  const foxLog =
    typeof config.foxLog === 'function'
      ? /** @type {(a: string, d?: string) => void} */ (config.foxLog)
      : () => {}

  const userName = String(config.foxUsername ?? 'user').trim() || 'user'
  const headless = config.headless !== undefined ? Boolean(config.headless) : true
  const proxy = config.proxy ?? null

  foxLog('FOX_RUNNER_START', `CreateBrowse.py user=${userName} headless=${headless ? 1 : 0} hasProxy=${proxy ? 1 : 0}`)
  phase('fox_createbrowser_start', `CreateBrowse.py user=${userName} headless=${headless ? 1 : 0}`)

  const payload = JSON.stringify({
    username: userName,
    headless,
    proxy,
    actions: config.foxActions ?? null,
  })

  const pyBin = defaultPythonBin()
  const script = createBrowseScriptPath()

  const child = spawn(pyBin, [script, '--bridge-node'], {
    env: {
      ...process.env,
      PYTHONUTF8: '1',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  /** @type {number | undefined} */
  let camoufoxServerPid

  const result = await new Promise((resolve, reject) => {
    let out = ''
    let err = ''
    const timeoutMs = Number(process.env.FOX_CREATE_BROWSER_TIMEOUT_MS) > 0 ? Number(process.env.FOX_CREATE_BROWSER_TIMEOUT_MS) : 120_000
    const timer = setTimeout(() => {
      try {
        child.kill('SIGTERM')
      } catch {
        /* ignore */
      }
      reject(new Error(`CreateBrowser bridge timeout ${timeoutMs}ms`))
    }, timeoutMs)

    child.stdout.on('data', (c) => {
      out += c.toString()
    })
    child.stderr.on('data', (c) => {
      err += c.toString()
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(new Error(`CreateBrowse.py exited code=${code} stderr=${err.slice(0, 2000)}`))
        return
      }
      const line = out.trim().split(/\r?\n/).filter(Boolean).pop()
      if (!line) {
        reject(new Error(`CreateBrowse.py empty stdout stderr=${err.slice(0, 2000)}`))
        return
      }
      try {
        const j = JSON.parse(line)
        if (j.error) {
          reject(new Error(String(j.error)))
          return
        }
        if (!j.wsEndpoint) {
          reject(new Error(`CreateBrowse.py missing wsEndpoint: ${line.slice(0, 500)}`))
          return
        }
        if (typeof j.camoufoxServerPid === 'number') {
          camoufoxServerPid = j.camoufoxServerPid
        }
        resolve(j)
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    })
    child.stdin.write(`${payload}\n`)
    child.stdin.end()
  })

  const wsEndpoint = String(/** @type {{ wsEndpoint: string }} */ (result).wsEndpoint)
  foxLog('FOX_WS_ENDPOINT_READY', `${wsEndpoint.slice(0, 72)}${wsEndpoint.length > 72 ? '…' : ''}`)
  phase('fox_ws_ready', wsEndpoint.slice(0, 48) + '…')

  const connectTimeoutMs =
    Number(process.env.CAMOUFOX_WS_TIMEOUT_MS) > 0 ? Number(process.env.CAMOUFOX_WS_TIMEOUT_MS) : 90_000

  const browser = await firefox.connect(wsEndpoint, { timeout: connectTimeoutMs })
  foxLog('FOX_CONNECTED', `timeoutMs=${connectTimeoutMs}`)
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
      foxLog('FOX_COOKIES_APPLIED', `count=${parsed.cookies.length} url=${pageUrl.origin}`)
      phase('cookies_applied', `${parsed.cookies.length}`)
    } else {
      foxLog('FOX_COOKIES_APPLIED', 'count=0 (parsed empty)')
      phase('cookies_empty_after_parse', '')
    }
  } else {
    foxLog('FOX_COOKIES_APPLIED', 'skipped no cookie string')
    phase('cookies_skipped', 'no cookie string')
  }

  let page = context.pages().length > 0 ? context.pages()[0] : null
  if (!page) {
    page = await context.newPage()
    phase('first_page_created', '')
  } else {
    phase('first_page_created', 'reusing default page from Camoufox server')
  }

  const origClose = browser.close.bind(browser)
  browser.close = async () => {
    try {
      await origClose()
    } finally {
      if (camoufoxServerPid != null) {
        try {
          process.kill(camoufoxServerPid, 'SIGTERM')
        } catch {
          /* ignore */
        }
      }
    }
  }

  return { browser, context, page }
}
