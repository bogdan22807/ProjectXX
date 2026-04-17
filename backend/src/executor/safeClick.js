/**
 * Try to click the first visible element matching selector; log outcome only.
 * Not wired to routes — call from scenarios when needed.
 */

import { sleepRandom } from './asyncUtils.js'

const DEFAULT_VISIBLE_MS = 10_000
const DEFAULT_PAUSE_MIN_MS = 200
const DEFAULT_PAUSE_MAX_MS = 800

/**
 * @typedef {{
 *   visibleTimeoutMs?: number
 *   pauseMinMs?: number
 *   pauseMaxMs?: number
 * }} SafeClickOptions
 */

/**
 * @param {import('playwright').Page} page
 * @param {string} selector
 * @param {(action: string, details?: string) => void} logger
 * @param {SafeClickOptions} [options]
 * @returns {Promise<boolean>}
 */
export async function safeClick(page, selector, logger, options = {}) {
  const visibleMs =
    Number(options.visibleTimeoutMs) > 0
      ? Number(options.visibleTimeoutMs)
      : DEFAULT_VISIBLE_MS
  const pauseMin =
    Number(options.pauseMinMs) >= 0 ? Number(options.pauseMinMs) : DEFAULT_PAUSE_MIN_MS
  const pauseMax =
    Number(options.pauseMaxMs) >= 0 ? Number(options.pauseMaxMs) : DEFAULT_PAUSE_MAX_MS

  const log = typeof logger === 'function' ? logger : () => {}

  try {
    const loc = page.locator(selector).first()
    await loc.waitFor({ state: 'visible', timeout: visibleMs })
    await sleepRandom(pauseMin, pauseMax)
    await loc.click()
    log('CLICK_COMPLETED', String(selector))
    return true
  } catch {
    log('CLICK_SKIPPED', String(selector))
    return false
  }
}
