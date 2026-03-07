const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
require('dotenv').config();

const db = require('./db');
const { hashPassword, verifyPassword, createToken } = require('./auth');
const { calculateHealthScore, analyzeImage } = require('./ai_analysis');

const app = express();
const PORT = process.env.PORT || 3001;
const SECRET_KEY = process.env.SECRET_KEY || 'super-secret-dev-key-change-in-production-plantiq-2024';

// Middleware — allow localhost + any *.vercel.app + optional FRONTEND_URL env var
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
  'https://pl-kp57.onrender.com',
  ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : []),
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin) || /\.vercel\.app$/.test(origin) || /\.vercel\.live$/.test(origin)) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-secret'],
  optionsSuccessStatus: 200
}));

// Explicit OPTIONS preflight handler (belt + suspenders)
app.options('*', cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin) || /\.vercel\.app$/.test(origin) || /\.vercel\.live$/.test(origin)) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-secret'],
  optionsSuccessStatus: 200
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Multer configuration
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
    cb(null, name);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});

// Serve uploads directory
app.use('/uploads', express.static(uploadsDir));

// Middleware to parse cookies
function parseCookies(req) {
  const list = {};
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach(cookie => {
    let [name, ...rest] = cookie.split('=');
    name = name?.trim();
    if (!name) return;
    const value = rest.join('=').trim();
    list[name] = decodeURIComponent(value);
  });
  return list;
}

// Extract token from Authorization header OR cookie (supports both)
function extractToken(req) {
  // 1. Authorization: Bearer <token>  (used by cross-origin Vercel→Render)
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  // 2. Cookie fallback (used by same-origin / local dev)
  const cookies = parseCookies(req);
  return cookies.plantiq_token || null;
}

// Auth middleware — checks Bearer header first, then cookie
// Also accepts guest tokens (signed with SECRET_KEY + ':guest')
function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { verifyToken } = require('./auth');
  // Try normal token first, then guest token
  let userId = verifyToken(token, SECRET_KEY);
  let isGuest = false;
  if (!userId) {
    userId = verifyToken(token, SECRET_KEY + ':guest');
    if (userId) isGuest = true;
  }
  if (!userId) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  req.user = { id: userId, isGuest };
  next();
}

// Optional auth
function optionalAuthCheck(req, res, next) {
  const token = extractToken(req);
  if (token) {
    const { verifyToken } = require('./auth');
    let userId = verifyToken(token, SECRET_KEY);
    let isGuest = false;
    if (!userId) {
      userId = verifyToken(token, SECRET_KEY + ':guest');
      if (userId) isGuest = true;
    }
    if (userId) req.user = { id: userId, isGuest };
  }
  next();
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// ============================================================
// AUTH ROUTES
// ============================================================

app.post('/auth/register', async (req, res) => {
  try {
    const { username, email, password, confirmPassword } = req.body;

    // Validation
    if (!username || !email || !password || !confirmPassword) {
      return res.status(400).json({ error: 'All fields required' });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Check if user exists
    if (db.findUserByUsername(username)) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    if (db.findUserByEmail(email)) {
      return res.status(400).json({ error: 'Email already exists' });
    }

    // Hash password and create user
    const password_hash = await hashPassword(password);
    const user = db.createUser({
      username,
      email,
      password_hash
    });

    // Create token
    const token = createToken(user.id, SECRET_KEY);

    // Set cookie (SameSite=None; Secure needed for cross-origin Vercel→Render)
    res.setHeader('Set-Cookie', `plantiq_token=${token}; Path=/; HttpOnly; Max-Age=${7 * 24 * 60 * 60}; SameSite=None; Secure`);

    // Also return token in body so frontend can store in localStorage (cross-origin safe)
    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email
      }
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const user = db.findUserByUsername(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Create token
    const token = createToken(user.id, SECRET_KEY);

    // Set cookie (SameSite=None; Secure for cross-origin)
    res.setHeader('Set-Cookie', `plantiq_token=${token}; Path=/; HttpOnly; Max-Age=${7 * 24 * 60 * 60}; SameSite=None; Secure`);

    // Also return token in body for localStorage storage
    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/auth/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'plantiq_token=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax');
  res.json({ success: true });
});

// Guest login — creates/reuses a shared guest account with sample data
app.post('/auth/guest', async (req, res) => {
  try {
    const GUEST_USERNAME = '__guest__';
    let guest = db.findUserByUsername(GUEST_USERNAME);

    if (!guest) {
      // Create the permanent guest user (password not usable for normal login)
      const fakeHash = await hashPassword(crypto.randomBytes(32).toString('hex'));
      guest = db.createUser({
        username: GUEST_USERNAME,
        email: 'guest@plantiq.demo',
        password_hash: fakeHash
      });

      // Seed sample plants for the guest
      const now = new Date();
      const samplePlants = [
        { name: 'Monstera Deliciosa', species: 'Monstera deliciosa', location: 'Living Room', moisture_min: 40, moisture_max: 70, temp_min: 18, temp_max: 30, humidity_min: 50, humidity_max: 80 },
        { name: 'Peace Lily', species: 'Spathiphyllum wallisii', location: 'Bedroom', moisture_min: 50, moisture_max: 75, temp_min: 16, temp_max: 28, humidity_min: 40, humidity_max: 70 },
        { name: 'Snake Plant', species: 'Sansevieria trifasciata', location: 'Office', moisture_min: 20, moisture_max: 50, temp_min: 15, temp_max: 30, humidity_min: 30, humidity_max: 60 },
      ];

      for (const p of samplePlants) {
        const plant = db.createPlant({ ...p, user_id: guest.id });

        // Seed 7 days of readings (every 3 hours)
        for (let dayOffset = 6; dayOffset >= 0; dayOffset--) {
          for (let hour = 0; hour < 24; hour += 3) {
            const ts = new Date(now);
            ts.setDate(ts.getDate() - dayOffset);
            ts.setHours(hour, 0, 0, 0);
            db.createReading({
              plant_id: plant.id,
              moisture: Math.round(45 + Math.random() * 20),
              temperature: parseFloat((22 + Math.random() * 5).toFixed(1)),
              humidity: Math.round(55 + Math.random() * 15),
              light_level: Math.round(300 + Math.random() * 400),
              health_score: Math.round(75 + Math.random() * 20),
              recorded_at: ts.toISOString()
            });
          }
        }

        // Seed a sample journal note
        db.createNote({
          plant_id: plant.id,
          user_id: guest.id,
          content: `${p.name} is looking healthy! Leaves are vibrant and soil moisture is good.`
        });
      }
    }

    // Issue short-lived guest token (1 hour), signed with a guest-specific secret
    const token = createToken(guest.id, SECRET_KEY + ':guest');

    res.json({
      token,
      guest: true,
      user: { id: guest.id, username: 'Guest', email: guest.email }
    });
  } catch (err) {
    console.error('Guest login error:', err);
    res.status(500).json({ error: 'Guest login failed' });
  }
});

// ============================================================
// USER ROUTES
// ============================================================

app.get('/api/me', requireAuth, (req, res) => {
  const user = db.findUserById(req.user.id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  res.json({
    id: user.id,
    username: req.user.isGuest ? 'Guest' : user.username,
    email: user.email,
    isGuest: req.user.isGuest || false
  });
});

// ============================================================
// PLANT ROUTES
// ============================================================

app.get('/api/plants', requireAuth, (req, res) => {
  const plants = db.findPlantsByUserId(req.user.id);
  res.json(plants);
});

app.post('/api/plants', requireAuth, (req, res) => {
  try {
    const { name, species, location, moisture_min, moisture_max, temp_min, temp_max, humidity_min, humidity_max } = req.body;

    if (!name || !species) {
      return res.status(400).json({ error: 'Name and species required' });
    }

    const plant = db.createPlant({
      user_id: req.user.id,
      name,
      species,
      location: location || '',
      moisture_min: moisture_min || 30,
      moisture_max: moisture_max || 70,
      temp_min: temp_min || 15,
      temp_max: temp_max || 28,
      humidity_min: humidity_min || 40,
      humidity_max: humidity_max || 70
    });

    res.status(201).json(plant);
  } catch (err) {
    console.error('Create plant error:', err);
    res.status(500).json({ error: 'Failed to create plant' });
  }
});

app.get('/api/plants/:id', requireAuth, (req, res) => {
  const plant = db.findPlantById(req.params.id);

  if (!plant || plant.user_id !== req.user.id) {
    return res.status(404).json({ error: 'Plant not found' });
  }

  // Get latest reading for quick stats
  const readings = db.getReadingsByPlantId(plant.id, 1);
  const latestReading = readings[0] || null;

  res.json({
    ...plant,
    latestReading
  });
});

app.put('/api/plants/:id', requireAuth, (req, res) => {
  const plant = db.findPlantById(req.params.id);

  if (!plant || plant.user_id !== req.user.id) {
    return res.status(404).json({ error: 'Plant not found' });
  }

  const updated = db.updatePlant(req.params.id, req.body);
  res.json(updated);
});

app.delete('/api/plants/:id', requireAuth, (req, res) => {
  const plant = db.findPlantById(req.params.id);

  if (!plant || plant.user_id !== req.user.id) {
    return res.status(404).json({ error: 'Plant not found' });
  }

  db.deletePlant(req.params.id);
  res.json({ success: true });
});

// ============================================================
// READING ROUTES
// ============================================================

app.get('/api/plants/:id/readings', requireAuth, (req, res) => {
  const plant = db.findPlantById(req.params.id);

  if (!plant || plant.user_id !== req.user.id) {
    return res.status(404).json({ error: 'Plant not found' });
  }

  const limit = req.query.limit ? parseInt(req.query.limit) : 100;
  const readings = db.getReadingsByPlantId(req.params.id, limit);

  res.json(readings);
});

app.post('/api/plants/:id/readings', requireAuth, upload.single('image'), async (req, res) => {
  try {
    const plant = db.findPlantById(req.params.id);

    if (!plant || plant.user_id !== req.user.id) {
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(404).json({ error: 'Plant not found' });
    }

    const { temperature, humidity, soil_moisture } = req.body;

    if (temperature === undefined || humidity === undefined || soil_moisture === undefined) {
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({ error: 'Temperature, humidity, and soil_moisture required' });
    }

    const sensorData = {
      moisture: parseFloat(soil_moisture),
      temperature: parseFloat(temperature),
      humidity: parseFloat(humidity)
    };

    let aiAnalysis = null;
    let imagePath = null;

    if (req.file) {
      imagePath = `/uploads/${req.file.filename}`;
      // Try to analyze with OpenAI
      aiAnalysis = await analyzeImage(req.file.path, plant.name, sensorData);
    }

    // Calculate health score
    let healthScore = calculateHealthScore(sensorData, aiAnalysis?.health_score);

    const reading = db.createReading({
      plant_id: req.params.id,
      temperature: sensorData.temperature,
      humidity: sensorData.humidity,
      soil_moisture: sensorData.moisture,
      image_path: imagePath,
      ai_analysis: aiAnalysis,
      health_score: healthScore
    });

    res.status(201).json(reading);
  } catch (err) {
    console.error('Create reading error:', err);
    res.status(500).json({ error: 'Failed to create reading' });
  }
});

// ============================================================
// NOTE ROUTES
// ============================================================

app.get('/api/plants/:id/notes', requireAuth, (req, res) => {
  const plant = db.findPlantById(req.params.id);

  if (!plant || plant.user_id !== req.user.id) {
    return res.status(404).json({ error: 'Plant not found' });
  }

  const notes = db.getNotesByPlantId(req.params.id);
  res.json(notes);
});

app.post('/api/plants/:id/notes', requireAuth, (req, res) => {
  try {
    const plant = db.findPlantById(req.params.id);

    if (!plant || plant.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Plant not found' });
    }

    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Content required' });
    }

    const note = db.createNote({
      plant_id: req.params.id,
      user_id: req.user.id,
      content: content.trim()
    });

    res.status(201).json(note);
  } catch (err) {
    console.error('Create note error:', err);
    res.status(500).json({ error: 'Failed to create note' });
  }
});

// ============================================================
// IMAGE UPLOAD ROUTES
// ============================================================

app.post('/api/plants/:id/upload-image', requireAuth, upload.single('image'), async (req, res) => {
  try {
    const plant = db.findPlantById(req.params.id);

    if (!plant || plant.user_id !== req.user.id) {
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(404).json({ error: 'Plant not found' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No image provided' });
    }

    const imagePath = `/uploads/${req.file.filename}`;

    // Get latest sensor data for analysis context
    const readings = db.getReadingsByPlantId(req.params.id, 1);
    const sensorData = readings[0] ? {
      moisture: readings[0].soil_moisture,
      temperature: readings[0].temperature,
      humidity: readings[0].humidity
    } : { moisture: 50, temperature: 22, humidity: 55 };

    // Analyze with AI
    const aiAnalysis = await analyzeImage(req.file.path, plant.name, sensorData);

    res.json({
      imagePath,
      analysis: aiAnalysis
    });
  } catch (err) {
    console.error('Upload image error:', err);
    res.status(500).json({ error: 'Failed to upload image' });
  }
});

// ============================================================
// ANALYSIS ROUTES
// ============================================================

app.post('/api/plants/:id/analyze', requireAuth, async (req, res) => {
  try {
    const plant = db.findPlantById(req.params.id);

    if (!plant || plant.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Plant not found' });
    }

    const { imagePath } = req.body;

    if (!imagePath) {
      return res.status(400).json({ error: 'Image path required' });
    }

    // Get latest sensor data
    const readings = db.getReadingsByPlantId(req.params.id, 1);
    const sensorData = readings[0] ? {
      moisture: readings[0].soil_moisture,
      temperature: readings[0].temperature,
      humidity: readings[0].humidity
    } : { moisture: 50, temperature: 22, humidity: 55 };

    // Full file path for analysis
    const fullPath = imagePath.startsWith('/uploads/') ?
      path.join(__dirname, 'uploads', path.basename(imagePath)) :
      imagePath;

    const analysis = await analyzeImage(fullPath, plant.name, sensorData);

    res.json({ analysis });
  } catch (err) {
    console.error('Analysis error:', err);
    res.status(500).json({ error: 'Analysis failed' });
  }
});

// ============================================================
// DASHBOARD ROUTES
// ============================================================

app.get('/api/dashboard', requireAuth, (req, res) => {
  try {
    const plants = db.findPlantsByUserId(req.user.id);
    const readings = db.getReadings();

    let totalPlants = plants.length;
    let healthyCount = 0;
    let alertCount = 0;
    let lastReadingTime = null;
    let avgHealthScore = 0;

    plants.forEach(plant => {
      const plantReadings = readings.filter(r => r.plant_id === plant.id);
      if (plantReadings.length > 0) {
        const latest = plantReadings[0];
        if (!lastReadingTime || new Date(latest.created_at) > new Date(lastReadingTime)) {
          lastReadingTime = latest.created_at;
        }
        avgHealthScore += latest.health_score;

        if (latest.health_score >= 70) {
          healthyCount++;
        } else if (latest.health_score < 40) {
          alertCount++;
        }
      } else {
        // No readings - consider as alert
        alertCount++;
      }
    });

    if (plants.length > 0) {
      avgHealthScore = Math.round(avgHealthScore / plants.length);
    }

    res.json({
      totalPlants,
      healthyCount,
      alertCount,
      avgHealthScore,
      lastReadingTime
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Failed to get dashboard' });
  }
});

// ============================================================
// ANALYTICS ROUTES
// ============================================================

app.get('/api/analytics', requireAuth, (req, res) => {
  try {
    const plants = db.findPlantsByUserId(req.user.id);
    const allReadings = db.getReadings();

    const plantStats = plants.map(plant => {
      const plantReadings = allReadings
        .filter(r => r.plant_id === plant.id)
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

      const avgMoisture = plantReadings.length > 0 ?
        Math.round(plantReadings.reduce((sum, r) => sum + r.soil_moisture, 0) / plantReadings.length) : 0;

      const avgTemp = plantReadings.length > 0 ?
        Math.round(plantReadings.reduce((sum, r) => sum + r.temperature, 0) / plantReadings.length * 10) / 10 : 0;

      const avgHumidity = plantReadings.length > 0 ?
        Math.round(plantReadings.reduce((sum, r) => sum + r.humidity, 0) / plantReadings.length) : 0;

      return {
        id: plant.id,
        name: plant.name,
        species: plant.species,
        avgMoisture,
        avgTemp,
        avgHumidity,
        readings: plantReadings.map(r => ({
          date: r.created_at,
          moisture: r.soil_moisture,
          temperature: r.temperature,
          humidity: r.humidity,
          healthScore: r.health_score
        }))
      };
    });

    res.json({ plants: plantStats });
  } catch (err) {
    console.error('Analytics error:', err);
    res.status(500).json({ error: 'Failed to get analytics' });
  }
});

// ============================================================
// ALERTS ROUTES
// ============================================================

app.get('/api/alerts', requireAuth, (req, res) => {
  try {
    const plants = db.findPlantsByUserId(req.user.id);
    const allReadings = db.getReadings();
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const alerts = [];

    plants.forEach(plant => {
      const plantReadings = allReadings.filter(r => r.plant_id === plant.id);

      if (plantReadings.length === 0) {
        alerts.push({
          plantId: plant.id,
          plantName: plant.name,
          type: 'no-data',
          message: 'No sensor data received',
          severity: 'high'
        });
      } else {
        const latest = plantReadings[0];
        const lastReadingTime = new Date(latest.created_at);

        if (lastReadingTime < oneDayAgo) {
          alerts.push({
            plantId: plant.id,
            plantName: plant.name,
            type: 'stale-data',
            message: 'No data for more than 24 hours',
            severity: 'high'
          });
        }

        if (latest.health_score < 40) {
          alerts.push({
            plantId: plant.id,
            plantName: plant.name,
            type: 'low-health',
            message: `Health score critical: ${latest.health_score}%`,
            severity: 'critical'
          });
        } else if (latest.health_score < 70) {
          alerts.push({
            plantId: plant.id,
            plantName: plant.name,
            type: 'medium-health',
            message: `Health score low: ${latest.health_score}%`,
            severity: 'medium'
          });
        }

        if (latest.soil_moisture < plant.moisture_min) {
          alerts.push({
            plantId: plant.id,
            plantName: plant.name,
            type: 'low-moisture',
            message: `Moisture below minimum: ${latest.soil_moisture}%`,
            severity: 'medium'
          });
        }
      }
    });

    res.json({ alerts });
  } catch (err) {
    console.error('Alerts error:', err);
    res.status(500).json({ error: 'Failed to get alerts' });
  }
});

// ============================================================
// LEGACY ESP32/SUPABASE ENDPOINTS (full implementation)
// ============================================================
let supabase = null;
let openaiAzure = null;

try {
  const { createClient } = require('@supabase/supabase-js');
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  }
} catch(e) { /* supabase not configured */ }

try {
  const { AzureOpenAI } = require('openai');
  if (process.env.AZURE_OPENAI_KEY && process.env.AZURE_OPENAI_ENDPOINT) {
    openaiAzure = new AzureOpenAI({
      apiKey: process.env.AZURE_OPENAI_KEY,
      endpoint: process.env.AZURE_OPENAI_ENDPOINT,
      apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2024-02-01',
      deployment: process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o',
    });
  }
} catch(e) { /* azure openai not configured */ }

function requireApiSecret(req, res, next) {
  const secret = req.headers['x-api-secret'];
  if (process.env.API_SECRET && secret !== process.env.API_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ESP32-CAM image upload
app.post('/upload', async (req, res) => {
  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('image/jpeg')) {
    return res.status(400).json({ error: 'Expected image/jpeg' });
  }
  if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });

  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', async () => {
    try {
      const imgBuffer = Buffer.concat(chunks);
      const { error } = await supabase.storage
        .from('plant-snapshots')
        .upload('latest.jpg', imgBuffer, { contentType: 'image/jpeg', upsert: true });
      if (error) throw new Error(error.message);
      res.json({ status: 'ok', size: imgBuffer.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  req.on('error', (err) => res.status(500).json({ error: err.message }));
});

// Redirect to Supabase CDN for latest snapshot
app.get('/latest.jpg', (req, res) => {
  if (!supabase) return res.status(404).json({ error: 'Supabase not configured' });
  const { data } = supabase.storage.from('plant-snapshots').getPublicUrl('latest.jpg');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.redirect(data.publicUrl);
});

// ESP32 sensor data + Azure OpenAI decision
app.post('/api/sensor-data', requireApiSecret, async (req, res) => {
  const { moisture_pct } = req.body;
  if (typeof moisture_pct !== 'number') {
    return res.status(400).json({ error: 'moisture_pct required' });
  }
  if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });

  try {
    const { data: urlData } = supabase.storage.from('plant-snapshots').getPublicUrl('latest.jpg');
    const snapshotUrl = urlData.publicUrl;

    const { data: reading, error: readErr } = await supabase
      .from('sensor_readings')
      .insert({ moisture_pct, snapshot_url: snapshotUrl })
      .select().single();
    if (readErr) throw new Error(readErr.message);

    let aiResult = { pump: moisture_pct < 30, reason: 'Rule-based: moisture below 30%', raw: {} };
    if (openaiAzure) {
      try {
        const response = await openaiAzure.chat.completions.create({
          model: process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o',
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: `Soil moisture: ${moisture_pct}%. Should I water? Reply JSON: {"pump":true/false,"reason":"..."}` },
              { type: 'image_url', image_url: { url: snapshotUrl, detail: 'low' } }
            ]
          }],
          temperature: 0.3, max_tokens: 150, response_format: { type: 'json_object' }
        });
        const parsed = JSON.parse(response.choices[0].message.content);
        aiResult = { pump: Boolean(parsed.pump), reason: parsed.reason || '', raw: parsed };
      } catch(e) { /* use rule-based fallback */ }
    }

    const { data: decision } = await supabase.from('ai_decisions').insert({
      reading_id: reading.id, pump_on: aiResult.pump, reason: aiResult.reason, raw_response: aiResult.raw
    }).select().single();

    if (aiResult.pump) {
      await supabase.from('pump_events').insert({
        pump_on: true, trigger_source: 'auto', duration_sec: 10, decision_id: decision?.id
      });
    }
    res.json({ pump: aiResult.pump, reason: aiResult.reason });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get sensor readings from Supabase
app.get('/api/readings', async (req, res) => {
  if (!supabase) return res.json([]);
  const limit = Math.min(parseInt(req.query.limit) || 24, 100);
  try {
    const { data, error } = await supabase
      .from('sensor_readings').select('*')
      .order('created_at', { ascending: false }).limit(limit);
    if (error) throw new Error(error.message);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get pump events from Supabase
app.get('/api/pump-events', async (req, res) => {
  if (!supabase) return res.json([]);
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  try {
    const { data, error } = await supabase
      .from('pump_events').select('*')
      .order('created_at', { ascending: false }).limit(limit);
    if (error) throw new Error(error.message);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manual pump override
app.post('/api/pump-override', async (req, res) => {
  const { pump_on } = req.body;
  if (typeof pump_on !== 'boolean') return res.status(400).json({ error: 'pump_on required' });
  if (!supabase) return res.json({ success: true, pump_on });
  try {
    await supabase.from('pump_events').insert({ pump_on, trigger_source: 'manual', duration_sec: pump_on ? null : 0 });
    res.json({ success: true, pump_on });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Keep-alive ping for Render hosting
setInterval(() => {
  fetch('http://localhost:' + PORT + '/health').catch(() => {});
}, 10 * 60 * 1000);

// ============================================================
// ERROR HANDLING
// ============================================================

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ============================================================
// START SERVER
// ============================================================

app.listen(PORT, () => {
  console.log(`PlantIQ backend running on http://localhost:${PORT}`);
});
