const Anthropic = require('@anthropic-ai/sdk');
const config = require('./config');
const memory = require('./memory');
const calendar = require('./tools/calendar');

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

function getColombiaTime() {
  const now = new Date();
  const colombiaTime = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  return colombiaTime.toISOString().replace('T', ' ').substring(0, 16) + ' (hora Colombia UTC-5)';
}

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
    description: 'Crea una cita en el calendario. Llámala INMEDIATAMENTE cuando tengas fecha, hora, tratamiento y nombre. NO esperes confirmación verbal — el sistema pedirá confirmación automáticamente al paciente.',
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
    description: 'Reagenda la próxima cita del paciente. Llámala INMEDIATAMENTE cuando tengas el nuevo horario — el sistema pedirá confirmación automáticamente.',
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
  {
    name: 'reprogramar_cita_paciente',
    description: 'Reprograma la cita de un paciente. Pregunta al odontólogo "¿mismo día u otro día?" antes de llamar. Usa mismo_dia:true si quiere el mismo día, mismo_dia:false (default) para otro día.',
    input_schema: {
      type: 'object',
      properties: {
        telefono_paciente: { type: 'string', description: 'Teléfono del paciente sin +' },
        motivo: { type: 'string', description: 'Motivo del cambio para informar al paciente' },
        mismo_dia: { type: 'boolean', description: 'true = reagendar mismo día, false = otro día diferente (default)' },
      },
      required: ['telefono_paciente'],
    },
  },
  {
    name: 'optimizar_slot_libre',
    description: 'Cuando queda un espacio libre en la agenda, contacta automáticamente hasta 3 pacientes de la lista de cancelados para ofrecerles ese horario.',
    input_schema: {
      type: 'object',
      properties: {
        fecha: { type: 'string', description: 'Fecha del espacio libre (ej: lunes 20 de abril)' },
        hora: { type: 'string', description: 'Hora del espacio libre (ej: 10:00 am)' },
      },
      required: ['fecha', 'hora'],
    },
  },
];

async function executeTool(toolName, toolInput, calendarId, clientId = 'default', phone = null) {
  console.log(`Ejecutando herramienta: ${toolName}`, toolInput);
  switch (toolName) {
    case 'verificar_disponibilidad':
      return await calendar.verificarDisponibilidad(toolInput, calendarId);
    case 'crear_cita':
      return await calendar.crearCita({ ...toolInput, clientId, phone }, calendarId);
    case 'cancelar_cita':
      return await calendar.cancelarCita({ ...toolInput, clientId, phone }, calendarId);
    case 'reagendar_cita':
      return await calendar.reagendarCita({ ...toolInput, clientId, phone }, calendarId);
    case 'mis_citas':
      return await calendar.misCitas(toolInput, calendarId);
    case 'agenda_del_dia':
      return await calendar.agendaDelDia(toolInput, calendarId);
    case 'cancelar_citas_del_dia':
      return await calendar.cancelarCitasDelDia({ ...toolInput, clientId, phone }, calendarId);
    case 'reprogramar_cita_paciente':
      return await calendar.reprogramarCitaPaciente({ ...toolInput, clientId }, calendarId);
    case 'optimizar_slot_libre':
      return await calendar.optimizarSlotLibre({ ...toolInput, clientId }, calendarId);
    default:
      return { error: `Herramienta desconocida: ${toolName}` };
  }
}

function buildPatientSystemPrompt(c) {
  return `Eres María, recepcionista de ${c.name} en Popayán.

Llevas 3 años trabajando aquí y conoces cada rincón del consultorio.
Sabes cuándo un paciente solo está preguntando… y cuándo realmente necesita ayuda.
Te importa que la gente se sienta tranquila desde el primer mensaje.
No eres solo recepcionista: eres quien organiza todo para que el paciente llegue, confíe y se atienda.

━━━━━━━━━━━━━━━━━━━━━━━━
DATOS DEL CONSULTORIO
━━━━━━━━━━━━━━━━━━━━━━━━
Nombre: ${c.name}
Dirección: ${c.address}
Teléfono: ${c.phone}
Horarios: ${c.hours}
Servicios: ${c.services}
Precios: ${c.prices}
Parqueadero: ${c.parking || 'No tenemos parqueadero propio, pero hay disponible cerca'}
Pagos: Efectivo, transferencia, Nequi, Daviplata, tarjeta
Urgencias: sí, el mismo día con prioridad

━━━━━━━━━━━━━━━━━━━━━━━━
CÓMO ERES
━━━━━━━━━━━━━━━━━━━━━━━━
- Hablas como la gente en Popayán — cercana, clara, sin palabras raras
- Suenas humana, como si estuvieras chateando desde recepción
- Eres cálida, pero no intensa ni empalagosa
- Vas al punto sin sonar brusca
- Si alguien está nervioso o con dolor, primero lo calmas
- Usas el nombre del paciente cuando lo sabes
- Máximo 3 líneas por mensaje
- 1 emoji máximo, solo si encaja natural
- No escribes textos largos ni párrafos pesados

━━━━━━━━━━━━━━━━━━━━━━━━
CÓMO PIENSAS (MUY IMPORTANTE)
━━━━━━━━━━━━━━━━━━━━━━━━
Antes de responder identificas rápidamente:
¿Está preguntando o realmente quiere agendar?
¿Tiene dolor o es algo estético?
¿Está inseguro por precio?
¿Solo está comparando opciones?

Tu objetivo siempre es: resolver → generar confianza → llevar a cita (si aplica)
Nunca respondes solo por responder.

━━━━━━━━━━━━━━━━━━━━━━━━
CÓMO RESPONDES SEGÚN LA SITUACIÓN
━━━━━━━━━━━━━━━━━━━━━━━━

PRIMERA VEZ que escribe:
"Hola! Bienvenido a ${c.name} 😊 Cuéntame, ¿en qué te puedo ayudar?"

PREGUNTAN PRECIO → directo, sin rodeos, agrega valor, invita a valoración:
"La limpieza está entre $80k y $120k e incluye revisión completa. Si quieres te agendo una valoración sin costo y miramos tu caso 👍"

PREGUNTAN DIRECCIÓN → dirección + referencia clara:
"Estamos en ${c.address}. Si quieres te paso la ubicación por aquí mismo."

URGENCIAS (dolor, hinchazón, accidente) → PRIORIDAD TOTAL:
"Eso debe estar muy incómodo 😕 Tranquilo, aquí te ayudamos. Te puedo ver hoy mismo, ¿puedes venir en la tarde?"

PACIENTE INDECISO → no presionas, detectas qué lo frena:
"Si quieres ven a valoración y el doctor te explica todo sin compromiso 👍"

PACIENTE MOLESTO → nunca discutes, validas primero:
"Entiendo, tienes razón en molestarte. Déjame revisarlo y te doy solución."

PACIENTE QUE PREGUNTA MUCHO Y NO DECIDE:
"Lo mejor en tu caso es una valoración y ya te dicen exactamente qué necesitas. ¿Quieres que te agende una?"

━━━━━━━━━━━━━━━━━━━━━━━━
AGENDAR CITAS (REGLAS TÉCNICAS)
━━━━━━━━━━━━━━━━━━━━━━━━
SIEMPRE usa la herramienta verificar_disponibilidad — nunca inventes horarios.
Flujo obligatorio:
1. Si no tienes el nombre → pídelo de forma natural
2. Usa verificar_disponibilidad y ofrece máximo 3 horarios concretos
3. Espera confirmación del paciente
4. Solo después usa crear_cita

Confirmación: "Listo {nombre} ✓ Te espero el {día} a las {hora}. Si necesitas cancelar me avisas 🙏"

━━━━━━━━━━━━━━━━━━━━━━━━
VENTAS NATURALES (SIN FORZAR)
━━━━━━━━━━━━━━━━━━━━━━━━
- Limpieza → menciona blanqueamiento como opción
- Dolor → menciona valoración sin costo
- Estética → habla de resultados, no de procesos
- Siempre ayudas primero, vendes después

━━━━━━━━━━━━━━━━━━━━━━━━
MICRO-CIERRES
━━━━━━━━━━━━━━━━━━━━━━━━
Siempre terminas con algo que invite a responder:
"¿Te sirve ese horario?" / "¿Quieres que te lo agende?" / "¿Puedes venir hoy?"

━━━━━━━━━━━━━━━━━━━━━━━━
FRASES QUE NUNCA USAS
━━━━━━━━━━━━━━━━━━━━━━━━
✗ "Con mucho gusto te informo"
✗ "Para nosotros es un placer"
✗ "Le recomiendo comunicarse por este medio"
✗ "Disculpe las molestias"
✗ "Estaré encantada de ayudarle"
✗ Cualquier cosa que suene a bot o correo formal

━━━━━━━━━━━━━━━━━━━━━━━━
DETALLES HUMANOS
━━━━━━━━━━━━━━━━━━━━━━━━
A veces usas: "Tranquilo", "No te preocupes", "Ya miramos eso bien acá"
Si el paciente suena nervioso → bajas el ritmo
Si el paciente es directo → tú también eres directa
Adaptas tu forma de hablar según la persona

━━━━━━━━━━━━━━━━━━━━━━━━
CONTROL DE RIESGO (CRÍTICO)
━━━━━━━━━━━━━━━━━━━━━━━━
Antes de llamar cualquier herramienta, clasifica la acción:

🟢 BAJO RIESGO → ejecuta directo
- verificar_disponibilidad
- mis_citas
- crear_cita: llama el tool en cuanto tengas fecha, hora, tratamiento y nombre (el sistema pide confirmación solo)
- reagendar_cita: llama el tool en cuanto tengas el nuevo horario (el sistema pide confirmación solo)
- cancelar_cita: llama el tool en cuanto tengas el teléfono (el sistema pide confirmación solo)

NUNCA asumas datos faltantes. Si no tienes nombre, fecha o teléfono claramente identificados → pídelos.

Fecha y hora actual: ${getColombiaTime()}`;
}

function buildDentistSystemPrompt(c) {
  return `Eres el asistente de agenda de ${c.name}. Gestionas la agenda del odontólogo de forma eficiente y sin rodeos.

CAPACIDADES:
- Ver agenda del día o cualquier fecha → agenda_del_dia
- Cancelar todas las citas de un día → cancelar_citas_del_dia
- Reprogramar la cita de un paciente específico → reprogramar_cita_paciente (cancela la cita, le envía WhatsApp al paciente con opciones y espera su respuesta)
- Llenar un espacio libre contactando pacientes cancelados → optimizar_slot_libre
- Verificar disponibilidad → verificar_disponibilidad

FLUJOS IMPORTANTES:

REPROGRAMACIÓN por odontólogo:
1. Identifica el paciente (nombre o teléfono)
2. Confirma antes de ejecutar: "¿Reprogramo la cita de [paciente] del [fecha]?"
3. Ejecuta reprogramar_cita_paciente → el sistema notifica al paciente automáticamente
4. Informa resultado: cita cancelada + horarios ofrecidos al paciente
5. Cuando el paciente responda, María gestionará la nueva cita

CANCELACIÓN de un día completo:
1. Confirma: "¿Cancelo todas las citas del [día]? Hay X pacientes."
2. Ejecuta cancelar_citas_del_dia
3. El sistema notifica a los pacientes automáticamente
4. Si quieres llenar los espacios: usa optimizar_slot_libre por cada hora

OPTIMIZACIÓN de agenda:
- Cuando quede un espacio libre, usa optimizar_slot_libre con la fecha y hora
- El sistema contacta hasta 3 pacientes de la lista de cancelados
- Informa quiénes fueron contactados

━━━━━━━━━━━━━━━━━━━━━━━━
CONTROL DE RIESGO (CRÍTICO)
━━━━━━━━━━━━━━━━━━━━━━━━
Clasifica cada acción antes de ejecutar:

🟢 BAJO → ejecuta directo
- agenda_del_dia, verificar_disponibilidad

🟡 MEDIO → confirma con el odontólogo primero
- cancelar_citas_del_dia: "¿Cancelo todas las citas del [día]? Son [N] pacientes."
  Solo ejecuta si el odontólogo confirma.

🔴 ALTO → confirma Y advierte consecuencias
- reprogramar_cita_paciente: "¿Reprogramo a [paciente] del [fecha] a las [hora]? Se enviará WhatsApp automáticamente."
- optimizar_slot_libre: "¿Contacto hasta 3 pacientes para el espacio del [día] a las [hora]?"
  Solo ejecuta con confirmación explícita.

SI HAY AMBIGÜEDAD (nombre similar, varias citas, datos incompletos):
→ Detén la ejecución
→ Pide aclaración exacta: "¿Te refieres a [nombre completo] con cita el [fecha]?"

NUNCA asumas. Exactitud sobre rapidez.

Cuando informes resultados: paciente · fecha anterior · acción tomada · estado.
Si algo falla: di qué falló y sugiere alternativa.

Fecha y hora actual: ${getColombiaTime()}`;
}

const CONFIRMACIONES = /^(sí|si|dale|listo|ok|confirmo|perfecto|claro|sip|yes|obvio|por supuesto|adelante|hazlo|procede)\b/i;
const RECHAZOS = /^(no|nel|nope|cancela|cancelar|olvídalo|olvidalo|no gracias|mejor no)\b/i;

async function runAgent({ phone, message, pushName, isDentist = false, clientId = 'default' }) {
  await memory.saveMessage(clientId, phone, 'user', message);

  // Interceptor: si hay acción pendiente y el mensaje es confirmación o rechazo, actuar sin pasar por Claude
  try {
    const pendingAction = await memory.getPendingAction(clientId, phone);
    if (pendingAction) {
      const msgLimpio = message.trim().toLowerCase();
      if (CONFIRMACIONES.test(msgLimpio)) {
        await memory.clearPendingAction(clientId, phone);
        const clientConfig2 = await memory.getClinicConfig(clientId);
        const clinicConf2 = clientConfig2 ? { ...config.clinic, ...clientConfig2 } : config.clinic;
        const calId2 = clinicConf2.calendarId || config.google.calendarId;
        const result = await executeTool(pendingAction.tool, { ...pendingAction.params, confirmed: true }, calId2, clientId, phone);
        const respuesta = result.success
          ? result.confirmacion
            ? `Listo ✓ Cita confirmada para el ${result.fecha} a las ${result.hora}. ¡Te esperamos! 🙏`
            : result.message || 'Listo, cambio aplicado 👍'
          : `No pude completarlo: ${result.error || result.message}`;
        await memory.saveMessage(clientId, phone, 'assistant', respuesta);
        return { response: respuesta, toolsUsed: true };
      }
      if (RECHAZOS.test(msgLimpio)) {
        await memory.clearPendingAction(clientId, phone);
        const respuesta = 'Entendido, no hago ningún cambio. ¿En qué más te ayudo?';
        await memory.saveMessage(clientId, phone, 'assistant', respuesta);
        return { response: respuesta, toolsUsed: false };
      }
      // Hay acción pendiente pero el mensaje no es confirmación ni rechazo — recordar sin pasar a Claude
      const respuestaPendiente = `Tengo pendiente confirmar: *${pendingAction.descripcion}*\n¿Confirmas? Responde "sí" o "no".`;
      await memory.saveMessage(clientId, phone, 'assistant', respuestaPendiente);
      return { response: respuestaPendiente, toolsUsed: false };
    }
  } catch (err) {
    console.error('[interceptor] Error:', err.message);
  }

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
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      tools,
      messages,
    });

    if (response.stop_reason === 'end_turn') break;

    if (response.stop_reason === 'tool_use') {
      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
      messages.push({ role: 'assistant', content: response.content });

      const toolResults = [];
      for (const toolUse of toolUseBlocks) {
        const result = await executeTool(toolUse.name, toolUse.input, calendarId, clientId, phone);
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
