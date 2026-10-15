// Генерує демонстраційний журнал операцій із вираженим вузьким місцем
// на етапі «Очікування підпису», паралельною гілкою узгодження
// та циклом повернення (rework).
const fs = require('fs');
const path = require('path');

const pool = {
  Оператор: ['Оператор А', 'Оператор Б'],
  Менеджер: ['Менеджер Б', 'Менеджер В', 'Менеджер Г'],
  Юрист: ['Юрист А', 'Юрист Б'],
  Клієнт: ['—'],
  Склад: ['Склад'],
  "Кур'єр": ["Кур'єр А", "Кур'єр Б"],
};

const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
  `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const jitter = (base) => Math.max(1, Math.round(base * (0.6 + Math.random() * 0.9)));

// формує послідовність етапів для одного кейсу: [активність, очікування(хв), роль]
function buildCase() {
  const seq = [];
  seq.push(['Реєстрація заявки', 3, 'Оператор']);
  seq.push(['Перевірка документів', 35, 'Менеджер']);
  // паралельна гілка узгодження
  if (Math.random() < 0.65) seq.push(['Узгодження умов', 45, 'Менеджер']);
  else seq.push(['Узгодження з юридичним', 70, 'Юрист']);
  seq.push(['Очікування підпису', 520, 'Клієнт']); // вузьке місце
  // цикл повернення: частина кейсів повертається на узгодження
  if (Math.random() < 0.18) {
    seq.push(['Узгодження умов', 60, 'Менеджер']);
    seq.push(['Очікування підпису', 300, 'Клієнт']);
  }
  seq.push(['Виконання замовлення', 90, 'Склад']);
  seq.push(['Доставка', 40, "Кур'єр"]);
  seq.push(['Закриття заявки', 8, 'Оператор']);
  return seq;
}

const N = 120;
const lines = ['case_id,activity,ts,resource'];
const start = new Date('2026-03-02T09:00:00');
for (let c = 1; c <= N; c++) {
  let t = new Date(start.getTime() + c * 37 * 60000 + Math.random() * 3600000);
  for (const [act, base, role] of buildCase()) {
    // час очікування приписується активності, ПЕРЕД якою він стався,
    // тому зсуваємо мітку до запису події
    t = new Date(t.getTime() + jitter(base) * 60000);
    const names = pool[role];
    const res = names[Math.floor(Math.random() * names.length)];
    lines.push(`${1000 + c},${act},${fmt(t)},${res}`);
  }
}

const out = path.join(__dirname, 'sample', 'order_process.csv');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, lines.join('\n') + '\n');
console.log(`Створено ${out} — ${lines.length - 1} подій, ${N} кейсів`);
