import { filterOnlineDevices, parseAdbDevicesList } from './adbDevices.js'
import { runAdb, runAdbConnect, runAdbDevices } from './adbRunner.js'

function sleepMs(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function emitLog(emit, action, details = '') {
  emit?.(action, String(details ?? '').trim())
}

function isTcpAdbSerial(adbSerial) {
  const serial = String(adbSerial ?? '').trim()
  return Boolean(serial) && /^[a-z0-9.-]+:\d+$/i.test(serial) && !/^emulator-\d+$/i.test(serial)
}

async function listOnlineAdbSerials(opts = {}) {
  if (typeof opts.listOnlineAdbSerials === 'function') {
    return opts.listOnlineAdbSerials()
  }
  const stdout = await runAdbDevices({ adbPath: opts.adbPath, timeoutMs: opts.timeoutMs })
  return filterOnlineDevices(parseAdbDevicesList(stdout)).map((row) => row.id)
}

async function isAdbSerialOnline(adbSerial, opts = {}) {
  const online = await listOnlineAdbSerials(opts)
  return online.includes(String(adbSerial ?? '').trim())
}

function normalizeAdbText(result) {
  return [String(result?.stdout ?? '').trim(), String(result?.stderr ?? '').trim()].filter(Boolean).join('\n').trim()
}

function assertAdbConnectOk(adbSerial, result) {
  const text = normalizeAdbText(result)
  if (
    /unable to connect/i.test(text) ||
    /cannot connect/i.test(text) ||
    /failed to connect/i.test(text) ||
    /connection refused/i.test(text) ||
    /no route to host/i.test(text) ||
    /error:/i.test(text)
  ) {
    throw new Error(text || `adb connect ${adbSerial} failed`)
  }
  return text
}

async function waitForOnlineSerial(adbSerial, opts = {}) {
  const attempts = Math.max(1, Number.parseInt(String(opts.readyAttempts ?? 30), 10) || 30)
  const delayMs = Math.max(0, Number.parseInt(String(opts.readyDelayMs ?? 2_000), 10) || 2_000)
  const sleep = opts.sleep ?? sleepMs

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (await isAdbSerialOnline(adbSerial, opts)) return
    if (attempt < attempts) await sleep(delayMs)
  }

  throw new Error(`ADB device ${adbSerial} did not become online in time`)
}

async function waitForAndroidBoot(adbSerial, opts = {}) {
  const attempts = Math.max(1, Number.parseInt(String(opts.bootAttempts ?? 20), 10) || 20)
  const delayMs = Math.max(0, Number.parseInt(String(opts.bootDelayMs ?? 2_000), 10) || 2_000)
  const sleep = opts.sleep ?? sleepMs
  const runAdbWithSerial = opts.runAdbWithSerial ?? runAdb
  let lastError = ''

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const sys = String(
        (await runAdbWithSerial(adbSerial, ['shell', 'getprop', 'sys.boot_completed'], opts)).stdout ?? '',
      ).trim()
      const dev = String(
        (await runAdbWithSerial(adbSerial, ['shell', 'getprop', 'dev.bootcomplete'], opts)).stdout ?? '',
      ).trim()
      const bootAnim = String(
        (await runAdbWithSerial(adbSerial, ['shell', 'getprop', 'init.svc.bootanim'], opts)).stdout ?? '',
      ).trim()
      const bootComplete = sys === '1' || dev === '1'
      const animationStopped = !bootAnim || bootAnim === 'stopped'
      if (bootComplete && animationStopped) return
      lastError = `sys.boot_completed=${sys || '0'} dev.bootcomplete=${dev || '0'} init.svc.bootanim=${bootAnim || '(empty)'}`
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
    }
    if (attempt < attempts) await sleep(delayMs)
  }

  throw new Error(`ADB device ${adbSerial} is online but Android is not ready: ${lastError || 'boot incomplete'}`)
}

/**
 * Ensure the target serial is reachable via ADB and Android has finished booting.
 * For TCP serials like 127.0.0.1:16384, retry `adb connect` before polling device readiness.
 *
 * @param {{
 *   adbSerial: string
 *   emit?: (action: string, details?: string) => void
 *   sleep?: (ms: number) => Promise<void>
 *   adbPath?: string
 *   timeoutMs?: number
 *   connectAttempts?: number
 *   connectDelayMs?: number
 *   readyAttempts?: number
 *   readyDelayMs?: number
 *   bootAttempts?: number
 *   bootDelayMs?: number
 * }} opts
 */
export async function ensureMobileAdbReady(opts) {
  const adbSerial = String(opts?.adbSerial ?? '').trim()
  if (!adbSerial) throw new Error('adbSerial is required')

  const emit = opts?.emit
  const sleep = opts?.sleep ?? sleepMs
  const connectAttempts = Math.max(1, Number.parseInt(String(opts?.connectAttempts ?? 3), 10) || 3)
  const connectDelayMs = Math.max(0, Number.parseInt(String(opts?.connectDelayMs ?? 2_000), 10) || 2_000)
  const tcpSerial = isTcpAdbSerial(adbSerial)
  const connectAdb = opts?.connectAdb ?? runAdbConnect
  let connectMode = 'existing_online'
  let lastConnectError = ''

  if (!(await isAdbSerialOnline(adbSerial, opts).catch(() => false)) && tcpSerial) {
    connectMode = 'adb_connect'
    for (let attempt = 1; attempt <= connectAttempts; attempt += 1) {
      try {
        const connectResult = await connectAdb(adbSerial, opts)
        assertAdbConnectOk(adbSerial, connectResult)
        break
      } catch (err) {
        lastConnectError = err instanceof Error ? err.message : String(err)
        if (attempt < connectAttempts) {
          emitLog(emit, 'MOBILE_WARN', `adb connect attempt=${attempt}/${connectAttempts} device=${adbSerial} failed: ${lastConnectError}`)
          await sleep(connectDelayMs)
          continue
        }
        throw new Error(`adb connect ${adbSerial} failed: ${lastConnectError}`)
      }
    }
  }

  await waitForOnlineSerial(adbSerial, { ...opts, sleep })
  await waitForAndroidBoot(adbSerial, { ...opts, sleep })
  emitLog(emit, 'ADB_CONNECTED', `device=${adbSerial} mode=${connectMode}${lastConnectError ? ` last_error=${lastConnectError}` : ''}`)
  return { deviceId: adbSerial, mode: connectMode }
}
