/**
 * Legacy TikTok FYP scroll for **human feed** path only (`tiktokFeedHumanScenario.js`).
 * SAFE_TIKTOK_FEED_MODE must NOT import this file.
 */

import { randomInt, sleep } from '../asyncUtils.js'
import {
  tiktokScrollHaltIfNeeded,
  tiktokScrollSleepMsHaltable,
  tiktokStableKeyAdvanced,
  tiktokWheelDownOnly,
} from './tiktokScrollHelpers.js'

/**
 * Focus active FYP card: fixed click inside feed-active-video (not viewport center).
 * @returns {Promise<boolean>}
 */
export async function tiktokFocusFeedActiveVideo(page, log, shouldHalt) {
  const video = page.locator('[data-e2e="feed-active-video"]').first()
  try {
    if ((await video.count()) === 0) {
      log('SCROLL_VIDEO_FOCUS', 'missing_feed_active_video')
      return false
    }
    await video.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {})
    await tiktokScrollHaltIfNeeded(shouldHalt)
    await video.click({ position: { x: 50, y: 50 }, timeout: 8000 }).catch(() => {})
    log('SCROLL_VIDEO_FOCUS', 'feed-active-video x=50 y=50')
    return true
  } catch {
    log('SCROLL_VIDEO_FOCUS', 'click_failed')
    return false
  }
}

/**
 * One keyboard advance: ArrowDown then PageDown.
 */
export async function tiktokKeyboardScrollBurst(page, log, shouldHalt) {
  await tiktokScrollHaltIfNeeded(shouldHalt)
  await page.keyboard.press('ArrowDown').catch(() => {})
  await tiktokScrollHaltIfNeeded(shouldHalt)
  await page.keyboard.press('PageDown').catch(() => {})
  log('SCROLL_KEYBOARD', 'ArrowDown+PageDown')
}

/**
 * Moderate wheel fallback (not 3000+).
 */
async function tiktokWheelFallback(page, log, shouldHalt) {
  await tiktokScrollHaltIfNeeded(shouldHalt)
  const dy = randomInt(520, 900)
  await tiktokWheelDownOnly(page, dy, log)
  log('SCROLL_KEYBOARD', `wheel_fallback dy=${dy}`)
}

/**
 * Focus → up to 3 keyboard bursts (wait + stable key each) → one wheel fallback if still stuck.
 * @returns {Promise<boolean>}
 */
export async function tiktokStrongScrollWithRecovery(page, log, shouldHalt, getStableKey, beforeKey) {
  const before = String(beforeKey ?? '').trim() ? beforeKey : await getStableKey()

  const okFocus = await tiktokFocusFeedActiveVideo(page, log, shouldHalt)
  if (!okFocus) {
    log('SCROLL_STILL_STUCK', 'no_feed_active_video')
    return tiktokStableKeyAdvanced(before, await getStableKey())
  }

  for (let k = 1; k <= 3; k += 1) {
    await tiktokKeyboardScrollBurst(page, log, shouldHalt)
    await tiktokScrollSleepMsHaltable(shouldHalt, randomInt(800, 1500))
    await tiktokScrollHaltIfNeeded(shouldHalt)
    const afterKb = await getStableKey()
    if (tiktokStableKeyAdvanced(before, afterKb)) {
      log('SCROLL_SUCCESS', `keyboard_pass=${k}`)
      return true
    }
  }

  await tiktokWheelFallback(page, log, shouldHalt)
  await tiktokScrollSleepMsHaltable(shouldHalt, randomInt(800, 1500))
  await tiktokScrollHaltIfNeeded(shouldHalt)
  if (tiktokStableKeyAdvanced(before, await getStableKey())) {
    log('SCROLL_SUCCESS', 'wheel_fallback')
    return true
  }

  log('SCROLL_STILL_STUCK', 'stable_key_unchanged_after_keyboard_x3_and_wheel')
  return false
}

/**
 * LIVE skip: one focus + one keyboard burst (call twice for original double-skip).
 */
export async function tiktokLiveSkipWheelPair(page, log, shouldHalt) {
  await tiktokFocusFeedActiveVideo(page, log, shouldHalt)
  await tiktokKeyboardScrollBurst(page, log, shouldHalt)
}
