/**
 * Browser automation backends: Chromium (Playwright) vs future Camoufox/Python ("fox").
 */

/** @typedef {'chromium' | 'fox'} BrowserEngine */

/**
 * @param {unknown} raw
 * @returns {BrowserEngine}
 */
export function normalizeBrowserEngine(raw) {
  const s = String(raw ?? '').trim().toLowerCase()
  if (s === 'fox') return 'fox'
  return 'chromium'
}
