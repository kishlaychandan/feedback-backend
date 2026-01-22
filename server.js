require('dotenv').config();
const { connectToMongo } = require('./db');
const { createApp } = require('./app');
const { PORT, DB_WRITES_ENABLED, GEMINI_MODEL_TEXT, MQTT_URL, CHAT_WRITES_ENABLED } = require('./config');
// Initialize MQTT (always enabled)
require('./services/mqtt.service');

async function start() {
  await connectToMongo();
  const app = createApp();
  // Listen on all interfaces (0.0.0.0) - required for Docker/Kubernetes
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Feedback backend server running on port ${PORT} (listening on all interfaces)`);
    console.log(`   Health check: http://localhost:${PORT}/api/health`);
    console.log(`   Gemini model: ${GEMINI_MODEL_TEXT}`);
    console.log(`   DB_WRITES_ENABLED: ${DB_WRITES_ENABLED}`);
    console.log(`   CHAT_WRITES_ENABLED: ${CHAT_WRITES_ENABLED}`);
    console.log(`   MQTT: enabled (${MQTT_URL})`);
  });
}

start().catch((err) => {
  console.error('❌ Failed to start server:', err.message);
  process.exit(1);
});


