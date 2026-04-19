const axios = require('axios');

async function downloadAudioFromEvolution({ audio, instanceName }) {
  const base = process.env.EVOLUTION_API_URL;
  const apiKey = process.env.EVOLUTION_API_KEY;

  if (!base || !apiKey) throw new Error('EVOLUTION_API_URL o EVOLUTION_API_KEY no configurados');

  const res = await axios.post(
    `${base}/chat/getBase64FromMediaMessage/${instanceName}`,
    { message: { key: audio.key, message: audio.message } },
    { headers: { apikey: apiKey, 'content-type': 'application/json' } }
  );

  if (!res.data?.base64) throw new Error('Evolution API no retornó base64');

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
  const uploadRes = await axios.post('https://api.assemblyai.com/v2/upload', buffer, {
    headers: { ...authHeaders, 'content-type': mimeType },
    maxBodyLength: Infinity,
  });

  const uploadUrl = uploadRes.data.upload_url;
  if (!uploadUrl) throw new Error('AssemblyAI no retornó upload_url');

  const transcriptRes = await axios.post(
    'https://api.assemblyai.com/v2/transcript',
    { audio_url: uploadUrl, language_detection: true },
    { headers: { ...authHeaders, 'content-type': 'application/json' } }
  );

  const transcriptId = transcriptRes.data.id;

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
