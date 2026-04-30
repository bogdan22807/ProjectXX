/**
 * Mobile QA executor: ADB against MuMu / Android (device detection, open app, stop session).
 * Does not depend on browser executor or DB-backed account logs — uses stdout markers for QA.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { filterOnlineDevices, parseAdbDevicesList } from './adbDevices.js'

const execFileAsync = promisify(execFile)

/** @typedef {'check_device' | 'open_app' | 'scenario' | 'stop'} MobileExecutorCommand */

/** @typedef {Object} MobileExecutorOpts
 * @property {import('node:process').ProcessEnv} [env]
 * @property {(action: string, details?: string) => void} [emit]
 * @property {string} [adbPath]
 * @property {number} [timeoutMs]
 * @property {boolean} [forceStopApp]
 * @property {() => number} [random]
 * @property {(ms: number) => Promise<void>} [sleep]
 * @property {AbortSignal} [signal]
 */

let sessionStarted = false
const MOBILE_STOP_CHECK_INTERVAL_MS = 400

class MobileScenarioStoppedError extends Error {
  constructor(message = 'stop requested') {
    super(message)
    this.name = 'MobileScenarioStoppedError'
  }
}

/**
 * @param {MobileExecutorOpts | undefined} opts
 * @param {string} action
 * @param {string} [details]
 */
function mobileLog(opts, action, details = '') {
  const d = String(details ?? '').trim()
  if (d) console.log(action, d)
  else console.log(action)
  opts?.emit?.(action, d)
}

/**
 * @param {MobileExecutorOpts | undefined} opts
 * @param {unknown} err
 * @param {string} [context]
 */
function mobileError(opts, err, context = '') {
  const msg = err instanceof Error ? err.message : String(err)
  const suffix = context ? `${context}: ${msg}` : msg
  mobileLog(opts, 'MOBILE_ERROR', suffix)
}

/**
 * @param {MobileExecutorOpts | undefined} opts
 * @returns {boolean}
 */
function isMobileStopRequested(opts) {
  return opts?.signal?.aborted === true
}

/**
 * @param {MobileExecutorOpts | undefined} opts
 * @param {string} [stage]
 */
function throwIfMobileStopRequested(opts, stage = '') {
  if (!isMobileStopRequested(opts)) return
  const suffix = stage ? ` (${stage})` : ''
  throw new MobileScenarioStoppedError(`stop requested${suffix}`)
}

const MOBILE_SWIPE_ARGS = ['shell', 'input', 'swipe', '720', '1900', '720', '600', '500']
const MOBILE_LIKE_ARGS = ['shell', 'input', 'tap', '1360', '1750']

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleepMs(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/**
 * Sleep in short chunks so /mobile/stop can abort a running scenario promptly.
 *
 * @param {number} totalMs
 * @param {MobileExecutorOpts | undefined} opts
 * @returns {Promise<void>}
 */
async function sleepWithStopChecks(totalMs, opts) {
  const sleep = opts?.sleep ?? sleepMs
  let remaining = Math.max(0, totalMs)
  throwIfMobileStopRequested(opts, 'before_sleep')
  while (remaining > 0) {
    const chunkMs = Math.min(remaining, MOBILE_STOP_CHECK_INTERVAL_MS)
    await sleep(chunkMs)
    remaining -= chunkMs
    throwIfMobileStopRequested(opts, 'during_sleep')
  }
  throwIfMobileStopRequested(opts, 'after_sleep')
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {string} name
 * @param {number} defaultValue
 * @param {{ min?: number, max?: number }} [bounds]
 */
function readMobileEnvInt(env, name, defaultValue, bounds = {}) {
  const raw = String(env[name] ?? '').trim()
  if (!raw) return defaultValue
  if (!/^-?\d+$/.test(raw)) {
    throw new Error(`${name} must be an integer`)
  }
  const value = Number.parseInt(raw, 10)
  if (bounds.min != null && value < bounds.min) {
    throw new Error(`${name} must be >= ${bounds.min}`)
  }
  if (bounds.max != null && value > bounds.max) {
    throw new Error(`${name} must be <= ${bounds.max}`)
  }
  return value
}

/**
 * @param {number} minMs
 * @param {number} maxMs
 * @param {() => number} random
 */
function randomBetween(minMs, maxMs, random) {
  if (maxMs <= minMs) return minMs
  const ratio = Math.min(1, Math.max(0, Number.isFinite(random()) ? random() : 0))
  return Math.floor(minMs + ratio * (maxMs - minMs))
}

/**
 * @param {NodeJS.ProcessEnv} env
 */
function getMobileScenarioConfig(env) {
  const swipesCount = readMobileEnvInt(env, 'MOBILE_SWIPES_COUNT', 20, { min: 1 })
  const viewMinMs = readMobileEnvInt(env, 'MOBILE_VIEW_MIN_MS', 5000, { min: 0 })
  const viewMaxMs = readMobileEnvInt(env, 'MOBILE_VIEW_MAX_MS', 10000, { min: 0 })
  const likeChance = readMobileEnvInt(env, 'MOBILE_LIKE_CHANCE', 10, { min: 0, max: 100 })
  if (viewMaxMs < viewMinMs) {
    throw new Error('MOBILE_VIEW_MAX_MS must be >= MOBILE_VIEW_MIN_MS')
  }
  return { swipesCount, viewMinMs, viewMaxMs, likeChance }
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
 * `adb shell monkey` can fail without a non-zero exit code, for example:
 *   "** No activities found to run, monkey aborted."
 * Treat these stdout/stderr markers as hard failures so the API does not
 * report MOBILE_APP_OPENED when the app never launched.
 *
 * @param {{ stdout?: string; stderr?: string }} result
 */
function assertMonkeyLaunchOk(result) {
  assertAdbOk(result)
  const combined = [String(result.stdout ?? '').trim(), String(result.stderr ?? '').trim()]
    .filter(Boolean)
    .join('\n')
  if (/no activities found to run/i.test(combined) || /monkey aborted/i.test(combined)) {
    throw new Error(combined || 'adb monkey aborted')
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

/**
 * @param {MobileExecutorOpts | undefined} opts
 */
function ensureSessionStarted(opts) {
  if (sessionStarted) return
  mobileLog(opts, 'MOBILE_EXECUTOR_STARTED')
  sessionStarted = true
}

/**
 * @param {MobileExecutorOpts} [opts]
 */
export async function mobileCheckDevice(opts = {}) {
  ensureSessionStarted(opts)
  try {
    const { deviceId, rows } = await resolveMobileDevice(opts)
    mobileLog(
      opts,
      'MOBILE_DEVICE_FOUND',
      `id=${deviceId} online=${filterOnlineDevices(rows).length}`,
    )
    return { ok: true, deviceId, deviceCount: rows.length, onlineCount: filterOnlineDevices(rows).length }
  } catch (err) {
    mobileError(opts, err, 'check_device')
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * @param {MobileExecutorOpts} [opts]
 */
export async function mobileOpenApp(opts = {}) {
  ensureSessionStarted(opts)
  const env = opts.env ?? process.env
  const pkg = String(env.MOBILE_APP_PACKAGE ?? '').trim()
  if (!pkg) {
    const msg = 'MOBILE_APP_PACKAGE is not set'
    mobileError(opts, msg, 'open_app')
    return { ok: false, error: msg }
  }
  try {
    const { deviceId } = await resolveMobileDevice(opts)
    const result = await runAdb(
      deviceId,
      ['shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1'],
      opts,
    )
    assertMonkeyLaunchOk(result)
    mobileLog(opts, 'MOBILE_APP_OPENED', `package=${pkg} device=${deviceId}`)
    return { ok: true, deviceId, package: pkg }
  } catch (err) {
    mobileError(opts, err, 'open_app')
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Backend-only ADB scenario:
 * open app -> wait -> swipe -> wait -> optional like -> repeat.
 *
 * @param {MobileExecutorOpts} [opts]
 */
export async function mobileRunScenario(opts = {}) {
  ensureSessionStarted(opts)
  const env = opts.env ?? process.env
  const random = opts.random ?? Math.random
  try {
    const config = getMobileScenarioConfig(env)
    const open = await mobileOpenApp(opts)
    if (!open.ok) {
      return { ok: false, step: 'open_app', error: open.error ?? 'open_app failed' }
    }

    let likes = 0
    for (let iteration = 1; iteration <= config.swipesCount; iteration += 1) {
      throwIfMobileStopRequested(opts, `loop_start iteration=${iteration}`)
      const beforeSwipeWaitMs = randomBetween(config.viewMinMs, config.viewMaxMs, random)
      mobileLog(opts, 'MOBILE_VIEW', `iteration=${iteration} stage=before_swipe waitMs=${beforeSwipeWaitMs}`)
      await sleepWithStopChecks(beforeSwipeWaitMs, opts)

      throwIfMobileStopRequested(opts, `before_swipe iteration=${iteration}`)
      const swipeResult = await runAdb(open.deviceId, MOBILE_SWIPE_ARGS, opts)
      assertAdbOk(swipeResult)
      mobileLog(opts, 'MOBILE_SWIPE', `iteration=${iteration} x1=720 y1=1900 x2=720 y2=600 durationMs=500`)

      const afterSwipeWaitMs = randomBetween(config.viewMinMs, config.viewMaxMs, random)
      mobileLog(opts, 'MOBILE_VIEW', `iteration=${iteration} stage=after_swipe waitMs=${afterSwipeWaitMs}`)
      await sleepWithStopChecks(afterSwipeWaitMs, opts)

      if (random() * 100 < config.likeChance) {
        throwIfMobileStopRequested(opts, `before_like iteration=${iteration}`)
        const likeResult = await runAdb(open.deviceId, MOBILE_LIKE_ARGS, opts)
        assertAdbOk(likeResult)
        likes += 1
        mobileLog(opts, 'MOBILE_LIKE', `iteration=${iteration} x=1360 y=1750`)
      }
    }

    mobileLog(
      opts,
      'MOBILE_DONE',
      `device=${open.deviceId} package=${open.package} swipes=${config.swipesCount} likes=${likes}`,
    )
    return {
      ok: true,
      deviceId: open.deviceId,
      package: open.package,
      swipes: config.swipesCount,
      likes,
    }
  } catch (err) {
    if (err instanceof MobileScenarioStoppedError) {
      return {
        ok: false,
        stopped: true,
        error: 'stopped',
      }
    }
    mobileError(opts, err, 'scenario')
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Ends mobile executor session; optionally force-stops MOBILE_APP_PACKAGE when set.
 * @param {MobileExecutorOpts} [opts]
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
    mobileError(opts, err, 'stop_force_stop')
  } finally {
    if (hadSession) {
      mobileLog(opts, 'MOBILE_EXECUTOR_STOPPED')
    }
    sessionStarted = false
  }
  return { ok: true }
}

/**
 * @param {MobileExecutorCommand} command
 * @param {MobileExecutorOpts} [opts]
 */
export async function runMobileExecutorCommand(command, opts = {}) {
  switch (command) {
    case 'check_device':
      return mobileCheckDevice(opts)
    case 'open_app':
      return mobileOpenApp(opts)
    case 'scenario':
      return mobileRunScenario(opts)
    case 'stop':
      return mobileStop(opts)
    default:
      mobileError(opts, `unknown command: ${command}`, 'runMobileExecutorCommand')
      return { ok: false, error: `unknown command: ${command}` }
  }
}

/** Test-only reset of session flag */
export function _resetMobileExecutorSessionForTests() {
  sessionStarted = false
}
