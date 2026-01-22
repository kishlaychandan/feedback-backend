function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function extractFirstNumber(text) {
  const m = String(text || '').match(/(-?\d+(?:\.\d+)?)/);
  return m ? toNum(m[1]) : null;
}

/**
 * Very simple rule-based intent + action fallback (no LLM).
 * Output shape matches Gemini structured output.
 */
function classifyIntentAndActionFallback(message) {
  const raw = String(message || '').trim();
  const t = raw.toLowerCase();

  // GET intents
  if (/(humidity|humid)/.test(t)) return { intent: 'GET_HUMIDITY', requiresAction: false };
  if (/(consumption|power\s*consumption|watt|kw|kwh|energy)/.test(t)) return { intent: 'GET_CONSUMPTION', requiresAction: false };
  if (/(run\s*hours|runtime|run\s*time)/.test(t)) return { intent: 'GET_RUN_HOURS', requiresAction: false };
  if (/(set\s*point|setpoint|temperature\s*set|temp\s*set|set\s*temp\s*\?)/.test(t)) return { intent: 'GET_SETPOINT', requiresAction: false };
  if (/(current\s*temp|current\s*temperature|room\s*temp|room\s*temperature|temperature\s*now)/.test(t))
    return { intent: 'GET_ROOM_TEMPERATURE', requiresAction: false };

  // UPDATE intents (FEEDBACK)
  const action = {};

  // Power ON/OFF
  if (/(turn\s*off|switch\s*off|power\s*off|ac\s*off)/.test(t)) action.power = 'OFF';
  if (/(turn\s*on|switch\s*on|power\s*on|ac\s*on)/.test(t)) action.power = 'ON';

  // Absolute setpoint: "set temp to 22"
  if (/(set\s*(?:temp|temperature)\s*(?:to)?\s*-?\d+)/.test(t) || /(setpoint\s*(?:to)?\s*-?\d+)/.test(t)) {
    const n = extractFirstNumber(t);
    if (n !== null) action.setpointC = n;
  }

  // Relative delta: "increase by 2", "+2", "decrease 3"
  if (/(increase|raise|higher)/.test(t)) {
    const n = extractFirstNumber(t);
    action.deltaC = n !== null ? Math.abs(n) : 2;
  } else if (/(decrease|lower|reduce)/.test(t)) {
    const n = extractFirstNumber(t);
    action.deltaC = n !== null ? -Math.abs(n) : -2;
  }

  // "still hot/cold" heuristics
  if (/(still\s*hot|too\s*hot|very\s*hot|feeling\s*hot|hot)/.test(t)) {
    if (!('deltaC' in action) && !('setpointC' in action)) action.deltaC = -2;
    if (!('power' in action)) action.power = 'ON';
  }
  if (/(still\s*cold|too\s*cold|very\s*cold|feeling\s*cold|cold)/.test(t)) {
    if (!('deltaC' in action) && !('setpointC' in action)) action.deltaC = +2;
    if (!('power' in action)) action.power = 'ON';
  }

  // If no action derived, treat as feedback without action
  const hasAction = Object.keys(action).length > 0;
  if (!hasAction) return { intent: 'OTHER', requiresAction: false };

  return { intent: 'FEEDBACK', requiresAction: true, action };
}

/**
 * Rule-based final response fallback (no LLM).
 */
function generateFinalResponseFallback({ message, intent, readData, computed, llmWarning }) {
  const prefix = llmWarning ? `Note: Gemini is limited right now, so I'm using fallback mode.\n` : '';

  if (intent === 'GET_SETPOINT') {
    const sp = readData?.setpointC;
    const p = readData?.power;
    if (sp == null && p == null) return prefix + `I couldn't read the setpoint right now.`;
    if (sp == null) return prefix + `The AC power is ${String(p).toLowerCase()}.`;
    return prefix + `The current setpoint is ${sp}°C${p ? ` and power is ${String(p).toLowerCase()}` : ''}.`;
  }

  if (intent === 'GET_ROOM_TEMPERATURE') {
    const rt = readData?.roomTempC;
    if (rt == null) return prefix + `I couldn't read the room temperature right now.`;
    return prefix + `The current room temperature is ${rt}°C.`;
  }

  if (intent === 'GET_HUMIDITY') {
    const h = readData?.humidityPct;
    if (h == null) return prefix + `I couldn't read humidity right now.`;
    return prefix + `Current humidity is ${h}%.`;
  }

  if (intent === 'GET_CONSUMPTION') {
    const w = readData?.consumptionW;
    if (w == null) return prefix + `I couldn't read power consumption right now.`;
    return prefix + `Current consumption is ${w}W.`;
  }

  if (intent === 'GET_RUN_HOURS') {
    const rh = readData?.runHours;
    if (rh == null) return prefix + `I couldn't read run hours right now.`;
    return prefix + `Total run hours is ${rh}.`;
  }

  if (computed) {
    const nextP = computed?.next?.power;
    const nextS = computed?.next?.setpointC;
    const changed = !!computed?.changed;
    const mqttOk = !!computed?.mqtt?.published;

    if (!changed) {
      if (nextS != null) return prefix + `Already set: ${nextP ? String(nextP).toLowerCase() : 'on'} at ${nextS}°C.`;
      if (nextP) return prefix + `Already ${String(nextP).toLowerCase()}.`;
      return prefix + `No change needed.`;
    }

    if (!mqttOk) {
      return prefix + `I decided the change, but MQTT publish failed. Please check the controller connection.`;
    }

    // success
    if (nextP && nextS != null) return prefix + `Done. ${String(nextP).toLowerCase()} and set to ${nextS}°C.`;
    if (nextP) return prefix + `Done. Turned ${String(nextP).toLowerCase()}.`;
    if (nextS != null) return prefix + `Done. Set to ${nextS}°C.`;
    return prefix + `Done.`;
  }

  // default
  return prefix + `Thanks—I've noted your feedback: "${String(message || '').trim()}".`;
}

module.exports = {
  classifyIntentAndActionFallback,
  generateFinalResponseFallback,
};


