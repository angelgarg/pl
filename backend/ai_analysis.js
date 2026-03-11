/**
 * AI Analysis — Google Gemini 2.0 Flash (Vision + Text)
 * Replaces Azure OpenAI GPT-4o
 *
 * Required env var:
 *   GEMINI_API_KEY — get free at https://aistudio.google.com/app/apikey
 */

'use strict';

const fs = require('fs');

const GEMINI_KEY   = () => process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_URL   = () =>
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY()}`;

// Rule-based fallback (when API key not set)
function ruleBasedDecision(moisture_pct, temperature_c) {
  const pump_needed = moisture_pct < 30;
  const alert_level =
    moisture_pct < 20 ? 'high'   :
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

// Call Gemini API
async function callGemini(parts, jsonMode = true) {
  const body = {
    contents: [{ parts }],
    generationConfig: {
      temperature: 0.15,
      maxOutputTokens: 800,
      ...(jsonMode ? { responseMimeType: 'application/json' } : {})
    }
  };

  const res = await fetch(GEMINI_URL(), {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini ${res.status}: ${errText}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// Main device report analysis (image + sensors)
async function analyzeDeviceReport(imageBase64, sensorData) {
  const { moisture_pct = 0, temperature_c = 0 } = sensorData;

  if (!GEMINI_KEY()) {
    console.warn('[AI] GEMINI_API_KEY not set — using rule-based fallback');
    return ruleBasedDecision(moisture_pct, temperature_c);
  }

  const moistureStatus =
    moisture_pct < 20 ? 'CRITICALLY DRY' :
    moisture_pct < 30 ? 'DRY'            :
    moisture_pct < 50 ? 'ADEQUATE'       :
    moisture_pct < 70 ? 'MOIST'          : 'WET / POSSIBLY OVERWATERED';

  const prompt = `You are BhoomiIQ, an expert AI plant health agent for Indian farms and gardens. Analyze the plant image together with the sensor data and return a complete health report.

SENSOR DATA:
- Soil Moisture: ${moisture_pct}% (${moistureStatus})
- Ambient Temperature: ${temperature_c}C

WATERING THRESHOLDS:
- below 20%: critically dry, pump 10-15s
- 20-30%: dry, pump 7-10s
- 30-50%: acceptable
- 50-70%: ideal
- above 70%: wet, do NOT water

Return ONLY valid JSON (no markdown):
{
  "health_score": <0-100>,
  "visual_status": "<paragraph describing image>",
  "pump_needed": <true|false>,
  "pump_reason": "<reasoning>",
  "pump_duration_seconds": <5-30>,
  "alert_level": "<none|low|medium|high|critical>",
  "alerts": ["<issue>"],
  "immediate_actions": ["<action>"],
  "recommendations": ["<tip1>","<tip2>","<tip3>"],
  "disease_detected": "<none|disease name>",
  "disease_confidence": "<low|medium|high>",
  "growth_stage": "<seedling|young|vegetative|flowering|fruiting|dormant>",
  "leaf_color": "<description>",
  "leaf_condition": "<healthy|wilting|yellowing|browning|spotted|curling>",
  "soil_surface_observation": "<description>",
  "animal_detected": <true|false>,
  "animal_type": "<none|cat|dog|bird|insect|pest|rodent|livestock|other>",
  "animal_threat_level": "<none|low|medium|high>"
}`;

  const parts = [{ text: prompt }];
  if (imageBase64) {
    parts.unshift({ inlineData: { mimeType: 'image/jpeg', data: imageBase64 } });
  }

  try {
    const text   = await callGemini(parts, true);
    const clean  = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    console.log(`[AI] Gemini — health: ${parsed.health_score}, pump: ${parsed.pump_needed}, alert: ${parsed.alert_level}`);
    return parsed;
  } catch (err) {
    console.error('[AI] Gemini failed:', err.message, '— rule-based fallback');
    return ruleBasedDecision(moisture_pct, temperature_c);
  }
}

// Legacy: analyzeImage (used by multi-plant pages)
async function analyzeImage(imagePath, plantName = '', sensorData = {}) {
  try {
    if (!fs.existsSync(imagePath)) return null;
    const base64Image = fs.readFileSync(imagePath).toString('base64');
    const result = await analyzeDeviceReport(base64Image, {
      moisture_pct:  sensorData.moisture    || 50,
      temperature_c: sensorData.temperature || 22
    });
    return {
      visual_health:      result.alert_level === 'none' ? 'healthy' : 'needs_attention',
      diseases_detected:  result.disease_detected !== 'none' ? [result.disease_detected] : [],
      growth_stage:       result.growth_stage,
      immediate_concerns: result.immediate_actions,
      recommendations:    result.recommendations,
      health_score:       result.health_score,
      summary:            result.visual_status
    };
  } catch (err) {
    console.error('[AI] analyzeImage error:', err.message);
    return null;
  }
}

// Health score (sensor-only, no vision)
function calculateHealthScore(sensorData, aiScore = null) {
  let score = 100;
  const { moisture = 50, temperature = 22, humidity = 55 } = sensorData;
  if (moisture < 20)              score -= 40;
  else if (moisture < 40)         score -= 20;
  else if (moisture > 80)         score -= 10;
  if (temperature < 10 || temperature > 35)   score -= 30;
  else if (temperature < 15 || temperature > 30) score -= 15;
  if (humidity < 20)  score -= 15;
  else if (humidity < 30) score -= 8;
  if (aiScore !== null) score = Math.round(score * 0.4 + aiScore * 0.6);
  return Math.max(0, Math.min(100, score));
}

module.exports = { analyzeDeviceReport, analyzeImage, calculateHealthScore };
