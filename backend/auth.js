const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);

// Hash password using scrypt
async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${hash.toString('hex')}`;
}

// Verify password
async function verifyPassword(password, stored) {
  const [algo, salt, hash] = stored.split(':');
  if (algo !== 'scrypt') return false;
  const computed = await scrypt(password, salt, 64);
  return computed.toString('hex') === hash;
}

// Create token: base64(userId:issuedAt:expiresAt).hmac
// Default expiry: 7 days for regular users, pass expiryMs to override
function createToken(userId, secret, expiryMs = 7 * 24 * 60 * 60 * 1000) {
  const issuedAt  = Date.now();
  const expiresAt = issuedAt + expiryMs;
  const payload   = `${userId}:${issuedAt}:${expiresAt}`;
  const payloadB64 = Buffer.from(payload).toString('base64');
  const hmac = crypto
    .createHmac('sha256', secret)
    .update(payloadB64)
    .digest('hex');
  return `${payloadB64}.${hmac}`;
}

// Verify token — returns userId if valid and not expired, else null
function verifyToken(token, secret) {
  try {
    const [payloadB64, hmac] = token.split('.');
    if (!payloadB64 || !hmac) return null;

    const expectedHmac = crypto
      .createHmac('sha256', secret)
      .update(payloadB64)
      .digest('hex');

    if (expectedHmac !== hmac) return null;

    const payload = Buffer.from(payloadB64, 'base64').toString('utf8');
    const parts   = payload.split(':');
    const userId  = parts[0];
    // Support both old format (userId:timestamp) and new format (userId:issuedAt:expiresAt)
    if (parts.length >= 3) {
      const expiresAt = parseInt(parts[2], 10);
      if (!isNaN(expiresAt) && Date.now() > expiresAt) return null; // expired
    }
    return userId;
  } catch (err) {
    return null;
  }
}

// Parse cookies from request
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

// Auth middleware
function authMiddleware(secret) {
  return (req, res, next) => {
    const cookies = parseCookies(req);
    const token = cookies.bhoomiq_token;
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const userId = verifyToken(token, secret);
    if (!userId) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    req.user = { id: userId };
    next();
  };
}

// Optional auth middleware
function optionalAuth(secret) {
  return (req, res, next) => {
    const cookies = parseCookies(req);
    const token = cookies.bhoomiq_token;
    if (token) {
      const userId = verifyToken(token, secret);
      if (userId) {
        req.user = { id: userId };
      }
    }
    next();
  };
}

module.exports = {
  hashPassword,
  verifyPassword,
  createToken,
  verifyToken,
  parseCookies,
  authMiddleware,
  optionalAuth
};
