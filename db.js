const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'processlens.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user'
    CHECK(role IN ('user','admin')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id)
    ON DELETE CASCADE,
  name TEXT NOT NULL,
  filename TEXT NOT NULL,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
  events_count INTEGER NOT NULL DEFAULT 0,
  cases_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  log_id INTEGER NOT NULL REFERENCES logs(id)
    ON DELETE CASCADE,
  case_id TEXT NOT NULL,
  activity TEXT NOT NULL,
  ts TEXT NOT NULL,
  resource TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_case
  ON events(log_id, case_id, ts);
CREATE INDEX IF NOT EXISTS idx_events_act
  ON events(log_id, activity);

CREATE TABLE IF NOT EXISTS bottlenecks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  log_id INTEGER NOT NULL REFERENCES logs(id)
    ON DELETE CASCADE,
  activity TEXT NOT NULL,
  avg_wait_min REAL NOT NULL,
  avg_proc_min REAL NOT NULL,
  total_min REAL NOT NULL,
  frequency INTEGER NOT NULL,
  z_score REAL NOT NULL,
  severity TEXT NOT NULL
);
`);

// Міграція: тип джерела журналу. 'file' — завантажений CSV (типово),
// 'rezanok' — живий конектор до системи обліку (повторний імпорт з API).
const logCols = db.prepare('PRAGMA table_info(logs)').all().map((c) => c.name);
if (!logCols.includes('source_type'))
  db.exec("ALTER TABLE logs ADD COLUMN source_type TEXT NOT NULL DEFAULT 'file'");
if (!logCols.includes('source_url'))
  db.exec('ALTER TABLE logs ADD COLUMN source_url TEXT');

module.exports = db;
