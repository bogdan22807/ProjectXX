/**
 * TikTok FYP: single primary root for an iteration — e2e feed card, largest visible article+video, or first visible video.
 */

import { randomInt, sleep } from '../asyncUtils.js'
import { ExecutorHaltError } from '../executorHalt.js'
import { tiktokScrollHaltIfNeeded } from './tiktokScrollHelpers.js'

/**
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 * @param {number} ms
 */
async function sleepMsHaltable(shouldHalt, ms) {
  let left = Math.max(0, Math.floor(Number(ms) || 0))
  while (left > 0) {
    if (shouldHalt) {
      const v = await shouldHalt()
      if (v === 'stop') throw new ExecutorHaltError('stop')
      if (v === 'max_duration') throw new ExecutorHaltError('max_duration')
    }
    const step = Math.min(400, left)
    await sleep(step)
    left -= step
  }
}

/**
 * @param {{ x: number; y: number; width: number; height: number }} box
 * @param {number} vw
 * @param {number} vh
 */
function rectViewportOverlapArea(box, vw, vh) {
  const ix = Math.max(0, Math.min(box.x + box.width, vw) - Math.max(0, box.x))
  const iy = Math.max(0, Math.min(box.y + box.height, vh) - Math.max(0, box.y))
  return Math.max(0, ix) * Math.max(0, iy)
}

/**
 * @param {import('playwright').Page} page
 * @returns {Promise<null | { kind: 'e2e'; root: import('playwright').Locator } | { kind: 'article'; root: import('playwright').Locator } | { kind: 'video'; root: import('playwright').Locator }>}
 */
export async function resolvePrimaryFeedRoot(page) {
  try {
    if (page.isClosed()) return null
  } catch {
    return null
  }

  const vp = page.viewportSize()
  const vw = vp && Number.isFinite(vp.width) ? vp.width : 1280
  const vh = vp && Number.isFinite(vp.height) ? vp.height : 720
  const cx = vw * 0.5
  const cy = vh * 0.42

  const feed = page.locator('[data-e2e="feed-active-video"]').first()
  if ((await feed.count().catch(() => 0)) > 0 && (await feed.isVisible().catch(() => false))) {
    return { kind: 'e2e', root: feed }
  }

  const articles = page.locator('article')
  const n = await articles.count().catch(() => 0)
  let bestIdx = -1
  let bestScore = -1
  for (let i = 0; i < Math.min(n, 36); i += 1) {
    const art = articles.nth(i)
    if ((await art.locator('video').count().catch(() => 0)) === 0) continue
    if (!(await art.isVisible().catch(() => false))) continue
    const liveHref =
      (await art.locator('a[href*="/live"]').first().getAttribute('href').catch(() => null)) ?? ''
    if (String(liveHref).toLowerCase().includes('/live')) continue
    if (
      (await art.locator('[data-e2e="live-tag"], [data-e2e="video-live-tag"]').first().isVisible().catch(() => false))
    ) {
      continue
    }
    const vid = art.locator('video').first()
    if (!(await vid.isVisible().catch(() => false))) continue
    const box = await art.boundingBox().catch(() => null)
    if (!box || box.width < 120 || box.height < 160) continue
    const visArea = rectViewportOverlapArea(box, vw, vh)
    if (visArea < 4000) continue
    const mx = box.x + box.width / 2
    const my = box.y + box.height / 2
    const dist = Math.hypot(mx - cx, my - cy)
    /** Largest visible-on-viewport card near center. */
    const score = visArea / (80 + dist)
    if (score > bestScore) {
      bestScore = score
      bestIdx = i
    }
  }
  if (bestIdx >= 0) {
    return { kind: 'article', root: articles.nth(bestIdx) }
  }

  const videos = page.locator('video')
  const nv = await videos.count().catch(() => 0)
  for (let j = 0; j < Math.min(nv, 40); j += 1) {
    const v = videos.nth(j)
    if (!(await v.isVisible().catch(() => false))) continue
    const box = await v.boundingBox().catch(() => null)
    if (!box || box.width < 80 || box.height < 80) continue
    if (rectViewportOverlapArea(box, vw, vh) < 500) continue
    return { kind: 'video', root: v }
  }

  return null
}

/**
 * TikTok often keeps `video.src` as a stable blob: URL while the reel changes — add poster + /video/ link so scroll detection sees a new key.
 * @param {import('playwright').Locator} videoLoc
 * @param {import('playwright').Locator} scopeForLinks
 */
async function readVideoKeyParts(videoLoc, scopeForLinks) {
  const src = (await videoLoc.first().getAttribute('src').catch(() => null)) ?? ''
  const poster = (await videoLoc.first().getAttribute('poster').catch(() => null)) ?? ''
  const vLink =
    (await scopeForLinks.locator('a[href*="/video/"]').first().getAttribute('href').catch(() => null)) ?? ''
  return {
    src: String(src).trim().slice(0, 200),
    poster: String(poster).trim().slice(0, 200),
    vLink: String(vLink).trim().slice(0, 220),
  }
}

/**
 * Stable key string from resolved feed root (href|src or art|…).
 * @param {import('playwright').Page} page
 * @param {Awaited<ReturnType<typeof resolvePrimaryFeedRoot>>} info
 */
export async function readStableKeyFromFeedRoot(page, info) {
  if (!info) {
    const v0 = page.locator('video').first()
    if ((await v0.count().catch(() => 0)) === 0) return ''
    const parts = await readVideoKeyParts(v0, page)
    return `vid|${parts.src}|${parts.poster}|${parts.vLink}`.slice(0, 400)
  }
  if (info.kind === 'e2e') {
    const r = info.root
    const href =
      (await r.locator('[data-e2e="video-author-uniqueid"] a').first().getAttribute('href').catch(() => null)) ?? ''
    const inner = r.locator('video').first()
    const parts = await readVideoKeyParts(inner, r)
    const slice = `${String(href).trim()}|${parts.src.slice(0, 160)}|${parts.poster.slice(0, 140)}|${parts.vLink}`.trim()
    if (slice && slice !== '|') return slice.slice(0, 400)
    return ''
  }
  if (info.kind === 'video') {
    const v = info.root
    const ancArt = v.locator('xpath=ancestor::article[1]')
    const scope = (await ancArt.count().catch(() => 0)) > 0 ? ancArt : page
    const parts = await readVideoKeyParts(v, scope)
    return `vid|${parts.src}|${parts.poster}|${parts.vLink}`.slice(0, 400)
  }
  const art = info.root
  const href =
    (await art.locator('a[href*="/@"]').first().getAttribute('href').catch(() => null)) ??
    (await art.locator('[data-e2e="video-author-uniqueid"] a').first().getAttribute('href').catch(() => null)) ??
    ''
  const inner = art.locator('video').first()
  const parts = await readVideoKeyParts(inner, art)
  const slice =
    `${String(href).trim()}|${parts.src.slice(0, 160)}|${parts.poster.slice(0, 160)}|${parts.vLink}`.trim()
  if (slice && slice !== '|') return `art|${slice}`.slice(0, 400)
  return ''
}

/**
 * Focus primary feed video (same target as stable key). `okAction` defaults to SCROLL logs; use RICH_FOCUS for likes etc.
 * @param {{ rich?: boolean; resolvedInfo?: Awaited<ReturnType<typeof resolvePrimaryFeedRoot>> | null }} [options]
 *   `resolvedInfo`: use this root for the whole iteration (no re-resolve).
 *   `rich: true`: no extra page-level `video:first` fallback beyond `resolvedInfo` / resolve.
 * @returns {Promise<boolean>}
 */
export async function focusPrimaryFeedVideo(page, log, shouldHalt, okAction = 'SCROLL_VIDEO_FOCUSED', options = {}) {
  const richOnly = options.rich === true
  const fixed = options.resolvedInfo !== undefined ? options.resolvedInfo : undefined
  if (page.isClosed()) {
    log('PAGE_CLOSED_DURING_STOP', 'before_video_focus')
    return false
  }

  const info = fixed !== undefined ? fixed : await resolvePrimaryFeedRoot(page)

  if (info?.kind === 'e2e') {
    try {
      await info.root.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {})
      await tiktokScrollHaltIfNeeded(shouldHalt)
      const inner = info.root.locator('video').first()
      if ((await inner.count()) > 0 && (await inner.isVisible().catch(() => false))) {
        await inner.click({ timeout: 8000 }).catch(() => {})
        log(okAction, 'inner_video')
        return true
      }
      await info.root.click({ position: { x: 50, y: 50 }, timeout: 8000 }).catch(() => {})
      log(okAction, 'container_xy50')
      return true
    } catch {
      log('SCROLL_VIDEO_FOCUS_FAILED', 'primary_click_error')
    }
  }

  if (info?.kind === 'article') {
    try {
      const vid = info.root.locator('video').first()
      if ((await vid.count().catch(() => 0)) > 0) {
        await vid.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {})
        await sleepMsHaltable(shouldHalt, randomInt(200, 450))
        await tiktokScrollHaltIfNeeded(shouldHalt)
        if (await vid.isVisible().catch(() => false)) {
          await vid.click({ position: { x: 48, y: 52 }, timeout: 8000 }).catch(() => {})
          log(okAction, 'largest_article_video')
          return true
        }
      }
      if (richOnly) {
        await info.root.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {})
        await sleepMsHaltable(shouldHalt, randomInt(200, 400))
        await tiktokScrollHaltIfNeeded(shouldHalt)
        await info.root.click({ position: { x: 52, y: 120 }, timeout: 8000 }).catch(() => {})
        log(okAction, 'article_shell_click')
        return true
      }
    } catch {
      /* fall through */
    }
  }

  if (info?.kind === 'video') {
    try {
      await info.root.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {})
      await sleepMsHaltable(shouldHalt, randomInt(200, 400))
      await tiktokScrollHaltIfNeeded(shouldHalt)
      await info.root.click({ position: { x: 48, y: 48 }, timeout: 8000 }).catch(() => {})
      log(okAction, 'primary_video_root')
      return true
    } catch {
      /* fall through */
    }
  }

  if (!richOnly && fixed === undefined) {
    const v = page.locator('video').first()
    if ((await v.count().catch(() => 0)) > 0) {
      try {
        await v.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {})
        await sleepMsHaltable(shouldHalt, randomInt(200, 400))
        await tiktokScrollHaltIfNeeded(shouldHalt)
        await v.click({ position: { x: 48, y: 48 }, timeout: 8000 }).catch(() => {})
        log(okAction, 'fallback_first_video')
        return true
      } catch {
        /* ignore */
      }
    }
  }
  log('SCROLL_VIDEO_FOCUS_FAILED', 'no_feed_active_video')
  return false
}
