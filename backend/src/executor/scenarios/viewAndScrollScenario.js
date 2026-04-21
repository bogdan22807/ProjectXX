/**
 * One stable flow: open URL → waits → smooth scroll → optional click → waits → done.
 * Uses project logStep-style logger (action string + details).
 */

import fs from 'node:fs'
import path from 'node:path'
import { sleepRandom } from '../asyncUtils.js'
import { ExecutorHaltError } from '../executorHalt.js'
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
 *   debugScreenshots?: boolean
 *   screenshotDir?: string
 *   skipInitialNavigation?: boolean
 *   platform?: string
 *   shouldAbort?: () => boolean | Promise<boolean>
 *   onAfterBlock?: (block: string) => void | Promise<void>
 * }} ViewAndScrollScenarioConfig
 */

async function checkHalt(shouldAbort) {
  if (!shouldAbort) return
  const v = await shouldAbort()
  if (v === 'stop') throw new ExecutorHaltError('stop')
  if (v === 'max_duration') throw new ExecutorHaltError('max_duration')
}

function defaultScreenshotDir() {
  return path.join(process.cwd(), 'playwright-debug')
}

async function maybeScreenshot(page, enabled, dir, filename) {
  if (!enabled) return
  const d = dir || defaultScreenshotDir()
  fs.mkdirSync(d, { recursive: true })
  const fp = path.join(d, filename)
  await page.screenshot({ path: fp, fullPage: false }).catch(() => {})
}

/**
 * @param {string} platform
 * @param {string} url
 * @param {string} title
 */
export function inferTikTokAuthState(platform, url, title) {
  if (String(platform).trim() !== 'TikTok') return 'unknown'
  const u = String(url).toLowerCase()
  const t = String(title).toLowerCase()
  if (u.includes('/login') || u.includes('signup') || (t.includes('log in') && t.includes('tiktok'))) {
    return 'redirected_to_login'
  }
  if (u.includes('verify') || u.includes('captcha') || u.includes('challenge')) {
    return 'redirected_to_login'
  }
  if (u.includes('tiktok.com') && !u.includes('/login')) {
    return 'logged_in'
  }
  return 'unknown'
}

/**
 * @param {import('playwright').Page} page
 * @param {(action: string, details?: string) => void} logger
 * @param {ViewAndScrollScenarioConfig} config
 */
export async function runViewAndScrollScenario(page, logger, config) {
  const log = typeof logger === 'function' ? logger : () => {}
  const shouldAbort = typeof config?.shouldAbort === 'function' ? config.shouldAbort : null
  const onAfterBlock =
    typeof config?.onAfterBlock === 'function' ? config.onAfterBlock : async () => {}

  const startUrl = String(config?.startUrl ?? '').trim()
  if (!startUrl) {
    throw new Error('runViewAndScrollScenario: startUrl is required')
  }

  const pageLoadMs = (() => {
    const n = Number(config.timeouts?.pageLoad)
    return Number.isFinite(n) && n > 0 ? n : 60_000
  })()

  const platform = String(config.platform ?? '').trim() || 'Other'
  const shotDir = String(config.screenshotDir ?? '').trim() || defaultScreenshotDir()
  const shots = Boolean(config.debugScreenshots)

  if (!config.skipInitialNavigation) {
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

    const curUrl = page.url()
    const titleAfterOpen = (await page.title().catch(() => '')) ?? ''
    log('CURRENT_URL', curUrl)
    log('PAGE_TITLE', titleAfterOpen || '(empty)')
    const auth = inferTikTokAuthState(platform, curUrl, titleAfterOpen)
    log('AUTH_STATE', auth)
    if (auth === 'redirected_to_login') {
      log('TIKTOK_AUTH_REDIRECT', 'cookies invalid or session expired — login/verify/captcha flow detected')
    }
    log('PAGE_OPENED', `url=${curUrl} | title=${titleAfterOpen}`)
    await maybeScreenshot(page, shots, shotDir, 'debug-opened.png')
  }
  await onAfterBlock('initial_navigation')
  await checkHalt(shouldAbort)

  const ready = String(config.readySelector ?? '').trim()
  if (ready) {
    await page.waitForSelector(ready, {
      state: 'attached',
      timeout: selectorTimeoutMs(),
    })
  }
  await onAfterBlock('ready_selector')
  await checkHalt(shouldAbort)

  log('WAITING', 'after page open 2000–5000ms')
  await sleepRandom(2000, 5000)
  await onAfterBlock('wait_after_open')
  await checkHalt(shouldAbort)

  await smoothScrollPage(page, log, {
    ...(config.smoothScroll ?? {}),
    shouldAbort,
    scrollLog: {
      started: 'SCROLL_STARTED',
      completed: 'SCROLL_COMPLETED',
      waitBetweenSteps: 'WAITING',
      step: 'SCROLL_STEP',
    },
  })
  await maybeScreenshot(page, shots, shotDir, 'debug-scrolled.png')
  await onAfterBlock('smooth_scroll')
  await checkHalt(shouldAbort)

  const clickSel = String(config.selectors?.clickTarget ?? '').trim()
  if (clickSel) {
    await safeClick(page, clickSel, log)
    await maybeScreenshot(page, shots, shotDir, 'debug-clicked.png')
  } else {
    log('CLICK_SKIPPED', 'no clickTarget selector')
  }
  await onAfterBlock('optional_click')
  await checkHalt(shouldAbort)

  log('WAITING', 'after scroll 3000–6000ms')
  await sleepRandom(3000, 6000)
  await onAfterBlock('wait_after_scroll')
  await checkHalt(shouldAbort)

  const finalUrl = page.url()
  const titleDone = (await page.title().catch(() => '')) ?? ''
  log('CURRENT_URL', finalUrl)
  log('PAGE_TITLE', titleDone || '(empty)')
  log('AUTH_STATE', inferTikTokAuthState(platform, finalUrl, titleDone))
  log('SCENARIO_COMPLETED', `url=${finalUrl} | title=${titleDone}`)
}
