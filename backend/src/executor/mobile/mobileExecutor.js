/**
 * Mobile QA executor: ADB against MuMu / Android (device detection, open app, stop session).
 * Does not depend on browser executor or DB-backed account logs — uses stdout markers for QA.
 */

import { filterOnlineDevices, parseAdbDevicesList } from './adbDevices.js'
import { runAdb, runAdbDevices } from './adbRunner.js'

export { runAdb, runAdbDevices } from './adbRunner.js'

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
 * @property {boolean} [skipOpenApp]
 * @property {{ deviceId: string, package: string }} [openedApp]
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

/** TikTok (global Android). Override with `MOBILE_APP_PACKAGE`. */
const DEFAULT_MOBILE_APP_PACKAGE = 'com.zhiliaoapp.musically'
const FALLBACK_MOBILE_APP_PACKAGES = ['com.zhiliaoapp.musically', 'com.ss.android.ugc.trill']
const KNOWN_TIKTOK_PACKAGES = [
  'com.zhiliaoapp.musically',
  'com.ss.android.ugc.trill',
  'com.ss.android.ugc.aweme',
  'com.ss.android.ugc.tiktok',
]

/**
 * @param {import('node:process').ProcessEnv | Record<string, string | undefined>} env
 * @returns {string}
 */
function resolveMobileAppPackage(env) {
  return resolveMobileAppPackages(env)[0] || DEFAULT_MOBILE_APP_PACKAGE
}

/**
 * @param {import('node:process').ProcessEnv | Record<string, string | undefined>} env
 * @returns {string[]}
 */
function resolveMobileAppPackages(env) {
  const single = String(env.MOBILE_APP_PACKAGE ?? '').trim()
  if (single) return [single]
  const list = String(env.MOBILE_APP_PACKAGES ?? '').trim()
  if (list) {
    const parsed = list
      .split(/[,\s]+/g)
      .map((item) => item.trim())
      .filter(Boolean)
    if (parsed.length > 0) return [...new Set(parsed)]
  }
  return [...FALLBACK_MOBILE_APP_PACKAGES]
}

/**
 * @param {string} stdout
 * @returns {string[]}
 */
function parseInstalledAndroidPackages(stdout) {
  return String(stdout ?? '')
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^package:/i, '').trim())
    .filter(Boolean)
}

/**
 * Resolve best TikTok package from installed apps on device.
 *
 * @param {string[]} requestedPackages
 * @param {string[]} installedPackages
 * @returns {string[]}
 */
function rankTikTokPackages(requestedPackages, installedPackages) {
  const installedSet = new Set(installedPackages)
  const ordered = []
  const push = (pkg) => {
    const p = String(pkg ?? '').trim()
    if (!p || ordered.includes(p) || !installedSet.has(p)) return
    ordered.push(p)
  }

  for (const pkg of requestedPackages) push(pkg)
  for (const pkg of KNOWN_TIKTOK_PACKAGES) push(pkg)
  for (const pkg of installedPackages) {
    const p = pkg.toLowerCase()
    if (p.includes('tiktok') || p.includes('musical') || p.includes('trill')) push(pkg)
  }
  return ordered
}

/**
 * @param {NodeJS.ProcessEnv} env
 */
function getMobileGestureConfig(env) {
  const swipeX1 = readMobileEnvInt(env, 'MOBILE_SWIPE_X1', 720)
  const swipeY1 = readMobileEnvInt(env, 'MOBILE_SWIPE_Y1', 1900)
  const swipeX2 = readMobileEnvInt(env, 'MOBILE_SWIPE_X2', 720)
  const swipeY2 = readMobileEnvInt(env, 'MOBILE_SWIPE_Y2', 600)
  const swipeDurationMs = readMobileEnvInt(env, 'MOBILE_SWIPE_DURATION_MS', 500, { min: 1 })
  const likeX = readMobileEnvInt(env, 'MOBILE_LIKE_X', 1332)
  const likeY = readMobileEnvInt(env, 'MOBILE_LIKE_Y', 1438)
  return {
    swipeArgs: [
      'shell',
      'input',
      'swipe',
      String(swipeX1),
      String(swipeY1),
      String(swipeX2),
      String(swipeY2),
      String(swipeDurationMs),
    ],
    likeArgs: ['shell', 'input', 'tap', String(likeX), String(likeY)],
    swipe: { x1: swipeX1, y1: swipeY1, x2: swipeX2, y2: swipeY2, durationMs: swipeDurationMs },
    like: { x: likeX, y: likeY },
  }
}

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
  const gestures = getMobileGestureConfig(env)
  if (viewMaxMs < viewMinMs) {
    throw new Error('MOBILE_VIEW_MAX_MS must be >= MOBILE_VIEW_MIN_MS')
  }
  return { swipesCount, viewMinMs, viewMaxMs, likeChance, gestures }
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
 * `adb shell am start ...` may print launch failures in stdout while still exiting with code 0.
 * Treat these markers as hard failures.
 *
 * @param {{ stdout?: string; stderr?: string }} result
 */
function assertAmStartOk(result) {
  assertAdbOk(result)
  const combined = [String(result.stdout ?? '').trim(), String(result.stderr ?? '').trim()]
    .filter(Boolean)
    .join('\n')
  if (
    /(^|\n)error:/i.test(combined) ||
    /activity (class|not found|does not exist)/i.test(combined) ||
    /unable to resolve intent/i.test(combined) ||
    /no activities found to run/i.test(combined) ||
    /monkey aborted/i.test(combined) ||
    /exception/i.test(combined)
  ) {
    throw new Error(combined || 'adb am start failed')
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
  const requestedPackages = resolveMobileAppPackages(env)
  try {
    const { deviceId } = await resolveMobileDevice(opts)
    let packages = [...requestedPackages]
    try {
      const packageListResult = await runAdb(deviceId, ['shell', 'pm', 'list', 'packages'], opts)
      assertAdbOk(packageListResult)
      const installed = parseInstalledAndroidPackages(packageListResult.stdout)
      const detected = rankTikTokPackages(requestedPackages, installed)
      if (detected.length > 0) {
        packages = detected
        mobileLog(opts, 'MOBILE_APP_DETECTED', `device=${deviceId} package=${detected[0]} variants=${detected.length}`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      mobileLog(opts, 'MOBILE_WARN', `open_app package discovery failed: ${msg}`)
    }
    let lastError = null
    for (let i = 0; i < packages.length; i += 1) {
      const pkg = packages[i]
      try {
        const monkeyResult = await runAdb(
          deviceId,
          ['shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1'],
          opts,
        )
        assertMonkeyLaunchOk(monkeyResult)
        mobileLog(opts, 'MOBILE_APP_OPENED', `package=${pkg} device=${deviceId} launch=monkey`)
        return { ok: true, deviceId, package: pkg }
      } catch (err) {
        try {
          const amResult = await runAdb(
            deviceId,
            ['shell', 'am', 'start', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER', '-p', pkg],
            opts,
          )
          assertAmStartOk(amResult)
          mobileLog(opts, 'MOBILE_APP_OPENED', `package=${pkg} device=${deviceId} launch=am`)
          return { ok: true, deviceId, package: pkg }
        } catch (amErr) {
          lastError = amErr
          if (i < packages.length - 1) {
            const msg = amErr instanceof Error ? amErr.message : String(amErr)
            mobileLog(opts, 'MOBILE_WARN', `open_app fallback package=${pkg} failed: ${msg}`)
          }
        }
      }
    }
    throw lastError ?? new Error('open_app failed for all configured packages')
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
    const preopened =
      opts.skipOpenApp && opts.openedApp?.deviceId && opts.openedApp?.package
        ? {
            ok: true,
            deviceId: String(opts.openedApp.deviceId).trim(),
            package: String(opts.openedApp.package).trim(),
          }
        : null
    const open = preopened ?? (await mobileOpenApp(opts))
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
      const swipeResult = await runAdb(open.deviceId, config.gestures.swipeArgs, opts)
      assertAdbOk(swipeResult)
      mobileLog(
        opts,
        'MOBILE_SWIPE',
        `iteration=${iteration} x1=${config.gestures.swipe.x1} y1=${config.gestures.swipe.y1} x2=${config.gestures.swipe.x2} y2=${config.gestures.swipe.y2} durationMs=${config.gestures.swipe.durationMs}`,
      )

      const afterSwipeWaitMs = randomBetween(config.viewMinMs, config.viewMaxMs, random)
      mobileLog(opts, 'MOBILE_VIEW', `iteration=${iteration} stage=after_swipe waitMs=${afterSwipeWaitMs}`)
      await sleepWithStopChecks(afterSwipeWaitMs, opts)

      if (random() * 100 < config.likeChance) {
        throwIfMobileStopRequested(opts, `before_like iteration=${iteration}`)
        const likeResult = await runAdb(open.deviceId, config.gestures.likeArgs, opts)
        assertAdbOk(likeResult)
        likes += 1
        mobileLog(opts, 'MOBILE_LIKE', `iteration=${iteration} x=${config.gestures.like.x} y=${config.gestures.like.y}`)
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
 * Ends mobile executor session; optionally force-stops the resolved app package (`MOBILE_APP_PACKAGE` or TikTok default).
 * @param {MobileExecutorOpts} [opts]
 */
export async function mobileStop(opts = {}) {
  const env = opts.env ?? process.env
  const forceStop = opts.forceStopApp !== false
  const pkg = resolveMobileAppPackage(env)
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
