const { createClient } = require('redis');
const config = require('./config');

let client = null;

async function getClient() {
  if (!client) {
    client = createClient({ url: config.redis.url });
    client.on('error', (err) => console.error('Redis error:', err));
    await client.connect();
  }
  return client;
}

// Guarda un mensaje en el historial de conversación del paciente
async function saveMessage(phone, role, content) {
  const redis = await getClient();
  const key = `chat:${phone}`;
  const message = JSON.stringify({ role, content, timestamp: Date.now() });
  await redis.rPush(key, message);
  // Mantener solo los últimos 20 mensajes (10 intercambios)
  await redis.lTrim(key, -20, -1);
  // Expira en 7 días de inactividad
  await redis.expire(key, 60 * 60 * 24 * 7);
}

// Obtiene el historial de conversación del paciente
async function getHistory(phone) {
  const redis = await getClient();
  const key = `chat:${phone}`;
  const messages = await redis.lRange(key, 0, -1);
  return messages.map(m => JSON.parse(m)).map(({ role, content }) => ({ role, content }));
}

// Limpia el historial de un paciente
async function clearHistory(phone) {
  const redis = await getClient();
  await redis.del(`chat:${phone}`);
}

// Verifica si el modo humano está activo para un usuario
async function isHumanActive(clientId, userId) {
  const redis = await getClient();
  const value = await redis.get(`human_active:${clientId}:${userId}`);
  return value === 'true';
}

module.exports = { saveMessage, getHistory, clearHistory, isHumanActive };
