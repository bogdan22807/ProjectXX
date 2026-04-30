import { Router } from 'express'
import { db, newId } from '../db.js'
import {
  mobileCheckDevice,
  mobileOpenApp,
  mobileRunScenario,
  mobileStop,
} from '../executor/mobile/mobileExecutor.js'
import { ensureMuMuAccountPrepared, launchMuMuAccountEmulator } from '../executor/mobile/mumuManager.js'
import { sendJsonData, sendJsonError } from '../sendJson.js'

const router = Router()

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

function mobileEnvForAccount(account) {
  const env = { ...process.env }
  const deviceId = String(account.mobile_device_id ?? '').trim()
  if (deviceId) env.MOBILE_DEVICE_ID = deviceId
  return env
}

/**
 * POST body: { accountId: string }
 * Runs ADB check_device then open_app (MuMu / QA). Uses process.env MOBILE_DEVICE_ID, MOBILE_APP_PACKAGE.
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

  const emit = (action, details) => {
    insertLog(accountId, action, details)
  }
  const opts = { emit, env: mobileEnvForAccount(row) }

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
 * Opens the MuMu emulator window for a mobile account.
 */
router.post('/open-emulator', async (req, res) => {
  const accountId = req.body?.accountId != null ? String(req.body.accountId).trim() : ''
  if (!accountId) {
    return sendJsonError(res, 400, 'accountId is required')
  }
  const account = getMobileAccountOrError(accountId, res)
  if (!account) return

  const emit = (action, details) => {
    insertLog(accountId, action, details)
  }

  try {
    const prepared = await ensureMuMuAccountPrepared(account, { emit })
    const opened = await launchMuMuAccountEmulator(prepared.account, { emit })
    return sendJsonData(res, 200, {
      ok: true,
      emulatorName: opened.emulatorName,
      deviceId: opened.deviceId,
      emulatorIndex: opened.emulatorIndex,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    emit('MOBILE_ERROR', `open-emulator: ${msg}`)
    return sendJsonError(res, 500, msg)
  }
})

/**
 * POST body: { accountId: string }
 * Marks a prepared MuMu/mobile account as ready for scenario runs.
 */
router.post('/mark-ready', (req, res) => {
  const accountId = req.body?.accountId != null ? String(req.body.accountId).trim() : ''
  if (!accountId) {
    return sendJsonError(res, 400, 'accountId is required')
  }
  const account = getMobileAccountOrError(accountId, res)
  if (!account) return

  const deviceId = String(account.mobile_device_id ?? '').trim()
  const emulatorName = String(account.mobile_emulator_name ?? '').trim()
  if (!deviceId || !emulatorName) {
    return sendJsonError(res, 400, 'Mobile account is missing deviceId/emulatorName')
  }

  db.prepare('UPDATE accounts SET status = ? WHERE id = ?').run('ready', accountId)
  insertLog(accountId, 'MOBILE_READY', `device=${deviceId} emulator=${emulatorName}`)
  return sendJsonData(res, 200, { ok: true, status: 'ready', deviceId, emulatorName })
})

/**
 * POST body: { accountId: string }
 * Runs mobile ADB scenario: open app -> random wait -> swipe -> random wait -> optional like.
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
  const isMobileAccount = String(row.account_type ?? 'browser').trim().toLowerCase() === 'mobile'
  let accountRow = row
  if (isMobileAccount) {
    if (String(accountRow.status ?? '').trim().toLowerCase() === 'setup_required') {
      return sendJsonError(res, 400, 'Mobile account must be saved as ready first')
    }
    try {
      const prepared = await ensureMuMuAccountPrepared(accountRow, { emit })
      const opened = await launchMuMuAccountEmulator(prepared.account, { emit })
      accountRow = opened.account
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      emit('MOBILE_ERROR', `scenario_prepare: ${msg}`)
      return sendJsonError(res, 500, msg)
    }
    const deviceId = String(accountRow.mobile_device_id ?? '').trim()
    if (!deviceId) {
      return sendJsonError(res, 400, 'Mobile account is missing deviceId')
    }
  }
  const opts = { emit, env: mobileEnvForAccount(accountRow) }

  try {
    if (isMobileAccount) {
      db.prepare('UPDATE accounts SET status = ? WHERE id = ?').run('running', accountId)
    }
    const result = await mobileRunScenario(opts)
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
  }
})

/**
 * POST body: { accountId: string }
 * Stops mobile session (force-stop when MOBILE_APP_PACKAGE is set).
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

  try {
    await mobileStop({ emit, env: mobileEnvForAccount(row) })
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
