/**
 * AI Analysis — Azure OpenAI GPT-4o Vision Agent
 * Endpoint: https://twilio-foundry.cognitiveservices.azure.com
 * Deployment: gpt-4o
 * API version: 2025-01-01-preview
 */

const fs = require('fs');
const path = require('path');

const AZURE_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT ||
  'https://twilio-foundry.cognitiveservices.azure.com';
const AZURE_DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o';
const AZURE_API_VERSION = process.env.AZURE_OPENAI_API_VERSION || '2025-01-01-preview';
const AZURE_API_KEY = process.env.AZURE_OPENAI_API_KEY || '';

// Full URL for chat completions
const AZURE_CHAT_URL = `${AZURE_ENDPOINT}/openai/deployments/${AZURE_DEPLOYMENT}/chat/completions?api-version=${AZURE_API_VERSION}`;

// ─── RULE-BASED FALLBACK ─────────────────────────────────────

function ruleBasedDecision(moisture_pct, temperature_c) {
  const pump_needed = moisture_pct < 30;
  const alert_level =
    moisture_pct < 20 ? 'high' :
    moisture_pct < 30 ? 'medium' :
    temperature_c > 35 || temperature_c < 10 ? 'medium' : 'none';

  const alerts = [];
  if (moisture_pct < 20)  alerts.push('Critically dry soil — water immediately');
  if (moisture_pct < 30)  alerts.push('Soil moisture low — watering needed');
  if (moisture_pct > 80)  alerts.push('Soil may be overwatered');
  if (temperature_c > 35) alerts.push('Temperature too high — move plant to cooler spot');
  if (temperature_c < 10) alerts.push('Temperature too low — risk of cold damage');

  return {
    health_score: Math.max(10, 100 - (moisture_pct < 30 ? (30 - moisture_pct) * 2 : 0)),
    visual_status: 'No image — rule-based assessment only',
    pump_needed,
    pump_reason: pump_needed
      ? `Soil moisture at ${moisture_pct}% — below 30% threshold`
      : `Soil moisture at ${moisture_pct}% — adequate`,
    pump_duration_seconds: 7,
    alert_level,
    alerts,
    immediate_actions: pump_needed ? ['Activate water pump'] : [],
    recommendations: ['Install camera for AI-powered visual analysis'],
    disease_detected: 'none',
    growth_stage: 'vegetative',
    animal_detected: false,
    animal_type: 'none',
    animal_threat_level: 'none'
  };
}

// ─── AZURE GPT-4o AGENT ANALYSIS ────────────────────────────

async function analyzeDeviceReport(imageBase64, sensorData) {
  const { moisture_pct = 0, temperature_c = 0 } = sensorData;

  if (!AZURE_API_KEY) {
    console.warn('[AI] AZURE_OPENAI_API_KEY not set — using rule-based fallback');
    return ruleBasedDecision(moisture_pct, temperature_c);
  }

  const now = new Date().toISOString();
  const moistureStatus =
    moisture_pct < 20 ? 'CRITICALLY DRY' :
    moisture_pct < 30 ? 'DRY' :
    moisture_pct < 50 ? 'ADEQUATE' :
    moisture_pct < 70 ? 'MOIST' : 'WET / POSSIBLY OVERWATERED';

  const prompt = `You are PlantIQ, an expert AI plant health agent. Analyze the plant image together with the sensor data below and return a complete health report and action plan.

SENSOR DATA (recorded ${now}):
- Soil Moisture: ${moisture_pct}% → Status: ${moistureStatus}
- Ambient Temperature: ${temperature_c}°C

WATERING THRESHOLDS:
- < 20%: critically dry — water immediately, pump 10–15 s
- 20–30%: dry — water now, pump 7–10 s
- 30–50%: acceptable — water soon if trending down
- 50–70%: ideal moisture
- > 70%: wet — do NOT water (risk of root rot)

TASK: Combine visual inspection of the image with the sensor readings to produce a holistic assessment.

Respond ONLY with a valid JSON object (no markdown, no extra text):
{
  "health_score": <integer 0-100>,
  "visual_status": "<one paragraph describing what you see in the image>",
  "pump_needed": <true|false>,
  "pump_reason": "<clear reasoning combining sensor + visual evidence>",
  "pump_duration_seconds": <integer 5-30>,
  "alert_level": "<none|low|medium|high|critical>",
  "alerts": ["<specific issue 1>", "<specific issue 2>"],
  "immediate_actions": ["<urgent action 1>"],
  "recommendations": ["<care tip 1>", "<care tip 2>", "<care tip 3>"],
  "disease_detected": "<none | name of disease or pest>",
  "disease_confidence": "<low|medium|high> (only if disease detected)",
  "growth_stage": "<seedling|young|vegetative|flowering|fruiting|dormant>",
  "leaf_color": "<description>",
  "leaf_condition": "<healthy|wilting|yellowing|browning|spotted|curling>",
  "soil_surface_observation": "<what you can see of the soil surface>",
  "animal_detected": <true|false>,
  "animal_type": "<none|cat|dog|bird|insect|pest|rodent|livestock|other — describe what you see>",
  "animal_threat_level": "<none|low|medium|high — low=harmless visitor, medium=could damage plant, high=actively damaging>"
}`;

  try {
    const body = {
      messages: [
        {
          role: 'system',
          content: 'You are PlantIQ, an expert AI plant health monitoring agent. You analyze plant images combined with sensor data to make precise, actionable recommendations. Always respond with valid JSON only.'
        },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${imageBase64}`,
                detail: 'high'
              }
            },
            { type: 'text', text: prompt }
          ]
        }
      ],
      temperature: 0.15,
      max_tokens: 700,
      response_format: { type: 'json_object' }
    };

    const res = await fetch(AZURE_CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': AZURE_API_KEY
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Azure API ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('Empty response from Azure');

    const parsed = JSON.parse(content);
    console.log(`[AI] Analysis complete — health: ${parsed.health_score}, pump: ${parsed.pump_needed}, alert: ${parsed.alert_level}`);
    return parsed;

  } catch (err) {
    console.error('[AI] Azure GPT-4o failed:', err.message, '— using rule-based fallback');
    return ruleBasedDecision(moisture_pct, temperature_c);
  }
}

// ─── LEGACY: analyzeImage (used by multi-plant pages) ────────

async function analyzeImage(imagePath, plantName = '', sensorData = {}) {
  try {
    if (!fs.existsSync(imagePath)) return null;
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');
    const result = await analyzeDeviceReport(base64Image, {
      moisture_pct: sensorData.moisture || 50,
      temperature_c: sensorData.temperature || 22
    });
    return {
      visual_health: result.alert_level === 'none' ? 'healthy' : 'needs_attention',
      diseases_detected: result.disease_detected !== 'none' ? [result.disease_detected] : [],
      growth_stage: result.growth_stage,
      immediate_concerns: result.immediate_actions,
      recommendations: result.recommendations,
      health_score: result.health_score,
      summary: result.visual_status
    };
  } catch (err) {
    console.error('[AI] analyzeImage error:', err.message);
    return null;
  }
}

// ─── HEALTH SCORE (sensor-only, no vision) ───────────────────

function calculateHealthScore(sensorData, aiScore = null) {
  let score = 100;
  const { moisture = 50, temperature = 22, humidity = 55 } = sensorData;
  if (moisture < 20) score -= 40;
  else if (moisture < 40) score -= 20;
  else if (moisture > 80) score -= 10;
  if (temperature < 10 || temperature > 35) score -= 30;
  else if (temperature < 15 || temperature > 30) score -= 15;
  if (humidity < 20) score -= 15;
  else if (humidity < 30) score -= 8;
  if (aiScore !== null) score = Math.round(score * 0.4 + aiScore * 0.6);
  return Math.max(0, Math.min(100, score));
}

module.exports = { analyzeDeviceReport, analyzeImage, calculateHealthScore };
