import { Router } from 'express'
import { db, newId } from '../db.js'
import { sendJsonData, sendJsonError, sendJsonRow } from '../sendJson.js'

const router = Router()

router.get('/', (_req, res) => {
  const rows = db.prepare('SELECT * FROM logs ORDER BY created_at DESC LIMIT 500').all()
  return sendJsonData(res, 200, rows)
})

router.post('/', (req, res) => {
  const { account_id = null, action, details = '' } = req.body ?? {}
  if (!action || String(action).trim() === '') {
    return sendJsonError(res, 400, 'action is required')
  }
  const id = newId('log')
  db.prepare(
    `INSERT INTO logs (id, account_id, action, details) VALUES (?, ?, ?, ?)`,
  ).run(id, account_id, action.trim(), details)
  const row = db.prepare('SELECT * FROM logs WHERE id = ?').get(id)
  return sendJsonRow(res, 201, row, 'Log missing after insert')
})

export default router
