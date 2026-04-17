/**
 * One stable flow: open URL → waits → smooth scroll → optional click → waits → done.
 * Uses project logStep-style logger (action string + details).
 */

import { sleepRandom } from '../asyncUtils.js'
import { safeClick } from '../safeClick.js'
import { smoothScrollPage } from '../smoothScrollPage.js'

function gotoWaitUntil() {
  const w = String(process.env.PLAYWRIGHT_GOTO_WAIT_UNTIL ?? '').trim().toLowerCase()
  if (w === 'domcontentloaded' || w === 'load' || w === 'networkidle' || w === 'commit') {
    return /** @type {'commit' | 'domcontentloaded' | 'load' | 'networkidle'} */ (w)
  }
  return 'commit'
}

function selectorTimeoutMs() {
  const n = Number(process.env.PLAYWRIGHT_SELECTOR_TIMEOUT_MS)
  return Number.isFinite(n) && n > 0 ? n : 15_000
}

/**
 * @typedef {{
 *   startUrl: string
 *   readySelector?: string | null
 *   selectors?: { clickTarget?: string }
 *   timeouts?: { pageLoad?: number }
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

  const pageLoadMs = (() => {
    const n = Number(config.timeouts?.pageLoad)
    return Number.isFinite(n) && n > 0 ? n : 60_000
  })()

  const response = await page.goto(startUrl, {
    waitUntil: gotoWaitUntil(),
    timeout: pageLoadMs,
  })

  const status = response?.status() ?? null
  if (status === 407) {
    throw new Error(`HTTP 407 for ${startUrl}`)
  }
  const ok = response === null || response.ok()
  if (!ok) {
    throw new Error(`HTTP ${status ?? '?'} for ${startUrl}`)
  }

  log('PAGE_OPENED', page.url())

  const ready = String(config.readySelector ?? '').trim()
  if (ready) {
    await page.waitForSelector(ready, {
      state: 'attached',
      timeout: selectorTimeoutMs(),
    })
  }

  log('WAITING', 'after page open 2000–5000ms')
  await sleepRandom(2000, 5000)

  await smoothScrollPage(page, log, {
    ...(config.smoothScroll ?? {}),
    scrollLog: {
      started: 'SCROLL_STARTED',
      completed: 'SCROLL_COMPLETED',
      waitBetweenSteps: 'WAITING',
    },
  })

  const clickSel = String(config.selectors?.clickTarget ?? '').trim()
  if (clickSel) {
    await safeClick(page, clickSel, log)
  } else {
    log('CLICK_SKIPPED', 'no clickTarget selector')
  }

  log('WAITING', 'after scroll 3000–6000ms')
  await sleepRandom(3000, 6000)

  log('SCENARIO_COMPLETED', startUrl)
}
