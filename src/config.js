require('dotenv').config();

module.exports = {
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-sonnet-4-5',
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },
  evolution: {
    apiUrl: process.env.EVOLUTION_API_URL,
    apiKey: process.env.EVOLUTION_API_KEY,
    instance: process.env.EVOLUTION_INSTANCE,
  },
  google: {
    calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
    credentials: {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
  },
  assemblyai: {
    apiKey: process.env.ASSEMBLYAI_API_KEY,
  },
  server: {
    port: process.env.PORT || 3000,
    secret: process.env.WEBHOOK_SECRET || 'dental-secret-2026',
  },
  clinic: {
    name: process.env.CLINIC_NAME || 'Clínica Dental',
    address: process.env.CLINIC_ADDRESS || '',
    phone: process.env.CLINIC_PHONE || '',
    hours: process.env.CLINIC_HOURS || 'Lunes-Viernes 8am-6pm, Sábado 8am-2pm',
    prices: process.env.CLINIC_PRICES || 'Consulta $50k | Limpieza $80k-$120k | Blanqueamiento $200k-$400k',
    services: process.env.CLINIC_SERVICES || 'Limpieza, ortodoncia, blanqueamiento, implantes, extracciones',
    parking: process.env.CLINIC_PARKING || '',
    staffPhone: process.env.STAFF_WHATSAPP || '',
  },
};
