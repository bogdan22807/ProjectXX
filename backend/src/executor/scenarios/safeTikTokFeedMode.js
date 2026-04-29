/**
 * SAFE_TIKTOK_FEED_MODE scroll-only baseline.
 *
 * One iteration watches the current FYP video, then performs one simple wheel
 * movement over the viewport center. No other feed actions are performed here.
 */

import { randomInt, sleep } from '../asyncUtils.js'
import { ExecutorHaltError } from '../executorHalt.js'

const LIKE_DIAGNOSTICS_VERSION = 'safe-like-server-verify-2026-04-28'

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
 * @param {string} rawUrl
 */
function isTikTokLikeWriteUrl(rawUrl) {
  const url = String(rawUrl || '').toLowerCase()
  if (!url.includes('tiktok.com')) return false
  return /(?:digg|favorite|like|commit|aweme)/i.test(url)
}

/**
 * @param {URL} url
 */
function summarizeLikeQuery(url) {
  const keys = ['item_id', 'aweme_id', 'type', 'aid', 'app_name']
  const parts = []
  for (const key of keys) {
    const value = url.searchParams.get(key)
    if (value) parts.push(`${key}=${String(value).slice(0, 80)}`)
  }
  return parts.length > 0 ? parts.join(' ') : url.search ? 'query=1' : ''
}

/**
 * @param {unknown} value
 */
function safeJsonScalar(value) {
  if (value == null) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

/**
 * @param {unknown} json
 */
function summarizeLikeResponseJson(json) {
  if (!json || typeof json !== 'object') return ''
  const obj = /** @type {Record<string, unknown>} */ (json)
  const keys = [
    'status_code',
    'status_msg',
    'status',
    'message',
    'msg',
    'is_digg',
    'digg_status',
    'error_code',
    'error_msg',
    'verify_type',
    'captcha',
  ]
  const parts = []
  for (const key of keys) {
    const value = safeJsonScalar(obj[key])
    if (value !== '') parts.push(`${key}=${value}`)
  }
  const logPb = obj.log_pb && typeof obj.log_pb === 'object' ? /** @type {Record<string, unknown>} */ (obj.log_pb) : null
  const imprId = logPb ? safeJsonScalar(logPb.impr_id) : ''
  if (imprId) parts.push(`impr_id=${imprId.slice(0, 80)}`)
  return parts.join(' ')
}

/**
 * @param {import('playwright').Response} response
 */
async function summarizeLikeResponseBody(response) {
  const contentType = String((await response.headerValue('content-type').catch(() => '')) || '').toLowerCase()
  if (!contentType.includes('json') && !contentType.includes('javascript') && response.status() >= 300) return ''
  const raw = await response.text().catch(() => '')
  const trimmed = raw.trim()
  if (!trimmed) return ''
  try {
    const parsed = JSON.parse(trimmed)
    const summary = summarizeLikeResponseJson(parsed)
    if (summary) return summary
  } catch {
    /* fall through to short raw body */
  }
  return `body=${trimmed.replace(/\s+/g, ' ').slice(0, 180)}`
}

/**
 * @param {import('playwright').Page} page
 * @param {(action: string, details?: string) => void} log
 */
function startLikeNetworkProbe(page, log) {
  const seen = new Set()
  const pending = new Set()
  let matched = 0
  let invalidCsrf = false
  let acceptedLike = false
  let revertedLike = false
  let acceptedAwemeId = ''
  let lastBodySummary = ''

  const responseHandler = (response) => {
    const task = (async () => {
      try {
        const rawUrl = response.url()
        if (!isTikTokLikeWriteUrl(rawUrl)) return
        const url = new URL(rawUrl)
        const request = response.request()
        const query = summarizeLikeQuery(url)
        const bodySummary = await summarizeLikeResponseBody(response)
        if (/status_code=10402|invalid csrf token/i.test(bodySummary)) {
          invalidCsrf = true
        }
        if (/status_code=0\b/i.test(bodySummary) && /(?:is_digg|digg_status)=1\b/i.test(bodySummary)) {
          acceptedLike = true
          acceptedAwemeId = url.searchParams.get('aweme_id') || url.searchParams.get('item_id') || acceptedAwemeId
        }
        if (
          (url.searchParams.get('type') === '0' && response.status() < 400) ||
          (/status_code=0\b/i.test(bodySummary) && /(?:is_digg|digg_status)=0\b/i.test(bodySummary))
        ) {
          revertedLike = true
        }
        if (bodySummary) {
          lastBodySummary = bodySummary.slice(0, 240)
        }
        const detail = `${request.method()} ${response.status()} ${url.pathname}${query ? ` ${query}` : ''}${
          bodySummary ? ` body=${bodySummary}` : ''
        }`
        if (seen.has(detail)) return
        seen.add(detail)
        matched += 1
        log('LIKE_NETWORK_RESPONSE', detail.slice(0, 500))
      } catch {
        /* ignore network probe failures */
      }
    })()
    pending.add(task)
    task.finally(() => pending.delete(task)).catch(() => {})
  }

  const requestFailedHandler = (request) => {
    try {
      const rawUrl = request.url()
      if (!isTikTokLikeWriteUrl(rawUrl)) return
      const url = new URL(rawUrl)
      const failure = request.failure()?.errorText || 'request_failed'
      const detail = `${request.method()} FAILED ${url.pathname} error=${failure}`
      if (seen.has(detail)) return
      seen.add(detail)
      matched += 1
      log('LIKE_NETWORK_FAILED', detail.slice(0, 260))
    } catch {
      /* ignore network probe failures */
    }
  }

  page.on('response', responseHandler)
  page.on('requestfailed', requestFailedHandler)

  return async () => {
    page.off('response', responseHandler)
    page.off('requestfailed', requestFailedHandler)
    if (pending.size > 0) {
      await Promise.allSettled(Array.from(pending))
    }
    if (matched === 0) log('LIKE_NETWORK_RESPONSE', 'none_matched')
    return { invalidCsrf, acceptedLike, revertedLike, acceptedAwemeId, matched, lastBodySummary }
  }
}

/**
 * @param {unknown} json
 */
function summarizeItemDetailDiggState(json) {
  if (!json || typeof json !== 'object') return 'invalid_json'
  const root = /** @type {Record<string, unknown>} */ (json)
  const itemInfo = root.itemInfo && typeof root.itemInfo === 'object' ? /** @type {Record<string, unknown>} */ (root.itemInfo) : null
  const item =
    itemInfo?.itemStruct && typeof itemInfo.itemStruct === 'object'
      ? /** @type {Record<string, unknown>} */ (itemInfo.itemStruct)
      : null
  const authorStats = item?.stats && typeof item.stats === 'object' ? /** @type {Record<string, unknown>} */ (item.stats) : null
  const candidates = [
    ['statusCode', root.statusCode],
    ['status_code', root.status_code],
    ['statusMsg', root.statusMsg],
    ['status_msg', root.status_msg],
    ['item.digged', item?.digged],
    ['item.is_digg', item?.is_digg],
    ['item.digg_status', item?.digg_status],
    ['item.diggStatus', item?.diggStatus],
    ['item.liked', item?.liked],
    ['item.isLiked', item?.isLiked],
    ['stats.diggCount', authorStats?.diggCount],
  ]
  const parts = []
  for (const [key, value] of candidates) {
    const scalar = safeJsonScalar(value)
    if (scalar !== '') parts.push(`${key}=${scalar}`)
  }
  return parts.length > 0 ? parts.join(' ') : 'no_digg_fields'
}

/**
 * @param {string} summary
 */
function itemDetailShowsLiked(summary) {
  return /(?:item\.(?:digged|is_digg|digg_status|diggStatus|liked|isLiked))=(?:1|true)\b/i.test(summary)
}

/**
 * @param {import('playwright').Page} page
 * @param {string} awemeId
 * @param {(action: string, details?: string) => void} log
 */
async function verifyTikTokItemDetailLikeState(page, awemeId, log) {
  const id = String(awemeId || '').trim()
  if (!id) {
    log('LIKE_SERVER_VERIFY_SKIPPED', 'missing_aweme_id')
    return { checked: false, liked: false, summary: 'missing_aweme_id' }
  }

  const result = await page
    .evaluate(async (itemId) => {
      const url = new URL('/api/item/detail/', window.location.origin)
      url.searchParams.set('itemId', itemId)
      url.searchParams.set('aid', '1988')
      url.searchParams.set('app_name', 'tiktok_web')
      const response = await fetch(url.toString(), {
        credentials: 'include',
        headers: {
          accept: 'application/json, text/plain, */*',
        },
      })
      const text = await response.text()
      return {
        ok: response.ok,
        status: response.status,
        body: text.slice(0, 12000),
      }
    }, id)
    .catch((err) => ({
      ok: false,
      status: 0,
      body: `fetch_failed ${err instanceof Error ? err.message : String(err)}`,
    }))

  let summary = ''
  try {
    summary = summarizeItemDetailDiggState(JSON.parse(result.body))
  } catch {
    summary = `body=${String(result.body || '').replace(/\s+/g, ' ').slice(0, 220)}`
  }
  const liked = result.ok && itemDetailShowsLiked(summary)
  log('LIKE_SERVER_VERIFY', `aweme_id=${id} http=${result.status} liked=${liked ? 1 : 0} ${summary}`.slice(0, 500))
  return { checked: true, liked, summary }
}

/**
 * @param {import('playwright').Page} page
 * @param {(action: string, details?: string) => void} log
 * @param {string} phase
 */
async function logTikTokCsrfCookieState(page, log, phase) {
  try {
    log('TIKTOK_CSRF_COOKIE_STATE', `phase=${phase} ${await readTikTokCsrfCookieSummary(page)}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log('TIKTOK_CSRF_COOKIE_STATE', `phase=${phase} read_failed ${msg.slice(0, 160)}`)
  }
}

/**
 * @param {import('playwright').Page} page
 */
async function readTikTokCsrfCookieSummary(page) {
  try {
    const cookies = await page.context().cookies(['https://www.tiktok.com', 'https://www.tiktok.com/foryou'])
    const csrfCookies = cookies.filter((cookie) => /csrf/i.test(cookie.name))
    if (csrfCookies.length === 0) return 'count=0'
    return `count=${csrfCookies.length} ${csrfCookies
      .map((cookie) => `${cookie.name}:len=${String(cookie.value || '').length}`)
      .join(',')
      .slice(0, 220)}`
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return `read_failed ${msg.slice(0, 160)}`
  }
}

/**
 * @param {import('playwright').Page} page
 * @param {(action: string, details?: string) => void} log
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 */
async function refreshTikTokCsrfSession(page, log, shouldHalt) {
  log('TIKTOK_CSRF_REFRESH_START', 'clearing csrf cookies and reloading /foryou')
  try {
    await logTikTokCsrfCookieState(page, log, 'before_refresh')
    const context = page.context()
    const cookies = await context.cookies(['https://www.tiktok.com', 'https://www.tiktok.com/foryou']).catch(() => [])
    const csrfNames = Array.from(new Set(cookies.map((cookie) => cookie.name).filter((name) => /csrf/i.test(name))))
    if (csrfNames.length > 0) {
      for (const name of csrfNames) {
        await context.clearCookies({ name }).catch(() => {})
      }
      log('TIKTOK_CSRF_COOKIES_CLEARED', csrfNames.join(',').slice(0, 220))
    } else {
      await context.clearCookies({ name: /csrf/i }).catch(() => {})
      log('TIKTOK_CSRF_COOKIES_CLEARED', 'no named csrf cookies found')
    }
    await haltIfNeeded(shouldHalt)
    await page.goto('https://www.tiktok.com/foryou', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await sleepMsHaltable(shouldHalt, randomInt(2500, 4500))
    await logTikTokCsrfCookieState(page, log, 'after_refresh')
    log('TIKTOK_CSRF_REFRESH_DONE', 'reloaded /foryou after csrf reset')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log('TIKTOK_CSRF_REFRESH_FAILED', msg.slice(0, 240))
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
  const durationMs = randomInt(12_000, 35_000)
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
 * @param {import('playwright').Locator} article
 * @param {import('playwright').Locator} button
 * @param {(action: string, details?: string) => void} log
 * @param {string} phase
 */
async function logLikeDomCheckpoint(article, button, log, phase) {
  const state = await readLikeStateInArticle(article, button)
  log(
    'LIKE_DOM_CHECKPOINT',
    `phase=${phase} active=${likeStateActive(state) ? 1 : 0} detail=${state.detail || 'unknown'}`.slice(0, 260),
  )
  return state
}

/**
 * After TikTok API accepts a like, keep the card in place long enough to tell
 * whether a visible rollback is a later network action or only DOM resync.
 * @param {import('playwright').Page} page
 * @param {import('playwright').Locator} article
 * @param {import('playwright').Locator} button
 * @param {(action: string, details?: string) => void} log
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 */
async function observeAcceptedLikePersistence(page, article, button, log, shouldHalt) {
  const stopPostAcceptProbe = startLikeNetworkProbe(page, log)
  let finalState = null
  try {
    finalState = await logLikeDomCheckpoint(article, button, log, 'accepted_0s')
    const checkpoints = [
      ['accepted_2s', 2000],
      ['accepted_5s', 3000],
      ['accepted_10s', 5000],
    ]
    for (const [phase, delayMs] of checkpoints) {
      await sleepMsHaltable(shouldHalt, delayMs)
      finalState = await logLikeDomCheckpoint(article, button, log, phase)
    }
  } finally {
    const postProbe = await stopPostAcceptProbe()
    log(
      'LIKE_POST_ACCEPT_NETWORK_SUMMARY',
      `matched=${postProbe.matched} accepted=${postProbe.acceptedLike ? 1 : 0} reverted=${postProbe.revertedLike ? 1 : 0} invalidCsrf=${
        postProbe.invalidCsrf ? 1 : 0
      } last=${postProbe.lastBodySummary || 'none'}`.slice(0, 500),
    )
    if (postProbe.revertedLike) {
      log('LIKE_PERSISTENCE_WARNING', 'network_reverted_after_accept')
    } else if (finalState && !likeStateActive(finalState)) {
      log('LIKE_PERSISTENCE_WARNING', `dom_inactive_after_network_accept detail=${finalState.detail || 'inactive'}`)
    } else if (finalState) {
      log('LIKE_PERSISTENCE_OK', `dom_active_after_network_accept detail=${finalState.detail || 'active'}`)
    }
  }
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

  const threshold = randomInt(7, 10) // P(like) = threshold% on this beat
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

  const csrfBefore = await readTikTokCsrfCookieSummary(page)
  log('LIKE_CSRF_STATE_BEFORE', csrfBefore)
  const stopNetworkProbe = startLikeNetworkProbe(page, log)
  let probeResult = { invalidCsrf: false, acceptedLike: false, matched: 0, lastBodySummary: '' }
  let confirmed = null
  try {
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
    confirmed = likeConfirmed(beforeState, earlyState, afterState)
  } finally {
    probeResult = await stopNetworkProbe()
  }
  log(
    'LIKE_NETWORK_SUMMARY',
    `matched=${probeResult.matched} accepted=${probeResult.acceptedLike ? 1 : 0} reverted=${probeResult.revertedLike ? 1 : 0} invalidCsrf=${
      probeResult.invalidCsrf ? 1 : 0
    } last=${probeResult.lastBodySummary || 'none'}`.slice(
      0,
      500,
    ),
  )
  if (probeResult.invalidCsrf) {
    log('LIKE_NOT_CONFIRMED', 'reason=invalid_csrf_token')
    log('LIKE_RESULT', 'outcome=invalid_csrf action=refresh_session')
    await refreshTikTokCsrfSession(page, log, shouldHalt)
    return
  }
  if (probeResult.acceptedLike) {
    await observeAcceptedLikePersistence(page, article, button, log, shouldHalt)
    const serverVerify = await verifyTikTokItemDetailLikeState(page, probeResult.acceptedAwemeId, log)
    if (serverVerify.checked && serverVerify.liked) {
      log('LIKE_CONFIRMED', 'reason=server_item_detail_liked')
      log('LIKE_RESULT', 'outcome=confirmed source=server_item_detail')
    } else if (serverVerify.checked) {
      log('LIKE_NOT_CONFIRMED', 'reason=server_item_detail_not_liked')
      log('LIKE_RESULT', `outcome=not_confirmed source=server_item_detail summary=${serverVerify.summary}`.slice(0, 500))
    } else {
      log('LIKE_CONFIRMED', 'reason=network_accepted status_code=0 is_digg=1 server_verify_unavailable')
      log('LIKE_RESULT', 'outcome=confirmed source=network_commit_only server_verify=unavailable')
    }
    return
  }
  if (confirmed?.ok) {
    log('LIKE_CONFIRMED', `reason=${confirmed.reason}`)
    log('LIKE_RESULT', `outcome=confirmed source=dom reason=${confirmed.reason}`.slice(0, 500))
  } else {
    log('LIKE_NOT_CONFIRMED', `reason=${confirmed?.reason || 'state_not_active'}`)
    log(
      'LIKE_RESULT',
      `outcome=not_confirmed source=${probeResult.matched > 0 ? 'network_without_accept' : 'dom_no_network'} reason=${
        confirmed?.reason || 'state_not_active'
      }`.slice(0, 500),
    )
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

  if (iteration === 1) {
    log('LIKE_DIAGNOSTICS_VERSION', LIKE_DIAGNOSTICS_VERSION)
  }

  try {
    if (page.isClosed()) {
      log('PAGE_CLOSED_DURING_STOP', 'iteration_start')
      throw new ExecutorHaltError('stop')
    }
  } catch {
    log('PAGE_CLOSED_DURING_STOP', 'iteration_start')
    throw new ExecutorHaltError('stop')
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
