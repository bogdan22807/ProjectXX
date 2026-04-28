/**
 * One "human" iteration on TikTok FYP: watch → keyboard scroll (feed-focused) → optional video center-click.
 * TikTok human loop: **only downward** navigation — no `page.goto` / reload / `goBack` in feed recovery; `/live` exits
 * with Escape + keyboard/PageDown only. Optional `TIKTOK_EMERGENCY_GOTO=1` enables last-resort `goto` (off by default).
 *
 * Captcha/verify: we pause and log so you can solve manually; we do not auto-solve.
 */

import fs from 'node:fs'
import path from 'node:path'
import { interruptibleRandomDelay, randomChance, randomInt, sleep } from '../asyncUtils.js'
import { ExecutorHaltError } from '../executorHalt.js'
import { runPostLiveHardScrollSequence } from './postLiveHardScroll.js'
import { tiktokLiveSkipWheelPair, tiktokStrongScrollWithRecovery } from './tiktokStrongFeedScroll.js'

function emergencyGotoEnabled() {
  return String(process.env.TIKTOK_EMERGENCY_GOTO ?? '').trim() === '1'
}

/** After FYP LIVE skip: suppress CLICK_VIDEO / OPEN_PROFILE / LIKE for this many iterations. */
let skipClickProfileAfterLive = 0

function bumpSkipClickProfileAfterLive(n) {
  const k = Number(n)
  if (!Number.isFinite(k) || k < 1) return
  skipClickProfileAfterLive = Math.max(skipClickProfileAfterLive, Math.floor(k))
}

/** Consecutive same-card detection (anti stuck / LIVE ping-pong). */
let lastFeedStableKey = ''
let feedRepeatStreak = 0

/** Consecutive iterations that chose the linger branch (30% random). At 2, next iteration forces scroll. */
let consecutiveLingerStreak = 0

function defaultScreenshotDir() {
  return path.join(process.cwd(), 'playwright-debug')
}

/**
 * @param {import('playwright').Page} page
 * @param {boolean} enabled
 * @param {string} [dir]
 * @param {string} filename
 */
async function maybeLiveDebugScreenshot(page, enabled, dir, filename) {
  if (!enabled) return
  const d = String(dir ?? '').trim() || defaultScreenshotDir()
  try {
    fs.mkdirSync(d, { recursive: true })
    await page.screenshot({ path: path.join(d, filename), fullPage: false }).catch(() => {})
  } catch {
    /* ignore */
  }
}

/** Max total wait for user to clear captcha/verify (ms). */
function challengeWaitBudgetMs() {
  const n = Number(process.env.TIKTOK_CHALLENGE_WAIT_MS)
  return Number.isFinite(n) && n > 0 ? Math.min(n, 600_000) : 180_000
}

/** Profile peek probability 0–100; default 0 (avatar/sidebar conflicts). Set e.g. TIKTOK_PROFILE_PEEK_PERCENT=5 */
function profilePeekPercent() {
  const n = Number(process.env.TIKTOK_PROFILE_PEEK_PERCENT)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.min(100, n)
}

/** Like attempt probability per iteration (0–10, float ok). Default ~1.5% (between 1 and 2). Env: TIKTOK_LIKE_PERCENT */
function shouldTryLike() {
  const raw = process.env.TIKTOK_LIKE_PERCENT
  let pct = 1.5
  if (raw != null && String(raw).trim() !== '') {
    const n = Number(raw)
    if (Number.isFinite(n) && n > 0) pct = Math.min(n, 10)
  }
  return Math.random() * 100 < pct
}

/**
 * TikTok often keeps the FYP URL while showing a captcha overlay — detect via DOM/title too.
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>}
 */
async function detectChallengeDom(page) {
  try {
    const ti = ((await page.title().catch(() => '')) ?? '').toLowerCase()
    if (
      ti.includes('captcha') ||
      ti.includes('verify') ||
      ti.includes('security check') ||
      ti.includes('robot')
    ) {
      return true
    }
  } catch {
    /* ignore */
  }
  const hints = [
    'iframe[src*="captcha" i]',
    'iframe[src*="verify" i]',
    'iframe[src*="challenge" i]',
    '[class*="captcha" i]',
    '[id*="captcha" i]',
    '[class*="Captcha" i]',
    '[data-testid*="captcha" i]',
    'text=/\\bcaptcha\\b/i',
    'text=/security check/i',
    'text=/verify you are human/i',
    'text=/slide to verify/i',
    'text=/drag.*puzzle/i',
  ]
  for (const sel of hints) {
    const loc = page.locator(sel).first()
    if (await loc.isVisible().catch(() => false)) return true
  }
  return false
}

/**
 * @param {import('playwright').Page} page
 * @returns {Promise<'challenge' | 'login' | null>}
 */
async function detectBlockingFlow(page) {
  const u = page.url().toLowerCase()
  if (u.includes('/login') || u.includes('signup')) return 'login'
  if (
    u.includes('captcha') ||
    u.includes('/verify') ||
    u.includes('challenge') ||
    u.includes('sec_sdk') ||
    u.includes('/authentication')
  ) {
    return 'challenge'
  }
  try {
    const n = await page.locator('iframe[src*="captcha" i], iframe[src*="verify" i]').count()
    if (n > 0) return 'challenge'
  } catch {
    /* ignore */
  }
  if (await detectChallengeDom(page)) return 'challenge'
  return null
}

/**
 * Dedicated live stream page (not the same as a LIVE badge on a For You card).
 * @param {import('playwright').Page} page
 */
function pageInLiveRoomUrl(page) {
  try {
    const p = new URL(page.url()).pathname.toLowerCase()
    return p.includes('/live')
  } catch {
    return String(page.url()).toLowerCase().includes('/live')
  }
}

/**
 * Scroll past LIVE/stream without clicking or hovering the video (keyboard only).
 * @param {import('playwright').Page} page
 * @param {(action: string, details?: string) => void} log
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 * @param {string} reason short tag for log details
 * @param {{ pressesMin?: number; pressesMax?: number; pageDowns?: number; skipInternalScrollLog?: boolean }} [opts]
 */
async function scrollPastLiveNoPointer(page, log, shouldHalt, reason, opts = {}) {
  const pMin = Number(opts.pressesMin)
  const pMax = Number(opts.pressesMax)
  const min = Number.isFinite(pMin) && pMin > 0 ? pMin : 6
  const max = Number.isFinite(pMax) && pMax >= min ? pMax : 11
  const n = randomInt(min, max)
  for (let i = 0; i < n; i++) {
    await haltIfNeeded(shouldHalt)
    await page.keyboard.press('ArrowDown')
    await sleep(65 + randomInt(0, 95))
  }
  const pd = Math.min(5, Math.max(1, Math.floor(Number(opts.pageDowns)) || 2))
  for (let j = 0; j < pd; j++) {
    await page.keyboard.press('PageDown').catch(() => {})
  }
  if (!opts.skipInternalScrollLog) {
    log('SCROLL', `live-skip keyboard-only reason=${reason} ArrowDown×${n}+PageDown×${pd}`)
  }
}

/**
 * Leave full-page `/live` URL: **no goBack, no goto, no reload** — Escape + aggressive down-only keyboard/PageDown.
 * If still stuck: `LIVE_HARD_STUCK`. Optional `TIKTOK_EMERGENCY_GOTO=1` enables one emergency `goto` /foryou.
 * @param {import('playwright').Page} page
 * @param {(action: string, details?: string) => void} log
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 */
async function recoverFromLiveSurface(page, log, shouldHalt) {
  const before = page.url()
  if (!pageInLiveRoomUrl(page)) return false

  log('TIKTOK_LIVE_DETECTED', before.slice(0, 280))

  await page.keyboard.press('Escape').catch(() => {})
  await interruptibleRandomDelay(400, 900, shouldHalt)
  if (!pageInLiveRoomUrl(page)) {
    log('TIKTOK_LIVE_EXIT', `after Escape url=${page.url().slice(0, 200)}`)
    bumpSkipClickProfileAfterLive(2)
    return true
  }

  for (let wave = 0; wave < 8 && pageInLiveRoomUrl(page); wave++) {
    await scrollPastLiveNoPointer(page, log, shouldHalt, 'exit_live_room_down', {
      pressesMin: 16,
      pressesMax: 24,
      pageDowns: 4,
    })
    await interruptibleRandomDelay(400, 800, shouldHalt)
  }

  if (!pageInLiveRoomUrl(page)) {
    log('TIKTOK_LIVE_EXIT', `after keyboard-only url=${page.url().slice(0, 200)}`)
    bumpSkipClickProfileAfterLive(2)
    return true
  }

  log('LIVE_HARD_STUCK', 'still on /live after down-only recovery — no goto/reload by default')
  if (emergencyGotoEnabled()) {
    log('LIVE_RECOVERY_FALLBACK', 'emergency goto /foryou (TIKTOK_EMERGENCY_GOTO=1)')
    try {
      await page.goto('https://www.tiktok.com/foryou', { waitUntil: 'commit', timeout: 28_000 })
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      log('LIVE_RECOVERY_FALLBACK', `goto failed ${m.slice(0, 200)}`)
    }
    await interruptibleRandomDelay(400, 800, shouldHalt)
  }
  bumpSkipClickProfileAfterLive(2)
  return true
}

/**
 * @param {import('playwright').Page} page
 * @param {(action: string, details?: string) => void} log
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 */
async function waitIfChallengeOrLogin(page, log, shouldHalt) {
  const kind = await detectBlockingFlow(page)
  if (!kind) return

  if (kind === 'login') {
    log('TIKTOK_LOGIN_PAGE', 'manual login required — automation pauses 60s then continues check')
    await interruptibleRandomDelay(55_000, 65_000, shouldHalt)
    return
  }

  log(
    'TIKTOK_CHALLENGE_DETECTED',
    'captcha/verify — solve in the browser; waiting (TIKTOK_CHALLENGE_WAIT_MS max)',
  )
  const budget = challengeWaitBudgetMs()
  const started = Date.now()
  while (Date.now() - started < budget) {
    await haltIfNeeded(shouldHalt)
    const still = await detectBlockingFlow(page)
    if (!still || still === 'login') {
      if (!still) {
        log('TIKTOK_CHALLENGE_CLEARED', 'overlay gone — resuming after short pause')
        await interruptibleRandomDelay(3000, 5000, shouldHalt)
        log('TIKTOK_RESUME_AFTER_CHALLENGE', 'continuing feed automation')
      }
      break
    }
    await interruptibleRandomDelay(8000, 12000, shouldHalt)
  }
}

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
 * Never pass non-positive dy to wheel (runtime guard for upward / invalid motion).
 * @param {import('playwright').Page} page
 * @param {number} dy
 * @param {(action: string, details?: string) => void} log
 */
async function wheelDownOnly(page, dy, log) {
  const n = Number(dy)
  if (!Number.isFinite(n) || n <= 0) {
    log('BLOCKED_UPWARD_MOVEMENT', `wheel rejected non-positive dy=${dy}`)
    return
  }
  await page.mouse.wheel(0, n)
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
 * @param {import('playwright').Locator} locator
 */
async function readLikeControlState(locator) {
  return locator
    .evaluate((node) => {
      const control = node?.closest?.('button,[role="button"]') || node
      const readAttrs = (el) => {
        if (!el) return ''
        const attrs = ['aria-pressed', 'aria-label', 'class', 'data-state', 'data-test', 'data-testid', 'data-e2e']
        return attrs.map((name) => `${name}=${String(el.getAttribute(name) || '')}`).join('|')
      }

      const attrs = `${readAttrs(control)}|node=${readAttrs(node)}`
      const pressed = control?.getAttribute('aria-pressed') === 'true' || node?.getAttribute('aria-pressed') === 'true'
      const likedAttr = /liked|active|selected|pressed/i.test(attrs)

      let filledIcon = false
      const paths = Array.from((control || node).querySelectorAll('svg path[fill], svg [fill]')).slice(0, 12)
      for (const path of paths) {
        const fill = String(path.getAttribute('fill') || '').trim().toLowerCase()
        const computedFill = String(window.getComputedStyle(path).fill || '').trim().toLowerCase()
        const computedColor = String(window.getComputedStyle(path).color || '').trim().toLowerCase()
        const effectiveFill = fill === 'currentcolor' ? computedColor : fill || computedFill
        if (!effectiveFill || effectiveFill === 'none' || effectiveFill === 'transparent') continue
        if (effectiveFill === 'currentcolor') continue
        if (
          effectiveFill === '#fff' ||
          effectiveFill === '#ffffff' ||
          effectiveFill === 'white' ||
          effectiveFill === 'rgb(255, 255, 255)'
        ) {
          continue
        }
        filledIcon = true
        break
      }

      return {
        pressed,
        likedAttr,
        filledIcon,
        signature: `${String(control?.textContent || node?.textContent || '').trim()}|${attrs}`.slice(0, 520),
      }
    })
    .catch(() => ({ pressed: false, likedAttr: false, filledIcon: false, signature: '' }))
}

/**
 * @param {{ pressed: boolean; likedAttr: boolean; filledIcon: boolean; signature: string }} state
 */
function likeControlActive(state) {
  return Boolean(state?.pressed || state?.likedAttr || state?.filledIcon)
}

/**
 * @param {{ pressed: boolean; likedAttr: boolean; filledIcon: boolean; signature: string }} early
 * @param {{ pressed: boolean; likedAttr: boolean; filledIcon: boolean; signature: string }} final
 */
function persistedLikeResult(early, final) {
  if (likeControlActive(final)) return { ok: true, reason: 'state_active_after_verify' }
  if (likeControlActive(early)) return { ok: false, reason: 'reverted_after_tiktok_verify' }
  return { ok: false, reason: 'state_not_active' }
}

/**
 * Random wait in [minMs, maxMs] that stops feed actions as soon as a captcha overlay is detected,
 * runs `waitIfChallengeOrLogin` (wait until solved, then 3–5s), then exits (remaining watch time skipped).
 * @param {import('playwright').Page} page
 * @param {(action: string, details?: string) => void} log
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 * @param {number} minMs
 * @param {number} maxMs
 */
async function delayWithCaptchaInterruption(page, log, shouldHalt, minMs, maxMs) {
  const total = randomInt(minMs, maxMs)
  let elapsed = 0
  const pollMs = 500
  while (elapsed < total) {
    if ((await detectBlockingFlow(page)) === 'challenge') {
      await waitIfChallengeOrLogin(page, log, shouldHalt)
      await haltIfNeeded(shouldHalt)
      break
    }
    await haltIfNeeded(shouldHalt)
    const step = Math.min(pollMs, total - elapsed)
    let left = step
    while (left > 0) {
      await haltIfNeeded(shouldHalt)
      const s = Math.min(400, left)
      await sleep(s)
      left -= s
    }
    elapsed += step
  }
}

/**
 * Strict text hints only — avoid false LIVE from unrelated copy (e.g. "delivery", "archive").
 * @param {string} blob
 */
function textIndicatesLiveCard(blob) {
  const s = String(blob ?? '')
  if (!s.trim()) return false
  if (/\bLIVE NOW\b/i.test(s)) return true
  if (/\bGO\s+LIVE\b/i.test(s)) return true
  if (/\bSTART(?:ED)?\s+LIVE\b/i.test(s)) return true
  return false
}

/**
 * Sample text from the active feed card (video container + a few ancestors) for LIVE heuristics.
 * @param {import('playwright').Page} page
 */
async function readActiveFeedCardText(page) {
  const handle = page.locator('[data-e2e="feed-active-video"]').first()
  if ((await handle.count()) === 0) return ''
  try {
    return await handle.evaluate((el) => {
      let n = /** @type {HTMLElement | null} */ (el)
      const parts = []
      for (let i = 0; i < 8 && n; i++) {
        const t = (n.innerText || n.textContent || '').replace(/\s+/g, ' ').trim()
        if (t.length > 0) parts.push(t.slice(0, 500))
        n = n.parentElement
      }
      return parts.join(' | ').slice(0, 2500)
    })
  } catch {
    return ''
  }
}

/**
 * LIVE stream **card** on For You only (does not use `/live` URL — full-page live is handled separately).
 * @param {import('playwright').Page} page
 */
async function detectFeedCardLive(page) {
  const root = page.locator('[data-e2e="feed-active-video"]').first()
  if ((await root.count()) === 0) return false

  try {
    if (
      (await root.locator('[data-e2e="live-tag"], [data-e2e="video-live-tag"]').first().isVisible().catch(() => false))
    ) {
      return true
    }
  } catch {
    /* ignore */
  }

  try {
    if (await root.getByText(/^LIVE$/i).first().isVisible().catch(() => false)) return true
    if (await root.getByText(/\bLIVE\s+now\b/i).first().isVisible().catch(() => false)) return true
  } catch {
    /* ignore */
  }

  try {
    const ariaLive = root.locator('[aria-label*="live" i]').first()
    if (await ariaLive.isVisible().catch(() => false)) {
      const lab = ((await ariaLive.getAttribute('aria-label').catch(() => '')) ?? '').toLowerCase()
      if (lab.includes('live stream') || lab.includes('live now') || lab.includes('watching live')) return true
    }
  } catch {
    /* ignore */
  }

  const blob = await readActiveFeedCardText(page)
  if (textIndicatesLiveCard(blob)) return true

  return false
}

/**
 * Keep scrolling down until LIVE card UI is gone (TikTok sometimes snaps back one slot).
 * @param {import('playwright').Page} page
 * @param {(action: string, details?: string) => void} log
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 */
async function ironOutLiveCardIfStillShowing(page, log, shouldHalt) {
  for (let i = 0; i < 6 && (await detectFeedCardLive(page)); i++) {
    log('LIVE_ORIGIN_STILL_VISIBLE', `extra down burst wave=${i + 1}`)
    await scrollPastLiveNoPointer(page, log, shouldHalt, 'live_iron_out', {
      pressesMin: 10,
      pressesMax: 16,
      pageDowns: 3,
    })
    await sleepMsHaltable(shouldHalt, randomInt(280, 520))
    await haltIfNeeded(shouldHalt)
  }
}

/**
 * Stable-ish key for "same card again" (author link + video src prefix).
 * @param {import('playwright').Page} page
 */
async function getFeedStableKey(page) {
  try {
    const root = page.locator('[data-e2e="feed-active-video"]').first()
    if ((await root.count()) === 0) return ''
    const href =
      (await root.locator('[data-e2e="video-author-uniqueid"] a').first().getAttribute('href').catch(() => null)) ??
      ''
    const src =
      (await root.locator('video').first().getAttribute('src').catch(() => null)) ?? ''
    const combined = `${href}|${src.slice(0, 120)}`.trim()
    if (combined) return combined.slice(0, 400)
    const blob = await readActiveFeedCardText(page)
    return blob.slice(0, 200)
  } catch {
    return ''
  }
}

/**
 * Wait for TikTok to swap the active item after a scroll gesture.
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 */
async function sleepAfterScrollForAdvanceCheck(shouldHalt) {
  const ms = randomInt(500, 1200)
  let left = ms
  while (left > 0) {
    await haltIfNeeded(shouldHalt)
    const step = Math.min(400, left)
    await sleep(step)
    left -= step
  }
}

/**
 * FYP LIVE card: aggressive down-only sequence (no goto/goBack/linger/clicks).
 * @param {import('playwright').Page} page
 * @param {(action: string, details?: string) => void} log
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 */
async function skipLiveFeedCardAggressive(page, log, shouldHalt) {
  log('LIVE_DETECTED', 'FYP LIVE card — down-only skip (wheel×2 + PageDown)')
  await tiktokLiveSkipWheelPair(page, log, shouldHalt)
  log('LIVE_SKIP_SCROLL_1', 'focus+keyboard burst 1')
  await sleepMsHaltable(shouldHalt, randomInt(300, 700))

  await tiktokLiveSkipWheelPair(page, log, shouldHalt)
  log('LIVE_SKIP_SCROLL_2', 'focus+keyboard burst 2')
  await sleepMsHaltable(shouldHalt, randomInt(300, 700))

  await page.keyboard.press('PageDown').catch(() => {})
  log('LIVE_SKIP_PAGEDOWN', 'PageDown after LIVE wheels')

  await sleepMsHaltable(shouldHalt, randomInt(500, 1200))
  await haltIfNeeded(shouldHalt)

  log('LIVE_SKIPPED', 'LIVE card skip complete — starting POST_LIVE_HARD_SCROLL')
  await runPostLiveHardScrollSequence({
    page,
    log,
    shouldHalt,
    getStableKey: () => getFeedStableKey(page),
  })
}

/**
 * After any down scroll: compare `getFeedStableKey` before vs after wait; down-only recovery (no goto/goBack).
 * @param {import('playwright').Page} page
 * @param {(action: string, details?: string) => void} log
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 * @param {string} beforeStableKey
 */
async function ensureStableKeyAdvancedAfterScroll(page, log, shouldHalt, beforeStableKey) {
  await sleepAfterScrollForAdvanceCheck(shouldHalt)
  await haltIfNeeded(shouldHalt)

  if (!String(beforeStableKey).trim()) return

  let after = await getFeedStableKey(page)
  if (!after || after !== beforeStableKey) {
    if (after) {
      lastFeedStableKey = after
      feedRepeatStreak = 1
    }
    return
  }

  log('FEED_STUCK_DETECTED', `sameStableKey len=${beforeStableKey.length}`)
  await tiktokStrongScrollWithRecovery(page, log, shouldHalt, () => getFeedStableKey(page), beforeStableKey)
  await sleepAfterScrollForAdvanceCheck(shouldHalt)
  await haltIfNeeded(shouldHalt)
  after = await getFeedStableKey(page)
  if (after) {
    lastFeedStableKey = after
    feedRepeatStreak = 1
  }
}

/**
 * Block like / video click / profile: LIVE card, /live URL, or post-LIVE cooldown iterations.
 * @param {import('playwright').Page} page
 */
async function shouldBlockRichActionsForLive(page) {
  if (skipClickProfileAfterLive > 0) return true
  if (pageInLiveRoomUrl(page)) return true
  return detectFeedCardLive(page)
}

/**
 * Click center-ish of viewport (main column), not left sidebar — reduces avatar hover.
 * @param {import('playwright').Page} page
 * @param {(action: string, details?: string) => void} log
 */
async function focusFeedColumn(page, log) {
  const vp = page.viewportSize()
  if (!vp) return
  const x = Math.floor(vp.width * 0.52)
  const y = Math.floor(vp.height * 0.42)
  await page.mouse.click(x, y)
  log('FEED_FOCUS', `${x},${y}`)
}

/**
 * Scroll **down only** (FYP): focus feed-active-video + keyboard (+ wheel fallback), stable key.
 * @param {import('playwright').Page} page
 * @param {(action: string, details?: string) => void} log
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 */
async function scrollFeedStep(page, log, shouldHalt) {
  const before = await getFeedStableKey(page)
  await tiktokStrongScrollWithRecovery(page, log, shouldHalt, () => getFeedStableKey(page), before)
}

/**
 * @typedef {{ debugScreenshots?: boolean; screenshotDir?: string }} TikTokFeedIterationOptions
 */

/**
 * @param {import('playwright').Page} page
 * @param {(action: string, details?: string) => void} log
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 * @param {TikTokFeedIterationOptions} [options]
 */
export async function runTikTokHumanFeedIteration(page, log, shouldHalt, options = {}) {
  const debugShots = Boolean(options.debugScreenshots)
  const shotDir = options.screenshotDir

  await haltIfNeeded(shouldHalt)
  await waitIfChallengeOrLogin(page, log, shouldHalt)
  await haltIfNeeded(shouldHalt)

  await recoverFromLiveSurface(page, log, shouldHalt)
  await haltIfNeeded(shouldHalt)

  if ((await detectBlockingFlow(page)) === 'challenge') {
    log('TIKTOK_CHALLENGE_STILL_ACTIVE', 'skip actions this iteration — finish captcha in browser')
    await interruptibleRandomDelay(5000, 10000, shouldHalt)
    return
  }

  const stableKey = await getFeedStableKey(page)
  if (stableKey) {
    if (stableKey === lastFeedStableKey) {
      feedRepeatStreak += 1
    } else {
      feedRepeatStreak = 1
      lastFeedStableKey = stableKey
    }
    if (feedRepeatStreak >= 2) {
      log('FEED_REPEAT_DETECTED', `keyLen=${stableKey.length} streak=${feedRepeatStreak}`)
      log('FORCE_SCROLL_AFTER_REPEAT', 'extra down scroll')
      const beforeRepeatScroll = await getFeedStableKey(page)
      await scrollFeedStep(page, log, shouldHalt)
      await haltIfNeeded(shouldHalt)
      await ensureStableKeyAdvancedAfterScroll(page, log, shouldHalt, beforeRepeatScroll)
      await haltIfNeeded(shouldHalt)
      feedRepeatStreak = 0
      lastFeedStableKey = ''
      consecutiveLingerStreak = 0
    }
  } else {
    feedRepeatStreak = 0
    lastFeedStableKey = ''
  }

  const liveCardOnly = await detectFeedCardLive(page)
  if (liveCardOnly) {
    const stableBeforeLive = await getFeedStableKey(page)
    await maybeLiveDebugScreenshot(page, debugShots, shotDir, 'debug-live-skipped.png')
    await skipLiveFeedCardAggressive(page, log, shouldHalt)
    await haltIfNeeded(shouldHalt)
    await ensureStableKeyAdvancedAfterScroll(page, log, shouldHalt, stableBeforeLive)
    await haltIfNeeded(shouldHalt)
    await ironOutLiveCardIfStillShowing(page, log, shouldHalt)
    await haltIfNeeded(shouldHalt)
    bumpSkipClickProfileAfterLive(2)
    consecutiveLingerStreak = 0
    return
  }

  log('VIEW_VIDEO', 'watching 5–15s')
  await delayWithCaptchaInterruption(page, log, shouldHalt, 5000, 15000)
  await haltIfNeeded(shouldHalt)

  if (consecutiveLingerStreak >= 2) {
    log('FORCE_SCROLL_AFTER_LINGER_STREAK', 'two lingers in a row — skip linger; scroll down')
    const beforeLingerForce = await getFeedStableKey(page)
    await scrollFeedStep(page, log, shouldHalt)
    await haltIfNeeded(shouldHalt)
    await ensureStableKeyAdvancedAfterScroll(page, log, shouldHalt, beforeLingerForce)
    await haltIfNeeded(shouldHalt)
    consecutiveLingerStreak = 0
  } else if (randomChance(30)) {
    log('VIEW_VIDEO', 'linger 3–8s (no scroll this beat)')
    await delayWithCaptchaInterruption(page, log, shouldHalt, 3000, 8000)
    consecutiveLingerStreak += 1
  } else {
    const beforeMainDown = await getFeedStableKey(page)
    await scrollFeedStep(page, log, shouldHalt)
    await haltIfNeeded(shouldHalt)
    await ensureStableKeyAdvancedAfterScroll(page, log, shouldHalt, beforeMainDown)
    await haltIfNeeded(shouldHalt)
    consecutiveLingerStreak = 0
  }
  if (skipClickProfileAfterLive > 0) skipClickProfileAfterLive -= 1

  await haltIfNeeded(shouldHalt)

  if ((await detectBlockingFlow(page)) === 'challenge') {
    await waitIfChallengeOrLogin(page, log, shouldHalt)
    await haltIfNeeded(shouldHalt)
  }

  if (pageInLiveRoomUrl(page)) {
    await recoverFromLiveSurface(page, log, shouldHalt)
    await haltIfNeeded(shouldHalt)
  }

  const blockRich = await shouldBlockRichActionsForLive(page)

  if (shouldTryLike() && !blockRich) {
    await focusFeedColumn(page, log)
    const likeSelectors = [
      '[data-e2e="browse-like-icon"]',
      '[data-e2e="like-icon"]',
      '[data-e2e="video-player-like-icon"]',
      'button[aria-label*="Like" i]',
    ]
    try {
      let clicked = false
      let clickedControl = null
      for (const sel of likeSelectors) {
        const loc = page.locator(sel).first()
        if ((await loc.count()) === 0) continue
        await loc.scrollIntoViewIfNeeded().catch(() => {})
        const vis = await loc.isVisible().catch(() => false)
        if (!vis) continue
        const beforeState = await readLikeControlState(loc)
        if (likeControlActive(beforeState)) {
          log('LIKE_SKIPPED', `already liked ${sel}`)
          clicked = true
          clickedControl = null
          break
        }
        await loc.click({ timeout: 4500 })
        clicked = true
        clickedControl = loc
        log('LIKE_VIDEO', `like ${sel}`)
        break
      }
      if (!clicked) {
        log('LIKE_SKIPPED', 'no visible like control')
      } else if (clickedControl) {
        const earlyWaitMs = randomInt(900, 1400)
        await sleepMsHaltable(shouldHalt, earlyWaitMs)
        const earlyState = await readLikeControlState(clickedControl)
        const verifyWaitMs = randomInt(4500, 6500)
        log('LIKE_VERIFY_WAIT', `ms=${verifyWaitMs}`)
        await sleepMsHaltable(shouldHalt, verifyWaitMs)
        const finalState = await readLikeControlState(clickedControl)
        const result = persistedLikeResult(earlyState, finalState)
        if (result.ok) {
          log('LIKE_CONFIRMED', `reason=${result.reason}`)
        } else {
          log('LIKE_NOT_CONFIRMED', `reason=${result.reason}`)
        }
      } else {
        await interruptibleRandomDelay(800, 2200, shouldHalt)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      log('LIKE_SKIPPED', msg.slice(0, 200))
    }
    await haltIfNeeded(shouldHalt)
  }

  if (randomChance(15)) {
    const blockClick = await shouldBlockRichActionsForLive(page)
    const vid = page.locator('main video, [data-e2e="feed-active-video"] video').first()
    if (blockClick) {
      log('LIVE_SKIPPED', 'CLICK_VIDEO blocked — LIVE or post-LIVE cooldown')
    } else if ((await vid.count()) === 0) {
      log('CLICK_VIDEO', 'skipped — no video')
    } else {
      const vis = await vid.isVisible().catch(() => false)
      if (!vis) {
        log('CLICK_VIDEO', 'skipped — not visible')
      } else {
        try {
          await vid.scrollIntoViewIfNeeded().catch(() => {})
          const box = await vid.boundingBox()
          if (box && box.width > 20 && box.height > 20) {
            await vid.click({
              position: {
                x: box.width / 2,
                y: Math.min(box.height * 0.42, box.height * 0.48),
              },
              timeout: 6000,
            })
            log('CLICK_VIDEO', 'locator click center-ish on video')
            await delayWithCaptchaInterruption(page, log, shouldHalt, 5000, 12000)
          }
        } catch {
          log('CLICK_VIDEO', 'skipped')
        }
      }
    }
    await haltIfNeeded(shouldHalt)
  }

  const profilePct = profilePeekPercent()
  if (profilePct > 0 && randomChance(profilePct)) {
    const blockProfile = await shouldBlockRichActionsForLive(page)
    if (blockProfile) {
      log('LIVE_SKIPPED', 'OPEN_PROFILE blocked — LIVE or post-LIVE cooldown')
    } else {
      const author = page.locator('[data-e2e="video-author-uniqueid"]').first()
      try {
        if ((await author.count()) > 0) {
          await author.scrollIntoViewIfNeeded().catch(() => {})
          await author.click({ timeout: 8000 })
          const u = page.url()
          log('OPEN_PROFILE', u)
          await delayWithCaptchaInterruption(page, log, shouldHalt, 5000, 10000)
          log('PROFILE_BACK', 'no goBack — down-only feed')
        }
      } catch {
        log('OPEN_PROFILE', 'skipped')
      }
    }
    await haltIfNeeded(shouldHalt)
  }
}
