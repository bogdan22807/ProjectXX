/**
 * One "human" iteration on TikTok FYP: watch → keyboard scroll (feed-focused) → optional video center-click.
 * No page.goto / reload in the normal path — caller opens TikTok once. LIVE/stream recovery may
 * `goto` For You if Escape/back cannot restore the feed.
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
 * TikTok often keeps the FYP URL while showing a captcha overlay — detect via DOM/title too.
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>}
 */
async function detectChallengeDom(page) {
  try {
    const ti = ((await page.title().catch(() => '')) ?? '').toLowerCase()
    if (
      ti.includes('captcha') ||
      ti.includes('verify') ||
      ti.includes('security check') ||
      ti.includes('robot')
    ) {
      return true
    }
  } catch {
    /* ignore */
  }
  const hints = [
    'iframe[src*="captcha" i]',
    'iframe[src*="verify" i]',
    'iframe[src*="challenge" i]',
    '[class*="captcha" i]',
    '[id*="captcha" i]',
    '[class*="Captcha" i]',
    '[data-testid*="captcha" i]',
    'text=/\\bcaptcha\\b/i',
    'text=/security check/i',
    'text=/verify you are human/i',
    'text=/slide to verify/i',
    'text=/drag.*puzzle/i',
  ]
  for (const sel of hints) {
    const loc = page.locator(sel).first()
    if (await loc.isVisible().catch(() => false)) return true
  }
  return false
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
  if (await detectChallengeDom(page)) return 'challenge'
  return null
}

/**
 * LIVE slide or navigated into live room — scrolling/clicking the “video” hits stream UI.
 * @param {import('playwright').Page} page
 */
async function pageShowsLiveContext(page) {
  const u = page.url().toLowerCase()
  if (u.includes('/live')) return true
  try {
    const badge = page.locator('[data-e2e="live-tag"], [data-e2e="video-live-tag"]').first()
    if ((await badge.count()) > 0 && (await badge.isVisible().catch(() => false))) return true
  } catch {
    /* ignore */
  }
  return false
}

/**
 * Leave LIVE / stream surface back toward For You (no busy loop).
 * @param {import('playwright').Page} page
 * @param {(action: string, details?: string) => void} log
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 */
async function recoverFromLiveSurface(page, log, shouldHalt) {
  const before = page.url()
  if (!(await pageShowsLiveContext(page))) return false

  log('TIKTOK_LIVE_DETECTED', before.slice(0, 280))

  await page.keyboard.press('Escape').catch(() => {})
  await interruptibleRandomDelay(400, 900, shouldHalt)
  if (!(await pageShowsLiveContext(page))) {
    log('TIKTOK_LIVE_EXIT', `after Escape url=${page.url().slice(0, 200)}`)
    return true
  }

  await page.goBack({ waitUntil: 'commit', timeout: 18_000 }).catch(() => {})
  await interruptibleRandomDelay(500, 1200, shouldHalt)
  if (!(await pageShowsLiveContext(page))) {
    log('TIKTOK_LIVE_EXIT', `after goBack url=${page.url().slice(0, 200)}`)
    return true
  }

  const fyp = 'https://www.tiktok.com/foryou'
  try {
    await page.goto(fyp, { waitUntil: 'commit', timeout: 28_000 })
    log('TIKTOK_LIVE_EXIT', `recovery goto ${fyp}`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    log('TIKTOK_LIVE_EXIT_FAILED', msg.slice(0, 200))
  }
  return true
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
      if (!still) {
        log('TIKTOK_CHALLENGE_CLEARED', 'overlay gone — resuming after short pause')
        await interruptibleRandomDelay(3000, 5000, shouldHalt)
        log('TIKTOK_RESUME_AFTER_CHALLENGE', 'continuing feed automation')
      }
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
 * Random wait in [minMs, maxMs] that stops feed actions as soon as a captcha overlay is detected,
 * runs `waitIfChallengeOrLogin` (wait until solved, then 3–5s), then exits (remaining watch time skipped).
 * @param {import('playwright').Page} page
 * @param {(action: string, details?: string) => void} log
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 * @param {number} minMs
 * @param {number} maxMs
 */
async function delayWithCaptchaInterruption(page, log, shouldHalt, minMs, maxMs) {
  const total = randomInt(minMs, maxMs)
  let elapsed = 0
  const pollMs = 500
  while (elapsed < total) {
    if ((await detectBlockingFlow(page)) === 'challenge') {
      await waitIfChallengeOrLogin(page, log, shouldHalt)
      await haltIfNeeded(shouldHalt)
      break
    }
    await haltIfNeeded(shouldHalt)
    const step = Math.min(pollMs, total - elapsed)
    let left = step
    while (left > 0) {
      await haltIfNeeded(shouldHalt)
      const s = Math.min(400, left)
      await sleep(s)
      left -= s
    }
    elapsed += step
  }
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
 * Prefer wheel over the main video center (feed scrolls, sidebar untouched).
 * Fallback: keyboard after feed column focus.
 * @param {import('playwright').Page} page
 * @param {'down' | 'up'} dir
 * @param {(action: string, details?: string) => void} log
 */
async function scrollFeedStep(page, dir, log) {
  const vid = page.locator('main video, [data-e2e="feed-active-video"] video').first()
  try {
    if ((await vid.count()) > 0) {
      await vid.scrollIntoViewIfNeeded().catch(() => {})
      const box = await vid.boundingBox()
      if (box && box.width > 40 && box.height > 40) {
        const cx = box.x + box.width / 2
        const cy = box.y + box.height / 2
        await page.mouse.move(cx, cy)
        const dy = dir === 'down' ? randomInt(380, 720) : -randomInt(120, 280)
        await page.mouse.wheel(0, dy)
        log('SCROLL', `wheel on video center dy=${dy}px`)
        await sleep(120 + randomInt(0, 180))
        return
      }
    }
  } catch {
    /* fall through */
  }

  await focusFeedColumn(page, log)
  const times = dir === 'down' ? randomInt(2, 5) : randomInt(1, 2)
  for (let i = 0; i < times; i++) {
    await page.keyboard.press(dir === 'down' ? 'ArrowDown' : 'ArrowUp')
    await sleep(80 + randomInt(0, 120))
  }
  if (dir === 'down' && randomChance(35)) {
    await page.keyboard.press('PageDown')
    log('SCROLL', `fallback keyboard ArrowDown×${times}+PageDown`)
  } else {
    log('SCROLL', `fallback keyboard ${dir === 'down' ? 'ArrowDown' : 'ArrowUp'}×${times}`)
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

  await recoverFromLiveSurface(page, log, shouldHalt)
  await haltIfNeeded(shouldHalt)

  if ((await detectBlockingFlow(page)) === 'challenge') {
    log('TIKTOK_CHALLENGE_STILL_ACTIVE', 'skip actions this iteration — finish captcha in browser')
    await interruptibleRandomDelay(5000, 10000, shouldHalt)
    return
  }

  log('VIEW_VIDEO', 'watching 5–15s')
  await delayWithCaptchaInterruption(page, log, shouldHalt, 5000, 15000)
  await haltIfNeeded(shouldHalt)

  if (randomChance(30)) {
    log('VIEW_VIDEO', 'linger 3–8s (no scroll this beat)')
    await delayWithCaptchaInterruption(page, log, shouldHalt, 3000, 8000)
  } else {
    await scrollFeedStep(page, 'down', log)
    if (randomChance(25)) {
      await scrollFeedStep(page, 'up', log)
      log('SCROLL_BACK', 'up')
    }
  }
  await haltIfNeeded(shouldHalt)

  if ((await detectBlockingFlow(page)) === 'challenge') {
    await waitIfChallengeOrLogin(page, log, shouldHalt)
    await haltIfNeeded(shouldHalt)
  }

  if (await pageShowsLiveContext(page)) {
    await recoverFromLiveSurface(page, log, shouldHalt)
    await haltIfNeeded(shouldHalt)
  }

  if (shouldTryLike() && !(await pageShowsLiveContext(page))) {
    await focusFeedColumn(page, log)
    const likeSelectors = [
      '[data-e2e="browse-like-icon"]',
      '[data-e2e="like-icon"]',
      '[data-e2e="video-player-like-icon"]',
      'button[aria-label*="Like" i]',
    ]
    try {
      let clicked = false
      for (const sel of likeSelectors) {
        const loc = page.locator(sel).first()
        if ((await loc.count()) === 0) continue
        await loc.scrollIntoViewIfNeeded().catch(() => {})
        const vis = await loc.isVisible().catch(() => false)
        if (!vis) continue
        await loc.click({ timeout: 4500 })
        clicked = true
        log('LIKE_VIDEO', `like ${sel}`)
        break
      }
      if (!clicked) {
        log('LIKE_SKIPPED', 'no visible like control')
      } else {
        await interruptibleRandomDelay(800, 2200, shouldHalt)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      log('LIKE_SKIPPED', msg.slice(0, 200))
    }
    await haltIfNeeded(shouldHalt)
  }

  if (randomChance(15)) {
    if (await pageShowsLiveContext(page)) {
      log('CLICK_VIDEO', 'skipped — LIVE/stream surface')
    } else {
      const vid = page.locator('main video, [data-e2e="feed-active-video"] video').first()
      try {
        if ((await vid.count()) > 0) {
          await vid.scrollIntoViewIfNeeded().catch(() => {})
          const box = await vid.boundingBox()
          if (box && box.width > 20 && box.height > 20) {
            await vid.click({
              position: {
                x: box.width / 2,
                y: Math.min(box.height * 0.42, box.height * 0.48),
              },
              timeout: 6000,
            })
            log('CLICK_VIDEO', 'locator click center-ish on video')
            await delayWithCaptchaInterruption(page, log, shouldHalt, 5000, 12000)
          }
        }
      } catch {
        log('CLICK_VIDEO', 'skipped')
      }
    }
    await haltIfNeeded(shouldHalt)
  }

  const profilePct = profilePeekPercent()
  if (profilePct > 0 && randomChance(profilePct) && !(await pageShowsLiveContext(page))) {
    const author = page.locator('[data-e2e="video-author-uniqueid"]').first()
    try {
      if ((await author.count()) > 0) {
        await author.scrollIntoViewIfNeeded().catch(() => {})
        await author.click({ timeout: 8000 })
        const u = page.url()
        log('OPEN_PROFILE', u)
        await delayWithCaptchaInterruption(page, log, shouldHalt, 5000, 10000)
        await page.goBack({ waitUntil: 'commit', timeout: 20000 }).catch(() => {})
        log('PROFILE_BACK', page.url())
      }
    } catch {
      log('OPEN_PROFILE', 'skipped')
    }
    await haltIfNeeded(shouldHalt)
  }
}
