// Початкове наповнення БД: адміністратор, аналітик і демо-журнал.
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const { analyzeLog } = require('./analysis');

function upsertUser(email, password, role) {
  const ex = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (ex) return ex.id;
  const hash = bcrypt.hashSync(password, 10);
  return db
    .prepare('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)')
    .run(email, hash, role).lastInsertRowid;
}

upsertUser('admin@processlens.local', 'admin123', 'admin');
const analystId = upsertUser('analyst@processlens.local', 'analyst123', 'user');
console.log('Користувачі:');
console.log('  admin@processlens.local / admin123 (адміністратор)');
console.log('  analyst@processlens.local / analyst123 (аналітик)');

const sample = path.join(__dirname, 'sample', 'order_process.csv');
const already = db
  .prepare('SELECT id FROM logs WHERE user_id = ? AND name = ?')
  .get(analystId, 'order_process_2026.csv');

if (!already && fs.existsSync(sample)) {
  const [head, ...ls] = fs.readFileSync(sample, 'utf8').trim().split(/\r?\n/);
  const cols = head.split(',').map((c) => c.trim());
  const rows = ls
    .filter((l) => l.trim())
    .map((l) =>
      Object.fromEntries(l.split(',').map((v, i) => [cols[i], v.trim()]))
    );

  const logId = db
    .prepare('INSERT INTO logs (user_id, name, filename) VALUES (?, ?, ?)')
    .run(analystId, 'order_process_2026.csv', 'order_process.csv').lastInsertRowid;

  const ev = db.prepare(
    `INSERT INTO events (log_id, case_id, activity, ts, resource)
     VALUES (?, ?, ?, ?, ?)`
  );
  db.transaction((rows) => {
    for (const r of rows)
      ev.run(logId, r.case_id, r.activity, r.ts, r.resource || null);
  })(rows);
  db.prepare('UPDATE logs SET events_count = ?, cases_count = ? WHERE id = ?')
    .run(rows.length, new Set(rows.map((r) => r.case_id)).size, logId);

  const found = analyzeLog(logId);
  const bs = db.prepare(
    `INSERT INTO bottlenecks (log_id, activity, avg_wait_min, avg_proc_min,
       total_min, frequency, z_score, severity)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  db.transaction((found) => {
    for (const b of found)
      bs.run(logId, b.activity, b.avgWait, b.avgProc, b.total,
        b.frequency, b.z_score, b.severity);
  })(found);
  console.log(`Демо-журнал завантажено: ${rows.length} подій, ` +
    `виявлено вузьких місць — ${found.length}`);
}

process.exit(0);
