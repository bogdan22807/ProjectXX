/**
 * SAFE_TIKTOK_FEED_MODE — TikTok FYP scroll-only baseline.
 * One iteration watches one video and performs one controlled down-scroll attempt.
 * Rich actions/recovery/long breaks are intentionally disabled while stabilizing scroll.
 * TEST_SCROLL_DIAGNOSTICS=1 runs a temporary five-method scroll diagnostic instead.
 * LIVE: skip only via controlled scroll; LIVE URL: navigate to For You via nav clicks only.
 *
 * Optional: DEBUG_VISUAL_ACTIONS=1 and DEBUG_VISUAL_DIR (optional) for PNG screenshots around scroll.
 */

import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomInt, sleep } from '../asyncUtils.js'
import {
  readStableKeyFromFeedRoot,
  resolvePrimaryFeedRoot,
} from './tiktokFeedLayout.js'
import { ExecutorHaltError } from '../executorHalt.js'
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
async function logVideoDetectionResult(page, log, lockedRoot = undefined) {
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

  if (lockedRoot != null) {
    return { hasUsableVideo: true, failureReason: null }
  }

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
 * @param {Awaited<ReturnType<typeof resolvePrimaryFeedRoot>> | undefined} [lockedRoot] — iteration-locked root from `PRIMARY_ROOT_RESOLVED`; omit to resolve live DOM.
 */
async function getStableVideoKey(page, lockedRoot = undefined) {
  try {
    if (page.isClosed()) return ''
    const info = lockedRoot !== undefined ? lockedRoot : await resolvePrimaryFeedRoot(page)
    return await readStableKeyFromFeedRoot(page, info)
  } catch {
    return ''
  }
}

function primaryRootSource(root) {
  if (!root) return 'none'
  return root.kind === 'e2e' || root.kind === 'article' || root.kind === 'video' ? root.kind : 'none'
}

function testScrollDiagnosticsEnabled() {
  return String(process.env.TEST_SCROLL_DIAGNOSTICS ?? '').trim() === '1'
}

function scrollDiagDir() {
  return String(process.env.DEBUG_VISUAL_DIR ?? '').trim() || join(tmpdir(), 'tiktok-scroll-diagnostics')
}

function scrollDiagSafeLabel(label) {
  return String(label).replace(/[^a-z0-9_-]+/gi, '_').slice(0, 80)
}

async function scrollDiagScreenshot(page, log, label) {
  if (await safePageClosed(page)) return ''
  const dir = scrollDiagDir()
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    /* ignore */
  }
  const fp = join(dir, `${scrollDiagSafeLabel(label)}-${Date.now()}.png`)
  try {
    await page.screenshot({ path: fp, fullPage: false })
    return fp
  } catch (e) {
    log('SCROLL_DIAG_SCREENSHOT_FAILED', `${label} err=${String(e).slice(0, 160)}`)
    return ''
  }
}

async function scrollDiagActiveElement(page) {
  try {
    return await page.evaluate(() => {
      const el = document.activeElement
      if (!el) return 'none'
      const tag = String(el.tagName || '').toLowerCase() || 'unknown'
      const cls =
        typeof el.className === 'string'
          ? el.className
          : el.className && typeof el.className.baseVal === 'string'
            ? el.className.baseVal
            : ''
      return `${tag}${cls ? ` class=${String(cls).slice(0, 180)}` : ''}`
    })
  } catch {
    return 'unreadable'
  }
}

async function scrollDiagScrollY(page) {
  try {
    return await page.evaluate(() => Number(window.scrollY) || 0)
  } catch {
    return -1
  }
}

async function scrollDiagSnapshot(page, label, log) {
  const root = await resolvePrimaryFeedRoot(page)
  const key = await getStableVideoKey(page, root ?? undefined)
  const scrollY = await scrollDiagScrollY(page)
  const active = await scrollDiagActiveElement(page)
  let url = ''
  try {
    url = page.url()
  } catch {
    url = '(unreadable)'
  }
  const screenshot = await scrollDiagScreenshot(page, log, label)
  return {
    root,
    key,
    scrollY,
    active,
    url,
    screenshot,
  }
}

function scrollDiagSnapshotDetails(snap) {
  return `source=${primaryRootSource(snap.root)} key=${String(snap.key).slice(0, 220)} scrollY=${snap.scrollY} active=${snap.active} url=${String(snap.url).slice(0, 260)} screenshot=${snap.screenshot || 'none'}`
}

async function scrollDiagRootBox(root) {
  if (!root) return null
  try {
    if (root.kind === 'e2e' || root.kind === 'article') {
      const video = root.root.locator('video').first()
      if ((await video.count().catch(() => 0)) > 0 && (await video.isVisible().catch(() => false))) {
        const vb = await video.boundingBox().catch(() => null)
        if (vb && vb.width > 20 && vb.height > 20) return vb
      }
    }
    const rb = await root.root.boundingBox().catch(() => null)
    if (rb && rb.width > 20 && rb.height > 20) return rb
  } catch {
    /* ignore */
  }
  return null
}

async function scrollDiagMoveToRootCenter(page, root, log, method) {
  const box = await scrollDiagRootBox(root)
  if (!box) {
    log('SCROLL_DIAG_METHOD', `method=${method} root_center_missing source=${primaryRootSource(root)}`)
    return false
  }
  const vp = page.viewportSize()
  const vw = vp && Number.isFinite(vp.width) ? vp.width : 1280
  const vh = vp && Number.isFinite(vp.height) ? vp.height : 720
  const x = Math.max(1, Math.min(vw - 1, Math.floor(box.x + box.width / 2)))
  const y = Math.max(1, Math.min(vh - 1, Math.floor(box.y + box.height / 2)))
  await page.mouse.move(x, y)
  log('SCROLL_DIAG_METHOD', `method=${method} move=root_center x=${x} y=${y} source=${primaryRootSource(root)}`)
  return true
}

async function scrollDiagClickRoot(page, root, log, method) {
  const box = await scrollDiagRootBox(root)
  if (!box) {
    log('SCROLL_DIAG_METHOD', `method=${method} click_root_missing source=${primaryRootSource(root)}`)
    return false
  }
  const vp = page.viewportSize()
  const vw = vp && Number.isFinite(vp.width) ? vp.width : 1280
  const vh = vp && Number.isFinite(vp.height) ? vp.height : 720
  const x = Math.max(1, Math.min(vw - 1, Math.floor(box.x + box.width / 2)))
  const y = Math.max(1, Math.min(vh - 1, Math.floor(box.y + box.height / 2)))
  await page.mouse.click(x, y)
  log('SCROLL_DIAG_METHOD', `method=${method} click=root_center x=${x} y=${y} source=${primaryRootSource(root)}`)
  return true
}

async function scrollDiagDispatchWheel(page, root, log, method) {
  if (root) {
    const dispatched = await root.root
      .evaluate((el) => {
        const target = el.querySelector('video') || el
        const ev = new WheelEvent('wheel', {
          deltaY: 1200,
          bubbles: true,
          cancelable: true,
          view: window,
        })
        return target.dispatchEvent(ev)
      })
      .catch(() => null)
    if (dispatched != null) {
      log('SCROLL_DIAG_METHOD', `method=${method} dispatch=primary target=video_or_root default_not_prevented=${dispatched}`)
      return
    }
  }
  await page.evaluate(() => {
    const ev = new WheelEvent('wheel', {
      deltaY: 1200,
      bubbles: true,
      cancelable: true,
      view: window,
    })
    document.dispatchEvent(ev)
  })
  log('SCROLL_DIAG_METHOD', `method=${method} dispatch=document`)
}

async function runScrollDiagnosticsMethod(page, log, shouldHalt, method) {
  await haltIfNeeded(shouldHalt)
  log('SCROLL_DIAG_METHOD', `method=${method.name} start`)
  const before = await scrollDiagSnapshot(page, `${method.name}_before`, log)
  log('SCROLL_DIAG_BEFORE', `method=${method.name} ${scrollDiagSnapshotDetails(before)}`)

  await method.run(before.root)
  await sleepMsHaltable(shouldHalt, 1200)
  await haltIfNeeded(shouldHalt)

  const after = await scrollDiagSnapshot(page, `${method.name}_after`, log)
  log('SCROLL_DIAG_AFTER', `method=${method.name} ${scrollDiagSnapshotDetails(after)}`)
  const changed = Boolean(String(after.key).trim()) && String(after.key).trim() !== String(before.key).trim()
  const scrollYChanged = after.scrollY !== before.scrollY
  log(
    'SCROLL_DIAG_RESULT',
    `method=${method.name} changed=${changed} scrollY_changed=${scrollYChanged} key_before=${String(before.key).slice(0, 160)} key_after=${String(after.key).slice(0, 160)} scrollY_before=${before.scrollY} scrollY_after=${after.scrollY} url=${String(after.url).slice(0, 260)}`,
  )
}

async function runTestScrollDiagnostics(page, log, shouldHalt) {
  log('TEST_SCROLL_DIAGNOSTICS', 'start')
  try {
    await page.bringToFront()
  } catch {
    /* ignore */
  }
  await sleepMsHaltable(shouldHalt, 300)
  await haltIfNeeded(shouldHalt)

  const vp = page.viewportSize()
  const vw = vp && Number.isFinite(vp.width) ? vp.width : 1280
  const vh = vp && Number.isFinite(vp.height) ? vp.height : 720
  const methods = [
    {
      name: 'viewport_center_wheel',
      run: async () => {
        await page.mouse.move(Math.floor(vw / 2), Math.floor(vh / 2))
        log('SCROLL_DIAG_METHOD', `method=viewport_center_wheel move=viewport_center x=${Math.floor(vw / 2)} y=${Math.floor(vh / 2)}`)
        await page.mouse.wheel(0, 1200)
      },
    },
    {
      name: 'primary_root_center_wheel',
      run: async (root) => {
        await scrollDiagMoveToRootCenter(page, root, log, 'primary_root_center_wheel')
        await page.mouse.wheel(0, 1200)
      },
    },
    {
      name: 'keyboard_arrow_down',
      run: async (root) => {
        await scrollDiagClickRoot(page, root, log, 'keyboard_arrow_down')
        await page.keyboard.press('ArrowDown')
      },
    },
    {
      name: 'keyboard_page_down',
      run: async (root) => {
        await scrollDiagClickRoot(page, root, log, 'keyboard_page_down')
        await page.keyboard.press('PageDown')
      },
    },
    {
      name: 'js_wheel_event',
      run: async (root) => {
        await scrollDiagDispatchWheel(page, root, log, 'js_wheel_event')
      },
    },
  ]

  for (const method of methods) {
    await runScrollDiagnosticsMethod(page, log, shouldHalt, method)
  }
  log('TEST_SCROLL_DIAGNOSTICS', 'done')
}

/**
 * @param {(action: string, details?: string) => void} log
 * @param {Awaited<ReturnType<typeof resolvePrimaryFeedRoot>> | null} root
 */
function logPrimaryRootResolved(log, root) {
  const found = root != null
  const source =
    root == null ? 'none' : root.kind === 'e2e' ? 'e2e' : root.kind === 'article' ? 'article' : 'video'
  log('PRIMARY_ROOT_RESOLVED', `source=${source} found=${found}`)
}

/**
 * Any `article` containing a `video` (for summary vs no_active_video when DOM has feed).
 * @param {import('playwright').Page} page
 */
async function hasArticleWithVideo(page) {
  const articles = page.locator('article')
  const n = await articles.count().catch(() => 0)
  for (let i = 0; i < Math.min(n, 40); i += 1) {
    if ((await articles.nth(i).locator('video').count().catch(() => 0)) > 0) return true
  }
  return false
}

/**
 * When `resolvePrimaryFeedRoot` is null but DOM still has video/article+video, use a loose root so scroll + key still run.
 * @param {import('playwright').Page} page
 * @param {Awaited<ReturnType<typeof resolvePrimaryFeedRoot>> | null} initial
 */
async function ensureIterationRootForScroll(page, initial) {
  if (initial) return initial
  const { video_tag_count, article_count } = await collectVideoDetectionCounts(page)
  if (video_tag_count > 0) {
    return { kind: 'video', root: page.locator('video').first() }
  }
  if (article_count > 0) {
    const articles = page.locator('article')
    for (let i = 0; i < Math.min(article_count, 40); i += 1) {
      const art = articles.nth(i)
      if ((await art.locator('video').count().catch(() => 0)) > 0) {
        return { kind: 'article', root: art }
      }
    }
  }
  return null
}

/**
 * Wait until TikTok feed DOM yields a primary root (fixes empty first iterations on slow / landing URL).
 * @param {(action: string, details?: string) => void} log
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 */
async function waitForIterationRootReady(page, log, shouldHalt, maxMs = 26000) {
  const deadline = Date.now() + Math.max(3000, maxMs)
  let attempt = 0
  while (Date.now() < deadline) {
    await haltIfNeeded(shouldHalt)
    if (await safePageClosed(page)) return null
    let r = await resolvePrimaryFeedRoot(page)
    if (r) {
      log('FEED_ROOT_READY', `resolved_primary attempts=${attempt + 1}`)
      return r
    }
    r = await ensureIterationRootForScroll(page, null)
    if (r) {
      log('FEED_ROOT_READY', `fallback_dom attempts=${attempt + 1}`)
      return r
    }
    attempt += 1
    if (attempt === 1 || attempt % 5 === 0) {
      log('FEED_ROOT_WAIT', `attempt=${attempt}`)
    }
    if (attempt % 7 === 0 && attempt > 0) {
      await tryClickForYouNav(page)
      await sleepMsHaltable(shouldHalt, randomInt(900, 1600))
      await haltIfNeeded(shouldHalt)
    }
    await sleepMsHaltable(shouldHalt, 450)
  }
  log('FEED_ROOT_WAIT_TIMEOUT', `after_ms=${maxMs}`)
  return null
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
  const changed = await runSafeTikTokControlledOneVideoScroll(page, log, shouldHalt)
  log('LIVE_SKIP_SCROLL', 'controlled_one_video')

  await sleepMsHaltable(shouldHalt, randomInt(500, 1200))
  await haltIfNeeded(shouldHalt)

  const kFinal = await getStableVideoKey(page)
  log('LIVE_SKIPPED', changed ? 'LIVE card — feed advanced' : 'LIVE card — scroll stuck')
  log(
    'SCROLL_DEBUG',
    `key_before=${k0.slice(0, 120)} key_after=${kFinal.slice(0, 120)} changed=${changed}`,
  )
  const rr = await resolvePrimaryFeedRoot(page)
  const rk = rr && (rr.kind === 'e2e' || rr.kind === 'article' || rr.kind === 'video') ? rr.kind : 'none'
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
    rootKind: rk,
    actionOutcome: 'skipped',
  }
}

/** 25% / 55% / 20% — 2–5s, 7–15s, 16–30s */
function sampleWatchMsWeighted() {
  const r = Math.random() * 100
  if (r < 25) return randomInt(2000, 5000)
  if (r < 80) return randomInt(7000, 15000)
  return randomInt(16000, 30000)
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
 *   feedHasVideoTag: boolean
 *   feedHasArticleWithVideo: boolean
 *   rootKind: 'none' | 'e2e' | 'article' | 'video'
 *   actionOutcome: 'success' | 'skipped' | 'failed' | null
 * }} IterationDiagSummary
 */

/**
 * One iteration of SAFE_TIKTOK_FEED_MODE.
 * @param {import('playwright').Page} page
 * @param {(action: string, details?: string) => void} log
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 * @param {{ debugScreenshots?: boolean; screenshotDir?: string; browserEngine?: string; iterationIndex?: number }} [_options]
 */
export async function runSafeTikTokFeedIteration(page, log, shouldHalt, _options = {}) {
  const browserLabel =
    _options && _options.browserEngine != null && String(_options.browserEngine).trim() !== ''
      ? String(_options.browserEngine).trim()
      : 'chromium'
  const iterationIndex =
    _options && _options.iterationIndex != null && Number.isFinite(Number(_options.iterationIndex))
      ? Math.max(0, Math.floor(Number(_options.iterationIndex)))
      : null

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
    feedHasVideoTag: false,
    feedHasArticleWithVideo: false,
    rootKind: 'none',
    actionOutcome: null,
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
    const domSuggestsFeed = sum.feedHasVideoTag || sum.feedHasArticleWithVideo
    if (!sum.videoFound && domSuggestsFeed && sum.path === 'normal') {
      reason = 'reason=key_unchanged_or_scroll_outcome'
    } else if (!sum.videoFound) {
      reason = `reason=no_active_video${sum.videoFailReason ? ` (${sum.videoFailReason})` : ''}`
    } else if (sum.scrollRan && !sum.scrollChanged) {
      reason = 'reason=key_unchanged'
    }
    log(
      'ITERATION_HUMAN_SUMMARY',
      `viewed=${viewedS}s action=${sum.richAction} video_found=${sum.videoFound} scroll=${scrollStr} ${reason} path=${sum.path}`,
    )
  }

  function logIterationFinal() {
    const iterStr = iterationIndex != null ? String(iterationIndex) : '?'
    const viewS = Math.round(sum.viewedMs / 100) / 10
    const root =
      sum.rootKind === 'e2e' || sum.rootKind === 'article' || sum.rootKind === 'video'
        ? sum.rootKind
        : 'none'
    let actionResult = 'skipped'
    if (sum.richAction === 'none') {
      actionResult = 'skipped'
    } else if (sum.richAction === 'like' || sum.richAction === 'comments') {
      actionResult =
        sum.actionOutcome === 'success' || sum.actionOutcome === 'failed' || sum.actionOutcome === 'skipped'
          ? sum.actionOutcome
          : 'skipped'
    } else {
      actionResult = 'skipped'
    }
    let scrollFinal = 'skipped'
    if (sum.scrollRan) {
      scrollFinal = sum.scrollOk === true && sum.scrollChanged ? 'success' : 'stuck'
    }
    let reason = `path=${sum.path}`
    const domSuggestsFeed = sum.feedHasVideoTag || sum.feedHasArticleWithVideo
    if (!sum.videoFound && domSuggestsFeed && sum.path === 'normal') {
      reason = `key_unchanged_or_scroll_outcome path=${sum.path}`
    } else if (!sum.videoFound) {
      reason = `no_active_video${sum.videoFailReason ? ` (${sum.videoFailReason})` : ''} path=${sum.path}`
    } else if (sum.scrollRan && !sum.scrollChanged) {
      reason = `key_unchanged path=${sum.path}`
    }
    log(
      'ITERATION_FINAL',
      `iteration=${iterStr} video_found=${sum.videoFound} root=${root} view=${viewS}s action=${sum.richAction} action_result=${actionResult} scroll=${scrollFinal} reason=${reason}`,
    )
  }

  try {
    log('SAFE_TIKTOK_FEED_MODE', 'iteration start')

    try {
      if (page.isClosed()) {
        log('PAGE_CLOSED_DURING_STOP', 'iteration_start')
        sum.path = 'page_closed'
        return
      }
    } catch {
      log('PAGE_CLOSED_DURING_STOP', 'iteration_start')
      sum.path = 'page_closed'
      return
    }

    if (await detectChallengeBlocking(page)) {
      log('TIKTOK_CHALLENGE_DETECTED', 'challenge/verify at iteration start — halting run')
      sum.path = 'challenge'
      throw new ExecutorHaltError('challenge')
    }
    await haltIfNeeded(shouldHalt)

    if (pageInLiveSurfaceUrl(page)) {
      sum.path = 'live_surface'
      await escapeLiveSurface(page, log, shouldHalt)
      return
    }

    if (testScrollDiagnosticsEnabled()) {
      sum.path = 'scroll_diagnostics'
      sum.actionOutcome = 'skipped'
      const diagRoot = await waitForIterationRootReady(page, log, shouldHalt)
      logPrimaryRootResolved(log, diagRoot)
      sum.rootKind = diagRoot?.kind ?? 'none'
      sum.videoFound = diagRoot != null
      if (!diagRoot) {
        sum.videoFailReason = 'primary_root_none'
      }
      const counts0 = await collectVideoDetectionCounts(page)
      sum.feedHasVideoTag = counts0.video_tag_count > 0
      sum.feedHasArticleWithVideo = await hasArticleWithVideo(page)
      await runTestScrollDiagnostics(page, log, shouldHalt)
      sum.scrollRan = true
      sum.scrollOk = null
      return
    }

    if (await detectLiveFeedCard(page)) {
      Object.assign(sum, await handleLiveFeedCard(page, log, shouldHalt, browserLabel))
      return
    }

    let iterationRoot = await waitForIterationRootReady(page, log, shouldHalt)
    logPrimaryRootResolved(log, iterationRoot)
    if (!iterationRoot) {
      iterationRoot = await ensureIterationRootForScroll(page, iterationRoot)
      if (iterationRoot) {
        log('PRIMARY_ROOT_RESOLVED', 'source=fallback_dom found=true')
      } else {
        log('PRIMARY_ROOT_RESOLVED', 'source=fallback_dom found=false')
      }
    }
    if (!iterationRoot) {
      sum.videoFound = false
      sum.videoFailReason = 'primary_root_none'
      sum.path = 'no_primary_root'
      sum.rootKind = 'none'
      sum.actionOutcome = 'skipped'
      return
    }
    sum.rootKind = iterationRoot.kind
    sum.videoFound = true
    sum.videoFailReason = null

    const counts0 = await collectVideoDetectionCounts(page)
    sum.feedHasVideoTag = counts0.video_tag_count > 0
    sum.feedHasArticleWithVideo = await hasArticleWithVideo(page)

    log('ITERATION_STATE', `mode=scroll_only root=${sum.rootKind}`)

    const watchMs = sampleWatchMsWeighted()
    sum.viewedMs = watchMs

    await viewVideoWeighted(page, log, shouldHalt, watchMs)
    await haltIfNeeded(shouldHalt)

    if (pageInLiveSurfaceUrl(page)) {
      log('BLOCKED_FEED_SCROLL_IN_LIVE', 'surface appeared during VIEW_VIDEO')
      sum.path = 'live_surface_mid'
      await escapeLiveSurface(page, log, shouldHalt)
      return
    }
    if (await detectLiveFeedCard(page)) {
      Object.assign(sum, await handleLiveFeedCard(page, log, shouldHalt, browserLabel))
      return
    }

    sum.actionOutcome = 'skipped'

    try {
      if (page.isClosed()) {
        sum.path = 'page_closed'
        return
      }
    } catch {
      sum.path = 'page_closed'
      return
    }

    sum.scrollRan = true
    sum.scrollOk = await runSafeTikTokControlledOneVideoScroll(page, log, shouldHalt)
    sum.scrollChanged = Boolean(sum.scrollOk)
    sum.keyBefore = ''
    sum.keyAfter = ''
    log('SCROLL_RESULT', sum.scrollChanged ? 'success' : 'stuck')
    log('ITERATION_STATE', `mode=scroll_only_done scroll=${sum.scrollChanged ? 'advanced' : 'stuck'}`)
  } finally {
    logIterationHumanSummary()
    logIterationFinal()
  }
}
