/**
 * TikTok FYP: focus `[data-e2e="feed-active-video"]`, keyboard scroll (ArrowDown + PageDown), wheel only as fallback.
 * Down-only: no ArrowUp / PageUp. No large center click — fixed offset click on active video container.
 */

import { randomInt, sleep } from '../asyncUtils.js'
import { ExecutorHaltError } from '../executorHalt.js'

/**
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 */
export async function tiktokScrollHaltIfNeeded(shouldHalt) {
  if (!shouldHalt) return
  const v = await shouldHalt()
  if (v === 'stop') throw new ExecutorHaltError('stop')
  if (v === 'max_duration') throw new ExecutorHaltError('max_duration')
}

/**
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 * @param {number} ms
 */
export async function tiktokScrollSleepMsHaltable(shouldHalt, ms) {
  let left = Math.max(0, Math.floor(Number(ms) || 0))
  while (left > 0) {
    await tiktokScrollHaltIfNeeded(shouldHalt)
    const step = Math.min(400, left)
    await sleep(step)
    left -= step
  }
}

/**
 * @param {string} before
 * @param {string} after
 */
export function tiktokStableKeyAdvanced(before, after) {
  const b = String(before ?? '').trim()
  const a = String(after ?? '').trim()
  if (!b) return Boolean(a)
  return Boolean(a) && a !== b
}

/**
 * @param {import('playwright').Page} page
 * @param {number} dy
 * @param {(action: string, details?: string) => void} log
 */
export async function tiktokWheelDownOnly(page, dy, log) {
  const n = Number(dy)
  if (!Number.isFinite(n) || n <= 0) {
    log('BLOCKED_UPWARD_MOVEMENT', `wheel rejected non-positive dy=${String(dy)}`)
    return
  }
  await page.mouse.wheel(0, n)
}

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
