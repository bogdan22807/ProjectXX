import { Router } from 'express'
import { db, newId } from '../db.js'
import { createMuMuProfile, launchMuMuProfile } from '../executor/mobile/mumuManager.js'
import { accountCreatePayload, accountPatchPayload } from '../requestFields.js'
import { sendJsonData, sendJsonError, sendJsonRow, sendJsonSuccess } from '../sendJson.js'

const router = Router()
const getProxyByIdStmt = db.prepare('SELECT id FROM proxies WHERE id = ?')
const getBrowserProfileByIdStmt = db.prepare('SELECT id FROM browser_profiles WHERE id = ?')

function normalizeNullableId(value) {
  if (value == null) return null
  const trimmed = String(value).trim()
  return trimmed ? trimmed : null
}

function normalizeAccountRow(row) {
  if (!row || typeof row !== 'object') return row
  const acc = { ...row }
  if (acc.mode == null) acc.mode = acc.mobile_mode ?? 'mumu'
  if (acc.mobile_proxy_id == null) acc.mobile_proxy_id = ''
  if (acc.device_id == null) acc.device_id = acc.mobile_device_id ?? ''
  if (acc.emulator_name == null) acc.emulator_name = acc.mobile_emulator_name ?? ''
  if (acc.emulator_index == null) acc.emulator_index = acc.mobile_vm_index ?? ''
  return acc
}

function isConstraintError(err) {
  const code =
    err && typeof err === 'object' && 'code' in err ? String(/** @type {{ code?: string }} */ (err).code ?? '') : ''
  const msg = err instanceof Error ? err.message : String(err)
  return code.includes('SQLITE_CONSTRAINT') || msg.includes('FOREIGN KEY')
}

function constraintAccountMessage(err) {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg.includes('NOT NULL')) {
    return 'Account save failed: a required text field was empty. This is usually a server bug; try again or report the error text.'
  }
  return 'Invalid proxy or browser profile: pick existing items from the lists or choose “None”.'
}

function normalizeAccountRelations({ account_type, proxy_id, browser_profile_id, mobile_proxy_id }) {
  const accountType = String(account_type ?? 'browser').trim().toLowerCase()
  const isMobile = accountType === 'mobile'
  const mobileProxyId = normalizeNullableId(mobile_proxy_id ?? (isMobile ? proxy_id : null))
  return {
    proxy_id: isMobile ? null : normalizeNullableId(proxy_id),
    browser_profile_id: isMobile ? null : normalizeNullableId(browser_profile_id),
    mobile_proxy_id: isMobile ? mobileProxyId ?? '' : '',
    account_type: isMobile ? 'mobile' : 'browser',
  }
}

function validateAccountRelations({ proxy_id, browser_profile_id, mobile_proxy_id, account_type }) {
  const accountType = String(account_type ?? 'browser').trim().toLowerCase()
  const isMobile = accountType === 'mobile'
  const proxyId = normalizeNullableId(proxy_id)
  const browserProfileId = normalizeNullableId(browser_profile_id)
  const mobileProxyId = normalizeNullableId(mobile_proxy_id)
  if (proxyId && !getProxyByIdStmt.get(proxyId)) {
    return 'Selected proxy_id was not found in the database. Choose an existing proxy ID or “None”.'
  }
  if (browserProfileId && !getBrowserProfileByIdStmt.get(browserProfileId)) {
    return 'Selected browser_profile_id was not found in the database. Choose an existing browser profile ID or “None”.'
  }
  if (isMobile && mobileProxyId && !getProxyByIdStmt.get(mobileProxyId)) {
    return 'Selected mobile proxy was not found in the database. Re-select the proxy from the list or choose “None”.'
  }
  return null
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
    mobile_mode,
    mobile_proxy_id,
    mobile_device_id,
    mobile_emulator_name,
    mobile_vm_index,
  } = accountCreatePayload(req.body)
  const id = newId('acc')
  const relations = normalizeAccountRelations({
    account_type,
    proxy_id,
    browser_profile_id,
    mobile_proxy_id,
  })
  const relationError = validateAccountRelations(relations)
  if (relationError) {
    return sendJsonError(res, 400, relationError)
  }
  try {
    db.prepare(
      `INSERT INTO accounts (
        id, name, login, cookies, platform, proxy_id, browser_profile_id, browser_engine, status,
        account_type, mobile_mode, mobile_proxy_id, mobile_device_id, mobile_emulator_name, mobile_vm_index
      )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      name,
      login,
      cookies,
      platform,
      relations.proxy_id,
      relations.browser_profile_id,
      browser_engine,
      status,
      relations.account_type,
      mobile_mode,
      relations.mobile_proxy_id,
      mobile_device_id,
      mobile_emulator_name,
      mobile_vm_index,
    )
  } catch (e) {
    if (isConstraintError(e)) {
      return sendJsonError(res, 400, constraintAccountMessage(e))
    }
    console.error(e)
    return sendJsonError(res, 500, 'Internal server error')
  }
  const row = normalizeAccountRow(db.prepare('SELECT * FROM accounts WHERE id = ?').get(id))
  return sendJsonRow(res, 201, row, 'Account missing after insert')
})

router.post('/mumu', async (_req, res) => {
  const id = newId('acc')
  if (process.platform === 'darwin') {
    try {
      const name = `Manual Android ${id.slice(-4)}`
      const defaultDeviceId = String(process.env.MOBILE_DEVICE_ID ?? '').trim()
      db.prepare(
        `INSERT INTO accounts (
          id, name, login, cookies, platform, proxy_id, browser_profile_id, browser_engine, status,
          account_type, mobile_mode, mobile_proxy_id, mobile_device_id, mobile_emulator_name, mobile_vm_index
        )
         VALUES (?, ?, '', '', 'TikTok', NULL, NULL, 'chromium', 'ready', 'mobile', 'manual', '', ?, ?, '')`,
      ).run(id, name, defaultDeviceId, 'Manual Android')

      const row = normalizeAccountRow(db.prepare('SELECT * FROM accounts WHERE id = ?').get(id))
      return sendJsonRow(res, 201, row, 'Manual mobile account missing after create')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return sendJsonError(res, 500, msg)
    }
  }
  try {
    const created = await createMuMuProfile({ nameHint: `MuMu ${id.slice(-4)}` })
    const name = created.emulatorName || `MuMu ${created.emulatorIndex}`
    db.prepare(
      `INSERT INTO accounts (
        id, name, login, cookies, platform, proxy_id, browser_profile_id, browser_engine, status,
        account_type, mobile_mode, mobile_proxy_id, mobile_device_id, mobile_emulator_name, mobile_vm_index
      )
       VALUES (?, ?, '', '', 'TikTok', NULL, NULL, 'chromium', 'setup_required', 'mobile', 'mumu', '', ?, ?, ?)`,
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
    'mobile_mode',
    'mobile_proxy_id',
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
  const normalizedRelations = normalizeAccountRelations({
    account_type: Object.prototype.hasOwnProperty.call(updates, 'account_type') ? updates.account_type : existing.account_type,
    proxy_id: Object.prototype.hasOwnProperty.call(updates, 'proxy_id') ? updates.proxy_id : existing.proxy_id,
    browser_profile_id: Object.prototype.hasOwnProperty.call(updates, 'browser_profile_id')
      ? updates.browser_profile_id
      : existing.browser_profile_id,
    mobile_proxy_id: Object.prototype.hasOwnProperty.call(updates, 'mobile_proxy_id')
      ? updates.mobile_proxy_id
      : existing.mobile_proxy_id,
  })
  updates.proxy_id = normalizedRelations.proxy_id
  updates.browser_profile_id = normalizedRelations.browser_profile_id
  updates.mobile_proxy_id = normalizedRelations.mobile_proxy_id
  updates.account_type = normalizedRelations.account_type
  const relationError = validateAccountRelations(normalizedRelations)
  if (relationError) {
    return sendJsonError(res, 400, relationError)
  }
  const cols = Object.keys(updates)
  const setClause = cols.map((c) => `${c} = @${c}`).join(', ')
  try {
    db.prepare(`UPDATE accounts SET ${setClause} WHERE id = @id`).run({
      ...updates,
      id,
    })
  } catch (e) {
    if (isConstraintError(e)) {
      return sendJsonError(res, 400, constraintAccountMessage(e))
    }
    console.error(e)
    return sendJsonError(res, 500, 'Internal server error')
  }
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
