/**
 * Graceful halt for Playwright executor loop (stop or max duration).
 * Caught in playwrightTestRun — not treated as executor failure.
 */
export class ExecutorHaltError extends Error {
  /**
   * @param {'stop' | 'max_duration'} reason
   */
  constructor(reason) {
    super(`ExecutorHalt:${reason}`)
    this.name = 'ExecutorHaltError'
    this.reason = reason
  }
}

/**
 * @param {unknown} err
 * @returns {err is ExecutorHaltError}
 */
export function isExecutorHaltError(err) {
  return err instanceof ExecutorHaltError
}
