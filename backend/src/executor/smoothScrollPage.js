/**
 * Human-like vertical scroll on a Playwright page (wheel steps + pauses).
 * Does not attach to routes — call from scenarios when needed.
 */

import { randomInt, sleepRandom } from './asyncUtils.js'
import { ExecutorHaltError } from './executorHalt.js'

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
 *   scrollLog?: { started?: string; completed?: string; waitBetweenSteps?: string; step?: string }
 *   shouldAbort?: () => false | 'stop' | 'max_duration' | Promise<false | 'stop' | 'max_duration'>
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
  const { scrollLog: _sl, ...rest } = options
  const o = { ...defaultOptions, ...rest }
  const scrollLog = options.scrollLog ?? {}
  const startAction = scrollLog.started ?? 'smooth scroll started'
  const completeAction = scrollLog.completed ?? 'smooth scroll completed'
  const waitAction = scrollLog.waitBetweenSteps ?? 'WAITING'
  const stepAction = scrollLog.step ?? 'SCROLL_STEP'

  const log =
    typeof logger === 'function'
      ? logger
      : () => {}

  log(
    startAction,
    [
      `steps=${o.minSteps}-${o.maxSteps}`,
      `dist=${o.minDistance}-${o.maxDistance}px`,
      `pause=${o.minPause}-${o.maxPause}ms`,
    ].join(' | '),
  )

  const shouldAbort = typeof options.shouldAbort === 'function' ? options.shouldAbort : null

  const steps = randomInt(o.minSteps, o.maxSteps)
  for (let i = 0; i < steps; i++) {
    if (shouldAbort) {
      const halt = await shouldAbort()
      if (halt === 'stop') throw new ExecutorHaltError('stop')
      if (halt === 'max_duration') throw new ExecutorHaltError('max_duration')
    }
    const dy = randomInt(o.minDistance, o.maxDistance)
    await page.mouse.wheel(0, dy)
    log(stepAction, `dy=${dy}px`)
    log(waitAction, `between scroll steps ${o.minPause}-${o.maxPause}ms`)
    await sleepRandom(o.minPause, o.maxPause)
  }

  const scrollBack = randomInt(o.scrollBackMin, o.scrollBackMax)
  await page.mouse.wheel(0, -scrollBack)

  log(completeAction, `steps=${steps} scrollBack=${scrollBack}px`)
}
