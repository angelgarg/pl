const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
require('dotenv').config();

const db = require('./db');
const { hashPassword, verifyPassword, createToken } = require('./auth');
const { calculateHealthScore, analyzeImage, analyzeDeviceReport, analyzeMultipleZones } = require('./ai_analysis');
const { trackNewRegistration } = require('./adminTracking');
const { generateDailyContent } = require('./socialContent');
const { startAutoPoster, runDailyPost } = require('./autoPoster');
const { saveZoneReading, getLatestZones, getDailyReport, runDailyReport, startDailyReportScheduler } = require('./dailyReport');
const { updateFarmData, getFarmStatus, getAllFarmDevices, generatePumpCommands } = require('./slaveManager');
const cloudinary = require('./cloudinary');

const app = express();
const PORT = process.env.PORT || 3001;
const SECRET_KEY = process.env.SECRET_KEY || 'super-secret-dev-key-change-in-production-bhoomiq-2024';

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

// Use memory storage so we have the Buffer available for Cloudinary upload.
// Local disk fallback still used when Cloudinary is not configured.
const storage = multer.memoryStorage();

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

// Helper: save uploaded file buffer — tries Cloudinary first, falls back to disk
async function saveUploadedImage(fileBuffer, originalName, folder = 'bhoomiq/plants') {
  // Try Cloudinary
  const cloudUrl = await cloudinary.uploadImage(fileBuffer, { folder });
  if (cloudUrl) return { path: cloudUrl, isCloud: true };

  // Disk fallback
  const ext  = path.extname(originalName || '.jpg');
  const name = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
  const fullPath = path.join(uploadsDir, name);
  fs.writeFileSync(fullPath, fileBuffer);
  return { path: `/uploads/${name}`, isCloud: false };
}

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
  return cookies.bhoomiq_token || null;
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

// ─── IST (Indian Standard Time = UTC+5:30) helpers ───────────────────────────
// Render runs in UTC — use these for any date/time shown to users or in logs
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // 19800000 ms

function getISTDate() {
  return new Date(Date.now() + IST_OFFSET_MS);
}

// Returns "YYYY-MM-DD HH:MM:SS IST"
function getISTString() {
  const d = getISTDate();
  return d.toISOString().replace('T', ' ').slice(0, 19) + ' IST';
}

// Returns date string in IST (for daily cache keys, report dates)
function getISTDateString() {
  return getISTDate().toDateString(); // e.g. "Thu Apr 03 2026"
}
// ─── Simple in-memory rate limiter (no external package needed) ──
const _rlStore = new Map();
function makeRateLimit(maxRequests, windowMs) {
  return (req, res, next) => {
    const key  = req.ip || 'unknown';
    const now  = Date.now();
    const hits = (_rlStore.get(key) || []).filter(t => t > now - windowMs);
    if (hits.length >= maxRequests) {
      return res.status(429).json({ error: 'Too many requests — please try again later.' });
    }
    hits.push(now);
    _rlStore.set(key, hits);
    // Prevent unbounded memory growth
    if (_rlStore.size > 10000) {
      const oldest = [..._rlStore.keys()][0];
      _rlStore.delete(oldest);
    }
    next();
  };
}
const loginLimit    = makeRateLimit(10,  15 * 60 * 1000); // 10 attempts / 15 min
const registerLimit = makeRateLimit(5,   60 * 60 * 1000); // 5 registrations / hour
const chatLimit     = makeRateLimit(30,  60 * 60 * 1000); // 30 AI chats / hour

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// ============================================================
// AUTH ROUTES
// ============================================================

app.post('/auth/register', registerLimit, async (req, res) => {
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

    // Notify admin + update spreadsheet (fire-and-forget — don't block response)
    trackNewRegistration(user, 'email', true).catch(() => {});

    // Create token
    const token = createToken(user.id, SECRET_KEY);

    // Set cookie (SameSite=None; Secure needed for cross-origin Vercel→Render)
    res.setHeader('Set-Cookie', `bhoomiq_token=${token}; Path=/; HttpOnly; Max-Age=${7 * 24 * 60 * 60}; SameSite=None; Secure`);

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

app.post('/auth/login', loginLimit, async (req, res) => {
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
    res.setHeader('Set-Cookie', `bhoomiq_token=${token}; Path=/; HttpOnly; Max-Age=${7 * 24 * 60 * 60}; SameSite=None; Secure`);

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
  res.setHeader('Set-Cookie', 'bhoomiq_token=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax');
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
        email: 'guest@bhoomiq.demo',
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
    const token = createToken(guest.id, SECRET_KEY + ':guest', 60 * 60 * 1000);

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
// FORGOT / RESET PASSWORD
// ============================================================

// Lazy-initialise nodemailer transporter only when needed
let _emailTransporter = null;
function getEmailTransporter() {
  if (_emailTransporter) return _emailTransporter;
  const EMAIL_USER = process.env.EMAIL_USER;
  const EMAIL_PASS = process.env.EMAIL_APP_PASSWORD;
  if (!EMAIL_USER || !EMAIL_PASS) return null;
  const nodemailer = require('nodemailer');
  _emailTransporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: { user: EMAIL_USER, pass: EMAIL_PASS },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000
  });
  return _emailTransporter;
}

const forgotLimit = makeRateLimit(3, 15 * 60 * 1000); // 3 requests / 15 min

app.post('/auth/forgot-password', forgotLimit, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    // Always respond with success to prevent email enumeration
    const user = db.findUserByEmail(email.toLowerCase().trim());
    if (!user) return res.json({ message: 'If that email exists, a reset link has been sent.' });

    const token = db.createPasswordResetToken(user.id);
    const FRONTEND_URL = process.env.FRONTEND_URL || 'https://pl-kp57-git-main-gargangel2233s-projects.vercel.app';
    const resetUrl  = `${FRONTEND_URL}/reset-password?token=${token}`;

    const transporter = getEmailTransporter();
    if (!transporter) {
      console.warn('[AUTH] EMAIL_USER / EMAIL_APP_PASSWORD not set — cannot send reset email');
      return res.json({ message: 'If that email exists, a reset link has been sent.' });
    }

    await transporter.sendMail({
      from: `"BhoomiIQ" <${process.env.EMAIL_USER}>`,
      to:   email,
      subject: '🌿 BhoomiIQ — Reset your password',
      html: `
        <div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#f0fdf4;border-radius:16px;">
          <h1 style="color:#16a34a;font-size:24px;margin-bottom:8px;">🌿 BhoomiIQ</h1>
          <h2 style="color:#1e293b;font-size:18px;margin-bottom:16px;">Reset your password</h2>
          <p style="color:#475569;margin-bottom:24px;">We received a request to reset the password for your BhoomiIQ account. Click the button below — the link expires in <strong>1 hour</strong>.</p>
          <a href="${resetUrl}" style="display:inline-block;background:#16a34a;color:white;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:16px;">Reset Password</a>
          <p style="color:#94a3b8;font-size:12px;margin-top:24px;">If you didn't request this, you can safely ignore this email. Your password will not change.</p>
        </div>`
    });

    res.json({ message: 'If that email exists, a reset link has been sent.' });
  } catch (err) {
    console.error('[AUTH] Forgot password error:', err.message);
    res.status(500).json({ error: 'Failed to send reset email' });
  }
});

app.post('/auth/reset-password', async (req, res) => {
  try {
    const { token, newPassword, confirmPassword } = req.body;
    if (!token || !newPassword) return res.status(400).json({ error: 'Token and new password required' });
    if (newPassword !== confirmPassword)  return res.status(400).json({ error: 'Passwords do not match' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const entry = db.findValidResetToken(token);
    if (!entry) return res.status(400).json({ error: 'Reset link is invalid or has expired' });

    const { hashPassword } = require('./auth');
    const password_hash = await hashPassword(newPassword);

    // Update user's password
    const users = db.getUsers();
    const idx   = users.findIndex(u => u.id === entry.user_id);
    if (idx === -1) return res.status(404).json({ error: 'User not found' });
    users[idx].password_hash = password_hash;
    users[idx].updated_at    = new Date().toISOString();
    db.saveUsers(users);
    db.consumeResetToken(token);

    res.json({ message: 'Password reset successfully. You can now log in.' });
  } catch (err) {
    console.error('[AUTH] Reset password error:', err.message);
    res.status(500).json({ error: 'Password reset failed' });
  }
});

// ============================================================
// GOOGLE SIGN-IN
// ============================================================

app.post('/auth/google', async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ error: 'Google credential required' });

    const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
    if (!GOOGLE_CLIENT_ID) return res.status(503).json({ error: 'Google Sign-In not configured' });

    // Verify with Google's tokeninfo endpoint (no extra package needed)
    const verifyRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`);
    const payload   = await verifyRes.json();

    if (!verifyRes.ok || payload.aud !== GOOGLE_CLIENT_ID) {
      return res.status(401).json({ error: 'Invalid Google token' });
    }

    const { email, name, sub: googleId } = payload;
    if (!email) return res.status(400).json({ error: 'No email from Google' });

    // Find or create user
    let user = db.findUserByEmail(email.toLowerCase());
    const isNewGoogleUser = !user;
    if (!user) {
      // New Google user — auto-register
      const { hashPassword } = require('./auth');
      const randomPwd = crypto.randomBytes(32).toString('hex');
      user = db.createUser({
        username:      name?.replace(/\s+/g, '_').toLowerCase() || `user_${googleId.slice(-6)}`,
        email:         email.toLowerCase(),
        password_hash: await hashPassword(randomPwd),
        google_id:     googleId,
        auth_provider: 'google'
      });
      // Notify admin + update spreadsheet (fire-and-forget)
      trackNewRegistration(user, 'google', true).catch(() => {});
    }

    const token = createToken(user.id, SECRET_KEY);
    res.setHeader('Set-Cookie', `bhoomiq_token=${token}; Path=/; HttpOnly; Max-Age=${7 * 24 * 60 * 60}; SameSite=None; Secure`);
    res.json({ token, user: { id: user.id, username: user.username, email: user.email } });
  } catch (err) {
    console.error('[AUTH] Google sign-in error:', err.message);
    res.status(500).json({ error: 'Google sign-in failed' });
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
      return res.status(404).json({ error: 'Plant not found' });
    }

    const { temperature, humidity, soil_moisture } = req.body;

    if (temperature === undefined || humidity === undefined || soil_moisture === undefined) {
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
      // Save image (Cloudinary → disk fallback)
      const saved = await saveUploadedImage(req.file.buffer, req.file.originalname, 'bhoomiq/plants');
      imagePath = saved.path;
      // Analyze using base64 (memory storage — no disk path available)
      const base64 = req.file.buffer.toString('base64');
      aiAnalysis = await analyzeImage(`data:${req.file.mimetype};base64,${base64}`, plant.name, sensorData);
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

    // Save to Cloudinary (or disk fallback)
    const saved = await saveUploadedImage(req.file.buffer, req.file.originalname, 'bhoomiq/plants');
    const imagePath = saved.path;

    // Get latest sensor data for analysis context
    const readings = db.getReadingsByPlantId(req.params.id, 1);
    const sensorData = readings[0] ? {
      moisture: readings[0].soil_moisture,
      temperature: readings[0].temperature,
      humidity: readings[0].humidity
    } : { moisture: 50, temperature: 22, humidity: 55 };

    // Analyze with AI using base64 from memory buffer
    const base64 = req.file.buffer.toString('base64');
    const aiAnalysis = await analyzeImage(`data:${req.file.mimetype};base64,${base64}`, plant.name, sensorData);

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

    // If imagePath is a Cloudinary URL, fetch it for analysis
    // If it's a local /uploads/ path, resolve to disk path
    let analysisInput = imagePath;
    if (imagePath.startsWith('https://res.cloudinary.com')) {
      // Fetch from Cloudinary and convert to base64
      try {
        const fetch = require('node-fetch');
        const r = await fetch(imagePath);
        const buf = await r.buffer();
        analysisInput = `data:image/jpeg;base64,${buf.toString('base64')}`;
      } catch (_) {
        analysisInput = imagePath; // pass URL as-is — analyzeImage will handle gracefully
      }
    } else if (imagePath.startsWith('/uploads/')) {
      analysisInput = path.join(__dirname, 'uploads', path.basename(imagePath));
    }

    const analysis = await analyzeImage(analysisInput, plant.name, sensorData);

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
// ESP32-S3 DEVICE API  (no user auth — uses device key)
// ============================================================

const LEGACY_DEVICE_KEY = process.env.DEVICE_API_KEY || 'bhoomiq-device-key-change-me';

// requireDevice: accepts both the legacy env-var key AND any registered device key
function requireDevice(req, res, next) {
  const key = req.headers['x-device-key'] || req.query.device_key;
  if (!key) return res.status(401).json({ error: 'Missing device key' });

  // Check registered devices first
  const registeredDevice = db.findDeviceByKey(key);
  if (registeredDevice) {
    req.deviceRecord = registeredDevice;
    return next();
  }
  // Fall back to legacy env-var key (backward compat)
  if (key === LEGACY_DEVICE_KEY) {
    req.deviceRecord = null; // legacy — no DB record
    return next();
  }
  return res.status(401).json({ error: 'Invalid device key' });
}

// Pending manual pump command (set by dashboard, consumed by ESP32)
let pendingPumpCmd = null;

// SSE clients — keyed by userId so each user only receives their own device events
const sseClients = new Map(); // Map<userId, Set<res>>

function broadcastSSE(data, userId) {
  if (!userId) return; // safety guard — never broadcast without a target
  const clients = sseClients.get(userId);
  if (!clients) return;
  clients.forEach(client => {
    try { client.write(`data: ${JSON.stringify(data)}\n\n`); } catch (_) {}
  });
}

// Helper: get all device IDs that belong to a user
function getUserDeviceIds(userId) {
  return db.findDevicesByUserId(userId).map(d => d.id);
}

// Helper: latest device reading for a specific user
function getLatestReadingForUser(userId) {
  const ids = getUserDeviceIds(userId);
  if (!ids.length) return null;
  return store_device_readings_for_user(ids, 1)[0] || null;
}

// Helper: filtered device readings for a user (newest first)
function getReadingsForUser(userId, limit = 100) {
  const ids = getUserDeviceIds(userId);
  if (!ids.length) return [];
  return store_device_readings_for_user(ids, limit);
}

function store_device_readings_for_user(deviceIds, limit) {
  const set = new Set(deviceIds);
  const results = [];
  for (const r of db.getDeviceReadings()) {
    if (set.has(r.device_id)) {
      results.push(r);
      if (results.length >= limit) break;
    }
  }
  return results;
}

// ── Main device report: ESP32 POSTs sensor data + raw JPEG ──
// POST /api/device-report?moisture=45&temperature=24.1
// Headers: Content-Type: image/jpeg  x-device-key: <key>
// Body: raw JPEG bytes (may be empty if no camera)
app.post('/api/device-report', requireDevice, async (req, res) => {
  const moisture_pct  = parseFloat(req.query.moisture    || req.query.moisture_pct || 0);
  const temperature_c = parseFloat(req.query.temperature || req.query.temperature_c || 0);
  const battery_pct   = req.query.battery !== undefined ? parseInt(req.query.battery) : null;

  // Collect raw JPEG body
  const chunks = [];
  req.on('data', c => chunks.push(c));
  await new Promise(resolve => req.on('end', resolve));
  const imgBuffer = Buffer.concat(chunks);

  let image_path = null;
  let imageBase64 = null;
  if (imgBuffer.length > 1000) {   // >1KB means we got a real image
    imageBase64 = imgBuffer.toString('base64');

    // Try Cloudinary first — permanent, survives Render redeploys
    const deviceKey = req.headers['x-device-key'] || 'unknown';
    const cloudUrl = await cloudinary.uploadImage(imgBuffer, {
      folder:   `bhoomiq/devices/${deviceKey}`,
      publicId: `latest_${deviceKey}`,  // always overwrites same ID — saves storage
      overwrite: true
    });

    if (cloudUrl) {
      image_path = cloudUrl;  // permanent Cloudinary URL
    } else {
      // Fallback: local disk (will be lost on Render redeploy, but better than nothing)
      const filename = `device_${Date.now()}.jpg`;
      const fullPath = path.join(uploadsDir, filename);
      fs.writeFileSync(fullPath, imgBuffer);
      image_path = `/uploads/${filename}`;

      // Prune old local device images (keep newest 50 when using fallback)
      try {
        const files = fs.readdirSync(uploadsDir)
          .filter(f => f.startsWith('device_'))
          .map(f => ({ name: f, mtime: fs.statSync(path.join(uploadsDir, f)).mtimeMs }))
          .sort((a, b) => b.mtime - a.mtime);
        files.slice(50).forEach(f => { try { fs.unlinkSync(path.join(uploadsDir, f.name)); } catch(_){} });
      } catch (_) {}
    }
  }

  // AI analysis (with image if available, else sensor-only fallback)
  let aiResult;
  try {
    aiResult = await analyzeDeviceReport(imageBase64 || '', { moisture_pct, temperature_c });
  } catch (err) {
    console.error('[device-report] AI error:', err.message);
    aiResult = {
      health_score: 50, visual_status: 'AI unavailable', pump_needed: moisture_pct < 30,
      pump_reason: 'Rule-based fallback', pump_duration_seconds: 7,
      alert_level: moisture_pct < 30 ? 'medium' : 'none', alerts: [], recommendations: [],
      disease_detected: 'none', growth_stage: 'vegetative', immediate_actions: []
    };
  }

  // Run multi-zone analysis in parallel (non-blocking — doesn't delay pump response)
  if (imageBase64) {
    analyzeMultipleZones(imageBase64, { moisture_pct, temperature_c })
      .then(zoneResult => {
        if (zoneResult) {
          const deviceKey = req.deviceRecord?.device_key || req.headers['x-device-key'] || 'unknown';
          saveZoneReading(deviceKey, zoneResult);
          console.log(`[ZONES] ${deviceKey} — ${zoneResult.total_zones} zones, health: ${zoneResult.overall_health}`);
        }
      })
      .catch(err => console.error('[ZONES] Error:', err.message));
  }

  // Parse slave zone data piggybacked in x-slaves-json header
  // Also extract NPK values from any NPK slave (slave_type === 1)
  let npkFromSlave = null;
  const slavesHeader = req.headers['x-slaves-json'];
  if (slavesHeader) {
    try {
      const slavesArr = JSON.parse(slavesHeader);
      const deviceKey = req.deviceRecord?.device_key || req.headers['x-device-key'] || 'unknown';

      // Find the first online NPK slave and pull its values
      const npkSlave = slavesArr.find(s => s.slave_type === 1 && s.online !== false);
      if (npkSlave && (npkSlave.npk_n > 0 || npkSlave.npk_p > 0 || npkSlave.npk_k > 0)) {
        npkFromSlave = {
          npk_n:   npkSlave.npk_n   || null,
          npk_p:   npkSlave.npk_p   || null,
          npk_k:   npkSlave.npk_k   || null,
          soil_ph: npkSlave.soil_ph || null,
          soil_ec: npkSlave.soil_ec || null,
        };
        console.log(`[NPK] ${npkSlave.slave_id} → N=${npkSlave.npk_n} P=${npkSlave.npk_p} K=${npkSlave.npk_k} mg/kg`);
      }

      updateFarmData(deviceKey, {
        moisture_pct,
        temperature_c,
        health_score: aiResult.health_score,
        ai_summary: aiResult.visual_status,
      }, slavesArr);
      console.log(`[FARM] ${deviceKey} — ${slavesArr.length} slave zone(s) updated`);
    } catch (e) {
      console.warn('[FARM] Failed to parse x-slaves-json:', e.message);
    }
  }

  // Merge manual pump command if queued
  const manualCmd = pendingPumpCmd;
  pendingPumpCmd = null;
  // Safety gate: never pump if soil moisture is already sufficient (>= 60%)
  // This prevents the AI from triggering the pump when soil is already wet
  const pump_activated = (moisture_pct < 60) && (aiResult.pump_needed || !!manualCmd);
  const pump_duration_ms = manualCmd
    ? manualCmd.duration
    : (aiResult.pump_duration_seconds || 7) * 1000;

  // Update device last_seen_at in IST
  if (req.deviceRecord) {
    db.updateDevice(req.deviceRecord.id, { last_seen_at: getISTString(), is_active: true });
  }

  // Save to DB
  const reading = db.createDeviceReading({
    device_id: req.deviceRecord ? req.deviceRecord.id : null,
    moisture_pct, temperature_c, battery_pct, image_path,
    ai_health_score:      aiResult.health_score,
    ai_pump:              pump_activated,
    ai_pump_reason:       aiResult.pump_reason,
    ai_alert_level:       aiResult.alert_level,
    ai_alerts:            aiResult.alerts             || [],
    ai_visual_status:     aiResult.visual_status,
    ai_recommendations:   aiResult.recommendations    || [],
    ai_disease:           aiResult.disease_detected,
    ai_growth_stage:      aiResult.growth_stage,
    ai_immediate_actions: aiResult.immediate_actions  || [],
    ai_animal_detected:   aiResult.animal_detected    || false,
    ai_animal_type:       aiResult.animal_type        || 'none',
    ai_animal_threat:     aiResult.animal_threat_level || 'none',
    pump_activated,
    pump_duration_ms: pump_activated ? pump_duration_ms : 0,
    // NPK values from NPK slave (null if no NPK slave reported this cycle)
    ...(npkFromSlave || {})
  });

  // Push to the device owner's live-stream clients only
  const deviceOwnerId = req.deviceRecord ? req.deviceRecord.user_id : null;
  if (deviceOwnerId) broadcastSSE(reading, deviceOwnerId);

  const buzzer = aiResult.alert_level === 'high'
    || aiResult.alert_level === 'critical'
    || (aiResult.animal_detected && aiResult.animal_threat_level !== 'none');

  res.json({
    pump:             pump_activated,
    duration_ms:      pump_activated ? pump_duration_ms : 0,
    reason:           aiResult.pump_reason,
    health_score:     aiResult.health_score,
    alert_level:      aiResult.alert_level,
    buzzer,
    animal_detected:  aiResult.animal_detected  || false,
    animal_type:      aiResult.animal_type       || 'none',
    animal_threat:    aiResult.animal_threat_level || 'none',
    server_ist:       getISTString()   // server-side IST timestamp for this report
  });
});

// ══════════════════════════════════════════════════════════════
//  FARM / SLAVE ZONE ENDPOINTS
// ══════════════════════════════════════════════════════════════

// GET /api/farm/status?device_key=xxx
// Returns master + all slave zone data for a device
app.get('/api/farm/status', requireAuth, (req, res) => {
  const deviceKey = req.query.device_key;
  if (!deviceKey) return res.status(400).json({ error: 'device_key required' });
  // Ownership check — must be the requesting user's device
  const device = db.findDeviceByKey(deviceKey);
  if (!device || device.user_id !== req.user.id) return res.status(403).json({ error: 'Not your device' });
  const status = getFarmStatus(deviceKey);
  if (!status) return res.json({ zones: [], total_zones: 0, slave_count: 0, message: 'No data yet — waiting for device to report' });
  res.json(status);
});

// GET /api/farm/all  — all farm devices belonging to the requesting user
app.get('/api/farm/all', requireAuth, (req, res) => {
  const userDeviceKeys = db.findDevicesByUserId(req.user.id).map(d => d.device_key).filter(Boolean);
  const result = userDeviceKeys.map(key => getFarmStatus(key)).filter(Boolean);
  res.json(result);
});

// POST /api/farm/pump-command  — manual pump for a specific slave zone
// Body: { device_key, slave_id, pump_on, pump_ms }
app.post('/api/farm/pump-command', requireAuth, (req, res) => {
  if (req.user.isGuest) return res.status(403).json({ error: 'Guests cannot send pump commands' });
  const { device_key, slave_id, pump_on, pump_ms } = req.body;
  if (!device_key || !slave_id) return res.status(400).json({ error: 'device_key and slave_id required' });
  // Ownership check — must be the requesting user's device
  const device = db.findDeviceByKey(device_key);
  if (!device || device.user_id !== req.user.id) return res.status(403).json({ error: 'Not your device' });
  // Store command — master will pick it up on next poll
  if (!global._slavePumpCommands) global._slavePumpCommands = {};
  if (!global._slavePumpCommands[device_key]) global._slavePumpCommands[device_key] = {};
  global._slavePumpCommands[device_key][slave_id] = {
    pump_on: !!pump_on,
    pump_ms: pump_ms || 6000,
    queued_at: Date.now(),
  };
  console.log(`[FARM] Queued pump command: ${device_key}/${slave_id} pump=${pump_on}`);
  res.json({ success: true, message: `Pump command queued for ${slave_id}` });
});

// ── Live SSE stream ──────────────────────────────────────────
app.get('/api/live-stream', requireAuth, (req, res) => {
  // CORS for SSE (must allow cross-origin from Vercel)
  const origin = req.headers.origin || '';
  if (!origin || allowedOrigins.includes(origin) || /\.vercel\.app$/.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const userId = req.user.id;

  // Send THIS user's latest reading immediately (not anyone else's)
  const latest = getLatestReadingForUser(userId);
  if (latest) res.write(`data: ${JSON.stringify(latest)}\n\n`);

  // Register in per-user client map
  if (!sseClients.has(userId)) sseClients.set(userId, new Set());
  sseClients.get(userId).add(res);

  const heartbeat = setInterval(() => { try { res.write(': ping\n\n'); } catch (_) {} }, 25000);
  req.on('close', () => {
    clearInterval(heartbeat);
    const clients = sseClients.get(userId);
    if (clients) {
      clients.delete(res);
      if (clients.size === 0) sseClients.delete(userId);
    }
  });
});

// ── Latest reading ───────────────────────────────────────────
app.get('/api/device/latest', requireAuth, (req, res) => {
  res.json(getLatestReadingForUser(req.user.id) || {});
});

// ── History ──────────────────────────────────────────────────
app.get('/api/device/history', requireAuth, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || 100), 500);
  res.json(getReadingsForUser(req.user.id, limit));
});

// ── Manual pump trigger from dashboard ───────────────────────
app.post('/api/pump/manual', requireAuth, (req, res) => {
  if (req.user.isGuest) return res.status(403).json({ error: 'Guests cannot control the pump' });
  const duration_ms = Math.min(parseInt(req.body.duration_ms || 5000), 30000);
  pendingPumpCmd = { duration: duration_ms, triggeredBy: req.user.id, at: Date.now() };
  console.log(`[PUMP] Manual command queued — ${duration_ms}ms`);
  res.json({ success: true, message: `Pump will activate for ${duration_ms / 1000}s on next device report` });
});

// ── Device stats summary ─────────────────────────────────────
app.get('/api/device/stats', requireAuth, (req, res) => {
  const history = getReadingsForUser(req.user.id, 100);
  if (!history.length) return res.json({ count: 0 });

  const moistures = history.map(r => r.moisture_pct).filter(v => v > 0);
  const temps     = history.map(r => r.temperature_c).filter(v => v !== 0);
  const pumpCount = history.filter(r => r.pump_activated).length;
  const latest    = history[0];

  res.json({
    count: history.length,
    latest_health_score:  latest.ai_health_score,
    latest_alert_level:   latest.ai_alert_level,
    latest_animal_detected: latest.ai_animal_detected || false,
    latest_animal_type:     latest.ai_animal_type     || 'none',
    latest_animal_threat:   latest.ai_animal_threat   || 'none',
    avg_moisture: moistures.length ? Math.round(moistures.reduce((a,b)=>a+b,0)/moistures.length) : null,
    avg_temp:     temps.length     ? parseFloat((temps.reduce((a,b)=>a+b,0)/temps.length).toFixed(1)) : null,
    pump_activations_last_100: pumpCount,
    last_updated: latest.created_at
  });
});

// ============================================================
// FIELDS ROUTES  (commercial multi-field feature)
// ============================================================

app.get('/api/fields', requireAuth, (req, res) => {
  const fields = db.findFieldsByUserId(req.user.id);
  // Attach device count per field
  const result = fields.map(f => ({
    ...f,
    device_count: db.findDevicesByFieldId(f.id).length
  }));
  res.json(result);
});

app.post('/api/fields', requireAuth, (req, res) => {
  if (req.user.isGuest) return res.status(403).json({ error: 'Guests cannot create fields' });
  const { name, description, boundary, center_lat, center_lng } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Field name required' });
  const field = db.createField({
    user_id: req.user.id,
    name: name.trim(),
    description: description || '',
    boundary: boundary || null,
    center_lat: center_lat || null,
    center_lng: center_lng || null
  });
  res.status(201).json(field);
});

app.get('/api/fields/:id', requireAuth, (req, res) => {
  const field = db.findFieldById(req.params.id);
  if (!field || field.user_id !== req.user.id) return res.status(404).json({ error: 'Field not found' });
  const devices = db.findDevicesByFieldId(field.id).map(d => ({
    ...d,
    device_key: undefined   // never expose key in list
  }));
  res.json({ ...field, devices });
});

app.put('/api/fields/:id', requireAuth, (req, res) => {
  const field = db.findFieldById(req.params.id);
  if (!field || field.user_id !== req.user.id) return res.status(404).json({ error: 'Field not found' });
  if (req.user.isGuest) return res.status(403).json({ error: 'Guests cannot edit fields' });
  const { name, description, boundary, center_lat, center_lng } = req.body;
  const updated = db.updateField(req.params.id, {
    ...(name        !== undefined && { name: name.trim() }),
    ...(description !== undefined && { description }),
    ...(boundary    !== undefined && { boundary }),
    ...(center_lat  !== undefined && { center_lat }),
    ...(center_lng  !== undefined && { center_lng })
  });
  res.json(updated);
});

app.delete('/api/fields/:id', requireAuth, (req, res) => {
  const field = db.findFieldById(req.params.id);
  if (!field || field.user_id !== req.user.id) return res.status(404).json({ error: 'Field not found' });
  if (req.user.isGuest) return res.status(403).json({ error: 'Guests cannot delete fields' });
  db.deleteField(req.params.id);
  res.json({ success: true });
});

// ============================================================
// DEVICES ROUTES  (commercial multi-device feature)
// ============================================================

app.get('/api/fields/:fieldId/devices', requireAuth, (req, res) => {
  const field = db.findFieldById(req.params.fieldId);
  if (!field || field.user_id !== req.user.id) return res.status(404).json({ error: 'Field not found' });
  // device_key included — these belong to the authenticated user's field
  const devices = db.findDevicesByFieldId(field.id);
  res.json(devices);
});

// Create device — returns key ONCE
app.post('/api/fields/:fieldId/devices', requireAuth, (req, res) => {
  if (req.user.isGuest) return res.status(403).json({ error: 'Guests cannot create devices' });
  const field = db.findFieldById(req.params.fieldId);
  if (!field || field.user_id !== req.user.id) return res.status(404).json({ error: 'Field not found' });
  const { name, location_lat, location_lng } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Device name required' });
  const device = db.createDevice({
    user_id: req.user.id,
    field_id: field.id,
    name: name.trim(),
    location_lat: location_lat || null,
    location_lng: location_lng || null
  });
  // Return key ONCE (included in device object from createDevice)
  console.log(`[DEVICE] Created "${device.name}" key=${device.device_key}`);
  res.status(201).json(device); // _key_shown: true is part of the object
});

// Also allow creating a device without a field
app.post('/api/devices', requireAuth, (req, res) => {
  if (req.user.isGuest) return res.status(403).json({ error: 'Guests cannot create devices' });
  const { name, field_id, location_lat, location_lng } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Device name required' });
  if (field_id) {
    const field = db.findFieldById(field_id);
    if (!field || field.user_id !== req.user.id) return res.status(404).json({ error: 'Field not found' });
  }
  const device = db.createDevice({
    user_id: req.user.id,
    field_id: field_id || null,
    name: name.trim(),
    location_lat: location_lat || null,
    location_lng: location_lng || null
  });
  console.log(`[DEVICE] Created "${device.name}" key=${device.device_key}`);
  res.status(201).json(device);
});

app.get('/api/devices', requireAuth, (req, res) => {
  // device_key IS included — user owns these devices and needs the key
  // to configure firmware and call device-specific APIs (farm/status, etc.)
  const devices = db.findDevicesByUserId(req.user.id);
  res.json(devices);
});

app.put('/api/devices/:id', requireAuth, (req, res) => {
  const device = db.findDeviceById(req.params.id);
  if (!device || device.user_id !== req.user.id) return res.status(404).json({ error: 'Device not found' });
  if (req.user.isGuest) return res.status(403).json({ error: 'Guests cannot edit devices' });
  const { name, location_lat, location_lng, field_id, is_active } = req.body;
  const updated = db.updateDevice(req.params.id, {
    ...(name         !== undefined && { name: name.trim() }),
    ...(location_lat !== undefined && { location_lat }),
    ...(location_lng !== undefined && { location_lng }),
    ...(field_id     !== undefined && { field_id }),
    ...(is_active    !== undefined && { is_active })
  });
  res.json({ ...updated, device_key: undefined });
});

app.delete('/api/devices/:id', requireAuth, (req, res) => {
  const device = db.findDeviceById(req.params.id);
  if (!device || device.user_id !== req.user.id) return res.status(404).json({ error: 'Device not found' });
  if (req.user.isGuest) return res.status(403).json({ error: 'Guests cannot delete devices' });
  db.deleteDevice(req.params.id);
  res.json({ success: true });
});

// Get latest reading for a specific device
app.get('/api/devices/:id/latest', requireAuth, (req, res) => {
  const device = db.findDeviceById(req.params.id);
  if (!device || device.user_id !== req.user.id) return res.status(404).json({ error: 'Device not found' });
  res.json(db.getLatestDeviceReadingByDeviceId(device.id) || {});
});

// ============================================================
// LEGACY ESP32/SUPABASE ENDPOINTS (full implementation)
// ============================================================
let supabase = null;

try {
  const { createClient } = require('@supabase/supabase-js');
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  }
} catch(e) { /* supabase not configured */ }

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
    const GEMINI_KEY_LEGACY = process.env.GEMINI_API_KEY || '';
    if (GEMINI_KEY_LEGACY) {
      try {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY_LEGACY}`;
        const gRes = await fetch(geminiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `Soil moisture: ${moisture_pct}%. Should I water? Reply JSON only: {"pump":true/false,"reason":"..."}` }] }],
            generationConfig: { temperature: 0.3, maxOutputTokens: 150, responseMimeType: 'application/json' }
          })
        });
        if (gRes.ok) {
          const gData = await gRes.json();
          const text  = gData.candidates?.[0]?.content?.parts?.[0]?.text || '';
          const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
          aiResult = { pump: Boolean(parsed.pump), reason: parsed.reason || '', raw: parsed };
        }
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

// ============================================================
// AI CHAT — /api/chat
// Interactive "Ask BhoomiIQ" — All 10 major Indian languages
// ============================================================

// Language-specific system prompts for all 10 supported languages
const CHAT_SYSTEM_PROMPTS = {
  en: `You are BhoomiIQ AI — an expert agricultural assistant. You help farmers with questions about plant health, soil conditions, irrigation, pest control, and crop care. Always respond in clear, simple English. Keep answers concise and practical.`,
  hi: `आप BhoomiIQ AI हैं — एक विशेषज्ञ कृषि सहायक। आप किसानों को उनके पौधों, मिट्टी की सेहत, सिंचाई, कीट नियंत्रण और फसल देखभाल के बारे में सलाह देते हैं। हमेशा सरल हिंदी में जवाब दें। छोटे और स्पष्ट जवाब दें।`,
  mr: `तुम्ही BhoomiIQ AI आहात — एक तज्ञ कृषी सहाय्यक. तुम्ही शेतकऱ्यांना वनस्पतींचे आरोग्य, माती, सिंचन, कीड नियंत्रण आणि पीक काळजी याबद्दल मार्गदर्शन करता. नेहमी सोप्या मराठीत उत्तर द्या. संक्षिप्त आणि व्यावहारिक उत्तरे द्या.`,
  pa: `ਤੁਸੀਂ BhoomiIQ AI ਹੋ — ਇੱਕ ਮਾਹਿਰ ਖੇਤੀਬਾੜੀ ਸਹਾਇਕ। ਤੁਸੀਂ ਕਿਸਾਨਾਂ ਨੂੰ ਪੌਦਿਆਂ ਦੀ ਸਿਹਤ, ਮਿੱਟੀ, ਸਿੰਚਾਈ, ਕੀਟ ਨਿਯੰਤਰਣ ਅਤੇ ਫ਼ਸਲ ਦੀ ਦੇਖਭਾਲ ਬਾਰੇ ਮਦਦ ਕਰਦੇ ਹੋ। ਹਮੇਸ਼ਾ ਸਰਲ ਪੰਜਾਬੀ ਵਿੱਚ ਜਵਾਬ ਦਿਓ। ਸੰਖੇਪ ਅਤੇ ਅਮਲੀ ਜਵਾਬ ਦਿਓ।`,
  ta: `நீங்கள் BhoomiIQ AI — ஒரு நிபுணர் விவசாய உதவியாளர். நீங்கள் விவசாயிகளுக்கு தாவர ஆரோக்கியம், மண், நீர்ப்பாசனம், பூச்சி கட்டுப்பாடு மற்றும் பயிர் பராமரிப்பு பற்றி உதவுகிறீர்கள். எப்போதும் எளிய தமிழில் பதில் சொல்லுங்கள். சுருக்கமான மற்றும் நடைமுறை பதில்கள் கொடுங்கள்.`,
  te: `మీరు BhoomiIQ AI — ఒక నిపుణ వ్యవసాయ సహాయకుడు. మీరు రైతులకు మొక్కల ఆరోగ్యం, నేల, నీటిపారుదల, చీడపీడల నియంత్రణ మరియు పంట సంరక్షణ గురించి సహాయం చేస్తారు. ఎల్లప్పుడూ సరళమైన తెలుగులో జవాబు ఇవ్వండి. సంక్షిప్తంగా మరియు ఆచరణాత్మకంగా జవాబు ఇవ్వండి.`,
  kn: `ನೀವು BhoomiIQ AI — ಒಬ್ಬ ತಜ್ಞ ಕೃಷಿ ಸಹಾಯಕ. ನೀವು ರೈತರಿಗೆ ಸಸ್ಯ ಆರೋಗ್ಯ, ಮಣ್ಣು, ನೀರಾವರಿ, ಕೀಟ ನಿಯಂತ್ರಣ ಮತ್ತು ಬೆಳೆ ಆರೈಕೆ ಬಗ್ಗೆ ಸಹಾಯ ಮಾಡುತ್ತೀರಿ. ಯಾವಾಗಲೂ ಸರಳ ಕನ್ನಡದಲ್ಲಿ ಉತ್ತರಿಸಿ. ಸಂಕ್ಷಿಪ್ತ ಮತ್ತು ಪ್ರಾಯೋಗಿಕ ಉತ್ತರಗಳನ್ನು ನೀಡಿ.`,
  gu: `તમે BhoomiIQ AI છો — એક નિષ્ણાત કૃષિ સહાયક. તમે ખેડૂતોને છોડ, માટી, સિંચાઈ, જીવાત નિયંત્રણ અને પાકની સંભાળ અંગે મદદ કરો છો. હંમેશા સરળ ગુજરાતીમાં જવાબ આપો. સંક્ષિપ્ત અને વ્યવહારુ જવાબ આપો.`,
  bn: `আপনি BhoomiIQ AI — একজন বিশেষজ্ঞ কৃষি সহকারী। আপনি কৃষকদের গাছের স্বাস্থ্য, মাটি, সেচ, কীটপতঙ্গ নিয়ন্ত্রণ এবং ফসলের যত্ন সম্পর্কে সাহায্য করেন। সর্বদা সহজ বাংলায় উত্তর দিন। সংক্ষিপ্ত ও ব্যবহারিক উত্তর দিন।`,
  ml: `നിങ്ങൾ BhoomiIQ AI ആണ് — ഒരു വിദഗ്ധ കൃഷി സഹായി. നിങ്ങൾ കർഷകർക്ക് ചെടി ആരോഗ്യം, മണ്ണ്, ജലസേചനം, കീടനിയന്ത്രണം, വിള പരിചരണം എന്നിവയിൽ സഹായിക്കുന്നു. എല്ലായ്‌പ്പോഴും ലളിതമായ മലയാളത്തിൽ ഉത്തരം നൽകുക. ചുരുക്കവും പ്രായോഗികവുമായ ഉത്തരങ്ങൾ നൽകുക.`,
};

// Fallback responses when API key is not set (per language)
const FALLBACK_RESPONSES = {
  en: [
    'If soil moisture drops below 30%, water your plants immediately.',
    'Yellow leaves often indicate nitrogen deficiency — consider organic fertilizer.',
    'Water early morning to reduce evaporation and prevent fungal disease.',
    'Temperature above 35°C? Move your plant to a cooler, shaded location.',
  ],
  hi: [
    'मिट्टी की नमी 30% से कम हो तो तुरंत पानी दें।',
    'पीली पत्तियां अक्सर नाइट्रोजन की कमी का संकेत होती हैं।',
    'सुबह पानी देना सबसे अच्छा — वाष्पीकरण कम होता है।',
    'तापमान 35°C से ऊपर हो तो पौधे को छाया में रखें।',
  ],
  mr: [
    'मातीतील ओलावा 30% खाली गेल्यास लगेच पाणी द्या.',
    'पिवळी पाने नायट्रोजनच्या कमतरतेचे लक्षण असते.',
    'सकाळी पाणी देणे सर्वोत्तम — बाष्पीभवन कमी होते.',
    'तापमान 35°C पेक्षा जास्त असल्यास पीक सावलीत ठेवा.',
  ],
  pa: [
    'ਮਿੱਟੀ ਦੀ ਨਮੀ 30% ਤੋਂ ਘੱਟ ਹੋਵੇ ਤਾਂ ਤੁਰੰਤ ਪਾਣੀ ਦਿਓ।',
    'ਪੀਲੇ ਪੱਤੇ ਨਾਈਟ੍ਰੋਜਨ ਦੀ ਕਮੀ ਦਾ ਸੰਕੇਤ ਹਨ।',
    'ਸਵੇਰੇ ਪਾਣੀ ਦੇਣਾ ਸਭ ਤੋਂ ਵਧੀਆ — ਵਾਸ਼ਪੀਕਰਨ ਘੱਟ ਹੁੰਦਾ ਹੈ।',
    'ਤਾਪਮਾਨ 35°C ਤੋਂ ਵੱਧ? ਫ਼ਸਲ ਨੂੰ ਛਾਂ ਵਿੱਚ ਰੱਖੋ।',
  ],
  ta: [
    'மண் ஈரப்பதம் 30% கீழே சென்றால் உடனே தண்ணீர் பாய்ச்சுங்கள்.',
    'மஞ்சள் இலைகள் நைட்ரஜன் குறைபாட்டின் அறிகுறி.',
    'காலை நேரத்தில் தண்ணீர் பாய்ச்சுவது சிறந்தது.',
    'வெப்பநிலை 35°C மேல் இருந்தால் பயிரை நிழலில் வையுங்கள்.',
  ],
  te: [
    'నేల తేమ 30% కంటే తక్కువైతే వెంటనే నీళ్ళు పోయండి.',
    'పసుపు ఆకులు నైట్రోజన్ లోపానికి సూచన.',
    'ఉదయం నీళ్ళు పోయడం ఉత్తమం — ఆవిరి తక్కువగా అవుతుంది.',
    'ఉష్ణోగ్రత 35°C కంటే ఎక్కువైతే పంటను నీడలో ఉంచండి.',
  ],
  kn: [
    'ಮಣ್ಣಿನ ತೇವಾಂಶ 30% ಗಿಂತ ಕಡಿಮೆಯಾದಾಗ ತಕ್ಷಣ ನೀರು ಹಾಕಿ.',
    'ಹಳದಿ ಎಲೆಗಳು ನೈಟ್ರೋಜನ್ ಕೊರತೆಯ ಸಂಕೇತ.',
    'ಬೆಳಿಗ್ಗೆ ನೀರು ಹಾಕುವುದು ಉತ್ತಮ — ಆವಿಯಾಗುವಿಕೆ ಕಡಿಮೆ.',
    'ಉಷ್ಣಾಂಶ 35°C ಮೀರಿದರೆ ಬೆಳೆಯನ್ನು ನೆರಳಿಗೆ ಸರಿಸಿ.',
  ],
  gu: [
    'જો માટીનો ભેજ 30% થી ઓછો હોય, તો તરત પાણી આપો.',
    'પીળા પાંદડા નાઇટ્રોજનની ઉણپ ني નિશાની છે.',
    'સવારે પાણી આपવું ઉત્તમ — બાષ્પ ઓછું થાય.',
    'ઉષ્ણતામાન 35°C ઉ૫ər হলে পাকने ছাயায় রাখুन।',
  ],
  bn: [
    'মাটির আর্দ্রতা 30% এর নিচে গেলে সঙ্গে সঙ্গে জল দিন।',
    'হলুদ পাতা নাইট্রোজেনের ঘাটতির লক্ষণ।',
    'সকালে জল দেওয়া সবচেয়ে ভালো — বাষ্পীভবন কম হয়।',
    'তাপমাত্রা 35°C এর উপরে? ফসলকে ছায়ায় রাখুন।',
  ],
  ml: [
    'മണ്ണിലെ ഈർപ്പം 30% ൽ കുറഞ്ഞാൽ ഉടൻ വെള്ളം ഒഴിക്കുക.',
    'മഞ്ഞ ഇലകൾ നൈട്രജൻ കുറവിന്റെ ലക്ഷണം.',
    'രാവിലെ വെള്ളം ഒഴിക്കുന്നത് ഉത്തമം — ബാഷ്പീകരണം കുറവ്.',
    'താപനില 35°C കൂടിയാൽ വിളയെ തണലിൽ വയ്ക്കുക.',
  ],
};

// Smart keyword-based fallback when Gemini is unavailable
// Matches user's question to the closest relevant answer
function keywordFallback(message, lang) {
  const m = message.toLowerCase();
  const tips = {
    en: {
      crop:     'For crop selection, consider your soil type and season. In summer: okra, cucumber, moong dal work well. In winter: wheat, mustard, peas. Check local KVK recommendations for your region.',
      plant:    'For plant selection, match the plant to your climate zone. Tropical plants need 25-35°C. Check if your soil pH (6-7 is ideal for most plants) matches the plant requirements.',
      water:    'Water when soil moisture drops below 40%. Early morning (6-9 AM) is best — reduces evaporation by 30% and prevents fungal disease. Avoid watering in the afternoon heat.',
      disease:  'Common diseases: powdery mildew (white powder on leaves) — spray neem oil. Early blight (brown spots) — use mancozeb 2g/L. Yellow mosaic — remove infected plants immediately.',
      pest:     'For pest control: neem oil spray (5ml/L) works for most soft-bodied insects. For fungus gnats in soil, let the top 2cm dry between waterings. For mites, spray underside of leaves.',
      soil:     'Ideal soil moisture is 40-70%. pH 6-7 suits most crops. Add organic compost to improve water retention. Test soil pH with a simple kit — available at any agri shop.',
      fertilizer: 'For fertilizer: NPK 19-19-19 is good all-purpose. Apply when moisture is 50-70% (not dry soil). Organic: cow dung compost, vermicompost are excellent for long-term soil health.',
      temp:     'If temperature is above 35°C, provide shade cloth (50% shade) and increase watering frequency. Below 10°C, protect sensitive plants with covers. Most crops do best at 20-30°C.',
      pump:     'Your BhoomiIQ system will automatically activate the valve when moisture drops below threshold. You can also manually trigger watering from the dashboard.',
      default:  'I can help with crop selection, watering schedules, disease identification, soil health, pest control, and fertilizer recommendations. What specific problem are you facing with your plants?'
    },
    hi: {
      crop:     'फसल चुनाव के लिए: गर्मियों में भिंडी, खीरा, मूंग अच्छे रहते हैं। सर्दियों में गेहूं, सरसों, मटर। अपनी मिट्टी की जांच करवाएं।',
      plant:    'पौधे का चुनाव जलवायु के अनुसार करें। अधिकांश पौधों के लिए pH 6-7 सबसे अच्छा है।',
      water:    'पानी सुबह 6-9 बजे दें। मिट्टी की नमी 40% से कम हो तो तुरंत पानी दें।',
      disease:  'सफेद पाउडर — नीम तेल स्प्रे करें। भूरे धब्बे — मैन्कोज़ेब 2g/L। पीले पत्ते — नाइट्रोजन की कमी, यूरिया दें।',
      pest:     'कीट नियंत्रण: नीम तेल 5ml/L पानी में मिलाकर स्प्रे करें। यह अधिकांश कीटों के लिए काम करता है।',
      soil:     'आदर्श नमी 40-70%। pH 6-7 अधिकांश फसलों के लिए सही है। जैविक खाद डालें।',
      default:  'मैं फसल, पानी, बीमारी, मिट्टी, कीट और खाद के बारे में मदद कर सकता हूं। आपकी क्या समस्या है?'
    }
  };

  const langTips = tips[lang] || tips.en;
  if (m.includes('crop') || m.includes('फसल') || m.includes('grow') || m.includes('plant') || m.includes('उगा')) return langTips.crop || langTips.plant || langTips.default;
  if (m.includes('water') || m.includes('irrigat') || m.includes('पानी') || m.includes('सिंच')) return langTips.water || langTips.default;
  if (m.includes('disease') || m.includes('blight') || m.includes('fungus') || m.includes('बीमारी') || m.includes('रोग')) return langTips.disease || langTips.default;
  if (m.includes('pest') || m.includes('insect') || m.includes('bug') || m.includes('कीट') || m.includes('कीड़')) return langTips.pest || langTips.default;
  if (m.includes('soil') || m.includes('मिट्टी') || m.includes('moisture') || m.includes('नमी')) return langTips.soil || langTips.default;
  if (m.includes('fertiliz') || m.includes('खाद') || m.includes('npk') || m.includes('compost')) return langTips.fertilizer || langTips.default;
  if (m.includes('temp') || m.includes('heat') || m.includes('cold') || m.includes('तापमान')) return langTips.temp || langTips.default;
  if (m.includes('pump') || m.includes('valve') || m.includes('पंप')) return langTips.pump || langTips.default;
  return langTips.default;
}

app.post('/api/chat', requireAuth, chatLimit, async (req, res) => {
  const { message, lang, history = [] } = req.body;
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message required' });
  }

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
  const safeLang       = (lang && CHAT_SYSTEM_PROMPTS[lang]) ? lang : 'en';
  const systemPrompt   = CHAT_SYSTEM_PROMPTS[safeLang];

  console.log(`[CHAT] message="${message.slice(0,60)}" lang=${safeLang} key=${GEMINI_API_KEY ? 'SET' : 'MISSING'}`);

  // Fallback when no API key — keyword-aware, not random
  if (!GEMINI_API_KEY) {
    const reply = keywordFallback(message, safeLang);
    return res.json({ reply });
  }

  try {
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

    // Build conversation history in Gemini role format
    // history is [{role:'user'|'ai', content:'...'}] from frontend
    const contents = [];

    // Include up to last 6 turns (12 messages) for context
    const recentHistory = history.slice(-12);
    for (const msg of recentHistory) {
      if (msg.role === 'user') {
        contents.push({ role: 'user',  parts: [{ text: msg.content }] });
      } else if (msg.role === 'ai') {
        contents.push({ role: 'model', parts: [{ text: msg.content }] });
      }
    }
    // Add current message
    contents.push({ role: 'user', parts: [{ text: message.slice(0, 800) }] });

    const response = await fetch(geminiUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: {
          temperature:     0.7,
          maxOutputTokens: 400
        }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[CHAT] Gemini error:', response.status, errText.slice(0, 200));
      return res.json({ reply: keywordFallback(message, safeLang) });
    }

    const data  = await response.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!reply) {
      console.warn('[CHAT] Empty Gemini response:', JSON.stringify(data).slice(0, 200));
      return res.json({ reply: keywordFallback(message, safeLang) });
    }
    console.log(`[CHAT] OK — reply length=${reply.length}`);
    res.json({ reply });
  } catch (err) {
    console.error('[CHAT] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// ============================================================
// PLANT ZONE ANALYSIS API
// ============================================================

// GET /api/zones/latest?device_key=piq-xxx
// Returns latest multi-zone analysis snapshot for a device
app.get('/api/zones/latest', requireAuth, async (req, res) => {
  const deviceKey = req.query.device_key;
  if (!deviceKey) return res.status(400).json({ error: 'device_key required' });
  const device = db.findDeviceByKey(deviceKey);
  if (!device || device.user_id !== req.user.id) return res.status(403).json({ error: 'Not your device' });
  const latest = getLatestZones(deviceKey);
  if (!latest) return res.status(404).json({ error: 'No zone data yet for this device' });
  res.json(latest);
});

// GET /api/zones/daily-report?device_key=piq-xxx
// Returns today's daily plant health report (generated at 7 AM)
app.get('/api/zones/daily-report', requireAuth, async (req, res) => {
  const deviceKey = req.query.device_key;
  if (!deviceKey) return res.status(400).json({ error: 'device_key required' });
  const device = db.findDeviceByKey(deviceKey);
  if (!device || device.user_id !== req.user.id) return res.status(403).json({ error: 'Not your device' });
  const report = getDailyReport(deviceKey);
  if (!report) {
    return res.status(404).json({
      error: 'No daily report yet',
      hint: 'Report generates at 7 AM IST or use /api/zones/generate-report to trigger manually'
    });
  }
  res.json(report);
});

// POST /api/zones/generate-report?device_key=piq-xxx
// Manually trigger daily report generation (for testing)
app.post('/api/zones/generate-report', requireAuth, async (req, res) => {
  const deviceKey = req.query.device_key;
  if (deviceKey) {
    const device = db.findDeviceByKey(deviceKey);
    if (!device || device.user_id !== req.user.id) return res.status(403).json({ error: 'Not your device' });
  }
  try {
    await runDailyReport();
    const report = deviceKey ? getDailyReport(deviceKey) : { message: 'Reports generated for all devices' };
    res.json(report || { message: 'Generated — check /api/zones/daily-report' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SOCIAL MEDIA CONTENT API
// ============================================================

// Cache so Make.com can call multiple times without re-generating
let _socialCache = { date: null, content: null };

// GET /api/social/daily-content
// Called by Make.com daily to get AI-generated post content
// Protected by SOCIAL_API_KEY env var
app.get('/api/social/daily-content', async (req, res) => {
  const apiKey = req.headers['x-api-key'] || req.query.key;
  const expected = process.env.SOCIAL_API_KEY;
  if (expected && apiKey !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const today = getISTDateString();
  // Return cached if already generated today
  if (_socialCache.date === today && _socialCache.content) {
    return res.json({ ...(_socialCache.content), cached: true });
  }

  try {
    const content = await generateDailyContent();
    _socialCache = { date: today, content };
    res.json(content);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/social/refresh
// Force regenerate today's content (optional manual trigger)
app.post('/api/social/refresh', async (req, res) => {
  const apiKey = req.headers['x-api-key'] || req.query.key;
  const expected = process.env.SOCIAL_API_KEY;
  if (expected && apiKey !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const content = await generateDailyContent();
    _socialCache = { date: new Date().toDateString(), content };
    res.json({ ...content, refreshed: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/social/post-now
// Manually trigger today's social media post (for testing or on-demand posting)
// Protected by SOCIAL_API_KEY
app.post('/api/social/post-now', async (req, res) => {
  const apiKey = req.headers['x-api-key'] || req.query.key;
  const expected = process.env.SOCIAL_API_KEY;
  if (expected && apiKey !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const force = req.query.force === 'true';
  try {
    const results = await runDailyPost(force);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/social/status
// Check today's posting status
app.get('/api/social/status', async (req, res) => {
  const apiKey = req.headers['x-api-key'] || req.query.key;
  const expected = process.env.SOCIAL_API_KEY;
  if (expected && apiKey !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.json({
    today          : new Date().toDateString(),
    schedule       : process.env.POST_TIME || '0 9 * * *',
    facebook_ready : !!(process.env.FB_PAGE_ID && process.env.FB_PAGE_ACCESS_TOKEN),
    instagram_ready: !!(process.env.IG_USER_ID && process.env.FB_PAGE_ACCESS_TOKEN && process.env.IG_IMAGE_URL),
  });
});

// Keep-alive ping for Render hosting (uses http module — works on all Node versions)
const http = require('http');
setInterval(() => {
  try {
    http.get('http://localhost:' + PORT + '/health', (res) => {
      res.resume(); // drain response
    }).on('error', () => {}); // silently ignore errors
  } catch (_) {}
}, 9 * 60 * 1000); // every 9 minutes (Render sleeps after 15 min)

// ============================================================
// ERROR HANDLING
// ============================================================

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ============================================================
// START SERVER (after DB is ready)
// ============================================================

(async () => {
  await db.initDatabase();   // load data from MongoDB (or JSON files) into memory
  app.listen(PORT, () => {
    console.log(`BhoomiIQ backend running on http://localhost:${PORT}`);
    // Start daily social media auto-poster (only when env vars are set)
    if (process.env.FB_PAGE_ID || process.env.IG_USER_ID) {
      startAutoPoster();
    } else {
      console.log('[AUTO-POST] Skipping scheduler — FB_PAGE_ID / IG_USER_ID not configured yet');
    }
    // Start daily plant report scheduler (always on)
    startDailyReportScheduler();
  });
})();
