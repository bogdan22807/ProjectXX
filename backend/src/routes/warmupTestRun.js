/**
 * POST /warmup/test-run — Playwright-only open-page check (in-house test URL).
 * Does not run the fake timer workflow.
 */

import { Router } from 'express'
import { getAccount } from '../executor/runner.js'
import { db, newId } from '../db.js'
import {
  abortPlaywrightTestRun,
  isPlaywrightTestRunActive,
  runPlaywrightTestRun,
} from '../executor/playwrightTestRun.js'

const router = Router()

router.post('/', (req, res) => {
  const body = req.body ?? {}
  const accountId = body.accountId ?? body.account_id
  if (!accountId || String(accountId).trim() === '') {
    return res.status(400).json({ error: 'accountId is required' })
  }

  if (!getAccount(accountId)) {
    return res.status(404).json({ error: 'Account not found' })
  }

  if (isPlaywrightTestRunActive(accountId)) {
    return res.status(409).json({ error: 'Playwright test run already active for this account' })
  }

  const targetUrl = body.targetUrl ?? body.target_url
  void runPlaywrightTestRun(accountId, {
    targetUrl: targetUrl != null ? String(targetUrl) : undefined,
  }).catch((err) => {
    console.error('[warmup/test-run]', err)
  })

  res.status(202).json({
    ok: true,
    mode: 'test-run',
    accountId,
    message: 'Playwright run started in background',
  })
})

router.post('/abort', async (req, res) => {
  const body = req.body ?? {}
  const accountId = body.accountId ?? body.account_id
  if (!accountId || String(accountId).trim() === '') {
    return res.status(400).json({ error: 'accountId is required' })
  }

  if (!getAccount(accountId)) {
    return res.status(404).json({ error: 'Account not found' })
  }

  const aborted = await abortPlaywrightTestRun(accountId)
  if (aborted) {
    const id = newId('log')
    db.prepare(`INSERT INTO logs (id, account_id, action, details) VALUES (?, ?, ?, ?)`).run(
      id,
      accountId,
      'stopped by user',
      'test-run abort',
    )
    db.prepare('UPDATE accounts SET status = ? WHERE id = ?').run('Ready', accountId)
  }
  res.json({ ok: true, accountId, aborted })
})

export default router
