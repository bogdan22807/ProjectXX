import { Router } from 'express'
import { db, newId } from '../db.js'

const router = Router()

router.get('/', (_req, res) => {
  const rows = db.prepare('SELECT * FROM proxies ORDER BY created_at DESC').all()
  res.json(rows)
})

router.post('/', (req, res) => {
  const {
    provider = '',
    host,
    port = '',
    username = '',
    password = '',
    status = 'Needs Check',
    assigned_to = '',
    last_check = null,
  } = req.body ?? {}
  if (!host || String(host).trim() === '') {
    return res.status(400).json({ error: 'host is required' })
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
  res.status(201).json(db.prepare('SELECT * FROM proxies WHERE id = ?').get(id))
})

router.patch('/:id', (req, res) => {
  const { id } = req.params
  const existing = db.prepare('SELECT * FROM proxies WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'Not found' })

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
  const patch = req.body ?? {}
  const updates = {}
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) updates[key] = patch[key]
  }
  if (Object.keys(updates).length === 0) return res.json(existing)

  const cols = Object.keys(updates)
  const setClause = cols.map((c) => `${c} = @${c}`).join(', ')
  db.prepare(`UPDATE proxies SET ${setClause} WHERE id = @id`).run({ ...updates, id })
  res.json(db.prepare('SELECT * FROM proxies WHERE id = ?').get(id))
})

router.delete('/:id', (req, res) => {
  const { id } = req.params
  const r = db.prepare('DELETE FROM proxies WHERE id = ?').run(id)
  if (r.changes === 0) return res.status(404).json({ error: 'Not found' })
  res.status(204).end()
})

export default router
