/**
 * One "human" iteration on TikTok FYP: watch → keyboard scroll (feed-focused) → optional video center-click.
 * No page.goto / reload — caller opens TikTok once.
 *
 * Mouse wheel at screen edge often hovers the sidebar avatar (flicker). Keyboard scroll + center focus avoids that.
 * Captcha/verify: we pause and log so you can solve manually; we do not auto-solve.
 */

import { interruptibleRandomDelay, randomChance, randomInt, sleep } from '../asyncUtils.js'
import { ExecutorHaltError } from '../executorHalt.js'

/** Max total wait for user to clear captcha/verify (ms). */
function challengeWaitBudgetMs() {
  const n = Number(process.env.TIKTOK_CHALLENGE_WAIT_MS)
  return Number.isFinite(n) && n > 0 ? Math.min(n, 600_000) : 180_000
}

/** Profile peek probability 0–100; default 0 (avatar/sidebar conflicts). Set e.g. TIKTOK_PROFILE_PEEK_PERCENT=5 */
function profilePeekPercent() {
  const n = Number(process.env.TIKTOK_PROFILE_PEEK_PERCENT)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.min(100, n)
}

/** Like attempt probability per iteration (0–10, float ok). Default ~1.5% (between 1 and 2). Env: TIKTOK_LIKE_PERCENT */
function shouldTryLike() {
  const raw = process.env.TIKTOK_LIKE_PERCENT
  let pct = 1.5
  if (raw != null && String(raw).trim() !== '') {
    const n = Number(raw)
    if (Number.isFinite(n) && n > 0) pct = Math.min(n, 10)
  }
  return Math.random() * 100 < pct
}

/**
 * @param {import('playwright').Page} page
 * @returns {Promise<'challenge' | 'login' | null>}
 */
async function detectBlockingFlow(page) {
  const u = page.url().toLowerCase()
  if (u.includes('/login') || u.includes('signup')) return 'login'
  if (
    u.includes('captcha') ||
    u.includes('/verify') ||
    u.includes('challenge') ||
    u.includes('sec_sdk') ||
    u.includes('/authentication')
  ) {
    return 'challenge'
  }
  try {
    const n = await page.locator('iframe[src*="captcha" i], iframe[src*="verify" i]').count()
    if (n > 0) return 'challenge'
  } catch {
    /* ignore */
  }
  return null
}

/**
 * @param {import('playwright').Page} page
 * @param {(action: string, details?: string) => void} log
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 */
async function waitIfChallengeOrLogin(page, log, shouldHalt) {
  const kind = await detectBlockingFlow(page)
  if (!kind) return

  if (kind === 'login') {
    log('TIKTOK_LOGIN_PAGE', 'manual login required — automation pauses 60s then continues check')
    await interruptibleRandomDelay(55_000, 65_000, shouldHalt)
    return
  }

  log(
    'TIKTOK_CHALLENGE_DETECTED',
    'captcha/verify — solve in the browser; waiting (TIKTOK_CHALLENGE_WAIT_MS max)',
  )
  const budget = challengeWaitBudgetMs()
  const started = Date.now()
  while (Date.now() - started < budget) {
    await haltIfNeeded(shouldHalt)
    const still = await detectBlockingFlow(page)
    if (!still || still === 'login') {
      if (!still) log('TIKTOK_CHALLENGE_CLEARED', 'feed should be usable again')
      break
    }
    await interruptibleRandomDelay(8000, 12000, shouldHalt)
  }
}

/**
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 */
async function haltIfNeeded(shouldHalt) {
  if (!shouldHalt) return
  const v = await shouldHalt()
  if (v === 'stop') throw new ExecutorHaltError('stop')
  if (v === 'max_duration') throw new ExecutorHaltError('max_duration')
}

/**
 * Click center-ish of viewport (main column), not left sidebar — reduces avatar hover.
 * @param {import('playwright').Page} page
 * @param {(action: string, details?: string) => void} log
 */
async function focusFeedColumn(page, log) {
  const vp = page.viewportSize()
  if (!vp) return
  const x = Math.floor(vp.width * 0.52)
  const y = Math.floor(vp.height * 0.42)
  await page.mouse.click(x, y)
  log('FEED_FOCUS', `${x},${y}`)
}

/**
 * Scroll feed with keyboard (after focus), not mouse wheel at edge.
 * @param {import('playwright').Page} page
 * @param {'down' | 'up'} dir
 * @param {(action: string, details?: string) => void} log
 */
async function keyboardFeedScroll(page, dir, log) {
  await focusFeedColumn(page, log)
  const times = dir === 'down' ? randomInt(2, 5) : randomInt(1, 2)
  for (let i = 0; i < times; i++) {
    await page.keyboard.press(dir === 'down' ? 'ArrowDown' : 'ArrowUp')
    await sleep(80 + randomInt(0, 120))
  }
  if (dir === 'down' && randomChance(35)) {
    await page.keyboard.press('PageDown')
    log('SCROLL', `keyboard ArrowDown×${times}+PageDown`)
  } else {
    log('SCROLL', `keyboard ${dir === 'down' ? 'ArrowDown' : 'ArrowUp'}×${times}`)
  }
}

/**
 * @param {import('playwright').Page} page
 * @param {(action: string, details?: string) => void} log
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 */
export async function runTikTokHumanFeedIteration(page, log, shouldHalt) {
  await haltIfNeeded(shouldHalt)
  await waitIfChallengeOrLogin(page, log, shouldHalt)
  await haltIfNeeded(shouldHalt)

  if ((await detectBlockingFlow(page)) === 'challenge') {
    log('TIKTOK_CHALLENGE_STILL_ACTIVE', 'skip actions this iteration — finish captcha in browser')
    await interruptibleRandomDelay(5000, 10000, shouldHalt)
    return
  }

  log('VIEW_VIDEO', 'watching 5–15s')
  await interruptibleRandomDelay(5000, 15000, shouldHalt)
  await haltIfNeeded(shouldHalt)

  if (randomChance(30)) {
    log('VIEW_VIDEO', 'linger 3–8s (no scroll this beat)')
    await interruptibleRandomDelay(3000, 8000, shouldHalt)
  } else {
    await keyboardFeedScroll(page, 'down', log)
    if (randomChance(25)) {
      await keyboardFeedScroll(page, 'up', log)
      log('SCROLL_BACK', 'keyboard up')
    }
  }
  await haltIfNeeded(shouldHalt)

  if (shouldTryLike()) {
    await focusFeedColumn(page, log)
    const likeBtn = page
      .locator(
        '[data-e2e="browse-like-icon"], [data-e2e="like-icon"], [data-e2e="video-player-like-icon"], button[aria-label*="Like" i]',
      )
      .first()
    try {
      if ((await likeBtn.count()) > 0) {
        await likeBtn.click({ timeout: 5000 })
        log('LIKE_VIDEO', 'like button (rare)')
        await interruptibleRandomDelay(800, 2200, shouldHalt)
      } else {
        log('LIKE_SKIPPED', 'no like control found')
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      log('LIKE_SKIPPED', msg.slice(0, 200))
    }
    await haltIfNeeded(shouldHalt)
  }

  if (randomChance(15)) {
    const vid = page.locator('main video, [data-e2e="feed-active-video"] video').first()
    try {
      if ((await vid.count()) > 0) {
        const box = await vid.boundingBox()
        if (box && box.width > 20 && box.height > 20) {
          await page.mouse.click(
            box.x + box.width / 2,
            box.y + Math.min(box.height * 0.45, box.height / 2),
          )
          log('CLICK_VIDEO', 'center of video element')
          await interruptibleRandomDelay(5000, 12000, shouldHalt)
        }
      }
    } catch {
      log('CLICK_VIDEO', 'skipped')
    }
    await haltIfNeeded(shouldHalt)
  }

  const profilePct = profilePeekPercent()
  if (profilePct > 0 && randomChance(profilePct)) {
    const author = page.locator('[data-e2e="video-author-uniqueid"]').first()
    try {
      if ((await author.count()) > 0) {
        await author.click({ timeout: 8000 })
        const u = page.url()
        log('OPEN_PROFILE', u)
        await interruptibleRandomDelay(5000, 10000, shouldHalt)
        await page.goBack({ waitUntil: 'commit', timeout: 20000 }).catch(() => {})
        log('PROFILE_BACK', page.url())
      }
    } catch {
      log('OPEN_PROFILE', 'skipped')
    }
    await haltIfNeeded(shouldHalt)
  }
}
