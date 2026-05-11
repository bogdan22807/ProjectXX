import { filterOnlineDevices, parseAdbDevicesList } from '../executor/mobile/adbDevices.js'
import { resolveMuMuVmIndexFromLabel } from '../executor/mobile/mumuManager.js'
import { db, newId } from '../db.js'

/**
 * Seed registry rows for mobile accounts that already have adb serial on the account.
 */
export function seedEmulatorsFromAccounts() {
  const rows = db
    .prepare(
      `SELECT id, name, mobile_device_id, mobile_emulator_name FROM accounts
        WHERE LOWER(TRIM(COALESCE(account_type, ''))) = 'mobile'
          AND TRIM(COALESCE(mobile_device_id, '')) <> ''`,
    )
    .all()
  for (const row of rows) {
    const accountId = String(row.id)
    const serial = String(row.mobile_device_id).trim()
    const existing = db.prepare('SELECT id FROM emulators WHERE adb_serial = ?').get(serial)
    if (existing) {
      db.prepare(
        `UPDATE emulators SET linked_account_id = ?, status = 'busy' WHERE adb_serial = ?`,
      ).run(accountId, serial)
    } else {
      db.prepare(
        `INSERT INTO emulators (id, emulator_name, mumu_instance_name, adb_serial, linked_account_id, status, last_seen)
         VALUES (?, ?, ?, ?, ?, 'offline', 0)`,
      ).run(
        newId('emu'),
        String(row.name ?? '').trim() || serial,
        String(row.mobile_emulator_name ?? '').trim(),
        serial,
        accountId,
      )
    }
  }
}

/**
 * @param {string} stdout from `adb devices`
 */
export function syncEmulatorsFromAdb(stdout) {
  const online = filterOnlineDevices(parseAdbDevicesList(stdout))
  const onlineSerials = new Set(online.map((r) => r.id))
  const now = Date.now()

  for (const serial of onlineSerials) {
    const hit = db.prepare('SELECT id, linked_account_id FROM emulators WHERE adb_serial = ?').get(serial)
    if (!hit) continue
    const linked = hit.linked_account_id
    const status = linked ? 'busy' : 'online'
    db.prepare(
      `UPDATE emulators SET last_seen = ?, status = ? WHERE id = ?`,
    ).run(now, status, hit.id)
  }

  const bound = db
    .prepare(`SELECT id, adb_serial FROM emulators WHERE adb_serial IS NOT NULL AND trim(adb_serial) != ''`)
    .all()
  for (const row of bound) {
    const serial = String(row.adb_serial)
    if (!onlineSerials.has(serial)) {
      db.prepare(`UPDATE emulators SET status = 'offline' WHERE id = ?`).run(row.id)
    }
  }
}

export function listEmulatorsWithAccounts() {
  return db
    .prepare(
      `SELECT e.id, e.emulator_name, e.mumu_instance_name, e.adb_serial, e.linked_account_id, e.status, e.last_seen, e.created_at,
              a.name AS linked_account_name, a.login AS linked_account_login
         FROM emulators e
         LEFT JOIN accounts a ON a.id = e.linked_account_id
        ORDER BY e.created_at DESC`,
    )
    .all()
}

export function createEmulatorRecord(emulatorName, mumuInstanceName) {
  const name = String(emulatorName ?? '').trim()
  const inst = String(mumuInstanceName ?? '').trim()
  if (!name) throw new Error('emulator_name is required')
  if (!inst) throw new Error('mumu_instance_name is required')
  const id = newId('emu')
  db.prepare(
    `INSERT INTO emulators (id, emulator_name, mumu_instance_name, adb_serial, linked_account_id, status, last_seen)
     VALUES (?, ?, ?, NULL, NULL, 'offline', 0)`,
  ).run(id, name, inst)
  return db.prepare('SELECT * FROM emulators WHERE id = ?').get(id)
}

export function getEmulatorById(id) {
  return db.prepare('SELECT * FROM emulators WHERE id = ?').get(String(id ?? '').trim())
}

export function updateEmulatorAdbSerial(emulatorId, adbSerial) {
  const serial = String(adbSerial ?? '').trim()
  if (!serial) throw new Error('adb_serial is empty')
  const other = db.prepare(`SELECT id FROM emulators WHERE adb_serial = ? AND id != ?`).get(serial, emulatorId)
  if (other) {
    db.prepare(`UPDATE emulators SET adb_serial = NULL, status = 'offline' WHERE id = ?`).run(other.id)
  }
  db.prepare(`UPDATE emulators SET adb_serial = ?, status = 'online', last_seen = ? WHERE id = ?`).run(
    serial,
    Date.now(),
    emulatorId,
  )
}

/**
 * @returns {{ adb_serial: string } | null}
 */
export function assignFreeEmulatorToMobileAccount(accountId) {
  const id = String(accountId ?? '').trim()
  if (!id) return null
  const acc = db.prepare('SELECT id, account_type, mobile_device_id FROM accounts WHERE id = ?').get(id)
  if (!acc || String(acc.account_type ?? '').trim().toLowerCase() !== 'mobile') return null
  const existing = String(acc.mobile_device_id ?? '').trim()
  if (existing) return { adb_serial: existing }

  const tx = db.transaction(() => {
    const free = db
      .prepare(
        `SELECT id, adb_serial FROM emulators
          WHERE status = 'online'
            AND adb_serial IS NOT NULL AND trim(adb_serial) != ''
            AND (linked_account_id IS NULL OR trim(linked_account_id) = '')
          ORDER BY last_seen DESC LIMIT 1`,
      )
      .get()
    if (!free) return null
    const adbSerial = String(free.adb_serial)
    db.prepare(`UPDATE emulators SET linked_account_id = ?, status = 'busy' WHERE id = ?`).run(id, free.id)
    db.prepare(`UPDATE accounts SET mobile_device_id = ? WHERE id = ?`).run(adbSerial, id)
    return { adb_serial: adbSerial }
  })

  return tx()
}

export function releaseEmulatorForAccount(accountId) {
  const id = String(accountId ?? '').trim()
  if (!id) return
  db.prepare(`UPDATE accounts SET mobile_device_id = '' WHERE id = ?`).run(id)
  db.prepare(`UPDATE emulators SET linked_account_id = NULL, status = 'offline' WHERE linked_account_id = ?`).run(id)
}

/**
 * @param {string} emulatorId
 * @param {string} accountId
 * @param {Record<string, unknown>} [opts]
 */
export async function bindEmulatorToAccount(emulatorId, accountId, opts = {}) {
  const eid = String(emulatorId ?? '').trim()
  const aid = String(accountId ?? '').trim()
  if (!eid || !aid) throw new Error('emulator id and account id are required')

  const emu = db.prepare('SELECT * FROM emulators WHERE id = ?').get(eid)
  if (!emu) throw new Error('Emulator not found')
  const serial = String(emu.adb_serial ?? '').trim()
  if (!serial) throw new Error('Emulator has no adb_serial yet — use Launch first')

  const acc = db.prepare('SELECT id, account_type FROM accounts WHERE id = ?').get(aid)
  if (!acc) throw new Error('Account not found')
  if (String(acc.account_type ?? '').trim().toLowerCase() !== 'mobile') {
    throw new Error('Account must be account_type=mobile')
  }

  const idx = await resolveMuMuVmIndexFromLabel(String(emu.mumu_instance_name), opts)

  const tx = db.transaction(() => {
    db.prepare(`UPDATE emulators SET linked_account_id = NULL, status = 'offline' WHERE linked_account_id = ?`).run(aid)
    db.prepare(`UPDATE emulators SET linked_account_id = ?, status = 'busy' WHERE id = ?`).run(aid, eid)
    db.prepare(`UPDATE accounts SET mobile_device_id = ?, mobile_vm_index = ?, mobile_emulator_name = ? WHERE id = ?`).run(
      serial,
      idx,
      String(emu.emulator_name ?? '').trim(),
      aid,
    )
  })
  tx()
}
