/**
 * Consistent serialization for executor / browser errors (UI + DB logs).
 */

/**
 * @param {unknown} err
 * @returns {string}
 */
export function errorMessage(err) {
  if (err instanceof Error) return err.message
  return String(err)
}

/**
 * @param {unknown} err
 * @returns {string}
 */
export function errorStack(err) {
  if (err instanceof Error && err.stack) return err.stack
  return ''
}

/**
 * @param {unknown} err
 * @returns {string}
 */
export function errorType(err) {
  if (err == null) return 'null'
  if (typeof err === 'object' && 'name' in err && typeof err.name === 'string' && err.name) {
    return err.name
  }
  return err instanceof Error ? err.constructor.name : typeof err
}

/**
 * JSON representation (Error is not enumerable — expand manually).
 * @param {unknown} err
 * @returns {string}
 */
export function serializeErrorJson(err) {
  if (err instanceof Error) {
    const o = {
      name: err.name,
      message: err.message,
      stack: err.stack,
    }
    if ('cause' in err && err.cause !== undefined) {
      o.cause =
        err.cause instanceof Error
          ? { name: err.cause.name, message: err.cause.message, stack: err.cause.stack }
          : err.cause
    }
    try {
      return JSON.stringify(o, null, 2)
    } catch {
      return JSON.stringify({ name: err.name, message: err.message }, null, 2)
    }
  }
  try {
    return JSON.stringify(err, null, 2)
  } catch {
    return JSON.stringify({ value: String(err) }, null, 2)
  }
}

/**
 * @param {{
 *   err: unknown
 *   scope?: string
 *   accountId?: string | null
 *   runId?: string | null
 * }} p
 * @returns {string}
 */
export function formatStructuredErrorDetails(p) {
  const { err, scope = '', accountId = null, runId = null } = p
  const lines = [
    `ERROR_TYPE=${errorType(err)}`,
    `ERROR_MESSAGE=${errorMessage(err)}`,
    `ERROR_STACK=${errorStack(err) || '(no stack)'}`,
    `CONTEXT=runId=${runId ?? '(none)'} accountId=${accountId ?? '(none)'} scope=${scope || '(none)'}`,
    `JSON=${serializeErrorJson(err)}`,
  ]
  return lines.join('\n')
}
