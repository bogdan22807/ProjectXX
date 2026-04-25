/**
 * SAFE_TIKTOK_FEED_MODE — TikTok FYP: controlled one-video scroll, optional single rich action per video
 * (like 15% / comments 5% / profile 5% / else none), weighted watch times, irregular pauses.
 * Rich actions: focus feed card + scrollIntoView + short waits + expanded selectors before like/comment/profile clicks. No goto/reload/goBack, no upward scroll.
 * LIVE: skip only via controlled scroll; LIVE URL: navigate to For You via nav clicks only.
 */

import { randomChance, randomInt, sleep } from '../asyncUtils.js'
import { tiktokStableKeyAdvanced, tiktokWheelDownOnly } from './tiktokScrollHelpers.js'
import {
  focusPrimaryFeedVideo,
  readStableKeyFromFeedRoot,
  resolvePrimaryFeedRoot,
} from './tiktokFeedLayout.js'
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

/**
 * @param {import('playwright').Page} page
 */
async function safePageClosed(page) {
  try {
    return page.isClosed()
  } catch {
    return true
  }
}

/**
 * @param {import('playwright').Page} page
 * @param {(action: string, details?: string) => void} log
 * @param {string} browserLabel
 */
async function logVideoDetectionStart(page, log, browserLabel) {
  let url = ''
  try {
    url = page.url()
  } catch {
    url = '(unreadable)'
  }
  const vp = page.viewportSize()
  const vw = vp && Number.isFinite(vp.width) ? vp.width : '?'
  const vh = vp && Number.isFinite(vp.height) ? vp.height : '?'
  log(
    'VIDEO_DETECTION_START',
    `url=${url.slice(0, 500)} viewport=${vw}x${vh} browser=${browserLabel}`,
  )
}

/**
 * @param {import('playwright').Page} page
 */
async function collectVideoDetectionCounts(page) {
  const feedActive = page.locator('[data-e2e="feed-active-video"]')
  const videoTag = page.locator('video')
  const videoPlayer = page.locator('[data-e2e="video-player"]')
  const article = page.locator('article')
  const feed_active_video_count = await feedActive.count().catch(() => 0)
  const video_tag_count = await videoTag.count().catch(() => 0)
  const video_player_count = await videoPlayer.count().catch(() => 0)
  const article_count = await article.count().catch(() => 0)
  return { feed_active_video_count, video_tag_count, video_player_count, article_count, feedActive }
}

/**
 * @param {import('playwright').Locator} loc
 * @param {import('playwright').Page} page
 */
async function isLocatorUsableInViewport(loc, page) {
  const vis = await loc.isVisible().catch(() => false)
  if (!vis) return { ok: false, reason: 'not_visible' }
  const box = await loc.boundingBox().catch(() => null)
  if (!box) return { ok: false, reason: 'not_visible' }
  const vp = page.viewportSize()
  const vh = vp && Number.isFinite(vp.height) ? vp.height : 800
  if (box.y + box.height <= 0 || box.y >= vh) return { ok: false, reason: 'offscreen' }
  return { ok: true, reason: null }
}

/**
 * @param {import('playwright').Page} page
 * @param {(action: string, details?: string) => void} log
 * @returns {Promise<{ hasUsableVideo: boolean; failureReason: string | null }>}
 */
async function logVideoDetectionResult(page, log) {
  if (await safePageClosed(page)) {
    log('VIDEO_DETECTION_RESULT', 'feed_active_video_count=0 (page_closed)')
    log('VIDEO_DETECTION_FAILED_REASON', 'reason=page_closed')
    return { hasUsableVideo: false, failureReason: 'page_closed' }
  }

  const { feed_active_video_count, video_tag_count, video_player_count, article_count, feedActive } =
    await collectVideoDetectionCounts(page)
  log(
    'VIDEO_DETECTION_RESULT',
    `feed_active_video_count=${feed_active_video_count} video_tag_count=${video_tag_count} video_player_count=${video_player_count} article_count=${article_count}`,
  )

  if (feed_active_video_count === 0 && video_tag_count === 0) {
    log('VIDEO_DETECTION_FAILED_REASON', 'reason=video_not_found')
    return { hasUsableVideo: false, failureReason: 'video_not_found' }
  }

  /** Any <video> in DOM ⇒ treat as visible feed for diagnostics / summary; do not block on missing e2e. */
  if (video_tag_count > 0) {
    if (feed_active_video_count === 0) {
      log('VIDEO_ASSUMED_FROM_VIDEO_TAG', `video_tag_count=${video_tag_count}`)
    }
    return { hasUsableVideo: true, failureReason: null }
  }

  /** feed card without separate video tag count (rare): require in-viewport feed root. */
  const root = feedActive.first()
  const primary = await isLocatorUsableInViewport(root, page)
  if (!primary.ok) {
    log('VIDEO_DETECTION_FAILED_REASON', `reason=${primary.reason}`)
    return { hasUsableVideo: false, failureReason: primary.reason }
  }
  return { hasUsableVideo: true, failureReason: null }
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
 * Stable key: same primary card as scroll/focus (`resolvePrimaryFeedRoot` + href|src).
 * @param {import('playwright').Page} page
 */
async function getStableVideoKey(page) {
  try {
    if (page.isClosed()) return ''
    const info = await resolvePrimaryFeedRoot(page)
    return await readStableKeyFromFeedRoot(page, info)
  } catch {
    return ''
  }
}

/**
 * Key for anti-repeat: stable key if non-empty, else url + first video src/poster + article count.
 * @param {import('playwright').Page} page
 */
async function getRepeatTrackingKey(page) {
  const primary = await getStableVideoKey(page)
  if (String(primary).trim()) return primary
  let url = ''
  try {
    url = page.url()
  } catch {
    url = ''
  }
  const v0 = page.locator('video').first()
  let src = ''
  let poster = ''
  if ((await v0.count().catch(() => 0)) > 0) {
    src = (await v0.getAttribute('src').catch(() => null)) ?? ''
    poster = (await v0.getAttribute('poster').catch(() => null)) ?? ''
  }
  const ac = await page.locator('article').count().catch(() => 0)
  return `fb|${url.slice(0, 240)}|${String(src).trim().slice(0, 120)}|${String(poster).trim().slice(0, 120)}|a=${ac}`.slice(0, 400)
}

/** Consecutive iterations ended with scroll stuck on same repeat-tracking key (module state). */
let lastRepeatTrackingKey = ''
let repeatStuckCount = 0

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
 * @param {string} browserLabel
 */
async function handleLiveFeedCard(page, log, shouldHalt, browserLabel) {
  log('LIVE_DETECTED', 'FYP LIVE card')
  await logVideoDetectionStart(page, log, browserLabel)
  const det = await logVideoDetectionResult(page, log)
  const k0 = await getStableVideoKey(page)
  let curUrl = ''
  try {
    curUrl = page.url()
  } catch {
    curUrl = ''
  }
  log(
    'SCROLL_CONTEXT',
    `has_video=${det.hasUsableVideo} current_url=${curUrl.slice(0, 400)} is_live=true`,
  )
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
  const kFinal = await getStableVideoKey(page)
  const changed = tiktokStableKeyAdvanced(k0, kFinal)
  log(
    'SCROLL_DEBUG',
    `key_before=${k0.slice(0, 120)} key_after=${kFinal.slice(0, 120)} changed=${changed}`,
  )
  return {
    path: 'live_card',
    viewedMs: 0,
    richAction: 'none',
    videoFound: det.hasUsableVideo,
    videoFailReason: det.failureReason,
    scrollRan: true,
    scrollOk: changed,
    keyBefore: k0,
    keyAfter: kFinal,
    scrollChanged: changed,
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

/** At most one of like | comments | profile | none (cumulative % on one roll). */
function pickRichActionForVideo() {
  const likePct = 15
  const comPct = 5
  const profPct = 5
  const r = Math.random() * 100
  const cutLike = likePct
  const cutCom = likePct + comPct
  const cutProf = likePct + comPct + profPct
  let pick = 'none'
  if (r < cutLike) pick = 'like'
  else if (r < cutCom) pick = 'comments'
  else if (r < cutProf) pick = 'profile'
  return { pick, likePct, comPct, profPct, roll: r, cutLike, cutCom, cutProf }
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

/** Active FYP card root when present (empty locator if count 0 — callers use count). */
function feedActiveRoot(page) {
  return page.locator('[data-e2e="feed-active-video"]').first()
}

/** Largest article / e2e card — same as scroll key (for scoping like/comment/author). */
async function primaryFeedRoot(page) {
  const info = await resolvePrimaryFeedRoot(page)
  if (!info || (info.kind !== 'e2e' && info.kind !== 'article')) return null
  return info.root
}

/**
 * Same focus path as scroll (`focusPrimaryFeedVideo` / `resolvePrimaryFeedRoot`) so rich actions target the main card.
 * @param {import('playwright').Page} page
 * @param {(action: string, details?: string) => void} log
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 */
async function focusFeedCardForRichActions(page, log, shouldHalt) {
  await focusPrimaryFeedVideo(page, log, shouldHalt, 'RICH_FOCUS')
  await sleepMsHaltable(shouldHalt, randomInt(400, 900))
  await haltIfNeeded(shouldHalt)
}

/**
 * @param {import('playwright').Locator} loc
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 */
async function scrollControlIntoView(loc, shouldHalt) {
  try {
    await loc.scrollIntoViewIfNeeded({ timeout: 6000 })
  } catch {
    /* ignore */
  }
  await sleepMsHaltable(shouldHalt, randomInt(120, 350))
  await haltIfNeeded(shouldHalt)
}

/**
 * @param {import('playwright').Locator} loc
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 */
async function waitRichControlVisible(loc, shouldHalt, maxMs = 4500) {
  const deadline = Date.now() + Math.max(800, maxMs)
  while (Date.now() < deadline) {
    await haltIfNeeded(shouldHalt)
    if ((await loc.count().catch(() => 0)) === 0) {
      await sleepMsHaltable(shouldHalt, 200)
      continue
    }
    if (await loc.isVisible().catch(() => false)) return true
    await sleepMsHaltable(shouldHalt, 220)
  }
  return false
}

/**
 * @param {import('playwright').Locator} loc
 * @param {(action: string, details?: string) => void} log
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 * @param {string} label
 * @returns {Promise<boolean>}
 */
async function tryClickRichControl(loc, log, shouldHalt, label) {
  if ((await loc.count().catch(() => 0)) === 0) return false
  await scrollControlIntoView(loc, shouldHalt)
  const vis = await waitRichControlVisible(loc, shouldHalt, 5000)
  if (!vis) {
    log('RICH_CONTROL_WAIT', `timeout label=${label}`)
    return false
  }
  try {
    await loc.click({ timeout: 5500 })
    return true
  } catch {
    return false
  }
}

/**
 * @param {import('playwright').Page} page
 */
async function readLikePressedState(page) {
  const primary = await primaryFeedRoot(page)
  const feed = feedActiveRoot(page)
  const scopedSelectors = [
    '[data-e2e="browse-like-icon"]',
    '[data-e2e="like-icon"]',
    '[data-e2e="video-player-like-icon"]',
    'button[aria-label*="Like" i]',
    '[data-e2e="video-player"] [data-e2e="like-icon"]',
  ]
  /** @param {import('playwright').Locator} loc */
  const tryLoc = async (loc) => {
    if ((await loc.count().catch(() => 0)) === 0) return false
    const pressed = await loc.getAttribute('aria-pressed').catch(() => null)
    if (pressed === 'true') return true
    const cls = (await loc.getAttribute('class').catch(() => '')) ?? ''
    if (/fill|liked|active/i.test(cls)) return true
    return false
  }
  if (primary) {
    for (const sel of scopedSelectors) {
      if (await tryLoc(primary.locator(sel).first())) return true
    }
  }
  if ((await feed.count().catch(() => 0)) > 0) {
    for (const sel of scopedSelectors) {
      if (await tryLoc(feed.locator(sel).first())) return true
    }
  }
  for (const sel of scopedSelectors) {
    if (await tryLoc(page.locator(sel).first())) return true
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

  await focusFeedCardForRichActions(page, log, shouldHalt)

  const primary = await primaryFeedRoot(page)

  const likeSelectors = [
    '[data-e2e="browse-like-icon"]',
    '[data-e2e="like-icon"]',
    '[data-e2e="video-player-like-icon"]',
    '[data-e2e="video-player"] [data-e2e="like-icon"]',
    '[data-e2e="video-player"] button[aria-label*="Like" i]',
    '[data-e2e="video-engagement-toolbar"] [data-e2e="like-icon"]',
    'button[aria-label*="Like" i]',
    '[data-e2e="strong-like-icon"]',
  ]
  const feed = feedActiveRoot(page)
  /** @type {{ loc: import('playwright').Locator; label: string }[]} */
  const candidates = []
  if (primary) {
    for (const sel of likeSelectors) {
      candidates.push({ loc: primary.locator(sel).first(), label: `primary>${sel}` })
    }
  }
  if ((await feed.count().catch(() => 0)) > 0) {
    for (const sel of likeSelectors) {
      candidates.push({ loc: feed.locator(sel).first(), label: `feed>${sel}` })
    }
  }
  for (const sel of likeSelectors) {
    candidates.push({ loc: page.locator(sel).first(), label: sel })
  }
  candidates.push({
    loc: page.getByRole('button', { name: /\blike\b/i }).first(),
    label: 'role=button_name_like',
  })
  candidates.push({
    loc: page.getByLabel(/like/i).first(),
    label: 'aria_label_like',
  })

  const before = await readLikePressedState(page)
  for (const { loc, label } of candidates) {
    if ((await loc.count().catch(() => 0)) === 0) continue
    const clicked = await tryClickRichControl(loc, log, shouldHalt, label)
    if (!clicked) {
      log('LIKE_TRY_NEXT', `not_clickable label=${label}`)
      continue
    }
    log('LIKE_CLICK', label)
    await sleepMsHaltable(shouldHalt, randomInt(450, 900))
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
  '[data-e2e="video-player"] [data-e2e="comment-icon"]',
  '[data-e2e="video-player"] button[aria-label*="Comment" i]',
  '[data-e2e="video-engagement-toolbar"] [data-e2e="comment-icon"]',
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

  await focusFeedCardForRichActions(page, log, shouldHalt)

  const primary = await primaryFeedRoot(page)
  const feed = feedActiveRoot(page)
  /** @type {{ loc: import('playwright').Locator; label: string }[]} */
  const candidates = []
  if (primary) {
    for (const sel of COMMENT_ICON_SELECTORS) {
      candidates.push({ loc: primary.locator(sel).first(), label: `primary>${sel}` })
    }
  }
  if ((await feed.count().catch(() => 0)) > 0) {
    for (const sel of COMMENT_ICON_SELECTORS) {
      candidates.push({ loc: feed.locator(sel).first(), label: `feed>${sel}` })
    }
  }
  for (const sel of COMMENT_ICON_SELECTORS) {
    candidates.push({ loc: page.locator(sel).first(), label: sel })
  }
  candidates.push({
    loc: page.getByRole('button', { name: /\bcomment\b/i }).first(),
    label: 'role=button_name_comment',
  })
  candidates.push({
    loc: page.getByLabel(/comment/i).first(),
    label: 'aria_label_comment',
  })

  let opened = false
  let openLabel = ''
  for (const { loc, label } of candidates) {
    if ((await loc.count().catch(() => 0)) === 0) continue
    const ok = await tryClickRichControl(loc, log, shouldHalt, label)
    if (ok) {
      opened = true
      openLabel = label
      break
    }
  }
  if (!opened) {
    log('COMMENTS_SKIPPED', 'no control')
    return
  }
  log('COMMENTS_OPEN', openLabel)

  await sleepMsHaltable(shouldHalt, randomInt(500, 1100))
  await haltIfNeeded(shouldHalt)

  const insideMs = randomInt(4000, 12000)
  await viewVideoWeighted(page, log, shouldHalt, insideMs)

  if (randomChance(50)) {
    const panel = page
      .locator(
        '[data-e2e="comment-list"], [data-e2e="comment-list-scroll"], [class*="CommentList"], [class*="comment-list"], div[role="dialog"]',
      )
      .first()
    if ((await panel.count().catch(() => 0)) > 0 && (await panel.isVisible().catch(() => false))) {
      try {
        await panel.scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => {})
        await panel.locator('div').first().click({ timeout: 2500 }).catch(() => {})
        await tiktokWheelDownOnly(page, randomInt(200, 450), log)
        log('COMMENTS_SCROLL', 'once_light')
      } catch {
        /* ignore */
      }
    }
  }

  await page.keyboard.press('Escape').catch(() => {})
  await sleepMsHaltable(shouldHalt, randomInt(150, 400))
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

  await focusFeedCardForRichActions(page, log, shouldHalt)

  const primary = await primaryFeedRoot(page)
  const feed = feedActiveRoot(page)
  /** @type {{ loc: import('playwright').Locator; label: string }[]} */
  const authorCandidates = []
  if (primary) {
    authorCandidates.push(
      { loc: primary.locator('[data-e2e="video-author-uniqueid"] a').first(), label: 'primary>video-author-uniqueid>a' },
      { loc: primary.locator('[data-e2e="video-author-uniqueid"]').first(), label: 'primary>video-author-uniqueid' },
      { loc: primary.locator('a[href^="/@"]').first(), label: 'primary>a_href_/@' },
      { loc: primary.locator('a[href*="@"]').first(), label: 'primary>a_href_@' },
    )
  }
  authorCandidates.push(
    { loc: feed.locator('[data-e2e="video-author-uniqueid"] a').first(), label: 'feed>video-author-uniqueid>a' },
    { loc: feed.locator('[data-e2e="video-author-uniqueid"]').first(), label: 'feed>video-author-uniqueid' },
    { loc: feed.locator('a[href^="/@"]').first(), label: 'feed>a_href_/@' },
    { loc: feed.locator('a[href*="@"]').first(), label: 'feed>a_href_@' },
    { loc: page.locator('[data-e2e="video-author-uniqueid"] a').first(), label: 'page>video-author-uniqueid>a' },
    { loc: page.locator('[data-e2e="video-author-uniqueid"]').first(), label: 'page>video-author-uniqueid' },
    { loc: page.locator('[data-e2e="feed-active-video"] a[href^="/@"]').first(), label: 'page>feed-active>a_/@' },
    { loc: page.locator('[data-e2e="feed-active-video"] a[href*="@"]').first(), label: 'page>feed-active-video>a_@' },
  )
  let authorLabel = ''
  let clicked = false
  for (const { loc, label } of authorCandidates) {
    if ((await loc.count().catch(() => 0)) === 0) continue
    const ok = await tryClickRichControl(loc, log, shouldHalt, label)
    if (ok) {
      authorLabel = label
      clicked = true
      break
    }
  }
  if (!clicked) {
    log('PROFILE_SKIPPED', 'no author')
    return
  }
  log('PROFILE_CLICK', authorLabel)

  let openUrl = ''
  try {
    openUrl = page.url()
  } catch {
    openUrl = ''
  }
  log('PROFILE_OPEN', openUrl.slice(0, 200))
  await sleepMsHaltable(shouldHalt, randomInt(1200, 2200))
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
 * @typedef {{
 *   path: string
 *   viewedMs: number
 *   richAction: string
 *   videoFound: boolean
 *   videoFailReason: string | null
 *   scrollRan: boolean
 *   scrollOk: boolean | null
 *   keyBefore: string
 *   keyAfter: string
 *   scrollChanged: boolean
 * }} IterationDiagSummary
 */

/**
 * One iteration of SAFE_TIKTOK_FEED_MODE.
 * @param {import('playwright').Page} page
 * @param {(action: string, details?: string) => void} log
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 * @param {{ debugScreenshots?: boolean; screenshotDir?: string; browserEngine?: string }} [_options]
 */
export async function runSafeTikTokFeedIteration(page, log, shouldHalt, _options = {}) {
  const browserLabel =
    _options && _options.browserEngine != null && String(_options.browserEngine).trim() !== ''
      ? String(_options.browserEngine).trim()
      : 'chromium'

  /** @type {IterationDiagSummary} */
  const sum = {
    path: 'normal',
    viewedMs: 0,
    richAction: 'none',
    videoFound: false,
    videoFailReason: null,
    scrollRan: false,
    scrollOk: null,
    keyBefore: '',
    keyAfter: '',
    scrollChanged: false,
  }

  let finalized = false
  function logIterationHumanSummary() {
    if (finalized) return
    finalized = true
    const viewedS = Math.round(sum.viewedMs / 100) / 10
    let scrollStr = 'skipped'
    if (sum.scrollRan) {
      scrollStr = sum.scrollOk === true ? 'ok' : sum.scrollOk === false ? 'failed' : 'unknown'
    }
    let reason = 'reason='
    if (!sum.videoFound) {
      reason = `reason=no_active_video${sum.videoFailReason ? ` (${sum.videoFailReason})` : ''}`
    } else if (sum.scrollRan && !sum.scrollChanged) {
      reason = 'reason=key_unchanged'
    }
    log(
      'ITERATION_HUMAN_SUMMARY',
      `viewed=${viewedS}s action=${sum.richAction} video_found=${sum.videoFound} scroll=${scrollStr} ${reason} path=${sum.path}`,
    )
  }

  try {
    log('SAFE_TIKTOK_FEED_MODE', 'iteration start')

    try {
      if (page.isClosed()) {
        repeatStuckCount = 0
        lastRepeatTrackingKey = ''
        log('PAGE_CLOSED_DURING_STOP', 'iteration_start')
        sum.path = 'page_closed'
        return
      }
    } catch {
      repeatStuckCount = 0
      lastRepeatTrackingKey = ''
      log('PAGE_CLOSED_DURING_STOP', 'iteration_start')
      sum.path = 'page_closed'
      return
    }

    if (await detectChallengeBlocking(page)) {
      repeatStuckCount = 0
      lastRepeatTrackingKey = ''
      log('TIKTOK_CHALLENGE_DETECTED', 'challenge/verify at iteration start — halting run')
      sum.path = 'challenge'
      throw new ExecutorHaltError('challenge')
    }
    await haltIfNeeded(shouldHalt)

    if (pageInLiveSurfaceUrl(page)) {
      repeatStuckCount = 0
      lastRepeatTrackingKey = ''
      sum.path = 'live_surface'
      await escapeLiveSurface(page, log, shouldHalt)
      return
    }

    if (await detectLiveFeedCard(page)) {
      repeatStuckCount = 0
      lastRepeatTrackingKey = ''
      Object.assign(sum, await handleLiveFeedCard(page, log, shouldHalt, browserLabel))
      videosSinceLongBreak += 1
      return
    }

    const trackAtIterStart = await getRepeatTrackingKey(page)
    if (
      repeatStuckCount >= 2 &&
      trackAtIterStart === lastRepeatTrackingKey &&
      String(lastRepeatTrackingKey).trim() !== ''
    ) {
      log('VIDEO_REPEAT_DETECTED', `repeatStuckCount=${repeatStuckCount} key=${trackAtIterStart.slice(0, 160)}`)
      sum.viewedMs = 0
      sum.richAction = 'repeat_recover'

      if (repeatStuckCount >= 3) {
        await tryClickForYouNav(page)
        await sleepMsHaltable(shouldHalt, randomInt(1000, 2000))
        await haltIfNeeded(shouldHalt)
        log('FEED_RECOVERY_AFTER_REPEAT', 'repeat>=3 nav_foryou wait_1-2s then_controlled_scroll')
      }

      await logVideoDetectionStart(page, log, browserLabel)
      const detR = await logVideoDetectionResult(page, log)
      sum.videoFound = detR.hasUsableVideo
      sum.videoFailReason = detR.failureReason
      let curUrlR = ''
      try {
        curUrlR = page.url()
      } catch {
        curUrlR = ''
      }
      log(
        'SCROLL_CONTEXT',
        `has_video=${detR.hasUsableVideo} current_url=${curUrlR.slice(0, 400)} is_live=${await detectLiveFeedCard(page)}`,
      )

      sum.keyBefore = await getStableVideoKey(page)
      sum.scrollRan = true
      sum.scrollOk = false
      sum.scrollOk = await runSafeTikTokControlledOneVideoScroll(page, log, shouldHalt, () => getStableVideoKey(page))
      await haltIfNeeded(shouldHalt)
      await ensureAdvancedAfterScroll(page, log, shouldHalt, sum.keyBefore)
      sum.keyAfter = await getStableVideoKey(page)
      sum.scrollChanged = tiktokStableKeyAdvanced(sum.keyBefore, sum.keyAfter)
      log(
        'SCROLL_DEBUG',
        `key_before=${sum.keyBefore.slice(0, 120)} key_after=${sum.keyAfter.slice(0, 120)} changed=${sum.scrollChanged} repeat_recover=1`,
      )

      const trackAfterRecover = await getRepeatTrackingKey(page)
      if (sum.scrollRan && !sum.scrollChanged) {
        if (trackAfterRecover === lastRepeatTrackingKey && lastRepeatTrackingKey !== '') {
          repeatStuckCount += 1
        } else {
          repeatStuckCount = 1
          lastRepeatTrackingKey = trackAfterRecover
        }
      } else {
        repeatStuckCount = 0
        lastRepeatTrackingKey = ''
      }

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
      return
    }

    const roll = pickRichActionForVideo()
    const richAction = roll.pick
    sum.richAction = richAction
    log(
      'RICH_ACTION_ROLL',
      `pick=${richAction} r=${roll.roll.toFixed(2)} like<=${roll.cutLike} com<=${roll.cutCom} prof<=${roll.cutProf} (like%=${roll.likePct} com%=${roll.comPct} prof%=${roll.profPct} none≈${(100 - roll.cutProf).toFixed(0)}%)`,
    )
    const baseWatch = sampleWatchMsWeighted()
    const minNeed = minWatchMsForAction(richAction)
    const watchMs = richAction === 'none' ? baseWatch : Math.max(baseWatch, minNeed)
    sum.viewedMs = watchMs

    await viewVideoWeighted(page, log, shouldHalt, watchMs)
    await haltIfNeeded(shouldHalt)

    if (pageInLiveSurfaceUrl(page)) {
      repeatStuckCount = 0
      lastRepeatTrackingKey = ''
      log('BLOCKED_FEED_SCROLL_IN_LIVE', 'surface appeared during VIEW_VIDEO')
      sum.path = 'live_surface_mid'
      await escapeLiveSurface(page, log, shouldHalt)
      return
    }
    if (await detectLiveFeedCard(page)) {
      repeatStuckCount = 0
      lastRepeatTrackingKey = ''
      Object.assign(sum, await handleLiveFeedCard(page, log, shouldHalt, browserLabel))
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
      repeatStuckCount = 0
      lastRepeatTrackingKey = ''
      if (await detectLiveFeedCard(page)) {
        Object.assign(sum, await handleLiveFeedCard(page, log, shouldHalt, browserLabel))
      } else {
        sum.path = 'live_surface_post_rich'
        await escapeLiveSurface(page, log, shouldHalt)
      }
      videosSinceLongBreak += 1
      return
    }

    if (!randomChance(30)) {
      await sleepMsHaltable(shouldHalt, randomInt(800, 2500))
    } else {
      log('SCROLL_PRE_PAUSE', 'skipped_burst')
    }
    await haltIfNeeded(shouldHalt)

    await logVideoDetectionStart(page, log, browserLabel)
    const det = await logVideoDetectionResult(page, log)
    sum.videoFound = det.hasUsableVideo
    sum.videoFailReason = det.failureReason

    let curUrl = ''
    try {
      curUrl = page.url()
    } catch {
      curUrl = ''
    }
    const liveNow = await detectLiveFeedCard(page)
    log(
      'SCROLL_CONTEXT',
      `has_video=${det.hasUsableVideo} current_url=${curUrl.slice(0, 400)} is_live=${liveNow}`,
    )

    sum.keyBefore = await getStableVideoKey(page)
    sum.scrollRan = true
    sum.scrollOk = false
    sum.scrollOk = await runSafeTikTokControlledOneVideoScroll(page, log, shouldHalt, () => getStableVideoKey(page))
    await haltIfNeeded(shouldHalt)
    await ensureAdvancedAfterScroll(page, log, shouldHalt, sum.keyBefore)

    sum.keyAfter = await getStableVideoKey(page)
    sum.scrollChanged = tiktokStableKeyAdvanced(sum.keyBefore, sum.keyAfter)
    log(
      'SCROLL_DEBUG',
      `key_before=${sum.keyBefore.slice(0, 120)} key_after=${sum.keyAfter.slice(0, 120)} changed=${sum.scrollChanged}`,
    )

    const trackAfterNormal = await getRepeatTrackingKey(page)
    if (sum.scrollRan && !sum.scrollChanged) {
      if (trackAfterNormal === lastRepeatTrackingKey && lastRepeatTrackingKey !== '') {
        repeatStuckCount += 1
      } else {
        repeatStuckCount = 1
        lastRepeatTrackingKey = trackAfterNormal
      }
    } else {
      repeatStuckCount = 0
      lastRepeatTrackingKey = ''
    }

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
  } finally {
    logIterationHumanSummary()
  }
}
