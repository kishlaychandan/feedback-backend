const express = require('express');
const { postFeedback } = require('../controllers/feedback.controller');
const { getDevice, getTelemetry } = require('../controllers/device.controller');
const { getConversations } = require('../controllers/conversation.controller');

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Feedback API is running with Gemini + MongoDB' });
});

router.post('/feedback', postFeedback);
router.get('/conversations', getConversations);

router.get('/devices/:deviceId', getDevice);
router.get('/devices/:deviceId/telemetry', getTelemetry);

module.exports = router;


