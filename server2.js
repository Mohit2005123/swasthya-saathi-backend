// const express = require('express');
// const bodyParser = require('body-parser');
// const twilio = require('twilio');
// const path = require('path');
// const fs = require('fs');
// const gTTS = require('gtts');

// const app = express();

// const accountSID = '';
// const authToken = '';
// const client = require('twilio')(accountSID, authToken);

// // ✅ Replace with your ngrok HTTPS domain
// const NGROK_DOMAIN = 'https://eaecbd77391c.ngrok-free.app';

// app.use('/static', express.static(path.join(__dirname, 'public')));
// app.use(bodyParser.urlencoded({ extended: false }));

// // 🌐 Webhook for Twilio incoming WhatsApp messages
// app.post('/whatsapp-webhook', async (req, res) => {
//   const from = req.body.From;
//   const message = req.body.Body;
//   const timestamp = Date.now();
//   const fileName = `output_${timestamp}.mp3`;
//   const filePath = path.join(__dirname, 'public', fileName);
//   const fileURL = `${NGROK_DOMAIN}/static/${fileName}`;

//   console.log(`📥 Message from ${from}: ${message}`);

//   try {
//     // 🎤 Generate audio from text in Hindi
//     const tts = new gTTS(`Aapne likha: ${message}`, 'hi');
//     await new Promise((resolve, reject) => {
//       tts.save(filePath, (err) => {
//         if (err) return reject(err);
//         resolve();
//       });
//     });

//     // 📤 Send audio as WhatsApp message
//     await client.messages.create({
//       from: 'whatsapp:+14155238886', // Twilio sandbox number
//       to: from,
//       body: `🎧 Aapke message ka audio yahaan hai:`,
//       mediaUrl: [fileURL]
//     });

//     console.log(`✅ Sent audio: ${fileURL}`);
//   } catch (err) {
//     console.error("❌ Error:", err.message);
//   }

//   res.sendStatus(200);
// });

// app.listen(3000, () => {
//   console.log('📡 WhatsApp bot running on http://localhost:3000');
// });

// ✅ WhatsApp bot that receives image, extracts text via Groq OCR, summarizes it, converts to audio, and replies

// ✅ WhatsApp bot: OCR from image via Twilio → summarize with Groq → reply with audio

// ✅ WhatsApp bot: OCR from image → summarize with Groq → ask for language → convert to speech → reply

// ✅ WhatsApp bot: OCR from image → summarize with Groq → ask for language → convert to speech → reply
// ✅ WhatsApp bot: OCR from image → summarize with Groq → ask for language → convert to speech → reply

const express = require('express');
const bodyParser = require('body-parser');
const twilio = require('twilio');
const path = require('path');
const fs = require('fs');
// const gTTS = require('gtts');
const { Groq } = require('groq-sdk');
const fetch = require('node-fetch');
const { SarvamAIClient } = require('sarvamai');
const {spawn} = require('child_process');
const app = express();

const accountSID = '';
const authToken = '';
const client = require('twilio')(accountSID, authToken);

const NGROK_DOMAIN = 'https://11fe57f06637.ngrok-free.app';
const GROQ_API_KEY = '';
const groq = new Groq({ apiKey: GROQ_API_KEY });
app.use('/static', express.static(path.join(__dirname, 'public')));
// Serve static files with correct content-type for mp3
app.use('/static', express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.mp3')) {
      res.setHeader('Content-Type', 'audio/mpeg');
    }
  }
}));
app.use(bodyParser.urlencoded({ extended: false }));

const userState = {}; // Temporary memory for user language preference

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

// 🔁 Translate English summary to selected language
async function translateText(text, targetLang) {
  const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`);
  const data = await res.json();
  return data[0].map(part => part[0]).join('');
}


app.post('/whatsapp-webhook', async (req, res) => {
  const from = req.body.From;
  const timestamp = Date.now();
  const incomingMsg = req.body.Body?.toLowerCase().trim();

  try {
    const mediaUrl = req.body.MediaUrl0;
    const contentType = req.body.MediaContentType0;

    // Step 1: Handle language selection
    if (userState[from]?.waitingForLanguage && incomingMsg) {
      // Only languages supported by Sarvam AI
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


      const selectedLang = langMap[incomingMsg];
      if (!selectedLang) {
        await client.messages.create({
          from: 'whatsapp:+14155238886',
          to: from,
          body: '❌ Invalid option. Please reply with:\n1. Hindi\n2. English\n3. Bengali\n4. Tamil\n5. Telugu\n6. Kannada\n7. Malayalam\n8. Marathi\n9. Gujarati'
        });
        return res.sendStatus(200);
      }

      const englishSummary = userState[from].summary.replace(/[\*\_\~\`]/g, '');

      // Step 2: Translate summary to selected language
    //   const translated = await translateText(englishSummary, selectedLang.code);
    let translated = await translateText(englishSummary, selectedLang.code);

// ✅ Fallback if translation fails
if (!translated || translated.trim() === '') {
  console.warn('⚠️ Translation returned empty. Using English fallback.');
  translated = englishSummary;
}

      // Step 3: Convert to audio
      const audioFileName = `summary_${timestamp}.mp3`;
      const audioPath = path.join(__dirname, 'public', audioFileName);
      const audioURL = `${NGROK_DOMAIN}/static/${audioFileName}`;


      // Use SarvamAIClient SDK for TTS
      const sarvamClient = new SarvamAIClient({
        apiSubscriptionKey: 'sk_9neln2iw_KtLl05f0AmDGSDOuitOjvV3N'
      });

      // Map language code to Sarvam's expected format (e.g., hi -> hi-IN)
      const langCodeMap = {
        hi: 'hi-IN',
        en: 'en-IN',
        bn: 'bn-IN',
        ta: 'ta-IN',
        te: 'te-IN',
        kn: 'kn-IN',
        ml: 'ml-IN',
        mr: 'mr-IN',
        gu: 'gu-IN'
      };
      const sarvamLang = langCodeMap[selectedLang.code] || selectedLang.code;
      // You can customize speaker/model per language if needed
      const speaker = 'anushka';
      const model = 'bulbul:v2';

      let sarvamResponse;
      try {
        sarvamResponse = await sarvamClient.textToSpeech.convert({
          text: translated,
          target_language_code: sarvamLang,
          speaker,
          pitch: 0,
          pace: 1,
          loudness: 1,
          speech_sample_rate: 22050,
          enable_preprocessing: true,
          model
        });
      } catch (sdkErr) {
        console.error('❌ Sarvam AI SDK error:', sdkErr);
        await client.messages.create({
          from: 'whatsapp:+14155238886',
          to: from,
          body: '❌ Sorry, failed to generate audio for the selected language. Please try again later.'
        });
        delete userState[from];
        return res.sendStatus(200);
      }

      // Handle Sarvam response: decode base64 audio if present
      let audioBuffer = null;
      if (sarvamResponse && Array.isArray(sarvamResponse.audios) && sarvamResponse.audios[0]) {
        audioBuffer = Buffer.from(sarvamResponse.audios[0], 'base64');
      } else if (sarvamResponse && sarvamResponse.audioContent) {
        audioBuffer = sarvamResponse.audioContent;
      }

      if (!audioBuffer) {
        console.error('❌ Sarvam AI TTS SDK failed. Response:', sarvamResponse);
        await client.messages.create({
          from: 'whatsapp:+14155238886',
          to: from,
          body: '❌ Sorry, failed to generate audio for the selected language. Please try again later.'
        });
        delete userState[from];
        return res.sendStatus(200);
      }


      fs.writeFileSync(audioPath, audioBuffer);
      // Log file status for debugging
      try {
        const stats = fs.statSync(audioPath);
        console.log(`✅ Audio file written: ${audioPath} (${stats.size} bytes)`);
        // Log first 100 bytes of the buffer as hex
        console.log('First 100 bytes of audio buffer:', audioBuffer.slice(0, 100).toString('hex'));
        // Check if file exceeds 5MB (Twilio WhatsApp limit)
        if (stats.size > 5 * 1024 * 1024) {
          console.error('❌ Audio file exceeds 5MB limit for WhatsApp via Twilio. Not sending.');
          await client.messages.create({
            from: 'whatsapp:+14155238886',
            to: from,
            body: '❌ Sorry, the generated audio is too large to send on WhatsApp (limit is 5MB). Please try with a shorter summary or message.'
          });
          delete userState[from];
          return res.sendStatus(200);
        }
      } catch (e) {

        console.error('❌ Audio file not found after write:', audioPath);
      }

      // Log the audio URL for manual testing
      console.log('Audio file public URL:', audioURL);
      // Check if the audio file is accessible from the public URL
      let urlAccessible = false;
      try {
        const urlRes = await fetch(audioURL, { method: 'HEAD' });
        urlAccessible = urlRes.ok;
        console.log('Audio URL accessible:', urlAccessible);
      } catch (err) {
        console.error('Error checking audio URL accessibility:', err);
      }
      if (!urlAccessible) {
        await client.messages.create({
          from: 'whatsapp:+14155238886',
          to: from,
          body: '❌ Sorry, the audio file could not be accessed from the public URL. Please check your ngrok/public folder setup.'
        });
        delete userState[from];
        return res.sendStatus(200);
      }
      // Wait 2 seconds to ensure file is available for Twilio
      await new Promise(resolve => setTimeout(resolve, 5000));


      // Step 4: Reply with summary + voice
      await client.messages.create({
        from: 'whatsapp:+14155238886',
        to: from,
        body:'Time pass',
        mediaUrl: [audioURL],
      });

      delete userState[from];
      return res.sendStatus(200);
    }

    // Step 5: If media is image, call Groq for summary
    if (mediaUrl && contentType.startsWith('image')) {
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

      const summary = chatCompletion.choices[0].message.content
  .replace(/[\*\_\~\`]/g, '')  // remove markdown
  .split('\n\n').pop().trim(); // keep only the final summary block
      console.log(`📄 English Summary: ${summary}`);

      userState[from] = { waitingForLanguage: true, summary };

      await client.messages.create({
        from: 'whatsapp:+14155238886',
        to: from,
        body:
          '🗣️ In which language would you like to hear the summary?\n' +
          '1. Hindi\n' +
          '2. English\n' +
          '3. Bengali\n' +
          '4. Tamil\n' +
          '5. Telugu\n' +
          '6. Kannada\n' +
          '7. Malayalam\n' +
          '8. Marathi\n' +
          '9. Gujarati\n' +
          '\n👉 Reply with the number (1–9).'
      });


      return res.sendStatus(200);
    }

    res.status(200).send();
  } catch (err) {
    console.error('❌ Error:', err.message);
    res.status(500).send();
  }
});

app.listen(3000, () => {
  console.log('📡 WhatsApp OCR + Groq bot running on http://localhost:3000');
});
