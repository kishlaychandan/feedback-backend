function boolEnv(name, defaultValue = false) {
  const v = String(process.env[name] || '').toLowerCase();
  if (!v) return defaultValue;
  return v === 'true' || v === '1' || v === 'yes';
}

module.exports = {
  PORT: Number(process.env.PORT || 3001),
  // MongoDB (use FEEDBACK_MONGO_URI to avoid conflicts with other projects)
  FEEDBACK_MONGO_URI: process.env.FEEDBACK_MONGO_URI || 'mongodb://127.0.0.1:27017/lightson_dev',
  // DB_WRITES_ENABLED: ONLY controls device/port writes (later via MQTT or direct DB writes).
  DB_WRITES_ENABLED: boolEnv('DB_WRITES_ENABLED', false),
  // Chat history writes enabled by default for dev.
  CHAT_WRITES_ENABLED: boolEnv('CHAT_WRITES_ENABLED', true),
  // MQTT is ALWAYS enabled for this project.
  MQTT_URL: process.env.MQTT_URL || 'mqtt://127.0.0.1:1883',
  MQTT_TOPIC_PREFIX: process.env.MQTT_TOPIC_PREFIX || 'lt-feedback',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_MODEL_TEXT: process.env.GEMINI_MODEL_TEXT || 'gemini-2.5-flash',
};


