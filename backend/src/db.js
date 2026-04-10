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

export function newId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export { db, dbPath }
