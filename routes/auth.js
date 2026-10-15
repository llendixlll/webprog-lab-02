const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { JWT_SECRET } = require('../config');

const router = express.Router();

function sign(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

router.post(
  '/register',
  body('email').isEmail(),
  body('password').isLength({ min: 6 }),
  (req, res) => {
    if (!validationResult(req).isEmpty())
      return res.status(422).json({
        error: 'Некоректний email або пароль (мінімум 6 символів)',
      });
    const { email, password } = req.body;
    const exists = db
      .prepare('SELECT id FROM users WHERE email = ?')
      .get(email);
    if (exists)
      return res.status(409).json({ error: 'Такий email вже зареєстровано' });
    const hash = bcrypt.hashSync(password, 10);
    const info = db
      .prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)')
      .run(email, hash);
    const user = { id: info.lastInsertRowid, email, role: 'user' };
    res.status(201).json({ token: sign(user), user });
  }
);

router.post(
  '/login',
  body('email').isEmail(),
  body('password').notEmpty(),
  (req, res) => {
    const { email, password } = req.body;
    const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!row || !bcrypt.compareSync(password, row.password_hash))
      return res.status(401).json({ error: 'Невірний email або пароль' });
    const user = { id: row.id, email: row.email, role: row.role };
    res.json({ token: sign(user), user });
  }
);

module.exports = router;
