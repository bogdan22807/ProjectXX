/**
 * One stable flow: open URL → pause → smooth scroll → optional click → pause → done.
 * Does not own browser lifecycle — pass an existing page + logger.
 */

import { sleepRandom } from '../asyncUtils.js'
import { safeClick } from '../safeClick.js'
import { smoothScrollPage } from '../smoothScrollPage.js'

function gotoTimeoutMs() {
  const n = Number(process.env.PLAYWRIGHT_GOTO_TIMEOUT_MS)
  return Number.isFinite(n) && n > 0 ? n : 60_000
}

function gotoWaitUntil() {
  const w = String(process.env.PLAYWRIGHT_GOTO_WAIT_UNTIL ?? '').trim().toLowerCase()
  if (w === 'domcontentloaded' || w === 'load' || w === 'networkidle' || w === 'commit') {
    return /** @type {'commit' | 'domcontentloaded' | 'load' | 'networkidle'} */ (w)
  }
  return 'commit'
}

/**
 * @typedef {{
 *   startUrl: string
 *   selectors?: { clickTarget?: string }
 *   smoothScroll?: import('../smoothScrollPage.js').SmoothScrollPageOptions
 * }} ViewAndScrollScenarioConfig
 */

/**
 * @param {import('playwright').Page} page
 * @param {(action: string, details?: string) => void} logger
 * @param {ViewAndScrollScenarioConfig} config
 */
export async function runViewAndScrollScenario(page, logger, config) {
  const log = typeof logger === 'function' ? logger : () => {}
  const startUrl = String(config?.startUrl ?? '').trim()
  if (!startUrl) {
    throw new Error('runViewAndScrollScenario: startUrl is required')
  }

  log('scenario view_and_scroll started', startUrl)

  await page.goto(startUrl, {
    waitUntil: gotoWaitUntil(),
    timeout: gotoTimeoutMs(),
  })

  await sleepRandom(2000, 5000)

  await smoothScrollPage(page, log, config.smoothScroll ?? {})

  const clickSel = String(config.selectors?.clickTarget ?? '').trim()
  if (clickSel) {
    await safeClick(page, clickSel, log)
  }

  await sleepRandom(3000, 6000)

  log('scenario view_and_scroll completed', `url=${startUrl}`)
}
