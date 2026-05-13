import { Router } from 'express'
import { db, newId } from '../db.js'
import {
  mobileCheckDevice,
  mobileOpenApp,
  mobileRunScenario,
  mobileStop,
} from '../executor/mobile/mobileExecutor.js'
import {
  mumuShutdown,
  mumuShowWindow,
  startMuMuByEmulatorLabel,
} from '../executor/mobile/mumuManager.js'
import { openMobileAppAfterLaunch } from '../executor/mobile/mobileLaunchOpenApp.js'
import { sendJsonData, sendJsonError } from '../sendJson.js'

const router = Router()

/** In-memory ADB serial for this process only (not persisted). */
const ephemeralAdbSerial = new Map()

/** @type {Map<string, { deviceId: string, controller: AbortController, finished: Promise<void> }>} */
const activeMobileRuns = new Map()

function insertLog(accountId, action, details = '') {
  const id = newId('log')
  db.prepare(`INSERT INTO logs (id, account_id, action, details) VALUES (?, ?, ?, ?)`).run(
    id,
    accountId,
    String(action ?? '').trim() || '(empty)',
    String(details ?? ''),
  )
}

function getAccountById(accountId) {
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId)
}

function getMobileAccountOrError(accountId, res) {
  const account = getAccountById(accountId)
  if (!account) {
    sendJsonError(res, 404, 'Account not found')
    return null
  }
  if (String(account.account_type ?? 'browser').trim().toLowerCase() !== 'mobile') {
    sendJsonError(res, 400, 'This route requires account_type=mobile')
    return null
  }
  return account
}

function getMobileAccountMode(account) {
  return String(account?.mobile_mode ?? 'mumu')
    .trim()
    .toLowerCase() === 'manual'
    ? 'manual'
    : 'mumu'
}

function effectiveAdbSerial(accountId, accountRow) {
  const fromMem = ephemeralAdbSerial.get(String(accountId))?.trim()
  if (fromMem) return fromMem
  if (getMobileAccountMode(accountRow) === 'manual') {
    return String(accountRow.mobile_device_id ?? '').trim() || String(process.env.MOBILE_DEVICE_ID ?? '').trim()
  }
  return ''
}

function mobileEnvForAccount(accountId, accountRow) {
  const env = { ...process.env }
  const serial = effectiveAdbSerial(accountId, accountRow)
  if (serial) env.MOBILE_DEVICE_ID = serial
  return env
}

function readBooleanBodyFlag(body, camelKey, snakeKey, defaultValue) {
  const raw = body && typeof body === 'object'
    ? body[camelKey] ?? body[snakeKey]
    : undefined
  if (raw == null) return defaultValue
  if (typeof raw === 'boolean') return raw
  const normalized = String(raw).trim().toLowerCase()
  if (!normalized) return defaultValue
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false
  return defaultValue
}

async function handleMuMuOpenWindow(req, res) {
  const accountId = req.body?.accountId != null ? String(req.body.accountId).trim() : ''
  if (!accountId) return sendJsonError(res, 400, 'accountId is required')
  const account = getMobileAccountOrError(accountId, res)
  if (!account) return
  if (getMobileAccountMode(account) !== 'mumu') {
    return sendJsonError(res, 400, 'This route is only for MuMu mode')
  }
  const label = String(account.mobile_emulator_name ?? '').trim()
  if (!label) return sendJsonError(res, 400, 'mobile_emulator_name is required')
  const emit = (action, details) => insertLog(accountId, action, details)
  try {
    const opened = await mumuShowWindow(label, { emit })
    emit('MOBILE_OPEN_WINDOW', `label=${label} app=${opened.appName}`)
    return sendJsonData(res, 200, { ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    emit('MOBILE_ERROR', `open-window: ${msg}`)
    return sendJsonError(res, 500, msg)
  }
}

/**
 * POST { accountId, openApp? } — MuMu: launch VM by `mobile_emulator_name`,
 * discover adb serial, keep it in memory, and by default auto-open TikTok.
 */
router.post('/launch', async (req, res) => {
  const accountId = req.body?.accountId != null ? String(req.body.accountId).trim() : ''
  if (!accountId) return sendJsonError(res, 400, 'accountId is required')
  const account = getMobileAccountOrError(accountId, res)
  if (!account) return
  if (getMobileAccountMode(account) !== 'mumu') {
    return sendJsonError(res, 400, 'POST /mobile/launch is only for MuMu mode accounts')
  }
  const label = String(account.mobile_emulator_name ?? '').trim()
  if (!label) {
    return sendJsonError(res, 400, 'mobile_emulator_name is required (e.g. MuMuPlayer-2)')
  }
  const openAppAfterLaunch = readBooleanBodyFlag(req.body, 'openApp', 'open_app', true)
  const emit = (action, details) => insertLog(accountId, action, details)
  try {
    const launched = await startMuMuByEmulatorLabel(label, { emit })
    ephemeralAdbSerial.set(accountId, launched.adbSerial)
    db.prepare(
      `UPDATE accounts
          SET mobile_device_id = '',
              mobile_vm_index = ?,
              mobile_emulator_name = ?,
              status = 'running'
        WHERE id = ?`,
    ).run(String(launched.emulatorIndex ?? ''), String(launched.emulatorName ?? label), accountId)
    emit('MOBILE_LAUNCH', `label=${label} adb_serial=${launched.adbSerial}`)
    let openedPackage = ''
    if (openAppAfterLaunch) {
      const open = await openMobileAppAfterLaunch({
        adbSerial: launched.adbSerial,
        env: { ...process.env, MOBILE_DEVICE_ID: launched.adbSerial },
        emit,
      })
      openedPackage = String(open.package ?? '').trim()
    }
    return sendJsonData(res, 200, {
      ok: true,
      adb_serial: launched.adbSerial,
      emulator_index: launched.emulatorIndex,
      emulator_name: launched.emulatorName,
      package: openedPackage || undefined,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    db.prepare(`UPDATE accounts SET status = 'error' WHERE id = ?`).run(accountId)
    emit('MOBILE_ERROR', `launch: ${msg}`)
    return sendJsonError(res, 500, msg)
  }
})

/**
 * POST { accountId } — MuMu: shutdown VM by `mobile_emulator_name`, clear in-memory adb serial.
 */
router.post('/shutdown', async (req, res) => {
  const accountId = req.body?.accountId != null ? String(req.body.accountId).trim() : ''
  if (!accountId) return sendJsonError(res, 400, 'accountId is required')
  const account = getMobileAccountOrError(accountId, res)
  if (!account) return
  if (getMobileAccountMode(account) !== 'mumu') {
    return sendJsonError(res, 400, 'POST /mobile/shutdown is only for MuMu mode accounts')
  }
  const label = String(account.mobile_emulator_name ?? '').trim()
  if (!label) return sendJsonError(res, 400, 'mobile_emulator_name is required')
  const emit = (action, details) => insertLog(accountId, action, details)
  const serial = ephemeralAdbSerial.get(accountId)?.trim()
  const active = activeMobileRuns.get(accountId)
  try {
    if (active) {
      active.controller.abort()
    }
    if (serial) {
      try {
        await mobileStop({ emit, env: { ...process.env, MOBILE_DEVICE_ID: serial } })
      } catch {
        /* ignore */
      }
    }
    const shutdown = await mumuShutdown(label, { emit })
    if (active) {
      await Promise.race([active.finished, new Promise((resolve) => setTimeout(resolve, 2_000))])
    }
    ephemeralAdbSerial.delete(accountId)
    db.prepare(`UPDATE accounts SET mobile_device_id = '', status = 'stopped' WHERE id = ?`).run(accountId)
    emit('MOBILE_SHUTDOWN', `label=${label} app=${shutdown.appName}`)
    return sendJsonData(res, 200, { ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    emit('MOBILE_ERROR', `shutdown: ${msg}`)
    return sendJsonError(res, 500, msg)
  }
})

router.post('/open-window', handleMuMuOpenWindow)
router.post('/open-emulator', handleMuMuOpenWindow)

/**
 * POST body: { accountId: string }
 * Runs ADB check_device then open_app. MuMu requires prior POST /mobile/launch (ephemeral adb).
 */
router.post('/qa-open', async (req, res) => {
  const accountId = req.body?.accountId != null ? String(req.body.accountId).trim() : ''
  if (!accountId) {
    return sendJsonError(res, 400, 'accountId is required')
  }
  const row = getAccountById(accountId)
  if (!row) {
    return sendJsonError(res, 404, 'Account not found')
  }

  if (String(row.account_type ?? '').trim().toLowerCase() === 'mobile') {
    const serial = effectiveAdbSerial(accountId, row)
    if (!serial) {
      return sendJsonError(res, 400, 'No active adb session: use POST /mobile/launch first (MuMu)')
    }
  }

  const emit = (action, details) => {
    insertLog(accountId, action, details)
  }
  const opts = { emit, env: mobileEnvForAccount(accountId, row) }

  try {
    const check = await mobileCheckDevice(opts)
    if (!check.ok) {
      return sendJsonData(res, 200, {
        ok: false,
        step: 'check_device',
        error: check.error ?? 'check_device failed',
      })
    }

    const open = await mobileOpenApp(opts)
    if (!open.ok) {
      await mobileStop(opts)
      return sendJsonData(res, 200, {
        ok: false,
        step: 'open_app',
        deviceId: check.deviceId,
        error: open.error ?? 'open_app failed',
      })
    }

    return sendJsonData(res, 200, {
      ok: true,
      deviceId: open.deviceId,
      adb_serial: open.deviceId,
      package: open.package,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    emit('MOBILE_ERROR', `qa-open: ${msg}`)
    return sendJsonError(res, 500, msg)
  }
})

/**
 * POST body: { accountId: string }
 * Runs mobile ADB scenario. MuMu: requires POST /mobile/launch first (ephemeral adb).
 */
router.post('/scenario', async (req, res) => {
  const accountId = req.body?.accountId != null ? String(req.body.accountId).trim() : ''
  if (!accountId) {
    return sendJsonError(res, 400, 'accountId is required')
  }
  const row = getAccountById(accountId)
  if (!row) return sendJsonError(res, 404, 'Account not found')

  const emit = (action, details) => {
    insertLog(accountId, action, details)
  }
  if (activeMobileRuns.has(accountId)) {
    return sendJsonError(res, 409, 'Mobile scenario already active for this account')
  }
  const isMobileAccount = String(row.account_type ?? 'browser').trim().toLowerCase() === 'mobile'
  if (isMobileAccount) {
    const mode = getMobileAccountMode(row)
    const serial = effectiveAdbSerial(accountId, row)
    if (!serial) {
      return sendJsonError(
        res,
        400,
        mode === 'mumu'
          ? 'No adb session: click Launch (POST /mobile/launch) before running a scenario'
          : 'Manual mobile: set mobile_device_id on the account or MOBILE_DEVICE_ID in server env',
      )
    }
  }
  const opts = { emit, env: mobileEnvForAccount(accountId, row) }
  const deviceIdForRun =
    effectiveAdbSerial(accountId, row) || String(opts.env?.MOBILE_DEVICE_ID ?? '').trim()
  const controller = new AbortController()
  let finishRun = () => {}
  const finished = new Promise((resolve) => {
    finishRun = resolve
  })
  activeMobileRuns.set(accountId, { deviceId: deviceIdForRun, controller, finished })

  try {
    if (isMobileAccount) {
      db.prepare('UPDATE accounts SET status = ? WHERE id = ?').run('running', accountId)
    }
    const result = await mobileRunScenario({ ...opts, signal: controller.signal })
    if (result.stopped) {
      if (isMobileAccount) {
        db.prepare('UPDATE accounts SET status = ? WHERE id = ?').run('ready', accountId)
      }
      return sendJsonData(res, 200, {
        ok: true,
        stopped: true,
      })
    }
    if (!result.ok) {
      await mobileStop(opts)
      if (isMobileAccount) {
        db.prepare('UPDATE accounts SET status = ? WHERE id = ?').run('error', accountId)
      }
      return sendJsonData(res, 200, {
        ok: false,
        step: result.step ?? 'scenario',
        deviceId: result.deviceId,
        error: result.error ?? 'scenario failed',
      })
    }
    if (isMobileAccount) {
      db.prepare('UPDATE accounts SET status = ? WHERE id = ?').run('ready', accountId)
    }
    return sendJsonData(res, 200, {
      ok: true,
      deviceId: result.deviceId,
      package: result.package,
      swipes: result.swipes,
      likes: result.likes,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    emit('MOBILE_ERROR', `scenario: ${msg}`)
    return sendJsonError(res, 500, msg)
  } finally {
    activeMobileRuns.delete(accountId)
    finishRun()
  }
})

/**
 * POST body: { accountId: string }
 * Stops mobile scenario (abort + force-stop app on current adb session).
 */
router.post('/stop', async (req, res) => {
  const accountId = req.body?.accountId != null ? String(req.body.accountId).trim() : ''
  if (!accountId) {
    return sendJsonError(res, 400, 'accountId is required')
  }
  const row = getAccountById(accountId)
  if (!row) {
    return sendJsonError(res, 404, 'Account not found')
  }

  const emit = (action, details) => {
    insertLog(accountId, action, details)
  }
  const active = activeMobileRuns.get(accountId)

  try {
    if (active) {
      active.controller.abort()
    }
    await mobileStop({ emit, env: mobileEnvForAccount(accountId, row) })
    if (active) {
      await Promise.race([
        active.finished,
        new Promise((resolve) => setTimeout(resolve, 2_000)),
      ])
    }
    if (String(row.account_type ?? 'browser').trim().toLowerCase() === 'mobile') {
      db.prepare('UPDATE accounts SET status = ? WHERE id = ?').run('ready', accountId)
    }
    return sendJsonData(res, 200, { ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    emit('MOBILE_ERROR', `stop: ${msg}`)
    return sendJsonError(res, 500, msg)
  }
})

export default router
