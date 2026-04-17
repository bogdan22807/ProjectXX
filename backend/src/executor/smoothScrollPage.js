/**
 * Human-like vertical scroll on a Playwright page (wheel steps + pauses).
 * Does not attach to routes — call from scenarios when needed.
 */

import { randomInt, sleepRandom } from './asyncUtils.js'

/**
 * @typedef {{
 *   minSteps?: number
 *   maxSteps?: number
 *   minDistance?: number
 *   maxDistance?: number
 *   minPause?: number
 *   maxPause?: number
 *   scrollBackMin?: number
 *   scrollBackMax?: number
 * }} SmoothScrollPageOptions
 */

const defaultOptions = {
  minSteps: 3,
  maxSteps: 6,
  minDistance: 200,
  maxDistance: 800,
  minPause: 400,
  maxPause: 1500,
  scrollBackMin: 80,
  scrollBackMax: 250,
}

/**
 * @param {(action: string, details?: string) => void} logger
 * @param {SmoothScrollPageOptions} [options]
 */
export async function smoothScrollPage(page, logger, options = {}) {
  const o = { ...defaultOptions, ...options }
  const log =
    typeof logger === 'function'
      ? logger
      : () => {}

  log(
    'smooth scroll started',
    [
      `steps=${o.minSteps}-${o.maxSteps}`,
      `dist=${o.minDistance}-${o.maxDistance}px`,
      `pause=${o.minPause}-${o.maxPause}ms`,
    ].join(' | '),
  )

  const steps = randomInt(o.minSteps, o.maxSteps)
  for (let i = 0; i < steps; i++) {
    const dy = randomInt(o.minDistance, o.maxDistance)
    await page.mouse.wheel(0, dy)
    await sleepRandom(o.minPause, o.maxPause)
  }

  const scrollBack = randomInt(o.scrollBackMin, o.scrollBackMax)
  await page.mouse.wheel(0, -scrollBack)

  log('smooth scroll completed', `steps=${steps} scrollBack=${scrollBack}px`)
}
