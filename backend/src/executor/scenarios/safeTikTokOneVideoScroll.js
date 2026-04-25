/**
 * SAFE_TIKTOK_FEED_MODE only: exactly one ArrowDown per invocation, then poll stable key.
 * No second ArrowDown (that was still advancing two videos when the feed reacted slowly).
 * Optional single PageDown fallback after the poll window if the key never changed.
 */

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
 * Wait until stable key differs from `before`, or `maxMs` elapses.
 */
async function waitForStableKeyChange(page, log, shouldHalt, getStableKey, before, maxMs, stepMs) {
  const deadline = Date.now() + Math.max(200, Math.floor(maxMs))
  const step = Math.max(120, Math.floor(stepMs))
  while (Date.now() < deadline) {
    if (safePageClosed(page)) {
      log('PAGE_CLOSED_DURING_STOP', 'during_key_poll')
      return false
    }
    await tiktokScrollSleepMsHaltable(shouldHalt, step)
    await tiktokScrollHaltIfNeeded(shouldHalt)
    const after = await safeReadStableKey(page, getStableKey)
    if (tiktokStableKeyAdvanced(before, after)) return true
  }
  return false
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
 * At most one keyboard "step" from ArrowDown: focus → single ArrowDown → poll → optional PageDown.
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

  const keyPollMs = 4000
  const keyPollStepMs = 220

  if (safePageClosed(page)) {
    log('PAGE_CLOSED_DURING_STOP', 'before_ArrowDown')
    return false
  }
  await tiktokScrollHaltIfNeeded(shouldHalt)
  log('SCROLL_KEYBOARD_ARROW', 'attempt=1_single')
  try {
    await page.keyboard.press('ArrowDown')
  } catch {
    if (safePageClosed(page)) {
      log('PAGE_CLOSED_DURING_STOP', 'during_ArrowDown')
      return false
    }
  }

  const advancedArrow = await waitForStableKeyChange(
    page,
    log,
    shouldHalt,
    getStableKey,
    before,
    keyPollMs,
    keyPollStepMs,
  )
  if (advancedArrow) {
    log('SCROLL_KEY_CHANGED', 'after_ArrowDown')
    log('SCROLL_SUCCESS', 'ArrowDown')
    return true
  }

  if (safePageClosed(page)) {
    log('PAGE_CLOSED_DURING_STOP', 'before_PageDown_fallback')
    return false
  }
  await tiktokScrollHaltIfNeeded(shouldHalt)
  log('SCROLL_PAGEDOWN_FALLBACK', 'after_ArrowDown_poll_unchanged')
  try {
    await page.keyboard.press('PageDown')
  } catch {
    if (safePageClosed(page)) {
      log('PAGE_CLOSED_DURING_STOP', 'during_PageDown')
      return false
    }
  }

  const advancedPd = await waitForStableKeyChange(
    page,
    log,
    shouldHalt,
    getStableKey,
    before,
    keyPollMs,
    keyPollStepMs,
  )
  if (advancedPd) {
    log('SCROLL_KEY_CHANGED', 'after_PageDown_fallback')
    log('SCROLL_SUCCESS', 'PageDown_fallback')
    return true
  }

  log('SCROLL_STILL_STUCK', 'stable_key_unchanged_after_ArrowDown_poll_and_PageDown')
  return false
}
