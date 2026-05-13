import assert from 'node:assert/strict'
import test from 'node:test'

import { openMobileAppAfterLaunch } from '../src/executor/mobile/mobileLaunchOpenApp.js'

test('openMobileAppAfterLaunch retries until mobile app opens', async () => {
  const calls = []
  const sleepCalls = []
  const emitted = []
  let attempt = 0

  const result = await openMobileAppAfterLaunch({
    adbSerial: 'emulator-5554',
    env: { MOBILE_APP_PACKAGE: 'com.example.tiktok' },
    emit: (action, details = '') => emitted.push({ action, details }),
    attempts: 3,
    delayMs: 25,
    sleep: async (ms) => {
      sleepCalls.push(ms)
    },
    openApp: async ({ env }) => {
      attempt += 1
      calls.push({ attempt, deviceId: env.MOBILE_DEVICE_ID, pkg: env.MOBILE_APP_PACKAGE })
      if (attempt < 3) {
        return { ok: false, error: `boot not ready ${attempt}` }
      }
      return { ok: true, deviceId: env.MOBILE_DEVICE_ID, package: env.MOBILE_APP_PACKAGE }
    },
  })

  assert.equal(result.ok, true)
  assert.equal(result.deviceId, 'emulator-5554')
  assert.equal(result.package, 'com.example.tiktok')
  assert.deepEqual(calls, [
    { attempt: 1, deviceId: 'emulator-5554', pkg: 'com.example.tiktok' },
    { attempt: 2, deviceId: 'emulator-5554', pkg: 'com.example.tiktok' },
    { attempt: 3, deviceId: 'emulator-5554', pkg: 'com.example.tiktok' },
  ])
  assert.deepEqual(sleepCalls, [25, 25])
  assert.deepEqual(
    emitted.map((entry) => entry.action),
    ['MOBILE_WARN', 'MOBILE_WARN', 'MOBILE_APP_OPENED_AFTER_LAUNCH'],
  )
  assert.match(emitted[0].details, /attempt=1\/3/)
  assert.match(emitted[2].details, /attempt=3 package=com\.example\.tiktok/)
})

test('openMobileAppAfterLaunch throws after final failed attempt', async () => {
  const emitted = []

  await assert.rejects(
    () =>
      openMobileAppAfterLaunch({
        adbSerial: 'emulator-5556',
        attempts: 2,
        delayMs: 10,
        sleep: async () => {},
        emit: (action, details = '') => emitted.push({ action, details }),
        openApp: async () => ({ ok: false, error: 'launcher unavailable' }),
      }),
    /Could not auto-open mobile app after launch: launcher unavailable/,
  )

  assert.deepEqual(
    emitted.map((entry) => entry.action),
    ['MOBILE_WARN'],
  )
  assert.match(emitted[0].details, /attempt=1\/2 device=emulator-5556 failed: launcher unavailable/)
})
