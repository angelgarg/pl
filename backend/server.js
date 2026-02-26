/**
 * ============================================================
 *  🌿 PLANT MONITOR — BACKEND SERVER (Azure OpenAI Version)
 * ============================================================
 */

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { AzureOpenAI } = require("openai");

// ─────────────────────────────────────────────
// Azure OpenAI Client
// ─────────────────────────────────────────────
const openai = new AzureOpenAI({
  apiKey: process.env.AZURE_OPENAI_KEY,
  endpoint: process.env.AZURE_OPENAI_ENDPOINT,
  apiVersion: process.env.AZURE_OPENAI_API_VERSION,
  deployment: process.env.AZURE_OPENAI_DEPLOYMENT,
});

// ─────────────────────────────────────────────
// Express Setup
// ─────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "15mb" }));

// ─────────────────────────────────────────────
// Multer + uploads folder
// ─────────────────────────────────────────────
const upload = multer({ dest: "uploads/" });
if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");

// ─────────────────────────────────────────────
// Supabase Client (service_role key required)
// ─────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ─────────────────────────────────────────────
// ESP Authentication
// ─────────────────────────────────────────────
function requireApiSecret(req, res, next) {
  const secret = req.headers["x-api-secret"];
  if (secret !== process.env.API_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// ============================================================
// POST /upload  ← ESP32-CAM pushes raw JPEG here
// ============================================================
app.post("/upload", (req, res) => {
  const contentType = req.headers["content-type"] || "";
  const dest = path.join("uploads", "latest.jpg");

  // Raw JPEG from ESP32-CAM
  if (contentType.includes("image/jpeg")) {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const imgBuffer = Buffer.concat(chunks);
      fs.writeFileSync(dest, imgBuffer);
      console.log(`📷 New image uploaded: ${imgBuffer.length} bytes`);
      res.json({ status: "ok", size: imgBuffer.length });
    });
    req.on("error", (err) => res.status(500).json({ error: err.message }));

  // Multipart fallback
  } else {
    upload.single("image")(req, res, (err) => {
      if (err || !req.file)
        return res.status(400).json({ error: "No image received" });
      fs.renameSync(req.file.path, dest);
      console.log(`📷 Multipart image uploaded: ${req.file.size} bytes`);
      res.json({ status: "ok", size: req.file.size });
    });
  }
});

// ============================================================
// GET /latest.jpg  ← Dashboard fetches latest snapshot
// ============================================================
app.get("/latest.jpg", (req, res) => {
  const imgPath = path.join(process.cwd(), "uploads", "latest.jpg");

  if (!fs.existsSync(imgPath)) {
    return res.status(404).json({ error: "No image uploaded yet" });
  }

  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.sendFile(imgPath);
});

// ============================================================
// POST /api/sensor-data
// ============================================================
app.post("/api/sensor-data", requireApiSecret, async (req, res) => {
  const { moisture_pct, image_b64 } = req.body;

  if (typeof moisture_pct !== "number") {
    return res.status(400).json({ error: "moisture_pct required" });
  }

  console.log(`\n📥 Sensor data received — moisture: ${moisture_pct}%`);

  try {
    // ── 1. Upload image if provided ───────────────────────────
    let snapshotUrl = null;

    if (image_b64 && image_b64.length > 100) {
      const imgBuffer = Buffer.from(image_b64, "base64");
      const fileName = `snapshot_${Date.now()}.jpg`;

      const { error: uploadErr } = await supabase.storage
        .from("plant-snapshots")
        .upload(fileName, imgBuffer, {
          contentType: "image/jpeg",
          upsert: false,
        });

      if (uploadErr) {
        console.error("Storage upload error:", uploadErr.message);
      } else {
        const { data } = supabase.storage
          .from("plant-snapshots")
          .getPublicUrl(fileName);
        snapshotUrl = data.publicUrl;
        console.log("📷 Snapshot uploaded:", snapshotUrl);
      }
    }

    // ── 2. Insert reading ─────────────────────────────────────
    const { data: reading, error: readErr } = await supabase
      .from("sensor_readings")
      .insert({ moisture_pct, snapshot_url: snapshotUrl })
      .select()
      .single();

    if (readErr) throw new Error(readErr.message);

    // ── 3. Ask Azure OpenAI ───────────────────────────────────
    const aiResult = await getAIDecision(
      moisture_pct,
      snapshotUrl,
      image_b64
    );

    console.log(`🤖 AI → pump: ${aiResult.pump}, reason: ${aiResult.reason}`);

    // ── 4. Store AI decision ──────────────────────────────────
    const { data: decision, error: decErr } = await supabase
      .from("ai_decisions")
      .insert({
        reading_id: reading.id,
        pump_on: aiResult.pump,
        reason: aiResult.reason,
        raw_response: aiResult.raw,
      })
      .select()
      .single();

    if (decErr) console.error("Decision insert error:", decErr.message);

    // ── 5. Log pump event ─────────────────────────────────────
    if (aiResult.pump) {
      await supabase.from("pump_events").insert({
        pump_on: true,
        trigger_source: "auto",
        duration_sec: 10,
        decision_id: decision?.id,
      });
    }

    // ── 6. Respond to ESP ─────────────────────────────────────
    res.json({
      pump: aiResult.pump,
      reason: aiResult.reason,
    });

  } catch (err) {
    console.error("❌ Error processing sensor data:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// AI Decision Function (Azure OpenAI)
// ============================================================
async function getAIDecision(moisturePct, snapshotUrl, imageB64) {

  const systemPrompt = `
You are an expert plant care AI integrated into an IoT plant monitoring system.

Guidelines:
- Below 30% → water
- 30-50% → water only if plant looks stressed
- Above 50% → do NOT water

Respond ONLY with valid JSON:
{"pump": true/false, "reason": "brief explanation"}
`;

  const userContent = [
    {
      type: "text",
      text: `Current soil moisture: ${moisturePct}%. Should I water the plant now?`
    }
  ];

  if (imageB64 && imageB64.length > 100) {
    userContent.push({
      type: "image_url",
      image_url: {
        url: `data:image/jpeg;base64,${imageB64}`,
        detail: "low"
      }
    });
  } else if (snapshotUrl) {
    userContent.push({
      type: "image_url",
      image_url: { url: snapshotUrl, detail: "low" }
    });
  }

  const response = await openai.chat.completions.create({
    model: process.env.AZURE_OPENAI_DEPLOYMENT,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent }
    ],
    temperature: 0.3,
    max_tokens: 150,
    response_format: { type: "json_object" }
  });

  let parsed;

  try {
    parsed = JSON.parse(response.choices[0].message.content);
  } catch (e) {
    console.error("AI returned invalid JSON:", response.choices[0].message.content);
    parsed = { pump: false, reason: "AI JSON parse error" };
  }

  return {
    pump: Boolean(parsed.pump),
    reason: parsed.reason || "No reason provided",
    raw: parsed,
  };
}

// ============================================================
// GET /api/readings?limit=24
// ============================================================
app.get("/api/readings", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 24, 100);

  try {
    const { data, error } = await supabase
      .from("sensor_readings")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw new Error(error.message);

    res.json(data);
  } catch (err) {
    console.error("Readings fetch error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// GET /api/pump-events?limit=50
// ============================================================
app.get("/api/pump-events", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);

  try {
    const { data, error } = await supabase
      .from("pump_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw new Error(error.message);

    res.json(data);
  } catch (err) {
    console.error("Pump events fetch error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// POST /api/pump-override
// ============================================================
app.post("/api/pump-override", async (req, res) => {
  const { pump_on } = req.body;
  if (typeof pump_on !== "boolean") {
    return res.status(400).json({ error: "pump_on (boolean) required" });
  }

  console.log(`🔧 Manual override — pump: ${pump_on ? "ON" : "OFF"}`);

  try {
    const { error } = await supabase.from("pump_events").insert({
      pump_on,
      trigger_source: "manual",
      duration_sec: pump_on ? null : 0,
    });

    if (error) throw new Error(error.message);
    res.json({ success: true, pump_on });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// HEALTH CHECK
// ============================================================
app.get("/health", (_, res) =>
  res.json({ status: "ok", ts: new Date() })
);

// ============================================================
// START SERVER
// ============================================================
app.listen(PORT, () => {
  console.log(`\n🌿 Plant Monitor Backend running on port ${PORT}`);
  console.log(`   Supabase: ${process.env.SUPABASE_URL}`);
  console.log(`   Azure OpenAI endpoint: ${process.env.AZURE_OPENAI_ENDPOINT}`);
  console.log(`   Deployment: ${process.env.AZURE_OPENAI_DEPLOYMENT}`);
});