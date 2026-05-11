import { Router } from 'express'
import { runAdbDevices } from '../executor/mobile/adbRunner.js'
import {
  assignFreeEmulatorToMobileAccount,
  bindEmulatorToAccount,
  createEmulatorRecord,
  listEmulatorsWithAccounts,
  syncEmulatorsFromAdb,
} from '../services/emulatorRegistry.js'
import { controlLaunchEmulator, controlOpenEmulatorWindow, controlShutdownEmulator } from '../services/emulatorControl.js'
import { sendJsonData, sendJsonError } from '../sendJson.js'

const router = Router()

router.get('/', (_req, res) => {
  return sendJsonData(res, 200, listEmulatorsWithAccounts())
})

router.post('/sync', async (_req, res) => {
  try {
    const stdout = await runAdbDevices({})
    syncEmulatorsFromAdb(stdout)
    return sendJsonData(res, 200, { ok: true, devices: listEmulatorsWithAccounts() })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return sendJsonError(res, 500, msg)
  }
})

router.post('/', (req, res) => {
  try {
    const name = req.body?.emulator_name != null ? String(req.body.emulator_name).trim() : ''
    const inst = req.body?.mumu_instance_name != null ? String(req.body.mumu_instance_name).trim() : ''
    const row = createEmulatorRecord(name, inst)
    return sendJsonData(res, 201, row)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return sendJsonError(res, 400, msg)
  }
})

router.post('/assign', (req, res) => {
  const accountId = req.body?.accountId != null ? String(req.body.accountId).trim() : ''
  if (!accountId) {
    return sendJsonError(res, 400, 'accountId is required')
  }
  const assigned = assignFreeEmulatorToMobileAccount(accountId)
  if (!assigned) {
    return sendJsonError(res, 409, 'No free online emulator with adb_serial (launch an emulator or run Sync)')
  }
  return sendJsonData(res, 200, { ok: true, adb_serial: assigned.adb_serial })
})

router.post('/:id/launch', async (req, res) => {
  const id = String(req.params.id ?? '').trim()
  if (!id) return sendJsonError(res, 400, 'id is required')
  try {
    const result = await controlLaunchEmulator(id, {})
    return sendJsonData(res, 200, { ok: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return sendJsonError(res, 500, msg)
  }
})

router.post('/:id/shutdown', async (req, res) => {
  const id = String(req.params.id ?? '').trim()
  if (!id) return sendJsonError(res, 400, 'id is required')
  try {
    await controlShutdownEmulator(id, {})
    return sendJsonData(res, 200, { ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return sendJsonError(res, 500, msg)
  }
})

router.post('/:id/open', async (req, res) => {
  const id = String(req.params.id ?? '').trim()
  if (!id) return sendJsonError(res, 400, 'id is required')
  try {
    await controlOpenEmulatorWindow(id, {})
    return sendJsonData(res, 200, { ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return sendJsonError(res, 500, msg)
  }
})

router.post('/:id/bind', async (req, res) => {
  const id = String(req.params.id ?? '').trim()
  const accountId = req.body?.accountId != null ? String(req.body.accountId).trim() : ''
  if (!id || !accountId) {
    return sendJsonError(res, 400, 'emulator id and accountId are required')
  }
  try {
    await bindEmulatorToAccount(id, accountId, {})
    return sendJsonData(res, 200, { ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return sendJsonError(res, 400, msg)
  }
})

export default router
