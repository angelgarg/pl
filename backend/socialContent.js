/**
 * BhoomiIQ — Daily Social Media Content Generator
 * Uses Gemini 2.0 Flash to generate platform-specific posts
 * Called by /api/social/daily-content  (hit by Make.com daily)
 */

'use strict';

const GEMINI_KEY = () => process.env.GEMINI_API_KEY || '';
const GEMINI_URL = () =>
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY()}`;

// Post type rotation — cycles through these daily
const POST_TYPES = [
  'plant_care_tip',
  'iot_farming_fact',
  'seasonal_advice',
  'product_feature',
  'motivational_farmer',
  'water_saving_tip',
  'soil_health_tip',
];

// Indian seasons for context
function getCurrentSeason() {
  const month = new Date().getMonth() + 1;
  if (month >= 3 && month <= 5)  return 'Summer (Grishma) — hot and dry';
  if (month >= 6 && month <= 9)  return 'Monsoon (Varsha) — rainy season';
  if (month >= 10 && month <= 11) return 'Autumn (Sharad) — mild weather';
  if (month >= 12 || month <= 2) return 'Winter (Shishir) — cool and dry';
  return 'transition season';
}

// Get today's post type based on day of year
function getTodayPostType() {
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  return POST_TYPES[dayOfYear % POST_TYPES.length];
}

async function generateDailyContent() {
  const postType  = getTodayPostType();
  const season    = getCurrentSeason();
  const today     = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

  const prompt = `You are the social media manager for BhoomiIQ — an Indian AI-powered smart plant monitor that uses IoT sensors and AI (Google Gemini) to help farmers and home gardeners monitor soil moisture, temperature, and plant health automatically.

Today is ${today}. Current Indian season: ${season}.
Today's post theme: ${postType.replace(/_/g, ' ').toUpperCase()}

Generate engaging social media content for BhoomiIQ. Return ONLY valid JSON:

{
  "post_type": "${postType}",
  "instagram": {
    "caption": "<engaging caption 150-200 chars, warm tone, relatable to Indian farmers/gardeners>",
    "hashtags": "<20-25 relevant hashtags as one string, include #BhoomiIQ #SmartFarming #IndianFarmer>",
    "image_prompt": "<detailed description of ideal image/visual for this post, 2-3 sentences>",
    "story_text": "<short punchy text for Instagram Story, max 80 chars>"
  },
  "facebook": {
    "caption": "<longer caption 200-300 chars, slightly more informational, warm tone>",
    "hashtags": "<10-15 relevant hashtags>",
    "image_prompt": "<ideal image description for Facebook>"
  },
  "youtube": {
    "short_title": "<YouTube Shorts title, max 60 chars, curiosity-driven>",
    "short_description": "<YouTube Shorts description 100-150 chars with hashtags>",
    "short_script": "<30-second script for a YouTube Short about BhoomiIQ, conversational Hindi-English mix is fine>"
  },
  "tip_of_the_day": "<one simple, practical farming/gardening tip in plain English, 1-2 sentences>",
  "emoji_summary": "<3-5 relevant emojis that represent this post>"
}`;

  try {
    const res = await fetch(GEMINI_URL(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.85,
          maxOutputTokens: 1200,
          responseMimeType: 'application/json'
        }
      })
    });

    if (!res.ok) throw new Error(`Gemini ${res.status}`);
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const clean = text.replace(/```json|```/g, '').trim();
    const content = JSON.parse(clean);

    return {
      success: true,
      date: today,
      season,
      ...content
    };
  } catch (err) {
    console.error('[SOCIAL] Gemini error:', err.message);
    // Fallback content
    return fallbackContent(postType, today);
  }
}

function fallbackContent(postType, today) {
  return {
    success: true,
    date: today,
    post_type: postType,
    instagram: {
      caption: '🌱 Smart farming starts with smart monitoring. BhoomiIQ keeps your plants healthy 24/7 with AI + IoT sensors. Never lose a plant again!',
      hashtags: '#BhoomiIQ #SmartFarming #IndianFarmer #PlantCare #IoTFarming #AgroTech #KisanTech #PlantHealth #SoilMonitor #AIFarming #GreenIndia #HomeGardening #FarmTech #DigitalFarming #SustainableFarming',
      image_prompt: 'A lush green plant with a small IoT sensor in the soil, smartphone showing plant health data, warm natural lighting.',
      story_text: '🌿 Your plants. AI-powered. Always healthy.'
    },
    facebook: {
      caption: '🌱 BhoomiIQ uses AI and IoT sensors to monitor your plants 24/7 — soil moisture, temperature, and plant health all in one app. Smart farming for every Indian farmer and home gardener!',
      hashtags: '#BhoomiIQ #SmartFarming #IndianFarmer #PlantCare #IoTFarming #AgroTech #DigitalIndia',
      image_prompt: 'A farmer smiling while checking plant health on a smartphone, green fields in background.'
    },
    youtube: {
      short_title: 'AI monitors your plants 24/7! 🌱',
      short_description: 'BhoomiIQ — AI-powered plant monitor for Indian farmers. Never lose a plant again! #BhoomiIQ #SmartFarming',
      short_script: "Is your plant thirsty? BhoomiIQ knows! Our AI-powered soil sensor monitors moisture and temperature 24/7. It even sends you alerts when your plant needs water. Perfect for farmers and home gardeners. Try BhoomiIQ today — link in bio!"
    },
    tip_of_the_day: 'Water your plants early in the morning to reduce evaporation and keep roots healthy throughout the day.',
    emoji_summary: '🌱💧🤖📱✅'
  };
}

module.exports = { generateDailyContent };
