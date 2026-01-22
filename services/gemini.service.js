const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GEMINI_API_KEY, GEMINI_MODEL_TEXT } = require('../config');
const { logWithTimestamp } = require('../middleware/requestLogger');

// NOTE: Do not crash the entire server if GEMINI_API_KEY is missing.
// In that case, controllers will fall back to rule-based logic.
const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

function ensureGeminiConfigured() {
  if (!genAI) {
    const err = new Error('GEMINI_API_KEY_MISSING');
    err.status = 503;
    throw err;
  }
}

/**
 * Classify user intent and extract action (power, setpoint, deltaC)
 */
async function classifyIntentAndAction(prompt, zoneId = null) {
  ensureGeminiConfigured();
  const STRUCTURED_SYSTEM = `You are Living Things Cooling Management Feedback Assistant.
Return ONLY strict JSON (no markdown, no extra text).

Return shape:
{"intent":"FEEDBACK","requiresAction":true,"action":{"power":"ON","setpointC":22,"deltaC":-2}}

Rules:
- intent: ["GET_SETPOINT","GET_ROOM_TEMPERATURE","GET_HUMIDITY","GET_CONSUMPTION","GET_RUN_HOURS","FEEDBACK","OTHER"]
- requiresAction: true/false
- action only when requiresAction=true; may include power ("ON"/"OFF"), setpointC (number), deltaC (number)
- increase/decrease without number -> deltaC +/-2
- still hot/cold -> deltaC (-2 hot, +2 cold)

Examples (follow them exactly):
- "current temperature" -> {"intent":"GET_ROOM_TEMPERATURE","requiresAction":false}
- "humidity?" -> {"intent":"GET_HUMIDITY","requiresAction":false}
- "setpoint?" -> {"intent":"GET_SETPOINT","requiresAction":false}
- "power consumption" -> {"intent":"GET_CONSUMPTION","requiresAction":false}
- "run hours" -> {"intent":"GET_RUN_HOURS","requiresAction":false}
- "too hot" -> {"intent":"FEEDBACK","requiresAction":true,"action":{"power":"ON","setpointC":22}}
- "still hot" -> {"intent":"FEEDBACK","requiresAction":true,"action":{"deltaC":-2}}
- "too cold" -> {"intent":"FEEDBACK","requiresAction":true,"action":{"power":"OFF","setpointC":26}}
- "increase temperature" -> {"intent":"FEEDBACK","requiresAction":true,"action":{"deltaC":+2}}
`;

  logWithTimestamp('INFO', 'Calling Gemini API (intent)', {
    model: GEMINI_MODEL_TEXT,
    zoneId: zoneId || 'none',
    promptLength: prompt.length,
  });

  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL_TEXT,
    systemInstruction: STRUCTURED_SYSTEM,
    generationConfig: {
      temperature: 0.2,
      topP: 0.9,
      maxOutputTokens: 140,
      responseMimeType: 'application/json',
    },
  });

  try {
    // Add timeout: 15 seconds
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('LLM_TIMEOUT')), 15000);
    });

    const result = await Promise.race([
      model.generateContent(prompt),
      timeoutPromise
    ]);

    const response = await result.response;
    const raw = (response.text() || '').trim();

    try {
      return JSON.parse(raw);
    } catch (e) {
      logWithTimestamp('ERROR', 'Intent JSON parse failed', {
        zoneId: zoneId || 'none',
        error: e.message,
        raw: raw.slice(0, 400),
      });
      return { intent: 'FEEDBACK', requiresAction: true, action: { deltaC: -2 } };
    }
  } catch (err) {
    const isTimeout = err.message === 'LLM_TIMEOUT';
    logWithTimestamp('ERROR', 'Gemini API error (intent)', {
      zoneId: zoneId || 'none',
      error: err.message,
      status: err.status || err.statusCode,
      code: err.code,
      timeout: isTimeout,
    });
    
    // Add timeout status for better error handling
    if (isTimeout) {
      err.status = 504; // Gateway Timeout
    }
    throw err;
  }
}

async function generateFinalResponse(contextPrompt, zoneId = null) {
  ensureGeminiConfigured();
  const FINAL_SYSTEM = `You are Living Things Cooling Management Feedback Assistant.
Write 1–2 short sentences, natural and helpful, in the user's language.
If the answer involves temperature or setpoint, ALWAYS include °C (e.g., 24°C) and finish the sentence.
Do NOT output JSON.`;

  function sanitizeFinalText(text) {
    const t = String(text || '').trim();
    if (!t) return '';
    // If Gemini ends without terminal punctuation, don't treat it as failure.
    // For demo stability we gently finish the sentence.
    if (!/[.!?]$/.test(t)) return `${t}.`;
    return t;
  }

  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL_TEXT,
    systemInstruction: FINAL_SYSTEM,
    generationConfig: {
      temperature: 0.5,
      topP: 0.95,
      // Slightly higher budget to reduce truncations in demo.
      maxOutputTokens: 180,
    },
  });

  try {
    // Add timeout: 15 seconds
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('LLM_TIMEOUT')), 15000);
    });

    const result = await Promise.race([
      model.generateContent(contextPrompt),
      timeoutPromise
    ]);

    const response = await result.response;
    const raw = response.text() || '';
    const text = sanitizeFinalText(raw);

    // Only fail if Gemini returns empty/whitespace.
    if (!text) {
      const err = new Error('LLM_EMPTY');
      err.status = 502;
      throw err;
    }

    return text;
  } catch (err) {
    const isTimeout = err.message === 'LLM_TIMEOUT';
    logWithTimestamp('ERROR', 'Gemini API error (final response)', {
      zoneId: zoneId || 'none',
      error: err.message,
      status: err.status || err.statusCode,
      code: err.code,
      timeout: isTimeout,
    });
    
    if (isTimeout) {
      err.status = 504; // Gateway Timeout
    }
    throw err;
  }
}

module.exports = {
  classifyIntentAndAction,
  generateFinalResponse,
};


