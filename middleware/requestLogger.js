function logWithTimestamp(level, message, data = null) {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level}]`;
  if (data) console.log(`${prefix} ${message}`, data);
  else console.log(`${prefix} ${message}`);
}

function requestLogger(req, res, next) {
  const requestId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const start = Date.now();
  req.requestId = requestId;

  logWithTimestamp('REQUEST', `[${requestId}] ${req.method} ${req.originalUrl}`, {
    ip: req.ip || req.connection?.remoteAddress,
    contentType: req.headers['content-type'],
  });

  res.on('finish', () => {
    const ms = Date.now() - start;
    logWithTimestamp('RESPONSE', `[${requestId}] ${req.method} ${req.originalUrl}`, {
      status: res.statusCode,
      durationMs: ms,
    });
  });

  next();
}

module.exports = { requestLogger, logWithTimestamp };


