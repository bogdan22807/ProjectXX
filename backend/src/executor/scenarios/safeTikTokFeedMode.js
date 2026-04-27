/**
 * SAFE_TIKTOK_FEED_MODE clean baseline.
 *
 * This module intentionally performs no feed actions. It keeps the public
 * iteration export used by the runner while the TikTok SAFE scenario is rebuilt.
 */

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
 * Clean SAFE TikTok iteration. Signature is kept stable for playwrightTestRun.
 *
 * @param {import('playwright').Page} page
 * @param {(action: string, details?: string) => void} log
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 * @param {{ debugScreenshots?: boolean; screenshotDir?: string; browserEngine?: string; iterationIndex?: number }} [_options]
 * @returns {Promise<void>}
 */
export async function runSafeTikTokFeedIteration(page, log, shouldHalt, _options = {}) {
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
    log('SAFE_TIKTOK_FEED_MODE_CLEAN_READY', 'status=live_surface_no_action')
    return
  }

  if (await detectLiveFeedCard(page)) {
    log('SAFE_TIKTOK_FEED_MODE_CLEAN_READY', 'status=live_card_no_action')
    return
  }

  log('SAFE_TIKTOK_FEED_MODE_CLEAN_READY', 'status=ready_no_action')
}
