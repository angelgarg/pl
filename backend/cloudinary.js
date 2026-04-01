/**
 * BhoomiIQ — Cloudinary image upload helper
 * Uses Cloudinary REST API directly (no SDK needed — uses form-data + node-fetch already in node_modules)
 *
 * Required env vars (set in Render dashboard):
 *   CLOUDINARY_CLOUD_NAME   — e.g. "dxxxxxxxx"
 *   CLOUDINARY_API_KEY      — e.g. "123456789012345"
 *   CLOUDINARY_API_SECRET   — e.g. "abcdefghijklmnopqrstuvwxyz"
 *
 * Get these from: https://cloudinary.com → Dashboard → API Keys
 */

'use strict';

const crypto   = require('crypto');
const FormData = require('form-data');
const fetch    = require('node-fetch');

function isConfigured() {
  return !!(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY    &&
    process.env.CLOUDINARY_API_SECRET
  );
}

/**
 * Sign Cloudinary upload params with SHA-256.
 * Excludes: file, api_key, resource_type (per Cloudinary spec).
 */
function signParams(params) {
  const sorted = Object.keys(params)
    .filter(k => !['file', 'api_key', 'resource_type'].includes(k))
    .sort()
    .map(k => `${k}=${params[k]}`)
    .join('&');
  return crypto
    .createHash('sha256')
    .update(sorted + process.env.CLOUDINARY_API_SECRET)
    .digest('hex');
}

/**
 * Upload a Buffer or base64 string to Cloudinary.
 *
 * @param {Buffer|string} imageData  — Buffer (preferred) or base64 string
 * @param {object}        options
 *   folder    {string}  Cloudinary folder name (default: 'bhoomiq')
 *   publicId  {string}  Optional fixed public_id (use for "latest" overwrite)
 *   overwrite {boolean} Whether to overwrite existing public_id (default: true)
 * @returns {Promise<string|null>} secure_url or null if Cloudinary not configured
 */
async function uploadImage(imageData, options = {}) {
  if (!isConfigured()) {
    console.warn('[CLOUDINARY] Not configured — skipping upload (set CLOUDINARY_* env vars)');
    return null;
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey    = process.env.CLOUDINARY_API_KEY;

  const timestamp = Math.floor(Date.now() / 1000);
  const folder    = options.folder    || 'bhoomiq';
  const overwrite = options.overwrite !== false; // default true

  // Build params to sign
  const params = { folder, overwrite, timestamp };
  if (options.publicId) params.public_id = options.publicId;

  const signature = signParams(params);

  // Build multipart form
  const form = new FormData();

  if (Buffer.isBuffer(imageData)) {
    form.append('file', imageData, { filename: 'image.jpg', contentType: 'image/jpeg' });
  } else {
    // base64 string — prefix as data URI
    form.append('file', `data:image/jpeg;base64,${imageData}`);
  }

  form.append('api_key',   apiKey);
  form.append('timestamp', String(timestamp));
  form.append('folder',    folder);
  form.append('overwrite', String(overwrite));
  form.append('signature', signature);
  if (options.publicId) form.append('public_id', options.publicId);

  const uploadUrl = `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`;

  try {
    const res  = await fetch(uploadUrl, { method: 'POST', body: form, timeout: 30000 });
    const data = await res.json();

    if (data.secure_url) {
      console.log(`[CLOUDINARY] Uploaded → ${data.secure_url}`);
      return data.secure_url;
    }

    // Upload failed — log error but don't throw (caller falls back gracefully)
    console.error('[CLOUDINARY] Upload error:', data.error?.message || JSON.stringify(data));
    return null;
  } catch (err) {
    console.error('[CLOUDINARY] Request failed:', err.message);
    return null;
  }
}

module.exports = { uploadImage, isConfigured };
