/**
 * Parse `adb devices` output for MuMu / emulator / physical device selection.
 * The first column is the device **adb serial** (exact string used with `adb -s <serial>`).
 */

/**
 * @typedef {{ id: string, state: string }} AdbDeviceRow
 * @description `id` is the adb serial from the devices list (do not treat numeric suffixes as a separate "port" id).
 */

/**
 * @param {string} stdout
 * @returns {AdbDeviceRow[]}
 */
export function parseAdbDevicesList(stdout) {
  const lines = String(stdout ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  /** @type {AdbDeviceRow[]} */
  const out = []
  for (const line of lines) {
    if (line.startsWith('List of devices')) continue
    const parts = line.split(/\s+/).filter(Boolean)
    if (parts.length < 2) continue
    const id = parts[0]
    const state = parts.slice(1).join(' ')
    out.push({ id, state })
  }
  return out
}

/**
 * Devices reported as `device` (online / authorized).
 * @param {AdbDeviceRow[]} rows
 * @returns {AdbDeviceRow[]}
 */
export function filterOnlineDevices(rows) {
  return rows.filter((r) => r.state === 'device')
}
