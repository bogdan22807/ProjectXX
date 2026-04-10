import { Router } from 'express'
import { db, newId } from '../db.js'
import {
  abortPlaywrightTestRun,
  isPlaywrightTestRunActive,
  runPlaywrightTestRun,
} from '../executor/playwrightTestRun.js'

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
            void runPlaywrightTestRun(accountId).catch((err) => {
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
    return res.status(400).json({ error: 'accountId is required' })
  }

  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId)
  if (!account) {
    return res.status(404).json({ error: 'Account not found' })
  }

  if (jobs.has(accountId)) {
    return res.status(409).json({ error: 'Warmup already running for this account' })
  }

  db.prepare('UPDATE accounts SET status = ? WHERE id = ?').run('Running', accountId)
  insertLog(accountId, 'Запуск начат', '')

  beginWarmupChain(accountId)

  res.json({ ok: true, state: 'started', accountId })
})

router.post('/stop', async (req, res) => {
  const body = req.body ?? {}
  const accountId = body.accountId ?? body.account_id
  if (!accountId || String(accountId).trim() === '') {
    return res.status(400).json({ error: 'accountId is required' })
  }

  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId)
  if (!account) {
    return res.status(404).json({ error: 'Account not found' })
  }

  const wasFake = clearWarmupJob(accountId)
  const hadPlaywright = isPlaywrightTestRunActive(accountId)
  if (hadPlaywright) {
    await abortPlaywrightTestRun(accountId)
  }

  const stoppedSomething = wasFake || hadPlaywright
  if (stoppedSomething) {
    db.prepare('UPDATE accounts SET status = ? WHERE id = ?').run('Ready', accountId)
    insertLog(accountId, 'stopped by user', '')
  }

  res.json({ ok: true, state: stoppedSomething ? 'stopped' : 'idle', accountId })
})

export default router
