const fs= require('fs');
const path = require('path');
const fetch = require('node-fetch');
const readline = require('readline');
const dotenv = require('dotenv');
dotenv.config();
const HF_TOKEN=process.env.HF_TOKEN || ''; // Hugging Face API token
async function queryMedicalLLM(ocrSummary, followUpQuestion) {
	const prompt = `You are a medical assistant helping patients understand their prescriptions and health queries. The patient's prescription summary is:\n\n"${ocrSummary}"\n\nNow, they are asking:\n"${followUpQuestion}"\n\nAnswer clearly and concisely in under 200 words using simple language for a voice message in regional Indian languages.`;

	const response = await fetch('https://router.huggingface.co/v1/chat/completions', {
		headers: {
			Authorization: `Bearer ${HF_TOKEN}`,
			'Content-Type': 'application/json',
		},
		method: 'POST',
		body: JSON.stringify({
			model: 'Intelligent-Internet/II-Medical-8B:featherless-ai',
			messages: [
				{
					role: 'user',
					content: prompt,
				},
			],
		}),
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Request failed: ${response.status} ${error}`);
	}

	const result = await response.json();
	return result.choices?.[0]?.message?.content || 'No response from medical model.';
}

async function run() {
	try {
		const ocrSummary = await fs.promises.readFile('testOCR.txt', 'utf8');
        console.log('🩺 OCR Summary:\n', ocrSummary);
		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
		});

		rl.question('💬 Enter your follow-up medical question:\n> ', async (followUpQuestion) => {
			rl.close();

			const answer = await queryMedicalLLM(ocrSummary.trim(), followUpQuestion.trim());
			console.log('\n🩺 Swaasthya Saathi Response:\n');
			console.log(answer);
		});
	} catch (err) {
		console.error('❌ Error:', err.message);
	}
}

run();
