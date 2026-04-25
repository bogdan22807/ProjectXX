/**
 * SAFE_TIKTOK_FEED_MODE only: at most one ArrowDown per attempt (2 attempts), then one PageDown fallback.
 * PageDown is last resort only (can skip multiple videos; we never chain it).
 */

import { randomInt, sleep } from '../asyncUtils.js'
import {
  tiktokScrollHaltIfNeeded,
  tiktokScrollSleepMsHaltable,
  tiktokStableKeyAdvanced,
} from './tiktokScrollHelpers.js'

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
 * Focus `[data-e2e="feed-active-video"]` — click inner `video` or container corner.
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
 * Single one-video attempt: focus → ArrowDown (×2 max, one keypress each) → optional one PageDown fallback.
 *
 * @returns {Promise<boolean>} true if stable key changed vs initial `before`
 */
export async function runSafeTikTokControlledOneVideoScroll(page, log, shouldHalt, getStableKey) {
  if (safePageClosed(page)) {
    log('PAGE_CLOSED_DURING_STOP', 'scroll_start')
    return false
  }

  const before = await safeReadStableKey(page, getStableKey)
  const focused = await focusActiveFeedVideo(page, log, shouldHalt)
  if (!focused) {
    log('SCROLL_VIDEO_FOCUS_FAILED', 'keyboard_without_focus_click')
  }

  for (let attempt = 1; attempt <= 2; attempt += 1) {
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
    if (attempt === 1) {
      log('SCROLL_RETRY', 'second_ArrowDown_only')
    }
  }

  if (safePageClosed(page)) {
    log('PAGE_CLOSED_DURING_STOP', 'before_PageDown_fallback')
    return false
  }
  await tiktokScrollHaltIfNeeded(shouldHalt)
  log('SCROLL_PAGEDOWN_FALLBACK', 'after_2_ArrowDown_unchanged')
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
    log('SCROLL_KEY_CHANGED', 'after_PageDown_fallback')
    log('SCROLL_SUCCESS', 'PageDown_fallback')
    return true
  }

  log('SCROLL_STILL_STUCK', 'stable_key_unchanged_after_ArrowDown_x2_and_PageDown')
  return false
}
