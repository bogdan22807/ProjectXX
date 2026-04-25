/**
 * After LIVE skip: strong down-only scroll with stable-key checks (Chromium + Fox / same page API).
 * No reload/goto, no upward scroll.
 */

import { randomInt, sleep } from '../asyncUtils.js'
import {
  tiktokFocusAndWheel,
  tiktokScrollHaltIfNeeded,
  tiktokScrollSleepMsHaltable,
  tiktokStableKeyAdvanced,
} from './tiktokStrongFeedScroll.js'

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
      await tiktokScrollHaltIfNeeded(shouldHalt)
      const now = await getStableKey()
      if (tiktokStableKeyAdvanced(refAtRound, now)) {
        log('POST_LIVE_HARD_SCROLL_OK', step)
        return true
      }
      return false
    }

    await tiktokFocusAndWheel(page, log, shouldHalt, 1800, 2400)
    if (await check('after_wheel')) return

    await tiktokScrollSleepMsHaltable(shouldHalt, randomInt(800, 1500))
    if (await check('after_wheel_wait')) return

    await tiktokScrollHaltIfNeeded(shouldHalt)
    await page.keyboard.press('PageDown').catch(() => {})
    if (await check('after_PageDown')) return

    await tiktokScrollSleepMsHaltable(shouldHalt, randomInt(800, 1500))
    if (await check('after_PageDown_wait')) return

    for (let i = 0; i < 3; i += 1) {
      await tiktokScrollHaltIfNeeded(shouldHalt)
      await page.keyboard.press('ArrowDown')
      await sleep(300)
      await tiktokScrollHaltIfNeeded(shouldHalt)
      if (await check(`after_ArrowDown_${i + 1}`)) return
    }

    const finalKey = await getStableKey()
    if (tiktokStableKeyAdvanced(refAtRound, finalKey)) {
      log('POST_LIVE_HARD_SCROLL_OK', 'after_round_complete')
      return
    }
  }

  log('POST_LIVE_STILL_STUCK', 'stable key unchanged after hard scroll rounds')
}
