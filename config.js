// Конфігурація серверної частини ProcessLens
module.exports = {
  JWT_SECRET: process.env.JWT_SECRET || 'processlens-dev-secret-change-me',
  PORT: Number(process.env.PORT) || 3001,
  // Базова адреса REST API системи обліку Rezanok (staging) для живого
  // конектора. Дані беруться звідти і перетворюються на журнал подій.
  REZANOK_API: process.env.REZANOK_API || 'http://localhost:3000/api',
};
