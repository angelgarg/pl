const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');

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
  createNote
};
