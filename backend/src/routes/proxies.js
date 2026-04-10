import { Router } from 'express'
import { db, newId } from '../db.js'
import { proxyCreatePayload, proxyPatchPayload } from '../requestFields.js'
import { sendJsonData, sendJsonError, sendJsonRow, sendJsonSuccess } from '../sendJson.js'

const router = Router()

router.get('/', (_req, res) => {
  const rows = db.prepare('SELECT * FROM proxies ORDER BY created_at DESC').all()
  return sendJsonData(res, 200, rows)
})

router.post('/', (req, res) => {
  const {
    provider,
    host,
    port,
    username,
    password,
    status,
    assigned_to,
    last_check,
  } = proxyCreatePayload(req.body)
  if (!host || String(host).trim() === '') {
    return sendJsonError(res, 400, 'host is required')
  }
  const id = newId('px')
  db.prepare(
    `INSERT INTO proxies (id, provider, host, port, username, password, status, assigned_to, last_check)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    provider,
    host.trim(),
    port,
    username,
    password,
    status,
    assigned_to,
    last_check,
  )
  const row = db.prepare('SELECT * FROM proxies WHERE id = ?').get(id)
  return sendJsonRow(res, 201, row, 'Proxy missing after insert')
})

router.patch('/:id', (req, res) => {
  const { id } = req.params
  const existing = db.prepare('SELECT * FROM proxies WHERE id = ?').get(id)
  if (!existing) return sendJsonError(res, 404, 'Not found')

  const allowed = [
    'provider',
    'host',
    'port',
    'username',
    'password',
    'status',
    'assigned_to',
    'last_check',
  ]
  const normalized = proxyPatchPayload(req.body)
  const updates = {}
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(normalized, key)) updates[key] = normalized[key]
  }
  if (Object.keys(updates).length === 0) return sendJsonData(res, 200, existing)

  const cols = Object.keys(updates)
  const setClause = cols.map((c) => `${c} = @${c}`).join(', ')
  db.prepare(`UPDATE proxies SET ${setClause} WHERE id = @id`).run({ ...updates, id })
  const updated = db.prepare('SELECT * FROM proxies WHERE id = ?').get(id)
  return sendJsonRow(res, 200, updated, 'Proxy missing after update')
})

router.delete('/:id', (req, res) => {
  const { id } = req.params
  const r = db.prepare('DELETE FROM proxies WHERE id = ?').run(id)
  if (r.changes === 0) return sendJsonError(res, 404, 'Not found')
  return sendJsonSuccess(res)
})

export default router
