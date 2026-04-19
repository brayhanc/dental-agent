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

async function savePendingAction(clientId, phone, action) {
  const redis = await getClient();
  const key = `pending_action:${clientId}:${phone}`;
  const data = { ...action, proposed_at: Date.now(), expires_at: Date.now() + 5 * 60 * 1000 };
  await redis.set(key, JSON.stringify(data), { EX: 300 });
  return data;
}

async function getPendingAction(clientId, phone) {
  const redis = await getClient();
  const key = `pending_action:${clientId}:${phone}`;
  const raw = await redis.get(key);
  if (!raw) return null;
  const action = JSON.parse(raw);
  if (Date.now() > action.expires_at) { await redis.del(key); return null; }
  return action;
}

async function clearPendingAction(clientId, phone) {
  const redis = await getClient();
  await redis.del(`pending_action:${clientId}:${phone}`);
}

async function addCancelledPatient(clientId, patientInfo) {
  const redis = await getClient();
  const key = `cancelled_patients:${clientId}`;
  await redis.lPush(key, JSON.stringify({ ...patientInfo, cancelledAt: Date.now() }));
  await redis.lTrim(key, 0, 49);
  await redis.expire(key, 60 * 60 * 24 * 30);
}

async function getCancelledPatients(clientId, limit = 5) {
  const redis = await getClient();
  const key = `cancelled_patients:${clientId}`;
  const items = await redis.lRange(key, 0, limit - 1);
  return items.map(i => JSON.parse(i));
}

module.exports = { saveMessage, getHistory, clearHistory, isHumanActive, getClinicConfig, setClinicConfig, addCancelledPatient, getCancelledPatients, savePendingAction, getPendingAction, clearPendingAction };
