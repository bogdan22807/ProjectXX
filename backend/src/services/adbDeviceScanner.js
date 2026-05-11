import { runAdbDevices } from '../executor/mobile/adbRunner.js'
import { seedEmulatorsFromAccounts, syncEmulatorsFromAdb } from './emulatorRegistry.js'

let timerId = /** @type {ReturnType<typeof setInterval> | null} */ (null)

function readIntervalMs() {
  const raw = String(process.env.ADB_DEVICE_SCAN_INTERVAL_MS ?? '').trim()
  const n = raw ? Number.parseInt(raw, 10) : NaN
  if (Number.isFinite(n) && n >= 2000 && n <= 5000) return n
  if (Number.isFinite(n) && n >= 1000) return Math.min(Math.max(n, 2000), 10_000)
  return 3000
}

async function tick() {
  try {
    const stdout = await runAdbDevices({})
    syncEmulatorsFromAdb(stdout)
  } catch (err) {
    console.error('[adb-device-scanner]', err instanceof Error ? err.message : String(err))
  }
}

export function startAdbDeviceScanner() {
  if (timerId) return
  seedEmulatorsFromAccounts()
  void tick()
  timerId = setInterval(() => {
    void tick()
  }, readIntervalMs())
}

export function stopAdbDeviceScanner() {
  if (timerId) {
    clearInterval(timerId)
    timerId = null
  }
}
