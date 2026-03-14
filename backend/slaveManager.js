/**
 * BhoomiIQ — Slave Zone Manager
 * Stores and manages data from slave nodes reported via master ESP-NOW → HTTP
 */

// In-memory store: deviceKey → { master, slaves[], lastUpdated }
const farmStore = {};

// How long before a slave is considered offline (ms)
const SLAVE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Update farm data when master sends a report with slaves[] attached
 * @param {string} deviceKey  - master's device key
 * @param {object} masterData - { moisture_pct, temperature_c, health_score, ai_summary }
 * @param {Array}  slavesArr  - array of slave zone objects from x-slaves-json header
 */
function updateFarmData(deviceKey, masterData, slavesArr) {
  if (!farmStore[deviceKey]) {
    farmStore[deviceKey] = {
      master: null,
      slaves: {},
      lastUpdated: null,
    };
  }

  const farm = farmStore[deviceKey];
  farm.lastUpdated = new Date().toISOString();

  // Update master record
  farm.master = {
    zone_name: 'Master Zone',
    slave_id:  'MASTER',
    moisture_pct: masterData.moisture_pct,
    temperature_c: masterData.temperature_c,
    health_score: masterData.health_score || null,
    ai_summary: masterData.ai_summary || null,
    online: true,
    last_seen: new Date().toISOString(),
    is_master: true,
  };

  // Update slave records
  if (Array.isArray(slavesArr)) {
    slavesArr.forEach(s => {
      if (!s.slave_id) return;
      farm.slaves[s.slave_id] = {
        slave_id:      s.slave_id,
        zone_name:     s.zone_name || s.slave_id,
        moisture_pct:  s.moisture_pct,
        temperature_c: s.temperature_c,
        online:        s.online !== false,
        last_seen:     new Date().toISOString(),
        last_seen_s:   s.last_seen_s || 0,
        is_master:     false,
      };
    });
  }
}

/**
 * Get full farm status for a device
 * Returns master + all slave zones as flat array
 */
function getFarmStatus(deviceKey) {
  const farm = farmStore[deviceKey];
  if (!farm) return null;

  const now = Date.now();
  const zones = [];

  // Master first
  if (farm.master) {
    zones.push({ ...farm.master, zone_index: 0 });
  }

  // Slaves sorted by slave_id
  const slaveList = Object.values(farm.slaves).sort((a, b) =>
    a.slave_id.localeCompare(b.slave_id)
  );

  slaveList.forEach((s, i) => {
    zones.push({ ...s, zone_index: i + 1 });
  });

  return {
    device_key:    deviceKey,
    last_updated:  farm.lastUpdated,
    total_zones:   zones.length,
    slave_count:   slaveList.length,
    zones,
    overall_health: computeOverallHealth(zones),
    critical_zones: zones.filter(z => z.moisture_pct < 25).map(z => z.slave_id || 'MASTER'),
  };
}

/**
 * Get all device keys that have farm data
 */
function getAllFarmDevices() {
  return Object.keys(farmStore);
}

/**
 * Compute overall health score from all zones
 */
function computeOverallHealth(zones) {
  if (!zones.length) return null;
  const onlineZones = zones.filter(z => z.online && z.moisture_pct != null);
  if (!onlineZones.length) return null;
  const avgMoisture = onlineZones.reduce((s, z) => s + z.moisture_pct, 0) / onlineZones.length;
  // Simple health: moisture-based score
  if (avgMoisture >= 60) return 'good';
  if (avgMoisture >= 35) return 'fair';
  return 'critical';
}

/**
 * Generate pump commands for all zones based on moisture levels
 * Returns array of { slave_id, pump_on, pump_ms }
 * Used by backend to return pump decisions to master in HTTP response
 */
function generatePumpCommands(deviceKey) {
  const farm = farmStore[deviceKey];
  if (!farm) return [];

  const commands = [];

  Object.values(farm.slaves).forEach(s => {
    if (!s.online) return;
    if (s.moisture_pct < 25) {
      commands.push({
        slave_id: s.slave_id,
        pump_on:  true,
        pump_ms:  s.moisture_pct < 15 ? 10000 : 6000, // longer for very dry
      });
    }
  });

  return commands;
}

module.exports = {
  updateFarmData,
  getFarmStatus,
  getAllFarmDevices,
  generatePumpCommands,
};
