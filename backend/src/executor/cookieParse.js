/**
 * Cookie parsing for Playwright addCookies (shared by test run and browser session).
 */

/**
 * Parse cookies for addCookies. If user supplied non-empty cookie data that cannot be used → invalid.
 * @returns {{ cookies: import('playwright').Cookie[], invalid?: string }}
 */
export function parseCookiesForUrlStrict(raw, pageUrl) {
  const s = String(raw ?? '').trim()
  if (!s) {
    return { cookies: [] }
  }

  const origin = pageUrl.origin
  const host = pageUrl.hostname

  const trimmed = s.trim()
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) {
        const cookies = normalizeCookieList(parsed, pageUrl)
        if (cookies.length === 0) {
          return { cookies: [], invalid: 'JSON array parsed but no valid cookie entries' }
        }
        return { cookies }
      }
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.cookies)) {
        const cookies = normalizeCookieList(parsed.cookies, pageUrl)
        if (cookies.length === 0) {
          return { cookies: [], invalid: 'storageState.cookies empty or invalid' }
        }
        return { cookies }
      }
      return { cookies: [], invalid: 'JSON is not a cookie array or storageState' }
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      return { cookies: [], invalid: `invalid JSON: ${m}` }
    }
  }

  const headerCookies = []
  for (const part of s.split(';')) {
    const p = part.trim()
    if (!p) continue
    const eq = p.indexOf('=')
    if (eq <= 0) continue
    const name = p.slice(0, eq).trim()
    const value = p.slice(eq + 1).trim()
    if (!name) continue
    headerCookies.push({ name, value, url: origin })
  }

  if (headerCookies.length === 0) {
    return {
      cookies: [],
      invalid: 'cookie string is not valid JSON and has no name=value pairs',
    }
  }
  return { cookies: headerCookies }
}

function normalizeCookieList(list, pageUrl) {
  const host = pageUrl.hostname
  /** @type {import('playwright').Cookie[]} */
  const out = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const o = /** @type {Record<string, unknown>} */ (item)
    const name = o.name != null ? String(o.name) : ''
    if (!name) continue
    const value = o.value != null ? String(o.value) : ''
    const path = o.path != null ? String(o.path) : '/'
    let domain = o.domain != null ? String(o.domain) : host
    if (!domain) domain = host
    /** @type {import('playwright').Cookie} */
    const c =
      o.url != null
        ? { name, value, url: String(o.url) }
        : { name, value, domain, path }
    if (o.expires != null && Number.isFinite(Number(o.expires))) {
      c.expires = Number(o.expires)
    }
    if (o.httpOnly === true) c.httpOnly = true
    if (o.secure === true) c.secure = true
    if (o.sameSite === 'Strict' || o.sameSite === 'Lax' || o.sameSite === 'None') {
      c.sameSite = o.sameSite
    }
    out.push(c)
  }
  return out
}

/** @param {string} raw @param {URL} pageUrl */
export function parseCookiesForUrl(raw, pageUrl) {
  const r = parseCookiesForUrlStrict(raw, pageUrl)
  return r.cookies
}
