/**
 * Parse pasted proxy lines (IPv4 + numeric port, 4 colon-separated segments).
 * - pass_user (default): host:port:password:username (SOAX-style list)
 * - user_pass: host:port:username:password
 */

/** @param {string} s */
function firstNonEmptyLine(s) {
  const lines = String(s ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  return lines[0] ?? ''
}

/**
 * @param {string} raw
 * @param {'user_pass' | 'pass_user'} order
 * @returns {{ host: string, port: string, username: string, password: string } | null}
 */
export function parseProxyFourPartLine(raw, order = 'pass_user') {
  const line = firstNonEmptyLine(raw)
  if (!line) return null

  const parts = line.split(':').map((p) => p.trim())
  if (parts.length !== 4) return null

  const [h, p, third, fourth] = parts
  if (!h || !p || !third || !fourth) return null
  if (!/^\d{1,5}$/.test(p)) return null
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return null

  if (order === 'user_pass') {
    return { host: h, port: p, username: third, password: fourth }
  }
  return { host: h, port: p, username: fourth, password: third }
}
