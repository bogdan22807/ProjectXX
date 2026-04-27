/**
 * SAFE_TIKTOK_FEED_MODE scroll placeholder.
 *
 * The previous controlled scroll implementation was intentionally removed while
 * SAFE mode is reset to a clean, no-action baseline.
 */

/**
 * @param {import('playwright').Page} _page
 * @param {(action: string, details?: string) => void} log
 * @param {() => Promise<false | 'stop' | 'max_duration'>} _shouldHalt
 * @returns {Promise<boolean>}
 */
export async function runSafeTikTokControlledOneVideoScroll(_page, log, _shouldHalt) {
  log('SAFE_TIKTOK_SCROLL_DISABLED', 'clean_safe_core_no_scroll')
  return false
}
