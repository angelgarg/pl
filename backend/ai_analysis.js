const fs = require('fs');
const path = require('path');

let OpenAI;
try {
  OpenAI = require('openai').default;
} catch (err) {
  console.warn('OpenAI package not available');
  OpenAI = null;
}

// Calculate health score from sensor data
function calculateHealthScore(sensorData, aiScore = null) {
  let score = 100;
  const { moisture = 50, temperature = 22, humidity = 55 } = sensorData;

  // Moisture: ideal 40-70%
  if (moisture < 20) score -= 40;
  else if (moisture < 40) score -= 20;
  else if (moisture > 80) score -= 10;

  // Temperature: ideal 18-28°C
  if (temperature < 10 || temperature > 35) score -= 30;
  else if (temperature < 15 || temperature > 30) score -= 15;

  // Humidity: ideal 40-70%
  if (humidity < 20) score -= 15;
  else if (humidity < 30) score -= 8;

  // Combine with AI score if available
  if (aiScore !== null && aiScore !== undefined) {
    score = Math.round(score * 0.4 + aiScore * 0.6);
  }

  return Math.max(0, Math.min(100, score));
}

// Analyze image with OpenAI vision
async function analyzeImage(imagePath, plantName = '', sensorData = {}) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      console.log('OPENAI_API_KEY not set, skipping AI analysis');
      return null;
    }

    if (!OpenAI) {
      console.log('OpenAI package not available');
      return null;
    }

    if (!fs.existsSync(imagePath)) {
      console.error(`Image file not found: ${imagePath}`);
      return null;
    }

    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    // Read image and convert to base64
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');
    const ext = path.extname(imagePath).toLowerCase();
    let mediaType = 'image/jpeg';
    if (ext === '.png') mediaType = 'image/png';
    else if (ext === '.gif') mediaType = 'image/gif';
    else if (ext === '.webp') mediaType = 'image/webp';

    const prompt = `You are an expert botanist and plant health specialist. Analyze this plant image for:
1. Visual health assessment (healthy/needs attention/critical)
2. Any visible diseases or pest damage
3. Growth stage (seedling/young/mature/flowering)
4. Immediate concerns
5. Care recommendations

Also consider these sensor readings: moisture=${sensorData.moisture}%, temp=${sensorData.temperature}°C, humidity=${sensorData.humidity}%

Respond in valid JSON format with these exact keys:
{
  "visual_health": "string (healthy/needs_attention/critical)",
  "diseases_detected": ["string array of diseases if any"],
  "growth_stage": "string",
  "immediate_concerns": ["string array of concerns"],
  "recommendations": ["string array of actionable recommendations"],
  "health_score": number (0-100),
  "summary": "string (1-2 sentences overview)"
}`;

    const response = await client.messages.create({
      model: 'gpt-4o',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: base64Image
              }
            },
            {
              type: 'text',
              text: prompt
            }
          ]
        }
      ]
    });

    const content = response.content[0];
    if (content.type !== 'text') {
      console.error('Unexpected response type from OpenAI');
      return null;
    }

    // Parse JSON response
    const jsonMatch = content.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('No JSON found in OpenAI response');
      return null;
    }

    const analysis = JSON.parse(jsonMatch[0]);
    return analysis;
  } catch (err) {
    console.error('Error analyzing image with OpenAI:', err.message);
    return null;
  }
}

module.exports = {
  calculateHealthScore,
  analyzeImage
};
