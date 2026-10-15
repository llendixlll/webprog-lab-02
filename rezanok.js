// Живий конектор до системи обліку Rezanok (staging REST API).
// Тягне замовлення з їхніми виробничими стадіями і перетворює на журнал
// подій у форматі ProcessLens: case_id — замовлення, activity — етап,
// ts — момент входу в етап (started_at), resource — виконавець.
const { REZANOK_API } = require('./config');

// Забирає всі замовлення посторінково (API має пагінацію, max 100 на сторінку).
async function fetchOrders(apiBase = REZANOK_API) {
  const all = [];
  let page = 1;
  let totalPages = 1;
  do {
    const res = await fetch(`${apiBase}/orders?limit=100&page=${page}&sort=createdAt&order=asc`);
    if (!res.ok) throw new Error(`Rezanok API: HTTP ${res.status}`);
    const body = await res.json();
    all.push(...(body.data || []));
    totalPages = body.meta ? body.meta.totalPages : 1;
    page++;
  } while (page <= totalPages);
  return all;
}

// Ім'я відповідального менеджера замовлення (для подій приймання/відвантаження).
function managerOf(order) {
  const a = (order.assignments || []).find(
    (x) => x.role === 'manager' || x.role === 'admin'
  );
  return (a && a.employee && a.employee.fullName) || 'Менеджер';
}

// Перетворює замовлення Rezanok на масив подій журналу.
function ordersToEvents(orders) {
  const rows = [];
  for (const order of orders) {
    const caseId = `Замовлення #${order.id}`;
    const manager = managerOf(order);

    // 1) приймання замовлення
    rows.push({
      case_id: caseId,
      activity: 'Прийом замовлення',
      ts: order.createdAt,
      resource: manager,
    });

    // 2) проходження виробничих стадій (момент входу = started_at)
    let lastDone = null;
    for (const item of order.items || []) {
      for (const st of item.stages || []) {
        const entered = st.startedAt || st.doneAt;
        if (!entered) continue; // стадія ще не розпочата
        rows.push({
          case_id: caseId,
          activity: st.stage,
          ts: entered,
          resource: (st.executor && st.executor.fullName) || '—',
        });
        if (st.doneAt && (!lastDone || new Date(st.doneAt) > new Date(lastDone)))
          lastDone = st.doneAt;
      }
    }

    // 3) відвантаження (для завершених замовлень)
    if (order.status === 'done' && lastDone) {
      rows.push({
        case_id: caseId,
        activity: 'Відвантаження',
        ts: lastDone,
        resource: manager,
      });
    }
  }
  // відсікаємо події без часової мітки
  return rows.filter((r) => r.ts);
}

// Повний цикл: забрати з API і повернути готові події.
async function pullEvents(apiBase = REZANOK_API) {
  const orders = await fetchOrders(apiBase);
  return { orders, events: ordersToEvents(orders) };
}

module.exports = { fetchOrders, ordersToEvents, pullEvents };
