const axios = require('axios');
const config = require('../config');

async function enviarMensaje(telefono, mensaje) {
  try {
    const url = `${config.evolution.apiUrl}/message/sendText/${config.evolution.instance}`;
    await axios.post(url, {
      number: telefono,
      text: mensaje,
    }, {
      headers: {
        'apikey': config.evolution.apiKey,
        'Content-Type': 'application/json',
      },
    });
    return { success: true };
  } catch (error) {
    console.error('Error enviarMensaje:', error.message);
    return { success: false, error: error.message };
  }
}

module.exports = { enviarMensaje };
