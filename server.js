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

// System prompt for natural, conversational responses
const SYSTEM_PROMPT = `You are a polite and professional feedback management assistant that understands user commands and responds naturally.

Your responsibilities:
- Understand user feedback, commands, and requests
- Detect intent (comfort, health, AC control, temperature, etc.)
- Respond naturally and conversationally, not with pre-written templates
- Handle AC commands naturally: "increase temperature", "decrease temperature", "turn on AC", "turn off AC", "set temperature to X"
- Respond empathetically and professionally
- Do NOT mention technical details
- Do NOT ask unnecessary follow-up questions
- Acknowledge the feedback and confirm action has been taken

Examples of natural responses:
- User: "increase temperature" → "I've increased the temperature for you. It should feel more comfortable shortly."
- User: "turn on AC" → "The AC has been turned on. You should start feeling cooler soon."
- User: "set temperature to 25" → "I've set the temperature to 25 degrees. The room will adjust accordingly."
- User: "I'm feeling cold" → "I understand. I've adjusted the temperature to make it warmer for you."
- User: "it's too hot" → "I've lowered the temperature to help you feel more comfortable."
- User: "reduce temperature" → "I've reduced the temperature. It should be more comfortable now."
- User: "switch off AC" → "The AC has been switched off as requested."
- User: "I am not feeling well" → "I'm sorry to hear that. Your feedback has been noted, and support is available if you need anything."

Keep responses short, natural, and conversational.`;

// Helper function to generate response using Gemini
async function generateResponse(userMessage) {
  try {
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL_TEXT });

    const prompt = `${SYSTEM_PROMPT}\n\nUser: ${userMessage}\n\nAssistant:`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    if (text && text.trim().length > 0) {
      return text.trim();
    }

    // Fallback if Gemini doesn't return text
    return generateFallbackResponse(userMessage);

  } catch (error) {
    console.error('Gemini API error:', error.message);
    // Fallback to rule-based responses
    return generateFallbackResponse(userMessage);
  }
}

// Fallback rule-based response generator
function generateFallbackResponse(userMessage) {
  const message = userMessage.toLowerCase();
  
  // AC control commands
  if (message.includes('increase') && (message.includes('temp') || message.includes('temperature'))) {
    return "I've increased the temperature for you. It should feel more comfortable shortly.";
  }
  
  if (message.includes('decrease') || message.includes('reduce') || message.includes('lower')) {
    if (message.includes('temp') || message.includes('temperature')) {
      return "I've reduced the temperature. It should be more comfortable now.";
    }
  }
  
  if (message.includes('turn on') || message.includes('switch on') || message.includes('on ac')) {
    return "The AC has been turned on. You should start feeling cooler soon.";
  }
  
  if (message.includes('turn off') || message.includes('switch off') || message.includes('off ac')) {
    return "The AC has been switched off as requested.";
  }
  
  if (message.includes('set temperature') || message.includes('set temp')) {
    const tempMatch = message.match(/\d+/);
    if (tempMatch) {
      return `I've set the temperature to ${tempMatch[0]} degrees. The room will adjust accordingly.`;
    }
    return "I've adjusted the temperature as requested.";
  }
  
  // Health-related feedback
  if (message.includes('not feeling well') || message.includes('sick') || 
      message.includes('ill') || message.includes('unwell') || message.includes('feeling bad')) {
    return "I'm sorry to hear that. Your feedback has been noted, and support is available if you need anything.";
  }
  
  // Cold-related feedback
  if (message.includes('cold') || message.includes('freezing') || message.includes('chilly')) {
    return "I understand. I've adjusted the temperature to make it warmer for you.";
  }
  
  // Hot-related feedback
  if (message.includes('hot') || message.includes('warm') || message.includes('too warm')) {
    return "I've lowered the temperature to help you feel more comfortable.";
  }
  
  // Discomfort/complaint
  if (message.includes('uncomfortable') || message.includes('discomfort') || 
      message.includes('complaint') || message.includes('problem')) {
    return "I understand your concern. Your feedback has been recorded and we're working to address it.";
  }
  
  // Positive feedback
  if (message.includes('fine') || message.includes('good') || message.includes('okay') || 
      message.includes('ok') || message.includes('great') || message.includes('satisfied')) {
    return "That's great to hear! Thank you for sharing your feedback.";
  }
  
  // Default empathetic response
  return "Okay, I understand your concern. I've noted your feedback and appropriate action has been taken. Please let me know if you need anything else.";
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
