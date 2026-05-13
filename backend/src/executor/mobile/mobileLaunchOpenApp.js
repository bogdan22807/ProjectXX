import { mobileOpenApp } from './mobileExecutor.js'

function sleepMs(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
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
 * }} opts
 */
export async function openMobileAppAfterLaunch(opts) {
  const adbSerial = String(opts?.adbSerial ?? '').trim()
  if (!adbSerial) throw new Error('adbSerial is required')

  const emit = opts?.emit
  const attempts = Math.max(1, Number.parseInt(String(opts?.attempts ?? 15), 10) || 15)
  const delayMs = Math.max(0, Number.parseInt(String(opts?.delayMs ?? 4_000), 10) || 4_000)
  const sleep = opts?.sleep ?? sleepMs
  const openApp = opts?.openApp ?? mobileOpenApp
  const env = { ...(opts?.env ?? process.env), MOBILE_DEVICE_ID: adbSerial }
  let lastError = ''

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await openApp({ env, emit })
    if (result.ok) {
      if (attempt > 1) {
        emit?.('MOBILE_APP_OPENED_AFTER_LAUNCH', `device=${adbSerial} attempt=${attempt} package=${result.package}`)
      }
      return result
    }

    lastError = String(result.error ?? 'open_app failed').trim() || 'open_app failed'
    if (attempt < attempts) {
      emit?.(
        'MOBILE_WARN',
        `launch auto-open attempt=${attempt}/${attempts} device=${adbSerial} failed: ${lastError}`,
      )
      await sleep(delayMs)
    }
  }

  throw new Error(`Could not auto-open mobile app after launch: ${lastError}`)
}
