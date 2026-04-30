import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { db } from '../../db.js'

const execFileAsync = promisify(execFile)

function sleepMs(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function emitLog(opts, action, details = '') {
  const d = String(details ?? '').trim()
  if (d) console.log(action, d)
  else console.log(action)
  opts?.emit?.(action, d)
}

function readList(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return []
  try {
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed)) return parsed
    if (parsed && typeof parsed === 'object') return [parsed]
  } catch {
    /* ignore */
  }
  return []
}

function getMuMuManagerExecutable(env) {
  const explicit = String(env.MUMU_MANAGER_PATH ?? '').trim()
  if (explicit) return explicit
  if (process.platform === 'win32') return 'MuMuManager.exe'
  return 'MuMuManager'
}

async function runMuMuManager(args, opts = {}) {
  const env = opts.env ?? process.env
  const bin = getMuMuManagerExecutable(env)
  const timeoutMs = opts.timeoutMs ?? 120_000
  return execFileAsync(bin, args, {
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
    encoding: 'utf8',
    windowsHide: true,
  })
}

function normalizeVm(entry) {
  if (!entry || typeof entry !== 'object') return null
  const row = /** @type {Record<string, unknown>} */ (entry)
  const index = String(row.index ?? '').trim()
  if (!index) return null
  const adbHostIp = String(row.adb_host_ip ?? '').trim()
  const adbPort = String(row.adb_port ?? '').trim()
  return {
    index,
    name: String(row.name ?? '').trim(),
    adbHostIp,
    adbPort,
    deviceId: adbHostIp && adbPort ? `${adbHostIp}:${adbPort}` : '',
    isProcessStarted: row.is_process_started === true,
    isAndroidStarted: row.is_android_started === true,
  }
}

export async function mumuList(opts = {}) {
  const result = await runMuMuManager(['info', '-v', 'all'], opts)
  const rows = readList(result.stdout).map(normalizeVm).filter(Boolean)
  return /** @type {Array<{index:string,name:string,deviceId:string,adbHostIp:string,adbPort:string,isProcessStarted:boolean,isAndroidStarted:boolean}>} */ (rows)
}

export async function mumuCreate(opts = {}) {
  await runMuMuManager(['create'], opts)
  const rows = await mumuList(opts)
  if (rows.length === 0) {
    throw new Error('MuMu create succeeded but no emulator instances were returned')
  }
  rows.sort((a, b) => Number.parseInt(b.index, 10) - Number.parseInt(a.index, 10))
  return rows[0]
}

export async function mumuRename(index, name, opts = {}) {
  await runMuMuManager(['rename', '-v', String(index), '-n', String(name)], opts)
}

export async function mumuLaunch(index, opts = {}) {
  await runMuMuManager(['control', '-v', String(index), 'launch'], opts)
}

export async function mumuShowWindow(index, opts = {}) {
  await runMuMuManager(['control', '-v', String(index), 'show_window'], opts)
}

export async function mumuShutdown(index, opts = {}) {
  await runMuMuManager(['control', '-v', String(index), 'shutdown'], opts)
}

export async function mumuInfo(index, opts = {}) {
  const result = await runMuMuManager(['info', '-v', String(index)], opts)
  const rows = readList(result.stdout).map(normalizeVm).filter(Boolean)
  if (rows.length === 0) return null
  return rows[0]
}

async function waitForMuMuInfo(index, opts = {}) {
  const attempts = opts.attempts ?? 40
  const delayMs = opts.delayMs ?? 3_000
  const requireDeviceId = opts.requireDeviceId === true
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const info = await mumuInfo(index, opts)
    if (info && (!requireDeviceId || info.deviceId)) {
      return info
    }
    if (attempt < attempts) {
      await sleepMs(delayMs)
    }
  }
  throw new Error(
    requireDeviceId
      ? `MuMu emulator ${index} did not expose deviceId after launch`
      : `MuMu emulator ${index} did not become available`,
  )
}

function patchAccountBinding(accountId, patch) {
  const updates = {}
  if (Object.prototype.hasOwnProperty.call(patch, 'mobile_device_id')) updates.mobile_device_id = patch.mobile_device_id
  if (Object.prototype.hasOwnProperty.call(patch, 'mobile_emulator_name'))
    updates.mobile_emulator_name = patch.mobile_emulator_name
  if (Object.prototype.hasOwnProperty.call(patch, 'mobile_vm_index')) updates.mobile_vm_index = patch.mobile_vm_index
  if (Object.prototype.hasOwnProperty.call(patch, 'status')) updates.status = patch.status
  const keys = Object.keys(updates)
  if (keys.length > 0) {
    const setClause = keys.map((key) => `${key} = @${key}`).join(', ')
    db.prepare(`UPDATE accounts SET ${setClause} WHERE id = @id`).run({ id: accountId, ...updates })
  }
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId)
}

export async function createMuMuProfile(opts = {}) {
  const created = await mumuCreate(opts)
  const emulatorIndex = created.index
  const targetName = String(opts.nameHint ?? '').trim() || `MuMu ${emulatorIndex}`
  if (targetName && targetName !== created.name) {
    await mumuRename(emulatorIndex, targetName, opts)
  }
  const refreshed = (await mumuInfo(emulatorIndex, opts)) ?? created
  const emulatorName = String(refreshed.name ?? '').trim() || targetName
  emitLog(opts, 'MUMU_PROFILE_CREATED', `index=${emulatorIndex} name=${emulatorName}`)
  return {
    emulatorIndex,
    emulatorName,
    deviceId: String(refreshed.deviceId ?? '').trim() || null,
  }
}

export async function launchMuMuProfile(opts = {}) {
  const emulatorIndex = String(opts.emulatorIndex ?? '').trim()
  if (!emulatorIndex) throw new Error('emulatorIndex is required')
  await mumuLaunch(emulatorIndex, opts)
  await mumuShowWindow(emulatorIndex, opts)
  const info = await waitForMuMuInfo(emulatorIndex, { ...opts, requireDeviceId: true })
  const emulatorName = String(info.name ?? '').trim() || `MuMu ${emulatorIndex}`
  emitLog(opts, 'MUMU_EMULATOR_OPENED', `index=${emulatorIndex} name=${emulatorName} device=${info.deviceId}`)
  return {
    emulatorIndex,
    emulatorName,
    deviceId: String(info.deviceId ?? '').trim(),
  }
}

export async function ensureMuMuAccountPrepared(account, opts = {}) {
  if (!account || typeof account !== 'object') {
    throw new Error('MuMu account is required')
  }
  const accountId = String(account.id ?? '').trim()
  const emulatorIndex = String(account.mobile_vm_index ?? '').trim()
  if (!accountId) throw new Error('MuMu account id is required')
  if (!emulatorIndex) throw new Error('MuMu account is missing emulatorIndex')
  const info = (await mumuInfo(emulatorIndex, opts)) ?? {
    index: emulatorIndex,
    name: String(account.mobile_emulator_name ?? '').trim() || `MuMu ${emulatorIndex}`,
    deviceId: String(account.mobile_device_id ?? '').trim(),
  }
  const updated = patchAccountBinding(accountId, {
    mobile_vm_index: emulatorIndex,
    mobile_emulator_name:
      String(info.name ?? '').trim() || String(account.mobile_emulator_name ?? '').trim() || `MuMu ${emulatorIndex}`,
    mobile_device_id: String(info.deviceId ?? '').trim() || String(account.mobile_device_id ?? '').trim() || null,
  })
  return { account: updated ?? account }
}

export async function launchMuMuAccountEmulator(account, opts = {}) {
  if (!account || typeof account !== 'object') {
    throw new Error('MuMu account is required')
  }
  const accountId = String(account.id ?? '').trim()
  const emulatorIndex = String(account.mobile_vm_index ?? '').trim()
  if (!accountId) throw new Error('MuMu account id is required')
  if (!emulatorIndex) throw new Error('MuMu account is missing emulatorIndex')
  const launched = await launchMuMuProfile({ ...opts, emulatorIndex })
  const updated = patchAccountBinding(accountId, {
    mobile_vm_index: launched.emulatorIndex,
    mobile_emulator_name: launched.emulatorName,
    mobile_device_id: launched.deviceId,
  })
  return {
    account: updated ?? account,
    emulatorIndex: launched.emulatorIndex,
    emulatorName: launched.emulatorName,
    deviceId: launched.deviceId,
  }
}
