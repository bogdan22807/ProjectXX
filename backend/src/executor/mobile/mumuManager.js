import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { filterOnlineDevices, parseAdbDevicesList } from './adbDevices.js'
import { runAdbDevices } from './adbRunner.js'

const execFileAsync = promisify(execFile)
const DEFAULT_MUMU_APP_NAME = 'MuMuPlayer'
/** @type {{ appName: string, appPath: string } | null} */
let cachedMuMuAppTarget = null

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
  const normalized = String(label ?? '').trim()
  if (!normalized) return ''
  if (/^\d+$/.test(normalized)) return normalized
  const androidDevice = normalized.match(/^android device(?:-(\d+))?$/i)
  if (androidDevice) return androidDevice[1] ? androidDevice[1] : '0'
  const tail = normalized.match(/(\d+)\s*$/)
  return tail?.[1] ? tail[1] : ''
}

function assertMacOsHost() {
  if (process.platform === 'darwin') return
  throw new Error('MuMu launch is configured for macOS only (required command: open -a "MuMuPlayer")')
}

function escapeAppleScriptString(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function uniqueNonEmpty(items) {
  const seen = new Set()
  const out = []
  for (const item of items) {
    const value = String(item ?? '').trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

function buildMuMuAppCandidates(instanceLabel, opts = {}) {
  const env = opts.env ?? process.env
  const fromEnv = String(env.MUMU_APP_NAME ?? '').trim()
  const fromOpts = String(opts.appName ?? '').trim()
  const fromPath = String(env.MUMU_APP_PATH ?? '').trim()
  const label = String(instanceLabel ?? '').trim()
  const withoutExtension = label.toLowerCase().endsWith('.app') ? label.slice(0, -4) : label
  const withoutVmTail = withoutExtension.replace(/-\d+\s*$/g, '').trim()
  const pathBase = path.basename(fromPath || '', '.app').trim()
  const cachedName = cachedMuMuAppTarget?.appName?.trim() || ''

  return uniqueNonEmpty([
    fromEnv,
    fromOpts,
    pathBase,
    cachedName,
    withoutExtension,
    withoutVmTail,
    DEFAULT_MUMU_APP_NAME,
    'MuMuPlayer Global',
    'MuMuPlayerGlobal',
    'NemuPlayer',
  ])
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

async function listMacAppBundles() {
  const appDirs = ['/Applications', path.join(os.homedir(), 'Applications')]
  /** @type {{ appName: string, appPath: string }[]} */
  const bundles = []

  for (const dir of appDirs) {
    let entries = []
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (!entry.name.toLowerCase().endsWith('.app')) continue
      bundles.push({
        appName: entry.name.slice(0, -4),
        appPath: path.join(dir, entry.name),
      })
    }
  }

  return bundles
}

/**
 * For macOS we treat account emulator label as user-facing metadata, while app launch
 * uses app name (`open -a`) and not VM control tools like MuMuManager.
 */
async function resolveMuMuAppTarget(instanceLabel, opts = {}) {
  const env = opts.env ?? process.env
  const explicitPath = String(env.MUMU_APP_PATH ?? '').trim()
  if (explicitPath) {
    const appName = path.basename(explicitPath, '.app').trim() || DEFAULT_MUMU_APP_NAME
    cachedMuMuAppTarget = { appName, appPath: explicitPath }
    return cachedMuMuAppTarget
  }

  if (cachedMuMuAppTarget) return cachedMuMuAppTarget

  const candidates = buildMuMuAppCandidates(instanceLabel, opts)
  const lowerCandidates = candidates.map((c) => c.toLowerCase())
  const bundles = await listMacAppBundles()

  for (const candidate of lowerCandidates) {
    const exact = bundles.find((b) => b.appName.toLowerCase() === candidate)
    if (exact) {
      cachedMuMuAppTarget = exact
      return exact
    }
  }

  for (const bundle of bundles) {
    const name = bundle.appName.toLowerCase()
    if (!/(mumu|nemu)/i.test(name)) continue
    if (lowerCandidates.some((candidate) => name.includes(candidate) || candidate.includes(name))) {
      cachedMuMuAppTarget = bundle
      return bundle
    }
  }

  const firstMuMu = bundles.find((b) => /(mumu|nemu)/i.test(b.appName))
  if (firstMuMu) {
    cachedMuMuAppTarget = firstMuMu
    return firstMuMu
  }

  for (const candidate of candidates) {
    if (await appInstalledOnMac(candidate, opts)) {
      cachedMuMuAppTarget = { appName: candidate, appPath: '' }
      return cachedMuMuAppTarget
    }
  }

  throw new Error(
    `MuMu app not found. Tried names: ${candidates.join(', ')}. Set MUMU_APP_NAME or MUMU_APP_PATH in backend env.`,
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

async function openMuMuTarget(target, opts = {}) {
  if (target.appPath) return runMacProcess('open', [target.appPath], opts)
  return runMacProcess('open', ['-a', target.appName], opts)
}

function buildMuMuToolCandidates(target, opts = {}) {
  const env = opts.env ?? process.env
  const explicit = String(env.MUMU_TOOL_PATH ?? opts.mumuToolPath ?? '').trim()
  const appPath = String(target?.appPath ?? '').trim()
  const fromApp = appPath
    ? [
        path.join(appPath, 'Contents', 'MacOS', 'mumutool'),
        path.join(appPath, 'Contents', 'Resources', 'mumutool'),
      ]
    : []
  return uniqueNonEmpty([explicit, ...fromApp, 'mumutool'])
}

async function runMuMuTool(args, target, opts = {}) {
  const candidates = buildMuMuToolCandidates(target, opts)
  let lastError = null
  for (const bin of candidates) {
    try {
      return await runMacProcess(bin, args, opts)
    } catch (err) {
      const code =
        err && typeof err === 'object' && 'code' in err ? String(/** @type {{ code?: string }} */ (err).code ?? '') : ''
      const msg = err instanceof Error ? err.message : String(err)
      if (code === 'ENOENT' || code === 'EACCES' || /command not found/i.test(msg)) {
        lastError = err
        continue
      }
      throw err
    }
  }
  throw (
    lastError ??
    new Error(
      `mumutool was not found. Set MUMU_TOOL_PATH, or install MuMu command-line tool. Tried: ${candidates.join(', ')}`,
    )
  )
}

function parseIndexFromMuMuInfo(raw, label) {
  const wanted = String(label ?? '').trim().toLowerCase()
  if (!wanted) return ''
  const text = String(raw ?? '')
  if (!text.trim()) return ''

  try {
    const parsed = JSON.parse(text)
    const rows = Array.isArray(parsed) ? parsed : [parsed]
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue
      const r = /** @type {Record<string, unknown>} */ (row)
      const vmName = String(r.vmName ?? r.name ?? '').trim().toLowerCase()
      const index = String(r.index ?? r.id ?? '').trim()
      if (vmName && vmName === wanted && index) return index
    }
  } catch {
    /* ignore non-JSON output */
  }

  const lines = text.split(/\r?\n/).map((line) => line.trim())
  for (const line of lines) {
    if (!line || !line.toLowerCase().includes(wanted)) continue
    const mNo = line.match(/NO\.?\s*(\d+)/i)
    if (mNo?.[1]) return mNo[1]
    const mIdx = line.match(/\bindex\s*[:=]\s*(\d+)/i)
    if (mIdx?.[1]) return mIdx[1]
    const mAny = line.match(/\b(\d+)\b/)
    if (mAny?.[1]) return mAny[1]
  }
  return ''
}

async function resolveMuMuInstanceIndex(instanceLabel, target, opts = {}) {
  const direct = parseIndexFromLabel(instanceLabel)
  if (direct) return direct
  try {
    const info = await runMuMuTool(['info', 'all'], target, { ...opts, timeoutMs: 25_000 })
    return parseIndexFromMuMuInfo(info.stdout, instanceLabel)
  } catch {
    return ''
  }
}

async function openMuMuInstanceWithBootstrap(instanceIndex, target, opts = {}) {
  const delayMs = opts.mumuBootstrapDelayMs ?? 1_200
  try {
    await runMuMuTool(['open', instanceIndex], target, opts)
    return { ok: true, bootstrapped: false }
  } catch (firstErr) {
    const firstMsg = firstErr instanceof Error ? firstErr.message : String(firstErr)
    emitLog(opts, 'MUMU_WARN', `mumutool open ${instanceIndex} failed on first attempt: ${firstMsg}`)

    // Bootstrap MuMu service first, then retry opening exact instance in the same request.
    await openMuMuTarget(target, opts)
    await sleepMs(delayMs)

    try {
      await runMuMuTool(['open', instanceIndex], target, opts)
      return { ok: true, bootstrapped: true }
    } catch (retryErr) {
      const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr)
      emitLog(opts, 'MUMU_WARN', `mumutool open ${instanceIndex} failed after bootstrap: ${retryMsg}`)
      return { ok: false, bootstrapped: true, error: retryErr }
    }
  }
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
  let target = await resolveMuMuAppTarget(instanceLabel, opts)
  const instanceIndex = await resolveMuMuInstanceIndex(instanceLabel, target, opts)
  let appAlreadyOpened = false
  if (instanceIndex) {
    const opened = await openMuMuInstanceWithBootstrap(instanceIndex, target, opts)
    appAlreadyOpened = opened.bootstrapped === true
    if (opened.ok) {
      emitLog(
        opts,
        'MUMU_LAUNCHED',
        `app=${target.appName} instance=${instanceIndex}${opened.bootstrapped ? ' bootstrap=yes' : ''}`,
      )
      return { appName: target.appName, instanceIndex }
    }
  }
  if (!appAlreadyOpened) {
    try {
      await openMuMuTarget(target, opts)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (/Unable to find application named/i.test(msg) || /does not exist/i.test(msg)) {
        cachedMuMuAppTarget = null
        target = await resolveMuMuAppTarget(instanceLabel, opts)
        await openMuMuTarget(target, opts)
      } else {
        throw new Error(`Failed to launch MuMu app "${target.appName}": ${msg}`)
      }
    }
  }
  emitLog(opts, 'MUMU_LAUNCHED', `app=${target.appName}${instanceIndex ? ` instance=${instanceIndex}` : ''}`)
  return { appName: target.appName, instanceIndex }
}

export async function mumuShowWindow(instanceLabel, opts = {}) {
  assertMacOsHost()
  let target = await resolveMuMuAppTarget(instanceLabel, opts)
  const instanceIndex = await resolveMuMuInstanceIndex(instanceLabel, target, opts)
  let appAlreadyOpened = false
  if (instanceIndex) {
    const opened = await openMuMuInstanceWithBootstrap(instanceIndex, target, opts)
    appAlreadyOpened = opened.bootstrapped === true
    if (opened.ok) {
      emitLog(
        opts,
        'MUMU_WINDOW_OPENED',
        `app=${target.appName} instance=${instanceIndex}${opened.bootstrapped ? ' bootstrap=yes' : ''}`,
      )
      return { appName: target.appName, instanceIndex }
    }
  }
  if (!appAlreadyOpened) {
    try {
      await openMuMuTarget(target, opts)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (/Unable to find application named/i.test(msg) || /does not exist/i.test(msg)) {
        cachedMuMuAppTarget = null
        target = await resolveMuMuAppTarget(instanceLabel, opts)
        await openMuMuTarget(target, opts)
      } else {
        throw err
      }
    }
  }
  emitLog(opts, 'MUMU_WINDOW_OPENED', `app=${target.appName}${instanceIndex ? ` instance=${instanceIndex}` : ''}`)
  return { appName: target.appName, instanceIndex }
}

export async function mumuShutdown(instanceLabel, opts = {}) {
  assertMacOsHost()
  const target = await resolveMuMuAppTarget(instanceLabel, opts)
  const appName = target.appName
  const instanceIndex = await resolveMuMuInstanceIndex(instanceLabel, target, opts)

  if (instanceIndex) {
    try {
      await runMuMuTool(['close', instanceIndex], target, opts)
      emitLog(opts, 'MUMU_SHUTDOWN', `app=${appName} instance=${instanceIndex}`)
      return { appName, instanceIndex }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      emitLog(opts, 'MUMU_WARN', `mumutool close ${instanceIndex} failed; fallback to app quit. ${msg}`)
    }
  }

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
  emitLog(opts, 'MUMU_SHUTDOWN', `app=${appName}${instanceIndex ? ` instance=${instanceIndex}` : ''}`)
  return { appName, instanceIndex }
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

  const emulatorIndex = String(launched.instanceIndex ?? '').trim() || parseIndexFromLabel(label)
  const emulatorName = label || launched.appName
  emitLog(opts, 'MUMU_EMULATOR_OPENED', `name=${emulatorName} adb_serial=${adbSerial}`)
  return {
    emulatorIndex,
    emulatorName,
    adbSerial,
  }
}
