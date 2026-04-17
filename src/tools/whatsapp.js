const axios = require('axios');
const config = require('../config');

async function enviarMensaje(telefono, mensaje) {
  try {
    const instance = config.evolution.instance;
    const baseUrl = config.evolution.apiUrl?.replace(/\/$/, '');
    const url = `${baseUrl}/message/sendText/${instance}`;
    console.log(`[whatsapp] POST ${url} → number: ${telefono}`);
    const response = await axios.post(url, {
      number: telefono,
      text: mensaje,
    }, {
      headers: {
        'apikey': config.evolution.apiKey,
        'Content-Type': 'application/json',
      },
    });
    console.log(`[whatsapp] Respuesta Evolution:`, response.status, JSON.stringify(response.data).substring(0, 100));
    return { success: true };
  } catch (error) {
    console.error(`[whatsapp] Error enviarMensaje (${error.response?.status}):`, error.message);
    if (error.response?.data) console.error('[whatsapp] Body:', JSON.stringify(error.response.data));
    return { success: false, error: error.message };
  }
}

module.exports = { enviarMensaje };
