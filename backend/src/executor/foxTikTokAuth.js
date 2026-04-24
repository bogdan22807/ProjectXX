/**
 * TikTok + Camoufox (fox): cookie-only auth check on /foryou — no password automation.
 */

/**
 * @param {import('playwright').Page} page
 * @param {number} perLocatorMs
 */
export async function isTikTokLogInControlVisible(page, perLocatorMs = 2500) {
  const candidates = [
    page.getByRole('link', { name: /^log in$/i }),
    page.getByRole('button', { name: /^log in$/i }),
    page.locator('[data-e2e="nav-login"]'),
    page.locator('a[href*="/login"]').filter({ hasText: /log\s*in/i }),
  ]
  for (const loc of candidates) {
    const first = loc.first()
    try {
      if (await first.isVisible({ timeout: perLocatorMs })) return true
    } catch {
      /* timeout → not visible */
    }
  }
  return false
}
