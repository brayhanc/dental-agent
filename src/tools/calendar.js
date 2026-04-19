const { google } = require('googleapis');
const config = require('../config');
const { enviarMensaje } = require('./whatsapp');
const memory = require('../memory');

const TZ = 'America/Bogota';
const CO_OFFSET_MS = -5 * 60 * 60 * 1000;

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function getCalendarClient() {
  const auth = new google.auth.JWT({
    email: config.google.credentials.client_email,
    key: config.google.credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });
  return google.calendar({ version: 'v3', auth });
}

// Obtiene componentes de fecha en hora colombiana (UTC-5, sin DST, sin ICU)
function coTime(date = new Date()) {
  const co = new Date(date.getTime() + CO_OFFSET_MS);
  return {
    year: co.getUTCFullYear(),
    month: co.getUTCMonth() + 1,
    day: co.getUTCDate(),
    hour: co.getUTCHours(),
    minute: co.getUTCMinutes(),
    dayOfWeek: co.getUTCDay(),
  };
}

// Crea un Date a partir de componentes en hora colombiana
function coDate(year, month, day, hour = 0, minute = 0) {
  return new Date(`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}T${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}:00-05:00`);
}

// Avanza al día siguiente en hora colombiana
function nextDay(date) {
  const { year, month, day } = coTime(date);
  return coDate(year, month, day + 1, 0, 0);
}

// Parsea datetime — si no trae zona horaria, asume Colombia (UTC-5)
function parseDatetime(datetime) {
  if (datetime.endsWith('Z') || datetime.includes('+') || /T.*-\d{2}:\d{2}$/.test(datetime)) {
    return new Date(datetime);
  }
  return new Date(datetime + '-05:00');
}

function formatFecha(date) {
  const { year, month, day, dayOfWeek } = coTime(date);
  return `${DIAS[dayOfWeek]}, ${day} de ${MESES[month - 1]} de ${year}`;
}

function formatHora(date) {
  const { hour, minute } = coTime(date);
  const h = hour % 12 || 12;
  const ampm = hour < 12 ? 'a.m.' : 'p.m.';
  return `${String(h).padStart(2, '0')}:${String(minute).padStart(2, '0')} ${ampm}`;
}

// Valida que un datetime esté dentro del horario laboral (Colombia)
function validarHorarioLaboral(date) {
  const { hour, dayOfWeek } = coTime(date);
  if (dayOfWeek === 0) return { valido: false, motivo: 'Los domingos no hay atención.' };
  const maxHour = dayOfWeek === 6 ? 14 : 18;
  if (hour < 8 || hour >= maxHour) {
    const horario = dayOfWeek === 6 ? '8am a 2pm' : '8am a 6pm';
    return { valido: false, motivo: `El horario de atención es de ${horario}.` };
  }
  return { valido: true };
}

async function verificarDisponibilidad({ fecha, duracion_minutos = 60 }, calendarId) {
  calendarId = calendarId || config.google.calendarId;
  try {
    const calendar = getCalendarClient();
    const now = new Date();

    // Punto de inicio: hoy o la fecha solicitada, desde medianoche Colombia
    let startBase;
    if (fecha) {
      const [y, m, d] = fecha.split('-').map(Number);
      startBase = coDate(y, m, d, 0, 0);
    } else {
      const co = coTime(now);
      startBase = coDate(co.year, co.month, co.day, 0, 0);
    }

    const timeMax = new Date(startBase.getTime() + 8 * 24 * 60 * 60 * 1000);

    const response = await calendar.events.list({
      calendarId,
      timeMin: startBase.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    const busySlots = (response.data.items || []).map(e => ({
      start: new Date(e.start.dateTime || e.start.date),
      end: new Date(e.end.dateTime || e.end.date),
    }));

    const slots = [];
    let checkDate = startBase;

    while (checkDate < timeMax && slots.length < 10) {
      const co = coTime(checkDate);
      const { dayOfWeek } = co;

      if (dayOfWeek !== 0) {
        const maxHour = dayOfWeek === 6 ? 14 : 18;
        for (let hour = 8; hour < maxHour; hour++) {
          const slotStart = coDate(co.year, co.month, co.day, hour, 0);
          const slotEnd = new Date(slotStart.getTime() + duracion_minutos * 60000);

          if (slotStart <= now) continue;

          const isBusy = busySlots.some(b => slotStart < b.end && slotEnd > b.start);
          if (!isBusy) {
            slots.push({
              fecha: formatFecha(slotStart),
              hora: formatHora(slotStart),
              datetime: slotStart.toISOString(),
            });
            if (slots.length >= 5) break;
          }
        }
      }

      checkDate = nextDay(checkDate);
    }

    return { disponible: slots.length > 0, slots };
  } catch (error) {
    console.error('Error verificarDisponibilidad:', error.message);
    return { disponible: false, slots: [], error: error.message };
  }
}

async function crearCita({ datetime, tratamiento, nombre_paciente, telefono_paciente, notas = '' }, calendarId) {
  calendarId = calendarId || config.google.calendarId;
  try {
    const start = parseDatetime(datetime);

    const validacion = validarHorarioLaboral(start);
    if (!validacion.valido) {
      return { success: false, error: `Horario no válido: ${validacion.motivo}` };
    }

    if (start <= new Date()) {
      return { success: false, error: 'No se pueden crear citas en el pasado.' };
    }

    const calendar = getCalendarClient();
    const end = new Date(start.getTime() + 60 * 60 * 1000);

    const event = await calendar.events.insert({
      calendarId,
      resource: {
        summary: `${tratamiento} - ${nombre_paciente}`,
        description: `Paciente: ${nombre_paciente}\ntel:${telefono_paciente}\n${notas}`,
        start: { dateTime: start.toISOString(), timeZone: TZ },
        end: { dateTime: end.toISOString(), timeZone: TZ },
      },
    });

    return {
      success: true,
      eventId: event.data.id,
      fecha: formatFecha(start),
      hora: formatHora(start),
      confirmacion: `Cita #${event.data.id.slice(-6).toUpperCase()}`,
    };
  } catch (error) {
    console.error('Error crearCita:', error.message);
    return { success: false, error: error.message };
  }
}

async function cancelarCita({ telefono_paciente, fecha = null, clientId = 'default', phone = null, confirmed = false }, calendarId) {
  calendarId = calendarId || config.google.calendarId;
  try {
    const cal = getCalendarClient();
    const now = new Date();
    const timeMax = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);

    const response = await cal.events.list({
      calendarId,
      timeMin: now.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      q: telefono_paciente,
    });

    const events = response.data.items || [];

    // Guardrail: existencia
    if (events.length === 0) return { success: false, error: 'No encontré citas próximas para ese número.' };

    // Guardrail: unicidad — si hay varias citas y no especificó fecha
    const candidatas = fecha ? events.filter(e => e.start.dateTime?.includes(fecha)) : events;
    if (!fecha && events.length > 1) {
      const lista = events.slice(0, 3).map(e =>
        `- ${e.summary}: ${formatFecha(new Date(e.start.dateTime))} a las ${formatHora(new Date(e.start.dateTime))}`
      ).join('\n');
      return { success: false, error: `Tienes ${events.length} citas próximas. ¿Cuál quieres cancelar?\n${lista}` };
    }

    const cita = candidatas[0] || events[0];
    if (!cita) return { success: false, error: 'No encontré la cita con esa fecha.' };

    const citaDesc = `${cita.summary} — ${formatFecha(new Date(cita.start.dateTime))} a las ${formatHora(new Date(cita.start.dateTime))}`;

    // Si no está confirmado: guardar propuesta y pedir confirmación
    if (!confirmed && phone) {
      await memory.savePendingAction(clientId, phone, {
        tool: 'cancelar_cita',
        params: { telefono_paciente, fecha: cita.start.dateTime, clientId, phone, confirmed: true },
        descripcion: citaDesc,
      });
      return {
        requires_confirmation: true,
        propuesta: citaDesc,
        instruccion: `Pregunta al paciente: "¿Confirmas cancelar: ${citaDesc}?"`,
      };
    }

    // Ejecutar cancelación
    await cal.events.delete({ calendarId, eventId: cita.id });

    await memory.addCancelledPatient(clientId, {
      telefono: telefono_paciente,
      nombre: cita.summary,
      fechaAnterior: formatFecha(new Date(cita.start.dateTime)),
    });

    return { success: true, message: `Cita cancelada: ${citaDesc}` };
  } catch (error) {
    console.error('Error cancelarCita:', error.message);
    return { success: false, error: error.message };
  }
}

async function reprogramarCitaPaciente({ telefono_paciente, motivo = 'un ajuste en la agenda', clientId = 'default' }, calendarId) {
  calendarId = calendarId || config.google.calendarId;
  try {
    const calendar = getCalendarClient();
    const now = new Date();
    const timeMax = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);

    const response = await calendar.events.list({
      calendarId,
      timeMin: now.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      q: telefono_paciente,
    });

    const events = response.data.items || [];
    const cita = events[0];
    if (!cita) return { success: false, message: 'No encontré cita para ese paciente.' };

    const citaInfo = {
      summary: cita.summary,
      fecha: formatFecha(new Date(cita.start.dateTime)),
      hora: formatHora(new Date(cita.start.dateTime)),
    };

    // Obtener horarios disponibles para ofrecer al paciente
    const slotsResult = await verificarDisponibilidad({ duracion_minutos: 60 }, calendarId);
    const opciones = slotsResult.slots.slice(0, 3);

    // Cancelar la cita actual
    await calendar.events.delete({ calendarId, eventId: cita.id });

    // Guardar en lista de cancelados
    await memory.addCancelledPatient(clientId, {
      telefono: telefono_paciente,
      nombre: cita.summary,
      fechaAnterior: citaInfo.fecha,
    });

    // Notificar al paciente por WhatsApp
    const opcionesTexto = opciones.map((s, i) => `${i + 1}. ${s.fecha} a las ${s.hora}`).join('\n');
    const mensaje = opciones.length > 0
      ? `Hola! Tu cita de *${cita.summary}* del ${citaInfo.fecha} a las ${citaInfo.hora} debe reprogramarse por ${motivo}.\n\nTe ofrecemos estos horarios:\n${opcionesTexto}\n\n¿Cuál te queda bien? 🙏`
      : `Hola! Tu cita de *${cita.summary}* del ${citaInfo.fecha} a las ${citaInfo.hora} debe reprogramarse por ${motivo}. Por favor escríbenos para coordinar un nuevo horario 🙏`;

    await enviarMensaje(telefono_paciente, mensaje);

    return {
      success: true,
      cita_cancelada: citaInfo,
      horarios_ofrecidos: opciones,
      mensaje_enviado: true,
      nota: 'El paciente fue notificado. Cuando responda, María gestionará la nueva cita.',
    };
  } catch (error) {
    console.error('Error reprogramarCitaPaciente:', error.message);
    return { success: false, error: error.message };
  }
}

async function optimizarSlotLibre({ fecha, hora, clientId = 'default' }, calendarId) {
  calendarId = calendarId || config.google.calendarId;
  try {
    const candidatos = await memory.getCancelledPatients(clientId, 3);
    if (candidatos.length === 0) {
      return { success: true, resultado: 'sin_candidatos', mensaje: 'No hay pacientes en lista para contactar.' };
    }

    const resultados = [];
    for (const paciente of candidatos) {
      const mensaje = `Hola${paciente.nombre ? ` ${paciente.nombre.split(' ')[0]}` : ''}! Se liberó un espacio el ${fecha} a las ${hora}. ¿Te gustaría tomarlo? 😊`;
      await enviarMensaje(paciente.telefono, mensaje);
      resultados.push({ telefono: paciente.telefono, nombre: paciente.nombre, mensaje_enviado: true });
    }

    return {
      success: true,
      resultado: 'candidatos_contactados',
      contactados: resultados,
      nota: 'Los pacientes fueron notificados. Sus respuestas llegarán por WhatsApp.',
    };
  } catch (error) {
    console.error('Error optimizarSlotLibre:', error.message);
    return { success: false, error: error.message };
  }
}

async function reagendarCita({ telefono_paciente, nuevo_datetime }, calendarId) {
  calendarId = calendarId || config.google.calendarId;
  try {
    const newStart = parseDatetime(nuevo_datetime);

    const validacion = validarHorarioLaboral(newStart);
    if (!validacion.valido) {
      return { success: false, error: `Horario no válido: ${validacion.motivo}` };
    }

    const calendar = getCalendarClient();
    const now = new Date();
    const timeMax = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);

    const response = await calendar.events.list({
      calendarId,
      timeMin: now.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      q: telefono_paciente,
    });

    const cita = (response.data.items || [])[0];
    if (!cita) return { success: false, message: 'No encontré citas próximas para reagendar.' };

    const newEnd = new Date(newStart.getTime() + 60 * 60 * 1000);

    await calendar.events.update({
      calendarId,
      eventId: cita.id,
      resource: {
        ...cita,
        start: { dateTime: newStart.toISOString(), timeZone: TZ },
        end: { dateTime: newEnd.toISOString(), timeZone: TZ },
      },
    });

    return {
      success: true,
      message: `Cita reagendada para el ${formatFecha(newStart)} a las ${formatHora(newStart)}`,
    };
  } catch (error) {
    console.error('Error reagendarCita:', error.message);
    return { success: false, error: error.message };
  }
}

async function misCitas({ telefono_paciente }, calendarId) {
  calendarId = calendarId || config.google.calendarId;
  try {
    const calendar = getCalendarClient();
    const now = new Date();
    const timeMax = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);

    const response = await calendar.events.list({
      calendarId,
      timeMin: now.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      q: telefono_paciente,
    });

    const events = response.data.items || [];
    if (events.length === 0) return { citas: [], message: 'No tienes citas programadas.' };

    const citas = events.map(e => ({
      tratamiento: e.summary,
      fecha: formatFecha(new Date(e.start.dateTime)),
      hora: formatHora(new Date(e.start.dateTime)),
    }));

    return { citas };
  } catch (error) {
    console.error('Error misCitas:', error.message);
    return { citas: [], error: error.message };
  }
}

async function agendaDelDia({ fecha = null }, calendarId) {
  calendarId = calendarId || config.google.calendarId;
  try {
    const calendar = getCalendarClient();
    let dayStart, dayEnd;

    if (fecha) {
      const [y, m, d] = fecha.split('-').map(Number);
      dayStart = coDate(y, m, d, 0, 0);
    } else {
      const co = coTime();
      dayStart = coDate(co.year, co.month, co.day, 0, 0);
    }
    dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000 - 1000);

    const response = await calendar.events.list({
      calendarId,
      timeMin: dayStart.toISOString(),
      timeMax: dayEnd.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = response.data.items || [];
    const citas = events.map(e => ({
      hora: formatHora(new Date(e.start.dateTime)),
      paciente: e.summary,
      descripcion: e.description || '',
    }));

    return { fecha: formatFecha(dayStart), total: citas.length, citas };
  } catch (error) {
    console.error('Error agendaDelDia:', error.message);
    return { total: 0, citas: [], error: error.message };
  }
}

async function cancelarCitasDelDia({ fecha, motivo = 'inconveniente en la agenda' }, calendarId) {
  calendarId = calendarId || config.google.calendarId;
  try {
    const calendar = getCalendarClient();
    const [y, m, d] = fecha.split('-').map(Number);
    const dayStart = coDate(y, m, d, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000 - 1000);

    const response = await calendar.events.list({
      calendarId,
      timeMin: dayStart.toISOString(),
      timeMax: dayEnd.toISOString(),
      singleEvents: true,
    });

    const events = response.data.items || [];
    const pacientes = [];

    for (const event of events) {
      const telMatch = event.description?.match(/tel:(\d+)/);
      if (telMatch) {
        pacientes.push({
          telefono: telMatch[1],
          nombre: event.summary,
          hora: formatHora(new Date(event.start.dateTime)),
        });
      }
      await calendar.events.delete({ calendarId, eventId: event.id });
    }

    return {
      success: true,
      canceladas: events.length,
      pacientes_a_notificar: pacientes,
      fecha: formatFecha(dayStart),
      motivo,
    };
  } catch (error) {
    console.error('Error cancelarCitasDelDia:', error.message);
    return { success: false, error: error.message };
  }
}

module.exports = { verificarDisponibilidad, crearCita, cancelarCita, reagendarCita, misCitas, agendaDelDia, cancelarCitasDelDia, reprogramarCitaPaciente, optimizarSlotLibre };
