import { Router } from 'express'
import { db, newId } from '../db.js'
import { createMuMuProfile, launchMuMuProfile } from '../executor/mobile/mumuManager.js'
import { accountCreatePayload, accountPatchPayload } from '../requestFields.js'
import { sendJsonData, sendJsonError, sendJsonRow, sendJsonSuccess } from '../sendJson.js'

const router = Router()

function normalizeAccountRow(row) {
  if (!row || typeof row !== 'object') return row
  const acc = { ...row }
  if (acc.device_id == null) acc.device_id = acc.mobile_device_id ?? ''
  if (acc.emulator_name == null) acc.emulator_name = acc.mobile_emulator_name ?? ''
  if (acc.emulator_index == null) acc.emulator_index = acc.mobile_vm_index ?? ''
  return acc
}

router.get('/', (_req, res) => {
  const rows = db.prepare('SELECT * FROM accounts ORDER BY created_at DESC').all()
  return sendJsonData(res, 200, rows.map(normalizeAccountRow))
})

router.post('/', (req, res) => {
  const {
    name,
    login,
    cookies,
    platform,
    proxy_id,
    browser_profile_id,
    browser_engine,
    status,
    account_type,
    device_id,
    emulator_name,
    emulator_index,
  } = accountCreatePayload(req.body)
  const id = newId('acc')
  try {
    db.prepare(
      `INSERT INTO accounts (
        id, name, login, cookies, platform, proxy_id, browser_profile_id, browser_engine, status,
        account_type, mobile_device_id, mobile_emulator_name, mobile_vm_index
      )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      name,
      login,
      cookies,
      platform,
      proxy_id,
      browser_profile_id,
      browser_engine,
      status,
      account_type,
      device_id,
      emulator_name,
      emulator_index,
    )
  } catch (e) {
    const code = e && typeof e === 'object' && 'code' in e ? String(/** @type {{ code?: string }} */ (e).code) : ''
    const msg = e instanceof Error ? e.message : String(e)
    if (code.includes('SQLITE_CONSTRAINT') || msg.includes('FOREIGN KEY')) {
      return sendJsonError(
        res,
        400,
        'Invalid proxy or browser profile: pick existing items from the lists or choose “None”.',
      )
    }
    console.error(e)
    return sendJsonError(res, 500, 'Internal server error')
  }
  const row = normalizeAccountRow(db.prepare('SELECT * FROM accounts WHERE id = ?').get(id))
  return sendJsonRow(res, 201, row, 'Account missing after insert')
})

router.post('/mumu', async (_req, res) => {
  const id = newId('acc')
  try {
    const created = await createMuMuProfile({ nameHint: `MuMu ${id.slice(-4)}` })
    const name = created.emulatorName || `MuMu ${created.emulatorIndex}`
    db.prepare(
      `INSERT INTO accounts (
        id, name, login, cookies, platform, proxy_id, browser_profile_id, browser_engine, status,
        account_type, mobile_device_id, mobile_emulator_name, mobile_vm_index
      )
       VALUES (?, ?, '', '', 'TikTok', NULL, NULL, 'chromium', 'setup_required', 'mobile', ?, ?, ?)`,
    ).run(id, name, created.deviceId, created.emulatorName, created.emulatorIndex)

    const launched = await launchMuMuProfile({ emulatorIndex: created.emulatorIndex })
    db.prepare(
      `UPDATE accounts
          SET mobile_device_id = ?, mobile_emulator_name = ?, mobile_vm_index = ?
        WHERE id = ?`,
    ).run(launched.deviceId, launched.emulatorName, launched.emulatorIndex, id)

    const row = normalizeAccountRow(db.prepare('SELECT * FROM accounts WHERE id = ?').get(id))
    return sendJsonRow(res, 201, row, 'MuMu account missing after create')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return sendJsonError(res, 500, msg)
  }
})

router.patch('/:id', (req, res) => {
  const { id } = req.params
  const existing = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id)
  if (!existing) return sendJsonError(res, 404, 'Not found')

  const allowed = [
    'name',
    'login',
    'cookies',
    'platform',
    'proxy_id',
    'browser_profile_id',
    'browser_engine',
    'status',
    'account_type',
    'mobile_device_id',
    'mobile_emulator_name',
    'mobile_vm_index',
  ]
  const normalized = accountPatchPayload(req.body)
  const updates = {}
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(normalized, key)) updates[key] = normalized[key]
  }
  if (Object.keys(updates).length === 0) {
    return sendJsonData(res, 200, normalizeAccountRow(existing))
  }
  const cols = Object.keys(updates)
  const setClause = cols.map((c) => `${c} = @${c}`).join(', ')
  db.prepare(`UPDATE accounts SET ${setClause} WHERE id = @id`).run({
    ...updates,
    id,
  })
  const updated = normalizeAccountRow(db.prepare('SELECT * FROM accounts WHERE id = ?').get(id))
  return sendJsonRow(res, 200, updated, 'Account missing after update')
})

router.delete('/:id', (req, res) => {
  const { id } = req.params
  const r = db.prepare('DELETE FROM accounts WHERE id = ?').run(id)
  if (r.changes === 0) return sendJsonError(res, 404, 'Not found')
  return sendJsonSuccess(res)
})

export default router
