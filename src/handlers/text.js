const { runAgent } = require('../agent');
const { validateTextContent } = require('../utils/validator');

async function handleText({ phone, content, pushName, isDentist, clientId }) {
  const text = validateTextContent(content);

  if (!text.trim()) {
    return { success: false, reply: null, error: 'Mensaje de texto vacío', metadata: { type: 'text' } };
  }

  const { response } = await runAgent({ phone, message: text, pushName, isDentist, clientId });

  return {
    success: true,
    reply: response,
    error: null,
    metadata: { type: 'text', length: text.length },
  };
}

module.exports = { handleText };
