/**
 * Launch Camoufox browser server (same mechanism as `python -m camoufox server` / camoufox.server.launch_server)
 * and return a Playwright client connected via firefox.connect(wsEndpoint).
 */

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { firefox } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

function bridgeScriptPath() {
  return path.join(__dirname, '..', '..', 'fox', 'camoufox_bridge.py')
}

function defaultPythonBin() {
  return String(process.env.FOX_PYTHON ?? process.env.CAMOUFOX_PYTHON ?? 'python3').trim() || 'python3'
}

/**
 * @returns {Promise<{ nodejs: string; launchScript: string; packageCwd: string }>}
 */
function getCamoufoxPaths() {
  return new Promise((resolve, reject) => {
    const py = spawn(defaultPythonBin(), [bridgeScriptPath(), 'paths'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    let err = ''
    py.stdout.on('data', (c) => {
      out += c.toString()
    })
    py.stderr.on('data', (c) => {
      err += c.toString()
    })
    py.on('error', reject)
    py.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`camoufox_bridge paths failed code=${code} stderr=${err.slice(0, 2000)}`))
        return
      }
      try {
        const j = JSON.parse(out.trim())
        if (!j.nodejs || !j.launchScript || !j.packageCwd) {
          reject(new Error(`camoufox_bridge paths invalid JSON: ${out.slice(0, 500)}`))
          return
        }
        resolve({
          nodejs: String(j.nodejs),
          launchScript: String(j.launchScript),
          packageCwd: String(j.packageCwd),
        })
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    })
  })
}

/**
 * @param {{ headless: boolean; proxy?: import('playwright').BrowserContextOptions['proxy'] | null }} input
 * @returns {Promise<string>} base64 payload for launchServer.js stdin
 */
function getCamoufoxConfigBase64(input) {
  return new Promise((resolve, reject) => {
    const py = spawn(defaultPythonBin(), [bridgeScriptPath(), 'config'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let err = ''
    let out = ''
    py.stderr.on('data', (c) => {
      err += c.toString()
    })
    py.stdout.on('data', (c) => {
      out += c.toString()
    })
    py.on('error', reject)
    py.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`camoufox_bridge config failed code=${code} stderr=${err.slice(0, 2000)}`))
        return
      }
      const b64 = out.trim()
      if (!b64) {
        reject(new Error('camoufox_bridge config returned empty stdout'))
        return
      }
      resolve(b64)
    })
    const body = JSON.stringify({
      headless: input.headless,
      proxy: input.proxy ?? null,
    })
    py.stdin.write(body)
    py.stdin.end()
  })
}

const WS_LINE_RE = /Websocket endpoint:\s*(ws:\/\/[^\s\x1b]+)/i

/**
 * @param {{ headless: boolean; proxy?: import('playwright').BrowserContextOptions['proxy'] | null; connectTimeoutMs?: number }} opts
 * @returns {Promise<{ browser: import('playwright').Browser; child: import('node:child_process').ChildProcessWithoutNullStreams }>}
 */
export async function launchCamoufoxServerAndConnect(opts) {
  const paths = await getCamoufoxPaths()
  const configB64 = await getCamoufoxConfigBase64({
    headless: opts.headless !== false,
    proxy: opts.proxy ?? null,
  })

  const child = spawn(paths.nodejs, [paths.launchScript], {
    cwd: paths.packageCwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  })

  if (!child.stdin) {
    throw new Error('Camoufox server: stdin pipe missing')
  }
  child.stdin.write(configB64)
  child.stdin.end()

  const connectTimeoutMs =
    Number(process.env.CAMOUFOX_WS_TIMEOUT_MS) > 0 ? Number(process.env.CAMOUFOX_WS_TIMEOUT_MS) : 90_000

  const wsEndpoint = await new Promise((resolve, reject) => {
    let buf = ''
    const timer = setTimeout(() => {
      cleanup()
      try {
        child.kill('SIGTERM')
      } catch {
        /* ignore */
      }
      reject(new Error(`Camoufox server: timeout ${connectTimeoutMs}ms waiting for websocket URL`))
    }, connectTimeoutMs)

    function cleanup() {
      clearTimeout(timer)
      child.stdout?.removeAllListeners('data')
      child.stderr?.removeAllListeners('data')
    }

    function tryParse(chunk) {
      buf += chunk.toString()
      const m = buf.match(WS_LINE_RE)
      if (m && m[1]) {
        cleanup()
        resolve(m[1].trim())
      }
    }

    child.stdout?.on('data', tryParse)
    child.stderr?.on('data', tryParse)
    child.on('error', (err) => {
      cleanup()
      reject(err)
    })
    child.on('close', (code) => {
      if (buf.match(WS_LINE_RE)) return
      cleanup()
      reject(
        new Error(
          `Camoufox server process exited code=${code} before websocket URL. Output:\n${buf.slice(0, 4000)}`,
        ),
      )
    })
  })

  const browser = await firefox.connect(String(wsEndpoint), {
    timeout: connectTimeoutMs,
  })

  const origClose = browser.close.bind(browser)
  browser.close = async () => {
    try {
      await origClose()
    } finally {
      try {
        child.kill('SIGTERM')
      } catch {
        /* ignore */
      }
    }
  }

  return { browser, child }
}

/**
 * Resolve Playwright package root (…/node_modules/playwright) for version check with Camoufox driver.
 */
export function getPlaywrightPackageRoot() {
  const resolved = require.resolve('playwright/package.json')
  return path.dirname(resolved)
}
