const axios = require('axios');

async function downloadAudioFromEvolution({ audio, instanceName }) {
  const base = process.env.EVOLUTION_API_URL;
  const apiKey = process.env.EVOLUTION_API_KEY;

  if (!base || !apiKey) throw new Error('EVOLUTION_API_URL o EVOLUTION_API_KEY no configurados');

  const encodedInstance = encodeURIComponent(instanceName);
  const url = `${base}/chat/getBase64FromMediaMessage/${encodedInstance}`;

  // Solo los campos esenciales — Evolution API rechaza campos extra como addressingMode, messageContextInfo
  const body = {
    message: {
      key: {
        remoteJid: audio.key.remoteJid,
        fromMe: audio.key.fromMe,
        id: audio.key.id,
      },
      message: {
        audioMessage: audio.message.audioMessage,
      },
    },
  };

  console.log(`[transcription] Descargando audio — instancia: ${instanceName}, url: ${url}`);

  let res;
  try {
    res = await axios.post(url, body, {
      headers: { apikey: apiKey, 'content-type': 'application/json' },
    });
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    throw new Error(`Evolution API falló (${err.response?.status || 'sin respuesta'}): ${detail}`);
  }

  if (!res.data?.base64) {
    throw new Error(`Evolution API no retornó base64. Respuesta: ${JSON.stringify(res.data)}`);
  }

  return {
    base64: res.data.base64,
    mimeType: res.data.mimetype || 'audio/ogg',
  };
}

async function transcribeAudio({ audioBase64, mimeType = 'audio/ogg' }) {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) throw new Error('ASSEMBLYAI_API_KEY no configurada');

  const authHeaders = { authorization: apiKey };

  const buffer = Buffer.from(audioBase64, 'base64');
  console.log(`[transcription] Buffer size: ${buffer.length} bytes, API key presente: ${!!apiKey}`);

  let uploadRes;
  try {
    uploadRes = await axios.post('https://api.assemblyai.com/v2/upload', buffer, {
      headers: { ...authHeaders, 'content-type': 'application/octet-stream' },
      maxBodyLength: Infinity,
    });
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    throw new Error(`AssemblyAI upload falló (${err.response?.status}): ${detail}`);
  }

  const uploadUrl = uploadRes.data.upload_url;
  if (!uploadUrl) throw new Error('AssemblyAI no retornó upload_url');

  console.log(`[transcription] Upload OK — url: ${uploadUrl}`);

  let transcriptRes;
  try {
    transcriptRes = await axios.post(
      'https://api.assemblyai.com/v2/transcript',
      { audio_url: uploadUrl },
      { headers: { ...authHeaders, 'content-type': 'application/json' } }
    );
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    throw new Error(`AssemblyAI transcript falló (${err.response?.status}): ${detail}`);
  }

  const transcriptId = transcriptRes.data.id;
  console.log(`[transcription] Transcript ID: ${transcriptId}`);

  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const poll = await axios.get(
      `https://api.assemblyai.com/v2/transcript/${transcriptId}`,
      { headers: authHeaders }
    );
    const { status, text, error } = poll.data;

    if (status === 'completed') return text;
    if (status === 'error') throw new Error(`AssemblyAI error: ${error}`);
  }

  throw new Error('Timeout esperando transcripción (>3 min)');
}

module.exports = { downloadAudioFromEvolution, transcribeAudio };
