/**
 * ============================================================
 *  🌿 PLANT MONITOR — BACKEND SERVER (Node.js / Express)
 * ============================================================
 *
 *  Endpoints:
 *    POST /api/sensor-data     ← ESP32-S3 posts sensor readings + image
 *    POST /api/pump-override   ← Dashboard manual pump control
 *    GET  /api/readings        ← Dashboard fetches recent history
 *    GET  /api/pump-events     ← Dashboard pump log
 *    GET  /health              ← Health check
 *
 *  Setup:
 *    npm install
 *    cp .env.example .env   (fill in your keys)
 *    node server.js
 *
 *  Deploy: Render.com free tier works great for this.
 * ============================================================
 */

require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { AzureOpenAI } = require("openai");

const openai = new AzureOpenAI({
  apiKey: process.env.AZURE_OPENAI_KEY,
  endpoint: process.env.AZURE_OPENAI_ENDPOINT,
  apiVersion: process.env.AZURE_OPENAI_API_VERSION,
  deployment: process.env.AZURE_OPENAI_DEPLOYMENT,
});

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ────────────────────────────────────────────────
app.use(cors({ origin: '*' }));  // Restrict to your domain in production
app.use(express.json({ limit: '10mb' }));  // Large body for base64 image

// ── Clients ───────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY   // service_role key — bypasses RLS
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ── Auth middleware for ESP32 ─────────────────────────────────
function requireApiSecret(req, res, next) {
  const secret = req.headers['x-api-secret'];
  if (secret !== process.env.API_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ─────────────────────────────────────────────────────────────
//  POST /api/sensor-data
//  Called every hour by ESP32-S3
//  Body: { moisture_pct: number, image_b64?: string }
// ─────────────────────────────────────────────────────────────
app.post('/api/sensor-data', requireApiSecret, async (req, res) => {
  const { moisture_pct, image_b64 } = req.body;

  if (typeof moisture_pct !== 'number') {
    return res.status(400).json({ error: 'moisture_pct required' });
  }

  console.log(`\n📥 Sensor data received — moisture: ${moisture_pct}%`);

  try {
    // 1. Upload snapshot to Supabase Storage (if image provided)
    let snapshotUrl = null;
    if (image_b64) {
      const imgBuffer  = Buffer.from(image_b64, 'base64');
      const fileName   = `snapshot_${Date.now()}.jpg`;

      const { error: uploadErr } = await supabase.storage
        .from('plant-snapshots')
        .upload(fileName, imgBuffer, {
          contentType: 'image/jpeg',
          upsert: false,
        });

      if (uploadErr) {
        console.error('Storage upload error:', uploadErr.message);
      } else {
        const { data: urlData } = supabase.storage
          .from('plant-snapshots')
          .getPublicUrl(fileName);
        snapshotUrl = urlData.publicUrl;
        console.log(`📷 Snapshot uploaded: ${snapshotUrl}`);
      }
    }

    // 2. Insert sensor reading into DB
    const { data: reading, error: readErr } = await supabase
      .from('sensor_readings')
      .insert({ moisture_pct, snapshot_url: snapshotUrl })
      .select()
      .single();

    if (readErr) throw new Error('DB insert failed: ' + readErr.message);

    // 3. Call OpenAI GPT-4o to decide whether to water
    const aiResult = await getAIDecision(moisture_pct, snapshotUrl, image_b64);
    console.log(`🤖 AI → pump: ${aiResult.pump}, reason: ${aiResult.reason}`);

    // 4. Store AI decision
    const { data: decision, error: decErr } = await supabase
      .from('ai_decisions')
      .insert({
        reading_id:   reading.id,
        pump_on:      aiResult.pump,
        reason:       aiResult.reason,
        raw_response: aiResult.raw,
      })
      .select()
      .single();

    if (decErr) console.error('Decision insert error:', decErr.message);

    // 5. Log pump event
    if (aiResult.pump) {
      const { error: pumpErr } = await supabase
        .from('pump_events')
        .insert({
          pump_on:        true,
          trigger_source: 'auto',
          duration_sec:   10,
          decision_id:    decision?.id,
        });
      if (pumpErr) console.error('Pump event insert error:', pumpErr.message);
    }

    // 6. Return decision to ESP32-S3
    res.json({
      pump:   aiResult.pump,
      reason: aiResult.reason,
    });

  } catch (err) {
    console.error('Error processing sensor data:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
//  POST /api/pump-override
//  Called by dashboard manual override button
//  Body: { pump_on: boolean }
// ─────────────────────────────────────────────────────────────
app.post('/api/pump-override', async (req, res) => {
  const { pump_on } = req.body;
  if (typeof pump_on !== 'boolean') {
    return res.status(400).json({ error: 'pump_on (boolean) required' });
  }

  console.log(`🔧 Manual override — pump: ${pump_on ? 'ON' : 'OFF'}`);

  try {
    const { error } = await supabase
      .from('pump_events')
      .insert({
        pump_on,
        trigger_source: 'manual',
        duration_sec:   pump_on ? null : 0,
      });

    if (error) throw new Error(error.message);

    // NOTE: In a real deployment you'd also send the command
    // to the ESP32 via MQTT or a Supabase Realtime channel.
    // For now, the ESP32 polls this on its next cycle.
    res.json({ success: true, pump_on });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
//  GET /api/readings?limit=24
// ─────────────────────────────────────────────────────────────
app.get('/api/readings', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 24, 100);
  try {
    const { data, error } = await supabase
      .from('recent_readings')
      .select('*')
      .limit(limit);

    if (error) throw new Error(error.message);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
//  GET /api/pump-events?limit=50
// ─────────────────────────────────────────────────────────────
app.get('/api/pump-events', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  try {
    const { data, error } = await supabase
      .from('pump_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(error.message);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
//  GET /health
// ─────────────────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({ status: 'ok', ts: new Date() }));

// ─────────────────────────────────────────────────────────────
//  OPENAI HELPER — decides whether to turn pump on
// ─────────────────────────────────────────────────────────────
async function getAIDecision(moisturePct, snapshotUrl, imageB64) {
  const systemPrompt = `You are an expert plant care AI integrated into an IoT plant monitoring system.
You receive soil moisture data and optionally a camera image of the plant.
Decide whether to turn on the water pump RIGHT NOW.

Guidelines:
- Below 30% → almost always water
- 30-50% → water only if plant looks stressed in image
- Above 50% → do NOT water (risk of root rot)

ALWAYS respond with ONLY a JSON object, no markdown, no backticks:
{"pump": true/false, "reason": "brief 1-sentence explanation"}`;

  const userContent = [
    {
      type: 'text',
      text: `Current soil moisture: ${moisturePct}%. Should I water the plant now?`
    }
  ];

  // Add image if available
  if (imageB64) {
    userContent.push({
      type: 'image_url',
      image_url: {
        url: `data:image/jpeg;base64,${imageB64}`,
        detail: 'low'
      }
    });
  } else if (snapshotUrl) {
    userContent.push({
      type: 'image_url',
      image_url: { url: snapshotUrl, detail: 'low' }
    });
  }

  const response = await openai.chat.completions.create({
    model:       process.env.AZURE_OPENAI_DEPLOYMENT,  // Azure uses deployment name as model
    max_tokens:  150,
    temperature: 0.3,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userContent  }
    ],
    response_format: { type: 'json_object' }
  });

  const raw    = response.choices[0].message.content.trim();
  const parsed = JSON.parse(raw);

  return {
    pump:   Boolean(parsed.pump),
    reason: parsed.reason || 'No reason provided',
    raw:    parsed,
  };
}
// ─────────────────────────────────────────────────────────────
//  START SERVER
// ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🌿 Plant Monitor Backend running on port ${PORT}`);
  console.log(`   Supabase: ${process.env.SUPABASE_URL}`);
  console.log(`   Azure OpenAI endpoint: ${process.env.AZURE_OPENAI_ENDPOINT}`);
console.log(`   Deployment: ${process.env.AZURE_OPENAI_DEPLOYMENT}`);
});
