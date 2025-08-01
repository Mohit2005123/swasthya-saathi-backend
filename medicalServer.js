require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const twilio = require('twilio');
const path = require('path');
const fs = require('fs');
const { Groq } = require('groq-sdk');
const fetch = require('node-fetch');
const { SarvamAIClient } = require('sarvamai');
const { spawn } = require('child_process');
const FormData = require('form-data');

const app = express();

const accountSID = process.env.TWILIO_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSID, authToken);

const NGROK_DOMAIN = process.env.NGROK_DOMAIN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const groq = new Groq({ apiKey: GROQ_API_KEY });

const sarvamClient = new SarvamAIClient({ apiSubscriptionKey: process.env.SARVAM_API_KEY });

app.use('/static', express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.mp3')) {
      res.setHeader('Content-Type', 'audio/mpeg');
    }
  }
}));
app.use(bodyParser.urlencoded({ extended: false }));

const userState = {};

async function downloadTwilioImage(url, fileName) {
  const res = await fetch(url, {
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${accountSID}:${authToken}`).toString('base64')
    }
  });
  const buffer = await res.buffer();
  const filePath = path.join(__dirname, 'public', fileName);
  fs.writeFileSync(filePath, buffer);
  return `${NGROK_DOMAIN}/static/${fileName}`;
}

async function translateText(text, targetLang) {
  const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`);
  const data = await res.json();
  return data[0].map(part => part[0]).join('');
}

app.post('/whatsapp-webhook', async (req, res) => {
  const from = req.body.From;
  const timestamp = Date.now();
  const incomingMsg = req.body.Body?.toLowerCase().trim();
  const mediaUrl = req.body.MediaUrl0;
  const contentType = req.body.MediaContentType0;

  try {
    const langMap = {
      '1': { code: 'hi', label: 'Hindi' },
      '2': { code: 'en', label: 'English' },
      '3': { code: 'bn', label: 'Bengali' },
      '4': { code: 'ta', label: 'Tamil' },
      '5': { code: 'te', label: 'Telugu' },
      '6': { code: 'kn', label: 'Kannada' },
      '7': { code: 'ml', label: 'Malayalam' },
      '8': { code: 'mr', label: 'Marathi' },
      '9': { code: 'gu', label: 'Gujarati' }
    };

    const langCodeMap = {
      hi: 'hi-IN', en: 'en-IN', bn: 'bn-IN', ta: 'ta-IN',
      te: 'te-IN', kn: 'kn-IN', ml: 'ml-IN', mr: 'mr-IN', gu: 'gu-IN'
    };

    // ✅ VOICE FOLLOW-UP HANDLER
    if (mediaUrl && contentType?.startsWith('audio') && userState[from]?.expectingVoice) {
      const oggFile = `voice_${timestamp}.ogg`;
      const wavFile = `voice_${timestamp}.wav`;
      const oggPath = path.join(__dirname, 'public', oggFile);
      const wavPath = path.join(__dirname, 'public', wavFile);

      await downloadTwilioImage(mediaUrl, oggFile);

      await new Promise((resolve, reject) => {
        const ffmpeg = spawn('ffmpeg', ['-i', oggPath, '-ar', '16000', '-ac', '1', wavPath]);
        ffmpeg.stderr.on('data', data => console.error('ffmpeg:', data.toString()));
        ffmpeg.on('close', code => code === 0 ? resolve() : reject(new Error('FFmpeg failed')));
      });

      const form = new FormData();
      form.append('file', fs.createReadStream(wavPath));
      form.append('model', 'saarika:v2.5');
      form.append('language_code', 'unknown');

      const response = await fetch('https://api.sarvam.ai/speech-to-text', {
        method: 'POST',
        headers: {
          'api-subscription-key': process.env.SARVAM_API_KEY,
          ...form.getHeaders()
        },
        body: form
      });

      const result = await response.json();
      const transcript = result.transcript || 'Sorry, could not understand the audio.';

      await client.messages.create({
        from: 'whatsapp:+14155238886',
        to: from,
        body: `🗨️ Transcribed: ${transcript}\n\n💡 Processing your question...`
      });

      // ⬇️ Ask Groq using prescription + question
      const prevSummary = userState[from]?.summary || '';
      const langCode = userState[from]?.languageCode || 'en-IN';
      const langLabel = userState[from]?.languageLabel || 'English';

    //   const chatResponse = await groq.chat.completions.create({
    //     messages: [
    //       {
    //         role: 'user',
    //         content: `You are a helpful healthcare assistant. The following is a prescription summary:\n\n"${prevSummary}"\n\nNow, the user asked:\n"${transcript}"\n\nBased on the prescription and question, provide a simple, helpful response.`
    //       }
    //     ],
    //     model: 'llama-3.3-70b-versatile',
    //     temperature: 0.5,
    //     max_completion_tokens: 512,
    //     top_p: 1
    //   });
    const hfPrompt = `You are a medical assistant helping patients understand their prescriptions and health queries. The patient's prescription summary is:\n\n"${prevSummary}"\n\nNow, they are asking:\n"${transcript}"\n\nAnswer clearly and concisely in under 200 words using simple language for a voice message in regional Indian languages.`;

const hfResponse = await fetch('https://router.huggingface.co/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${process.env.HF_TOKEN}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    model: 'Intelligent-Internet/II-Medical-8B:featherless-ai',
    messages: [{ role: 'user', content: hfPrompt }]
  })
});

if (!hfResponse.ok) {
  const errorText = await hfResponse.text();
  console.error('❌ Hugging Face error:', errorText);
  throw new Error('Hugging Face model failed.');
}

const hfData = await hfResponse.json();
let fullContent = hfData.choices?.[0]?.message?.content?.trim() || 'No answer received from medical model.';

// Extract only content between <Answer>...</Answer>
const match = fullContent.match(/<Answer>([\s\S]*?)<\/Answer>/i);
let replyText = match ? match[1].trim() : fullContent; // fallback to full content if <Answer> not found
const reverseLangCode = Object.entries(langCodeMap).find(([_, val]) => val === langCode)?.[0] || 'en';
replyText = await translateText(replyText, reverseLangCode);

      // 🗣️ Convert answer to speech
      const audioRes = await sarvamClient.textToSpeech.convert({
        text: replyText,
        target_language_code: langCode,
        speaker: 'anushka',
        model: 'bulbul:v2',
        pitch: 0, pace: 1, loudness: 1, speech_sample_rate: 22050,
        enable_preprocessing: true
      });

      const answerRaw = Buffer.from(audioRes.audios[0], 'base64');
      const rawAnswerPath = path.join(__dirname, 'public', `answer_${timestamp}.raw`);
      const mp3AnswerPath = path.join(__dirname, 'public', `answer_${timestamp}.mp3`);
      const audioAnswerURL = `${NGROK_DOMAIN}/static/answer_${timestamp}.mp3`;

      fs.writeFileSync(rawAnswerPath, answerRaw);

      await new Promise((resolve, reject) => {
        const ffmpeg = spawn('ffmpeg', [
          '-f', 's16le', '-ar', '22050', '-ac', '1',
          '-i', rawAnswerPath,
          '-acodec', 'libmp3lame', '-ab', '128k',
          mp3AnswerPath
        ]);
        ffmpeg.stderr.on('data', data => console.error('ffmpeg:', data.toString()));
        ffmpeg.on('close', code => code === 0 ? resolve() : reject(new Error('ffmpeg failed')));
      });

      await new Promise(resolve => setTimeout(resolve, 5000));

      await client.messages.create({
        from: 'whatsapp:+14155238886',
        to: from,
        body: `🤖 Here's the answer to your question in ${langLabel}:`,
        mediaUrl: [audioAnswerURL]
      });

      return res.sendStatus(200);
    }

    // ✅ LANGUAGE SELECTION HANDLER
    if (userState[from]?.waitingForLanguage && incomingMsg) {
      const selectedLang = langMap[incomingMsg];
      if (!selectedLang) {
        await client.messages.create({
          from: 'whatsapp:+14155238886',
          to: from,
          body: '❌ Invalid option. Please reply with a valid number.'
        });
        return res.sendStatus(200);
      }

      let translated = await translateText(userState[from].summary, selectedLang.code);
      if (!translated || translated.trim() === '') translated = userState[from].summary;

      const audioRes = await sarvamClient.textToSpeech.convert({
        text: translated,
        target_language_code: langCodeMap[selectedLang.code],
        speaker: 'anushka',
        model: 'bulbul:v2',
        pitch: 0, pace: 1, loudness: 1, speech_sample_rate: 22050,
        enable_preprocessing: true
      });

      const audioBuffer = Buffer.from(audioRes.audios[0], 'base64');
      const rawPath = path.join(__dirname, 'public', `audio_${timestamp}.raw`);
      const mp3Path = path.join(__dirname, 'public', `audio_${timestamp}.mp3`);
      const audioURL = `${NGROK_DOMAIN}/static/audio_${timestamp}.mp3`;

      fs.writeFileSync(rawPath, audioBuffer);

      await new Promise((resolve, reject) => {
        const ffmpeg = spawn('ffmpeg', [
          '-f', 's16le', '-ar', '22050', '-ac', '1',
          '-i', rawPath,
          '-acodec', 'libmp3lame', '-ab', '128k',
          mp3Path
        ]);
        ffmpeg.stderr.on('data', data => console.error('ffmpeg:', data.toString()));
        ffmpeg.on('close', code => code === 0 ? resolve() : reject(new Error('ffmpeg failed')));
      });

      await new Promise(resolve => setTimeout(resolve, 5000));

      await client.messages.create({
        from: 'whatsapp:+14155238886',
        to: from,
        body: `🎧 Here's your summary audio in ${selectedLang.label}:`,
        mediaUrl: [audioURL]
      });

      userState[from].waitingForLanguage = false;
      userState[from].expectingVoice = true;
      userState[from].languageCode = langCodeMap[selectedLang.code];
      userState[from].languageLabel = selectedLang.label;

      await client.messages.create({
        from: 'whatsapp:+14155238886',
        to: from,
        body: '🎤 You can now send voice notes to ask questions about the prescription.'
      });

      return res.sendStatus(200);
    }

    // ✅ PRESCRIPTION IMAGE HANDLER
    if (mediaUrl && contentType?.startsWith('image')) {
      const localImageFile = `twilio_img_${timestamp}.jpg`;
      const groqImageUrl = await downloadTwilioImage(mediaUrl, localImageFile);

      const chatCompletion = await groq.chat.completions.create({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'From this medical image, extract only the relevant prescription and rewrite it in plain English as simple, spoken patient instructions. Do NOT include headings, metadata, or explanations. No markdown. Only the final clean instructions.' },
              { type: 'image_url', image_url: { url: groqImageUrl } }
            ]
          }
        ],
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        temperature: 0.3,
        max_completion_tokens: 1024,
        top_p: 1,
        stream: false
      });

      const summary = chatCompletion.choices[0].message.content.replace(/[\*\_\~\`]/g, '').split('\n\n').pop().trim();
      userState[from] = { waitingForLanguage: true, summary, expectingVoice: false };

      await client.messages.create({
        from: 'whatsapp:+14155238886',
        to: from,
        body:
          '🗣️ In which language would you like to hear the summary?\n' +
          '1. Hindi\n2. English\n3. Bengali\n4. Tamil\n5. Telugu\n6. Kannada\n7. Malayalam\n8. Marathi\n9. Gujarati\n' +
          '\n👉 Reply with the number (1–9).'
      });

      return res.sendStatus(200);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('❌ Error:', err.message);
    res.sendStatus(500);
  }
});

app.listen(3000, () => {
  console.log('📡 WhatsApp OCR + Voice Bot running on http://localhost:3000');
});