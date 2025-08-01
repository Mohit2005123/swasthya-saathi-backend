const translate = require('google-translate-api-x');

async function translateToLang(text, targetLangCode) {
  try {
    const res = await translate(text, { to: targetLangCode });
    console.log(res.text);
    return res.text;
  } catch (err) {
    console.error("Translation error:", err.message);
    return text; // fallback
  }
}

// Example usage
translateToLang("Take 1 tablet after meals", "hi"); // Hindi
