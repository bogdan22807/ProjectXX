import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(__dirname, '..', 'data')
const dbPath = path.join(dataDir, 'app.db')

fs.mkdirSync(dataDir, { recursive: true })

const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

/**
 * Idempotent column add for existing SQLite files (CREATE TABLE IF NOT EXISTS does not add new columns).
 */
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all()
  if (cols.some((c) => c.name === column)) return
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}

db.exec(`
  CREATE TABLE IF NOT EXISTS proxies (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL DEFAULT '',
    host TEXT NOT NULL,
    port TEXT NOT NULL DEFAULT '',
    username TEXT NOT NULL DEFAULT '',
    password TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'Needs Check',
    assigned_to TEXT NOT NULL DEFAULT '',
    last_check TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS browser_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    linked_proxy_id TEXT,
    linked_account_id TEXT,
    status TEXT NOT NULL DEFAULT 'Ready',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (linked_proxy_id) REFERENCES proxies(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    login TEXT NOT NULL DEFAULT '',
    cookies TEXT NOT NULL DEFAULT '',
    platform TEXT NOT NULL,
    proxy_id TEXT,
    browser_profile_id TEXT,
    account_type TEXT NOT NULL DEFAULT 'browser',
    mobile_mode TEXT NOT NULL DEFAULT 'mumu',
    mobile_proxy_id TEXT NOT NULL DEFAULT '',
    mobile_device_id TEXT NOT NULL DEFAULT '',
    mobile_emulator_name TEXT NOT NULL DEFAULT '',
    mobile_vm_index TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'New',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (proxy_id) REFERENCES proxies(id) ON DELETE SET NULL,
    FOREIGN KEY (browser_profile_id) REFERENCES browser_profiles(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS logs (
    id TEXT PRIMARY KEY,
    account_id TEXT,
    action TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS emulators (
    id TEXT PRIMARY KEY,
    emulator_name TEXT NOT NULL,
    mumu_instance_name TEXT NOT NULL,
    adb_serial TEXT,
    linked_account_id TEXT,
    status TEXT NOT NULL DEFAULT 'offline',
    last_seen INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (linked_account_id) REFERENCES accounts(id) ON DELETE SET NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS ux_emulators_serial_nonempty ON emulators(adb_serial)
    WHERE adb_serial IS NOT NULL AND length(trim(adb_serial)) > 0;
  CREATE INDEX IF NOT EXISTS idx_emulators_linked ON emulators(linked_account_id);
  CREATE INDEX IF NOT EXISTS idx_emulators_status ON emulators(status);
`)

ensureColumn('proxies', 'provider', "TEXT NOT NULL DEFAULT ''")
ensureColumn('proxies', 'host', "TEXT NOT NULL DEFAULT ''")
ensureColumn('proxies', 'port', "TEXT NOT NULL DEFAULT ''")
ensureColumn('proxies', 'username', "TEXT NOT NULL DEFAULT ''")
ensureColumn('proxies', 'password', "TEXT NOT NULL DEFAULT ''")
ensureColumn('proxies', 'status', "TEXT NOT NULL DEFAULT 'Needs Check'")
ensureColumn('proxies', 'assigned_to', "TEXT NOT NULL DEFAULT ''")
ensureColumn('proxies', 'last_check', 'TEXT')
ensureColumn('proxies', 'proxy_scheme', "TEXT NOT NULL DEFAULT ''")
ensureColumn('proxies', 'check_result', "TEXT NOT NULL DEFAULT ''")
ensureColumn('proxies', 'created_at', "TEXT NOT NULL DEFAULT (datetime('now'))")

/** Legacy proxy status labels → simple machine statuses for UI */
try {
  db.prepare(`UPDATE proxies SET status = 'unknown' WHERE status = 'Needs Check'`).run()
  db.prepare(`UPDATE proxies SET status = 'ok' WHERE status = 'Active'`).run()
  db.prepare(`UPDATE proxies SET status = 'network' WHERE status = 'Dead'`).run()
} catch {
  /* ignore */
}

ensureColumn('browser_profiles', 'name', "TEXT NOT NULL DEFAULT ''")
ensureColumn('browser_profiles', 'linked_proxy_id', 'TEXT')
ensureColumn('browser_profiles', 'linked_account_id', 'TEXT')
ensureColumn('browser_profiles', 'status', "TEXT NOT NULL DEFAULT 'Ready'")
ensureColumn('browser_profiles', 'created_at', "TEXT NOT NULL DEFAULT (datetime('now'))")

ensureColumn('accounts', 'name', "TEXT NOT NULL DEFAULT ''")
ensureColumn('accounts', 'login', "TEXT NOT NULL DEFAULT ''")
ensureColumn('accounts', 'cookies', "TEXT NOT NULL DEFAULT ''")
ensureColumn('accounts', 'platform', "TEXT NOT NULL DEFAULT 'Other'")
ensureColumn('accounts', 'proxy_id', 'TEXT')
ensureColumn('accounts', 'browser_profile_id', 'TEXT')
ensureColumn('accounts', 'account_type', "TEXT NOT NULL DEFAULT 'browser'")
ensureColumn('accounts', 'mobile_mode', "TEXT NOT NULL DEFAULT 'mumu'")
ensureColumn('accounts', 'mobile_proxy_id', "TEXT NOT NULL DEFAULT ''")
ensureColumn('accounts', 'mobile_device_id', "TEXT NOT NULL DEFAULT ''")
ensureColumn('accounts', 'mobile_emulator_name', "TEXT NOT NULL DEFAULT ''")
ensureColumn('accounts', 'mobile_vm_index', "TEXT NOT NULL DEFAULT ''")
ensureColumn('accounts', 'status', "TEXT NOT NULL DEFAULT 'New'")
ensureColumn('accounts', 'created_at', "TEXT NOT NULL DEFAULT (datetime('now'))")
ensureColumn('accounts', 'browser_engine', "TEXT NOT NULL DEFAULT 'chromium'")

try {
  db.prepare(
    `UPDATE accounts
        SET mobile_proxy_id = proxy_id
      WHERE TRIM(COALESCE(account_type, 'browser')) = 'mobile'
        AND TRIM(COALESCE(proxy_id, '')) <> ''
        AND TRIM(COALESCE(mobile_proxy_id, '')) = ''`,
  ).run()
  db.prepare(
    `UPDATE accounts
        SET proxy_id = NULL
      WHERE TRIM(COALESCE(account_type, 'browser')) = 'mobile'
        AND TRIM(COALESCE(proxy_id, '')) <> ''`,
  ).run()
  db.prepare(
    `UPDATE accounts
        SET browser_profile_id = NULL
      WHERE LOWER(TRIM(COALESCE(account_type, ''))) = 'mobile'
        AND TRIM(COALESCE(browser_profile_id, '')) <> ''`,
  ).run()
} catch {
  /* ignore */
}

try {
  const legacy = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='adb_devices'`).get()
  if (legacy) {
    const cols = db.prepare(`PRAGMA table_info(adb_devices)`).all()
    const names = new Set(cols.map((/** @type {{ name: string }} */ c) => c.name))
    const rows = db.prepare('SELECT * FROM adb_devices').all()
    for (const r of rows) {
      const serial = String(r.adb_serial ?? '').trim()
      const emuName = names.has('emulator_name') ? String(r.emulator_name ?? '').trim() : ''
      const mumuInst = names.has('mumu_instance_name') ? String(r.mumu_instance_name ?? '').trim() : ''
      db.prepare(
        `INSERT OR IGNORE INTO emulators (id, emulator_name, mumu_instance_name, adb_serial, linked_account_id, status, last_seen, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`,
      ).run(
        String(r.id),
        emuName || serial || String(r.id),
        mumuInst,
        serial || null,
        r.linked_account_id ?? null,
        String(r.status ?? 'offline'),
        Number(r.last_seen ?? 0),
        r.created_at ?? null,
      )
    }
    db.exec('DROP TABLE adb_devices')
  }
} catch (e) {
  console.error('[db] migrate adb_devices → emulators', e)
}

export function newId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export { db, dbPath }
