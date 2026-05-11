import { filterOnlineDevices, parseAdbDevicesList } from '../executor/mobile/adbDevices.js'
import { db, newId } from '../db.js'

/** @typedef {{ id: string, adb_serial: string, status: string, linked_account_id: string | null, last_seen: number, created_at?: string }} AdbDeviceRow */

/**
 * Ensure DB rows exist for mobile accounts that already store an adb serial on the account.
 */
export function seedAdbDevicesFromAccounts() {
  const rows = db
    .prepare(
      `SELECT id, mobile_device_id FROM accounts
        WHERE LOWER(TRIM(COALESCE(account_type, ''))) = 'mobile'
          AND TRIM(COALESCE(mobile_device_id, '')) <> ''`,
    )
    .all()
  for (const row of rows) {
    const accountId = String(row.id)
    const serial = String(row.mobile_device_id).trim()
    const existing = db.prepare('SELECT id FROM adb_devices WHERE adb_serial = ?').get(serial)
    if (existing) {
      db.prepare(
        `UPDATE adb_devices SET linked_account_id = ?, status = 'busy' WHERE adb_serial = ?`,
      ).run(accountId, serial)
    } else {
      db.prepare(
        `INSERT INTO adb_devices (id, adb_serial, status, linked_account_id, last_seen)
         VALUES (?, ?, 'offline', ?, 0)`,
      ).run(newId('dev'), serial, accountId)
    }
  }
}

/**
 * @param {string} stdout from `adb devices`
 */
export function syncAdbDevicesFromScan(stdout) {
  const online = filterOnlineDevices(parseAdbDevicesList(stdout))
  const onlineSerials = new Set(online.map((r) => r.id))
  const now = Date.now()

  const upsertOnline = db.prepare(`
    INSERT INTO adb_devices (id, adb_serial, status, linked_account_id, last_seen)
    VALUES (@id, @adb_serial, @status, @linked_account_id, @last_seen)
    ON CONFLICT(adb_serial) DO UPDATE SET
      last_seen = excluded.last_seen,
      status = CASE
        WHEN adb_devices.linked_account_id IS NOT NULL AND TRIM(COALESCE(adb_devices.linked_account_id, '')) != '' THEN 'busy'
        ELSE 'online'
      END
  `)

  for (const serial of onlineSerials) {
    const row = /** @type {{ linked_account_id: string | null } | undefined} */ (
      db.prepare('SELECT linked_account_id FROM adb_devices WHERE adb_serial = ?').get(serial)
    )
    const linked = row?.linked_account_id ?? null
    const status = linked ? 'busy' : 'online'
    const existingId = db.prepare('SELECT id FROM adb_devices WHERE adb_serial = ?').get(serial)
    const id = existingId?.id ?? newId('dev')
    upsertOnline.run({
      id,
      adb_serial: serial,
      status,
      linked_account_id: linked,
      last_seen: now,
    })
  }

  const tracked = db.prepare(`SELECT adb_serial FROM adb_devices WHERE status IN ('online', 'busy')`).all()
  for (const { adb_serial } of tracked) {
    if (!onlineSerials.has(adb_serial)) {
      db.prepare(`UPDATE adb_devices SET status = 'offline' WHERE adb_serial = ?`).run(adb_serial)
    }
  }
}

/**
 * @returns {AdbDeviceRow[]}
 */
export function listAdbDevices() {
  return /** @type {AdbDeviceRow[]} */ (
    db
      .prepare(
        'SELECT id, adb_serial, status, linked_account_id, last_seen, created_at FROM adb_devices ORDER BY adb_serial',
      )
      .all()
  )
}

/**
 * Pick first online unlinked device and bind to account (sets accounts.mobile_device_id).
 * @returns {{ adb_serial: string } | null}
 */
export function assignFreeAdbDeviceToAccount(accountId) {
  const id = String(accountId ?? '').trim()
  if (!id) return null
  const acc = db.prepare('SELECT id, account_type, mobile_device_id FROM accounts WHERE id = ?').get(id)
  if (!acc || String(acc.account_type ?? '').trim().toLowerCase() !== 'mobile') return null
  const existing = String(acc.mobile_device_id ?? '').trim()
  if (existing) return { adb_serial: existing }

  const tx = db.transaction(() => {
    const free = db
      .prepare(
        `SELECT id, adb_serial FROM adb_devices
          WHERE status = 'online' AND (linked_account_id IS NULL OR TRIM(linked_account_id) = '')
          ORDER BY last_seen DESC LIMIT 1`,
      )
      .get()
    if (!free) return null
    const adbSerial = String(free.adb_serial)
    db.prepare(`UPDATE adb_devices SET linked_account_id = ?, status = 'busy' WHERE id = ?`).run(id, free.id)
    db.prepare(`UPDATE accounts SET mobile_device_id = ? WHERE id = ?`).run(adbSerial, id)
    return { adb_serial: adbSerial }
  })

  return tx()
}

/**
 * Clear registry link when account is removed or serial changes.
 */
export function releaseAdbDeviceForAccount(accountId) {
  const id = String(accountId ?? '').trim()
  if (!id) return
  db.prepare(`UPDATE adb_devices SET linked_account_id = NULL, status = 'offline' WHERE linked_account_id = ?`).run(id)
}
