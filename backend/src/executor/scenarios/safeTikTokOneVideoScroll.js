/**
 * SAFE_TIKTOK_FEED_MODE scroll: bringToFront → focus → ArrowDown ×2 (1200ms) → PageDown (1500ms) → wheel (1500ms); compare stable key after each step.
 */

import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomInt } from '../asyncUtils.js'
import {
  tiktokScrollHaltIfNeeded,
  tiktokScrollSleepMsHaltable,
  tiktokStableKeyAdvanced,
} from './tiktokScrollHelpers.js'
import { focusPrimaryFeedVideo } from './tiktokFeedLayout.js'

/**
 * @param {import('playwright').Page} page
 * @param {(action: string, details?: string) => void} log
 * @param {string} label
 */
async function maybeScrollVisualScreenshot(page, log, label) {
  if (String(process.env.DEBUG_VISUAL_ACTIONS ?? '').trim() !== '1') return
  if (safePageClosed(page)) return
  const dir = String(process.env.DEBUG_VISUAL_DIR ?? '').trim() || join(tmpdir(), 'tiktok-safe-visual-debug')
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    /* ignore */
  }
  const safe = String(label).replace(/[^a-z0-9_-]+/gi, '_').slice(0, 80)
  const fp = join(dir, `${safe}-${Date.now()}.png`)
  try {
    await page.screenshot({ path: fp, fullPage: false })
    log('VISUAL_DEBUG_SCREENSHOT', `${label} path=${fp}`)
  } catch (e) {
    log('VISUAL_DEBUG_SCREENSHOT', `${label} failed err=${String(e).slice(0, 120)}`)
  }
}

/**
 * @param {import('playwright').Page} page
 */
function safePageClosed(page) {
  try {
    return page.isClosed()
  } catch {
    return true
  }
}

/**
 * @param {import('playwright').Page} page
 * @param {() => Promise<string>} getStableKey
 */
async function safeReadStableKey(page, getStableKey) {
  if (safePageClosed(page)) return ''
  try {
    return await getStableKey()
  } catch {
    return ''
  }
}

/**
 * @param {import('playwright').Page} page
 * @param {() => Promise<string>} getStableKey
 * @param {string} before
 */
async function keyAdvancedFrom(page, getStableKey, before) {
  const after = await safeReadStableKey(page, getStableKey)
  return tiktokStableKeyAdvanced(before, after)
}

/**
 * Multi-step scroll: ArrowDown ×2 (1200ms settle each), PageDown (1500ms), wheel 900–1400 (1500ms).
 *
 * @param {{ resolvedInfo?: Awaited<ReturnType<import('./tiktokFeedLayout.js').resolvePrimaryFeedRoot>> | null }} [focusOptions]
 * @returns {Promise<boolean>} true if stable key changed vs initial `before`
 */
export async function runSafeTikTokControlledOneVideoScroll(page, log, shouldHalt, getStableKey, focusOptions) {
  if (safePageClosed(page)) {
    log('PAGE_CLOSED_DURING_STOP', 'scroll_start')
    return false
  }

  try {
    await page.bringToFront()
  } catch {
    /* ignore */
  }
  await tiktokScrollSleepMsHaltable(shouldHalt, 300)
  await tiktokScrollHaltIfNeeded(shouldHalt)
  log('PAGE_BROUGHT_TO_FRONT', '')

  await maybeScrollVisualScreenshot(page, log, 'before_scroll')

  log('SCROLL_ATTEMPT', 'bringToFront_focus_ArrowDown_x2_PageDown_wheel_fixed_waits')

  const before = await safeReadStableKey(page, getStableKey)
  const focused = await focusPrimaryFeedVideo(page, log, shouldHalt, 'SCROLL_VIDEO_FOCUSED', focusOptions ?? {})
  if (!focused) {
    log('SCROLL_VIDEO_FOCUS_FAILED', 'keyboard_without_focus_click')
  }

  const tryArrow = async (attemptLabel) => {
    if (safePageClosed(page)) return false
    await tiktokScrollHaltIfNeeded(shouldHalt)
    log('SCROLL_KEYBOARD_ARROW', attemptLabel)
    try {
      await page.keyboard.press('ArrowDown')
    } catch {
      if (safePageClosed(page)) return false
    }
    await tiktokScrollSleepMsHaltable(shouldHalt, 1200)
    await tiktokScrollHaltIfNeeded(shouldHalt)
    return keyAdvancedFrom(page, getStableKey, before)
  }

  if (await tryArrow('attempt=1')) {
    log('SCROLL_KEY_CHANGED', 'after_ArrowDown_1')
    log('SCROLL_SUCCESS', 'method=ArrowDown')
    await maybeScrollVisualScreenshot(page, log, 'after_scroll')
    return true
  }

  if (await tryArrow('attempt=2')) {
    log('SCROLL_KEY_CHANGED', 'after_ArrowDown_2')
    log('SCROLL_SUCCESS', 'method=ArrowDown')
    await maybeScrollVisualScreenshot(page, log, 'after_scroll')
    return true
  }

  if (safePageClosed(page)) {
    log('PAGE_CLOSED_DURING_STOP', 'before_PageDown')
    return false
  }
  await tiktokScrollHaltIfNeeded(shouldHalt)
  log('SCROLL_PAGEDOWN_FALLBACK', 'after_ArrowDown_x2_unchanged')
  try {
    await page.keyboard.press('PageDown')
  } catch {
    if (safePageClosed(page)) {
      log('PAGE_CLOSED_DURING_STOP', 'during_PageDown')
      return false
    }
  }
  await tiktokScrollSleepMsHaltable(shouldHalt, 1500)
  await tiktokScrollHaltIfNeeded(shouldHalt)
  if (await keyAdvancedFrom(page, getStableKey, before)) {
    log('SCROLL_KEY_CHANGED', 'after_PageDown')
    log('SCROLL_SUCCESS', 'method=PageDown')
    await maybeScrollVisualScreenshot(page, log, 'after_scroll')
    return true
  }

  if (safePageClosed(page)) {
    log('PAGE_CLOSED_DURING_STOP', 'before_wheel')
    return false
  }
  await tiktokScrollHaltIfNeeded(shouldHalt)
  const dy = randomInt(900, 1400)
  log('SCROLL_WHEEL_FALLBACK', `dy=${dy}`)
  try {
    await page.mouse.wheel(0, dy)
  } catch {
    if (safePageClosed(page)) {
      log('PAGE_CLOSED_DURING_STOP', 'during_wheel')
      return false
    }
  }
  await tiktokScrollSleepMsHaltable(shouldHalt, 1500)
  await tiktokScrollHaltIfNeeded(shouldHalt)
  if (await keyAdvancedFrom(page, getStableKey, before)) {
    log('SCROLL_KEY_CHANGED', 'after_wheel')
    log('SCROLL_SUCCESS', 'method=wheel')
    await maybeScrollVisualScreenshot(page, log, 'after_scroll')
    return true
  }

  log('SCROLL_STUCK', 'stable_key_unchanged_after_ArrowDown_x2_PageDown_wheel')
  await maybeScrollVisualScreenshot(page, log, 'after_scroll')
  return false
}
