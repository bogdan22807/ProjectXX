/**
 * SAFE_TIKTOK_FEED_MODE only: one-video-at-a-time FYP scroll (no strong wheel, no center click).
 * Down-only: ArrowDown / PageDown only; no ArrowUp / PageUp / goBack.
 */

import { randomInt, sleep } from '../asyncUtils.js'
import {
  tiktokScrollHaltIfNeeded,
  tiktokScrollSleepMsHaltable,
  tiktokStableKeyAdvanced,
} from './tiktokStrongFeedScroll.js'

/**
 * @param {import('playwright').Page} page
 */
function safePageClosed(page) {
  try {
    return page.isClosed()
  } catch {
    return true
  }
}

/**
 * @param {import('playwright').Page} page
 * @param {() => Promise<string>} getStableKey
 */
async function safeReadStableKey(page, getStableKey) {
  if (safePageClosed(page)) return ''
  try {
    return await getStableKey()
  } catch {
    return ''
  }
}

/**
 * Focus `[data-e2e="feed-active-video"]` — prefer click on inner `video`.
 * @returns {Promise<boolean>}
 */
async function focusActiveFeedVideo(page, log, shouldHalt) {
  if (safePageClosed(page)) {
    log('PAGE_CLOSED_DURING_STOP', 'before_video_focus')
    return false
  }
  const container = page.locator('[data-e2e="feed-active-video"]').first()
  try {
    if ((await container.count()) === 0) {
      log('SCROLL_VIDEO_FOCUS_FAILED', 'no_feed_active_video')
      return false
    }
    await container.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {})
    await tiktokScrollHaltIfNeeded(shouldHalt)

    const inner = container.locator('video').first()
    if ((await inner.count()) > 0 && (await inner.isVisible().catch(() => false))) {
      await inner.click({ timeout: 8000 }).catch(() => {})
      log('SCROLL_VIDEO_FOCUSED', 'inner_video')
      return true
    }

    await container.click({ position: { x: 50, y: 50 }, timeout: 8000 }).catch(() => {})
    log('SCROLL_VIDEO_FOCUSED', 'container_xy50')
    return true
  } catch {
    log('SCROLL_VIDEO_FOCUS_FAILED', 'click_error')
    return false
  }
}

/**
 * At most one feed slot change: focus → up to 3× (one ArrowDown + wait + key check) → optional one PageDown.
 * @param {import('playwright').Page} page
 * @param {(action: string, details?: string) => void} log
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 * @param {() => Promise<string>} getStableKey
 * @returns {Promise<boolean>}
 */
export async function runSafeTikTokControlledOneVideoScroll(page, log, shouldHalt, getStableKey) {
  if (safePageClosed(page)) {
    log('PAGE_CLOSED_DURING_STOP', 'scroll_start')
    return false
  }

  const before = await safeReadStableKey(page, getStableKey)
  const focused = await focusActiveFeedVideo(page, log, shouldHalt)
  if (!focused) {
    log('SCROLL_VIDEO_FOCUS_FAILED', 'keyboard_fallback')
  }

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (safePageClosed(page)) {
      log('PAGE_CLOSED_DURING_STOP', `after_attempt_${attempt}`)
      return false
    }
    await tiktokScrollHaltIfNeeded(shouldHalt)
    log('SCROLL_KEYBOARD_ARROW', `attempt=${attempt}`)
    try {
      await page.keyboard.press('ArrowDown')
    } catch {
      if (safePageClosed(page)) {
        log('PAGE_CLOSED_DURING_STOP', 'during_ArrowDown')
        return false
      }
    }
    await tiktokScrollSleepMsHaltable(shouldHalt, randomInt(800, 1200))
    await tiktokScrollHaltIfNeeded(shouldHalt)

    const after = await safeReadStableKey(page, getStableKey)
    if (tiktokStableKeyAdvanced(before, after)) {
      log('SCROLL_KEY_CHANGED', `after_ArrowDown attempt=${attempt}`)
      log('SCROLL_SUCCESS', 'ArrowDown')
      return true
    }
    if (attempt < 3) {
      log('SCROLL_RETRY', `ArrowDown attempt=${attempt}`)
    }
  }

  if (safePageClosed(page)) {
    log('PAGE_CLOSED_DURING_STOP', 'before_PageDown_fallback')
    return false
  }

  log('SCROLL_PAGEDOWN_FALLBACK', 'after_3_ArrowDown')
  try {
    await page.keyboard.press('PageDown')
  } catch {
    if (safePageClosed(page)) {
      log('PAGE_CLOSED_DURING_STOP', 'during_PageDown')
      return false
    }
  }
  await tiktokScrollSleepMsHaltable(shouldHalt, randomInt(800, 1200))
  await tiktokScrollHaltIfNeeded(shouldHalt)

  const afterPd = await safeReadStableKey(page, getStableKey)
  if (tiktokStableKeyAdvanced(before, afterPd)) {
    log('SCROLL_KEY_CHANGED', 'after_PageDown')
    log('SCROLL_SUCCESS', 'PageDown')
    return true
  }

  log('SCROLL_STILL_STUCK', 'stable_key_unchanged')
  return false
}
