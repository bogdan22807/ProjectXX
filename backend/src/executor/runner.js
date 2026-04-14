/**
 * Minimal executor primitives: DB-backed context, logging, and in-memory session helpers.
 * Browser automation lives in playwrightTestRun.js (invoked from warmup / warmup/test-run routes).
 */

import { db, newId } from '../db.js'

/** @typedef {Record<string, unknown>} AccountRow */
/** @typedef {Record<string, unknown>} ProxyRow */
/** @typedef {Record<string, unknown>} ProfileRow */

/** @typedef {{ cancelled: boolean, timeoutIds: ReturnType<typeof setTimeout>[], context: ExecutionContext }} ExecutorRun */

/** @typedef {{ account: AccountRow, proxy: ProxyRow | null, profile: ProfileRow | null }} ExecutionContext */

/** @type {Map<string, ExecutorRun>} */
const activeRuns = new Map()

/**
 * @param {string} accountId
 * @returns {AccountRow | undefined}
 */
export function getAccount(accountId) {
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId)
}

/**
 * @param {string | null | undefined} proxyId
 * @returns {ProxyRow | null}
 */
export function getProxy(proxyId) {
  if (!proxyId) return null
  const row = db.prepare('SELECT * FROM proxies WHERE id = ?').get(proxyId)
  return row ?? null
}

/**
 * @param {string | null | undefined} profileId
 * @returns {ProfileRow | null}
 */
export function getBrowserProfile(profileId) {
  if (!profileId) return null
  const row = db.prepare('SELECT * FROM browser_profiles WHERE id = ?').get(profileId)
  return row ?? null
}

/**
 * Load account and linked proxy / browser profile (by FKs on the account row).
 * @param {string} accountId
 * @returns {ExecutionContext | null}
 */
export function getExecutionContext(accountId) {
  const account = getAccount(accountId)
  if (!account) return null
  const proxy = getProxy(/** @type {string | null} */ (account.proxy_id))
  const profile = getBrowserProfile(/** @type {string | null} */ (account.browser_profile_id))
  return { account, proxy, profile }
}

/**
 * Append a log row (same storage as the rest of the API).
 * @param {string | null} accountId
 * @param {string} action
 * @param {string} [details]
 */
export function logStep(accountId, action, details = '') {
  const id = newId('log')
  db.prepare(`INSERT INTO logs (id, account_id, action, details) VALUES (?, ?, ?, ?)`).run(
    id,
    accountId,
    String(action ?? '').trim() || '(empty)',
    String(details ?? ''),
  )
}

/**
 * @param {string} accountId
 * @param {string} status
 */
export function updateStatus(accountId, status) {
  const r = db.prepare('UPDATE accounts SET status = ? WHERE id = ?').run(status, accountId)
  if (r.changes === 0) {
    throw new Error(`Account not found: ${accountId}`)
  }
}

function clearRunTimers(run) {
  for (const tid of run.timeoutIds) {
    clearTimeout(tid)
  }
  run.timeoutIds.length = 0
}

/**
 * Register an executor session for the account (in-memory). Loads linked proxy/profile for future steps.
 * Does not run real automation. Does not modify account status — callers (e.g. routes) own that until wired.
 *
 * @param {string} accountId
 * @returns {ExecutionContext}
 */
export function startExecutor(accountId) {
  if (activeRuns.has(accountId)) {
    throw new Error('Executor already active for this account')
  }
  const context = getExecutionContext(accountId)
  if (!context) {
    throw new Error(`Account not found: ${accountId}`)
  }
  const run = { cancelled: false, timeoutIds: [], context }
  activeRuns.set(accountId, run)
  return context
}

/**
 * Stop executor session for the account (clears in-memory state only).
 * @param {string} accountId
 * @returns {{ stopped: boolean }}
 */
export function stopExecutor(accountId) {
  const run = activeRuns.get(accountId)
  if (!run) {
    return { stopped: false }
  }
  run.cancelled = true
  clearRunTimers(run)
  activeRuns.delete(accountId)
  return { stopped: true }
}

/**
 * @param {string} accountId
 * @returns {boolean}
 */
export function isExecutorActive(accountId) {
  return activeRuns.has(accountId)
}

/**
 * Schedule a callback after delayMs; cancelled if stopExecutor runs first.
 * For future real workflows (not used by the stub start/stop).
 *
 * @param {string} accountId
 * @param {number} delayMs
 * @param {() => void} fn
 */
export function scheduleStep(accountId, delayMs, fn) {
  const run = activeRuns.get(accountId)
  if (!run || run.cancelled) return

  const tid = setTimeout(() => {
    const i = run.timeoutIds.indexOf(tid)
    if (i >= 0) run.timeoutIds.splice(i, 1)
    if (!run.cancelled) fn()
  }, delayMs)
  run.timeoutIds.push(tid)
}
