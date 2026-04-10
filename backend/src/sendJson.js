/**
 * Helpers for the unified API envelope used by the frontend:
 *   success responses with payload -> { success: true, data: ... }
 *   success responses without payload -> { success: true }
 *   error responses -> { success: false, error: "..." }
 */

/**
 * @param {import('express').Response} res
 * @param {number} status
 * @param {unknown} data
 * @returns {import('express').Response}
 */
export function sendJsonData(res, status, data) {
  return res.status(status).json({ success: true, data })
}

/**
 * @param {import('express').Response} res
 * @param {number} [status]
 * @returns {import('express').Response}
 */
export function sendJsonSuccess(res, status = 200) {
  return res.status(status).json({ success: true })
}

/**
 * @param {import('express').Response} res
 * @param {number} status
 * @param {string} error
 * @returns {import('express').Response}
 */
export function sendJsonError(res, status, error) {
  return res.status(status).json({ success: false, error })
}

/**
 * Express sends an empty body for res.json(undefined), which is not valid JSON.
 * Use this helper so successful writes always return a JSON object or array.
 *
 * @param {import('express').Response} res
 * @param {number} status
 * @param {unknown} row
 * @param {string} [errorMessage]
 * @returns {import('express').Response}
 */
export function sendJsonRow(res, status, row, errorMessage = 'Record missing after write') {
  if (row == null) {
    return sendJsonError(res, 500, errorMessage)
  }
  return sendJsonData(res, status, row)
}
