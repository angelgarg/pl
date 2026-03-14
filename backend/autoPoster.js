/*
 * ╔══════════════════════════════════════════════════════════╗
 * ║      BhoomiIQ — Auto Social Media Poster                ║
 * ║      Posts daily to Facebook Page + Instagram           ║
 * ╚══════════════════════════════════════════════════════════╝
 *
 * Required env vars (add to Render dashboard):
 *   FB_PAGE_ID            — your Facebook Page numeric ID
 *   FB_PAGE_ACCESS_TOKEN  — long-lived Page Access Token (never expires)
 *   IG_USER_ID            — Instagram Business Account ID (linked to FB Page)
 *   IG_IMAGE_URL          — public image URL used for Instagram posts
 *                           (use your BhoomiIQ banner/logo hosted anywhere public)
 *   POST_TIME             — cron expression, default: "0 9 * * *" (9 AM IST daily)
 *   SOCIAL_API_KEY        — key to protect manual trigger endpoint
 */

'use strict';

const cron        = require('node-cron');
const https       = require('https');
const http        = require('http');
const { generateDailyContent } = require('./socialContent');

// ─── helpers ────────────────────────────────────────────────────────────────

function log(msg) {
  console.log(`[AUTO-POST ${new Date().toISOString()}] ${msg}`);
}

// Simple fetch wrapper using Node built-ins (no extra deps)
function fetchJSON(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed   = new URL(url);
    const isHttps  = parsed.protocol === 'https:';
    const lib      = isHttps ? https : http;

    const reqOpts = {
      hostname : parsed.hostname,
      path     : parsed.pathname + parsed.search,
      method   : options.method || 'GET',
      headers  : options.headers || {},
    };

    const body = options.body ? JSON.stringify(options.body) : null;
    if (body) {
      reqOpts.headers['Content-Type']   = 'application/json';
      reqOpts.headers['Content-Length'] = Buffer.byteLength(body);
    }

    const req = lib.request(reqOpts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// Truncate text to safe length
function truncate(text, max) {
  if (!text) return '';
  return text.length > max ? text.slice(0, max - 3) + '...' : text;
}

// ─── Facebook posting ────────────────────────────────────────────────────────

async function postToFacebook(content) {
  const PAGE_ID    = process.env.FB_PAGE_ID;
  const TOKEN      = process.env.FB_PAGE_ACCESS_TOKEN;

  if (!PAGE_ID || !TOKEN) {
    log('⚠️  Facebook: FB_PAGE_ID or FB_PAGE_ACCESS_TOKEN not set — skipping');
    return { skipped: true, reason: 'missing env vars' };
  }

  // Build post message — caption + hashtags
  const message = truncate(
    `${content.facebook?.caption || content.instagram?.caption || 'BhoomiIQ Daily Update'}\n\n${content.facebook?.hashtags || '#BhoomiIQ #SmartFarming #IoT'}`,
    63000 // Facebook max
  );

  const url = `https://graph.facebook.com/v19.0/${PAGE_ID}/feed`;

  try {
    const res = await fetchJSON(url, {
      method : 'POST',
      body   : { message, access_token: TOKEN },
    });

    if (res.data?.id) {
      log(`✅ Facebook posted — post ID: ${res.data.id}`);
      return { success: true, postId: res.data.id };
    } else {
      log(`❌ Facebook error: ${JSON.stringify(res.data)}`);
      return { success: false, error: res.data };
    }
  } catch (err) {
    log(`❌ Facebook exception: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// ─── Instagram posting ───────────────────────────────────────────────────────
// Instagram Graph API requires two steps:
//   1. Create a media container (image_url + caption)
//   2. Publish the container

async function postToInstagram(content) {
  const IG_USER_ID  = process.env.IG_USER_ID;
  const TOKEN       = process.env.FB_PAGE_ACCESS_TOKEN; // same token works for IG
  const IMAGE_URL   = process.env.IG_IMAGE_URL;

  if (!IG_USER_ID || !TOKEN) {
    log('⚠️  Instagram: IG_USER_ID or FB_PAGE_ACCESS_TOKEN not set — skipping');
    return { skipped: true, reason: 'missing env vars' };
  }

  if (!IMAGE_URL) {
    log('⚠️  Instagram: IG_IMAGE_URL not set — skipping (Instagram requires an image)');
    return { skipped: true, reason: 'no image URL' };
  }

  const caption = truncate(
    `${content.instagram?.caption || content.facebook?.caption || 'BhoomiIQ Daily Update'}\n\n${content.instagram?.hashtags || '#BhoomiIQ #SmartFarming #IoT'}`,
    2200 // Instagram max caption length
  );

  try {
    // Step 1 — Create media container
    const containerRes = await fetchJSON(
      `https://graph.facebook.com/v19.0/${IG_USER_ID}/media`,
      {
        method : 'POST',
        body   : {
          image_url    : IMAGE_URL,
          caption      : caption,
          access_token : TOKEN,
        },
      }
    );

    if (!containerRes.data?.id) {
      log(`❌ Instagram container error: ${JSON.stringify(containerRes.data)}`);
      return { success: false, error: containerRes.data };
    }

    const containerId = containerRes.data.id;
    log(`📦 Instagram container created: ${containerId}`);

    // Wait 5s — give Facebook time to process image before publish
    await new Promise(r => setTimeout(r, 5000));

    // Step 2 — Publish container
    const publishRes = await fetchJSON(
      `https://graph.facebook.com/v19.0/${IG_USER_ID}/media_publish`,
      {
        method : 'POST',
        body   : {
          creation_id  : containerId,
          access_token : TOKEN,
        },
      }
    );

    if (publishRes.data?.id) {
      log(`✅ Instagram posted — media ID: ${publishRes.data.id}`);
      return { success: true, mediaId: publishRes.data.id };
    } else {
      log(`❌ Instagram publish error: ${JSON.stringify(publishRes.data)}`);
      return { success: false, error: publishRes.data };
    }

  } catch (err) {
    log(`❌ Instagram exception: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// ─── Main daily post runner ──────────────────────────────────────────────────

let lastPostDate = null; // prevent double-posting on same day

async function runDailyPost(force = false) {
  const today = new Date().toDateString();

  if (!force && lastPostDate === today) {
    log('Already posted today — skipping (pass force=true to override)');
    return { skipped: true, reason: 'already posted today' };
  }

  log('🚀 Starting daily social media post...');

  // 1. Generate content via Gemini
  let content;
  try {
    content = await generateDailyContent();
    log(`📝 Content generated — type: ${content.post_type || 'unknown'}`);
  } catch (err) {
    log(`❌ Content generation failed: ${err.message}`);
    return { success: false, error: 'content generation failed' };
  }

  // 2. Post to all platforms in parallel
  const [fbResult, igResult] = await Promise.allSettled([
    postToFacebook(content),
    postToInstagram(content),
  ]);

  const results = {
    date      : today,
    post_type : content.post_type,
    facebook  : fbResult.status === 'fulfilled' ? fbResult.value : { error: fbResult.reason?.message },
    instagram : igResult.status === 'fulfilled' ? igResult.value : { error: igResult.reason?.message },
  };

  // Mark posted only if at least one platform succeeded
  const anySuccess = results.facebook?.success || results.instagram?.success;
  if (anySuccess) lastPostDate = today;

  log(`📊 Results: FB=${results.facebook?.success ? '✅' : '❌'}  IG=${results.instagram?.success ? '✅' : '❌'}`);
  return results;
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

function startAutoPoster() {
  const schedule = process.env.POST_TIME || '0 9 * * *'; // default 9 AM daily

  if (!cron.validate(schedule)) {
    console.error(`[AUTO-POST] Invalid POST_TIME cron expression: "${schedule}" — using default 9 AM`);
  }

  cron.schedule(
    cron.validate(schedule) ? schedule : '0 9 * * *',
    () => runDailyPost(),
    { timezone: 'Asia/Kolkata' }
  );

  log(`📅 Auto-poster scheduled: "${schedule}" (Asia/Kolkata)`);
}

module.exports = { startAutoPoster, runDailyPost };
