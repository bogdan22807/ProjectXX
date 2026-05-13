import { mobileOpenApp } from './mobileExecutor.js'
import { runAdb } from './adbRunner.js'

function sleepMs(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function normalizeOutput(result) {
  return [String(result?.stdout ?? '').trim(), String(result?.stderr ?? '').trim()].filter(Boolean).join('\n').trim()
}

function packageSeenInDumpsys(text, packageName) {
  const pkg = String(packageName ?? '').trim().toLowerCase()
  if (!pkg) return false
  const lines = String(text ?? '')
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
  return lines.some((line) => {
    const lower = line.toLowerCase()
    if (!lower.includes(pkg)) return false
    return /(mresumedactivity|topresumedactivity|mcurrentfocus|mfocusedapp|resumedactivity|focusedapp|realactivity=)/i.test(
      lower,
    )
  })
}

/**
 * Verify TikTok is actually present in the foreground/activity stack after open_app.
 *
 * @param {{
 *   adbSerial: string
 *   packageName: string
 *   sleep?: (ms: number) => Promise<void>
 *   verifyAttempts?: number
 *   verifyDelayMs?: number
 *   adbPath?: string
 *   timeoutMs?: number
 *   verifyRunAdb?: typeof runAdb
 * }} opts
 */
export async function verifyMobileAppOpened(opts) {
  const adbSerial = String(opts?.adbSerial ?? '').trim()
  const packageName = String(opts?.packageName ?? '').trim()
  if (!adbSerial) throw new Error('adbSerial is required')
  if (!packageName) throw new Error('packageName is required')

  const sleep = opts?.sleep ?? sleepMs
  const verifyAttempts = Math.max(1, Number.parseInt(String(opts?.verifyAttempts ?? 5), 10) || 5)
  const verifyDelayMs = Math.max(0, Number.parseInt(String(opts?.verifyDelayMs ?? 1_000), 10) || 1_000)
  const verifyRunAdb = opts?.verifyRunAdb ?? runAdb
  let lastError = ''

  for (let attempt = 1; attempt <= verifyAttempts; attempt += 1) {
    try {
      const activityResult = await verifyRunAdb(adbSerial, ['shell', 'dumpsys', 'activity', 'activities'], opts)
      if (packageSeenInDumpsys(normalizeOutput(activityResult), packageName)) {
        return { ok: true, method: 'activity' }
      }

      const windowResult = await verifyRunAdb(adbSerial, ['shell', 'dumpsys', 'window', 'windows'], opts)
      if (packageSeenInDumpsys(normalizeOutput(windowResult), packageName)) {
        return { ok: true, method: 'window' }
      }

      const pidofResult = await verifyRunAdb(adbSerial, ['shell', 'pidof', packageName], opts).catch(() => null)
      if (String(pidofResult?.stdout ?? '').trim()) {
        return { ok: true, method: 'pidof' }
      }

      lastError = `package=${packageName} was not detected in activity/window dumpsys`
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
    }

    if (attempt < verifyAttempts) {
      await sleep(verifyDelayMs)
    }
  }

  throw new Error(`verify open failed for ${packageName}: ${lastError || 'unknown error'}`)
}

/**
 * After MuMu exposes an ADB serial, Android may still be finishing boot.
 * Retry opening TikTok for a short window so launch can land inside the app.
 *
 * @param {{
 *   adbSerial: string
 *   env?: NodeJS.ProcessEnv
 *   emit?: (action: string, details?: string) => void
 *   attempts?: number
 *   delayMs?: number
 *   sleep?: (ms: number) => Promise<void>
 *   openApp?: typeof mobileOpenApp
 *   verifyAppOpened?: typeof verifyMobileAppOpened
 * }} opts
 */
export async function openMobileAppAfterLaunch(opts) {
  const adbSerial = String(opts?.adbSerial ?? '').trim()
  if (!adbSerial) throw new Error('adbSerial is required')

  const emit = opts?.emit
  const attempts = Math.max(1, Number.parseInt(String(opts?.attempts ?? 3), 10) || 3)
  const delayMs = Math.max(0, Number.parseInt(String(opts?.delayMs ?? 4_000), 10) || 4_000)
  const sleep = opts?.sleep ?? sleepMs
  const openApp = opts?.openApp ?? mobileOpenApp
  const verifyAppOpened = opts?.verifyAppOpened ?? verifyMobileAppOpened
  const env = { ...(opts?.env ?? process.env), MOBILE_DEVICE_ID: adbSerial }
  const requestedPackage = String(env.MOBILE_APP_PACKAGE ?? 'com.zhiliaoapp.musically').trim() || 'com.zhiliaoapp.musically'
  let lastError = ''

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    emit?.('TIKTOK_OPENING', `device=${adbSerial} package=${requestedPackage} attempt=${attempt}/${attempts}`)
    const result = await openApp({ env, emit })
    if (result.ok) {
      try {
        const verification = await verifyAppOpened({
          adbSerial: result.deviceId,
          packageName: result.package,
          sleep,
          adbPath: opts?.adbPath,
          timeoutMs: opts?.timeoutMs,
        })
        emit?.(
          'TIKTOK_OPENED',
          `device=${result.deviceId} package=${result.package} attempt=${attempt}/${attempts} verify=${verification.method}`,
        )
        return { ...result, verifiedBy: verification.method }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
      }
    } else {
      lastError = String(result.error ?? 'open_app failed').trim() || 'open_app failed'
    }

    if (attempt < attempts) {
      emit?.(
        'MOBILE_WARN',
        `launch auto-open attempt=${attempt}/${attempts} device=${adbSerial} failed: ${lastError}`,
      )
      await sleep(delayMs)
    }
  }

  throw new Error(`Could not auto-open mobile app after launch: ${lastError || 'unknown error'}`)
}
