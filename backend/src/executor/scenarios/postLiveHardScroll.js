/**
 * After LIVE skip: keyboard-first scroll on feed-active-video + stable-key checks (Chromium + Fox).
 * No reload/goto, no upward scroll.
 */

import { tiktokScrollHaltIfNeeded, tiktokStrongScrollWithRecovery } from './tiktokStrongFeedScroll.js'

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

  const maxRounds = 3

  for (let round = 0; round < maxRounds; round += 1) {
    const refAtRound = await getStableKey()

    log('POST_LIVE_HARD_SCROLL', `round=${round + 1}/${maxRounds}`)

    const advanced = await tiktokStrongScrollWithRecovery(page, log, shouldHalt, getStableKey, refAtRound)
    if (advanced) {
      log('POST_LIVE_HARD_SCROLL_OK', `round=${round + 1}`)
      return
    }

    await tiktokScrollHaltIfNeeded(shouldHalt)
  }

  log('POST_LIVE_STILL_STUCK', 'stable key unchanged after hard scroll rounds')
}
