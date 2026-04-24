/**
 * After LIVE skip: strong down-only scroll with stable-key checks (Chromium + Fox / same page API).
 * No reload/goto, no upward scroll.
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
 * @param {string} before
 * @param {string} after
 */
function stableKeyAdvanced(before, after) {
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
async function wheelDownOnly(page, dy, log) {
  const n = Number(dy)
  if (!Number.isFinite(n) || n <= 0) {
    log('BLOCKED_UPWARD_MOVEMENT', `wheel rejected non-positive dy=${String(dy)}`)
    return
  }
  await page.mouse.wheel(0, n)
}

/**
 * @param {import('playwright').Page} page
 * @param {(action: string, details?: string) => void} log
 * @param {number} minDy
 * @param {number} maxDy
 * @param {string} label
 */
async function wheelOnActiveVideo(page, log, minDy, maxDy, label) {
  const vid = page.locator('main video, [data-e2e="feed-active-video"] video').first()
  if ((await vid.count()) === 0) return
  const box = await vid.boundingBox()
  if (!box || box.width < 40 || box.height < 40) return
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await page.mouse.move(cx, cy)
  const dy = randomInt(minDy, maxDy)
  await wheelDownOnly(page, dy, log)
  log('SCROLL', `${label} dy=${dy}px`)
}

/**
 * @param {{
 *   page: import('playwright').Page
 *   log: (action: string, details?: string) => void
 *   shouldHalt: () => Promise<false | 'stop' | 'max_duration'>
 *   getStableKey: () => Promise<string>
 * }} opts
 * @returns {Promise<void>}
 */
export async function runPostLiveHardScrollSequence(opts) {
  const { page, log, shouldHalt, getStableKey } = opts

  /** Initial attempt + up to 2 full repeats if key unchanged. */
  const maxRounds = 3

  for (let round = 0; round < maxRounds; round += 1) {
    const refAtRound = await getStableKey()

    log('POST_LIVE_HARD_SCROLL', `round=${round + 1}/${maxRounds}`)

    const check = async (step) => {
      await haltIfNeeded(shouldHalt)
      const now = await getStableKey()
      if (stableKeyAdvanced(refAtRound, now)) {
        log('POST_LIVE_HARD_SCROLL_OK', step)
        return true
      }
      return false
    }

    await wheelOnActiveVideo(page, log, 1800, 2400, 'POST_LIVE_HARD_SCROLL_wheel')
    if (await check('after_wheel')) return

    await sleepMsHaltable(shouldHalt, randomInt(800, 1500))
    if (await check('after_wheel_wait')) return

    await haltIfNeeded(shouldHalt)
    await page.keyboard.press('PageDown').catch(() => {})
    if (await check('after_PageDown')) return

    await sleepMsHaltable(shouldHalt, randomInt(800, 1500))
    if (await check('after_PageDown_wait')) return

    for (let i = 0; i < 3; i += 1) {
      await haltIfNeeded(shouldHalt)
      await page.keyboard.press('ArrowDown')
      await sleep(300)
      await haltIfNeeded(shouldHalt)
      if (await check(`after_ArrowDown_${i + 1}`)) return
    }

    const finalKey = await getStableKey()
    if (stableKeyAdvanced(refAtRound, finalKey)) {
      log('POST_LIVE_HARD_SCROLL_OK', 'after_round_complete')
      return
    }
  }

  log('POST_LIVE_STILL_STUCK', 'stable key unchanged after hard scroll rounds')
}
