const { findDeviceByZoneId, findPortsForDevice, getPrimaryPortForDevice, readTelemetry } = require('../services/device.service');
const { logWithTimestamp } = require('../middleware/requestLogger');

function normalizeId(v) {
  const raw = (v || '').toString().trim();
  if (!raw) return '';
  return raw.slice(0, 64);
}

async function getDevice(req, res) {
  const deviceId = normalizeId(req.params.deviceId);
  if (!deviceId) return res.status(400).json({ error: 'deviceId is required' });

  const resolved = await findDeviceByZoneId(deviceId);
  const device = resolved.device;
  const macId = resolved.macId;
  if (!device) return res.status(404).json({ error: `Device not found for id: ${deviceId}`, deviceId });
  const ports = await findPortsForDevice(device);

  // Print what we fetched from DB
  logWithTimestamp('DATA', `[${req.requestId || 'noid'}] Device fetched`, {
    deviceId,
    macId,
    device: device ? { _id: device._id, deviceId: device.deviceId, macId: device.macId, online: device.online, lp: device.lp } : null,
    ports: (ports || []).map((p) => ({ _id: p._id, ac_temp: p.ac_temp, val: p.val, roomTemp: p.roomTemp })),
  });

  res.json({ device, ports, macId });
}

async function getTelemetry(req, res) {
  const deviceId = normalizeId(req.params.deviceId);
  if (!deviceId) return res.status(400).json({ error: 'deviceId is required' });

  const resolved = await findDeviceByZoneId(deviceId);
  const device = resolved.device;
  const macId = resolved.macId;
  if (!device) return res.status(404).json({ error: `Device not found for id: ${deviceId}`, deviceId });
  const port = await getPrimaryPortForDevice(device);
  if (!port) return res.status(404).json({ error: `Port not found for device: ${deviceId}`, deviceId, macId });
  const telemetry = readTelemetry(deviceId, device, port);

  // Print what we fetched from DB + computed telemetry
  logWithTimestamp('DATA', `[${req.requestId || 'noid'}] Telemetry fetched`, {
    deviceId,
    macId,
    device: device ? { _id: device._id, deviceId: device.deviceId, macId: device.macId, online: device.online, lp: device.lp } : null,
    port: port ? { _id: port._id, ac_temp: port.ac_temp, val: port.val, roomTemp: port.roomTemp } : null,
    telemetry,
  });

  res.json({ deviceId, macId, ...telemetry });
}

module.exports = { getDevice, getTelemetry };


