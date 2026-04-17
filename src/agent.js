const Anthropic = require('@anthropic-ai/sdk');
const config = require('./config');
const memory = require('./memory');
const calendar = require('./tools/calendar');

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

const PATIENT_TOOLS = [
  {
    name: 'verificar_disponibilidad',
    description: 'Verifica slots disponibles en el calendario para agendar una cita. Úsala cuando el paciente quiera agendar o preguntar por disponibilidad.',
    input_schema: {
      type: 'object',
      properties: {
        fecha: { type: 'string', description: 'Fecha preferida en formato ISO (YYYY-MM-DD). Si no especifica, busca en los próximos días.' },
        duracion_minutos: { type: 'number', description: 'Duración de la cita en minutos. Default 60.' },
      },
      required: [],
    },
  },
  {
    name: 'crear_cita',
    description: 'Crea una cita en el calendario. Úsala SOLO cuando el paciente haya confirmado fecha y hora específica.',
    input_schema: {
      type: 'object',
      properties: {
        datetime: { type: 'string', description: 'Fecha y hora en formato ISO (YYYY-MM-DDTHH:MM:00)' },
        tratamiento: { type: 'string', description: 'Tipo de tratamiento (ej: Limpieza dental, Consulta, Blanqueamiento)' },
        nombre_paciente: { type: 'string', description: 'Nombre del paciente' },
        telefono_paciente: { type: 'string', description: 'Teléfono del paciente sin +' },
        notas: { type: 'string', description: 'Notas adicionales opcionales' },
      },
      required: ['datetime', 'tratamiento', 'nombre_paciente', 'telefono_paciente'],
    },
  },
  {
    name: 'cancelar_cita',
    description: 'Cancela la próxima cita del paciente.',
    input_schema: {
      type: 'object',
      properties: {
        telefono_paciente: { type: 'string', description: 'Teléfono del paciente' },
        fecha: { type: 'string', description: 'Fecha específica a cancelar (opcional)' },
      },
      required: ['telefono_paciente'],
    },
  },
  {
    name: 'reagendar_cita',
    description: 'Reagenda la próxima cita del paciente a una nueva fecha/hora.',
    input_schema: {
      type: 'object',
      properties: {
        telefono_paciente: { type: 'string', description: 'Teléfono del paciente' },
        nuevo_datetime: { type: 'string', description: 'Nueva fecha y hora en formato ISO' },
      },
      required: ['telefono_paciente', 'nuevo_datetime'],
    },
  },
  {
    name: 'mis_citas',
    description: 'Consulta las citas futuras del paciente.',
    input_schema: {
      type: 'object',
      properties: {
        telefono_paciente: { type: 'string', description: 'Teléfono del paciente' },
      },
      required: ['telefono_paciente'],
    },
  },
];

const DENTIST_TOOLS = [
  {
    name: 'agenda_del_dia',
    description: 'Obtiene todas las citas de un día específico.',
    input_schema: {
      type: 'object',
      properties: {
        fecha: { type: 'string', description: 'Fecha en formato ISO. Si no se especifica, usa hoy.' },
      },
      required: [],
    },
  },
  {
    name: 'cancelar_citas_del_dia',
    description: 'Cancela TODAS las citas de un día y devuelve los pacientes a notificar.',
    input_schema: {
      type: 'object',
      properties: {
        fecha: { type: 'string', description: 'Fecha en formato ISO (YYYY-MM-DD)' },
        motivo: { type: 'string', description: 'Motivo de la cancelación para informar a los pacientes' },
      },
      required: ['fecha'],
    },
  },
  {
    name: 'verificar_disponibilidad',
    description: 'Verifica slots disponibles en el calendario.',
    input_schema: {
      type: 'object',
      properties: {
        fecha: { type: 'string', description: 'Fecha a verificar en formato ISO' },
      },
      required: [],
    },
  },
];

async function executeTool(toolName, toolInput, calendarId) {
  console.log(`Ejecutando herramienta: ${toolName}`, toolInput);
  switch (toolName) {
    case 'verificar_disponibilidad':
      return await calendar.verificarDisponibilidad(toolInput, calendarId);
    case 'crear_cita':
      return await calendar.crearCita(toolInput, calendarId);
    case 'cancelar_cita':
      return await calendar.cancelarCita(toolInput, calendarId);
    case 'reagendar_cita':
      return await calendar.reagendarCita(toolInput, calendarId);
    case 'mis_citas':
      return await calendar.misCitas(toolInput, calendarId);
    case 'agenda_del_dia':
      return await calendar.agendaDelDia(toolInput, calendarId);
    case 'cancelar_citas_del_dia':
      return await calendar.cancelarCitasDelDia(toolInput, calendarId);
    default:
      return { error: `Herramienta desconocida: ${toolName}` };
  }
}

function buildPatientSystemPrompt(c) {
  return `Eres María, la recepcionista virtual de ${c.name} en Popayán. Atiendes por WhatsApp como si fueras una persona real — cálida, directa y útil.

DATOS DE LA CLÍNICA (responde con esto sin rodeos):
- Nombre: ${c.name}
- Dirección: ${c.address}
- Teléfono: ${c.phone}
- Horarios: ${c.hours}
- Servicios: ${c.services}
- Precios: ${c.prices}
- Parqueadero: ${c.parking || 'No tenemos parqueadero propio, pero hay disponible cerca'}
- Métodos de pago: Efectivo, transferencia, Nequi, Daviplata, tarjeta
- Citas: con cita previa por WhatsApp o llamada
- Urgencias: sí, atendemos urgencias el mismo día con prioridad

CÓMO RESPONDER:
- Sé directa. Si te preguntan la dirección, da la dirección. Punto.
- Habla como persona, no como bot. Nada de "con gusto te informo" ni frases de call center.
- Frases cortas. Máximo 3 líneas por respuesta.
- Usa máximo 1 emoji por mensaje, solo si encaja natural.
- Si ya sabes el nombre del paciente, úsalo.
- Si preguntan por precio, da el rango directamente sin disculpas.
- Si preguntan cómo llegar, da indicaciones útiles basadas en la dirección.

PARA AGENDAR CITAS:
1. Verifica disponibilidad con la herramienta (nunca inventes horarios)
2. Presenta máximo 3 opciones concretas
3. Confirma con el paciente antes de crear la cita
4. Para urgencias (dolor fuerte): ofrece atención ese mismo día

LO QUE NO DEBES HACER:
- Nunca digas "te recomiendo consultarme por este medio" — ya estás en este medio
- Nunca evadas una pregunta que puedas responder con los datos de arriba
- Nunca uses lenguaje formal de correo

Fecha y hora actual: ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}`;
}

function buildDentistSystemPrompt(c) {
  return `Eres el asistente de agenda del Dr./Dra. de ${c.name}. Tu rol es gestionar la agenda de forma eficiente.

CAPACIDADES:
- Ver agenda del día o cualquier fecha
- Cancelar todas las citas de un día (te devolveré la lista de pacientes a notificar)
- Verificar disponibilidad
- Responder preguntas sobre la agenda

REGLAS:
1. Sé conciso y directo — el odontólogo no tiene tiempo
2. Cuando canceles citas de un día, informa exactamente cuántos pacientes hay que notificar
3. Si el odontólogo dice "cancela el martes", confirma antes de ejecutar
4. Siempre confirma acciones destructivas antes de ejecutarlas

Fecha y hora actual: ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}`;
}

async function runAgent({ phone, message, pushName, isDentist = false, clientId = 'default' }) {
  await memory.saveMessage(clientId, phone, 'user', message);
  const history = await memory.getHistory(clientId, phone);

  // Cargar config de la clínica: primero Redis por clientId, luego .env por defecto
  const clientConfig = await memory.getClinicConfig(clientId);
  const clinicConfig = clientConfig ? { ...config.clinic, ...clientConfig } : config.clinic;
  const calendarId = clinicConfig.calendarId || config.google.calendarId;

  const systemPrompt = isDentist ? buildDentistSystemPrompt(clinicConfig) : buildPatientSystemPrompt(clinicConfig);
  const tools = isDentist ? DENTIST_TOOLS : PATIENT_TOOLS;

  const messages = history.length > 0 ? history : [{ role: 'user', content: message }];

  if (!isDentist && pushName && messages.length === 1) {
    messages[0].content = `[El paciente se llama ${pushName}] ${messages[0].content}`;
  }

  let response;
  let iterations = 0;
  const maxIterations = 5;

  while (iterations < maxIterations) {
    iterations++;

    response = await client.messages.create({
      model: config.anthropic.model,
      max_tokens: 1024,
      system: systemPrompt,
      tools,
      messages,
    });

    if (response.stop_reason === 'end_turn') break;

    if (response.stop_reason === 'tool_use') {
      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
      messages.push({ role: 'assistant', content: response.content });

      const toolResults = [];
      for (const toolUse of toolUseBlocks) {
        const result = await executeTool(toolUse.name, toolUse.input, calendarId);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify(result),
        });
      }
      messages.push({ role: 'user', content: toolResults });
    } else {
      break;
    }
  }

  const textBlock = response.content.find(b => b.type === 'text');
  const finalResponse = textBlock?.text || 'Disculpa, hubo un problema. ¿Puedes repetir tu mensaje?';

  await memory.saveMessage(clientId, phone, 'assistant', finalResponse);

  return { response: finalResponse, toolsUsed: iterations > 1 };
}

module.exports = { runAgent };
