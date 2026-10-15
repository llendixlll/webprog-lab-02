const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/users', requireAuth, requireAdmin, (req, res) => {
  const rows = db.prepare(
    `SELECT id, email, role, created_at,
       (SELECT COUNT(*) FROM logs WHERE logs.user_id = users.id) AS logs
     FROM users ORDER BY id`
  ).all();
  res.json(rows);
});

router.delete('/users/:id', requireAuth, requireAdmin, (req, res) => {
  if (Number(req.params.id) === req.user.id)
    return res.status(400).json({ error: 'Не можна видалити власний акаунт' });
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
