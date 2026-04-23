/**
 * Cookie apply + TikTok auth probe for Fox (Firefox) sessions.
 */

import { parseCookiesForUrlStrict } from './cookieParse.js'
import { inferTikTokAuthState } from './scenarios/viewAndScrollScenario.js'

export class FoxTikTokSessionInvalidError extends Error {
  constructor(message) {
    super(message)
    this.name = 'FoxTikTokSessionInvalidError'
  }
}

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
 * Same rules as Chromium createBrowserSession: parse strict, addCookies on context before navigation.
 * @param {import('playwright').BrowserContext} context
 * @param {{
 *   cookies?: string
 *   cookieUrl?: string
 *   startUrl: string
 *   accountId: string
 *   logStep: (accountId: string, action: string, details?: string) => void
 *   onPhase?: (phase: string, detail?: string) => void
 * }} opts
 */
export async function applyFoxSessionCookies(context, opts) {
  const { cookies, cookieUrl, startUrl, accountId, logStep, onPhase } = opts
  const phase = typeof onPhase === 'function' ? onPhase : () => {}

  const raw = String(cookies ?? '').trim()
  if (!raw) {
    phase('fox_cookies_skipped', 'no cookie string')
    logStep(accountId, 'FOX_COOKIES_SKIPPED', 'no cookie string')
    return
  }

  let pageUrl
  try {
    pageUrl = new URL(String(cookieUrl ?? '').trim() || startUrl)
  } catch (urlErr) {
    const msg = urlErr instanceof Error ? urlErr.message : String(urlErr)
    throw new Error(`FOX_TIKTOK_INVALID_COOKIE_URL: ${String(cookieUrl ?? startUrl)} (${msg})`)
  }

  const parsed = parseCookiesForUrlStrict(raw, pageUrl)
  if (parsed.invalid) {
    throw new Error(`FOX_COOKIES_PARSE_ERROR: ${parsed.invalid}`)
  }
  if (parsed.cookies.length > 0) {
    await context.addCookies(parsed.cookies)
    phase('fox_cookies_applied', `${parsed.cookies.length}`)
    logStep(accountId, 'FOX_COOKIES_APPLIED', `${parsed.cookies.length} cookie(s) url=${pageUrl.origin}`)
  } else {
    phase('fox_cookies_empty_after_parse', '')
    logStep(accountId, 'FOX_COOKIES_EMPTY_AFTER_PARSE', `url=${pageUrl.origin}`)
  }
}

/**
 * Navigate to TikTok start URL, log FOX_* diagnostics, fail fast on login redirect.
 * Call after applyFoxSessionCookies when platform is TikTok.
 * @param {import('playwright').Page} page
 * @param {{
 *   startUrl: string
 *   platform: string
 *   accountId: string
 *   logStep: (accountId: string, action: string, details?: string) => void
 * }} opts
 */
export async function openFoxTikTokAndVerifyAuth(page, opts) {
  const { startUrl, platform, accountId, logStep } = opts

  const nav = await page.goto(startUrl, {
    waitUntil: gotoWaitUntil(),
    timeout: gotoTimeoutMs(),
  })
  const st = nav?.status() ?? null
  if (st === 407) {
    logStep(accountId, 'FOX_TIKTOK_OPEN_ERROR', 'HTTP 407')
  } else if (st != null && st >= 400) {
    logStep(accountId, 'FOX_TIKTOK_OPEN_ERROR', `HTTP ${st}`)
  }

  const u = page.url()
  const ti = (await page.title().catch(() => '')) ?? ''
  logStep(accountId, 'FOX_CURRENT_URL', u)
  logStep(accountId, 'FOX_PAGE_TITLE', ti || '(empty)')

  const auth = inferTikTokAuthState(platform, u, ti)
  logStep(accountId, 'FOX_AUTH_STATE', auth)

  if (auth === 'redirected_to_login') {
    logStep(
      accountId,
      'FOX_TIKTOK_AUTH_REDIRECT',
      'redirected_to_login — cookies invalid or session expired (login/verify/captcha)',
    )
    throw new FoxTikTokSessionInvalidError(
      'FOX_TIKTOK_SESSION_INVALID: redirected_to_login — fix cookies/session before automation.',
    )
  }

  return { url: u, title: ti, auth }
}
