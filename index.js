require('dotenv').config();
const express = require('express');
const { enviarMensaje } = require('./src/tools/whatsapp');
const { setClinicConfig, getClinicConfig } = require('./src/memory');
const config = require('./src/config');

const { handleText } = require('./src/handlers/text');
const { handleAudio } = require('./src/handlers/audio');

const app = express();
app.use(express.json({ limit: '10mb' }));

const MESSAGE_HANDLERS = {
  text: handleText,
  audio: handleAudio,
};

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'dental-agent', timestamp: new Date().toISOString() });
});

// Endpoint principal — recibe payload estandarizado { type, content, phone, ... }
app.post('/message', async (req, res) => {
  const { phone, push_name, instance, client_id, type, content } = req.body;

  if (!phone || !type || !content) {
    return res.status(400).json({ success: false, error: 'phone, type y content son requeridos' });
  }

  const handler = MESSAGE_HANDLERS[type];
  if (!handler) {
    return res.status(400).json({ success: false, error: `Tipo no soportado: ${type}` });
  }

  res.json({ status: 'processing', phone, type });

  const clientId = client_id || instance || 'default';
  const isDentist = config.clinic.staffPhone && phone === config.clinic.staffPhone;

  console.log(`[${new Date().toISOString()}] [${clientId}] ${type.toUpperCase()} de ${push_name || phone}`);

  try {
    const result = await handler({ phone, content, pushName: push_name, isDentist, clientId });

    if (result.reply) {
      await enviarMensaje(phone, result.reply);
    }

    if (!result.success) {
      console.warn(`[${clientId}] Handler '${type}' success:false — ${result.error}`);
    } else {
      console.log(`[${new Date().toISOString()}] [${clientId}] Respuesta enviada (${type})`);
    }
  } catch (error) {
    console.error(`[${clientId}] Error en handler '${type}':`, error.message);
    await enviarMensaje(phone, 'Disculpa, tuve un problema técnico. Por favor intenta de nuevo. 🙏');
  }
});

// Endpoint para notificar pacientes tras cancelar citas
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
      await new Promise(r => setTimeout(r, 500));
    } catch (error) {
      console.error(`Error notificando a ${paciente.telefono}:`, error.message);
    }
  }
});

// Configurar datos de una clínica por clientId
app.post('/clinic-config', async (req, res) => {
  const { client_id, ...clinicData } = req.body;

  if (!client_id) {
    return res.status(400).json({ error: 'client_id es requerido' });
  }

  await setClinicConfig(client_id, clinicData);
  console.log(`[clinic-config] Config guardada para cliente: ${client_id}`);
  res.json({ status: 'ok', client_id });
});

// Ver configuración actual de una clínica
app.get('/clinic-config/:client_id', async (req, res) => {
  const { client_id } = req.params;
  const cfg = await getClinicConfig(client_id);
  res.json({ client_id, config: cfg || 'usando config por defecto (.env)' });
});

const PORT = config.server.port;
app.listen(PORT, () => {
  console.log(`🦷 Dental Agent corriendo en puerto ${PORT}`);
  console.log(`📋 Clínica: ${config.clinic.name}`);
  console.log(`🤖 Modelo: ${config.anthropic.model}`);
});
