import { Router } from 'express'
import { assignFreeAdbDeviceToAccount, listAdbDevices } from '../services/adbDeviceRegistry.js'
import { sendJsonData, sendJsonError } from '../sendJson.js'

const router = Router()

router.get('/', (_req, res) => {
  return sendJsonData(res, 200, listAdbDevices())
})

/**
 * POST body: { accountId: string } — bind first free online device to the mobile account.
 */
router.post('/assign', (req, res) => {
  const accountId = req.body?.accountId != null ? String(req.body.accountId).trim() : ''
  if (!accountId) {
    return sendJsonError(res, 400, 'accountId is required')
  }
  const assigned = assignFreeAdbDeviceToAccount(accountId)
  if (!assigned) {
    return sendJsonError(res, 409, 'No free online device available (wait for adb devices scan)')
  }
  return sendJsonData(res, 200, { ok: true, adb_serial: assigned.adb_serial })
})

export default router
