import { Router } from 'express'

const router = Router()

/** Placeholder endpoints for future automation hooks */
router.post('/start', (_req, res) => {
  res.json({ ok: true, state: 'started' })
})

router.post('/stop', (_req, res) => {
  res.json({ ok: true, state: 'stopped' })
})

export default router
