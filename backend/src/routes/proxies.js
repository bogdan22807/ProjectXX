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
  const h = String(host).trim()
  const p = port != null ? String(port).trim() : ''
  const prov = provider != null ? String(provider).trim() : ''
  const u = username != null ? String(username).trim() : ''
  const pw = password != null ? String(password).trim() : ''
  const st = status != null ? String(status).trim() : 'Needs Check'
  const assigned = assigned_to != null ? String(assigned_to).trim() : ''
  db.prepare(
    `INSERT INTO proxies (id, provider, host, port, username, password, status, assigned_to, last_check)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, prov, h, p, u, pw, st, assigned, last_check ?? null)
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

  const stringCols = new Set([
    'provider',
    'host',
    'port',
    'username',
    'password',
    'status',
    'assigned_to',
    'last_check',
  ])
  for (const key of Object.keys(updates)) {
    const v = updates[key]
    if (stringCols.has(key) && v != null && typeof v !== 'number') {
      updates[key] = String(v).trim()
    }
  }
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
