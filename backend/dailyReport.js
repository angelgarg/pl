'use strict';

const cron = require('node-cron');
const { generateDailyPlantReport } = require('./ai_analysis');

// In-memory store for zone readings (last 24h) and daily reports
// key = device_key, value = { readings: [...], dailyReport: {...} }
const _zoneStore = {};

// Save a zone analysis reading
function saveZoneReading(deviceKey, zoneResult, timestamp = new Date()) {
  if (!_zoneStore[deviceKey]) _zoneStore[deviceKey] = { readings: [], dailyReport: null };
  const store = _zoneStore[deviceKey];

  // Push new reading
  store.readings.push({ timestamp, ...zoneResult });

  // Keep only last 24h of readings
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  store.readings = store.readings.filter(r => new Date(r.timestamp).getTime() > cutoff);
}

// Get latest zone snapshot for a device
function getLatestZones(deviceKey) {
  const store = _zoneStore[deviceKey];
  if (!store || !store.readings.length) return null;
  return store.readings[store.readings.length - 1];
}

// Get today's daily report (cached)
function getDailyReport(deviceKey) {
  const store = _zoneStore[deviceKey];
  if (!store) return null;
  return store.dailyReport;
}

// Generate and cache daily report for all active devices
async function runDailyReport() {
  const deviceKeys = Object.keys(_zoneStore);
  if (!deviceKeys.length) {
    console.log('[DAILY-REPORT] No devices with data yet');
    return;
  }

  console.log(`[DAILY-REPORT] Generating for ${deviceKeys.length} device(s)...`);

  for (const deviceKey of deviceKeys) {
    const store = _zoneStore[deviceKey];
    if (!store.readings.length) continue;

    try {
      const report = await generateDailyPlantReport(store.readings);
      if (report) {
        store.dailyReport = {
          ...report,
          generated_at: new Date().toISOString(),
          device_key: deviceKey,
          readings_used: store.readings.length
        };
        console.log(`[DAILY-REPORT] ✅ ${deviceKey} — ${report.healthy_count} healthy, ${report.attention_count} need attention`);
      }
    } catch (err) {
      console.error(`[DAILY-REPORT] ❌ ${deviceKey}:`, err.message);
    }
  }
}

// Start the daily report cron — runs at 7 AM IST every day
function startDailyReportScheduler() {
  cron.schedule('0 7 * * *', runDailyReport, { timezone: 'Asia/Kolkata' });
  console.log('[DAILY-REPORT] Scheduler started — runs daily at 7:00 AM IST');
}

module.exports = { saveZoneReading, getLatestZones, getDailyReport, runDailyReport, startDailyReportScheduler };
