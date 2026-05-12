import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { filterOnlineDevices, parseAdbDevicesList } from './adbDevices.js'
import { runAdbDevices } from './adbRunner.js'

const execFileAsync = promisify(execFile)
const DEFAULT_MUMU_APP_NAME = 'MuMuPlayer'
let cachedMuMuAppName = ''

function sleepMs(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function emitLog(opts, action, details = '') {
  const d = String(details ?? '').trim()
  if (d) console.log(action, d)
  else console.log(action)
  opts?.emit?.(action, d)
}

function parseIndexFromLabel(label) {
  const tail = String(label ?? '').trim().match(/(\d+)\s*$/)
  return tail?.[1] ? tail[1] : ''
}

function assertMacOsHost() {
  if (process.platform === 'darwin') return
  throw new Error('MuMu launch is configured for macOS only (required command: open -a "MuMuPlayer")')
}

function escapeAppleScriptString(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function buildMuMuAppCandidates(instanceLabel, opts = {}) {
  const env = opts.env ?? process.env
  const fromEnv = String(env.MUMU_APP_NAME ?? '').trim()
  const fromOpts = String(opts.appName ?? '').trim()
  const label = String(instanceLabel ?? '').trim()
  const withoutExtension = label.toLowerCase().endsWith('.app') ? label.slice(0, -4) : label
  const withoutVmTail = withoutExtension.replace(/-\d+\s*$/g, '').trim()

  const raw = [
    fromEnv,
    fromOpts,
    cachedMuMuAppName,
    withoutExtension,
    withoutVmTail,
    DEFAULT_MUMU_APP_NAME,
    'MuMuPlayer Global',
    'MuMuPlayerGlobal',
    'NemuPlayer',
  ]
  const seen = new Set()
  const out = []
  for (const item of raw) {
    const value = String(item ?? '').trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

async function appInstalledOnMac(appName, opts = {}) {
  try {
    await runMacProcess('osascript', ['-e', `id of application "${escapeAppleScriptString(appName)}"`], {
      ...opts,
      timeoutMs: 15_000,
    })
    return true
  } catch {
    return false
  }
}

/**
 * For macOS we treat account emulator label as user-facing metadata, while app launch
 * uses app name (`open -a`) and not VM control tools like MuMuManager.
 */
async function resolveMuMuAppName(instanceLabel, opts = {}) {
  const candidates = buildMuMuAppCandidates(instanceLabel, opts)
  for (const candidate of candidates) {
    if (await appInstalledOnMac(candidate, opts)) {
      cachedMuMuAppName = candidate
      return candidate
    }
  }
  throw new Error(
    `MuMu app not found in /Applications. Tried: ${candidates.join(', ')}. Set MUMU_APP_NAME in backend env if your app name differs.`,
  )
}

async function runMacProcess(bin, args, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 120_000
  return execFileAsync(bin, args, {
    timeout: timeoutMs,
    maxBuffer: 4 * 1024 * 1024,
    encoding: 'utf8',
    windowsHide: true,
  })
}

async function listOnlineAdbSerials(opts = {}) {
  const stdout = await runAdbDevices({ adbPath: opts.adbPath, timeoutMs: opts.timeoutMs })
  return filterOnlineDevices(parseAdbDevicesList(stdout)).map((row) => row.id)
}

function pickLikelyEmulatorSerial(serials) {
  const list = serials.map((s) => String(s ?? '').trim()).filter(Boolean)
  const localTcp = list.find((s) => /^(127\.0\.0\.1|localhost):\d+$/i.test(s))
  if (localTcp) return localTcp
  const emulator = list.find((s) => /^emulator-\d+$/i.test(s))
  if (emulator) return emulator
  return ''
}

async function waitForLaunchedAdbSerial(initialOnline, opts = {}) {
  const attempts = opts.adbSerialAttempts ?? 45
  const delayMs = opts.adbSerialDelayMs ?? 2_000
  const baseline = new Set(initialOnline.map((id) => String(id).trim()).filter(Boolean))

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const online = await listOnlineAdbSerials(opts)
    const newOnline = online.filter((id) => !baseline.has(id))
    if (newOnline.length > 0) return newOnline[0]
    const likely = pickLikelyEmulatorSerial(online)
    if (likely) return likely
    if (online.length === 1) return online[0]
    if (attempt < attempts) await sleepMs(delayMs)
  }

  throw new Error('Could not detect online adb device after MuMu launch')
}

export async function mumuLaunch(instanceLabel, opts = {}) {
  assertMacOsHost()
  const appName = await resolveMuMuAppName(instanceLabel, opts)
  try {
    await runMacProcess('open', ['-a', appName], opts)
  } catch (err) {
    throw new Error(`Failed to launch MuMu app "${appName}": ${err instanceof Error ? err.message : String(err)}`)
  }
  emitLog(opts, 'MUMU_LAUNCHED', `app=${appName}`)
  return { appName }
}

export async function mumuShowWindow(instanceLabel, opts = {}) {
  assertMacOsHost()
  const appName = await resolveMuMuAppName(instanceLabel, opts)
  await runMacProcess('open', ['-a', appName], opts)
  emitLog(opts, 'MUMU_WINDOW_OPENED', `app=${appName}`)
  return { appName }
}

export async function mumuShutdown(instanceLabel, opts = {}) {
  assertMacOsHost()
  const appName = await resolveMuMuAppName(instanceLabel, opts)

  try {
    await runMacProcess('osascript', ['-e', `tell application "${appName}" to quit`], opts)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!/application isn.?t running/i.test(message)) {
      throw err
    }
  }

  // Fallback for builds that ignore Apple Events or spawn helper processes.
  await runMacProcess('pkill', ['-f', appName], opts).catch(() => {})
  emitLog(opts, 'MUMU_SHUTDOWN', `app=${appName}`)
  return { appName }
}

/**
 * Launch MuMu by emulator label for account UX, then resolve ADB serial.
 * On macOS there is no MuMuManager VM API, so serial is detected via adb polling.
 */
export async function startMuMuByEmulatorLabel(instanceLabel, opts = {}) {
  const label = String(instanceLabel ?? '').trim()
  if (!label) throw new Error('mobile_emulator_name is required')

  const onlineBefore = await listOnlineAdbSerials(opts).catch(() => [])
  const launched = await mumuLaunch(label, opts)
  await mumuShowWindow(label, opts)
  const adbSerial = await waitForLaunchedAdbSerial(onlineBefore, opts)

  const emulatorIndex = parseIndexFromLabel(label)
  const emulatorName = label || launched.appName
  emitLog(opts, 'MUMU_EMULATOR_OPENED', `name=${emulatorName} adb_serial=${adbSerial}`)
  return {
    emulatorIndex,
    emulatorName,
    adbSerial,
  }
}
