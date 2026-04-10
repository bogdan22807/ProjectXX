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
import { sendJsonData, sendJsonError } from '../sendJson.js'

const router = Router()

router.post('/', (req, res) => {
  const body = req.body ?? {}
  const accountId = body.accountId ?? body.account_id
  if (!accountId || String(accountId).trim() === '') {
    return sendJsonError(res, 400, 'accountId is required')
  }

  if (!getAccount(accountId)) {
    return sendJsonError(res, 404, 'Account not found')
  }

  if (isPlaywrightTestRunActive(accountId)) {
    return sendJsonError(res, 409, 'Playwright test run already active for this account')
  }

  const targetUrl = body.targetUrl ?? body.target_url
  const readySelector = body.readySelector ?? body.ready_selector
  void runPlaywrightTestRun(accountId, {
    targetUrl: targetUrl != null ? String(targetUrl) : undefined,
    readySelector: readySelector != null ? String(readySelector) : undefined,
  }).catch((err) => {
    console.error('[warmup/test-run]', err)
  })

  return sendJsonData(res, 202, {
    mode: 'test-run',
    accountId,
    message: 'Playwright run started in background',
  })
})

router.post('/abort', async (req, res) => {
  const body = req.body ?? {}
  const accountId = body.accountId ?? body.account_id
  if (!accountId || String(accountId).trim() === '') {
    return sendJsonError(res, 400, 'accountId is required')
  }

  if (!getAccount(accountId)) {
    return sendJsonError(res, 404, 'Account not found')
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
  return sendJsonData(res, 200, { accountId, aborted })
})

export default router
