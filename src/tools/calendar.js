const { google } = require('googleapis');
const config = require('../config');

function getCalendarClient() {
  const auth = new google.auth.JWT({
    email: config.google.credentials.client_email,
    key: config.google.credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });
  return google.calendar({ version: 'v3', auth });
}

async function verificarDisponibilidad({ fecha, duracion_minutos = 60 }, calendarId) {
  calendarId = calendarId || config.google.calendarId;
  try {
    const calendar = getCalendarClient();
    const start = fecha ? new Date(fecha) : new Date();
    start.setHours(8, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    end.setHours(18, 0, 0, 0);

    const response = await calendar.events.list({
      calendarId,
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = response.data.items || [];
    const busySlots = events.map(e => ({
      start: new Date(e.start.dateTime || e.start.date),
      end: new Date(e.end.dateTime || e.end.date),
    }));

    const slots = [];
    const checkDate = new Date(start);

    while (checkDate < end && slots.length < 10) {
      const dayOfWeek = checkDate.getDay();
      if (dayOfWeek !== 0) {
        const maxHour = dayOfWeek === 6 ? 14 : 18;
        for (let hour = 8; hour < maxHour; hour++) {
          const slotStart = new Date(checkDate);
          slotStart.setHours(hour, 0, 0, 0);
          const slotEnd = new Date(slotStart);
          slotEnd.setMinutes(slotEnd.getMinutes() + duracion_minutos);

          const isBusy = busySlots.some(b => slotStart < b.end && slotEnd > b.start);

          if (!isBusy && slotStart > new Date()) {
            slots.push({
              fecha: slotStart.toLocaleDateString('es-CO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
              hora: slotStart.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }),
              datetime: slotStart.toISOString(),
            });
            if (slots.length >= 5) break;
          }
        }
      }
      checkDate.setDate(checkDate.getDate() + 1);
      checkDate.setHours(8, 0, 0, 0);
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
    const calendar = getCalendarClient();
    const start = new Date(datetime);
    const end = new Date(start);
    end.setHours(end.getHours() + 1);

    const event = await calendar.events.insert({
      calendarId,
      resource: {
        summary: `${tratamiento} - ${nombre_paciente}`,
        description: `Paciente: ${nombre_paciente}\ntel:${telefono_paciente}\n${notas}`,
        start: { dateTime: start.toISOString(), timeZone: 'America/Bogota' },
        end: { dateTime: end.toISOString(), timeZone: 'America/Bogota' },
      },
    });

    return {
      success: true,
      eventId: event.data.id,
      fecha: start.toLocaleDateString('es-CO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
      hora: start.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }),
      confirmacion: `Cita #${event.data.id.slice(-6).toUpperCase()}`,
    };
  } catch (error) {
    console.error('Error crearCita:', error.message);
    return { success: false, error: error.message };
  }
}

async function cancelarCita({ telefono_paciente, fecha = null }, calendarId) {
  calendarId = calendarId || config.google.calendarId;
  try {
    const calendar = getCalendarClient();
    const now = new Date();
    const timeMax = new Date();
    timeMax.setDate(timeMax.getDate() + 60);

    const response = await calendar.events.list({
      calendarId,
      timeMin: now.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      q: telefono_paciente,
    });

    const events = response.data.items || [];
    const cita = fecha ? events.find(e => e.start.dateTime?.includes(fecha)) : events[0];

    if (!cita) return { success: false, message: 'No encontré citas próximas para ese número.' };

    await calendar.events.delete({ calendarId, eventId: cita.id });

    return {
      success: true,
      message: `Cita cancelada: ${cita.summary} del ${new Date(cita.start.dateTime).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })}`,
    };
  } catch (error) {
    console.error('Error cancelarCita:', error.message);
    return { success: false, error: error.message };
  }
}

async function reagendarCita({ telefono_paciente, nuevo_datetime }, calendarId) {
  calendarId = calendarId || config.google.calendarId;
  try {
    const calendar = getCalendarClient();
    const now = new Date();
    const timeMax = new Date();
    timeMax.setDate(timeMax.getDate() + 60);

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

    if (!cita) return { success: false, message: 'No encontré citas próximas para reagendar.' };

    const newStart = new Date(nuevo_datetime);
    const newEnd = new Date(newStart);
    newEnd.setHours(newEnd.getHours() + 1);

    await calendar.events.update({
      calendarId,
      eventId: cita.id,
      resource: {
        ...cita,
        start: { dateTime: newStart.toISOString(), timeZone: 'America/Bogota' },
        end: { dateTime: newEnd.toISOString(), timeZone: 'America/Bogota' },
      },
    });

    return {
      success: true,
      message: `Cita reagendada para el ${newStart.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })} a las ${newStart.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}`,
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
    const timeMax = new Date();
    timeMax.setDate(timeMax.getDate() + 60);

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
      fecha: new Date(e.start.dateTime).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }),
      hora: new Date(e.start.dateTime).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }),
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
    const day = fecha ? new Date(fecha) : new Date();
    day.setHours(0, 0, 0, 0);
    const dayEnd = new Date(day);
    dayEnd.setHours(23, 59, 59, 0);

    const response = await calendar.events.list({
      calendarId,
      timeMin: day.toISOString(),
      timeMax: dayEnd.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = response.data.items || [];
    const citas = events.map(e => ({
      hora: new Date(e.start.dateTime).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }),
      paciente: e.summary,
      descripcion: e.description || '',
    }));

    return {
      fecha: day.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }),
      total: citas.length,
      citas,
    };
  } catch (error) {
    console.error('Error agendaDelDia:', error.message);
    return { total: 0, citas: [], error: error.message };
  }
}

async function cancelarCitasDelDia({ fecha, motivo = 'inconveniente en la agenda' }, calendarId) {
  calendarId = calendarId || config.google.calendarId;
  try {
    const calendar = getCalendarClient();
    const day = new Date(fecha);
    day.setHours(0, 0, 0, 0);
    const dayEnd = new Date(day);
    dayEnd.setHours(23, 59, 59, 0);

    const response = await calendar.events.list({
      calendarId,
      timeMin: day.toISOString(),
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
          hora: new Date(event.start.dateTime).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }),
        });
      }
      await calendar.events.delete({ calendarId, eventId: event.id });
    }

    return {
      success: true,
      canceladas: events.length,
      pacientes_a_notificar: pacientes,
      fecha: day.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }),
      motivo,
    };
  } catch (error) {
    console.error('Error cancelarCitasDelDia:', error.message);
    return { success: false, error: error.message };
  }
}

module.exports = { verificarDisponibilidad, crearCita, cancelarCita, reagendarCita, misCitas, agendaDelDia, cancelarCitasDelDia };
