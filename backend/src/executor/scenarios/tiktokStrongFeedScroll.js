/**
 * TikTok FYP: focus active feed/video, strong down-only scroll, stable-key recovery (Chromium + Fox).
 * No upward motion: dy > 0 only, no ArrowUp / PageUp / SCROLL_BACK.
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
 * Pick scroll target: feed-active-video → main video → visible video → main.
 * @param {import('playwright').Page} page
 * @returns {Promise<import('playwright').Locator | null>}
 */
export async function tiktokResolveScrollTarget(page) {
  const candidates = [
    page.locator('[data-e2e="feed-active-video"]').first(),
    page.locator('main video').first(),
    page.locator('video:visible').first(),
    page.locator('main').first(),
  ]
  for (const loc of candidates) {
    try {
      if ((await loc.count()) === 0) continue
      const vis = await loc.isVisible().catch(() => false)
      if (!vis) continue
      const box = await loc.boundingBox().catch(() => null)
      if (box && box.width >= 40 && box.height >= 40) {
        return loc
      }
    } catch {
      /* next */
    }
  }
  return null
}

/**
 * scrollIntoViewIfNeeded → center move → click for focus.
 * @returns {Promise<boolean>}
 */
export async function tiktokFocusScrollTarget(page, log, shouldHalt) {
  const loc = await tiktokResolveScrollTarget(page)
  if (!loc) {
    log('SCROLL_TARGET_FOUND', 'none')
    return false
  }
  try {
    await loc.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {})
    await tiktokScrollHaltIfNeeded(shouldHalt)
    const box = await loc.boundingBox().catch(() => null)
    if (!box || box.width < 40 || box.height < 40) {
      log('SCROLL_TARGET_FOUND', 'no_bounding_box')
      return false
    }
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    log('SCROLL_TARGET_FOUND', `center≈${Math.round(cx)},${Math.round(cy)}`)
    await page.mouse.move(cx, cy)
    await tiktokScrollHaltIfNeeded(shouldHalt)
    await page.mouse.click(cx, cy, { delay: 30 }).catch(() => {})
    log('SCROLL_FOCUS_CLICK', 'center')
    return true
  } catch {
    log('SCROLL_TARGET_FOUND', 'focus_failed')
    return false
  }
}

/**
 * Focus + wheel in [minDy, maxDy] (e.g. LIVE skip) — no stable-key logic.
 * @param {import('playwright').Page} page
 * @param {(action: string, details?: string) => void} log
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 * @param {number} minDy
 * @param {number} maxDy
 */
export async function tiktokFocusAndWheel(page, log, shouldHalt, minDy, maxDy) {
  const ok = await tiktokFocusScrollTarget(page, log, shouldHalt)
  if (!ok) return
  const dy = randomInt(minDy, maxDy)
  await tiktokWheelDownOnly(page, dy, log)
  log('SCROLL_STRONG', `focused_wheel dy=${dy}px`)
}

/**
 * Strong scroll with up to 2 attempts; compares stable key to `beforeKey` from caller.
 * @param {import('playwright').Page} page
 * @param {(action: string, details?: string) => void} log
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 * @param {() => Promise<string>} getStableKey
 * @param {string} beforeKey
 * @returns {Promise<boolean>} true if feed advanced vs beforeKey
 */
export async function tiktokStrongScrollWithRecovery(page, log, shouldHalt, getStableKey, beforeKey) {
  const before = String(beforeKey ?? '').trim() ? beforeKey : await getStableKey()

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const focused = await tiktokFocusScrollTarget(page, log, shouldHalt)
    if (!focused) {
      log('SCROLL_HARD_STUCK', 'no_scroll_target')
      return tiktokStableKeyAdvanced(before, await getStableKey())
    }

    await tiktokScrollHaltIfNeeded(shouldHalt)
    const dy = randomInt(2800, 3600)
    log('SCROLL_STRONG', `attempt=${attempt} dy=${dy}`)
    await tiktokWheelDownOnly(page, dy, log)
    await tiktokScrollSleepMsHaltable(shouldHalt, randomInt(800, 1200))
    await tiktokScrollHaltIfNeeded(shouldHalt)

    let after = await getStableKey()
    if (tiktokStableKeyAdvanced(before, after)) {
      log('SCROLL_OK', `attempt=${attempt}`)
      return true
    }

    log('SCROLL_RETRY', `attempt=${attempt}`)
    await page.keyboard.press('Space').catch(() => {})
    await tiktokScrollHaltIfNeeded(shouldHalt)
    await sleep(80 + randomInt(0, 120))
    await tiktokFocusScrollTarget(page, log, shouldHalt)
    await tiktokScrollHaltIfNeeded(shouldHalt)
    await page.keyboard.press('PageDown').catch(() => {})
    for (let i = 0; i < 3; i += 1) {
      await tiktokScrollHaltIfNeeded(shouldHalt)
      await page.keyboard.press('ArrowDown')
      await sleep(300)
    }
    await tiktokScrollSleepMsHaltable(shouldHalt, randomInt(400, 700))
    await tiktokScrollHaltIfNeeded(shouldHalt)
    after = await getStableKey()
    if (tiktokStableKeyAdvanced(before, after)) {
      log('SCROLL_OK', `after_retry attempt=${attempt}`)
      return true
    }
  }

  log('SCROLL_HARD_STUCK', 'stable_key_unchanged_after_2_attempts')
  return false
}
