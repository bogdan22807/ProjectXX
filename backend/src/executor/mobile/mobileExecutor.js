/**
 * Mobile QA executor: ADB against MuMu / Android (device detection, open app, stop session).
 * Does not depend on browser executor or DB-backed account logs — uses stdout markers for QA.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { filterOnlineDevices, parseAdbDevicesList } from './adbDevices.js'

const execFileAsync = promisify(execFile)

/** @typedef {'check_device' | 'open_app' | 'stop'} MobileExecutorCommand */

let sessionStarted = false

/**
 * @param {string} action
 * @param {string} [details]
 */
function mobileLog(action, details = '') {
  const d = String(details ?? '').trim()
  if (d) console.log(action, d)
  else console.log(action)
}

/**
 * @param {unknown} err
 * @param {string} [context]
 */
function mobileError(err, context = '') {
  const msg = err instanceof Error ? err.message : String(err)
  const suffix = context ? `${context}: ${msg}` : msg
  mobileLog('MOBILE_ERROR', suffix)
}

/**
 * @param {{ adbPath?: string; timeoutMs?: number }} [opts]
 * @returns {Promise<string>}
 */
async function runAdbDevices(opts = {}) {
  const adb = opts.adbPath ?? 'adb'
  const timeoutMs = opts.timeoutMs ?? 25_000
  const { stdout, stderr } = await execFileAsync(adb, ['devices'], {
    timeout: timeoutMs,
    maxBuffer: 2 * 1024 * 1024,
    encoding: 'utf8',
    windowsHide: true,
  })
  const errText = String(stderr ?? '').trim()
  if (errText && !String(stdout ?? '').trim()) {
    throw new Error(errText)
  }
  return String(stdout ?? '')
}

/**
 * @param {string} deviceId
 * @param {string[]} adbArgs
 * @param {{ adbPath?: string; timeoutMs?: number }} [opts]
 */
async function runAdb(deviceId, adbArgs, opts = {}) {
  const adb = opts.adbPath ?? 'adb'
  const timeoutMs = opts.timeoutMs ?? 60_000
  return execFileAsync(adb, ['-s', deviceId, ...adbArgs], {
    timeout: timeoutMs,
    maxBuffer: 4 * 1024 * 1024,
    encoding: 'utf8',
    windowsHide: true,
  })
}

/**
 * @param {{ stdout?: string; stderr?: string }} result
 */
function assertAdbOk(result) {
  const stderr = String(result.stderr ?? '')
  if (/error:/i.test(stderr)) {
    throw new Error(stderr.trim() || 'adb error')
  }
}

/**
 * @param {{ env?: NodeJS.ProcessEnv; adbPath?: string; timeoutMs?: number }} [opts]
 * @returns {Promise<{ deviceId: string, rows: import('./adbDevices.js').AdbDeviceRow[] }>}
 */
export async function resolveMobileDevice(opts = {}) {
  const env = opts.env ?? process.env
  const fromEnv = String(env.MOBILE_DEVICE_ID ?? '').trim()
  const stdout = await runAdbDevices(opts)
  const rows = parseAdbDevicesList(stdout)
  const online = filterOnlineDevices(rows)

  if (fromEnv) {
    const hit = online.find((r) => r.id === fromEnv)
    if (!hit) {
      const states = rows.filter((r) => r.id === fromEnv).map((r) => r.state)
      throw new Error(
        states.length
          ? `MOBILE_DEVICE_ID=${fromEnv} is not online (state: ${states.join(', ')})`
          : `MOBILE_DEVICE_ID=${fromEnv} not found in adb devices`,
      )
    }
    return { deviceId: fromEnv, rows }
  }

  if (online.length === 0) {
    throw new Error('No online Android devices in `adb devices` (need state "device")')
  }

  return { deviceId: online[0].id, rows }
}

function ensureSessionStarted() {
  if (sessionStarted) return
  mobileLog('MOBILE_EXECUTOR_STARTED')
  sessionStarted = true
}

/**
 * @param {{ env?: NodeJS.ProcessEnv; adbPath?: string; timeoutMs?: number }} [opts]
 */
export async function mobileCheckDevice(opts = {}) {
  ensureSessionStarted()
  try {
    const { deviceId, rows } = await resolveMobileDevice(opts)
    mobileLog('MOBILE_DEVICE_FOUND', `id=${deviceId} online=${filterOnlineDevices(rows).length}`)
    return { ok: true, deviceId, deviceCount: rows.length, onlineCount: filterOnlineDevices(rows).length }
  } catch (err) {
    mobileError(err, 'check_device')
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * @param {{ env?: NodeJS.ProcessEnv; adbPath?: string; timeoutMs?: number }} [opts]
 */
export async function mobileOpenApp(opts = {}) {
  ensureSessionStarted()
  const env = opts.env ?? process.env
  const pkg = String(env.MOBILE_APP_PACKAGE ?? '').trim()
  if (!pkg) {
    const msg = 'MOBILE_APP_PACKAGE is not set'
    mobileError(msg, 'open_app')
    return { ok: false, error: msg }
  }
  try {
    const { deviceId } = await resolveMobileDevice(opts)
    const result = await runAdb(
      deviceId,
      ['shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1'],
      opts,
    )
    assertAdbOk(result)
    mobileLog('MOBILE_APP_OPENED', `package=${pkg} device=${deviceId}`)
    return { ok: true, deviceId, package: pkg }
  } catch (err) {
    mobileError(err, 'open_app')
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Ends mobile executor session; optionally force-stops MOBILE_APP_PACKAGE when set.
 * @param {{ env?: NodeJS.ProcessEnv; adbPath?: string; timeoutMs?: number; forceStopApp?: boolean }} [opts]
 */
export async function mobileStop(opts = {}) {
  const env = opts.env ?? process.env
  const forceStop = opts.forceStopApp !== false
  const pkg = String(env.MOBILE_APP_PACKAGE ?? '').trim()
  const hadSession = sessionStarted

  try {
    if (sessionStarted && forceStop && pkg) {
      const { deviceId } = await resolveMobileDevice(opts)
      const result = await runAdb(deviceId, ['shell', 'am', 'force-stop', pkg], opts)
      assertAdbOk(result)
    }
  } catch (err) {
    mobileError(err, 'stop_force_stop')
  } finally {
    if (hadSession) {
      mobileLog('MOBILE_EXECUTOR_STOPPED')
    }
    sessionStarted = false
  }
  return { ok: true }
}

/**
 * @param {MobileExecutorCommand} command
 * @param {{ env?: NodeJS.ProcessEnv; adbPath?: string; timeoutMs?: number }} [opts]
 */
export async function runMobileExecutorCommand(command, opts = {}) {
  switch (command) {
    case 'check_device':
      return mobileCheckDevice(opts)
    case 'open_app':
      return mobileOpenApp(opts)
    case 'stop':
      return mobileStop(opts)
    default:
      mobileError(`unknown command: ${command}`, 'runMobileExecutorCommand')
      return { ok: false, error: `unknown command: ${command}` }
  }
}

/** Test-only reset of session flag */
export function _resetMobileExecutorSessionForTests() {
  sessionStarted = false
}
