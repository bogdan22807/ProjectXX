/**
 * Playwright proxy diagnostics: 3 required scenarios + optional SOCKS5.
 *
 * Usage (from backend/):
 *   PROXY_DIAG_HOST=... PROXY_DIAG_PORT=... PROXY_DIAG_USER=... PROXY_DIAG_PASS=... node scripts/proxyPlaywrightDiagnostics.mjs
 *
 * Optional:
 *   PROXY_DIAG_TIMEOUT_MS=60000
 */

import { chromium } from 'playwright'
import { buildPlaywrightProxyConfig } from '../src/executor/proxyConfig.js'

const timeoutMs = (() => {
  const n = Number(process.env.PROXY_DIAG_TIMEOUT_MS)
  return Number.isFinite(n) && n > 0 ? n : 60_000
})()

const host = String(process.env.PROXY_DIAG_HOST ?? '').trim()
const port = String(process.env.PROXY_DIAG_PORT ?? '').trim()
const username = String(process.env.PROXY_DIAG_USER ?? '').trim()
const password = String(process.env.PROXY_DIAG_PASS ?? '').trim()

function log(section, msg, extra) {
  const line = `[${section}] ${msg}`
  if (extra !== undefined) console.log(line, extra)
  else console.log(line)
}

/** @param {unknown} o */
function redactProxyInJson(o) {
  try {
    const s = JSON.parse(JSON.stringify(o))
    if (s?.proxy?.server && typeof s.proxy.server === 'string') {
      s.proxy.server = s.proxy.server.replace(/\/\/([^:@/]+):([^@/]+)@/, '//***:***@')
    }
    if (s?.proxy?.password) s.proxy.password = '***'
    return s
  } catch {
    return o
  }
}

/**
 * @param {string} name
 * @param {{ launch?: import('playwright').LaunchOptions; context?: import('playwright').BrowserContextOptions }} opts
 * @param {string} url
 */
async function runCase(name, opts, url) {
  const launchOptions = opts.launch ?? {}
  const contextOptions = opts.context ?? {}
  log(name, '---')
  log(name, `chromium.launch: ${JSON.stringify(launchOptions, null, 2)}`)
  log(name, `browser.newContext: ${JSON.stringify(redactProxyInJson(contextOptions), null, 2)}`)
  log(name, `page.goto URL: ${url}`)
  log(name, `timeout: ${timeoutMs}ms`)

  let browser
  try {
    browser = await chromium.launch({
      headless: true,
      ...launchOptions,
    })
    log(name, 'chromium.launch: OK')
  } catch (err) {
    log(name, 'chromium.launch: FAIL', err instanceof Error ? err.stack ?? err.message : err)
    return { ok: false, phase: 'launch', err }
  }

  const context = await browser.newContext(contextOptions)
  const page = await context.newPage()
  try {
    const waitUntil =
      String(process.env.PROXY_DIAG_WAIT_UNTIL ?? 'commit').trim() || 'commit'
    const resp = await page.goto(url, {
      waitUntil,
      timeout: timeoutMs,
    })
    const status = resp?.status() ?? null
    const body = (await page.textContent('body').catch(() => null)) ?? ''
    const snippet = String(body).replace(/\s+/g, ' ').trim().slice(0, 800)
    log(name, `page.goto: finished | HTTP ${status}`)
    log(name, `body snippet: ${snippet || '(empty)'}`)
    if (status === 407) {
      log(
        name,
        'NOTE: HTTP 407 = proxy rejected credentials (or whitelist IP / wrong sub-user).',
      )
    }
    await context.close()
    await browser.close()
    return { ok: status !== 407, status, snippet, http407: status === 407 }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : ''
    log(name, 'page.goto: FAIL')
    log(name, `error name: ${err instanceof Error ? err.name : typeof err}`)
    log(name, `error message: ${msg}`)
    if (stack) log(name, `stack:\n${stack}`)
    try {
      await context.close()
    } catch {
      /* */
    }
    try {
      await browser.close()
    } catch {
      /* */
    }
    return { ok: false, phase: 'goto', err }
  }
}

async function main() {
  console.log('='.repeat(72))
  console.log('Playwright proxy diagnostics')
  console.log(`Node ${process.version} | PLAYWRIGHT_BROWSERS_PATH=${process.env.PLAYWRIGHT_BROWSERS_PATH ?? '(default)'}`)
  console.log('='.repeat(72))

  const r1 = await runCase('TEST_1_NO_PROXY', {}, 'https://api.ipify.org/?format=json')

  if (!host || !port) {
    console.log('\n[SKIP] TEST_2 / TEST_3 / SOCKS5: set PROXY_DIAG_HOST and PROXY_DIAG_PORT (and user/pass if needed)')
    summarize(r1, null, null, null)
    process.exit(r1.ok ? 0 : 1)
  }

  const httpProxyCfg = buildPlaywrightProxyConfig({
    provider: 'SOAX',
    host,
    port,
    username,
    password,
  })

  const r2 = await runCase(
    'TEST_2_HTTP_PROXY_HTTP_SITE',
    { context: { proxy: httpProxyCfg } },
    'http://example.com/',
  )

  const r3 = await runCase(
    'TEST_3_HTTP_PROXY_HTTPS_SITE',
    { context: { proxy: httpProxyCfg } },
    'https://api.ipify.org/?format=json',
  )

  const socksProxy = {
    server: `socks5://${host}:${port}`,
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
  }

  const r4 = await runCase(
    'TEST_4_SOCKS5_HTTPS_SITE',
    { context: { proxy: socksProxy } },
    'https://api.ipify.org/?format=json',
  )

  summarize(r1, r2, r3, r4)
  const okAll = r1.ok && r2.ok && r3.ok && r4.ok
  if (r4 && r4.phase === 'launch' && String(r4.err?.message ?? '').includes('socks5 proxy authentication')) {
    console.log(
      '\n[TEST_4] Chromium/Playwright: authenticated SOCKS5 at launch is not supported — use HTTP proxy or a local SOCKS forwarder.',
    )
  }
  const exitOk = r1.ok && r2.ok && r3.ok
  process.exit(exitOk ? 0 : 1)
}

/**
 * @param {{ ok: boolean }} r1
 * @param {any | null} r2
 * @param {any | null} r3
 * @param {any | null} r4
 */
function summarize(r1, r2, r3, r4) {
  console.log('\n' + '='.repeat(72))
  console.log('SUMMARY (facts from this run)')
  console.log('='.repeat(72))
  console.log(`TEST_1 no proxy → ipify:        ${r1.ok ? 'PASS' : 'FAIL'}`)
  if (r2) {
    const st = r2.status != null ? ` HTTP ${r2.status}` : ''
    console.log(`TEST_2 HTTP proxy → http site:   ${r2.ok ? 'PASS' : 'FAIL'}${st}${r2.http407 ? ' (407=auth rejected)' : ''}`)
  }
  if (r3) console.log(`TEST_3 HTTP proxy → https site:  ${r3.ok ? 'PASS' : 'FAIL'}`)
  if (r4) console.log(`TEST_4 SOCKS5 proxy → https:     ${r4.ok ? 'PASS' : 'FAIL'}`)

  if (r2 && r3) {
    if (r1.ok && r2.http407 && !r3.ok) {
      console.log(
        '\nConclusion: PROXY/AUTH issue, not Playwright URL glue.\n' +
          '- HTTP through proxy returns 407 → credentials are NOT accepted for plain HTTP proxy requests from Chromium.\n' +
          '- HTTPS through same proxy times out → typical when CONNECT/tunnel auth fails or is never completed (same root: proxy auth/session).\n' +
          '- Compare with your other tool: it may use a different client IP (whitelist), different sub-user format, or API-residential session vs static port.',
      )
    } else if (r1.ok && !r2.ok && !r3.ok) {
      console.log('\nConclusion: baseline works but BOTH proxy navigations failed → connect/auth from THIS host to proxy is broken (or wrong scheme).')
    } else if (r1.ok && r2.ok && !r3.ok) {
      console.log('\nConclusion: HTTP over proxy works; HTTPS via proxy fails from Playwright/Chromium → proxy likely does not support TLS CONNECT (or blocks) for this path; not an app URL bug.')
    } else if (r1.ok && !r2.ok && r3.ok) {
      console.log('\nConclusion: unusual (HTTPS ok, HTTP fail); inspect logs.')
    } else if (r1.ok && r2.ok && r3.ok && r4 && !r4.ok) {
      console.log('\nConclusion: HTTP proxy works for Playwright; SOCKS5 not accepted on this port (expected if proxy is HTTP-only).')
    } else if (r1.ok && r2.ok && r3.ok) {
      console.log('\nConclusion: Playwright + this HTTP proxy reach both HTTP and HTTPS from this environment.')
    }
  }
  console.log('='.repeat(72))
}

main().catch((e) => {
  console.error('Fatal:', e)
  process.exit(1)
})
