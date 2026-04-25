/**
 * SAFE_TIKTOK_FEED_MODE — TikTok FYP: controlled one-video scroll, optional single rich action per video
 * (like / comments / profile), weighted watch times, irregular pauses. No goto/reload/goBack, no upward scroll.
 * LIVE: skip only via controlled scroll; LIVE URL: navigate to For You via nav clicks only.
 */

import { randomChance, randomInt, sleep } from '../asyncUtils.js'
import { tiktokWheelDownOnly } from './tiktokScrollHelpers.js'
import { ExecutorHaltError } from '../executorHalt.js'
import { runPostLiveHardScrollSequence } from './postLiveHardScroll.js'
import { runSafeTikTokControlledOneVideoScroll } from './safeTikTokOneVideoScroll.js'

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
  try {
    if (page.isClosed()) return false
  } catch {
    return false
  }
  const root = page.locator('[data-e2e="feed-active-video"]').first()
  let cnt = 0
  try {
    cnt = await root.count()
  } catch {
    try {
      if (page.isClosed()) return false
    } catch {
      return false
    }
    return false
  }
  if (cnt === 0) return false
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
    if (page.isClosed()) return ''
    const root = page.locator('[data-e2e="feed-active-video"]').first()
    let cnt = 0
    try {
      cnt = await root.count()
    } catch {
      if (page.isClosed()) return ''
      return ''
    }
    if (cnt === 0) return ''
    const href =
      (await root.locator('[data-e2e="video-author-uniqueid"] a').first().getAttribute('href').catch(() => null)) ?? ''
    const src = (await root.locator('video').first().getAttribute('src').catch(() => null)) ?? ''
    return `${String(href).trim()}|${String(src).trim().slice(0, 160)}`.slice(0, 400)
  } catch {
    return ''
  }
}

/**
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
  const k0 = await getStableVideoKey(page)
  await runSafeTikTokControlledOneVideoScroll(page, log, shouldHalt, () => getStableVideoKey(page))
  log('LIVE_SKIP_SCROLL', 'controlled_one_video')

  await sleepMsHaltable(shouldHalt, randomInt(500, 1200))
  await haltIfNeeded(shouldHalt)

  const k1 = await getStableVideoKey(page)
  if (k1 === k0) {
    log('LIVE_SKIPPED', 'LIVE card — optional POST_LIVE one_pass')
    await runPostLiveHardScrollSequence({
      page,
      log,
      shouldHalt,
      getStableKey: () => getStableVideoKey(page),
    })
  } else {
    log('LIVE_SKIPPED', 'LIVE card — feed advanced')
  }
}

async function ensureAdvancedAfterScroll(page, log, shouldHalt, _beforeKey) {
  await sleepMsHaltable(shouldHalt, randomInt(500, 1200))
  await haltIfNeeded(shouldHalt)
}

/** 25% / 55% / 20% — 2–5s, 7–15s, 16–30s */
function sampleWatchMsWeighted() {
  const r = Math.random() * 100
  if (r < 25) return randomInt(2000, 5000)
  if (r < 80) return randomInt(7000, 15000)
  return randomInt(16000, 30000)
}

/** At most one of like | comments | profile | none */
function pickRichActionForVideo() {
  const likePct = randomInt(2, 4)
  const comPct = randomInt(1, 2)
  const profPct = randomInt(1, 2)
  const r = Math.random() * 100
  if (r < likePct) return 'like'
  if (r < likePct + comPct) return 'comments'
  if (r < likePct + comPct + profPct) return 'profile'
  return 'none'
}

function minWatchMsForAction(action) {
  if (action === 'like') return randomInt(6000, 12000)
  if (action === 'comments') return randomInt(8000, 15000)
  if (action === 'profile') return randomInt(10000, 18000)
  return 0
}

/**
 * @param {import('playwright').Page} page
 * @param {(action: string, details?: string) => void} log
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 * @param {number} totalMs
 */
async function viewVideoWeighted(page, log, shouldHalt, totalMs) {
  log('VIEW_VIDEO', `watching ${Math.round(totalMs / 100) / 10}s (weighted)`)
  let elapsed = 0
  const chunk = 500
  while (elapsed < totalMs) {
    if (await detectChallengeBlocking(page)) {
      log('TIKTOK_CHALLENGE_DETECTED', 'challenge/verify — halting safe feed run')
      throw new ExecutorHaltError('challenge')
    }
    await haltIfNeeded(shouldHalt)
    const step = Math.min(chunk, totalMs - elapsed)
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
 * @param {import('playwright').Page} page
 */
async function readLikePressedState(page) {
  const selectors = [
    '[data-e2e="browse-like-icon"]',
    '[data-e2e="like-icon"]',
    '[data-e2e="video-player-like-icon"]',
    'button[aria-label*="Like" i]',
  ]
  for (const sel of selectors) {
    const loc = page.locator(sel).first()
    if ((await loc.count().catch(() => 0)) === 0) continue
    const pressed = await loc.getAttribute('aria-pressed').catch(() => null)
    if (pressed === 'true') return true
    const cls = (await loc.getAttribute('class').catch(() => '')) ?? ''
    if (/fill|liked|active/i.test(cls)) return true
  }
  return false
}

/**
 * @param {import('playwright').Page} page
 * @param {(action: string, details?: string) => void} log
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 */
async function tryLikeWithVerify(page, log, shouldHalt) {
  if (pageInLiveSurfaceUrl(page) || (await detectLiveFeedCard(page))) {
    log('LIKE_SKIPPED', 'LIVE')
    return
  }
  if (await detectChallengeBlocking(page)) {
    log('LIKE_SKIPPED', 'challenge')
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
    const before = await readLikePressedState(page)
    try {
      await loc.click({ timeout: 4000 })
      log('LIKE_CLICK', sel)
    } catch {
      log('LIKE_SKIPPED', 'click_failed')
      return
    }
    await sleepMsHaltable(shouldHalt, randomInt(350, 700))
    await haltIfNeeded(shouldHalt)
    const after = await readLikePressedState(page)
    if (after && !before) {
      log('LIKE_VERIFIED', 'state_on')
    } else if (after && before) {
      log('LIKE_VERIFIED', 'already_liked')
    } else {
      log('LIKE_NOT_VERIFIED', 'no_state_change — continue')
    }
    await sleepMsHaltable(shouldHalt, randomInt(1000, 2500))
    await haltIfNeeded(shouldHalt)
    return
  }
  log('LIKE_SKIPPED', 'no visible like control')
}

const COMMENT_ICON_SELECTORS = [
  '[data-e2e="browse-comment-icon"]',
  '[data-e2e="comment-icon"]',
  '[data-e2e="video-comment-icon"]',
  'button[aria-label*="Comment" i]',
]

/**
 * @param {import('playwright').Page} page
 * @param {(action: string, details?: string) => void} log
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 */
async function tryCommentsPeek(page, log, shouldHalt) {
  if (pageInLiveSurfaceUrl(page) || (await detectLiveFeedCard(page))) {
    log('COMMENTS_SKIPPED', 'LIVE')
    return
  }
  let opened = false
  for (const sel of COMMENT_ICON_SELECTORS) {
    const loc = page.locator(sel).first()
    if ((await loc.count()) === 0) continue
    if (!(await loc.isVisible().catch(() => false))) continue
    try {
      await loc.click({ timeout: 5000 })
      opened = true
      log('COMMENTS_OPEN', sel)
      break
    } catch {
      /* next */
    }
  }
  if (!opened) {
    log('COMMENTS_SKIPPED', 'no control')
    return
  }

  await sleepMsHaltable(shouldHalt, randomInt(400, 900))
  await haltIfNeeded(shouldHalt)

  const insideMs = randomInt(4000, 12000)
  await viewVideoWeighted(page, log, shouldHalt, insideMs)

  if (randomChance(50)) {
    const panel = page.locator('[data-e2e="comment-list"], [class*="CommentList"], div[role="dialog"]').first()
    if ((await panel.count().catch(() => 0)) > 0) {
      try {
        await panel.locator('div').first().click({ timeout: 2000 }).catch(() => {})
        await tiktokWheelDownOnly(page, randomInt(200, 450), log)
        log('COMMENTS_SCROLL', 'once_light')
      } catch {
        /* ignore */
      }
    }
  }

  await page.keyboard.press('Escape').catch(() => {})
  await sleepMsHaltable(shouldHalt, randomInt(100, 300))
  await page.keyboard.press('Escape').catch(() => {})
  log('COMMENTS_CLOSE', 'escape')
  await sleepMsHaltable(shouldHalt, randomInt(1000, 2000))
  await haltIfNeeded(shouldHalt)
}

/**
 * @param {import('playwright').Page} page
 * @param {(action: string, details?: string) => void} log
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 */
async function tryProfilePeek(page, log, shouldHalt) {
  if (pageInLiveSurfaceUrl(page) || (await detectLiveFeedCard(page))) {
    log('PROFILE_SKIPPED', 'LIVE')
    return
  }
  const author = page.locator('[data-e2e="video-author-uniqueid"]').first()
  if ((await author.count()) === 0) {
    log('PROFILE_SKIPPED', 'no author')
    return
  }
  try {
    await author.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {})
    await author.click({ timeout: 8000 })
  } catch {
    log('PROFILE_SKIPPED', 'click_failed')
    return
  }

  log('PROFILE_OPEN', page.url().slice(0, 200))
  await sleepMsHaltable(shouldHalt, randomInt(800, 1500))
  await haltIfNeeded(shouldHalt)

  const dwell = randomInt(5000, 15000)
  await viewVideoWeighted(page, log, shouldHalt, dwell)

  if (randomChance(45)) {
    try {
      await tiktokWheelDownOnly(page, randomInt(280, 520), log)
      log('PROFILE_SCROLL', 'once_light')
      await sleepMsHaltable(shouldHalt, randomInt(400, 900))
    } catch {
      /* ignore */
    }
  }

  const ok = await tryClickForYouNav(page)
  log('PROFILE_EXIT', ok ? 'nav_foryou' : 'nav_failed')
  await sleepMsHaltable(shouldHalt, randomInt(2000, 4000))
  await haltIfNeeded(shouldHalt)
}

/** Feed videos advanced since last long break (module state). */
let videosSinceLongBreak = 0
let nextLongBreakEvery = randomInt(8, 15)

function resetLongBreakSchedule() {
  videosSinceLongBreak = 0
  nextLongBreakEvery = randomInt(8, 15)
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

  try {
    if (page.isClosed()) {
      log('PAGE_CLOSED_DURING_STOP', 'iteration_start')
      return
    }
  } catch {
    log('PAGE_CLOSED_DURING_STOP', 'iteration_start')
    return
  }

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
    videosSinceLongBreak += 1
    return
  }

  const richAction = pickRichActionForVideo()
  const baseWatch = sampleWatchMsWeighted()
  const minNeed = minWatchMsForAction(richAction)
  const watchMs = richAction === 'none' ? baseWatch : Math.max(baseWatch, minNeed)

  await viewVideoWeighted(page, log, shouldHalt, watchMs)
  await haltIfNeeded(shouldHalt)

  if (pageInLiveSurfaceUrl(page)) {
    log('BLOCKED_FEED_SCROLL_IN_LIVE', 'surface appeared during VIEW_VIDEO')
    await escapeLiveSurface(page, log, shouldHalt)
    return
  }
  if (await detectLiveFeedCard(page)) {
    await handleLiveFeedCard(page, log, shouldHalt)
    videosSinceLongBreak += 1
    return
  }

  if (richAction === 'like') {
    log('RICH_ACTION', 'like')
    await tryLikeWithVerify(page, log, shouldHalt)
  } else if (richAction === 'comments') {
    log('RICH_ACTION', 'comments')
    await tryCommentsPeek(page, log, shouldHalt)
  } else if (richAction === 'profile') {
    log('RICH_ACTION', 'profile')
    await tryProfilePeek(page, log, shouldHalt)
  } else {
    log('RICH_ACTION', 'none')
  }

  await haltIfNeeded(shouldHalt)

  if (pageInLiveSurfaceUrl(page) || (await detectLiveFeedCard(page))) {
    if (await detectLiveFeedCard(page)) await handleLiveFeedCard(page, log, shouldHalt)
    else await escapeLiveSurface(page, log, shouldHalt)
    videosSinceLongBreak += 1
    return
  }

  if (!randomChance(30)) {
    await sleepMsHaltable(shouldHalt, randomInt(800, 2500))
  } else {
    log('SCROLL_PRE_PAUSE', 'skipped_burst')
  }
  await haltIfNeeded(shouldHalt)

  const beforeScroll = await getStableVideoKey(page)
  await runSafeTikTokControlledOneVideoScroll(page, log, shouldHalt, () => getStableVideoKey(page))
  await haltIfNeeded(shouldHalt)
  await ensureAdvancedAfterScroll(page, log, shouldHalt, beforeScroll)

  videosSinceLongBreak += 1

  if (randomChance(45)) {
    await sleepMsHaltable(shouldHalt, randomInt(2000, 6000))
    log('PAUSE_BETWEEN_VIDEOS', '2–6s')
  }

  if (videosSinceLongBreak >= nextLongBreakEvery) {
    const longMs = randomInt(15000, 45000)
    log('PAUSE_LONG_BREAK', `every_${nextLongBreakEvery}_videos ${longMs}ms`)
    await sleepMsHaltable(shouldHalt, longMs)
    resetLongBreakSchedule()
  }

  await haltIfNeeded(shouldHalt)
}
