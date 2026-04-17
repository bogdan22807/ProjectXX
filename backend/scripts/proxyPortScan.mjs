/**
 * Try HTTP vs SOCKS5 on multiple ports (same host/credentials).
 *
 * PROXY_SCAN_HOST=91.246.222.146
 * PROXY_SCAN_USER=takeit32
 * PROXY_SCAN_PASS=dont1
 * PROXY_SCAN_PORTS=50100,9000,1080   (comma-separated, default 50100)
 * PROXY_SCAN_TIMEOUT_MS=15000
 */

import { chromium } from 'playwright'
import { buildPlaywrightProxyConfig } from '../src/executor/proxyConfig.js'

const host = String(process.env.PROXY_SCAN_HOST ?? '').trim()
const username = String(process.env.PROXY_SCAN_USER ?? '').trim()
const password = String(process.env.PROXY_SCAN_PASS ?? '').trim()
const ports = String(process.env.PROXY_SCAN_PORTS ?? '50100')
  .split(/[,;\s]+/)
  .map((p) => p.trim())
  .filter(Boolean)
const timeoutMs = Math.min(60_000, Math.max(3000, Number(process.env.PROXY_SCAN_TIMEOUT_MS) || 15_000))
const testUrl = String(process.env.PROXY_SCAN_URL ?? 'https://api.ipify.org/?format=json').trim()

async function tryPort(port, scheme) {
  const row = {
    host,
    port,
    username,
    password,
    proxy_scheme: scheme,
    provider: scheme,
  }
  const proxy = buildPlaywrightProxyConfig(row)

  let browser
  try {
    browser = await chromium.launch({ headless: true })
  } catch (e) {
    return { ok: false, phase: 'launch', err: String(e?.message ?? e) }
  }
  try {
    const ctx = await browser.newContext({ proxy })
    const page = await ctx.newPage()
    const resp = await page.goto(testUrl, { waitUntil: 'commit', timeout: timeoutMs })
    const status = resp?.status() ?? null
    const body = ((await page.textContent('body').catch(() => '')) ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)
    await ctx.close()
    await browser.close()
    return { ok: status !== 407 && status != null && status < 500, status, body, proxyServer: proxy?.server }
  } catch (e) {
    try {
      await browser.close()
    } catch {
      /* */
    }
    return { ok: false, phase: 'goto', err: String(e?.message ?? e), proxyServer: proxy?.server }
  }
}

async function main() {
  if (!host || !username) {
    console.error('Set PROXY_SCAN_HOST and PROXY_SCAN_USER (and PROXY_SCAN_PASS if needed)')
    process.exit(1)
  }
  console.log(`Host=${host} user=${username} ports=${ports.join(',')} url=${testUrl}\n`)
  for (const port of ports) {
    for (const scheme of ['http', 'socks5']) {
      const label = `${scheme} port ${port}`
      process.stdout.write(`${label.padEnd(24)} `)
      const r = await tryPort(port, scheme)
      if (r.ok) {
        console.log(`OK HTTP ${r.status} | ${r.body}`)
      } else if (r.status === 407) {
        console.log(`FAIL HTTP 407 (auth rejected)`)
      } else if (r.err?.includes('socks5 proxy authentication') || r.err?.includes('Browser does not support')) {
        console.log(`FAIL launch/context: ${r.err?.slice(0, 120)}`)
      } else {
        console.log(`FAIL ${r.phase}: ${(r.err ?? `HTTP ${r.status}`).slice(0, 160)}`)
      }
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
