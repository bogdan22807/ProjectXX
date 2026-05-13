import assert from 'node:assert/strict'
import test from 'node:test'

import {
  _buildMuMuRunningAdbSerialsForTests,
  _parseMuMuInfoAllForTests,
  _pickMuMuInstanceForTests,
} from '../src/executor/mobile/mumuManager.js'

test('parseMuMuInfoAll reads nested mumutool JSON results with adb_port', () => {
  const rows = _parseMuMuInfoAllForTests(`{
    "errcode": 0,
    "message": "",
    "return": {
      "count": 2,
      "results": [
        {
          "adb_port": 26624,
          "index": 0,
          "name": "Android Device",
          "pid": 33294,
          "state": "running"
        },
        {
          "adb_port": 27648,
          "index": 2,
          "name": "Android Device-2",
          "pid": 0,
          "state": "stopped"
        }
      ]
    }
  }`)

  assert.deepEqual(rows, [
    {
      index: '0',
      name: 'Android Device',
      adbPort: '26624',
      pid: '33294',
      state: 'running',
    },
    {
      index: '2',
      name: 'Android Device-2',
      adbPort: '27648',
      pid: '0',
      state: 'stopped',
    },
  ])
})

test('pickMuMuInstance matches exact MuMu instance names before index fallback', () => {
  const instances = [
    { index: '0', name: 'Android Device', adbPort: '26624', pid: '33294', state: 'running' },
    { index: '1', name: 'Android Device-1', adbPort: '', pid: '0', state: 'stopped' },
    { index: '2', name: 'Android Device-2', adbPort: '', pid: '0', state: 'stopped' },
  ]

  assert.deepEqual(_pickMuMuInstanceForTests(instances, 'Android Device'), instances[0])
  assert.deepEqual(_pickMuMuInstanceForTests(instances, 'Android Device-2'), instances[2])
  assert.deepEqual(_pickMuMuInstanceForTests(instances, '2'), instances[2])
})

test('buildMuMuRunningAdbSerials keeps only running instances with adb ports', () => {
  const instances = [
    { index: '0', name: 'Android Device', adbPort: '26624', pid: '33294', state: 'running' },
    { index: '1', name: 'Android Device-1', adbPort: '', pid: '0', state: 'stopped' },
    { index: '2', name: 'Android Device-2', adbPort: '27648', pid: '44221', state: 'running' },
  ]

  assert.deepEqual(_buildMuMuRunningAdbSerialsForTests(instances), [
    '127.0.0.1:26624',
    '127.0.0.1:27648',
  ])
})
