const Anthropic = require('@anthropic-ai/sdk');
const config = require('./config');
const memory = require('./memory');
const calendar = require('./tools/calendar');

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

// Definición de herramientas para el agente paciente
const PATIENT_TOOLS = [
  {
    name: 'verificar_disponibilidad',
    description: 'Verifica slots disponibles en el calendario para agendar una cita. Úsala cuando el paciente quiera agendar o preguntar por disponibilidad.',
    input_schema: {
      type: 'object',
      properties: {
        fecha: {
          type: 'string',
          description: 'Fecha preferida en formato ISO (YYYY-MM-DD). Si no especifica, busca en los próximos días.',
        },
        duracion_minutos: {
          type: 'number',
          description: 'Duración de la cita en minutos. Default 60.',
        },
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

// Herramientas para el agente del odontólogo
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

// Ejecuta la herramienta solicitada por Claude
async function executeTool(toolName, toolInput) {
  console.log(`Ejecutando herramienta: ${toolName}`, toolInput);
  switch (toolName) {
    case 'verificar_disponibilidad':
      return await calendar.verificarDisponibilidad(toolInput);
    case 'crear_cita':
      return await calendar.crearCita(toolInput);
    case 'cancelar_cita':
      return await calendar.cancelarCita(toolInput);
    case 'reagendar_cita':
      return await calendar.reagendarCita(toolInput);
    case 'mis_citas':
      return await calendar.misCitas(toolInput);
    case 'agenda_del_dia':
      return await calendar.agendaDelDia(toolInput);
    case 'cancelar_citas_del_dia':
      return await calendar.cancelarCitasDelDia(toolInput);
    default:
      return { error: `Herramienta desconocida: ${toolName}` };
  }
}

// System prompt para el agente paciente
function buildPatientSystemPrompt() {
  const c = config.clinic;
  return `Eres María, la asistente virtual de ${c.name}. Atiendes por WhatsApp con un tono cálido, natural y amigable — como una recepcionista real.

INFORMACIÓN DE LA CLÍNICA:
- Nombre: ${c.name}
- Dirección: ${c.address || 'Consultar por este medio'}
- Teléfono: ${c.phone || 'Consultar por este medio'}
- Horarios: ${c.hours}
- Servicios: ${c.services}
- Precios aproximados: ${c.prices}
${c.parking ? `- Parqueadero: ${c.parking}` : ''}

REGLAS:
1. Responde CUALQUIER pregunta sobre la clínica o el entorno (parqueaderos, cómo llegar, etc.)
2. Para agendar: primero verifica disponibilidad, presenta opciones, confirma con el paciente, LUEGO crea la cita
3. Nunca inventes horarios — siempre usa la herramienta verificar_disponibilidad
4. Máximo 2-3 párrafos cortos por respuesta
5. Máximo 1-2 emojis por mensaje
6. Si el paciente está molesto: reconoce primero, ayuda después
7. Recuerda el contexto de la conversación — si ya te dijo su nombre, úsalo
8. Para urgencias dentales (dolor intenso): ofrece atención ese mismo día
9. NO uses lenguaje formal de correo ("Estimado/a", "Por medio de la presente")
10. Eres empática y resolutiva — si no puedes hacer algo, ofrece alternativas

Fecha y hora actual: ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}`;
}

// System prompt para el agente odontólogo
function buildDentistSystemPrompt() {
  const c = config.clinic;
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

// Agente principal — loop de herramientas
async function runAgent({ phone, message, pushName, isDentist = false }) {
  // Guardar mensaje del usuario en memoria
  await memory.saveMessage(phone, 'user', message);

  // Obtener historial
  const history = await memory.getHistory(phone);

  const systemPrompt = isDentist ? buildDentistSystemPrompt() : buildPatientSystemPrompt();
  const tools = isDentist ? DENTIST_TOOLS : PATIENT_TOOLS;

  // Si es la primera vez, agregar contexto del nombre
  const messages = history.length > 0 ? history : [{ role: 'user', content: message }];

  // Agregar nombre del paciente al primer mensaje si lo tenemos
  if (!isDentist && pushName && messages.length === 1) {
    messages[0].content = `[El paciente se llama ${pushName}] ${messages[0].content}`;
  }

  let response;
  let iterations = 0;
  const maxIterations = 5;

  // Loop agéntico — Claude puede llamar múltiples herramientas
  while (iterations < maxIterations) {
    iterations++;

    response = await client.messages.create({
      model: config.anthropic.model,
      max_tokens: 1024,
      system: systemPrompt,
      tools,
      messages,
    });

    // Si Claude terminó (no necesita más herramientas)
    if (response.stop_reason === 'end_turn') {
      break;
    }

    // Si Claude quiere usar herramientas
    if (response.stop_reason === 'tool_use') {
      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');

      // Agregar respuesta de Claude al historial temporal
      messages.push({ role: 'assistant', content: response.content });

      // Ejecutar todas las herramientas solicitadas
      const toolResults = [];
      for (const toolUse of toolUseBlocks) {
        const result = await executeTool(toolUse.name, toolUse.input);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify(result),
        });
      }

      // Agregar resultados de herramientas al historial temporal
      messages.push({ role: 'user', content: toolResults });
    } else {
      break;
    }
  }

  // Extraer texto de la respuesta final
  const textBlock = response.content.find(b => b.type === 'text');
  const finalResponse = textBlock?.text || 'Disculpa, hubo un problema. ¿Puedes repetir tu mensaje?';

  // Guardar respuesta del agente en memoria persistente
  await memory.saveMessage(phone, 'assistant', finalResponse);

  return {
    response: finalResponse,
    toolsUsed: iterations > 1,
  };
}

module.exports = { runAgent };
