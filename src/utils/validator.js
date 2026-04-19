function validateMessagePayload({ phone, type, content }) {
  if (!phone) throw new Error('phone es requerido');
  if (!type) throw new Error('type es requerido');
  if (!content) throw new Error('content es requerido');
}

function validateAudioContent(content) {
  const audio = content?.audio;
  if (!audio) throw new Error('content.audio es requerido');
  if (!audio.key) throw new Error('content.audio.key es requerido');
  if (!audio.message?.audioMessage) throw new Error('content.audio.message.audioMessage es requerido');
  if (!audio.instance) throw new Error('content.audio.instance es requerido');
  return audio;
}

function validateTextContent(content) {
  if (content?.text === undefined || content?.text === null) {
    throw new Error('content.text es requerido');
  }
  return content.text;
}

module.exports = { validateMessagePayload, validateAudioContent, validateTextContent };
