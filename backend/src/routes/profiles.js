import { Router } from 'express'
import { db, newId } from '../db.js'

const router = Router()

router.get('/', (_req, res) => {
  const rows = db.prepare('SELECT * FROM browser_profiles ORDER BY created_at DESC').all()
  res.json(rows)
})

router.post('/', (req, res) => {
  const {
    name = 'Unnamed profile',
    linked_proxy_id = null,
    linked_account_id = null,
    status = 'Ready',
  } = req.body ?? {}
  const id = newId('bp')
  db.prepare(
    `INSERT INTO browser_profiles (id, name, linked_proxy_id, linked_account_id, status)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, name, linked_proxy_id, linked_account_id, status)
  res.status(201).json(db.prepare('SELECT * FROM browser_profiles WHERE id = ?').get(id))
})

router.patch('/:id', (req, res) => {
  const { id } = req.params
  const existing = db.prepare('SELECT * FROM browser_profiles WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'Not found' })

  const allowed = ['name', 'linked_proxy_id', 'linked_account_id', 'status']
  const patch = req.body ?? {}
  const updates = {}
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) updates[key] = patch[key]
  }
  if (Object.keys(updates).length === 0) return res.json(existing)

  const cols = Object.keys(updates)
  const setClause = cols.map((c) => `${c} = @${c}`).join(', ')
  db.prepare(`UPDATE browser_profiles SET ${setClause} WHERE id = @id`).run({ ...updates, id })
  res.json(db.prepare('SELECT * FROM browser_profiles WHERE id = ?').get(id))
})

router.delete('/:id', (req, res) => {
  const { id } = req.params
  const r = db.prepare('DELETE FROM browser_profiles WHERE id = ?').run(id)
  if (r.changes === 0) return res.status(404).json({ error: 'Not found' })
  res.status(204).end()
})

export default router
