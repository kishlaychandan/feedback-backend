const express = require('express');
const cors = require('cors');
const routes = require('./routes');
const { requestLogger } = require('./middleware/requestLogger');

function createApp() {
  const app = express();
  
  // CORS: Allow all origins
  app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false
  }));
  
  app.use(express.json());
  app.use(requestLogger);
  app.use('/api', routes);
  return app;
}

module.exports = { createApp };


