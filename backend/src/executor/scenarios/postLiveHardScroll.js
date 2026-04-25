/**
 * After LIVE skip: controlled one-video scroll (same as SAFE mode) + stable-key checks.
 * No reload/goto, no upward scroll, no strong wheel.
 */

import { runSafeTikTokControlledOneVideoScroll } from './safeTikTokOneVideoScroll.js'
import { tiktokScrollHaltIfNeeded, tiktokStableKeyAdvanced } from './tiktokStrongFeedScroll.js'

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

  const maxRounds = 1

  for (let round = 0; round < maxRounds; round += 1) {
    const refAtRound = await getStableKey()

    log('POST_LIVE_HARD_SCROLL', `round=${round + 1}/${maxRounds}`)

    await runSafeTikTokControlledOneVideoScroll(page, log, shouldHalt, getStableKey)
    const now = await getStableKey()
    if (tiktokStableKeyAdvanced(refAtRound, now)) {
      log('POST_LIVE_HARD_SCROLL_OK', `round=${round + 1}`)
      return
    }

    await tiktokScrollHaltIfNeeded(shouldHalt)
  }

  log('POST_LIVE_STILL_STUCK', 'stable key unchanged after controlled scroll rounds')
}
