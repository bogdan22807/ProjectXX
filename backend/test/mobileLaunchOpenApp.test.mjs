import assert from 'node:assert/strict'
import test from 'node:test'

import {
  openMobileAppAfterLaunch,
  verifyMobileAppOpened,
} from '../src/executor/mobile/mobileLaunchOpenApp.js'

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
    verifyAppOpened: async () => ({ ok: true, method: 'activity' }),
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
    ['TIKTOK_OPENING', 'MOBILE_WARN', 'TIKTOK_OPENING', 'MOBILE_WARN', 'TIKTOK_OPENING', 'TIKTOK_OPENED'],
  )
  assert.match(emitted[0].details, /package=com\.example\.tiktok attempt=1\/3/)
  assert.match(emitted[5].details, /attempt=3\/3 verify=activity/)
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
    ['TIKTOK_OPENING', 'MOBILE_WARN', 'TIKTOK_OPENING'],
  )
  assert.match(emitted[1].details, /attempt=1\/2 device=emulator-5556 failed: launcher unavailable/)
})

test('verifyMobileAppOpened accepts activity dumpsys foreground match', async () => {
  const commands = []

  const result = await verifyMobileAppOpened({
    adbSerial: '127.0.0.1:16384',
    packageName: 'com.zhiliaoapp.musically',
    verifyRunAdb: async (serial, args) => {
      commands.push([serial, ...args])
      return {
        stdout:
          'mResumedActivity: ActivityRecord{123 u0 com.zhiliaoapp.musically/com.ss.android.ugc.aweme.splash.SplashActivity t42}',
      }
    },
  })

  assert.equal(result.ok, true)
  assert.equal(result.method, 'activity')
  assert.deepEqual(commands, [
    ['127.0.0.1:16384', 'shell', 'dumpsys', 'activity', 'activities'],
  ])
})
