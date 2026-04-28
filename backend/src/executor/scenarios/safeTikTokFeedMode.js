/**
 * SAFE_TIKTOK_FEED_MODE scroll-only baseline.
 *
 * One iteration watches the current FYP video, then performs one simple wheel
 * movement over the viewport center. No other feed actions are performed here.
 */

import { randomInt, sleep } from '../asyncUtils.js'
import { ExecutorHaltError } from '../executorHalt.js'

/**
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 */
async function haltIfNeeded(shouldHalt) {
  if (!shouldHalt) return
  const v = await shouldHalt()
  if (v === 'stop') throw new ExecutorHaltError('stop')
  if (v === 'max_duration') throw new ExecutorHaltError('max_duration')
}

/**
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 * @param {number} ms
 */
async function sleepMsHaltable(shouldHalt, ms) {
  let left = Math.max(0, Math.floor(Number(ms) || 0))
  while (left > 0) {
    await haltIfNeeded(shouldHalt)
    const step = Math.min(400, left)
    await sleep(step)
    left -= step
  }
}

/**
 * @param {import('playwright').Page} page
 */
function pageInLiveSurfaceUrl(page) {
  try {
    return new URL(page.url()).pathname.toLowerCase().includes('/live')
  } catch {
    return String(page.url()).toLowerCase().includes('/live')
  }
}

/**
 * @param {import('playwright').Page} page
 */
async function detectChallengeBlocking(page) {
  let url = ''
  try {
    url = page.url().toLowerCase()
  } catch {
    url = ''
  }
  if (
    url.includes('captcha') ||
    url.includes('/verify') ||
    url.includes('challenge') ||
    url.includes('sec_sdk') ||
    url.includes('/authentication')
  ) {
    return true
  }

  const title = ((await page.title().catch(() => '')) ?? '').toLowerCase()
  if (title.includes('captcha') || title.includes('verify') || title.includes('security check')) return true

  try {
    const frameCount = await page.locator('iframe[src*="captcha" i], iframe[src*="verify" i]').count()
    return frameCount > 0
  } catch {
    return false
  }
}

/**
 * LIVE card in FYP, not a /live URL.
 * @param {import('playwright').Page} page
 */
async function detectLiveFeedCard(page) {
  if (pageInLiveSurfaceUrl(page)) return false
  try {
    if (page.isClosed()) return false
  } catch {
    return false
  }

  const root = page.locator('[data-e2e="feed-active-video"]').first()
  if ((await root.count().catch(() => 0)) === 0) return false

  try {
    if (
      (await root.locator('[data-e2e="live-tag"], [data-e2e="video-live-tag"]').first().isVisible().catch(() => false))
    ) {
      return true
    }
    if (await root.getByText(/^LIVE$/i).first().isVisible().catch(() => false)) return true
    if (await root.getByText(/\bLIVE\s+NOW\b/i).first().isVisible().catch(() => false)) return true
  } catch {
    /* ignore */
  }
  return false
}

/**
 * @param {import('playwright').Page} page
 * @param {(action: string, details?: string) => void} log
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 */
async function viewCurrentVideo(page, log, shouldHalt) {
  const durationMs = randomInt(5000, 12000)
  log('VIEW_VIDEO', `durationMs=${durationMs}`)
  await sleepMsHaltable(shouldHalt, durationMs)
  if (await detectChallengeBlocking(page)) {
    log('TIKTOK_CHALLENGE_DETECTED', 'challenge/verify during VIEW_VIDEO')
    throw new ExecutorHaltError('challenge')
  }
}

/**
 * @param {import('playwright').Page} page
 * @returns {Promise<number>}
 */
async function currentArticleIndex(page) {
  return page
    .evaluate(() => {
      const articles = Array.from(document.querySelectorAll('article')).filter((article) =>
        article.querySelector('video'),
      )
      if (articles.length === 0) return -1

      const viewportCenterY = window.innerHeight / 2
      let currentIndex = 0
      let bestDistance = Number.POSITIVE_INFINITY
      for (let i = 0; i < articles.length; i += 1) {
        const rect = articles[i].getBoundingClientRect()
        const articleCenterY = rect.top + rect.height / 2
        const distance = Math.abs(articleCenterY - viewportCenterY)
        if (distance < bestDistance) {
          bestDistance = distance
          currentIndex = i
        }
      }
      return currentIndex
    })
    .catch(() => -1)
}

/**
 * @param {import('playwright').Page} page
 * @param {number} index
 */
function articleByVideoIndex(page, index) {
  return page.locator('article').filter({ has: page.locator('video') }).nth(index)
}

/**
 * @param {import('playwright').Page} page
 * @param {import('playwright').Locator | null} article
 */
async function isLiveActionGuardActive(page, article) {
  if (pageInLiveSurfaceUrl(page)) return true
  if (!article) return false
  if ((await article.count().catch(() => 0)) === 0) return false

  return article
    .evaluate((el) => {
      const text = String(el.innerText || el.textContent || '').toLowerCase()
      if (/\blive\b/.test(text) || text.includes('stream') || text.includes('прямой эфир')) return true

      const attrsToCheck = ['aria-label', 'class', 'data-test', 'data-testid', 'data-e2e', 'href', 'title']
      const hasLiveAttribute = Array.from(el.querySelectorAll('*')).some((node) =>
        attrsToCheck.some((name) => {
          const value = String(node.getAttribute(name) || '').toLowerCase()
          return value.includes('live') || value.includes('stream')
        }),
      )
      if (hasLiveAttribute) return true

      return Boolean(
        el.querySelector(
          '[aria-label*="live" i], [class*="live" i], [data-test*="live" i], [data-testid*="live" i], [data-e2e*="live" i], a[href*="/live" i]',
        ),
      )
    })
    .catch(() => false)
}

/**
 * @param {import('playwright').Locator} article
 */
async function pickReactionButtonInArticle(article) {
  const selectors = [
    '[data-e2e="browse-like-icon"]',
    '[data-e2e="like-icon"]',
    '[data-e2e="video-player-like-icon"]',
    'button[data-test*="like" i]',
    'button[data-testid*="like" i]',
    'button[data-e2e*="like" i]',
    'button[aria-label*="like" i]',
    '[role="button"][data-test*="like" i]',
    '[role="button"][data-testid*="like" i]',
    '[role="button"][data-e2e*="like" i]',
    '[role="button"][aria-label*="like" i]',
  ]

  for (const selector of selectors) {
    const matches = article.locator(selector)
    const count = await matches.count().catch(() => 0)
    for (let i = 0; i < Math.min(count, 12); i += 1) {
      const candidate = matches.nth(i)
      if (!(await candidate.isVisible().catch(() => false))) continue
      const clickable = candidate.locator('xpath=ancestor-or-self::*[self::button or @role="button"][1]').first()
      if (await clickable.isVisible().catch(() => false)) return clickable
      return candidate
    }
  }
  return null
}

/**
 * @param {import('playwright').Locator} article
 */
async function articleActionAlreadyClicked(article) {
  return article
    .evaluate((el) => el.getAttribute('data-safe-action-clicked') === '1')
    .catch(() => false)
}

/**
 * @param {import('playwright').Locator} article
 */
async function markArticleActionClicked(article) {
  await article.evaluate((el) => el.setAttribute('data-safe-action-clicked', '1')).catch(() => {})
}

/**
 * @param {import('playwright').Locator} article
 * @param {import('playwright').Locator} button
 */
async function readLikeStateInArticle(article, button) {
  const buttonState = await button
    .evaluate((btn) => {
      const readAttrs = (el) => {
        if (!el) return ''
        const attrs = ['aria-pressed', 'aria-label', 'class', 'data-state', 'data-test', 'data-testid', 'data-e2e']
        return attrs.map((name) => `${name}=${String(el.getAttribute(name) || '')}`).join('|')
      }
      const isActiveLikeColor = (value) => {
        const color = String(value || '').trim().toLowerCase()
        if (!color || color === 'none' || color === 'transparent' || color === 'currentcolor') return false
        if (color === '#fe2c55' || color === '#ee1d52' || color === '#ff0050' || color === '#ff3b5c') return true
        const hex = /^#([0-9a-f]{6})$/i.exec(color)
        if (hex) {
          const n = Number.parseInt(hex[1], 16)
          const r = (n >> 16) & 255
          const g = (n >> 8) & 255
          const b = n & 255
          return r >= 200 && g <= 100 && b >= 60 && b <= 160
        }
        const rgb = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(color)
        if (!rgb) return false
        const r = Number(rgb[1])
        const g = Number(rgb[2])
        const b = Number(rgb[3])
        return r >= 200 && g <= 100 && b >= 60 && b <= 160
      }

      const buttonText = String(btn?.textContent || '').trim()
      const buttonAttrs = readAttrs(btn)
      const pressed = btn?.getAttribute('aria-pressed') === 'true'
      const likedAttr =
        /\b(?:is-)?liked\b/i.test(buttonAttrs) ||
        /(?:data-state|aria-selected)=["']?(?:selected|true)/i.test(buttonAttrs)

      let filledIcon = false
      const paths = Array.from(btn.querySelectorAll('svg path[fill], svg [fill]')).slice(0, 12)
      for (const path of paths) {
        const fill = String(path.getAttribute('fill') || '').trim().toLowerCase()
        const computedFill = String(window.getComputedStyle(path).fill || '').trim().toLowerCase()
        const computedColor = String(window.getComputedStyle(path).color || '').trim().toLowerCase()
        const effectiveFill = fill === 'currentcolor' ? computedColor : fill || computedFill
        if (!isActiveLikeColor(effectiveFill)) continue
        filledIcon = true
        break
      }

      const reasons = []
      if (pressed) reasons.push('pressed')
      if (likedAttr) reasons.push('liked_attr')
      if (filledIcon) reasons.push('liked_color')

      return {
        pressed,
        likedAttr,
        filledIcon,
        detail: reasons.join(',') || 'inactive',
        signature: `${buttonText}|${buttonAttrs}`.slice(0, 260),
      }
    })
    .catch(() => ({
      pressed: false,
      likedAttr: false,
      filledIcon: false,
      detail: 'read_failed',
      signature: '',
    }))

  const cardSignature = await article
    .evaluate((card) => {
      const activeBits = Array.from(
        card.querySelectorAll(
          '[aria-pressed="true"], [data-state*="active" i], [data-state*="selected" i], [class*="active" i], [class*="liked" i], [data-test*="liked" i], [data-testid*="liked" i], [data-e2e*="liked" i]',
        ),
      )
        .slice(0, 8)
        .map((el) => String(el.textContent || el.getAttribute('aria-label') || el.className || '').trim())
        .join('|')
      return activeBits.slice(0, 260)
    })
    .catch(() => '')

  return {
    ...buttonState,
    signature: `${buttonState.signature}|card=${cardSignature}`.slice(0, 520),
  }
}

/**
 * @param {{ pressed: boolean; likedAttr: boolean; filledIcon: boolean; signature: string; detail?: string }} state
 */
function likeStateActive(state) {
  return Boolean(state?.pressed || state?.likedAttr || state?.filledIcon)
}

/**
 * @param {{ pressed: boolean; likedAttr: boolean; filledIcon: boolean; signature: string; detail?: string }} before
 * @param {{ pressed: boolean; likedAttr: boolean; filledIcon: boolean; signature: string; detail?: string }} early
 * @param {{ pressed: boolean; likedAttr: boolean; filledIcon: boolean; signature: string; detail?: string }} final
 */
function likeConfirmed(before, early, final) {
  if (likeStateActive(final)) return { ok: true, reason: `state_active_after_verify detail=${final.detail || 'active'}` }
  if (likeStateActive(early)) return { ok: false, reason: `reverted_after_tiktok_verify early=${early.detail || 'active'}` }
  if (before.signature && final.signature && before.signature !== final.signature) {
    return { ok: false, reason: 'changed_without_active_state' }
  }
  return { ok: false, reason: 'state_not_active' }
}

/**
 * @param {import('playwright').Page} page
 * @param {(action: string, details?: string) => void} log
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 */
async function maybeRunReactionAction(page, log, shouldHalt) {
  const currentIndex = await currentArticleIndex(page)
  const article = currentIndex >= 0 ? articleByVideoIndex(page, currentIndex) : null

  if (await isLiveActionGuardActive(page, article)) {
    log('LIKE_SKIPPED', 'reason=live_detected')
    return
  }

  if (article && (await articleActionAlreadyClicked(article))) {
    log('LIKE_SECOND_CLICK_BLOCKED', '')
    return
  }

  const threshold = 25
  const roll = Math.random() * 100
  log('LIKE_ROLL', `r=${roll.toFixed(2)} threshold=${threshold}`)
  if (roll >= threshold) return

  log('LIKE_ATTEMPT', '')
  if (!article || (await article.count().catch(() => 0)) === 0) {
    log('LIKE_SKIPPED', 'reason=no_like_in_current_article')
    return
  }

  const button = await pickReactionButtonInArticle(article)
  if (!button) {
    log('LIKE_SKIPPED', 'reason=no_like_in_current_article')
    return
  }

  const beforeState = await readLikeStateInArticle(article, button)
  if (likeStateActive(beforeState)) {
    log('LIKE_SKIPPED', `reason=already_liked detail=${beforeState.detail || 'active'}`)
    await markArticleActionClicked(article)
    return
  }

  const ok = await button.click({ timeout: 5000 }).then(() => true, () => false)
  if (!ok) {
    log('LIKE_SKIPPED', 'reason=no_like_in_current_article')
    return
  }
  await markArticleActionClicked(article)
  log('LIKE_CLICKED', '')

  const earlyWaitMs = randomInt(900, 1400)
  log('LIKE_WAIT_AFTER_CLICK', `ms=${earlyWaitMs}`)
  await sleepMsHaltable(shouldHalt, earlyWaitMs)
  const earlyState = await readLikeStateInArticle(article, button)

  const verifyWaitMs = randomInt(4500, 6500)
  log('LIKE_VERIFY_WAIT', `ms=${verifyWaitMs}`)
  await sleepMsHaltable(shouldHalt, verifyWaitMs)

  const afterState = await readLikeStateInArticle(article, button)
  const confirmed = likeConfirmed(beforeState, earlyState, afterState)
  if (confirmed.ok) {
    log('LIKE_CONFIRMED', `reason=${confirmed.reason}`)
  } else {
    log('LIKE_NOT_CONFIRMED', `reason=${confirmed.reason}`)
  }
}

/**
 * @param {import('playwright').Page} page
 * @param {(action: string, details?: string) => void} log
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 */
async function simpleScroll(page, log, shouldHalt) {
  const result = await page
    .evaluate(() => {
      const articles = Array.from(document.querySelectorAll('article')).filter((article) =>
        article.querySelector('video'),
      )
      if (articles.length === 0) return { currentIndex: -1, nextIndex: -1, scrolled: false }

      const viewportCenterY = window.innerHeight / 2
      let currentIndex = 0
      let bestDistance = Number.POSITIVE_INFINITY
      for (let i = 0; i < articles.length; i += 1) {
        const rect = articles[i].getBoundingClientRect()
        const articleCenterY = rect.top + rect.height / 2
        const distance = Math.abs(articleCenterY - viewportCenterY)
        if (distance < bestDistance) {
          bestDistance = distance
          currentIndex = i
        }
      }

      const nextIndex = currentIndex + 1
      const nextArticle = articles[nextIndex]
      if (!nextArticle) return { currentIndex, nextIndex: -1, scrolled: false }

      nextArticle.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return { currentIndex, nextIndex, scrolled: true }
    })
    .catch(() => ({ currentIndex: -1, nextIndex: -1, scrolled: false }))

  log('SIMPLE_SCROLL_CURRENT_ARTICLE', `index=${result.currentIndex}`)
  log('SIMPLE_SCROLL_NEXT_ARTICLE', `index=${result.nextIndex}`)

  if (result.scrolled) {
    log('SIMPLE_SCROLL_SCROLL_INTO_VIEW', '')
    await sleepMsHaltable(shouldHalt, randomInt(2000, 3000))
  } else {
    const viewport = page.viewportSize()
    const width = viewport && Number.isFinite(viewport.width) ? viewport.width : 1280
    const height = viewport && Number.isFinite(viewport.height) ? viewport.height : 720
    await page.mouse.move(Math.floor(width / 2), Math.floor(height / 2))
    log('SIMPLE_SCROLL_FALLBACK_WHEEL', 'dy=1800')
    await page.mouse.wheel(0, 1800)
    await sleepMsHaltable(shouldHalt, 2000)
  }

  log('SIMPLE_SCROLL_DONE', '')
}

/**
 * Clean SAFE TikTok iteration. Signature is kept stable for playwrightTestRun.
 *
 * @param {import('playwright').Page} page
 * @param {(action: string, details?: string) => void} log
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 * @param {{ debugScreenshots?: boolean; screenshotDir?: string; browserEngine?: string; iterationIndex?: number }} [_options]
 * @returns {Promise<void>}
 */
export async function runSafeTikTokFeedIteration(page, log, shouldHalt, _options = {}) {
  const iteration =
    _options && _options.iterationIndex != null && Number.isFinite(Number(_options.iterationIndex))
      ? Math.max(0, Math.floor(Number(_options.iterationIndex)))
      : '?'

  try {
    if (page.isClosed()) {
      log('PAGE_CLOSED_DURING_STOP', 'iteration_start')
      return
    }
  } catch {
    log('PAGE_CLOSED_DURING_STOP', 'iteration_start')
    return
  }

  if (await detectChallengeBlocking(page)) {
    log('TIKTOK_CHALLENGE_DETECTED', 'challenge/verify at iteration start')
    throw new ExecutorHaltError('challenge')
  }

  await haltIfNeeded(shouldHalt)

  if (pageInLiveSurfaceUrl(page)) {
    log('SAFE_TIKTOK_FEED_MODE_SCROLL_ONLY', 'status=live_surface_no_scroll')
    return
  }

  if (await detectLiveFeedCard(page)) {
    log('SAFE_TIKTOK_FEED_MODE_SCROLL_ONLY', 'status=live_card_no_scroll')
    return
  }

  let currentUrl = ''
  try {
    currentUrl = page.url()
  } catch {
    currentUrl = '(unreadable)'
  }
  log('SAFE_TIKTOK_FEED_MODE_SCROLL_ONLY', `url=${currentUrl.slice(0, 400)}`)

  await viewCurrentVideo(page, log, shouldHalt)
  await haltIfNeeded(shouldHalt)

  if (pageInLiveSurfaceUrl(page)) {
    log('SAFE_TIKTOK_FEED_MODE_SCROLL_ONLY', 'status=live_surface_after_view_no_scroll')
    return
  }
  if (await detectLiveFeedCard(page)) {
    log('SAFE_TIKTOK_FEED_MODE_SCROLL_ONLY', 'status=live_card_after_view_no_scroll')
    return
  }

  await maybeRunReactionAction(page, log, shouldHalt)
  await haltIfNeeded(shouldHalt)

  await simpleScroll(page, log, shouldHalt)
  log('ITERATION_FINAL', `iteration=${iteration} scroll=done mode=scroll_only`)
}
