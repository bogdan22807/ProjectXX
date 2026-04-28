/**
 * SAFE_TIKTOK_FEED_MODE scroll-only baseline.
 *
 * One iteration watches the current FYP video, then performs one simple wheel
 * movement over the viewport center. No other feed actions are performed here.
 */

import { randomInt, sleep } from '../asyncUtils.js'
import { ExecutorHaltError } from '../executorHalt.js'

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

/**
 * @param {import('playwright').Page} page
 */
function pageInLiveSurfaceUrl(page) {
  try {
    return new URL(page.url()).pathname.toLowerCase().includes('/live')
  } catch {
    return String(page.url()).toLowerCase().includes('/live')
  }
}

/**
 * @param {import('playwright').Page} page
 */
async function detectChallengeBlocking(page) {
  let url = ''
  try {
    url = page.url().toLowerCase()
  } catch {
    url = ''
  }
  if (
    url.includes('captcha') ||
    url.includes('/verify') ||
    url.includes('challenge') ||
    url.includes('sec_sdk') ||
    url.includes('/authentication')
  ) {
    return true
  }

  const title = ((await page.title().catch(() => '')) ?? '').toLowerCase()
  if (title.includes('captcha') || title.includes('verify') || title.includes('security check')) return true

  try {
    const frameCount = await page.locator('iframe[src*="captcha" i], iframe[src*="verify" i]').count()
    return frameCount > 0
  } catch {
    return false
  }
}

/**
 * LIVE card in FYP, not a /live URL.
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
  if ((await root.count().catch(() => 0)) === 0) return false

  try {
    if (
      (await root.locator('[data-e2e="live-tag"], [data-e2e="video-live-tag"]').first().isVisible().catch(() => false))
    ) {
      return true
    }
    if (await root.getByText(/^LIVE$/i).first().isVisible().catch(() => false)) return true
    if (await root.getByText(/\bLIVE\s+NOW\b/i).first().isVisible().catch(() => false)) return true
  } catch {
    /* ignore */
  }
  return false
}

/**
 * @param {import('playwright').Page} page
 * @param {(action: string, details?: string) => void} log
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 */
async function viewCurrentVideo(page, log, shouldHalt) {
  const durationMs = randomInt(5000, 12000)
  log('VIEW_VIDEO', `durationMs=${durationMs}`)
  await sleepMsHaltable(shouldHalt, durationMs)
  if (await detectChallengeBlocking(page)) {
    log('TIKTOK_CHALLENGE_DETECTED', 'challenge/verify during VIEW_VIDEO')
    throw new ExecutorHaltError('challenge')
  }
}

/**
 * @param {import('playwright').Page} page
 * @param {(action: string, details?: string) => void} log
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 */
async function simpleScroll(page, log, shouldHalt) {
  const result = await page
    .evaluate(() => {
      const articles = Array.from(document.querySelectorAll('article')).filter((article) =>
        article.querySelector('video'),
      )
      if (articles.length === 0) return { currentIndex: -1, nextIndex: -1, scrolled: false }

      const viewportCenterY = window.innerHeight / 2
      let currentIndex = 0
      let bestDistance = Number.POSITIVE_INFINITY
      for (let i = 0; i < articles.length; i += 1) {
        const rect = articles[i].getBoundingClientRect()
        const articleCenterY = rect.top + rect.height / 2
        const distance = Math.abs(articleCenterY - viewportCenterY)
        if (distance < bestDistance) {
          bestDistance = distance
          currentIndex = i
        }
      }

      const nextIndex = currentIndex + 1
      const nextArticle = articles[nextIndex]
      if (!nextArticle) return { currentIndex, nextIndex: -1, scrolled: false }

      nextArticle.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return { currentIndex, nextIndex, scrolled: true }
    })
    .catch(() => ({ currentIndex: -1, nextIndex: -1, scrolled: false }))

  log('SIMPLE_SCROLL_CURRENT_ARTICLE', `index=${result.currentIndex}`)
  log('SIMPLE_SCROLL_NEXT_ARTICLE', `index=${result.nextIndex}`)

  if (result.scrolled) {
    log('SIMPLE_SCROLL_SCROLL_INTO_VIEW', '')
    await sleepMsHaltable(shouldHalt, randomInt(2000, 3000))
  } else {
    const viewport = page.viewportSize()
    const width = viewport && Number.isFinite(viewport.width) ? viewport.width : 1280
    const height = viewport && Number.isFinite(viewport.height) ? viewport.height : 720
    await page.mouse.move(Math.floor(width / 2), Math.floor(height / 2))
    log('SIMPLE_SCROLL_FALLBACK_WHEEL', 'dy=1800')
    await page.mouse.wheel(0, 1800)
    await sleepMsHaltable(shouldHalt, 2000)
  }

  log('SIMPLE_SCROLL_DONE', '')
}

/**
 * Clean SAFE TikTok iteration. Signature is kept stable for playwrightTestRun.
 *
 * @param {import('playwright').Page} page
 * @param {(action: string, details?: string) => void} log
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 * @param {{ debugScreenshots?: boolean; screenshotDir?: string; browserEngine?: string; iterationIndex?: number }} [_options]
 * @returns {Promise<void>}
 */
export async function runSafeTikTokFeedIteration(page, log, shouldHalt, _options = {}) {
  const iteration =
    _options && _options.iterationIndex != null && Number.isFinite(Number(_options.iterationIndex))
      ? Math.max(0, Math.floor(Number(_options.iterationIndex)))
      : '?'

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
    log('TIKTOK_CHALLENGE_DETECTED', 'challenge/verify at iteration start')
    throw new ExecutorHaltError('challenge')
  }

  await haltIfNeeded(shouldHalt)

  if (pageInLiveSurfaceUrl(page)) {
    log('SAFE_TIKTOK_FEED_MODE_SCROLL_ONLY', 'status=live_surface_no_scroll')
    return
  }

  if (await detectLiveFeedCard(page)) {
    log('SAFE_TIKTOK_FEED_MODE_SCROLL_ONLY', 'status=live_card_no_scroll')
    return
  }

  let currentUrl = ''
  try {
    currentUrl = page.url()
  } catch {
    currentUrl = '(unreadable)'
  }
  log('SAFE_TIKTOK_FEED_MODE_SCROLL_ONLY', `url=${currentUrl.slice(0, 400)}`)

  await viewCurrentVideo(page, log, shouldHalt)
  await haltIfNeeded(shouldHalt)

  if (pageInLiveSurfaceUrl(page)) {
    log('SAFE_TIKTOK_FEED_MODE_SCROLL_ONLY', 'status=live_surface_after_view_no_scroll')
    return
  }
  if (await detectLiveFeedCard(page)) {
    log('SAFE_TIKTOK_FEED_MODE_SCROLL_ONLY', 'status=live_card_after_view_no_scroll')
    return
  }

  await simpleScroll(page, log, shouldHalt)
  log('ITERATION_FINAL', `iteration=${iteration} scroll=done mode=scroll_only`)
}
