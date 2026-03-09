const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── Configuration ────────────────────────────────────────────
//
// Production (Render):   set MONGODB_URI env var → data persists across restarts
// Local dev:             no MONGODB_URI → JSON files in backend/data/ (unchanged)
//
const USE_MONGO = !!process.env.MONGODB_URI;

// JSON-file fallback directory (local dev only)
const DATA_DIR = process.env.RENDER
  ? '/tmp/bhoomiq-data'
  : path.join(__dirname, 'data');

// ─── In-Memory Store ──────────────────────────────────────────
// All reads come from here (sync, fast).
// All writes go here first, then async-persist to Mongo or file.
const store = {
  users:           [],
  plants:          [],
  readings:        [],
  notes:           [],
  fields:          [],
  devices:         [],
  device_readings: []
};

let mongoDB = null; // set by initDatabase()

// ─── Helpers ──────────────────────────────────────────────────

function generateId() {
  return crypto.randomBytes(16).toString('hex');
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ─── Startup: load data into memory ───────────────────────────

async function initDatabase() {
  if (USE_MONGO) {
    try {
      const { MongoClient } = require('mongodb');
      const client = new MongoClient(process.env.MONGODB_URI, {
        serverSelectionTimeoutMS: 8000
      });
      await client.connect();
      mongoDB = client.db('bhoomiq');

      // Load every collection from MongoDB into the in-memory store
      for (const col of Object.keys(store)) {
        const docs = await mongoDB.collection(col).find({}).toArray();
        // Strip MongoDB's internal _id field before caching
        store[col] = docs.map(({ _id, ...doc }) => doc);
      }
      console.log(`[DB] MongoDB connected — loaded ${store.users.length} users, ${store.devices.length} devices`);
    } catch (err) {
      console.error('[DB] MongoDB connection failed:', err.message);
      console.log('[DB] Falling back to local JSON files');
      loadFromFiles();
    }
  } else {
    loadFromFiles();
  }
}

function loadFromFiles() {
  ensureDataDir();
  for (const col of Object.keys(store)) {
    const file = path.join(DATA_DIR, `${col}.json`);
    if (fs.existsSync(file)) {
      try { store[col] = JSON.parse(fs.readFileSync(file, 'utf8')); }
      catch (e) { store[col] = []; }
    }
  }
  console.log('[DB] Loaded from local JSON files');
}

// ─── Persist (fire-and-forget) ────────────────────────────────

function persistToMongo(collectionName, data) {
  if (!mongoDB) return;
  (async () => {
    try {
      const col = mongoDB.collection(collectionName);
      await col.deleteMany({});
      if (data.length > 0) await col.insertMany(data);
    } catch (err) {
      console.error(`[DB] MongoDB write error (${collectionName}):`, err.message);
    }
  })();
}

function persistToFile(collectionName, data) {
  try {
    ensureDataDir();
    fs.writeFileSync(
      path.join(DATA_DIR, `${collectionName}.json`),
      JSON.stringify(data, null, 2),
      'utf8'
    );
  } catch (err) {
    console.error(`[DB] File write error (${collectionName}):`, err.message);
  }
}

function persist(collectionName, data) {
  if (USE_MONGO) persistToMongo(collectionName, data);
  else           persistToFile(collectionName, data);
}

// ─── USERS ────────────────────────────────────────────────────

function getUsers() { return store.users; }

function saveUsers(users) {
  store.users = users;
  persist('users', users);
}

function findUserById(id) {
  return store.users.find(u => u.id === id) || null;
}

function findUserByEmail(email) {
  return store.users.find(u => u.email === email) || null;
}

function findUserByUsername(username) {
  // Case-insensitive match so "Angel" and "angel" are the same account
  return store.users.find(u => u.username.toLowerCase() === username.toLowerCase()) || null;
}

function createUser(userData) {
  const user = {
    id:            generateId(),
    username:      userData.username,
    email:         userData.email,
    password_hash: userData.password_hash,
    created_at:    new Date().toISOString(),
    updated_at:    new Date().toISOString()
  };
  store.users.push(user);
  persist('users', store.users);
  return user;
}

// ─── PLANTS ───────────────────────────────────────────────────

function getPlants() { return store.plants; }

function savePlants(plants) {
  store.plants = plants;
  persist('plants', plants);
}

function findPlantById(id) {
  return store.plants.find(p => p.id === id) || null;
}

function findPlantsByUserId(userId) {
  return store.plants.filter(p => p.user_id === userId);
}

function createPlant(plantData) {
  const plant = {
    id:            generateId(),
    user_id:       plantData.user_id,
    name:          plantData.name,
    species:       plantData.species,
    location:      plantData.location,
    moisture_min:  plantData.moisture_min  || 30,
    moisture_max:  plantData.moisture_max  || 70,
    temp_min:      plantData.temp_min      || 15,
    temp_max:      plantData.temp_max      || 28,
    humidity_min:  plantData.humidity_min  || 40,
    humidity_max:  plantData.humidity_max  || 70,
    profile_image: plantData.profile_image || null,
    health_score:  100,
    last_reading_at: null,
    created_at:    new Date().toISOString(),
    updated_at:    new Date().toISOString()
  };
  store.plants.push(plant);
  persist('plants', store.plants);
  return plant;
}

function updatePlant(id, updates) {
  const idx = store.plants.findIndex(p => p.id === id);
  if (idx === -1) return null;
  store.plants[idx] = { ...store.plants[idx], ...updates, updated_at: new Date().toISOString() };
  persist('plants', store.plants);
  return store.plants[idx];
}

function deletePlant(id) {
  const idx = store.plants.findIndex(p => p.id === id);
  if (idx === -1) return false;
  store.plants.splice(idx, 1);
  persist('plants', store.plants);
  return true;
}

// ─── READINGS ─────────────────────────────────────────────────

function getReadings() { return store.readings; }

function saveReadings(readings) {
  store.readings = readings;
  persist('readings', readings);
}

function getReadingsByPlantId(plantId, limit = null) {
  let result = store.readings
    .filter(r => r.plant_id === plantId)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  if (limit) result = result.slice(0, limit);
  return result;
}

function createReading(readingData) {
  const reading = {
    id:           generateId(),
    plant_id:     readingData.plant_id,
    temperature:  readingData.temperature,
    humidity:     readingData.humidity,
    soil_moisture: readingData.soil_moisture,
    image_path:   readingData.image_path   || null,
    ai_analysis:  readingData.ai_analysis  || null,
    health_score: readingData.health_score || 100,
    created_at:   new Date().toISOString()
  };
  store.readings.push(reading);
  persist('readings', store.readings);

  // Update plant's last_reading_at
  const plant = findPlantById(readingData.plant_id);
  if (plant) {
    updatePlant(readingData.plant_id, {
      last_reading_at: reading.created_at,
      health_score:    reading.health_score
    });
  }
  return reading;
}

// ─── NOTES ────────────────────────────────────────────────────

function getNotes() { return store.notes; }

function saveNotes(notes) {
  store.notes = notes;
  persist('notes', notes);
}

function getNotesByPlantId(plantId) {
  return store.notes
    .filter(n => n.plant_id === plantId)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

function createNote(noteData) {
  const note = {
    id:         generateId(),
    plant_id:   noteData.plant_id,
    user_id:    noteData.user_id,
    content:    noteData.content,
    created_at: new Date().toISOString()
  };
  store.notes.push(note);
  persist('notes', store.notes);
  return note;
}

// ─── DEVICE READINGS ──────────────────────────────────────────

function getDeviceReadings() { return store.device_readings; }

function saveDeviceReadings(readings) {
  store.device_readings = readings;
  persist('device_readings', readings);
}

function createDeviceReading(data) {
  const reading = {
    id:                 generateId(),
    device_id:          data.device_id          ?? null,
    moisture_pct:       data.moisture_pct       ?? 0,
    temperature_c:      data.temperature_c      ?? 0,
    battery_pct:        data.battery_pct        ?? null,
    image_path:         data.image_path         ?? null,
    ai_health_score:    data.ai_health_score    ?? null,
    ai_pump:            data.ai_pump            ?? false,
    ai_pump_reason:     data.ai_pump_reason     ?? '',
    ai_alert_level:     data.ai_alert_level     ?? 'none',
    ai_alerts:          data.ai_alerts          ?? [],
    ai_visual_status:   data.ai_visual_status   ?? '',
    ai_recommendations: data.ai_recommendations ?? [],
    ai_disease:         data.ai_disease         ?? 'none',
    ai_growth_stage:    data.ai_growth_stage    ?? 'vegetative',
    ai_immediate_actions: data.ai_immediate_actions ?? [],
    ai_animal_detected: data.ai_animal_detected ?? false,
    ai_animal_type:     data.ai_animal_type     ?? 'none',
    ai_animal_threat:   data.ai_animal_threat   ?? 'none',
    pump_activated:     data.pump_activated     ?? false,
    pump_duration_ms:   data.pump_duration_ms   ?? 0,
    created_at:         new Date().toISOString()
  };
  store.device_readings.unshift(reading); // newest first
  if (store.device_readings.length > 1000) store.device_readings.splice(1000); // cap
  persist('device_readings', store.device_readings);
  return reading;
}

function getLatestDeviceReading() {
  return store.device_readings[0] || null;
}

function getDeviceReadingHistory(limit = 100) {
  return store.device_readings.slice(0, Math.min(limit, store.device_readings.length));
}

function getDeviceReadingsByDeviceId(deviceId, limit = 100) {
  return store.device_readings.filter(r => r.device_id === deviceId).slice(0, limit);
}

function getLatestDeviceReadingByDeviceId(deviceId) {
  return store.device_readings.find(r => r.device_id === deviceId) || null;
}

// ─── FIELDS ───────────────────────────────────────────────────

function getFields() { return store.fields; }

function saveFields(fields) {
  store.fields = fields;
  persist('fields', fields);
}

function findFieldById(id) {
  return store.fields.find(f => f.id === id) || null;
}

function findFieldsByUserId(userId) {
  return store.fields.filter(f => f.user_id === userId);
}

function createField(data) {
  const field = {
    id:          generateId(),
    user_id:     data.user_id,
    name:        data.name        || 'Unnamed Field',
    description: data.description || '',
    boundary:    data.boundary    || null,
    center_lat:  data.center_lat  || null,
    center_lng:  data.center_lng  || null,
    created_at:  new Date().toISOString(),
    updated_at:  new Date().toISOString()
  };
  store.fields.push(field);
  persist('fields', store.fields);
  return field;
}

function updateField(id, updates) {
  const idx = store.fields.findIndex(f => f.id === id);
  if (idx === -1) return null;
  store.fields[idx] = { ...store.fields[idx], ...updates, updated_at: new Date().toISOString() };
  persist('fields', store.fields);
  return store.fields[idx];
}

function deleteField(id) {
  const idx = store.fields.findIndex(f => f.id === id);
  if (idx === -1) return false;
  store.fields.splice(idx, 1);
  persist('fields', store.fields);
  return true;
}

// ─── DEVICES ──────────────────────────────────────────────────

function getDevices() { return store.devices; }

function saveDevices(devices) {
  store.devices = devices;
  persist('devices', devices);
}

function findDeviceById(id) {
  return store.devices.find(d => d.id === id) || null;
}

function findDeviceByKey(key) {
  return store.devices.find(d => d.device_key === key) || null;
}

function findDevicesByUserId(userId) {
  return store.devices.filter(d => d.user_id === userId);
}

function findDevicesByFieldId(fieldId) {
  return store.devices.filter(d => d.field_id === fieldId);
}

function generateDeviceKey() {
  const part = () => crypto.randomBytes(3).toString('hex').toUpperCase();
  return `piq-${part()}-${part()}`;
}

function createDevice(data) {
  const device_key = generateDeviceKey();
  const device = {
    id:           generateId(),
    user_id:      data.user_id,
    field_id:     data.field_id     || null,
    name:         data.name         || 'My Device',
    device_key,
    location_lat: data.location_lat || null,
    location_lng: data.location_lng || null,
    is_active:    true,
    last_seen_at: null,
    created_at:   new Date().toISOString(),
    updated_at:   new Date().toISOString()
  };
  store.devices.push(device);
  persist('devices', store.devices);
  return { ...device, _key_shown: true };
}

function updateDevice(id, updates) {
  const idx = store.devices.findIndex(d => d.id === id);
  if (idx === -1) return null;
  store.devices[idx] = { ...store.devices[idx], ...updates, updated_at: new Date().toISOString() };
  persist('devices', store.devices);
  return store.devices[idx];
}

function deleteDevice(id) {
  const idx = store.devices.findIndex(d => d.id === id);
  if (idx === -1) return false;
  store.devices.splice(idx, 1);
  persist('devices', store.devices);
  return true;
}

// ─── Exports ──────────────────────────────────────────────────

module.exports = {
  initDatabase,
  // Users
  getUsers, saveUsers, findUserById, findUserByEmail, findUserByUsername, createUser,
  // Plants
  getPlants, savePlants, findPlantById, findPlantsByUserId, createPlant, updatePlant, deletePlant,
  // Readings
  getReadings, saveReadings, getReadingsByPlantId, createReading,
  // Notes
  getNotes, saveNotes, getNotesByPlantId, createNote,
  // Device readings
  createDeviceReading, getLatestDeviceReading, getDeviceReadingHistory,
  getDeviceReadingsByDeviceId, getLatestDeviceReadingByDeviceId,
  // Fields
  getFields, saveFields, findFieldById, findFieldsByUserId, createField, updateField, deleteField,
  // Devices
  getDevices, saveDevices, findDeviceById, findDeviceByKey, findDevicesByUserId,
  findDevicesByFieldId, createDevice, updateDevice, deleteDevice
};
