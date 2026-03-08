const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Use /tmp on Render (survives sleep/wake cycles), fallback to local data/ for dev
const DATA_DIR = process.env.RENDER
  ? '/tmp/plantiq-data'
  : path.join(__dirname, 'data');

// Ensure data directory exists
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// Generate UUID
function generateId() {
  return crypto.randomBytes(16).toString('hex');
}

// Get file path
function getFilePath(filename) {
  return path.join(DATA_DIR, filename);
}

// Initialize file if it doesn't exist
function initializeFile(filename, initialData = []) {
  ensureDataDir();
  const filepath = getFilePath(filename);
  if (!fs.existsSync(filepath)) {
    fs.writeFileSync(filepath, JSON.stringify(initialData, null, 2), 'utf8');
  }
}

// Read JSON file
function readFile(filename) {
  try {
    initializeFile(filename);
    const data = fs.readFileSync(getFilePath(filename), 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error(`Error reading ${filename}:`, err);
    return [];
  }
}

// Write JSON file
function writeFile(filename, data) {
  try {
    ensureDataDir();
    fs.writeFileSync(getFilePath(filename), JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error(`Error writing ${filename}:`, err);
  }
}

// Users
function getUsers() {
  return readFile('users.json');
}

function saveUsers(users) {
  writeFile('users.json', users);
}

function findUserById(id) {
  const users = getUsers();
  return users.find(u => u.id === id) || null;
}

function findUserByEmail(email) {
  const users = getUsers();
  return users.find(u => u.email === email) || null;
}

function findUserByUsername(username) {
  const users = getUsers();
  return users.find(u => u.username === username) || null;
}

function createUser(userData) {
  const users = getUsers();
  const user = {
    id: generateId(),
    username: userData.username,
    email: userData.email,
    password_hash: userData.password_hash,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  users.push(user);
  saveUsers(users);
  return user;
}

// Plants
function getPlants() {
  return readFile('plants.json');
}

function savePlants(plants) {
  writeFile('plants.json', plants);
}

function findPlantById(id) {
  const plants = getPlants();
  return plants.find(p => p.id === id) || null;
}

function findPlantsByUserId(userId) {
  const plants = getPlants();
  return plants.filter(p => p.user_id === userId);
}

function createPlant(plantData) {
  const plants = getPlants();
  const plant = {
    id: generateId(),
    user_id: plantData.user_id,
    name: plantData.name,
    species: plantData.species,
    location: plantData.location,
    moisture_min: plantData.moisture_min || 30,
    moisture_max: plantData.moisture_max || 70,
    temp_min: plantData.temp_min || 15,
    temp_max: plantData.temp_max || 28,
    humidity_min: plantData.humidity_min || 40,
    humidity_max: plantData.humidity_max || 70,
    profile_image: plantData.profile_image || null,
    health_score: 100,
    last_reading_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  plants.push(plant);
  savePlants(plants);
  return plant;
}

function updatePlant(id, updates) {
  const plants = getPlants();
  const idx = plants.findIndex(p => p.id === id);
  if (idx === -1) return null;
  plants[idx] = {
    ...plants[idx],
    ...updates,
    updated_at: new Date().toISOString()
  };
  savePlants(plants);
  return plants[idx];
}

function deletePlant(id) {
  const plants = getPlants();
  const idx = plants.findIndex(p => p.id === id);
  if (idx === -1) return false;
  plants.splice(idx, 1);
  savePlants(plants);
  return true;
}

// Readings
function getReadings() {
  return readFile('readings.json');
}

function saveReadings(readings) {
  writeFile('readings.json', readings);
}

function getReadingsByPlantId(plantId, limit = null) {
  const readings = getReadings();
  let plantReadings = readings.filter(r => r.plant_id === plantId);
  // Sort by created_at descending (newest first)
  plantReadings.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  if (limit) plantReadings = plantReadings.slice(0, limit);
  return plantReadings;
}

function createReading(readingData) {
  const readings = getReadings();
  const reading = {
    id: generateId(),
    plant_id: readingData.plant_id,
    temperature: readingData.temperature,
    humidity: readingData.humidity,
    soil_moisture: readingData.soil_moisture,
    image_path: readingData.image_path || null,
    ai_analysis: readingData.ai_analysis || null,
    health_score: readingData.health_score || 100,
    created_at: new Date().toISOString()
  };
  readings.push(reading);
  saveReadings(readings);

  // Update plant's last_reading_at
  const plant = findPlantById(readingData.plant_id);
  if (plant) {
    updatePlant(readingData.plant_id, {
      last_reading_at: reading.created_at,
      health_score: reading.health_score
    });
  }

  return reading;
}

// Notes
function getNotes() {
  return readFile('notes.json');
}

function saveNotes(notes) {
  writeFile('notes.json', notes);
}

function getNotesByPlantId(plantId) {
  const notes = getNotes();
  return notes.filter(n => n.plant_id === plantId).sort((a, b) =>
    new Date(b.created_at) - new Date(a.created_at)
  );
}

function createNote(noteData) {
  const notes = getNotes();
  const note = {
    id: generateId(),
    plant_id: noteData.plant_id,
    user_id: noteData.user_id,
    content: noteData.content,
    created_at: new Date().toISOString()
  };
  notes.push(note);
  saveNotes(notes);
  return note;
}

// ─── DEVICE READINGS (ESP32 live sensor + AI reports) ───────

function getDeviceReadings() {
  return readFile('device_readings.json');
}

function saveDeviceReadings(readings) {
  writeFile('device_readings.json', readings);
}

function createDeviceReading(data) {
  const readings = getDeviceReadings();
  const reading = {
    id: generateId(),
    device_id:         data.device_id         ?? null,   // null = legacy single-device
    moisture_pct:      data.moisture_pct      ?? 0,
    temperature_c:     data.temperature_c     ?? 0,
    battery_pct:       data.battery_pct       ?? null,   // null = no voltage divider wired
    image_path:        data.image_path        ?? null,
    ai_health_score:   data.ai_health_score   ?? null,
    ai_pump:           data.ai_pump           ?? false,
    ai_pump_reason:    data.ai_pump_reason    ?? '',
    ai_alert_level:    data.ai_alert_level    ?? 'none',
    ai_alerts:         data.ai_alerts         ?? [],
    ai_visual_status:  data.ai_visual_status  ?? '',
    ai_recommendations:data.ai_recommendations ?? [],
    ai_disease:        data.ai_disease        ?? 'none',
    ai_growth_stage:   data.ai_growth_stage   ?? 'vegetative',
    ai_immediate_actions: data.ai_immediate_actions ?? [],
    ai_animal_detected: data.ai_animal_detected ?? false,
    ai_animal_type:    data.ai_animal_type    ?? 'none',
    ai_animal_threat:  data.ai_animal_threat  ?? 'none',
    pump_activated:    data.pump_activated    ?? false,
    pump_duration_ms:  data.pump_duration_ms  ?? 0,
    created_at:        new Date().toISOString()
  };
  readings.unshift(reading);              // newest first
  if (readings.length > 1000) readings.splice(1000); // cap at 1000
  saveDeviceReadings(readings);
  return reading;
}

function getLatestDeviceReading() {
  const readings = getDeviceReadings();
  return readings[0] || null;
}

function getDeviceReadingHistory(limit = 100) {
  const readings = getDeviceReadings();
  return readings.slice(0, Math.min(limit, readings.length));
}

// ─── FIELDS ──────────────────────────────────────────────────

function getFields() {
  return readFile('fields.json');
}

function saveFields(fields) {
  writeFile('fields.json', fields);
}

function findFieldById(id) {
  return getFields().find(f => f.id === id) || null;
}

function findFieldsByUserId(userId) {
  return getFields().filter(f => f.user_id === userId);
}

function createField(data) {
  const fields = getFields();
  const field = {
    id: generateId(),
    user_id:     data.user_id,
    name:        data.name        || 'Unnamed Field',
    description: data.description || '',
    boundary:    data.boundary    || null,   // GeoJSON polygon coords array or null
    center_lat:  data.center_lat  || null,
    center_lng:  data.center_lng  || null,
    created_at:  new Date().toISOString(),
    updated_at:  new Date().toISOString()
  };
  fields.push(field);
  saveFields(fields);
  return field;
}

function updateField(id, updates) {
  const fields = getFields();
  const idx = fields.findIndex(f => f.id === id);
  if (idx === -1) return null;
  fields[idx] = { ...fields[idx], ...updates, updated_at: new Date().toISOString() };
  saveFields(fields);
  return fields[idx];
}

function deleteField(id) {
  const fields = getFields();
  const idx = fields.findIndex(f => f.id === id);
  if (idx === -1) return false;
  fields.splice(idx, 1);
  saveFields(fields);
  return true;
}

// ─── DEVICES ─────────────────────────────────────────────────

function getDevices() {
  return readFile('devices.json');
}

function saveDevices(devices) {
  writeFile('devices.json', devices);
}

function findDeviceById(id) {
  return getDevices().find(d => d.id === id) || null;
}

function findDeviceByKey(key) {
  return getDevices().find(d => d.device_key === key) || null;
}

function findDevicesByUserId(userId) {
  return getDevices().filter(d => d.user_id === userId);
}

function findDevicesByFieldId(fieldId) {
  return getDevices().filter(d => d.field_id === fieldId);
}

function generateDeviceKey() {
  // Readable key: piq-XXXXX-XXXXX (like GitHub PATs)
  const part = () => crypto.randomBytes(3).toString('hex').toUpperCase();
  return `piq-${part()}-${part()}`;
}

function createDevice(data) {
  const devices = getDevices();
  const device_key = generateDeviceKey();
  const device = {
    id:           generateId(),
    user_id:      data.user_id,
    field_id:     data.field_id   || null,
    name:         data.name       || 'My Device',
    device_key,                       // shown ONCE, stored in plain (no secret data)
    location_lat: data.location_lat || null,
    location_lng: data.location_lng || null,
    is_active:    true,
    last_seen_at: null,
    created_at:   new Date().toISOString(),
    updated_at:   new Date().toISOString()
  };
  devices.push(device);
  saveDevices(devices);
  return { ...device, _key_shown: true }; // flag that key should be revealed this time
}

function updateDevice(id, updates) {
  const devices = getDevices();
  const idx = devices.findIndex(d => d.id === id);
  if (idx === -1) return null;
  devices[idx] = { ...devices[idx], ...updates, updated_at: new Date().toISOString() };
  saveDevices(devices);
  return devices[idx];
}

function deleteDevice(id) {
  const devices = getDevices();
  const idx = devices.findIndex(d => d.id === id);
  if (idx === -1) return false;
  devices.splice(idx, 1);
  saveDevices(devices);
  return true;
}

// ─── DEVICE READINGS (per-device) ────────────────────────────

function getDeviceReadingsByDeviceId(deviceId, limit = 100) {
  const readings = getDeviceReadings();
  return readings.filter(r => r.device_id === deviceId).slice(0, limit);
}

function getLatestDeviceReadingByDeviceId(deviceId) {
  const readings = getDeviceReadings();
  return readings.find(r => r.device_id === deviceId) || null;
}

module.exports = {
  getUsers,
  saveUsers,
  findUserById,
  findUserByEmail,
  findUserByUsername,
  createUser,
  getPlants,
  savePlants,
  findPlantById,
  findPlantsByUserId,
  createPlant,
  updatePlant,
  deletePlant,
  getReadings,
  saveReadings,
  getReadingsByPlantId,
  createReading,
  getNotes,
  saveNotes,
  getNotesByPlantId,
  createNote,
  // Device readings
  createDeviceReading,
  getLatestDeviceReading,
  getDeviceReadingHistory,
  getDeviceReadingsByDeviceId,
  getLatestDeviceReadingByDeviceId,
  // Fields
  getFields,
  saveFields,
  findFieldById,
  findFieldsByUserId,
  createField,
  updateField,
  deleteField,
  // Devices
  getDevices,
  saveDevices,
  findDeviceById,
  findDeviceByKey,
  findDevicesByUserId,
  findDevicesByFieldId,
  createDevice,
  updateDevice,
  deleteDevice
};
