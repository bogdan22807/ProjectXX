/**
 * Isolated Playwright + HTTP proxy smoke test (does not touch executor).
 *
 * From backend/:
 *   node scripts/playwrightProxyHttpbinTest.mjs
 */

import { chromium } from 'playwright'

const TARGET_URL = 'https://httpbin.org/ip'
const PROXY = {
  server: 'http://91.228.13.48:50100',
  username: 'dont1',
  password: 'takeit32',
}

function log(msg, extra) {
  const line = `[proxy-httpbin-test] ${msg}`
  if (extra !== undefined) console.log(line, extra)
  else console.log(line)
}

async function main() {
  log('starting')
  log('proxy', { server: PROXY.server, username: PROXY.username, password: '***' })
  log('target', TARGET_URL)

  let browser
  let context
  let page

  try {
    browser = await chromium.launch({ headless: true })
    log('chromium.launch OK')
  } catch (err) {
    log('FAIL: chromium.launch', err instanceof Error ? err.message : err)
    process.exit(1)
  }

  try {
    context = await browser.newContext({ proxy: PROXY })
    log('browser.newContext OK (with proxy)')
  } catch (err) {
    log('FAIL: browser.newContext — proxy rejected or invalid?', err instanceof Error ? err.message : err)
    try {
      await browser.close()
    } catch {
      /* */
    }
    process.exit(1)
  }

  try {
    page = await context.newPage()
    const resp = await page.goto(TARGET_URL, {
      waitUntil: 'commit',
      timeout: 60_000,
    })
    const status = resp?.status() ?? null
    log(`navigation finished HTTP ${status}`)

    if (status === 407) {
      log('FAIL: HTTP 407 — proxy authentication failed (wrong user/pass or proxy policy)')
    }

    const body = (await page.textContent('body').catch(() => null)) ?? ''
    log('--- body start ---')
    console.log(body.trim() || '(empty)')
    log('--- body end ---')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : ''
    log('FAIL: page.goto or page load', msg)
    if (stack) log('stack', stack)

    const lower = msg.toLowerCase()
    if (lower.includes('timeout')) {
      log('hint: timeout often means proxy tunnel not established (wrong host/port, firewall, or auth)')
    }
    if (lower.includes('proxy') || lower.includes('tunnel') || lower.includes('407')) {
      log('hint: check proxy credentials and whether this IP is whitelisted at the provider')
    }
    process.exitCode = 1
  } finally {
    try {
      await page?.close()
    } catch {
      /* */
    }
    try {
      await context?.close()
    } catch {
      /* */
    }
    try {
      await browser?.close()
    } catch {
      /* */
    }
    log('browser closed')
  }

  if (process.exitCode === 1) process.exit(1)
  log('done OK')
}

main().catch((e) => {
  console.error('[proxy-httpbin-test] FATAL', e)
  process.exit(1)
})
