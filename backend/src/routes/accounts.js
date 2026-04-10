import { Router } from 'express'
import { db, newId } from '../db.js'
import { accountCreatePayload, accountPatchPayload } from '../requestFields.js'

const router = Router()

router.get('/', (_req, res) => {
  const rows = db.prepare('SELECT * FROM accounts ORDER BY created_at DESC').all()
  res.json(rows)
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
  db.prepare(
    `INSERT INTO accounts (id, name, login, cookies, platform, proxy_id, browser_profile_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, name, login, cookies, platform, proxy_id, browser_profile_id, status)
  const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id)
  res.status(201).json(row)
})

router.patch('/:id', (req, res) => {
  const { id } = req.params
  const existing = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'Not found' })

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
    return res.json(existing)
  }
  const cols = Object.keys(updates)
  const setClause = cols.map((c) => `${c} = @${c}`).join(', ')
  db.prepare(`UPDATE accounts SET ${setClause} WHERE id = @id`).run({
    ...updates,
    id,
  })
  res.json(db.prepare('SELECT * FROM accounts WHERE id = ?').get(id))
})

router.delete('/:id', (req, res) => {
  const { id } = req.params
  const r = db.prepare('DELETE FROM accounts WHERE id = ?').run(id)
  if (r.changes === 0) return res.status(404).json({ error: 'Not found' })
  res.status(204).end()
})

export default router
