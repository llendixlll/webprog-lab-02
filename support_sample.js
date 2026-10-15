// Демо-журнал: обробка звернень у службу підтримки.
// Вузьке місце — «Очікування відповіді клієнта», є гілка ескалації та повернення.
const fs = require('fs');
const path = require('path');

const pool = {
  Бот: ['Автобот'],
  'Агент L1': ['Агент L1-А', 'Агент L1-Б', 'Агент L1-В'],
  'Агент L2': ['Агент L2-А', 'Агент L2-Б'],
  Супервізор: ['Супервізор'],
  Інженер: ['Інженер А', 'Інженер Б'],
  Клієнт: ['—'],
};

const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
  `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const jitter = (b) => Math.max(1, Math.round(b * (0.6 + Math.random() * 0.9)));

function buildCase() {
  const seq = [];
  seq.push(['Реєстрація звернення', 2, 'Бот']);
  seq.push(['Класифікація', 15, 'Агент L1']);
  seq.push(['Призначення агента', 25, 'Супервізор']);
  seq.push(['Очікування відповіді клієнта', 600, 'Клієнт']); // вузьке місце
  seq.push(['Діагностика', 40, 'Агент L2']);
  if (Math.random() < 0.3) {
    seq.push(['Ескалація в розробку', 180, 'Інженер']);
    seq.push(['Діагностика', 60, 'Агент L2']); // повернення
  }
  seq.push(['Підготовка рішення', 50, 'Агент L2']);
  seq.push(['Підтвердження клієнтом', 90, 'Клієнт']);
  seq.push(['Закриття тікета', 5, 'Бот']);
  return seq;
}

const N = 140;
const lines = ['case_id,activity,ts,resource'];
const start = new Date('2026-01-08T09:00:00');
for (let c = 1; c <= N; c++) {
  let t = new Date(start.getTime() + c * 42 * 60000 + Math.random() * 3600000);
  for (const [act, base, role] of buildCase()) {
    t = new Date(t.getTime() + jitter(base) * 60000);
    const names = pool[role];
    const res = names[Math.floor(Math.random() * names.length)];
    lines.push(`TCK-${2000 + c},${act},${fmt(t)},${res}`);
  }
}

const out = path.join(__dirname, 'sample', 'support_tickets.csv');
fs.writeFileSync(out, lines.join('\n') + '\n');
console.log(`Створено ${out} — ${lines.length - 1} подій, ${N} звернень`);
