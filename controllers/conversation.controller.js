const ChatMessage = require('../models/ChatMessage');
const { logWithTimestamp } = require('../middleware/requestLogger');

function normalizeId(v, max = 80) {
  const raw = (v || '').toString().trim();
  if (!raw) return '';
  return raw.slice(0, max);
}

async function getConversations(req, res) {
  const deviceId = normalizeId(req.query.zoneId || req.query.acId, 64);
  const sessionId = normalizeId(req.query.sessionId, 80);
  const limit = Math.min(Number(req.query.limit || 50), 200);

  if (!deviceId) return res.status(400).json({ error: 'zoneId is required' });
  if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

  const events = await ChatMessage.find({ deviceId, sessionId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  logWithTimestamp('DATA', `[${req.requestId || 'noid'}] Conversations fetched`, {
    deviceId,
    sessionId,
    count: events.length,
    sample: events.slice(0, 3).map((e) => ({ role: e.role, text: String(e.text || '').slice(0, 120) })),
  });

  res.json({ zoneId: deviceId, sessionId, events });
}

module.exports = { getConversations };


