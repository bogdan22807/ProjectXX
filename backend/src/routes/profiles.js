import { Router } from 'express'
import { db, newId } from '../db.js'
import { profileCreatePayload, profilePatchPayload } from '../requestFields.js'
import { sendJsonData, sendJsonError, sendJsonRow, sendJsonSuccess } from '../sendJson.js'

const router = Router()

router.get('/', (_req, res) => {
  const rows = db.prepare('SELECT * FROM browser_profiles ORDER BY created_at DESC').all()
  return sendJsonData(res, 200, rows)
})

router.post('/', (req, res) => {
  const { name, linked_proxy_id, linked_account_id, status } = profileCreatePayload(req.body)
  const id = newId('bp')
  db.prepare(
    `INSERT INTO browser_profiles (id, name, linked_proxy_id, linked_account_id, status)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, name, linked_proxy_id, linked_account_id, status)
  const row = db.prepare('SELECT * FROM browser_profiles WHERE id = ?').get(id)
  return sendJsonRow(res, 201, row, 'Browser profile missing after insert')
})

router.patch('/:id', (req, res) => {
  const { id } = req.params
  const existing = db.prepare('SELECT * FROM browser_profiles WHERE id = ?').get(id)
  if (!existing) return sendJsonError(res, 404, 'Not found')

  const allowed = ['name', 'linked_proxy_id', 'linked_account_id', 'status']
  const normalized = profilePatchPayload(req.body)
  const updates = {}
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(normalized, key)) updates[key] = normalized[key]
  }
  if (Object.keys(updates).length === 0) return sendJsonData(res, 200, existing)

  const cols = Object.keys(updates)
  const setClause = cols.map((c) => `${c} = @${c}`).join(', ')
  db.prepare(`UPDATE browser_profiles SET ${setClause} WHERE id = @id`).run({ ...updates, id })
  const updated = db.prepare('SELECT * FROM browser_profiles WHERE id = ?').get(id)
  return sendJsonRow(res, 200, updated, 'Browser profile missing after update')
})

router.delete('/:id', (req, res) => {
  const { id } = req.params
  const r = db.prepare('DELETE FROM browser_profiles WHERE id = ?').run(id)
  if (r.changes === 0) return sendJsonError(res, 404, 'Not found')
  return sendJsonSuccess(res)
})

export default router
