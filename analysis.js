const db = require('./db');

// час у хвилинах між двома мітками ISO 8601
function diffMin(a, b) {
  return (new Date(b) - new Date(a)) / 60000;
}

function mean(xs) {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}

function std(xs, mu) {
  if (xs.length < 2) return 0;
  const v = xs.reduce((s, x) => s + (x - mu) ** 2, 0) / xs.length;
  return Math.sqrt(v);
}

// Обчислює метрики активностей і переходів для журналу logId.
// Активність позначається як вузьке місце, якщо її середній час
// очікування перевищує статистичний поріг mu + k * sigma.
function computeStats(logId, k = 1) {
  const rows = db.prepare(
    `SELECT case_id, activity, ts FROM events
     WHERE log_id = ? ORDER BY case_id, ts`
  ).all(logId);

  const cases = new Map();
  for (const r of rows) {
    if (!cases.has(r.case_id)) cases.set(r.case_id, []);
    cases.get(r.case_id).push(r);
  }

  const acc = new Map();   // activity -> { wait, proc, freq }
  const trans = new Map(); // "from->to" -> { from, to, times }
  for (const seq of cases.values()) {
    for (let i = 0; i < seq.length; i++) {
      const a = acc.get(seq[i].activity) ||
                { wait: [], proc: [], freq: 0 };
      a.freq++;
      if (i > 0) {
        const w = diffMin(seq[i - 1].ts, seq[i].ts);
        a.wait.push(w);
        const key = seq[i - 1].activity + '' + seq[i].activity;
        const t = trans.get(key) ||
          { from: seq[i - 1].activity, to: seq[i].activity, times: [] };
        t.times.push(w);
        trans.set(key, t);
      }
      if (i < seq.length - 1)
        a.proc.push(diffMin(seq[i].ts, seq[i + 1].ts));
      acc.set(seq[i].activity, a);
    }
  }

  const activities = [...acc].map(([activity, a]) => ({
    activity,
    avgWait: mean(a.wait),
    avgProc: mean(a.proc),
    total: (mean(a.wait) + mean(a.proc)) * a.freq,
    frequency: a.freq,
  }));

  const mu = mean(activities.map((s) => s.avgWait));
  const sigma = std(activities.map((s) => s.avgWait), mu);
  const threshold = mu + k * sigma;
  for (const s of activities) {
    s.z_score = sigma ? (s.avgWait - mu) / sigma : 0;
    s.severity = s.avgWait > threshold
      ? (s.z_score >= 2 ? 'high' : 'medium')
      : 'none';
  }

  const transitions = [...trans.values()].map((t) => ({
    from: t.from, to: t.to,
    minutes: mean(t.times), count: t.times.length,
  }));

  return { activities, transitions, mu, sigma, threshold };
}

// Перелік вузьких місць, упорядкований за спаданням часу очікування
function analyzeLog(logId, k = 1) {
  return computeStats(logId, k).activities
    .filter((s) => s.severity !== 'none')
    .sort((x, y) => y.avgWait - x.avgWait);
}

// Дані для побудови графа процесу
function buildGraph(logId) {
  const { activities, transitions } = computeStats(logId);
  return { nodes: activities, edges: transitions };
}

// --- розширена аналітика для дашборду ---

// послідовності подій за кейсами
function sequences(logId) {
  const rows = db.prepare(
    `SELECT case_id, activity, ts FROM events
     WHERE log_id = ? ORDER BY case_id, ts`
  ).all(logId);
  const cases = new Map();
  for (const r of rows) {
    if (!cases.has(r.case_id)) cases.set(r.case_id, []);
    cases.get(r.case_id).push(r);
  }
  return cases;
}

// ключові показники журналу
function kpis(logId) {
  const cases = sequences(logId);
  const nCases = cases.size;
  let nEvents = 0, minTs = Infinity, maxTs = -Infinity, conformant = 0;
  const cycles = [];
  for (const seq of cases.values()) {
    nEvents += seq.length;
    const t0 = new Date(seq[0].ts).getTime();
    const t1 = new Date(seq[seq.length - 1].ts).getTime();
    cycles.push((t1 - t0) / 60000);
    minTs = Math.min(minTs, t0); maxTs = Math.max(maxTs, t1);
    const acts = seq.map((e) => e.activity);
    if (new Set(acts).size === acts.length) conformant++; // без повернень
  }
  const spanWeeks = Math.max(1 / 7, (maxTs - minTs) / (7 * 24 * 3600 * 1000));
  const bnCount = analyzeLog(logId).length;
  const totalActs = db
    .prepare('SELECT COUNT(DISTINCT activity) AS n FROM events WHERE log_id = ?')
    .get(logId).n;
  return {
    nCases, nEvents,
    avgCycleMin: mean(cycles),
    throughput: nCases / spanWeeks,
    conformance: nCases ? conformant / nCases : 0,
    bottlenecks: bnCount,
    totalActivities: totalActs,
  };
}

// граф процесу з усередненою позицією вузлів і позначенням повернень
function graphEx(logId) {
  const { activities, transitions } = computeStats(logId);
  const cases = sequences(logId);
  const posSum = new Map(), posCnt = new Map();
  for (const seq of cases.values()) {
    const L = seq.length;
    seq.forEach((e, i) => {
      const p = L > 1 ? i / (L - 1) : 0;
      posSum.set(e.activity, (posSum.get(e.activity) || 0) + p);
      posCnt.set(e.activity, (posCnt.get(e.activity) || 0) + 1);
    });
  }
  const nodes = activities.map((a) => ({
    ...a, pos: (posSum.get(a.activity) || 0) / (posCnt.get(a.activity) || 1),
  }));
  const posBy = new Map(nodes.map((n) => [n.activity, n.pos]));
  const edges = transitions.map((t) => ({
    ...t,
    rework: (posBy.get(t.to) ?? 1) < (posBy.get(t.from) ?? 0) - 0.02,
  }));
  return { nodes, edges };
}

// гістограма розподілу часу очікування
function waitHistogram(logId, bins = 12) {
  const cases = sequences(logId);
  const waits = [];
  for (const seq of cases.values())
    for (let i = 1; i < seq.length; i++)
      waits.push(diffMin(seq[i - 1].ts, seq[i].ts));
  if (!waits.length) return { counts: [], binWidth: 0, threshold: 0 };
  const mu = mean(waits), sigma = std(waits, mu), threshold = mu + sigma;
  const hi = Math.max(...waits, 1);
  const upper = Math.max(Math.min(hi, mu + 3 * sigma), threshold * 1.2) || hi;
  const width = upper / bins;
  const counts = new Array(bins).fill(0);
  for (const w of waits) counts[Math.min(bins - 1, Math.floor(w / width))]++;
  return {
    counts, binWidth: width, threshold,
    thresholdBin: threshold / width, mu, sigma,
  };
}

// накопичувальна кількість оброблених подій у часі
function cumulative(logId, points = 12) {
  const rows = db.prepare('SELECT ts FROM events WHERE log_id = ? ORDER BY ts')
    .all(logId);
  if (!rows.length) return { series: [0], start: null, end: null, total: 0 };
  const t0 = new Date(rows[0].ts).getTime();
  const t1 = new Date(rows[rows.length - 1].ts).getTime();
  const span = Math.max(1, t1 - t0);
  const buckets = new Array(points).fill(0);
  for (const r of rows) {
    const f = (new Date(r.ts).getTime() - t0) / span;
    buckets[Math.min(points - 1, Math.floor(f * points))]++;
  }
  const series = [0]; let acc = 0;
  for (const b of buckets) { acc += b; series.push(acc); }
  return { series, start: rows[0].ts, end: rows[rows.length - 1].ts, total: acc };
}

// зведення повернень (rework)
function reworkSummary(logId) {
  const cases = sequences(logId);
  let total = 0; const perAct = new Map();
  for (const seq of cases.values()) {
    const seen = new Set();
    for (const e of seq) {
      if (seen.has(e.activity)) {
        total++; perAct.set(e.activity, (perAct.get(e.activity) || 0) + 1);
      }
      seen.add(e.activity);
    }
  }
  return {
    total,
    perActivity: [...perAct]
      .map(([activity, count]) => ({ activity, count }))
      .sort((a, b) => b.count - a.count),
  };
}

// повний набір даних для дашборду
function dashboard(logId) {
  return {
    kpis: kpis(logId),
    graph: graphEx(logId),
    bottlenecks: analyzeLog(logId),
    histogram: waitHistogram(logId),
    cumulative: cumulative(logId),
    rework: reworkSummary(logId),
    threshold: computeStats(logId).threshold,
  };
}

module.exports = {
  analyzeLog, buildGraph, computeStats, diffMin, mean, std,
  kpis, graphEx, waitHistogram, cumulative, reworkSummary, dashboard,
};
