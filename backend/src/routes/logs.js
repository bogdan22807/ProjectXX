import { Router } from 'express'
import { db, newId } from '../db.js'

const router = Router()

router.get('/', (_req, res) => {
  const rows = db.prepare('SELECT * FROM logs ORDER BY created_at DESC LIMIT 500').all()
  res.json(rows)
})

router.post('/', (req, res) => {
  const { account_id = null, action, details = '' } = req.body ?? {}
  if (!action || String(action).trim() === '') {
    return res.status(400).json({ error: 'action is required' })
  }
  const id = newId('log')
  db.prepare(
    `INSERT INTO logs (id, account_id, action, details) VALUES (?, ?, ?, ?)`,
  ).run(id, account_id, action.trim(), details)
  res.status(201).json(db.prepare('SELECT * FROM logs WHERE id = ?').get(id))
})

export default router
