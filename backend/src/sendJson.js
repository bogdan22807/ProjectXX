/**
 * Express sends an empty body for res.json(undefined), which is not valid JSON.
 * Use this helper so successful writes always return a JSON object or array.
 *
 * @param {import('express').Response} res
 * @param {number} status
 * @param {unknown} row
 * @param {string} [errorMessage]
 * @returns {import('express').Response | void}
 */
export function sendJsonRow(res, status, row, errorMessage = 'Record missing after write') {
  if (row == null) {
    return res.status(500).json({ error: errorMessage })
  }
  return res.status(status).json(row)
}
