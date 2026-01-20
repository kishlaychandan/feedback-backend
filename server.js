const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize Google Gemini
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  throw new Error('GEMINI_API_KEY is not set. Put it in feedback-backend/.env or your hosting provider env vars.');
}
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const GEMINI_MODEL_TEXT = process.env.GEMINI_MODEL_TEXT || 'gemini-2.5-flash';
const GEMINI_MODEL_AUDIO = process.env.GEMINI_MODEL_AUDIO || 'gemini-2.5-flash';
console.log(`Gemini models: text=${GEMINI_MODEL_TEXT} audio=${GEMINI_MODEL_AUDIO}`);

// Middleware
app.use(cors());
app.use(express.json());

// Configure multer for audio file uploads
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// System prompt for pure LLM-based responses
const SYSTEM_PROMPT = `You are Living Things Cooling Management Feedback Assistant. You help people control AC for comfort and respond naturally to their feedback.

CRITICAL RULES:
1. ALWAYS specify the exact action taken: "I've turned on the AC and set it to 22°C" or "I've increased the temperature"
2. NEVER use generic phrases like "feedback has been noted" or "appropriate action has been taken"
3. Show genuine empathy, especially for health issues or discomfort
4. Keep responses concise (1-3 sentences), natural, and conversational
5. Understand intent in ANY language (English, Hindi, etc.)

INTENT UNDERSTANDING:
- Cold/freezing/ठंड/ठंडी → Increase temperature + Turn AC off
- Hot/sweaty/sweating/गर्म/गर्मी → Turn AC on + Lower temperature
- Fever/sick/बुखार/बीमार → Turn AC on + Lower temperature + Show empathy + Wish recovery
- "set 24" / "24 degrees" → Set temperature to 24°C
- "increase/warmer/बढ़ाओ" → Increase temperature
- "decrease/cooler/कम करो/tapman kam kar do" → Decrease temperature
- "turn on/चालू करो" → Turn AC on
- "turn off/बंद करो" → Turn AC off

EXAMPLES:
- "I'm feeling sweaty" → "I understand you're feeling sweaty. I've turned on the AC and lowered the temperature to 22°C to help you cool down."
- "I have fever" → "I'm sorry you're not feeling well. I've turned on the AC and set it to 22°C. I hope you recover soon."
- "Mujhe Thandi lag rahi hai" → "I understand you're feeling cold. I've increased the temperature and turned off the AC to warm things up."
- "Set temperature to 24" → "Done! I've set the temperature to 24°C. The room will adjust to that setting."

Remember: Always specify what you did. Be empathetic and natural. Understand intent in any language.`;

// Pure LLM-based response generator
async function generateResponse(userMessage) {
  try {
    const model = genAI.getGenerativeModel({ 
      model: GEMINI_MODEL_TEXT,
      systemInstruction: SYSTEM_PROMPT,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 120
      }
    });

    const result = await model.generateContent(userMessage);
    const response = await result.response;
    const text = response.text();

    if (text && text.trim().length > 0) {
      return text.trim();
    }

    // If no text returned, return simple message
    return "I understand your request. I've adjusted the AC settings to help you feel more comfortable.";

  } catch (error) {
    console.error('Gemini API error:', error.message);
    // Pure LLM approach - if API fails, return simple message
    return "I understand your request. I've adjusted the AC settings to help you feel more comfortable.";
  }
}

// API endpoint to process feedback
app.post('/api/feedback', async (req, res) => {
  try {
    const { message } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ 
        error: 'Message is required and must be a non-empty string' 
      });
    }

    // Generate response using Gemini
    const response = await generateResponse(message.trim());

    res.json({ 
      response: response,
      originalMessage: message
    });

  } catch (error) {
    console.error('Error processing feedback:', error);
    res.status(500).json({ 
      error: 'Internal server error while processing feedback' 
    });
  }
});

// Speech-to-text endpoint using Gemini (multimodal)
app.post('/api/speech-to-text', upload.single('audio'), async (req, res) => {
  try {
    // Check if audio file is present
    if (!req.file) {
      return res.status(400).json({ 
        error: 'Audio file is required' 
      });
    }

    const audioBuffer = req.file.buffer;
    const mimeType = req.file.mimetype || 'audio/webm';

    console.log(`Transcribing audio, size: ${audioBuffer.length} bytes, type: ${mimeType}`);

    // Convert buffer to base64 for Gemini
    const base64Audio = audioBuffer.toString('base64');

    // Use Gemini's multimodal capability for transcription
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL_AUDIO });

    const prompt = "Transcribe this audio accurately. Return only the transcribed text, nothing else.";

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: base64Audio,
          mimeType: mimeType
        }
      }
    ]);

    const response = await result.response;
    const transcript = response.text().trim();

    if (!transcript || transcript.length === 0) {
      return res.status(500).json({ 
        error: 'Could not transcribe audio. Please try again.' 
      });
    }

    console.log(`Transcription successful: "${transcript}"`);

    res.json({ 
      transcript: transcript,
      success: true
    });

  } catch (error) {
    console.error('Speech-to-text error:', error.message);
    
    // Handle rate limiting
    if (error.message?.includes('429') || error.message?.includes('quota')) {
      return res.status(429).json({ 
        error: 'Too many requests. Please wait a moment and try again.' 
      });
    }

    res.status(500).json({ 
      error: 'Failed to process audio. Please try again or use text input.' 
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Feedback API is running with Gemini' });
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Feedback backend server running on http://localhost:${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/api/health`);
  console.log(`   Using Google Gemini API (free tier)`);
});