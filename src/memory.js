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

async function saveMessage(clientId, phone, role, content) {
  const redis = await getClient();
  const key = `chat:${clientId}:${phone}`;
  const message = JSON.stringify({ role, content, timestamp: Date.now() });
  await redis.rPush(key, message);
  await redis.lTrim(key, -20, -1);
  await redis.expire(key, 60 * 60 * 24 * 7);
}

async function getHistory(clientId, phone) {
  const redis = await getClient();
  const key = `chat:${clientId}:${phone}`;
  const messages = await redis.lRange(key, 0, -1);
  return messages.map(m => JSON.parse(m)).map(({ role, content }) => ({ role, content }));
}

async function clearHistory(clientId, phone) {
  const redis = await getClient();
  await redis.del(`chat:${clientId}:${phone}`);
}

async function isHumanActive(clientId, userId) {
  const redis = await getClient();
  const value = await redis.get(`human_active:${clientId}:${userId}`);
  return value === 'true';
}

async function getClinicConfig(clientId) {
  const redis = await getClient();
  const raw = await redis.get(`clinic_config:${clientId}`);
  return raw ? JSON.parse(raw) : null;
}

async function setClinicConfig(clientId, config) {
  const redis = await getClient();
  await redis.set(`clinic_config:${clientId}`, JSON.stringify(config));
}

module.exports = { saveMessage, getHistory, clearHistory, isHumanActive, getClinicConfig, setClinicConfig };
