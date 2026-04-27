/**
 * SAFE_TIKTOK_FEED_MODE only: exactly one ArrowDown per invocation, then poll stable key.
 * Focus uses shared `tiktokFeedLayout` (largest article with video when e2e missing) so scroll matches stable key.
 */

import {
  tiktokScrollHaltIfNeeded,
  tiktokScrollSleepMsHaltable,
  tiktokStableKeyAdvanced,
} from './tiktokScrollHelpers.js'
import { focusPrimaryFeedVideo } from './tiktokFeedLayout.js'

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
 * At most one keyboard "step" from ArrowDown: focus → single ArrowDown → poll → optional PageDown.
 *
 * @param {{ resolvedInfo?: Awaited<ReturnType<import('./tiktokFeedLayout.js').resolvePrimaryFeedRoot>> | null }} [focusOptions] — passed to `focusPrimaryFeedVideo` when set (iteration-locked primary root).
 * @returns {Promise<boolean>} true if stable key changed vs initial `before`
 */
export async function runSafeTikTokControlledOneVideoScroll(page, log, shouldHalt, getStableKey, focusOptions) {
  if (safePageClosed(page)) {
    log('PAGE_CLOSED_DURING_STOP', 'scroll_start')
    return false
  }

  log('SCROLL_ATTEMPT', 'focus_then_ArrowDown_poll_5s_optional_PageDown')

  const before = await safeReadStableKey(page, getStableKey)
  const focused = await focusPrimaryFeedVideo(page, log, shouldHalt, 'SCROLL_VIDEO_FOCUSED', focusOptions ?? {})
  if (!focused) {
    log('SCROLL_VIDEO_FOCUS_FAILED', 'keyboard_without_focus_click')
  }

  const keyPollMs = 5000
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
    log('SCROLL_SUCCESS', 'method=ArrowDown')
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
    log('SCROLL_SUCCESS', 'method=PageDown')
    return true
  }

  log('SCROLL_STUCK', 'stable_key_unchanged_after_ArrowDown_5s_and_PageDown')
  return false
}
