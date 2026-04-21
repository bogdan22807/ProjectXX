/**
 * Small async / timing helpers for executor scenarios (no side effects).
 */

import { ExecutorHaltError } from './executorHalt.js'

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  const n = Number(ms)
  const delay = Number.isFinite(n) && n >= 0 ? n : 0
  return new Promise((resolve) => {
    setTimeout(resolve, delay)
  })
}

/**
 * Inclusive integer in [min, max]. If min > max, bounds are swapped.
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function randomInt(min, max) {
  let a = Math.ceil(Number(min))
  let b = Math.floor(Number(max))
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
  if (a > b) {
    const t = a
    a = b
    b = t
  }
  return a + Math.floor(Math.random() * (b - a + 1))
}

/**
 * `await sleep(randomInt(min, max))` — inclusive bounds in ms.
 * @param {number} minMs
 * @param {number} maxMs
 * @returns {Promise<void>}
 */
export async function sleepRandom(minMs, maxMs) {
  await sleep(randomInt(minMs, maxMs))
}

/**
 * Random wait in [minMs, maxMs] inclusive.
 * @param {number} minMs
 * @param {number} maxMs
 * @returns {Promise<void>}
 */
export async function randomDelay(minMs, maxMs) {
  await sleepRandom(minMs, maxMs)
}

/**
 * True with given probability in percent (0–100).
 * @param {number} percent
 */
export function randomChance(percent) {
  const p = Number(percent)
  if (!Number.isFinite(p) || p <= 0) return false
  if (p >= 100) return true
  return Math.random() * 100 < p
}

const HALT_CHUNK_MS = 400

/**
 * Sleep random [minMs, maxMs] but wake every ~400ms to check halt (stop / max duration).
 * @param {number} minMs
 * @param {number} maxMs
 * @param {null | (() => Promise<false | 'stop' | 'max_duration'>)} shouldHalt
 */
export async function interruptibleRandomDelay(minMs, maxMs, shouldHalt) {
  const total = randomInt(minMs, maxMs)
  let left = total
  while (left > 0) {
    if (shouldHalt) {
      const h = await shouldHalt()
      if (h === 'stop') throw new ExecutorHaltError('stop')
      if (h === 'max_duration') throw new ExecutorHaltError('max_duration')
    }
    const step = Math.min(HALT_CHUNK_MS, left)
    await sleep(step)
    left -= step
  }
}
