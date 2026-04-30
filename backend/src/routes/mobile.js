import { Router } from 'express'
import { db, newId } from '../db.js'
import { mobileCheckDevice, mobileOpenApp, mobileStop } from '../executor/mobile/mobileExecutor.js'
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

/**
 * POST body: { accountId: string }
 * Runs ADB check_device then open_app (MuMu / QA). Uses process.env MOBILE_DEVICE_ID, MOBILE_APP_PACKAGE.
 */
router.post('/qa-open', async (req, res) => {
  const accountId = req.body?.accountId != null ? String(req.body.accountId).trim() : ''
  if (!accountId) {
    return sendJsonError(res, 400, 'accountId is required')
  }
  const row = db.prepare('SELECT id FROM accounts WHERE id = ?').get(accountId)
  if (!row) {
    return sendJsonError(res, 404, 'Account not found')
  }

  const emit = (action, details) => {
    insertLog(accountId, action, details)
  }
  const opts = { emit }

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
 * Stops mobile session (force-stop when MOBILE_APP_PACKAGE is set).
 */
router.post('/stop', async (req, res) => {
  const accountId = req.body?.accountId != null ? String(req.body.accountId).trim() : ''
  if (!accountId) {
    return sendJsonError(res, 400, 'accountId is required')
  }
  const row = db.prepare('SELECT id FROM accounts WHERE id = ?').get(accountId)
  if (!row) {
    return sendJsonError(res, 404, 'Account not found')
  }

  const emit = (action, details) => {
    insertLog(accountId, action, details)
  }

  try {
    await mobileStop({ emit })
    return sendJsonData(res, 200, { ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    emit('MOBILE_ERROR', `stop: ${msg}`)
    return sendJsonError(res, 500, msg)
  }
})

export default router
