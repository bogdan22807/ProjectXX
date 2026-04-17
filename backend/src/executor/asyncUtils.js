/**
 * Small async / timing helpers for executor scenarios (no side effects).
 */

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
