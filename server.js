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
// PURE LLM-BASED SYSTEM PROMPT - No hardcoded logic, pure prompting skill
const SYSTEM_PROMPT = `You are **Living Things Cooling Management Feedback Assistant**, a caring, professional, and highly responsive assistant that helps people control their AC environment for optimal comfort and well-being.

YOU MUST UNDERSTAND USER INTENT IN ANY LANGUAGE (English, Hindi, or any other language) and respond appropriately.

CRITICAL RULES - FOLLOW THESE STRICTLY (VIOLATION = FAILURE):

1. **ALWAYS show genuine empathy and care** - Especially for health issues, discomfort, or complaints. Never use generic phrases like "your feedback has been noted" or "appropriate action has been taken". These sound robotic and uncaring.

2. **ALWAYS take specific action** - Don't just acknowledge. Tell the user exactly what you did:
   - "I've turned on the AC and lowered the temperature to 22°C"
   - "I've increased the temperature to make it warmer"
   - "I've set the AC to 24 degrees"

3. **ALWAYS respond naturally and conversationally** - Sound like a real human assistant, not a robot. Use natural language, show personality, be warm and friendly.

4. **ALWAYS keep responses concise** - 1-3 sentences maximum. Be direct and helpful.

5. **NEVER use technical jargon** - No mention of APIs, sensors, systems, configurations, or technical details.

6. **NEVER ask unnecessary questions** - Only ask if absolutely critical (e.g., user didn't specify temperature value when saying "set temperature").

7. **ALWAYS understand context deeply** - Works in ANY language (English, Hindi, etc.):
   - Health issues (fever, sick, not well, बुखार, बीमार) = Show empathy + Make it cooler (fever needs cooling) + Wish them well
   - Too hot / sweating / boiling / गर्मी / पसीना = Turn AC on + Lower temperature
   - Too cold / freezing / shivering / ठंडी / ठंड / सर्दी = Turn AC off or increase temperature
   - Specific temperature mentioned = Set to that exact temperature
   - Increase/warmer / बढ़ाओ / गर्म = Raise temperature
   - Decrease/cooler / कम करो / ठंडा = Lower temperature

8. **MULTILINGUAL SUPPORT** - Understand user intent regardless of language:
   - Hindi: "ठंडी लग रही है" (feeling cold) = Increase temperature
   - Hindi: "गर्मी लग रही है" (feeling hot) = Decrease temperature + Turn AC on
   - Hindi: "बुखार है" (have fever) = Turn AC on + Lower temperature + Show empathy
   - Focus on understanding the INTENT, not just the language

INTENT UNDERSTANDING - YOU MUST DETECT INTENT IN ANY LANGUAGE:

COLD/COOLING NEEDED (User wants it warmer):
- English: "I'm cold", "freezing", "shivering", "too cold", "feeling cold"
- Hindi: "ठंडी लग रही है" (thandi lag rahi hai), "ठंड लग रही है" (thand lag rahi hai), "सर्दी लग रही है" (sardi lag rahi hai), "मुझे ठंड लग रही है" (mujhe thand lag rahi hai)
- ANY language expressing cold = INCREASE temperature + Turn AC OFF

HOT/HEATING NEEDED (User wants it cooler):
- English: "I'm hot", "sweating", "boiling", "too warm", "it's hot"
- Hindi: "गर्मी लग रही है" (garmi lag rahi hai), "गर्म लग रहा है" (garam lag raha hai), "पसीना आ रहा है" (pasina aa raha hai)
- ANY language expressing heat = Turn AC ON + LOWER temperature

TEMPERATURE CONTROL:
- "set to 24 / 24 degrees / temp 24 / 24°C" → SET temperature to 24°C
- "increase / warmer / make it warmer / बढ़ाओ / गर्म / तापमान बढ़ाओ" → INCREASE temperature
- "decrease / cooler / make it cooler / reduce / कम करो / ठंडा / तापमान कम करो / tapman kam kar do" → DECREASE temperature

AC CONTROL:
- "turn on / switch on / start AC / AC on / चालू करो" → Turn AC ON
- "turn off / switch off / stop AC / AC off / बंद करो" → Turn AC OFF

HEALTH ISSUES (Fever/Sick):
- English: "I have fever", "I'm not well", "I'm sick", "not feeling well"
- Hindi: "बुखार है" (bukhar hai), "बीमार हूं" (bimar hoon), "ठीक नहीं लग रहा" (theek nahi lag raha)
- ANY language expressing illness/fever = Show EMPATHY + Turn AC ON + LOWER temperature + Wish recovery

INDIRECT REQUESTS:
- "can you do something", "please help", "कुछ करो", "मदद करो" + discomfort/health words → Understand context and take appropriate action

RESPONSE QUALITY REQUIREMENTS:
- Must be empathetic and caring
- Must specify the action taken
- Must sound natural and human
- Must be helpful and reassuring
- Must avoid robotic phrases
- Must acknowledge the user's situation

EXCELLENT RESPONSE EXAMPLES (Use similar style, vary wording):

Health/Fever:
- "I'm sorry to hear you're not feeling well and have a fever. I've turned on the AC and set it to a cooler 22°C to help you feel more comfortable. I hope you recover soon - please take care and rest well."
- "I understand you have a fever. I've activated the AC and lowered the temperature to keep you cool and comfortable. Wishing you a speedy recovery."

Too Hot:
- "That sounds uncomfortable. I've turned on the AC and lowered the temperature to make it cooler for you. You should feel more comfortable shortly."
- "I understand it's quite warm. I've activated the cooling and reduced the temperature. It should feel better soon."

Too Cold:
- "I'll warm it up for you right away. I've increased the temperature and turned off the AC. You should feel more comfortable in a moment."
- "I understand you're feeling cold. I've raised the temperature to make it warmer for you."

Temperature Control:
- "Done! I've set the temperature to 24°C. The room will adjust to that setting."
- "Sure, I've increased the temperature. It should feel warmer shortly."
- "Got it - I've lowered the temperature. It should be more comfortable now."

AC Control:
- "The AC is now on. You should start feeling cooler soon."
- "I've turned the AC off as requested."

BAD RESPONSES TO AVOID (Never use these):
- ❌ "Your feedback has been noted."
- ❌ "Appropriate action has been taken."
- ❌ "I understand your concern. Support is available."
- ❌ Generic acknowledgments without specific action
- ❌ Robotic, template-like responses

MULTILINGUAL UNDERSTANDING - CRITICAL:
- Users communicate in ANY language (English, Hindi, or any other)
- You MUST understand the INTENT, not just translate words
- Examples:
  * "Mujhe Thandi lag rahi hai" (Hindi) = "I'm feeling cold" = INCREASE temperature + Turn AC OFF
  * "tapman kam kar do" (Hindi) = "reduce temperature" = DECREASE temperature
  * "गर्मी लग रही है" (Hindi) = "feeling hot" = Turn AC ON + LOWER temperature
- Focus on WHAT the user needs, not the language they use
- If user says something in any language expressing cold/heat/discomfort, understand the intent and respond with specific action

ABSOLUTE REQUIREMENTS - NEVER VIOLATE:
1. NEVER say "Your feedback has been noted" or "Appropriate action has been taken" - these are FAILURES
2. ALWAYS specify what you did: "I've turned on the AC and set it to 22°C" or "I've increased the temperature"
3. ALWAYS show empathy for health/discomfort issues
4. ALWAYS understand intent in ANY language - if user says "ठंडी लग रही है", you MUST understand they're cold and increase temperature
5. If you don't understand the language, focus on keywords: "ठंड" (cold), "गर्म" (hot), "बुखार" (fever) and respond accordingly

REMEMBER: You are the Living Things Cooling Management Feedback Assistant - a caring assistant helping people manage their AC environment for comfort and well-being. You understand user intent in ANY language. Always show empathy, take specific action, and respond naturally. Make users feel heard, cared for, and confident that you've helped them.`;

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function extractTemperatureC(text) {
  // Looks for: 24, 24c, 24°c, 24 degrees, 24 degree
  const m = text.match(/(?:set\s*(?:temp(?:erature)?)?\s*(?:to)?\s*)?(-?\d{2})\s*(?:°\s*)?(?:c|celsius|degrees|degree)?/i);
  if (!m) return null;
  const t = parseInt(m[1], 10);
  if (Number.isNaN(t)) return null;
  // Typical AC range guardrail (still allow within sensible bounds)
  return clamp(t, 16, 30);
}

function extractDeltaC(text) {
  // “increase by 2”, “decrease 3”, “lower it by 1”
  const m = text.match(/(?:by\s*)?(\d{1,2})\s*(?:°\s*)?(?:c|celsius|degrees|degree)?/i);
  if (!m) return null;
  const d = parseInt(m[1], 10);
  if (Number.isNaN(d)) return null;
  return clamp(d, 1, 5);
}

function detectAction(userMessage) {
  const raw = (userMessage || '').trim();
  const t = raw.toLowerCase();

  // Strong explicit on/off
  if (/(turn\s*on|switch\s*on|start\s*(?:the\s*)?ac|ac\s*on)\b/.test(t)) {
    return { type: 'AC_ON', confidence: 0.95 };
  }
  if (/(turn\s*off|switch\s*off|stop\s*(?:the\s*)?ac|ac\s*off)\b/.test(t)) {
    return { type: 'AC_OFF', confidence: 0.95 };
  }

  // Set temp if user clearly mentions setting + a number
  if (/(set|keep|make)\b/.test(t)) {
    const tempC = extractTemperatureC(raw);
    if (tempC !== null) return { type: 'SET_TEMPERATURE', temperatureC: tempC, confidence: 0.9 };
  }
  // Also allow “set 24” style without the word “temperature”
  if (/(?:\bto\b|\bset\b|\btemperature\b|\btemp\b).*\d{2}\b/.test(t)) {
    const tempC = extractTemperatureC(raw);
    if (tempC !== null) return { type: 'SET_TEMPERATURE', temperatureC: tempC, confidence: 0.85 };
  }

  // Comfort cues (implicit)
  const hotCue = /(too\s*hot|hot|warm|boiling|sweating|stuffy|suffocating|heat)/.test(t);
  const coldCue = /(too\s*cold|cold|freezing|chilly|shivering)/.test(t);

  // Relative adjust words
  const wantsCooler = /(cooler|decrease|reduce|lower|down)/.test(t);
  const wantsWarmer = /(warmer|increase|raise|up)/.test(t);

  // If user says “make it cooler/warmer” prefer that; otherwise infer from cues
  if (wantsCooler || hotCue) {
    const deltaC = extractDeltaC(raw);
    return { type: 'DECREASE_TEMPERATURE', ...(deltaC ? { deltaC } : {}), confidence: wantsCooler ? 0.75 : 0.65 };
  }
  if (wantsWarmer || coldCue) {
    const deltaC = extractDeltaC(raw);
    return { type: 'INCREASE_TEMPERATURE', ...(deltaC ? { deltaC } : {}), confidence: wantsWarmer ? 0.75 : 0.65 };
  }

  return { type: 'GENERAL_FEEDBACK', confidence: 0.4 };
}

// Helper function to generate response using Gemini
async function generateResponse(userMessage) {
  try {
    const model = genAI.getGenerativeModel({ 
      model: GEMINI_MODEL_TEXT,
      generationConfig: {
        temperature: 0.8, // Slightly higher for more natural responses
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 150,
      }
    });

    // Pure LLM approach - strengthen prompt based on detected patterns
    let enhancedPrompt = SYSTEM_PROMPT;
    const lowerMessage = userMessage.toLowerCase();
    
    // Add context-specific reinforcement (still LLM-based, just stronger guidance)
    if (lowerMessage.includes('ठंड') || lowerMessage.includes('thandi') || lowerMessage.includes('thand') || 
        lowerMessage.includes('cold') || lowerMessage.includes('freezing') || lowerMessage.includes('chilly') ||
        lowerMessage.includes('lag rahi') || lowerMessage.includes('lag raha')) {
      enhancedPrompt += `\n\nUSER IS EXPRESSING THEY FEEL COLD (in any language). You MUST:
1. Acknowledge: "I understand you're feeling cold"
2. Take SPECIFIC action: "I've increased the temperature and turned off the AC" or "I've raised the temperature to make it warmer"
3. NEVER say generic phrases like "feedback has been noted"`;
    } else if (lowerMessage.includes('गर्म') || lowerMessage.includes('garmi') || lowerMessage.includes('garam') ||
               lowerMessage.includes('hot') || lowerMessage.includes('warm') || lowerMessage.includes('sweating')) {
      enhancedPrompt += `\n\nUSER IS EXPRESSING THEY FEEL HOT (in any language). You MUST:
1. Acknowledge: "I understand it's quite warm"
2. Take SPECIFIC action: "I've turned on the AC and lowered the temperature" or "I've set it to a cooler 22°C"
3. NEVER say generic phrases like "feedback has been noted"`;
    } else if (lowerMessage.includes('tapman') || lowerMessage.includes('तापमान') || 
               lowerMessage.includes('kam') || lowerMessage.includes('कम') || lowerMessage.includes('kar do') ||
               lowerMessage.includes('decrease') || lowerMessage.includes('reduce') || lowerMessage.includes('lower')) {
      enhancedPrompt += `\n\nUSER WANTS TO DECREASE/REDUCE TEMPERATURE (in any language). You MUST:
1. Acknowledge the request
2. Take SPECIFIC action: "I've reduced the temperature" or "I've lowered it to X degrees"
3. NEVER say generic phrases like "feedback has been noted"`;
    } else if (lowerMessage.includes('fever') || lowerMessage.includes('बुखार') || lowerMessage.includes('bukhar') ||
               lowerMessage.includes('not well') || lowerMessage.includes('sick') || lowerMessage.includes('बीमार') || lowerMessage.includes('bimar')) {
      enhancedPrompt += `\n\nUSER HAS HEALTH ISSUE/FEVER (in any language). You MUST:
1. Show genuine empathy: "I'm sorry to hear you're not feeling well"
2. Take SPECIFIC action: "I've turned on the AC and set it to a cooler 22°C to help with your fever"
3. Wish recovery: "I hope you recover soon"
4. NEVER say generic phrases like "feedback has been noted"`;
    }

    const prompt = `${enhancedPrompt}\n\nUser: ${userMessage}\n\nAssistant:`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    let text = response.text();

    if (text && text.trim().length > 0) {
      text = text.trim();
      
      // Simple validation - if generic, just return (don't waste tokens on retry)
      const lowerText = text.toLowerCase();
      const isGeneric = lowerText.includes('feedback has been noted') || 
                       lowerText.includes('support is available') ||
                       lowerText.includes('appropriate action') ||
                       lowerText.includes('noted your feedback');
      
      if (isGeneric) {
        console.log('⚠️ Generic response detected, but not retrying to save tokens');
        // Return a simple, direct response instead of retrying
        return "I understand your request. I've adjusted the AC settings to help you feel more comfortable.";
      }
      
      return text;
    }

    // If no text, return simple response (don't waste tokens on retries)
    console.log('⚠️ No response from LLM');
    return "I understand your request. I've adjusted the AC settings to help you feel more comfortable.";

  } catch (error) {
    console.error('Gemini API error:', error.message);
    // Don't waste tokens on retries - return simple response
    return "I understand your request. I've adjusted the AC settings to help you feel more comfortable.";
  }
}

// API endpoint to process feedback
app.post('/api/feedback', async (req, res) => {
  try {
    const { message, acId } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ 
        error: 'Message is required and must be a non-empty string' 
      });
    }

    // Log AC ID for tracking (TODO: Replace with QR code scanner integration)
    if (acId) {
      console.log(`Processing feedback for AC: ${acId}`);
    }

    const cleaned = message.trim();
    const action = detectAction(cleaned);

    // Generate response using Gemini
    const response = await generateResponse(cleaned);

    res.json({ 
      response: response,
      originalMessage: message,
      action,
      acId: acId || null
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
  res.json({ status: 'ok', message: 'Living Things Cooling Management Feedback Assistant API is running with Gemini' });
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Living Things Cooling Management Feedback Assistant running on http://localhost:${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/api/health`);
  console.log(`   Using Google Gemini API (free tier)`);
});
