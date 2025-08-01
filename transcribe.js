require('dotenv').config();
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');

// Replace with your API key
const API_KEY = '';
const API_URL = 'https://api.sarvam.ai/speech-to-text';

async function transcribeAudio(audioPath, options = {}) {
  const form = new FormData();
  form.append('file', fs.createReadStream(audioPath));

  if (options.model) form.append('model', options.model);
  if (options.language_code) form.append('language_code', options.language_code);

  try {
    const resp = await axios.post(API_URL, form, {
      headers: {
        ...form.getHeaders(),
        'api-subscription-key': API_KEY
      },
      timeout: 60000
    });
    return resp.data;
  } catch (err) {
    console.error('Transcription error:', err.response?.data || err.message);
    throw err;
  }
}

(async () => {
  const audioPath = '/Users/mohitmongia/Documents/Full stack web developments/checkingvoice/public/audio_1754039421668.mp3'; // WAV or MP3, best at 16 kHz
  const options = {
    model: 'saarika:v2.5',          // default is saarika:v2.5
    language_code: 'hi-IN'          // optional for v2.5; use 'unknown' for auto‑detect :contentReference[oaicite:1]{index=1}
  };

  const result = await transcribeAudio(audioPath, options);
  console.log('Transcript:', result.transcript);
  if (result.timestamps) console.log('Timestamps:', result.timestamps);
  if (result.diarized_transcript) console.log('Speakers:', result.diarized_transcript);
})();
