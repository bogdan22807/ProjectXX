import assert from 'node:assert/strict'
import test from 'node:test'

import { ensureMobileAdbReady } from '../src/executor/mobile/mobileAdbReady.js'

test('ensureMobileAdbReady retries adb connect for tcp serial until Android boot completes', async () => {
  const emitted = []
  const sleepCalls = []
  let onlineChecks = 0
  let connectAttempts = 0
  let bootRound = 0

  const result = await ensureMobileAdbReady({
    adbSerial: '127.0.0.1:16384',
    connectAttempts: 3,
    connectDelayMs: 5,
    readyAttempts: 3,
    readyDelayMs: 5,
    bootAttempts: 3,
    bootDelayMs: 5,
    emit: (action, details = '') => emitted.push({ action, details }),
    sleep: async (ms) => {
      sleepCalls.push(ms)
    },
    listOnlineAdbSerials: async () => {
      onlineChecks += 1
      if (onlineChecks < 2) return []
      return ['127.0.0.1:16384']
    },
    connectAdb: async () => {
      connectAttempts += 1
      if (connectAttempts === 1) {
        throw new Error('connection refused')
      }
      return { stdout: 'connected to 127.0.0.1:16384' }
    },
    runAdbWithSerial: async (_serial, args) => {
      const prop = args[args.length - 1]
      if (prop === 'sys.boot_completed') {
        bootRound += 1
        return { stdout: bootRound >= 2 ? '1' : '0' }
      }
      if (prop === 'dev.bootcomplete') {
        return { stdout: bootRound >= 2 ? '1' : '0' }
      }
      if (prop === 'init.svc.bootanim') {
        return { stdout: bootRound >= 2 ? 'stopped' : 'running' }
      }
      throw new Error(`unexpected property ${prop}`)
    },
  })

  assert.equal(result.deviceId, '127.0.0.1:16384')
  assert.equal(result.mode, 'adb_connect')
  assert.equal(connectAttempts, 2)
  assert.deepEqual(sleepCalls, [5, 5])
  assert.deepEqual(
    emitted.map((entry) => entry.action),
    ['MOBILE_WARN', 'ADB_CONNECTED'],
  )
  assert.match(emitted[0].details, /adb connect attempt=1\/3 device=127\.0\.0\.1:16384 failed: connection refused/)
  assert.match(emitted[1].details, /device=127\.0\.0\.1:16384 mode=adb_connect/)
})
