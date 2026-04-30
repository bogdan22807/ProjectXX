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
ensureColumn('accounts', 'mobile_device_id', "TEXT NOT NULL DEFAULT ''")
ensureColumn('accounts', 'mobile_emulator_name', "TEXT NOT NULL DEFAULT ''")
ensureColumn('accounts', 'mobile_vm_index', "TEXT NOT NULL DEFAULT ''")
ensureColumn('accounts', 'status', "TEXT NOT NULL DEFAULT 'New'")
ensureColumn('accounts', 'created_at', "TEXT NOT NULL DEFAULT (datetime('now'))")
ensureColumn('accounts', 'browser_engine', "TEXT NOT NULL DEFAULT 'chromium'")

export function newId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export { db, dbPath }
