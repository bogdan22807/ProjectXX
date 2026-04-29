import assert from 'node:assert/strict'
import test from 'node:test'

import { filterOnlineDevices, parseAdbDevicesList } from '../src/executor/mobile/adbDevices.js'

test('parseAdbDevicesList skips header and offline', () => {
  const sample = `List of devices attached
emulator-5554\tdevice
127.0.0.1:5555\toffline
`

  const rows = parseAdbDevicesList(sample)
  assert.equal(rows.length, 2)
  assert.deepEqual(rows[0], { id: 'emulator-5554', state: 'device' })
  assert.deepEqual(rows[1], { id: '127.0.0.1:5555', state: 'offline' })
  const online = filterOnlineDevices(rows)
  assert.equal(online.length, 1)
  assert.equal(online[0].id, 'emulator-5554')
})

test('parseAdbDevicesList handles multi-word state', () => {
  const rows = parseAdbDevicesList('abc123\tno permissions (device)')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, 'abc123')
  assert.equal(rows[0].state, 'no permissions (device)')
})
