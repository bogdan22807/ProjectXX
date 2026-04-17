/**
 * Isolated Playwright Chromium + HTTP proxy diagnostic (two URLs).
 * Does not import project executor code.
 *
 *   cd backend && npm run proxy:chromium-diagnostic
 */

import { chromium } from 'playwright'

const PROXY = {
  server: 'http://91.228.13.48:50100',
  username: 'dont1',
  password: 'takeit32',
}

const URLS = ['https://httpbin.org/ip', 'https://api.ipify.org/?format=json']

function humanReason(msg) {
  const lower = String(msg).toLowerCase()
  if (lower.includes('407')) {
    return 'Likely cause: proxy rejected credentials (wrong user/password or IP not whitelisted).'
  }
  if (lower.includes('tunnel') || lower.includes('proxy')) {
    return 'Likely cause: proxy CONNECT / tunnel failed (wrong server, port, or proxy type).'
  }
  if (lower.includes('timeout')) {
    return 'Likely cause: connection or TLS through proxy timed out (blocked path, slow proxy, or auth stuck).'
  }
  return ''
}

function log(tag, detail = '') {
  console.log(detail ? `${tag} ${detail}` : tag)
}

async function main() {
  log('[START]')

  /** @type {import('playwright').Browser | null} */
  let browser = null

  try {
    browser = await chromium.launch({ headless: true })
    log('[BROWSER_STARTED]')

    const context = await browser.newContext({ proxy: PROXY })
    const page = await context.newPage()

    for (const url of URLS) {
      log('[OPENING_URL]', url)
      try {
        const resp = await page.goto(url, {
          waitUntil: 'commit',
          timeout: 60_000,
        })
        const title = (await page.title().catch(() => '')) ?? ''
        log('[PAGE_TITLE]', title || '(empty)')

        const raw = (await page.textContent('body').catch(() => null)) ?? ''
        const body = String(raw).replace(/\s+/g, ' ').trim().slice(0, 2000)
        log('[BODY]', body || '(empty)')

        const st = resp?.status() ?? '?'
        log('[SUCCESS]', `${url} HTTP ${st}`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        log('[ERROR]', msg)
        const hint = humanReason(msg)
        if (hint) {
          log('[DIAGNOSIS]', hint)
        }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log('[ERROR]', `fatal: ${msg}`)
    const hint = humanReason(msg)
    if (hint) {
      log('[DIAGNOSIS]', hint)
    }
    process.exitCode = 1
  } finally {
    try {
      if (browser) {
        await browser.close()
      }
    } catch (closeErr) {
      log('[ERROR]', `browser.close: ${closeErr instanceof Error ? closeErr.message : String(closeErr)}`)
    }
    log('[BROWSER_CLOSED]')
  }

  if (process.exitCode === 1) {
    process.exit(1)
  }
}

main().catch((e) => {
  console.log('[ERROR]', e instanceof Error ? e.message : String(e))
  const hint = humanReason(e instanceof Error ? e.message : String(e))
  if (hint) console.log('[DIAGNOSIS]', hint)
  process.exit(1)
})
