import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  _resetMobileExecutorSessionForTests,
  mobileOpenApp,
} from '../src/executor/mobile/mobileExecutor.js'

function makeFakeAdb({ monkeyStdout = '', monkeyStderr = '', argsFile = '' } = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-adb-'))
  const adbPath = path.join(tempDir, 'adb')
  const quotedArgsFile = JSON.stringify(argsFile)
  const script = `#!/usr/bin/env bash
set -euo pipefail

if [[ "\${1:-}" == "devices" ]]; then
  printf 'List of devices attached\nemulator-5554\tdevice\n'
  exit 0
fi

if [[ "\${1:-}" == "-s" ]]; then
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
