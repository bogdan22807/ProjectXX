/**
 * One "human" iteration on TikTok FYP: watch → scroll or linger → optional video click → optional profile peek.
 * No page.goto / reload — caller opens TikTok once.
 */

import { interruptibleRandomDelay, randomChance, randomDelay, randomInt } from '../asyncUtils.js'
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
 * @param {import('playwright').Page} page
 * @param {(action: string, details?: string) => void} log
 * @param {() => Promise<false | 'stop' | 'max_duration'>} shouldHalt
 */
export async function runTikTokHumanFeedIteration(page, log, shouldHalt) {
  await haltIfNeeded(shouldHalt)

  log('VIEW_VIDEO', 'watching 5–15s')
  await interruptibleRandomDelay(5000, 15000, shouldHalt)
  await haltIfNeeded(shouldHalt)

  if (randomChance(30)) {
    log('VIEW_VIDEO', 'linger 3–8s (no scroll this beat)')
    await interruptibleRandomDelay(3000, 8000, shouldHalt)
  } else {
    const dyDown = randomInt(480, 820)
    await page.mouse.wheel(0, dyDown)
    log('SCROLL', `down dy=${dyDown}px`)
    if (randomChance(25)) {
      const dyUp = randomInt(90, 220)
      await page.mouse.wheel(0, -dyUp)
      log('SCROLL_BACK', `up dy=${dyUp}px`)
    }
  }
  await haltIfNeeded(shouldHalt)

  if (randomChance(15)) {
    const vid = page.locator('main video').first()
    try {
      if ((await vid.count()) > 0) {
        await vid.click({ timeout: 8000 })
        log('CLICK_VIDEO', 'feed video')
        await interruptibleRandomDelay(5000, 12000, shouldHalt)
      }
    } catch {
      log('CLICK_VIDEO', 'skipped (no hit)')
    }
    await haltIfNeeded(shouldHalt)
  }

  if (randomChance(7)) {
    const author = page.locator('[data-e2e="video-author-uniqueid"]').first()
    try {
      if ((await author.count()) > 0) {
        await author.click({ timeout: 8000 })
        const u = page.url()
        log('OPEN_PROFILE', u)
        await interruptibleRandomDelay(5000, 10000, shouldHalt)
        await page.goBack({ waitUntil: 'commit', timeout: 20000 }).catch(() => {})
        log('PROFILE_BACK', page.url())
      }
    } catch {
      log('OPEN_PROFILE', 'skipped')
    }
    await haltIfNeeded(shouldHalt)
  }
}
