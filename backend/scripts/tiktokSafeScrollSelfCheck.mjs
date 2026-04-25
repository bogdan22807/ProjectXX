/**
 * Local check: open TikTok FYP without cookies, run one SAFE controlled scroll, compare stable keys.
 *
 * Usage (from backend/):
 *   node scripts/tiktokSafeScrollSelfCheck.mjs
 *   HEADED=1 node scripts/tiktokSafeScrollSelfCheck.mjs
 *
 * Exit: 0 if feed found and scroll attempted; 2 if no feed card (login wall / geo / block); 1 on error.
 */

import { chromium } from 'playwright'
import { runSafeTikTokControlledOneVideoScroll } from '../src/executor/scenarios/safeTikTokOneVideoScroll.js'

function log(action, details = '') {
  console.log(`[${action}] ${details}`)
}

async function shouldHalt() {
  return false
}

/** Same shape as safeTikTokFeedMode `getStableVideoKey`. */
async function readStableKey(page) {
  try {
    if (page.isClosed()) return ''
    const root = page.locator('[data-e2e="feed-active-video"]').first()
    const cnt = await root.count().catch(() => 0)
    if (cnt === 0) return ''
    const href =
      (await root.locator('[data-e2e="video-author-uniqueid"] a').first().getAttribute('href').catch(() => null)) ?? ''
    const src = (await root.locator('video').first().getAttribute('src').catch(() => null)) ?? ''
    return `${String(href).trim()}|${String(src).trim().slice(0, 160)}`.slice(0, 400)
  } catch {
    return ''
  }
}

async function main() {
  const headed = process.env.HEADED === '1'
  const url = process.env.TIKTOK_CHECK_URL || 'https://www.tiktok.com/foryou'

  log('SELF_CHECK', `url=${url} headless=${!headed} cookies=none`)

  const browser = await chromium.launch({ headless: !headed })
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    locale: 'en-US',
  })
  const page = await context.newPage()

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 })
  } catch (e) {
    log('GOTO_FAILED', String(e?.message ?? e))
    await browser.close()
    process.exitCode = 1
    return
  }

  let found = false
  for (let i = 0; i < 45; i += 1) {
    const n = await page.locator('[data-e2e="feed-active-video"]').count().catch(() => 0)
    if (n > 0) {
      found = true
      break
    }
    await new Promise((r) => setTimeout(r, 1000))
  }

  if (!found) {
    log('NO_FEED_CARD', 'feed-active-video not found — login/CAPTCHA/geo or slow load')
    console.log('title=', await page.title().catch(() => ''))
    console.log('url=', page.url())
    await browser.close()
    process.exitCode = 2
    return
  }

  const before = await readStableKey(page)
  log('STABLE_KEY_BEFORE', `len=${before.length} preview=${before.slice(0, 100)}`)

  const advanced = await runSafeTikTokControlledOneVideoScroll(page, log, shouldHalt, () => readStableKey(page))
  const after = await readStableKey(page)

  log('STABLE_KEY_AFTER', `len=${after.length} preview=${after.slice(0, 100)}`)
  log('RESULT', `advanced=${advanced} keyChanged=${before !== after && Boolean(after)}`)

  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
