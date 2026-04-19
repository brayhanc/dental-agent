const { downloadAudioFromEvolution, transcribeAudio } = require('../services/transcription');
const { validateAudioContent } = require('../utils/validator');
const { runAgent } = require('../agent');

async function handleAudio({ phone, content, pushName, isDentist, clientId }) {
  const audio = validateAudioContent(content);
  const instanceName = audio.instance;
  const audioDuration = audio.message?.audioMessage?.seconds;

  let base64, mimeType;
  try {
    ({ base64, mimeType } = await downloadAudioFromEvolution({ audio, instanceName }));
  } catch (err) {
    throw new Error(`Error descargando audio de Evolution API: ${err.message}`);
  }

  let transcribedText;
  try {
    transcribedText = await transcribeAudio({ audioBase64: base64, mimeType });
  } catch (err) {
    throw new Error(`Error transcribiendo audio: ${err.message}`);
  }

  if (!transcribedText?.trim()) {
    return {
      success: false,
      reply: 'No pude entender el audio. ¿Puedes escribirme lo que necesitas? 🙏',
      error: 'Transcripción vacía o ininteligible',
      metadata: { type: 'audio', duration: audioDuration },
    };
  }

  let response;
  try {
    ({ response } = await runAgent({ phone, message: transcribedText, pushName, isDentist, clientId }));
  } catch (err) {
    throw new Error(`Error en agente con transcripción: ${err.message}`);
  }

  return {
    success: true,
    reply: `🎙️ _"${transcribedText}"_\n\n${response}`,
    error: null,
    metadata: { type: 'audio', transcribedText, duration: audioDuration },
  };
}

module.exports = { handleAudio };
