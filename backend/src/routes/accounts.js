import { Router } from 'express'
import { db, newId } from '../db.js'
import { accountCreatePayload, accountPatchPayload } from '../requestFields.js'
import { sendJsonData, sendJsonError, sendJsonRow, sendJsonSuccess } from '../sendJson.js'

const router = Router()

router.get('/', (_req, res) => {
  const rows = db.prepare('SELECT * FROM accounts ORDER BY created_at DESC').all()
  return sendJsonData(res, 200, rows)
})

router.post('/', (req, res) => {
  const {
    name,
    login,
    cookies,
    platform,
    proxy_id,
    browser_profile_id,
    status,
  } = accountCreatePayload(req.body)
  const id = newId('acc')
  try {
    db.prepare(
      `INSERT INTO accounts (id, name, login, cookies, platform, proxy_id, browser_profile_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, name, login, cookies, platform, proxy_id, browser_profile_id, status)
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
  const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id)
  return sendJsonRow(res, 201, row, 'Account missing after insert')
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
    'status',
  ]
  const normalized = accountPatchPayload(req.body)
  const updates = {}
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(normalized, key)) updates[key] = normalized[key]
  }
  if (Object.keys(updates).length === 0) {
    return sendJsonData(res, 200, existing)
  }
  const cols = Object.keys(updates)
  const setClause = cols.map((c) => `${c} = @${c}`).join(', ')
  db.prepare(`UPDATE accounts SET ${setClause} WHERE id = @id`).run({
    ...updates,
    id,
  })
  const updated = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id)
  return sendJsonRow(res, 200, updated, 'Account missing after update')
})

router.delete('/:id', (req, res) => {
  const { id } = req.params
  const r = db.prepare('DELETE FROM accounts WHERE id = ?').run(id)
  if (r.changes === 0) return sendJsonError(res, 404, 'Not found')
  return sendJsonSuccess(res)
})

export default router
