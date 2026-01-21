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

// System prompt (pure LLM). Keep it short but strict.
const SYSTEM_PROMPT = `You are **Living Things Cooling Management Feedback Assistant**.
Goal: help people feel comfortable by controlling an AC unit based on their feedback (any language: English/Hindi/etc.).

Hard rules (must follow):
- Your reply MUST include a concrete AC action AND a number: either a target temperature like "set to 22°C" OR a change like "decreased by 2°C".
- If you mention a temperature, you MUST include the unit "°C" (e.g., "20°C"), and the reply must be a complete sentence ending with proper punctuation (do not cut off mid-sentence).
- ALWAYS finish your complete response. Never stop mid-sentence. Always include the full action (e.g., "Turning AC-001 OFF and setting it to 26°C to warm you up.").
- NEVER say: "feedback noted", "appropriate action taken", "I understand your concern" (unless followed by the exact action).
- Keep it natural and helpful in 1–3 short sentences. Reply in the user's language.
- If user is sick (fever/बीमार/बुखार), show empathy + wish recovery + action.
- If the user repeats discomfort ("still hot", "abhi bhi garmi", "still cold", "abhi bhi thand"), take an additional step (usually -2°C for hot, +2°C for cold) instead of repeating the same setting.

Defaults when user gives no number:
- If too hot/sweaty/गर्मी: turn AC ON and set to 22°C.
- If too cold/ठंड: turn AC OFF and set to 26°C.
- If user says "increase/decrease" without a number: change by 2°C (say "+2°C" or "-2°C").

Intent hints:
- cold/freezing/ठंड/ठंडी → warmer (AC OFF + 26°C or +2°C)
- hot/sweaty/गर्म/गर्मी → cooler (AC ON + 22°C or -2°C)
- "set 24"/"24 degrees" → set to 24°C
- "turn on/चालू" → ON (also include a temperature, pick 22°C unless user specifies)
- "turn off/बंद" → OFF (also include a temperature, pick 26°C unless user specifies)

Output: plain text only (no JSON, no markdown).`;

// Helper function for formatted logging
function logWithTimestamp(level, message, data = null) {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level}]`;
  if (data) {
    console.log(`${prefix} ${message}`, data);
  } else {
    console.log(`${prefix} ${message}`);
  }
}

// Pure LLM-based response generator
async function generateResponse(userMessage, acId = null) {
  try {
    logWithTimestamp('INFO', 'Calling Gemini API', {
      model: GEMINI_MODEL_TEXT,
      acId: acId || 'none',
      promptLength: userMessage.length
    });

    const model = genAI.getGenerativeModel({ 
      model: GEMINI_MODEL_TEXT,
      systemInstruction: SYSTEM_PROMPT,
      generationConfig: {
        temperature: 0.5, // Balanced: consistent but not too robotic (0.4-0.7 range)
        topP: 0.95, // Focus on high-probability tokens for quality
        // maxOutputTokens: not set = use default (8192) - plenty of room for complete responses
      },
    });
                                                          
    const result = await model.generateContent(userMessage);
    const response = await result.response;
    
    // Check if response was finished properly
    const candidates = response.candidates || [];
    const finishReason = candidates[0]?.finishReason || 'unknown';
    const text = response.text();     

    if (text && text.trim().length > 0) {
      // Check for incomplete responses (ends mid-sentence, too short, etc.)
      const trimmedText = text.trim();
      const endsWithPunctuation = /[.!?]$/.test(trimmedText);
      const hasTemperature = /\d+\s*°C/.test(trimmedText);
      const isIncomplete = finishReason === 'MAX_TOKENS' || 
                          (!endsWithPunctuation && trimmedText.length < 30) ||
                          trimmedText.endsWith('...') ||
                          trimmedText.match(/^Okay, I'll$/i) || // Common incomplete pattern
                          (!hasTemperature && trimmedText.length < 50); // Should have temp if complete
      
      if (isIncomplete) {
        logWithTimestamp('ERROR', 'Incomplete response detected - rejecting', {
          response: trimmedText,
          length: trimmedText.length,
          finishReason: finishReason,
          hasPunctuation: endsWithPunctuation,
          hasTemperature: hasTemperature,
          reason: 'Response appears to be truncated or incomplete - missing action details'
        });
        throw new Error('Response incomplete - missing action details. Please try again.');
      }

      logWithTimestamp('SUCCESS', 'Gemini response received', {
        response: trimmedText,
        length: trimmedText.length,
        finishReason: finishReason,
        hasTemperature: hasTemperature
      });
      
      return trimmedText;
    }

    // If no text returned, fail without pretending an action happened.
    throw new Error('Empty response from Gemini');

  } catch (error) {
    logWithTimestamp('ERROR', 'Gemini API error', {
      error: error.message,
      errorCode: error.code || 'unknown',
      errorDetails: error.stack
    });
    // Pure LLM approach - if API fails, don't fabricate AC actions.
    return "Sorry—I'm having trouble responding right now. Please try again in a moment.";
  }
}

// API endpoint to process feedback
app.post('/api/feedback', async (req, res) => {
  const requestId = Date.now().toString(36);
  try {
    const { message, acId, history } = req.body;

    // Log incoming request
    logWithTimestamp('REQUEST', `[${requestId}] Incoming feedback request`, {
      acId: acId || 'not provided',
      message: message,
      messageLength: message?.length || 0,
      historyLength: Array.isArray(history) ? history.length : 0,
      ip: req.ip || req.connection.remoteAddress
    });

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      logWithTimestamp('ERROR', `[${requestId}] Validation failed - empty message`);
      return res.status(400).json({ 
        error: 'Message is required and must be a non-empty string' 
      });
    }

    // Generate response using Gemini (include AC context + short chat history for follow-ups)
    const acContext = acId ? `AC ID: ${String(acId).slice(0, 64)}\n` : '';
    const historyLines = Array.isArray(history)
      ? history
          .slice(-10)
          .map((m) => {
            const role = m?.role === 'assistant' ? 'Assistant' : 'User';
            const text = typeof m?.text === 'string' ? m.text : '';
            return `${role}: ${text.replace(/\s+/g, ' ').trim().slice(0, 500)}`;
          })
          .filter(Boolean)
          .join('\n')
      : '';

    const prompt =
      `${acContext}` +
      (historyLines ? `Conversation so far:\n${historyLines}\n\n` : '') +
      `Latest user message: ${message.trim()}`;
    
    logWithTimestamp('INFO', `[${requestId}] Prompt constructed`, {
      promptLength: prompt.length,
      hasHistory: !!historyLines,
      historyMessages: historyLines ? historyLines.split('\n').length : 0
    });

    const response = await generateResponse(prompt, acId);

    // Log successful response
    logWithTimestamp('RESPONSE', `[${requestId}] Response sent to client`, {
      userMessage: message,
      assistantResponse: response,
      acId: acId || 'none'
    });

    res.json({ 
      response: response,
      originalMessage: message
    });

  } catch (error) {
    logWithTimestamp('ERROR', `[${requestId}] Error processing feedback`, {
      error: error.message,
      stack: error.stack,
      userMessage: message || 'unknown'
    });
    res.status(500).json({ 
      error: 'Internal server error while processing feedback' 
    });
  }
});

// Speech-to-text endpoint using Gemini (multimodal)
app.post('/api/speech-to-text', upload.single('audio'), async (req, res) => {
  const requestId = Date.now().toString(36);
  try {
    // Check if audio file is present
    if (!req.file) {
      logWithTimestamp('ERROR', `[${requestId}] Speech-to-text request - no audio file`);
      return res.status(400).json({ 
        error: 'Audio file is required' 
      });
    }

    const audioBuffer = req.file.buffer;
    const mimeType = req.file.mimetype || 'audio/webm';

    logWithTimestamp('REQUEST', `[${requestId}] Speech-to-text request`, {
      audioSize: `${audioBuffer.length} bytes`,
      mimeType: mimeType,
      ip: req.ip || req.connection.remoteAddress
    });

    // Convert buffer to base64 for Gemini
    const base64Audio = audioBuffer.toString('base64');

    // Use Gemini's multimodal capability for transcription
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL_AUDIO });

    const prompt = "Transcribe this audio accurately. Return only the transcribed text, nothing else.";

    logWithTimestamp('INFO', `[${requestId}] Calling Gemini for audio transcription`);

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
      logWithTimestamp('ERROR', `[${requestId}] Empty transcription result`);
      return res.status(500).json({ 
        error: 'Could not transcribe audio. Please try again.' 
      });
    }

    logWithTimestamp('RESPONSE', `[${requestId}] Transcription successful`, {
      transcript: transcript,
      transcriptLength: transcript.length
    });

    res.json({ 
      transcript: transcript,
      success: true
    });

  } catch (error) {
    logWithTimestamp('ERROR', `[${requestId}] Speech-to-text error`, {
      error: error.message,
      errorCode: error.code || 'unknown',
      errorDetails: error.stack,
      isQuotaError: error.message?.includes('429') || error.message?.includes('quota')
    });
    
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
  logWithTimestamp('INFO', 'Health check request', { ip: req.ip || req.connection.remoteAddress });
  res.json({ status: 'ok', message: 'Feedback API is running with Gemini' });
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Feedback backend server running on http://localhost:${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/api/health`);
  console.log(`   Using Google Gemini API (free tier)`);
});