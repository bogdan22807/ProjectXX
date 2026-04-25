/**
 * SAFE_TIKTOK_FEED_MODE — conservative TikTok FYP loop (stability over “human” tricks).
 *
 * Rules: single initial `goto` is outside this module (playwrightTestRun). Here: no goto/reload/goBack,
 * no PageUp/ArrowUp/wheel dy<0, no profile. VIEW_VIDEO (6–14s) → focused strong scroll on feed/video → rare like (3–5%).
 * LIVE card: double wheel + PageDown, then POST_LIVE_HARD_SCROLL (stable key after each sub-step).
 * LIVE surface (/live): only navigate to For You tab (clicks); no wheel/keyboard scroll on stream, no VIEW_VIDEO/LIKE.
 * Challenge: log + status `challenge_detected` + throw ExecutorHaltError('challenge') to end run.
 */

import { interruptibleRandomDelay, randomChance, randomInt, sleep } from '../asyncUtils.js'
import { ExecutorHaltError } from '../executorHalt.js'
import { runPostLiveHardScrollSequence } from './postLiveHardScroll.js'
import {
  tiktokFocusAndWheel,
  tiktokStrongScrollWithRecovery,
} from './tiktokStrongFeedScroll.js'

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
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 * @param {number} ms
 */
async function sleepMsHaltable(shouldHalt, ms) {
  let left = Math.max(0, Math.floor(Number(ms) || 0))
  while (left > 0) {
    await haltIfNeeded(shouldHalt)
    const step = Math.min(400, left)
    await sleep(step)
    left -= step
  }
}

function pageInLiveSurfaceUrl(page) {
  try {
    return new URL(page.url()).pathname.toLowerCase().includes('/live')
  } catch {
    return String(page.url()).toLowerCase().includes('/live')
  }
}

/** TikTok host and not still on /live path (after For You navigation). */
function isTikTokNotLiveSurface(page) {
  try {
    const u = new URL(page.url())
    if (!u.hostname.toLowerCase().includes('tiktok.com')) return false
    return !u.pathname.toLowerCase().includes('/live')
  } catch {
    const s = String(page.url()).toLowerCase()
    return s.includes('tiktok.com') && !s.includes('/live')
  }
}

async function detectChallengeBlocking(page) {
  const u = page.url().toLowerCase()
  if (
    u.includes('captcha') ||
    u.includes('/verify') ||
    u.includes('challenge') ||
    u.includes('sec_sdk') ||
    u.includes('/authentication')
  ) {
    return true
  }
  const ti = ((await page.title().catch(() => '')) ?? '').toLowerCase()
  if (ti.includes('captcha') || ti.includes('verify') || ti.includes('security check')) return true
  try {
    const n = await page.locator('iframe[src*="captcha" i], iframe[src*="verify" i]').count()
    if (n > 0) return true
  } catch {
    /* ignore */
  }
  return false
}

/**
 * LIVE **card** in FYP (not `/live` URL).
 * @param {import('playwright').Page} page
 */
async function detectLiveFeedCard(page) {
  if (pageInLiveSurfaceUrl(page)) return false
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
    if (await root.getByText(/\bLIVE\s+NOW\b/i).first().isVisible().catch(() => false)) return true
  } catch {
    /* ignore */
  }
  return false
}

/**
 * Stable key: author profile link + video src prefix.
 * @param {import('playwright').Page} page
 */
async function getStableVideoKey(page) {
  try {
    const root = page.locator('[data-e2e="feed-active-video"]').first()
    if ((await root.count()) === 0) return ''
    const href =
      (await root.locator('[data-e2e="video-author-uniqueid"] a').first().getAttribute('href').catch(() => null)) ?? ''
    const src = (await root.locator('video').first().getAttribute('src').catch(() => null)) ?? ''
    return `${String(href).trim()}|${String(src).trim().slice(0, 160)}`.slice(0, 400)
  } catch {
    return ''
  }
}

/**
 * One FYP scroll: focus active feed target + strong wheel + retry (stable key).
 * @param {import('playwright').Page} page
 * @param {(action: string, details?: string) => void} log
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 * @param {string} beforeKey
 */
async function scrollDownOnce(page, log, shouldHalt, beforeKey) {
  await tiktokStrongScrollWithRecovery(page, log, shouldHalt, () => getStableVideoKey(page), beforeKey)
}

/**
 * Click "For You" nav to leave LIVE room — no scrolling the stream (no wheel / ArrowDown / PageDown on feed).
 * @param {import('playwright').Page} page
 */
async function tryClickForYouNav(page) {
  const candidates = [
    page.locator('a[href*="/foryou"]').first(),
    page.locator('[data-e2e="nav-for-you"]').first(),
    page.getByRole('link', { name: /^For You$/i }).first(),
    page.locator('a', { hasText: /^For You$/ }).first(),
  ]
  for (const loc of candidates) {
    try {
      if ((await loc.count()) === 0) continue
      if (!(await loc.isVisible().catch(() => false))) continue
      await loc.click({ timeout: 7000 })
      return true
    } catch {
      /* try next selector */
    }
  }
  return false
}

/**
 * @param {import('playwright').Page} page
 * @param {(action: string, details?: string) => void} log
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 */
async function escapeLiveSurface(page, log, shouldHalt) {
  log('LIVE_SURFACE_DETECTED', page.url().slice(0, 280))

  for (let attempt = 1; attempt <= 2; attempt++) {
    log('NAVIGATE_TO_FORYOU', `attempt=${attempt}`)
    await tryClickForYouNav(page)
    await sleepMsHaltable(shouldHalt, randomInt(800, 1500))
    await haltIfNeeded(shouldHalt)

    if (isTikTokNotLiveSurface(page)) {
      log('FORYOU_OPENED', page.url().slice(0, 280))
      return
    }
  }

  log('LIVE_HARD_STUCK', `still on LIVE surface url=${page.url().slice(0, 280)}`)
}

/**
 * @param {import('playwright').Page} page
 * @param {(action: string, details?: string) => void} log
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 */
async function handleLiveFeedCard(page, log, shouldHalt) {
  log('LIVE_DETECTED', 'FYP LIVE card')
  await tiktokFocusAndWheel(page, log, shouldHalt, 1000, 1400)
  log('LIVE_SKIP_SCROLL_1', 'wheel 1000–1400')
  await sleepMsHaltable(shouldHalt, randomInt(300, 700))

  await tiktokFocusAndWheel(page, log, shouldHalt, 1000, 1400)
  log('LIVE_SKIP_SCROLL_2', 'wheel 1000–1400')
  await sleepMsHaltable(shouldHalt, randomInt(300, 700))

  await page.keyboard.press('PageDown').catch(() => {})
  log('LIVE_SKIP_PAGEDOWN', 'PageDown')

  await sleepMsHaltable(shouldHalt, randomInt(500, 1200))
  await haltIfNeeded(shouldHalt)

  log('LIVE_SKIPPED', 'LIVE card handled — starting POST_LIVE_HARD_SCROLL')
  await runPostLiveHardScrollSequence({
    page,
    log,
    shouldHalt,
    getStableKey: () => getStableVideoKey(page),
  })
}

/**
 * @param {import('playwright').Page} page
 * @param {(action: string, details?: string) => void} log
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 * @param {string} beforeKey
 */
async function ensureAdvancedAfterScroll(page, log, shouldHalt, beforeKey) {
  await sleepMsHaltable(shouldHalt, randomInt(500, 1200))
  await haltIfNeeded(shouldHalt)

  if (!String(beforeKey).trim()) return

  let after = await getStableVideoKey(page)
  if (!after || after !== beforeKey) return

  log('FEED_STUCK_DETECTED', `sameStableKey len=${beforeKey.length}`)
  await tiktokStrongScrollWithRecovery(page, log, shouldHalt, () => getStableVideoKey(page), beforeKey)
}

function likePercentThisRun() {
  const raw = process.env.SAFE_TIKTOK_LIKE_PERCENT
  if (raw != null && String(raw).trim() !== '') {
    const n = Number(raw)
    if (Number.isFinite(n)) return Math.min(10, Math.max(0, n))
  }
  return randomInt(3, 5)
}

/**
 * VIEW_VIDEO 6–14s with challenge polling.
 * @param {import('playwright').Page} page
 * @param {(action: string, details?: string) => void} log
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 */
async function viewVideoSafe(page, log, shouldHalt) {
  log('VIEW_VIDEO', 'watching 6–14s (SAFE_TIKTOK_FEED_MODE)')
  const total = randomInt(6000, 14000)
  let elapsed = 0
  const chunk = 500
  while (elapsed < total) {
    if (await detectChallengeBlocking(page)) {
      log('TIKTOK_CHALLENGE_DETECTED', 'challenge/verify — halting safe feed run')
      throw new ExecutorHaltError('challenge')
    }
    await haltIfNeeded(shouldHalt)
    const step = Math.min(chunk, total - elapsed)
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
 * Rare like — only when not LIVE, not challenge, control visible.
 * @param {import('playwright').Page} page
 * @param {(action: string, details?: string) => void} log
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 */
async function maybeLike(page, log, shouldHalt) {
  if (pageInLiveSurfaceUrl(page) || (await detectLiveFeedCard(page))) {
    log('LIKE_SKIPPED', 'LIVE — no like')
    return
  }
  if (await detectChallengeBlocking(page)) {
    log('TIKTOK_CHALLENGE_DETECTED', 'challenge during like window — skip like')
    return
  }
  if (!randomChance(likePercentThisRun())) {
    log('LIKE_SKIPPED', 'probability skip')
    return
  }

  const likeSelectors = [
    '[data-e2e="browse-like-icon"]',
    '[data-e2e="like-icon"]',
    '[data-e2e="video-player-like-icon"]',
    'button[aria-label*="Like" i]',
  ]
  for (const sel of likeSelectors) {
    const loc = page.locator(sel).first()
    if ((await loc.count()) === 0) continue
    const vis = await loc.isVisible().catch(() => false)
    if (!vis) continue
    try {
      await loc.click({ timeout: 4000 })
      log('LIKE_VIDEO', sel)
      await interruptibleRandomDelay(400, 900, shouldHalt)
      return
    } catch {
      /* try next */
    }
  }
  log('LIKE_SKIPPED', 'no visible like control')
}

/**
 * One iteration of SAFE_TIKTOK_FEED_MODE.
 * @param {import('playwright').Page} page
 * @param {(action: string, details?: string) => void} log
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 * @param {{ debugScreenshots?: boolean; screenshotDir?: string }} [_options]
 */
export async function runSafeTikTokFeedIteration(page, log, shouldHalt, _options = {}) {
  log('SAFE_TIKTOK_FEED_MODE', 'iteration start')

  if (await detectChallengeBlocking(page)) {
    log('TIKTOK_CHALLENGE_DETECTED', 'challenge/verify at iteration start — halting run')
    throw new ExecutorHaltError('challenge')
  }
  await haltIfNeeded(shouldHalt)

  if (pageInLiveSurfaceUrl(page)) {
    await escapeLiveSurface(page, log, shouldHalt)
    return
  }

  if (await detectLiveFeedCard(page)) {
    await handleLiveFeedCard(page, log, shouldHalt)
    return
  }

  await viewVideoSafe(page, log, shouldHalt)
  await haltIfNeeded(shouldHalt)

  if (pageInLiveSurfaceUrl(page)) {
    log('BLOCKED_FEED_SCROLL_IN_LIVE', 'surface appeared during VIEW_VIDEO')
    await escapeLiveSurface(page, log, shouldHalt)
    return
  }
  if (await detectLiveFeedCard(page)) {
    await handleLiveFeedCard(page, log, shouldHalt)
    return
  }

  const beforeScroll = await getStableVideoKey(page)
  await scrollDownOnce(page, log, shouldHalt, beforeScroll)
  await haltIfNeeded(shouldHalt)
  await ensureAdvancedAfterScroll(page, log, shouldHalt, beforeScroll)

  await haltIfNeeded(shouldHalt)
  if (!(await detectLiveFeedCard(page)) && !pageInLiveSurfaceUrl(page)) {
    await maybeLike(page, log, shouldHalt)
  }
}
