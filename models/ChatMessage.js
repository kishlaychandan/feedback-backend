const mongoose = require('mongoose');

/**
 * Chat storage per user/session.
 * Stores every message as an event (scales well, append-only).
 */
const ChatMessageSchema = new mongoose.Schema(
  {
    deviceId: { type: String, index: true, required: true }, // same as zoneId for now
    sessionId: { type: String, index: true, required: true },

    role: { type: String, enum: ['user', 'assistant', 'error'], required: true },
    text: { type: String, required: true },

    // Optional LLM metadata (demo)
    intent: { type: String },
    requiresAction: { type: Boolean },
    action: { type: mongoose.Schema.Types.Mixed },

    requestId: { type: String, index: true },
  },
  { timestamps: true }
);

ChatMessageSchema.index({ deviceId: 1, sessionId: 1, createdAt: -1 });

module.exports = mongoose.model('ChatMessage', ChatMessageSchema);


