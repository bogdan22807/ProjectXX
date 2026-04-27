/**
 * TikTok FYP: resolve the primary feed card (e2e or largest article with video) for stable keys + focus.
 * Avoids first random <article> (nav/sidebar) breaking scroll and rich actions when feed-active-video is absent.
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
 * TikTok sometimes paints shell + auth but lazy-mounts feed — click main column to trigger hydration.
 * @param {import('playwright').Page} page
 * @param {(action: string, details?: string) => void} log
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 */
export async function wakeFypWithViewportClick(page, log, shouldHalt) {
  if (page.isClosed()) return
  const vp = page.viewportSize()
  const w = vp && Number.isFinite(vp.width) ? vp.width : 1366
  const h = vp && Number.isFinite(vp.height) ? vp.height : 768
  const x = Math.floor(w * 0.52)
  const y = Math.floor(h * 0.45)
  try {
    await page.mouse.move(x, y)
    await page.mouse.click(x, y)
    log('FEED_WAKE_CLICK', `viewport x=${x} y=${y}`)
  } catch {
    log('FEED_WAKE_CLICK', 'failed')
  }
  await sleepMsHaltable(shouldHalt, randomInt(700, 1400))
  await tiktokScrollHaltIfNeeded(shouldHalt)
}

/**
 * @param {import('playwright').Page} page
 * @returns {Promise<null | { kind: 'e2e'; root: import('playwright').Locator } | { kind: 'article'; root: import('playwright').Locator }>}
 */
export async function resolvePrimaryFeedRoot(page) {
  try {
    if (page.isClosed()) return null
  } catch {
    return null
  }

  const feed = page.locator('[data-e2e="feed-active-video"]').first()
  if ((await feed.count().catch(() => 0)) > 0) {
    return { kind: 'e2e', root: feed }
  }

  const vp = page.viewportSize()
  const cx = vp && Number.isFinite(vp.width) ? vp.width * 0.5 : 640
  const cy = vp && Number.isFinite(vp.height) ? vp.height * 0.42 : 360

  const articles = page.locator('article')
  const n = await articles.count().catch(() => 0)
  let bestIdx = -1
  let bestScore = -1
  for (let i = 0; i < Math.min(n, 36); i += 1) {
    const art = articles.nth(i)
    if ((await art.locator('video').count().catch(() => 0)) === 0) continue
    const liveHref =
      (await art.locator('a[href*="/live"]').first().getAttribute('href').catch(() => null)) ?? ''
    if (String(liveHref).toLowerCase().includes('/live')) continue
    if (
      (await art.locator('[data-e2e="live-tag"], [data-e2e="video-live-tag"]').first().isVisible().catch(() => false))
    ) {
      continue
    }
    const box = await art.boundingBox().catch(() => null)
    if (!box || box.width < 120 || box.height < 160) continue
    const mx = box.x + box.width / 2
    const my = box.y + box.height / 2
    const dist = Math.hypot(mx - cx, my - cy)
    const area = box.width * box.height
    /** Prefer large feed card near viewport center (main column), not small sidebar previews. */
    const score = area / (80 + dist)
    if (score > bestScore) {
      bestScore = score
      bestIdx = i
    }
  }
  if (bestIdx >= 0) {
    return { kind: 'article', root: articles.nth(bestIdx) }
  }

  /** No article with `<video>` yet — pick largest non-live article near center (feed column shell). */
  let fbIdx = -1
  let fbScore = -1
  for (let i = 0; i < Math.min(n, 36); i += 1) {
    const art = articles.nth(i)
    const liveHref =
      (await art.locator('a[href*="/live"]').first().getAttribute('href').catch(() => null)) ?? ''
    if (String(liveHref).toLowerCase().includes('/live')) continue
    const box = await art.boundingBox().catch(() => null)
    if (!box || box.width < 200 || box.height < 220) continue
    const mx = box.x + box.width / 2
    const my = box.y + box.height / 2
    const dist = Math.hypot(mx - cx, my - cy)
    const area = box.width * box.height
    const score = area / (100 + dist)
    if (score > fbScore) {
      fbScore = score
      fbIdx = i
    }
  }
  if (fbIdx >= 0) {
    return { kind: 'article', root: articles.nth(fbIdx) }
  }

  return null
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
    const src0 = (await v0.getAttribute('src').catch(() => null)) ?? ''
    const poster0 = (await v0.getAttribute('poster').catch(() => null)) ?? ''
    return `vid|${String(src0).trim().slice(0, 180)}|${String(poster0).trim().slice(0, 120)}`.slice(0, 400)
  }
  if (info.kind === 'e2e') {
    const r = info.root
    const href =
      (await r.locator('[data-e2e="video-author-uniqueid"] a').first().getAttribute('href').catch(() => null)) ?? ''
    const src = (await r.locator('video').first().getAttribute('src').catch(() => null)) ?? ''
    return `${String(href).trim()}|${String(src).trim().slice(0, 160)}`.slice(0, 400)
  }
  const art = info.root
  const href =
    (await art.locator('a[href*="/@"]').first().getAttribute('href').catch(() => null)) ??
    (await art.locator('[data-e2e="video-author-uniqueid"] a').first().getAttribute('href').catch(() => null)) ??
    ''
  const src = (await art.locator('video').first().getAttribute('src').catch(() => null)) ?? ''
  const slice = `${String(href).trim()}|${String(src).trim().slice(0, 160)}`.trim()
  if (slice && slice !== '|') return `art|${slice}`.slice(0, 400)
  return ''
}

/**
 * Focus primary feed video (same target as stable key). `okAction` defaults to SCROLL logs; use RICH_FOCUS for likes etc.
 * @returns {Promise<boolean>}
 */
export async function focusPrimaryFeedVideo(page, log, shouldHalt, okAction = 'SCROLL_VIDEO_FOCUSED') {
  if (page.isClosed()) {
    log('PAGE_CLOSED_DURING_STOP', 'before_video_focus')
    return false
  }

  const tryFocusOnce = async () => {
    const info = await resolvePrimaryFeedRoot(page)
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
        await info.root.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {})
        await sleepMsHaltable(shouldHalt, randomInt(200, 400))
        await tiktokScrollHaltIfNeeded(shouldHalt)
        await info.root.click({ position: { x: 52, y: 120 }, timeout: 8000 }).catch(() => {})
        log(okAction, 'article_shell_click')
        return true
      } catch {
        /* fall through */
      }
    }

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
    return false
  }

  if (await tryFocusOnce()) return true
  await wakeFypWithViewportClick(page, log, shouldHalt)
  if (await tryFocusOnce()) return true
  log('SCROLL_VIDEO_FOCUS_FAILED', 'no_feed_active_video')
  return false
}
