import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/**
 * @param {{ adbPath?: string; timeoutMs?: number }} [opts]
 * @returns {Promise<string>}
 */
export async function runAdbDevices(opts = {}) {
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
 * @param {string} adbSerial
 * @param {string[]} adbArgs
 * @param {{ adbPath?: string; timeoutMs?: number }} [opts]
 */
export async function runAdb(adbSerial, adbArgs, opts = {}) {
  const adb = opts.adbPath ?? 'adb'
  const timeoutMs = opts.timeoutMs ?? 60_000
  return execFileAsync(adb, ['-s', adbSerial, ...adbArgs], {
    timeout: timeoutMs,
    maxBuffer: 4 * 1024 * 1024,
    encoding: 'utf8',
    windowsHide: true,
  })
}
