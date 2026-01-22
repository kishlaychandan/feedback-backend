const ChatMessage = require('../models/ChatMessage');
const { CHAT_WRITES_ENABLED } = require('../config');
const { logWithTimestamp } = require('../middleware/requestLogger');
const { classifyIntentAndAction, generateFinalResponse } = require('../services/gemini.service');
const { findDeviceByZoneId, getPrimaryPortForDevice, readTelemetry, computeAndMaybeApplyAction } = require('../services/device.service');
const { classifyIntentAndActionFallback, generateFinalResponseFallback } = require('../services/fallback.service');

function normalizeZoneId(zoneId, acId) {
  const raw = (zoneId || acId || '').toString().trim();
  if (!raw) return '';
  return raw.slice(0, 64);
}

function normalizeSessionId(sessionId) {
  const raw = (sessionId || '').toString().trim();
  if (!raw) return '';
  return raw.slice(0, 80);
}

function normalizeMessage(message) {
  if (typeof message !== 'string') return '';
  return message.replace(/\s+/g, ' ').trim().slice(0, 2000);
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .slice(-10)
    .map((m) => {
      const role = m?.role === 'assistant' ? 'assistant' : 'user';
      const text = typeof m?.text === 'string' ? m.text : '';
      return { role, text: text.replace(/\s+/g, ' ').trim().slice(0, 500) };
    })
    .filter((m) => m.text);
}

async function postFeedback(req, res) {
  const requestId = req.requestId || Date.now().toString(36);
  const { message, zoneId, acId, sessionId, history } = req.body || {};

  const deviceId = normalizeZoneId(zoneId, acId);
  const sId = normalizeSessionId(sessionId) || `anon_${(req.ip || 'ip').replace(/[^a-zA-Z0-9]/g, '').slice(0, 20)}`;
  const msg = normalizeMessage(message);

  if (!deviceId) return res.status(400).json({ error: 'zoneId is required' });
  if (!msg) return res.status(400).json({ error: 'message is required' });

  logWithTimestamp('REQUEST', `[${requestId}] Feedback`, { deviceId, sessionId: sId });

  if (CHAT_WRITES_ENABLED) {
    await ChatMessage.create({
      deviceId,
      sessionId: sId,
      role: 'user',
      text: msg,
      requestId,
    });
  }

  // Build prompt with history context
  const normalizedHistory = normalizeHistory(history);
  const historyText = normalizedHistory
    .map((m) => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.text}`)
    .join('\n');

  const prompt = `Zone ID: ${deviceId}\n` +
    (historyText ? `Conversation so far:\n${historyText}\n\n` : '') +
    `Latest user message: ${msg}`;

  const llm = {
    ok: true,
    usedFallback: false,
    reason: null,
    message: null,
  };

  let structured;
  try {
    structured = await classifyIntentAndAction(prompt, deviceId);
  } catch (err) {
    // Fallback to rules, but still report Gemini error
    llm.ok = false;
    llm.usedFallback = true;
    llm.reason = err?.status === 429 ? 'RATE_LIMIT' : (err?.status === 504 ? 'TIMEOUT' : 'ERROR');
    llm.message =
      err?.status === 429
        ? 'Gemini rate limit reached (429). Using fallback rules.'
        : (err?.status === 504 || err?.message === 'LLM_TIMEOUT')
          ? 'Gemini timed out (504). Using fallback rules.'
          : 'Gemini error. Using fallback rules.';

    logWithTimestamp('ERROR', `[${requestId}] LLM intent classification failed - using fallback`, {
      error: err.message,
      status: err?.status,
      zoneId: deviceId,
    });

    structured = classifyIntentAndActionFallback(msg);
  }
  const intent = structured?.intent || 'FEEDBACK';
  const requiresAction = !!structured?.requiresAction;
  const action = structured?.action && typeof structured.action === 'object' ? structured.action : null;

  logWithTimestamp('INFO', `[${requestId}] Intent classified`, { intent, requiresAction, action });

  // Step 1: Read current state from DB
  const resolved = await findDeviceByZoneId(deviceId);
  const device = resolved.device;
  const macId = resolved.macId;
  
  if (!device) {
    return res.status(404).json({
      error: `Device not found for zoneId: ${deviceId}`,
      zoneId: deviceId,
      sessionId: sId,
    });
  }

  const port = await getPrimaryPortForDevice(device);
  if (!port) {
    return res.status(404).json({
      error: `Port not found for device: ${deviceId}`,
      zoneId: deviceId,
      sessionId: sId,
    });
  }

  const currentTelemetry = readTelemetry(deviceId, device, port);
  
  logWithTimestamp('DATA', `[${requestId}] DB read (current state)`, {
    deviceId,
    macId,
    device: device ? { _id: device._id, deviceId: device.deviceId, macId: device.macId, online: device.online, lp: device.lp } : null,
    port: port ? { _id: port._id, ac_temp: port.ac_temp, val: port.val, roomTemp: port.roomTemp } : null,
    currentTelemetry,
  });

  // Step 2: Based on intent classification, perform action
  let readData = null;
  let computed = null;

  // GET intents: Return data from DB
  if (intent === 'GET_SETPOINT') {
    readData = { power: currentTelemetry.power, setpointC: currentTelemetry.setpointC, lastUpdateAt: currentTelemetry.lastUpdateAt };
    logWithTimestamp('DATA', `[${requestId}] GET_SETPOINT - returning data`, readData);
  } else if (intent === 'GET_ROOM_TEMPERATURE') {
    readData = { roomTempC: currentTelemetry.roomTempC, lastUpdateAt: currentTelemetry.lastUpdateAt };
    logWithTimestamp('DATA', `[${requestId}] GET_ROOM_TEMPERATURE - returning data`, readData);
  } else if (intent === 'GET_HUMIDITY') {
    readData = { humidityPct: currentTelemetry.humidityPct, lastUpdateAt: currentTelemetry.lastUpdateAt };
    logWithTimestamp('DATA', `[${requestId}] GET_HUMIDITY - returning data`, readData);
  } else if (intent === 'GET_CONSUMPTION') {
    readData = { consumptionW: currentTelemetry.consumptionW, lastUpdateAt: currentTelemetry.lastUpdateAt };
    logWithTimestamp('DATA', `[${requestId}] GET_CONSUMPTION - returning data`, readData);
  } else if (intent === 'GET_RUN_HOURS') {
    readData = { runHours: currentTelemetry.runHours, lastUpdateAt: currentTelemetry.lastUpdateAt };
    logWithTimestamp('DATA', `[${requestId}] GET_RUN_HOURS - returning data`, readData);
  } 
  // UPDATE/FEEDBACK intents: Compare DB state with desired, publish MQTT if change needed
  else if (requiresAction && action) {
    try {
      computed = await computeAndMaybeApplyAction(deviceId, action, device, port, macId);
      logWithTimestamp('DATA', `[${requestId}] UPDATE action - compared and published`, {
        current: computed.current,
        next: computed.next,
        mqttPublished: computed.mqtt?.published || false,
        changed: computed.changed,
        validation: computed.validation,
      });
    } catch (err) {
      logWithTimestamp('ERROR', `[${requestId}] Action computation failed`, {
        error: err.message,
        deviceId,
        action,
      });
      return res.status(400).json({
        error: err.message || 'Failed to compute action',
        zoneId: deviceId,
        sessionId: sId,
      });
    }
  }

  // Build response context with state change information
  let stateChangeInfo = '';
  if (computed) {
    if (!computed.changed) {
      stateChangeInfo = `\nIMPORTANT: The desired state already matches the current state. Inform the user that it's already set correctly (e.g., "The AC is already set to ${computed.next.setpointC}°C" or "The AC is already ${computed.next.power.toLowerCase()}").`;
    } else {
      stateChangeInfo = `\nState changed: ${JSON.stringify(computed.changes)}. MQTT published: ${computed.mqtt?.published || false}.`;
    }
    if (computed.validation?.clamped) {
      stateChangeInfo += `\nNote: Action values were clamped to safe ranges (16-30°C).`;
    }
  }

  const responseContext =
    `Zone ID: ${deviceId}\n` +
    `User message: ${message.trim()}\n` +
    `Intent: ${intent}\n` +
    `requiresAction: ${requiresAction}\n` +
    (action ? `Action decided: ${JSON.stringify(action)}\n` : '') +
    (readData ? `Read data: ${JSON.stringify(readData)}\n` : '') +
    (computed ? `Computed change: ${JSON.stringify(computed)}\n` : '') +
    stateChangeInfo +
    `\nReply to the user now.`;

  let responseText;
  // If we already fell back due to LLM classification failure, do not call LLM again.
  if (llm.usedFallback) {
    responseText = generateFinalResponseFallback({ message: msg, intent, readData, computed, llmWarning: true });
  } else {
    try {
      responseText = await generateFinalResponse(responseContext, deviceId);
    } catch (err) {
      // Fallback to rules, but still report Gemini error
      llm.ok = false;
      llm.usedFallback = true;
      llm.reason = err?.status === 429 ? 'RATE_LIMIT' : (err?.status === 504 ? 'TIMEOUT' : 'ERROR');
      llm.message =
        err?.status === 429
          ? 'Gemini rate limit reached (429). Using fallback response.'
          : (err?.status === 504 || err?.message === 'LLM_TIMEOUT')
            ? 'Gemini timed out (504). Using fallback response.'
            : 'Gemini error. Using fallback response.';

      logWithTimestamp('ERROR', `[${requestId}] LLM response generation failed - using fallback`, {
        error: err.message,
        status: err?.status,
        zoneId: deviceId,
      });

      responseText = generateFinalResponseFallback({ message: msg, intent, readData, computed, llmWarning: true });
    }
  }

  if (CHAT_WRITES_ENABLED) {
    await ChatMessage.create({
      deviceId,
      sessionId: sId,
      role: 'assistant',
      text: responseText.slice(0, 4000),
      requestId,
      intent,
      requiresAction,
      action,
    });
  }

  res.json({
    response: responseText,
    originalMessage: message,
    zoneId: deviceId,
    sessionId: sId,
    macId,
    intent,
    requiresAction,
    action,
    readData,
    computed,
    chatStored: CHAT_WRITES_ENABLED,
    llm,
  });
}

module.exports = { postFeedback };


