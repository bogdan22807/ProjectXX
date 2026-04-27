/**
 * Legacy post-LIVE hard scroll is disabled while SAFE_TIKTOK_FEED_MODE is reset
 * to a clean no-action baseline.
 */

/**
 * @param {{
 *   page: import('playwright').Page
 *   log: (action: string, details?: string) => void
 *   shouldHalt: () => Promise<false | 'stop' | 'max_duration'>
 *   getStableKey: () => Promise<string>
 * }} _opts
 * @returns {Promise<void>}
 */
export async function runPostLiveHardScrollSequence(_opts) {
  const { log } = _opts
  log('POST_LIVE_HARD_SCROLL_DISABLED', 'clean_safe_baseline_no_action')
}
