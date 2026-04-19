const cron = require('node-cron');
const { google } = require('googleapis');
const { enviarMensaje } = require('../tools/whatsapp');
const memory = require('../memory');
const config = require('../config');

const CO_OFFSET_MS = -5 * 60 * 60 * 1000;

function getCalendarClient() {
  const auth = new google.auth.JWT({
    email: config.google.credentials.client_email,
    key: config.google.credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
  });
  return google.calendar({ version: 'v3', auth });
}

function formatFechaCO(date) {
  const co = new Date(date.getTime() + CO_OFFSET_MS);
  const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  return `${dias[co.getUTCDay()]} ${co.getUTCDate()} de ${meses[co.getUTCMonth()]}`;
}

function formatHoraCO(date) {
  const co = new Date(date.getTime() + CO_OFFSET_MS);
  const h = co.getUTCHours() % 12 || 12;
  const m = String(co.getUTCMinutes()).padStart(2, '0');
  const ampm = co.getUTCHours() < 12 ? 'a.m.' : 'p.m.';
  return `${h}:${m} ${ampm}`;
}

async function yaEnviado(redis, tipo, eventId) {
  const key = `reminder:${tipo}:${eventId}`;
  return !!(await redis.get(key));
}

async function marcarEnviado(redis, tipo, eventId) {
  const key = `reminder:${tipo}:${eventId}`;
  await redis.set(key, '1', { EX: 60 * 60 * 48 }); // expira en 48h
}

async function procesarRecordatorios() {
  console.log(`[reminders] Verificando recordatorios — ${new Date().toISOString()}`);

  const calendarId = config.google.calendarId;
  if (!calendarId || calendarId === 'primary') {
    console.warn('[reminders] GOOGLE_CALENDAR_ID no configurado, saltando.');
    return;
  }

  let redis, cal;
  try {
    redis = await memory.getRedisClient();
    cal = getCalendarClient();
  } catch (err) {
    console.error('[reminders] Error conectando:', err.message);
    return;
  }

  const now = new Date();

  // Ventana de búsqueda: próximas 25 horas (cubre ambos recordatorios)
  const timeMin = now.toISOString();
  const timeMax = new Date(now.getTime() + 25 * 60 * 60 * 1000).toISOString();

  let events;
  try {
    const res = await cal.events.list({
      calendarId,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
    });
    events = res.data.items || [];
  } catch (err) {
    console.error('[reminders] Error leyendo calendario:', err.message);
    return;
  }

  for (const event of events) {
    if (!event.start?.dateTime) continue;

    const start = new Date(event.start.dateTime);
    const msHasta = start.getTime() - now.getTime();
    const hHasta = msHasta / (1000 * 60 * 60);

    // Extraer teléfono del paciente
    const telMatch = event.description?.match(/tel:(\d+)/);
    if (!telMatch) continue;
    const telefonoRaw = telMatch[1];
    const telefono = telefonoRaw.startsWith('57') ? telefonoRaw : `57${telefonoRaw}`;

    const nombre = event.summary?.split(' - ')[1] || 'paciente';
    const tratamiento = event.summary?.split(' - ')[0] || 'tu cita';
    const fechaTexto = formatFechaCO(start);
    const horaTexto = formatHoraCO(start);
    const clinica = config.clinic.name;

    // Recordatorio 24h: ventana entre 23h y 25h
    if (hHasta >= 23 && hHasta <= 25) {
      if (!(await yaEnviado(redis, '24h', event.id))) {
        const msg = `Hola ${nombre}! 👋 Te recordamos tu cita *mañana ${fechaTexto}* a las *${horaTexto}* en ${clinica} para *${tratamiento}*.\n\n¿Confirmas tu asistencia? Responde *SÍ* o *NO* 🙏`;
        await enviarMensaje(telefono, msg);
        await marcarEnviado(redis, '24h', event.id);
        console.log(`[reminders] ✅ Recordatorio 24h enviado a ${telefono} — ${event.summary}`);
      }
    }

    // Recordatorio 2h: ventana entre 1h45m y 2h15m
    if (hHasta >= 1.75 && hHasta <= 2.25) {
      if (!(await yaEnviado(redis, '2h', event.id))) {
        const msg = `Hola ${nombre}! ⏰ Tu cita en ${clinica} es *hoy a las ${horaTexto}* (en 2 horas) para *${tratamiento}*.\n\n¡Te esperamos! Si necesitas cancelar escríbenos. 🙏`;
        await enviarMensaje(telefono, msg);
        await marcarEnviado(redis, '2h', event.id);
        console.log(`[reminders] ✅ Recordatorio 2h enviado a ${telefono} — ${event.summary}`);
      }
    }
  }
}

function iniciarRecordatorios() {
  // Corre cada 30 minutos
  cron.schedule('*/30 * * * *', procesarRecordatorios);
  console.log('[reminders] Cron de recordatorios iniciado (cada 30 min)');
}

module.exports = { iniciarRecordatorios, procesarRecordatorios };
