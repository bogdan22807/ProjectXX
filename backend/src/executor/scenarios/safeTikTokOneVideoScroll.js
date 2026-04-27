/**
 * SAFE_TIKTOK_FEED_MODE scroll-only flow: resolve active root → mouse wheel → fresh root/key check
 * → one ArrowDown fallback. Never compare against the old iteration root after scrolling.
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
import { readStableKeyFromFeedRoot, resolvePrimaryFeedRoot } from './tiktokFeedLayout.js'

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

function primaryRootSource(info) {
  if (!info) return 'none'
  if (info.kind === 'e2e' || info.kind === 'article' || info.kind === 'video') return info.kind
  return 'none'
}

async function safeReadStableKeyFromInfo(page, info) {
  if (safePageClosed(page)) return ''
  try {
    return await readStableKeyFromFeedRoot(page, info)
  } catch {
    return ''
  }
}

async function targetBoxForRoot(info) {
  if (!info) return null
  try {
    if (info.kind === 'e2e' || info.kind === 'article') {
      const video = info.root.locator('video').first()
      if ((await video.count().catch(() => 0)) > 0 && (await video.isVisible().catch(() => false))) {
        const videoBox = await video.boundingBox().catch(() => null)
        if (videoBox && videoBox.width > 20 && videoBox.height > 20) return videoBox
      }
    }
    const rootBox = await info.root.boundingBox().catch(() => null)
    if (rootBox && rootBox.width > 20 && rootBox.height > 20) return rootBox
  } catch {
    /* ignore */
  }
  return null
}

async function moveMouseToRootCenter(page, info, log, label) {
  const box = await targetBoxForRoot(info)
  if (!box) {
    log('SCROLL_MOUSE_MOVE_FAILED', `${label} source=${primaryRootSource(info)} reason=no_box`)
    return false
  }
  const vp = page.viewportSize()
  const vw = vp && Number.isFinite(vp.width) ? vp.width : 1280
  const vh = vp && Number.isFinite(vp.height) ? vp.height : 720
  const x = Math.max(1, Math.min(vw - 1, Math.floor(box.x + box.width / 2)))
  const y = Math.max(1, Math.min(vh - 1, Math.floor(box.y + box.height / 2)))
  try {
    await page.mouse.move(x, y)
    log('SCROLL_MOUSE_MOVE', `${label} x=${x} y=${y} source=${primaryRootSource(info)}`)
    return true
  } catch {
    log('SCROLL_MOUSE_MOVE_FAILED', `${label} source=${primaryRootSource(info)} reason=mouse_move_error`)
    return false
  }
}

/**
 * Scroll-only SAFE TikTok FYP advance.
 *
 * @returns {Promise<boolean>} true if a freshly resolved stable key changed
 */
export async function runSafeTikTokControlledOneVideoScroll(page, log, shouldHalt) {
  if (safePageClosed(page)) {
    log('PAGE_CLOSED_DURING_STOP', 'scroll_start')
    return false
  }

  const beforeRoot = await resolvePrimaryFeedRoot(page)
  log('PRIMARY_ROOT_BEFORE', `source=${primaryRootSource(beforeRoot)} found=${beforeRoot != null}`)
  const before = await safeReadStableKeyFromInfo(page, beforeRoot)
  log('KEY_BEFORE', before.slice(0, 240))
  if (!beforeRoot) {
    log('SCROLL_SUCCESS', 'false')
    log('SCROLL_STUCK', 'reason=no_primary_root_before')
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

  log('SCROLL_ATTEMPT', 'mouse_wheel_then_single_ArrowDown_fallback')
  await moveMouseToRootCenter(page, beforeRoot, log, 'before_wheel')
  await tiktokScrollHaltIfNeeded(shouldHalt)
  const dy = randomInt(900, 1400)
  log('SCROLL_MOUSE_WHEEL', `dy=${dy}`)
  try {
    await page.mouse.wheel(0, dy)
  } catch {
    if (safePageClosed(page)) {
      log('PAGE_CLOSED_DURING_STOP', 'during_wheel')
      return false
    }
  }
  await tiktokScrollSleepMsHaltable(shouldHalt, randomInt(1000, 1500))
  await tiktokScrollHaltIfNeeded(shouldHalt)

  let afterRoot = await resolvePrimaryFeedRoot(page)
  let after = await safeReadStableKeyFromInfo(page, afterRoot)
  log('PRIMARY_ROOT_AFTER', `source=${primaryRootSource(afterRoot)} found=${afterRoot != null} phase=wheel`)
  log('KEY_AFTER', after.slice(0, 240))
  if (tiktokStableKeyAdvanced(before, after)) {
    log('SCROLL_SUCCESS', 'true')
    await maybeScrollVisualScreenshot(page, log, 'after_scroll')
    return true
  }

  if (safePageClosed(page)) {
    log('PAGE_CLOSED_DURING_STOP', 'before_ArrowDown_fallback')
    return false
  }
  await tiktokScrollHaltIfNeeded(shouldHalt)
  const fallbackRoot = afterRoot ?? beforeRoot
  await moveMouseToRootCenter(page, fallbackRoot, log, 'before_arrow_fallback')
  log('SCROLL_KEYBOARD_ARROW', 'fallback=1')
  try {
    await page.keyboard.press('ArrowDown')
  } catch {
    if (safePageClosed(page)) {
      log('PAGE_CLOSED_DURING_STOP', 'during_ArrowDown_fallback')
      return false
    }
  }
  await tiktokScrollSleepMsHaltable(shouldHalt, 1200)
  await tiktokScrollHaltIfNeeded(shouldHalt)

  afterRoot = await resolvePrimaryFeedRoot(page)
  after = await safeReadStableKeyFromInfo(page, afterRoot)
  log('PRIMARY_ROOT_AFTER', `source=${primaryRootSource(afterRoot)} found=${afterRoot != null} phase=arrow_fallback`)
  log('KEY_AFTER', after.slice(0, 240))
  if (tiktokStableKeyAdvanced(before, after)) {
    log('SCROLL_SUCCESS', 'true')
    await maybeScrollVisualScreenshot(page, log, 'after_scroll')
    return true
  }

  log('SCROLL_SUCCESS', 'false')
  log('SCROLL_STUCK', 'stable_key_unchanged_after_mouse_wheel_and_single_ArrowDown')
  await maybeScrollVisualScreenshot(page, log, 'after_scroll')
  return false
}
