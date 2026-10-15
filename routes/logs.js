const express = require('express');
const multer = require('multer');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { analyzeLog, buildGraph, computeStats, dashboard } = require('../analysis');
const { pullEvents } = require('../rezanok');
const { REZANOK_API } = require('../config');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// --- синтаксичний аналіз і валідація журналу ---
function parseCsv(text) {
  const [head, ...lines] = text.trim().split(/\r?\n/);
  const cols = head.split(',').map((c) => c.trim());
  return lines
    .filter((l) => l.trim())
    .map((ln) => {
      const cells = ln.split(',');
      return Object.fromEntries(
        cols.map((c, i) => [c, (cells[i] || '').trim()])
      );
    });
}

const REQUIRED = ['case_id', 'activity', 'ts'];
function validateRows(rows) {
  if (!rows.length) return 'Порожній журнал';
  for (const col of REQUIRED)
    if (!(col in rows[0])) return `Відсутня обов'язкова колонка: ${col}`;
  return null;
}

function insertEvents(logId, rows) {
  const stmt = db.prepare(
    `INSERT INTO events (log_id, case_id, activity, ts, resource)
     VALUES (?, ?, ?, ?, ?)`
  );
  db.transaction((rows) => {
    for (const r of rows)
      stmt.run(logId, r.case_id, r.activity, r.ts, r.resource || null);
  })(rows);
}

function saveBottlenecks(logId, found) {
  const stmt = db.prepare(
    `INSERT INTO bottlenecks (log_id, activity, avg_wait_min, avg_proc_min,
       total_min, frequency, z_score, severity)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  db.transaction((found) => {
    for (const b of found)
      stmt.run(logId, b.activity, b.avgWait, b.avgProc, b.total,
        b.frequency, b.z_score, b.severity);
  })(found);
}

function ownedLog(req, res) {
  const log = db.prepare('SELECT * FROM logs WHERE id = ?').get(req.params.id);
  if (!log || log.user_id !== req.user.id) {
    res.status(404).json({ error: 'Журнал не знайдено' });
    return null;
  }
  return log;
}

// перелік журналів користувача
router.get('/', requireAuth, (req, res) => {
  const rows = db.prepare(
    `SELECT id, name, filename, uploaded_at, events_count, cases_count,
       source_type,
       (SELECT COUNT(*) FROM bottlenecks b WHERE b.log_id = logs.id)
         AS bottlenecks
     FROM logs WHERE user_id = ? ORDER BY uploaded_at DESC`
  ).all(req.user.id);
  res.json(rows);
});

// завантаження та аналіз журналу
router.post('/', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не надано' });
  let rows;
  try {
    rows = parseCsv(req.file.buffer.toString('utf8'));
  } catch {
    return res.status(422).json({ error: 'Не вдалося розібрати CSV' });
  }
  const err = validateRows(rows);
  if (err) return res.status(422).json({ error: err });

  const name = (req.body.name || req.file.originalname).slice(0, 200);
  const info = db
    .prepare('INSERT INTO logs (user_id, name, filename) VALUES (?, ?, ?)')
    .run(req.user.id, name, req.file.originalname);
  const logId = info.lastInsertRowid;

  insertEvents(logId, rows);
  const cases = new Set(rows.map((r) => r.case_id)).size;
  db.prepare('UPDATE logs SET events_count = ?, cases_count = ? WHERE id = ?')
    .run(rows.length, cases, logId);

  const found = analyzeLog(logId);
  saveBottlenecks(logId, found);
  res.status(201).json({ id: logId, bottlenecks: found });
});

// метрики та деталі журналу
router.get('/:id', requireAuth, (req, res) => {
  const log = ownedLog(req, res);
  if (!log) return;
  const stats = computeStats(log.id);
  res.json({ log, activities: stats.activities, threshold: stats.threshold });
});

// перелік вузьких місць
router.get('/:id/bottlenecks', requireAuth, (req, res) => {
  const log = ownedLog(req, res);
  if (!log) return;
  const rows = db.prepare(
    'SELECT * FROM bottlenecks WHERE log_id = ? ORDER BY avg_wait_min DESC'
  ).all(log.id);
  res.json(rows);
});

// дані графа процесу
router.get('/:id/graph', requireAuth, (req, res) => {
  const log = ownedLog(req, res);
  if (!log) return;
  res.json(buildGraph(log.id));
});

// повний набір даних для дашборду аналізу
router.get('/:id/dashboard', requireAuth, (req, res) => {
  const log = ownedLog(req, res);
  if (!log) return;
  res.json({ log, ...dashboard(log.id) });
});

// видалення журналу
router.delete('/:id', requireAuth, (req, res) => {
  const log = ownedLog(req, res);
  if (!log) return;
  db.prepare('DELETE FROM logs WHERE id = ?').run(log.id);
  res.json({ ok: true });
});

// --- живий конектор до системи обліку Rezanok ---

// Перечитує дані з Rezanok API, оновлює події журналу й перераховує аналіз.
async function syncRezanok(logId) {
  const { events } = await pullEvents();
  db.prepare('DELETE FROM events WHERE log_id = ?').run(logId);
  db.prepare('DELETE FROM bottlenecks WHERE log_id = ?').run(logId);
  insertEvents(logId, events);
  const cases = new Set(events.map((e) => e.case_id)).size;
  db.prepare(
    "UPDATE logs SET events_count = ?, cases_count = ?, uploaded_at = datetime('now') WHERE id = ?"
  ).run(events.length, cases, logId);
  const found = analyzeLog(logId);
  saveBottlenecks(logId, found);
  return { events: events.length, cases, bottlenecks: found };
}

// підключення живого джерела: створює журнал типу 'rezanok' і робить перший імпорт
router.post('/connect', requireAuth, async (req, res) => {
  const name = (req.body && req.body.name) || 'Rezanok · виробничий процес (live)';
  const info = db
    .prepare(
      "INSERT INTO logs (user_id, name, filename, source_type, source_url) VALUES (?, ?, 'rezanok-api', 'rezanok', ?)"
    )
    .run(req.user.id, name, REZANOK_API);
  const logId = info.lastInsertRowid;
  try {
    const r = await syncRezanok(logId);
    res.status(201).json({ id: logId, ...r });
  } catch (e) {
    db.prepare('DELETE FROM logs WHERE id = ?').run(logId);
    res
      .status(502)
      .json({ error: 'Не вдалося підключитися до Rezanok API: ' + e.message });
  }
});

// повторна синхронізація: перечитати поточний стан процесу з Rezanok
router.post('/:id/sync', requireAuth, async (req, res) => {
  const log = ownedLog(req, res);
  if (!log) return;
  if (log.source_type !== 'rezanok')
    return res
      .status(400)
      .json({ error: 'Цей журнал не підключено до Rezanok' });
  try {
    const r = await syncRezanok(log.id);
    res.json(r);
  } catch (e) {
    res.status(502).json({ error: 'Помилка синхронізації: ' + e.message });
  }
});

module.exports = router;
