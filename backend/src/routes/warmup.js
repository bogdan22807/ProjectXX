import { Router } from 'express'
import { db, newId } from '../db.js'
import {
  getPlaywrightRunMeta,
  isPlaywrightTestRunActive,
  requestPlaywrightStop,
  runPlaywrightTestRun,
} from '../executor/playwrightTestRun.js'
import { sendJsonData, sendJsonError } from '../sendJson.js'

const router = Router()

/** @type {Map<string, { timeoutIds: ReturnType<typeof setTimeout>[], cancelled: boolean }>} */
const jobs = new Map()

function insertLog(account_id, action, details = '') {
  const id = newId('log')
  db.prepare(`INSERT INTO logs (id, account_id, action, details) VALUES (?, ?, ?, ?)`).run(
    id,
    account_id,
    action,
    String(details ?? ''),
  )
}

function clearWarmupJob(accountId) {
  const job = jobs.get(accountId)
  if (!job) return false
  job.cancelled = true
  for (const tid of job.timeoutIds) {
    clearTimeout(tid)
  }
  jobs.delete(accountId)
  return true
}

function beginWarmupChain(accountId) {
  const job = { timeoutIds: [], cancelled: false }
  jobs.set(accountId, job)

  const schedule = (delayMs, fn) => {
    const tid = setTimeout(() => {
      const i = job.timeoutIds.indexOf(tid)
      if (i >= 0) job.timeoutIds.splice(i, 1)
      if (!job.cancelled) fn()
    }, delayMs)
    job.timeoutIds.push(tid)
  }

  schedule(2000, () => {
    insertLog(accountId, 'Открытие страницы', '')
    schedule(2000, () => {
      insertLog(accountId, 'Ожидание', '')
      schedule(2000, () => {
        insertLog(accountId, 'Скролл выполнен', '')
        schedule(2000, () => {
          if (job.cancelled) return
          insertLog(accountId, 'Завершено', '')
          db.prepare('UPDATE accounts SET status = ? WHERE id = ?').run('Ready', accountId)
          jobs.delete(accountId)
          if (process.env.WARMUP_PLAYWRIGHT_AFTER_FAKE === '1' && !isPlaywrightTestRunActive(accountId)) {
            void runPlaywrightTestRun(accountId, { headless: true }).catch((err) => {
              console.error('[warmup → playwright]', err)
            })
          }
        })
      })
    })
  })
}

router.post('/start', (req, res) => {
  const body = req.body ?? {}
  const accountId = body.accountId ?? body.account_id
  if (!accountId || String(accountId).trim() === '') {
    return sendJsonError(res, 400, 'accountId is required')
  }

  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId)
  if (!account) {
    return sendJsonError(res, 404, 'Account not found')
  }

  if (jobs.has(accountId)) {
    return sendJsonError(res, 409, 'Warmup already running for this account')
  }

  if (isPlaywrightTestRunActive(accountId)) {
    return sendJsonError(res, 409, 'Playwright run already active for this account')
  }

  db.prepare('UPDATE accounts SET status = ? WHERE id = ?').run('Running', accountId)
  insertLog(accountId, 'Запуск начат', '')

  const useFakeOnly = process.env.WARMUP_FAKE_ONLY === '1'
  if (useFakeOnly) {
    beginWarmupChain(accountId)
  } else {
    const safeRaw = body.safeTikTokFeedMode ?? body.safe_tiktok_feed_mode
    const safeTikTokFeedMode =
      safeRaw === true ||
      safeRaw === 1 ||
      String(safeRaw ?? '').toLowerCase() === 'true' ||
      String(safeRaw ?? '').trim() === '1'
        ? true
        : safeRaw === false ||
            safeRaw === 0 ||
            String(safeRaw ?? '').toLowerCase() === 'false'
          ? false
          : undefined
    const pwOpts = { headless: true }
    if (safeTikTokFeedMode != null) pwOpts.safeTikTokFeedMode = safeTikTokFeedMode
    void runPlaywrightTestRun(accountId, pwOpts).catch((err) => {
      console.error('[warmup → playwright]', err)
    })
  }

  return sendJsonData(res, 200, { state: 'started', accountId, mode: useFakeOnly ? 'fake' : 'playwright' })
})

router.post('/stop', async (req, res) => {
  const body = req.body ?? {}
  const accountId = body.accountId ?? body.account_id
  if (!accountId || String(accountId).trim() === '') {
    return sendJsonError(res, 400, 'accountId is required')
  }

  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId)
  if (!account) {
    return sendJsonError(res, 404, 'Account not found')
  }

  const wasFake = clearWarmupJob(accountId)
  const hadPlaywright = isPlaywrightTestRunActive(accountId)
  let playwrightStopRequested = false
  if (hadPlaywright) {
    playwrightStopRequested = requestPlaywrightStop(accountId)
  }

  const stoppedSomething = wasFake || playwrightStopRequested
  const runMeta = getPlaywrightRunMeta(accountId)
  if (wasFake) {
    db.prepare('UPDATE accounts SET status = ? WHERE id = ?').run('Ready', accountId)
    insertLog(accountId, 'stopped by user', '')
  } else if (playwrightStopRequested) {
    insertLog(accountId, 'stopped by user', 'Playwright: graceful stop requested — status Ready when run ends')
  }

  return sendJsonData(res, 200, {
    state: stoppedSomething ? 'stopped' : 'idle',
    accountId,
    playwrightGraceful: playwrightStopRequested || undefined,
    runId: runMeta?.runId,
    executorLifecycle: runMeta?.lifecycle,
  })
})

export default router
