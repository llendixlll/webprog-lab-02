const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { PORT } = require('./config');
require('./db');

const app = express();
app.use(cors());
app.use(express.json());

// обмеження кількості запитів на автентифікацію
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Забагато запитів, спробуйте пізніше' },
});

app.use('/api/auth', authLimiter, require('./routes/auth'));
app.use('/api/logs', require('./routes/logs'));
app.use('/api/admin', require('./routes/admin'));
app.get('/api/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () =>
  console.log(`ProcessLens API на http://localhost:${PORT}`)
);
