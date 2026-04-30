import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  _resetMobileExecutorSessionForTests,
  mobileOpenApp,
  mobileRunScenario,
} from '../src/executor/mobile/mobileExecutor.js'

function makeFakeAdb({ monkeyStdout = '', monkeyStderr = '', argsFile = '', commandLogFile = '' } = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-adb-'))
  const adbPath = path.join(tempDir, 'adb')
  const quotedArgsFile = JSON.stringify(argsFile)
  const quotedCommandLogFile = JSON.stringify(commandLogFile)
  const script = `#!/usr/bin/env bash
set -euo pipefail

if [[ "\${1:-}" == "devices" ]]; then
  printf 'List of devices attached\nemulator-5554\tdevice\n'
  exit 0
fi

if [[ "\${1:-}" == "-s" ]]; then
  if [[ -n ${quotedCommandLogFile} ]]; then
    printf '%s\n' "$*" >> ${quotedCommandLogFile}
  fi
  if [[ -n ${quotedArgsFile} ]]; then
    printf '%s\n' "$@" > ${quotedArgsFile}
  fi
  printf '%s' ${JSON.stringify(monkeyStdout)}
  printf '%s' ${JSON.stringify(monkeyStderr)} >&2
  exit 0
fi

echo "unexpected adb args: $*" >&2
exit 1
`
  fs.writeFileSync(adbPath, script, 'utf8')
  fs.chmodSync(adbPath, 0o755)
  return { adbPath, tempDir }
}

test('mobileOpenApp passes MOBILE_APP_PACKAGE into adb monkey and logs MOBILE_APP_OPENED', async () => {
  const argsFile = path.join(os.tmpdir(), `mobile-open-args-${process.pid}-${Date.now()}.txt`)
  const { adbPath, tempDir } = makeFakeAdb({
    monkeyStdout: 'Events injected: 1',
    argsFile,
  })
  const emitted = []

  try {
    const result = await mobileOpenApp({
      adbPath,
      env: { MOBILE_APP_PACKAGE: 'com.example.app' },
      emit: (action, details = '') => emitted.push({ action, details }),
    })

    assert.equal(result.ok, true)
    assert.equal(result.package, 'com.example.app')

    const args = fs.readFileSync(argsFile, 'utf8')
    assert.match(args, /-s\nemulator-5554\nshell\nmonkey\n-p\ncom\.example\.app\n-c\nandroid\.intent\.category\.LAUNCHER\n1\n?$/)
    assert.deepEqual(
      emitted.map((entry) => entry.action),
      ['MOBILE_EXECUTOR_STARTED', 'MOBILE_APP_OPENED'],
    )
    assert.match(emitted[1].details, /package=com\.example\.app device=emulator-5554/)
  } finally {
    _resetMobileExecutorSessionForTests()
    fs.rmSync(tempDir, { recursive: true, force: true })
    fs.rmSync(argsFile, { force: true })
  }
})

test('mobileOpenApp reports MOBILE_ERROR when adb monkey aborts without stderr error marker', async () => {
  const { adbPath, tempDir } = makeFakeAdb({
    monkeyStdout: '** No activities found to run, monkey aborted.',
  })
  const emitted = []

  try {
    const result = await mobileOpenApp({
      adbPath,
      env: { MOBILE_APP_PACKAGE: 'com.example.app' },
      emit: (action, details = '') => emitted.push({ action, details }),
    })

    assert.equal(result.ok, false)
    assert.match(result.error, /no activities found to run/i)
    assert.deepEqual(
      emitted.map((entry) => entry.action),
      ['MOBILE_EXECUTOR_STARTED', 'MOBILE_ERROR'],
    )
    assert.match(emitted[1].details, /open_app: \*\* No activities found to run, monkey aborted\./i)
    assert.equal(emitted.some((entry) => entry.action === 'MOBILE_APP_OPENED'), false)
  } finally {
    _resetMobileExecutorSessionForTests()
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('mobileRunScenario performs configured swipes and like logging through adb', async () => {
  const commandLogFile = path.join(os.tmpdir(), `mobile-scenario-commands-${process.pid}-${Date.now()}.txt`)
  const { adbPath, tempDir } = makeFakeAdb({
    monkeyStdout: 'Events injected: 1',
    commandLogFile,
  })
  const emitted = []
  const sleepCalls = []

  try {
    const result = await mobileRunScenario({
      adbPath,
      env: {
        MOBILE_APP_PACKAGE: 'com.example.app',
        MOBILE_SWIPES_COUNT: '2',
        MOBILE_VIEW_MIN_MS: '1',
        MOBILE_VIEW_MAX_MS: '1',
        MOBILE_LIKE_CHANCE: '10',
      },
      emit: (action, details = '') => emitted.push({ action, details }),
      random: () => 0.05,
      sleep: async (ms) => {
        sleepCalls.push(ms)
      },
    })

    assert.equal(result.ok, true)
    assert.equal(result.swipes, 2)
    assert.equal(result.likes, 2)
    assert.equal(result.deviceId, 'emulator-5554')
    assert.equal(result.package, 'com.example.app')
    assert.deepEqual(sleepCalls, [1, 1, 1, 1])

    const commandLog = fs.readFileSync(commandLogFile, 'utf8')
    assert.match(commandLog, /-s emulator-5554 shell monkey -p com\.example\.app -c android\.intent\.category\.LAUNCHER 1/)
    assert.equal((commandLog.match(/shell input swipe 720 1900 720 600 500/g) ?? []).length, 2)
    assert.equal((commandLog.match(/shell input tap 1360 1750/g) ?? []).length, 2)

    assert.deepEqual(
      emitted.map((entry) => entry.action),
      [
        'MOBILE_EXECUTOR_STARTED',
        'MOBILE_APP_OPENED',
        'MOBILE_VIEW',
        'MOBILE_SWIPE',
        'MOBILE_VIEW',
        'MOBILE_LIKE',
        'MOBILE_VIEW',
        'MOBILE_SWIPE',
        'MOBILE_VIEW',
        'MOBILE_LIKE',
        'MOBILE_DONE',
      ],
    )
    assert.match(emitted[2].details, /iteration=1 stage=before_swipe waitMs=1/)
    assert.match(emitted[3].details, /iteration=1/)
    assert.match(emitted[4].details, /iteration=1 stage=after_swipe waitMs=1/)
    assert.match(emitted[5].details, /iteration=1 x=1360 y=1750/)
    assert.match(emitted[10].details, /device=emulator-5554 package=com\.example\.app swipes=2 likes=2/)
  } finally {
    _resetMobileExecutorSessionForTests()
    fs.rmSync(tempDir, { recursive: true, force: true })
    fs.rmSync(commandLogFile, { force: true })
  }
})

test('mobileRunScenario skips like when random chance does not hit', async () => {
  const commandLogFile = path.join(os.tmpdir(), `mobile-scenario-no-like-${process.pid}-${Date.now()}.txt`)
  const { adbPath, tempDir } = makeFakeAdb({
    monkeyStdout: 'Events injected: 1',
    commandLogFile,
  })
  const emitted = []
  const sleepCalls = []

  try {
    const result = await mobileRunScenario({
      adbPath,
      env: {
        MOBILE_APP_PACKAGE: 'com.example.app',
        MOBILE_SWIPES_COUNT: '1',
        MOBILE_VIEW_MIN_MS: '1',
        MOBILE_VIEW_MAX_MS: '1',
        MOBILE_LIKE_CHANCE: '10',
      },
      emit: (action, details = '') => emitted.push({ action, details }),
      random: () => 0.9,
      sleep: async (ms) => {
        sleepCalls.push(ms)
      },
    })

    assert.equal(result.ok, true)
    assert.equal(result.swipes, 1)
    assert.equal(result.likes, 0)
    assert.equal(emitted.some((entry) => entry.action === 'MOBILE_LIKE'), false)
    assert.deepEqual(sleepCalls, [1, 1])

    const commandLog = fs.readFileSync(commandLogFile, 'utf8')
    assert.equal((commandLog.match(/shell input swipe 720 1900 720 600 500/g) ?? []).length, 1)
    assert.equal((commandLog.match(/shell input tap 1360 1750/g) ?? []).length, 0)
  } finally {
    _resetMobileExecutorSessionForTests()
    fs.rmSync(tempDir, { recursive: true, force: true })
    fs.rmSync(commandLogFile, { force: true })
  }
})
