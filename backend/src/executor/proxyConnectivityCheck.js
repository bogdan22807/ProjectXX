/**
 * One-shot Playwright check for a proxy row: HTTPS ipify → persist status + outbound IP JSON.
 * Does not touch executor / account flows.
 */

import { chromium } from 'playwright'
import { db } from '../db.js'
import { buildPlaywrightProxyConfig } from './proxyConfig.js'

const IPIFY = 'https://api.ipify.org/?format=json'
const GOTO_MS = Math.min(35_000, Math.max(10_000, Number(process.env.PROXY_CHECK_GOTO_MS) || 25_000))

/**
 * @param {string} msg
 * @returns {'auth_failed' | 'timeout' | 'network' | 'bad_request'}
 */
function classifyCheckFailure(msg) {
  const m = String(msg ?? '').toLowerCase()
  if (m.includes('407') || m.includes('proxy authentication') || m.includes('invalid auth')) {
    return 'auth_failed'
  }
  if (m.includes('timeout') || m.includes('timed out')) return 'timeout'
  if (m.includes('net::err') || m.includes('econnrefused') || m.includes('enotfound')) return 'network'
  if (m.includes('json') || m.includes('parse')) return 'bad_request'
  return 'network'
}

/**
 * @param {string} proxyId
 * @returns {Promise<void>}
 */
export async function runProxyConnectivityCheck(proxyId) {
  const row = db.prepare('SELECT * FROM proxies WHERE id = ?').get(proxyId)
  if (!row) return

  const launchProxy = buildPlaywrightProxyConfig(row)
  if (!launchProxy?.server) {
    db.prepare(
      `UPDATE proxies SET status = ?, check_result = ?, last_check = datetime('now') WHERE id = ?`,
    ).run('bad_request', JSON.stringify({ error: 'invalid_host' }), proxyId)
    return
  }

  let browser
  try {
    browser = await chromium.launch({ headless: true, proxy: launchProxy })
    const context = await browser.newContext()
    const page = await context.newPage()
    const resp = await page.goto(IPIFY, { waitUntil: 'commit', timeout: GOTO_MS })
    const httpStatus = resp?.status() ?? null
    if (httpStatus === 407) {
      db.prepare(
        `UPDATE proxies SET status = ?, check_result = ?, last_check = datetime('now') WHERE id = ?`,
      ).run('auth_failed', JSON.stringify({ httpStatus: 407 }), proxyId)
      return
    }
    const raw = (await page.textContent('body').catch(() => '')) ?? ''
    let outboundIp = ''
    try {
      const j = JSON.parse(String(raw).trim())
      if (j && typeof j.ip === 'string') outboundIp = j.ip.trim()
    } catch {
      /* not json */
    }
    if (!outboundIp) {
      db.prepare(
        `UPDATE proxies SET status = ?, check_result = ?, last_check = datetime('now') WHERE id = ?`,
      ).run(
        'bad_request',
        JSON.stringify({ snippet: String(raw).replace(/\s+/g, ' ').slice(0, 200) }),
        proxyId,
      )
      return
    }
    db.prepare(
      `UPDATE proxies SET status = ?, check_result = ?, last_check = datetime('now') WHERE id = ?`,
    ).run('ok', JSON.stringify({ outboundIp }), proxyId)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const kind = classifyCheckFailure(msg)
    db.prepare(
      `UPDATE proxies SET status = ?, check_result = ?, last_check = datetime('now') WHERE id = ?`,
    ).run(kind, JSON.stringify({ message: msg.slice(0, 500) }), proxyId)
  } finally {
    try {
      await browser?.close()
    } catch {
      /* ignore */
    }
  }
}
