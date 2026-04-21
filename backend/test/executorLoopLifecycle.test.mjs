/**
 * Integration checks for Playwright executor loop (requires Chromium).
 * Skip if browser launch fails (e.g. no browsers in CI).
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { db, newId } from '../src/db.js'
import {
  isPlaywrightTestRunActive,
  requestPlaywrightStop,
  runPlaywrightTestRun,
} from '../src/executor/playwrightTestRun.js'

function insertAccount(id) {
  db.prepare(
    `INSERT INTO accounts (id, name, login, cookies, platform, proxy_id, browser_profile_id, status)
     VALUES (?, ?, '', '', 'TikTok', NULL, NULL, 'Ready')`,
  ).run(id, `loop-test-${id}`)
}

function deleteAccount(id) {
  db.prepare('DELETE FROM logs WHERE account_id = ?').run(id)
  db.prepare('DELETE FROM accounts WHERE id = ?').run(id)
}

function logActionsForAccount(accountId) {
  return db
    .prepare(
      `SELECT action FROM logs WHERE account_id = ? ORDER BY datetime(created_at), rowid`,
    )
    .all(accountId)
    .map((r) => r.action)
}

test('executor loop: graceful stop logs STOP_REQUESTED, EXECUTOR_STOPPED, EXECUTOR_FINISHED', async (t) => {
  const accountId = newId('acc-loop')
  insertAccount(accountId)
  t.after(() => deleteAccount(accountId))

  const runPromise = runPlaywrightTestRun(accountId, {
    headless: true,
    targetUrl: 'https://example.com/',
    maxDurationMs: 120_000,
  })

  await new Promise((r) => setTimeout(r, 2500))
  assert.equal(isPlaywrightTestRunActive(accountId), true, 'run should still be active before stop')
  const ok = requestPlaywrightStop(accountId)
  assert.equal(ok, true)

  await runPromise

  assert.equal(isPlaywrightTestRunActive(accountId), false, 'run map cleared after finish')

  const actions = logActionsForAccount(accountId)
  assert.ok(actions.includes('EXECUTOR_STARTED'), `missing EXECUTOR_STARTED, got: ${actions.join(',')}`)
  assert.ok(actions.includes('LOOP_ITERATION_STARTED'), `missing LOOP_ITERATION_STARTED, got: ${actions.join(',')}`)
  assert.ok(actions.includes('STOP_REQUESTED'), `missing STOP_REQUESTED, got: ${actions.join(',')}`)
  assert.ok(actions.includes('EXECUTOR_STOPPED'), `missing EXECUTOR_STOPPED, got: ${actions.join(',')}`)
  assert.ok(actions.includes('EXECUTOR_FINISHED'), `missing EXECUTOR_FINISHED, got: ${actions.join(',')}`)
})

test('executor loop: maxDurationMs ends with MAX_DURATION_REACHED and closes run', async (t) => {
  const accountId = newId('acc-max')
  insertAccount(accountId)
  t.after(() => deleteAccount(accountId))

  await runPlaywrightTestRun(accountId, {
    headless: true,
    targetUrl: 'https://example.com/',
    maxDurationMs: 4000,
  })

  assert.equal(isPlaywrightTestRunActive(accountId), false)

  const actions = logActionsForAccount(accountId)
  assert.ok(actions.includes('EXECUTOR_STARTED'))
  assert.ok(actions.includes('LOOP_ITERATION_STARTED'))
  assert.ok(actions.includes('MAX_DURATION_REACHED'), `missing MAX_DURATION_REACHED, got: ${actions.join(',')}`)
  assert.ok(actions.includes('EXECUTOR_STOPPED'))
  assert.ok(actions.includes('EXECUTOR_FINISHED'))
})
