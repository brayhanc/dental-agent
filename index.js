require('dotenv').config();
const express = require('express');
const { runAgent } = require('./src/agent');
const { enviarMensaje } = require('./src/tools/whatsapp');
const config = require('./src/config');

const app = express();
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'dental-agent', timestamp: new Date().toISOString() });
});

// Endpoint principal — llamado desde n8n WF1
app.post('/message', async (req, res) => {
  const { phone, message, push_name, user_id, instance, client_id } = req.body;

  if (!phone || !message) {
    return res.status(400).json({ error: 'phone y message son requeridos' });
  }

  // Responder a n8n inmediatamente (no bloquear)
  res.json({ status: 'processing', phone });

  try {
    const staffPhone = config.clinic.staffPhone;
    const isDentist = staffPhone && phone === staffPhone;

    console.log(`[${new Date().toISOString()}] Mensaje de ${push_name || phone} (${isDentist ? 'odontólogo' : 'paciente'}): ${message.substring(0, 50)}...`);

    const { response } = await runAgent({
      phone,
      message,
      pushName: push_name,
      isDentist,
    });

    // Si el odontólogo cancela citas, notificar pacientes automáticamente
    if (isDentist && response.includes('pacientes_a_notificar')) {
      // El agente maneja esto internamente
    }

    await enviarMensaje(phone, response);
    console.log(`[${new Date().toISOString()}] Respuesta enviada a ${phone}`);

  } catch (error) {
    console.error('Error procesando mensaje:', error);
    await enviarMensaje(phone, 'Disculpa, tuve un problema técnico. Por favor intenta de nuevo en un momento. 🙏');
  }
});

// Endpoint para que el odontólogo notifique pacientes tras cancelar citas
app.post('/notify-patients', async (req, res) => {
  const { pacientes, motivo, fecha } = req.body;

  if (!pacientes || !Array.isArray(pacientes)) {
    return res.status(400).json({ error: 'pacientes array requerido' });
  }

  res.json({ status: 'notifying', count: pacientes.length });

  for (const paciente of pacientes) {
    try {
      const mensaje = `Hola! Te informamos que tu cita del ${fecha} a las ${paciente.hora} ha sido cancelada por ${motivo}. Por favor contáctanos para reagendarla. Disculpa los inconvenientes 🙏`;
      await enviarMensaje(paciente.telefono, mensaje);
      // Pequeña pausa entre mensajes
      await new Promise(r => setTimeout(r, 500));
    } catch (error) {
      console.error(`Error notificando a ${paciente.telefono}:`, error.message);
    }
  }
});

const PORT = config.server.port;
app.listen(PORT, () => {
  console.log(`🦷 Dental Agent corriendo en puerto ${PORT}`);
  console.log(`📋 Clínica: ${config.clinic.name}`);
  console.log(`🤖 Modelo: ${config.anthropic.model}`);
});
