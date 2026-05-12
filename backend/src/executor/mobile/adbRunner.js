import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
let cachedAdbPath = ''

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

function adbPathCandidates(explicitPath) {
  const env = process.env
  const fromSdkRoot = [env.ANDROID_SDK_ROOT, env.ANDROID_HOME]
    .map((root) => String(root ?? '').trim())
    .filter(Boolean)
    .map((root) => path.join(root, 'platform-tools', 'adb'))

  const darwinDefaults =
    process.platform === 'darwin'
      ? [
          '/opt/homebrew/bin/adb',
          '/usr/local/bin/adb',
          path.join(os.homedir(), 'Library/Android/sdk/platform-tools/adb'),
          path.join(os.homedir(), 'Android/Sdk/platform-tools/adb'),
        ]
      : []

  return uniqueNonEmpty([explicitPath, env.ADB_PATH, ...fromSdkRoot, ...darwinDefaults, 'adb'])
}

function isFileAvailable(filePath) {
  try {
    return fs.existsSync(filePath)
  } catch {
    return false
  }
}

async function runAdbCommand(adbArgs, opts = {}, defaultTimeoutMs = 25_000) {
  const timeoutMs = opts.timeoutMs ?? defaultTimeoutMs
  const candidates = adbPathCandidates(opts.adbPath)
  if (cachedAdbPath) candidates.unshift(cachedAdbPath)
  const tried = []

  for (const candidate of uniqueNonEmpty(candidates)) {
    if (candidate.includes('/') && !isFileAvailable(candidate)) continue
    tried.push(candidate)
    try {
      const result = await execFileAsync(candidate, adbArgs, {
        timeout: timeoutMs,
        maxBuffer: 4 * 1024 * 1024,
        encoding: 'utf8',
        windowsHide: true,
      })
      cachedAdbPath = candidate
      return result
    } catch (err) {
      const code =
        err && typeof err === 'object' && 'code' in err ? String(/** @type {{ code?: string }} */ (err).code ?? '') : ''
      if (code === 'ENOENT' || code === 'EACCES') continue
      throw err
    }
  }

  throw new Error(
    `adb executable not found. Install Android platform-tools and set ADB_PATH if needed. Tried: ${tried.join(', ') || '(none)'}`,
  )
}

/**
 * @param {{ adbPath?: string; timeoutMs?: number }} [opts]
 * @returns {Promise<string>}
 */
export async function runAdbDevices(opts = {}) {
  const { stdout, stderr } = await runAdbCommand(['devices'], opts, 25_000)
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
  return runAdbCommand(['-s', adbSerial, ...adbArgs], opts, 60_000)
}
