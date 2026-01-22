const { devices: Devices } = require('../models/device.model');
const { Port } = require('../models/port.model');
const { publishToTopic } = require('./mqtt.service');

/**
 * Map zoneId (from URL) to macId for MQTT publishing
 */
function mapZoneIdToMacId(zoneId) {
  const z = String(zoneId || '').trim();
  // if (z === '1') return '24:6F:28:55:59:C9';
  if (z === '1') return '68:FE:71:2C:50:C0';
  if (z === '2') return '44:1D:64:CF:5B:10';
  return null;
}

/**
 * Find device by deviceId (e.g., "AC-001")
 */
async function findDeviceById(deviceId) {
  return await Devices.findOne({ deviceId });
}

/**
 * Find device by macId
 */
async function findDeviceByMacId(macId) {
  return await Devices.findOne({ macId });
}

/**
 * Find device by zoneId (maps to macId, then queries DB)
 * Returns: { device, macId, zoneId }
 */
async function findDeviceByZoneId(zoneId) {
  const mappedMac = mapZoneIdToMacId(zoneId);
  if (mappedMac) {
    const dev = await findDeviceByMacId(mappedMac);
    return { device: dev, macId: mappedMac, zoneId: String(zoneId) };
  }
  // Fallback: treat zoneId as deviceId (e.g., "AC-001")
  const dev = await findDeviceById(zoneId);
  return { device: dev, macId: dev?.macId || null, zoneId: String(zoneId) };
}

/**
 * Find all ports for a device
 */
async function findPortsForDevice(device) {
  if (!device) return [];
  if (Array.isArray(device.ports) && device.ports.length > 0) {
    return await Port.find({ _id: { $in: device.ports } }).lean();
  }
  // Fallback: fetch by device ObjectId
  return await Port.find({ device: device._id }).lean();
}

/**
 * Get primary port for a device (first port in ports array, or first by device _id)
 */
async function getPrimaryPortForDevice(device) {
  if (!device) return null;
  const portId = Array.isArray(device?.ports) && device.ports.length > 0 ? device.ports[0] : null;
  if (portId) return await Port.findById(portId);
  return await Port.findOne({ device: device._id });
}

/**
 * Read telemetry from device and port documents
 * Returns: { setpointC, power, roomTempC, humidityPct, consumptionW, runHours, lastUpdateAt }
 */
function readTelemetry(deviceId, device, port) {
  return {
    setpointC: typeof port?.ac_temp === 'number' ? port.ac_temp : null,
    power: typeof port?.val === 'number' ? (port.val === 1 ? 'ON' : 'OFF') : null,
    roomTempC: port?.roomTemp ? Number(port.roomTemp) : null,
    humidityPct: typeof device?.humidityPct === 'number' ? device.humidityPct : null,
    consumptionW: typeof device?.consumptionW === 'number' ? device.consumptionW : null,
    runHours: typeof device?.runHours === 'number' ? device.runHours : null,
    lastUpdateAt: device?.lp || device?.updatedAt || new Date(),
  };
}

/**
 * Validate and clamp action values to safe ranges
 */
function validateAndClampAction(action) {
  const MIN_SETPOINT = 16;
  const MAX_SETPOINT = 30;
  const MAX_DELTA = 10;
  const MIN_DELTA = -10;

  const validated = { ...action };

  // Clamp setpointC to safe range (16-30°C)
  if (typeof validated.setpointC === 'number' && Number.isFinite(validated.setpointC)) {
    validated.setpointC = Math.max(MIN_SETPOINT, Math.min(MAX_SETPOINT, Math.round(validated.setpointC * 10) / 10));
  }

  // Clamp deltaC to safe range (-10 to +10°C)
  if (typeof validated.deltaC === 'number' && Number.isFinite(validated.deltaC)) {
    validated.deltaC = Math.max(MIN_DELTA, Math.min(MAX_DELTA, Math.round(validated.deltaC * 10) / 10));
  }

  // Validate power values
  if (validated.power && validated.power !== 'ON' && validated.power !== 'OFF') {
    delete validated.power;
  }

  return validated;
}

/**
 * Compare current DB state with desired action, publish MQTT only if change is needed
 * Returns: { current, next: { power, setpointC }, mqtt, changed, validation }
 */
async function computeAndMaybeApplyAction(deviceId, action, device, port, macIdOverride = null) {
  // Validate device and port exist
  if (!device) {
    throw new Error(`Device not found for zoneId: ${deviceId}`);
  }
  if (!port) {
    throw new Error(`Port not found for device: ${deviceId}`);
  }

  // Validate and clamp action values
  const validatedAction = validateAndClampAction(action || {});

  const current = readTelemetry(deviceId, device, port);
  
  // Check if current state has required values
  if (current.setpointC === null && (validatedAction.setpointC !== undefined || validatedAction.deltaC !== undefined)) {
    throw new Error(`Cannot compute setpoint: current setpoint is null for device: ${deviceId}`);
  }
  if (current.power === null && validatedAction.power) {
    // Allow power changes even if current is null
  }

  let nextPower = current.power;
  let nextSetpoint = current.setpointC;

  // Compute desired state from validated action
  if (validatedAction.power === 'ON' || validatedAction.power === 'OFF') {
    nextPower = validatedAction.power;
  }
  if (typeof validatedAction.setpointC === 'number' && Number.isFinite(validatedAction.setpointC)) {
    nextSetpoint = validatedAction.setpointC;
  }
  if (typeof validatedAction.deltaC === 'number' && Number.isFinite(validatedAction.deltaC) && current.setpointC !== null) {
    nextSetpoint = Math.round((nextSetpoint + validatedAction.deltaC) * 10) / 10;
    // Clamp final setpoint to safe range
    nextSetpoint = Math.max(16, Math.min(30, nextSetpoint));
  }

  // Production rule: If user is changing temperature (setpointC/deltaC) and did NOT explicitly request OFF,
  // we should turn the unit ON so the setpoint change actually takes effect.
  const requestedTempChange =
    (typeof validatedAction.setpointC === 'number' && Number.isFinite(validatedAction.setpointC)) ||
    (typeof validatedAction.deltaC === 'number' && Number.isFinite(validatedAction.deltaC));
  const explicitlyOff = validatedAction.power === 'OFF';
  if (requestedTempChange && !explicitlyOff) {
    nextPower = 'ON';
  }

  // Compare: Only publish MQTT if state actually changes
  // Special case: If user explicitly requested power OFF, always publish (device might be ON from previous MQTT)
  const explicitPowerOff = validatedAction.power === 'OFF';
  const powerChanged = current.power !== nextPower || explicitPowerOff;
  const setpointChanged = Math.abs((current.setpointC || 0) - (nextSetpoint || 0)) > 0.1;
  const stateChanged = powerChanged || setpointChanged;

  let mqttResult = null;
  if (stateChanged) {
    const macId = macIdOverride || device?.macId || mapZoneIdToMacId(deviceId);
    if (macId) {
      const fan = typeof port?.ac_fan_speed === 'number' ? port.ac_fan_speed : 1;
      const cmd = {
        Power: nextPower === 'OFF' ? 'off' : 'on',
        Temp: String(nextSetpoint),
        Mode: '0',
        Fan: String(fan),
      };
      mqttResult = await publishToTopic(macId, cmd);
    }
  }

  return { 
    current, 
    next: { power: nextPower, setpointC: nextSetpoint }, 
    mqtt: mqttResult,
    changed: stateChanged,
    changes: { powerChanged, setpointChanged },
    validation: {
      originalAction: action,
      validatedAction: validatedAction,
      clamped: action?.setpointC !== validatedAction?.setpointC || action?.deltaC !== validatedAction?.deltaC
    }
  };
}

module.exports = {
  findDeviceById,
  findDeviceByMacId,
  findDeviceByZoneId,
  mapZoneIdToMacId,
  findPortsForDevice,
  getPrimaryPortForDevice,
  readTelemetry,
  computeAndMaybeApplyAction,
};
