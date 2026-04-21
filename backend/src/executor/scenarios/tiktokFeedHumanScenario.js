/**
 * One "human" iteration on TikTok FYP: watch → keyboard scroll (feed-focused) → optional video center-click.
 * No page.goto / reload in the normal path — caller opens TikTok once.
 * Full-page LIVE room (`/live` URL): leave with Escape / back / keyboard-only scroll — no `goto` / reload.
 *
 * Mouse wheel at screen edge often hovers the sidebar avatar (flicker). Keyboard scroll + center focus avoids that.
 * Captcha/verify: we pause and log so you can solve manually; we do not auto-solve.
 */

import fs from 'node:fs'
import path from 'node:path'
import { interruptibleRandomDelay, randomChance, randomInt, sleep } from '../asyncUtils.js'
import { ExecutorHaltError } from '../executorHalt.js'

/** After a LIVE feed card, suppress SCROLL_BACK for this many iterations (incl. current). */
let skipScrollBackAfterLive = 0

/** Consecutive same-card detection (anti stuck / LIVE ping-pong). */
let lastFeedStableKey = ''
let feedRepeatStreak = 0

/** Consecutive iterations that chose the linger branch (30% random). At 2, next iteration forces scroll. */
let consecutiveLingerStreak = 0

function defaultScreenshotDir() {
  return path.join(process.cwd(), 'playwright-debug')
}

/**
 * @param {import('playwright').Page} page
 * @param {boolean} enabled
 * @param {string} [dir]
 * @param {string} filename
 */
async function maybeLiveDebugScreenshot(page, enabled, dir, filename) {
  if (!enabled) return
  const d = String(dir ?? '').trim() || defaultScreenshotDir()
  try {
    fs.mkdirSync(d, { recursive: true })
    await page.screenshot({ path: path.join(d, filename), fullPage: false }).catch(() => {})
  } catch {
    /* ignore */
  }
}

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
 * Dedicated live stream page (not the same as a LIVE badge on a For You card).
 * @param {import('playwright').Page} page
 */
function pageInLiveRoomUrl(page) {
  try {
    const p = new URL(page.url()).pathname.toLowerCase()
    return p.includes('/live')
  } catch {
    return String(page.url()).toLowerCase().includes('/live')
  }
}

/**
 * Scroll past LIVE/stream without clicking or hovering the video (keyboard only).
 * @param {import('playwright').Page} page
 * @param {(action: string, details?: string) => void} log
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 * @param {string} reason short tag for log details
 */
async function scrollPastLiveNoPointer(page, log, shouldHalt, reason) {
  const n = randomInt(6, 11)
  for (let i = 0; i < n; i++) {
    await haltIfNeeded(shouldHalt)
    await page.keyboard.press('ArrowDown')
    await sleep(65 + randomInt(0, 95))
  }
  await page.keyboard.press('PageDown').catch(() => {})
  await page.keyboard.press('PageDown').catch(() => {})
  log('SCROLL', `live-skip keyboard-only reason=${reason} ArrowDown×${n}+PageDown×2`)
}

/**
 * Leave full-page LIVE room without `goto` / reload: Escape, back, then keyboard-only feed advance.
 * @param {import('playwright').Page} page
 * @param {(action: string, details?: string) => void} log
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 */
async function recoverFromLiveSurface(page, log, shouldHalt) {
  const before = page.url()
  if (!pageInLiveRoomUrl(page)) return false

  log('TIKTOK_LIVE_DETECTED', before.slice(0, 280))

  await page.keyboard.press('Escape').catch(() => {})
  await interruptibleRandomDelay(400, 900, shouldHalt)
  if (!pageInLiveRoomUrl(page)) {
    log('TIKTOK_LIVE_EXIT', `after Escape url=${page.url().slice(0, 200)}`)
    return true
  }

  await page.goBack({ waitUntil: 'commit', timeout: 18_000 }).catch(() => {})
  await interruptibleRandomDelay(500, 1200, shouldHalt)
  if (!pageInLiveRoomUrl(page)) {
    log('TIKTOK_LIVE_EXIT', `after goBack url=${page.url().slice(0, 200)}`)
    return true
  }

  log('LIVE_SKIPPED', 'still on /live — keyboard scroll only (no goto/reload)')
  for (let wave = 0; wave < 4 && pageInLiveRoomUrl(page); wave++) {
    await scrollPastLiveNoPointer(page, log, shouldHalt, 'exit_live_room')
    await interruptibleRandomDelay(350, 700, shouldHalt)
  }
  if (pageInLiveRoomUrl(page)) {
    log('TIKTOK_LIVE_EXIT_FAILED', 'still /live after keyboard-only recovery waves')
  } else {
    log('TIKTOK_LIVE_EXIT', `after keyboard-only url=${page.url().slice(0, 200)}`)
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
 * @param {string} blob
 */
function textIndicatesLiveCard(blob) {
  const s = String(blob ?? '')
  if (!s.trim()) return false
  const upper = s.toUpperCase()
  if (/\bLIVE NOW\b/i.test(s)) return true
  if (/\bLIVE\b/.test(upper)) return true
  return false
}

/**
 * Sample text from the active feed card (video container + a few ancestors) for LIVE heuristics.
 * @param {import('playwright').Page} page
 */
async function readActiveFeedCardText(page) {
  const handle = page.locator('[data-e2e="feed-active-video"]').first()
  if ((await handle.count()) === 0) return ''
  try {
    return await handle.evaluate((el) => {
      let n = /** @type {HTMLElement | null} */ (el)
      const parts = []
      for (let i = 0; i < 8 && n; i++) {
        const t = (n.innerText || n.textContent || '').replace(/\s+/g, ' ').trim()
        if (t.length > 0) parts.push(t.slice(0, 500))
        n = n.parentElement
      }
      return parts.join(' | ').slice(0, 2500)
    })
  } catch {
    return ''
  }
}

/**
 * Stable-ish key for "same card again" (author link + video src prefix).
 * @param {import('playwright').Page} page
 */
async function getFeedStableKey(page) {
  try {
    const root = page.locator('[data-e2e="feed-active-video"]').first()
    if ((await root.count()) === 0) return ''
    const href =
      (await root.locator('[data-e2e="video-author-uniqueid"] a').first().getAttribute('href').catch(() => null)) ??
      ''
    const src =
      (await root.locator('video').first().getAttribute('src').catch(() => null)) ?? ''
    const combined = `${href}|${src.slice(0, 120)}`.trim()
    if (combined) return combined.slice(0, 400)
    const blob = await readActiveFeedCardText(page)
    return blob.slice(0, 200)
  } catch {
    return ''
  }
}

/**
 * LIVE stream card on For You (not the same as `/live` room URL).
 * @param {import('playwright').Page} page
 */
async function detectFeedCardLive(page) {
  if (pageInLiveRoomUrl(page)) return true

  const root = page.locator('[data-e2e="feed-active-video"]').first()
  if ((await root.count()) === 0) return false

  try {
    if (
      (await root.locator('[data-e2e="live-tag"], [data-e2e="video-live-tag"]').first().isVisible().catch(() => false))
    ) {
      return true
    }
  } catch {
    /* ignore */
  }

  try {
    if (await root.getByText(/^LIVE$/i).first().isVisible().catch(() => false)) return true
    if (await root.getByText(/\bLIVE\s+now\b/i).first().isVisible().catch(() => false)) return true
  } catch {
    /* ignore */
  }

  try {
    const ariaLive = root.locator('[aria-label*="live" i]').first()
    if (await ariaLive.isVisible().catch(() => false)) {
      const lab = ((await ariaLive.getAttribute('aria-label').catch(() => '')) ?? '').toLowerCase()
      if (lab.includes('live')) return true
    }
  } catch {
    /* ignore */
  }

  const blob = await readActiveFeedCardText(page)
  if (textIndicatesLiveCard(blob)) return true

  return false
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
 * @param {{ forceLarge?: boolean }} [opts]
 */
async function scrollFeedStep(page, dir, log, opts = {}) {
  const forceLarge = Boolean(opts.forceLarge)
  const vid = page.locator('main video, [data-e2e="feed-active-video"] video').first()
  try {
    if ((await vid.count()) > 0) {
      await vid.scrollIntoViewIfNeeded().catch(() => {})
      const box = await vid.boundingBox()
      if (box && box.width > 40 && box.height > 40) {
        const cx = box.x + box.width / 2
        const cy = box.y + box.height / 2
        await page.mouse.move(cx, cy)
        const dy =
          dir === 'down'
            ? forceLarge
              ? randomInt(720, 1100)
              : randomInt(380, 720)
            : forceLarge
              ? -randomInt(200, 400)
              : -randomInt(120, 280)
        await page.mouse.wheel(0, dy)
        log('SCROLL', `wheel on video center dy=${dy}px${forceLarge ? ' force' : ''}`)
        await sleep(120 + randomInt(0, 180))
        return
      }
    }
  } catch {
    /* fall through */
  }

  await focusFeedColumn(page, log)
  const times =
    dir === 'down'
      ? forceLarge
        ? randomInt(6, 10)
        : randomInt(2, 5)
      : forceLarge
        ? randomInt(2, 4)
        : randomInt(1, 2)
  for (let i = 0; i < times; i++) {
    await page.keyboard.press(dir === 'down' ? 'ArrowDown' : 'ArrowUp')
    await sleep(80 + randomInt(0, 120))
  }
  if (dir === 'down' && (forceLarge || randomChance(35))) {
    await page.keyboard.press('PageDown')
    if (forceLarge) {
      await page.keyboard.press('PageDown').catch(() => {})
    }
    log('SCROLL', `fallback keyboard ArrowDown×${times}+PageDown${forceLarge ? ' force' : ''}`)
  } else {
    log('SCROLL', `fallback keyboard ${dir === 'down' ? 'ArrowDown' : 'ArrowUp'}×${times}${forceLarge ? ' force' : ''}`)
  }
}

/**
 * @typedef {{ debugScreenshots?: boolean; screenshotDir?: string }} TikTokFeedIterationOptions
 */

/**
 * @param {import('playwright').Page} page
 * @param {(action: string, details?: string) => void} log
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 * @param {TikTokFeedIterationOptions} [options]
 */
export async function runTikTokHumanFeedIteration(page, log, shouldHalt, options = {}) {
  const debugShots = Boolean(options.debugScreenshots)
  const shotDir = options.screenshotDir

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

  const stableKey = await getFeedStableKey(page)
  if (stableKey) {
    if (stableKey === lastFeedStableKey) {
      feedRepeatStreak += 1
    } else {
      feedRepeatStreak = 1
      lastFeedStableKey = stableKey
    }
    if (feedRepeatStreak >= 2) {
      log('FEED_REPEAT_DETECTED', `keyLen=${stableKey.length} streak=${feedRepeatStreak}`)
      log('FORCE_SCROLL_AFTER_REPEAT', 'extra down scroll')
      await scrollFeedStep(page, 'down', log, { forceLarge: true })
      await haltIfNeeded(shouldHalt)
      feedRepeatStreak = 0
      lastFeedStableKey = ''
      consecutiveLingerStreak = 0
      skipScrollBackAfterLive = Math.max(skipScrollBackAfterLive, 2)
    }
  } else {
    feedRepeatStreak = 0
    lastFeedStableKey = ''
  }

  const cardLive = await detectFeedCardLive(page)
  if (cardLive) {
    log('LIVE_DETECTED', 'feed card or /live room — skip watch/linger/profile/click; scroll down')
    log('LIVE_SKIPPED', 'no VIEW_VIDEO linger; immediate scroll past LIVE')
    await maybeLiveDebugScreenshot(page, debugShots, shotDir, 'debug-live-skipped.png')
    await scrollPastLiveNoPointer(page, log, shouldHalt, 'feed_live_card')
    await haltIfNeeded(shouldHalt)
    skipScrollBackAfterLive = Math.max(skipScrollBackAfterLive, 2)
    consecutiveLingerStreak = 0
    return
  }

  log('VIEW_VIDEO', 'watching 5–15s')
  await delayWithCaptchaInterruption(page, log, shouldHalt, 5000, 15000)
  await haltIfNeeded(shouldHalt)

  if (consecutiveLingerStreak >= 2) {
    log('FORCE_SCROLL_AFTER_LINGER_STREAK', 'two lingers in a row — skip linger; scroll down')
    await scrollFeedStep(page, 'down', log)
    await haltIfNeeded(shouldHalt)
    consecutiveLingerStreak = 0
  } else if (randomChance(30)) {
    log('VIEW_VIDEO', 'linger 3–8s (no scroll this beat)')
    await delayWithCaptchaInterruption(page, log, shouldHalt, 3000, 8000)
    consecutiveLingerStreak += 1
  } else {
    await scrollFeedStep(page, 'down', log)
    consecutiveLingerStreak = 0
    if (randomChance(25)) {
      if (skipScrollBackAfterLive > 0) {
        log('LIVE_SKIPPED', 'SCROLL_BACK suppressed (after LIVE)')
      } else {
        await scrollFeedStep(page, 'up', log)
        log('SCROLL_BACK', 'up')
      }
    }
  }
  if (skipScrollBackAfterLive > 0) skipScrollBackAfterLive -= 1

  await haltIfNeeded(shouldHalt)

  if ((await detectBlockingFlow(page)) === 'challenge') {
    await waitIfChallengeOrLogin(page, log, shouldHalt)
    await haltIfNeeded(shouldHalt)
  }

  if (pageInLiveRoomUrl(page)) {
    await recoverFromLiveSurface(page, log, shouldHalt)
    await haltIfNeeded(shouldHalt)
  }

  const liveForActions = (await detectFeedCardLive(page)) || pageInLiveRoomUrl(page)

  if (shouldTryLike() && !liveForActions) {
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
    const liveNow = (await detectFeedCardLive(page)) || pageInLiveRoomUrl(page)
    const vid = page.locator('main video, [data-e2e="feed-active-video"] video').first()
    if (liveNow) {
      log('LIVE_SKIPPED', 'CLICK_VIDEO blocked — LIVE/stream card')
    } else if ((await vid.count()) === 0) {
      log('CLICK_VIDEO', 'skipped — no video')
    } else {
      const vis = await vid.isVisible().catch(() => false)
      if (!vis) {
        log('CLICK_VIDEO', 'skipped — not visible')
      } else {
        try {
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
        } catch {
          log('CLICK_VIDEO', 'skipped')
        }
      }
    }
    await haltIfNeeded(shouldHalt)
  }

  const profilePct = profilePeekPercent()
  if (profilePct > 0 && randomChance(profilePct)) {
    const liveNow = (await detectFeedCardLive(page)) || pageInLiveRoomUrl(page)
    if (liveNow) {
      log('LIVE_SKIPPED', 'OPEN_PROFILE blocked — LIVE/stream card')
    } else {
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
    }
    await haltIfNeeded(shouldHalt)
  }
}
