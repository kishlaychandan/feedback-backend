const mongoose = require('mongoose');
const { FEEDBACK_MONGO_URI } = require('./config');

function redactMongoUri(uri) {
  if (!uri || typeof uri !== 'string') return '';
  // Very small redaction: hide credentials if present
  return uri.replace(/\/\/([^@]+)@/, '//***:***@');
}

async function connectToMongo() {
  const mongoUri = FEEDBACK_MONGO_URI;

  // Disconnect any existing connection first
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  
  mongoose.set('strictQuery', true);

  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 8000,
    directConnection: true, // Force direct connection, not replica set
  });

  console.log(`✅ MongoDB connected: ${redactMongoUri(mongoUri)}`);
}

module.exports = { connectToMongo };


