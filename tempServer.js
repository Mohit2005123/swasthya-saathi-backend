const express = require('express');
const bodyParser = require('body-parser');
const twilio = require('twilio');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { Groq } = require('groq-sdk');
const fetch = require('node-fetch');
const { SarvamAIClient } = require('sarvamai');

const app = express();

const accountSID = '';
const authToken = '';
const client = require('twilio')(accountSID, authToken);

const NGROK_DOMAIN = 'https://11fe57f06637.ngrok-free.app';
const GROQ_API_KEY = '';
const groq = new Groq({ apiKey: GROQ_API_KEY });

app.use('/static', express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.mp3')) {
      res.setHeader('Content-Type', 'audio/mpeg');
    }
  }
}));

app.use(bodyParser.urlencoded({ extended: false }));

app.post('/whatsapp-webhook', async (req, res) => {
  const from = req.body.From;
  const timestamp = Date.now();
  const incomingMsg = req.body.Body?.toLowerCase().trim();

  try {
    const translated = "Aapka swagat hai!"; // use your translated output
    const audioRawFile = path.join(__dirname, 'public', `audio_${timestamp}.raw`);
    const audioMp3File = path.join(__dirname, 'public', `audio_${timestamp}.mp3`);
    const audioURL = `${NGROK_DOMAIN}/static/audio_${timestamp}.mp3`;

    // SarvamAI usage (mock example, replace with actual TTS response)
   const sarvamClient = new SarvamAIClient({
        apiSubscriptionKey: 'sk_9neln2iw_KtLl05f0AmDGSDOuitOjvV3N'
      });

    const response = await sarvamClient.textToSpeech.convert({
      text: translated,
      target_language_code: 'hi-IN',
      speaker: 'anushka',
      pitch: 0,
      pace: 1,
      loudness: 1,
      speech_sample_rate: 22050,
      enable_preprocessing: true,
      model: 'bulbul:v2'
    });

    const audioBuffer = Buffer.from(response.audios[0], 'base64');
    fs.writeFileSync(audioRawFile, audioBuffer);

    // Convert RAW audio to MP3 using ffmpeg
    await new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-f', 's16le',
        '-ar', '22050',
        '-ac', '1',
        '-i', audioRawFile,
        '-acodec', 'libmp3lame',
        '-ab', '128k',
        audioMp3File
      ]);

      ffmpeg.stderr.on('data', data => console.error('ffmpeg:', data.toString()));
      ffmpeg.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error('ffmpeg failed'));
      });
    });

    // Wait to ensure file is ready for Twilio
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Send via WhatsApp
    await client.messages.create({
      from: 'whatsapp:+14155238886',
      to: from,
      body: '🎧 Here is your audio:',
      mediaUrl: [audioURL]
    });

    res.sendStatus(200);
  } catch (err) {
    console.error('❌ Error:', err.message);
    res.sendStatus(500);
  }
});

app.listen(3000, () => {
  console.log('📡 Bot running on http://localhost:3000');
});
