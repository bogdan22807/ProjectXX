import { db } from '../db.js'
import { launchMuMuProfile, mumuLaunch, mumuShutdown, mumuShowWindow, resolveMuMuVmIndexFromLabel } from '../executor/mobile/mumuManager.js'
import { getEmulatorById, updateEmulatorAdbSerial } from './emulatorRegistry.js'

/**
 * Launch MuMu VM, wait for adb serial, persist on emulator row.
 * @param {string} emulatorId
 * @param {{ emit?: (a: string, d?: string) => void }} [opts]
 */
export async function controlLaunchEmulator(emulatorId, opts = {}) {
  const row = getEmulatorById(emulatorId)
  if (!row) throw new Error('Emulator not found')
  const index = await resolveMuMuVmIndexFromLabel(row.mumu_instance_name, opts)
  const launched = await launchMuMuProfile({ ...opts, emulatorIndex: index })
  updateEmulatorAdbSerial(emulatorId, launched.adbSerial)
  return { adb_serial: launched.adbSerial, emulatorIndex: launched.emulatorIndex }
}

/**
 * @param {string} emulatorId
 */
export async function controlShutdownEmulator(emulatorId, opts = {}) {
  const row = getEmulatorById(emulatorId)
  if (!row) throw new Error('Emulator not found')
  const index = await resolveMuMuVmIndexFromLabel(row.mumu_instance_name, opts)
  await mumuShutdown(index, opts)
  db.prepare(`UPDATE emulators SET status = 'offline' WHERE id = ?`).run(emulatorId)
}

/**
 * Foreground MuMu window (starts VM if needed).
 * @param {string} emulatorId
 */
export async function controlOpenEmulatorWindow(emulatorId, opts = {}) {
  const row = getEmulatorById(emulatorId)
  if (!row) throw new Error('Emulator not found')
  const index = await resolveMuMuVmIndexFromLabel(row.mumu_instance_name, opts)
  await mumuLaunch(index, opts)
  await mumuShowWindow(index, opts)
  return { ok: true }
}
