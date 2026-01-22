const mqtt = require('mqtt');
const { MQTT_URL } = require('../config');
const { logWithTimestamp } = require('../middleware/requestLogger');

let client = null;
let connecting = false;

function getClient() {
  if (client && client.connected) return client;
  if (connecting) return null;

  connecting = true;
  client = mqtt.connect(MQTT_URL, {
    reconnectPeriod: 2000,
    connectTimeout: 5000,
  });

  client.on('connect', () => {
    logWithTimestamp('INFO', `MQTT connected: ${MQTT_URL}`);
    connecting = false;
  });
  client.on('error', (err) => {
    logWithTimestamp('ERROR', 'MQTT error', { error: err.message });
    connecting = false;
  });
  client.on('close', () => {
    logWithTimestamp('INFO', 'MQTT connection closed');
    connecting = false;
  });

  return client;
}

// Initialize MQTT client on module load (always enabled)
getClient();

/**
 * Publish command to MQTT topic (macId)
 */
async function publishToTopic(topic, command) {
  const c = getClient();
  if (!c) return { published: false, reason: 'MQTT_NOT_READY' };
  const payload = JSON.stringify(command);
  return await new Promise((resolve) => {
    c.publish(topic, payload, { qos: 0, retain: false }, (err) => {
      if (err) {
        logWithTimestamp('ERROR', 'MQTT publish error', { topic, error: err.message });
        return resolve({ published: false, reason: err.message });
      }
      logWithTimestamp('INFO', 'MQTT published', { topic, command });
      resolve({ published: true, topic, command });
    });
  });
}

module.exports = { publishToTopic };


