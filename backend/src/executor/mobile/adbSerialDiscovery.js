import { filterOnlineDevices, parseAdbDevicesList } from './adbDevices.js'
import { runAdbDevices } from './adbRunner.js'

function sleepMs(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/**
 * Snapshot currently online ADB device ids (`adb devices`, state `device`).
 * @param {{ adbPath?: string; timeoutMs?: number }} [opts]
 * @returns {Promise<Set<string>>}
 */
export async function snapshotOnlineAdbSerialIds(opts = {}) {
  const runnerOpts = { adbPath: opts.adbPath, timeoutMs: opts.timeoutMs }
  const stdout = await runAdbDevices(runnerOpts)
  const online = filterOnlineDevices(parseAdbDevicesList(stdout))
  return new Set(online.map((r) => r.id))
}

/**
 * After an action that may attach a new emulator (e.g. `open` MuMu on macOS), wait until
 * `adb devices` shows an online serial that was not in `baselineIds`.
 *
 * @param {Set<string> | string[]} baselineIds
 * @param {{ attempts?: number; delayMs?: number; adbPath?: string; timeoutMs?: number }} [opts]
 * @returns {Promise<string>}
 */
export async function waitForNewOnlineAdbSerial(baselineIds, opts = {}) {
  const attempts = opts.attempts ?? 45
  const delayMs = opts.delayMs ?? 2_000
  const runnerOpts = { adbPath: opts.adbPath, timeoutMs: opts.timeoutMs }
  const baseline = baselineIds instanceof Set ? baselineIds : new Set(baselineIds ?? [])

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const stdout = await runAdbDevices(runnerOpts)
    const online = filterOnlineDevices(parseAdbDevicesList(stdout))
    const ids = online.map((r) => r.id)
    const newcomers = ids.filter((id) => !baseline.has(id))
    if (newcomers.length === 1) {
      return newcomers[0]
    }
    if (newcomers.length > 1) {
      console.warn(
        '[adb] multiple new online devices; picking first:',
        newcomers.join(', '),
      )
      return newcomers[0]
    }
    if (attempt < attempts) {
      await sleepMs(delayMs)
    }
  }
  throw new Error(
    'No new online ADB device appeared after launch (check adb, USB debugging, or MuMu ADB bridge)',
  )
}

/**
 * Wait until `adb devices` shows an online (`device` state) serial.
 * Prefer the exact MuMu-reported TCP serial (e.g. 127.0.0.1:16384) when it appears as a row id.
 *
 * @param {{ hintSerial?: string; attempts?: number; delayMs?: number; adbPath?: string; timeoutMs?: number }} [opts]
 * @returns {Promise<string>}
 */
export async function waitForOnlineAdbSerial(opts = {}) {
  const hint = String(opts.hintSerial ?? '').trim()
  const attempts = opts.attempts ?? 45
  const delayMs = opts.delayMs ?? 2_000
  const runnerOpts = { adbPath: opts.adbPath, timeoutMs: opts.timeoutMs }

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const stdout = await runAdbDevices(runnerOpts)
    const online = filterOnlineDevices(parseAdbDevicesList(stdout))
    if (hint) {
      const hit = online.find((r) => r.id === hint)
      if (hit) return hit.id
    } else if (online.length === 1) {
      return online[0].id
    }
    if (attempt < attempts) {
      await sleepMs(delayMs)
    }
  }
  throw new Error(
    hint
      ? `ADB serial "${hint}" did not appear as an online device in time`
      : 'Could not resolve a unique online ADB device (hint was empty and multiple/zero devices online)',
  )
}
