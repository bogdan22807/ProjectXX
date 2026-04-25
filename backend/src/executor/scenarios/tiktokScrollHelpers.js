/**
 * Shared TikTok scroll helpers (haltable sleep, stable-key compare, down-only wheel guard).
 * Used by SAFE one-video scroll and by legacy human `tiktokStrongFeedScroll.js` — not scroll logic itself.
 */

import { sleep } from '../asyncUtils.js'
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
