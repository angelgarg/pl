# Claude Code Instructions: Plant Monitoring System Upgrade
## Repository: https://github.com/angelgarg/pl

---

## SETUP FIRST

```bash
git clone https://github.com/angelgarg/pl .
```

Read ALL existing files carefully before making changes. Understand the current structure, then execute the tasks below sequentially.

---

## TASK 1: Analyze the Codebase

Run the following and report what you find:
- What framework/stack is being used (Flask, Node, etc.)?
- What files exist (routes, templates, static assets)?
- Is there already a database? What kind?
- What does the current plant monitoring logic do?
- Is there any image upload/capture feature already?

---

## TASK 2: Backend — User Authentication (with database)

Add full user authentication system:

1. **Install dependencies** (based on stack detected):
   - If Python/Flask: `pip install flask-login flask-sqlalchemy flask-bcrypt`
   - If Node/Express: `npm install bcryptjs jsonwebtoken mongoose express-session`

2. **Database setup**:
   - Use **SQLite** (Flask) or **MongoDB** (Node) for simplicity — no external account needed
   - Create a `users` table/collection with: `id`, `username`, `email`, `password_hash`, `created_at`
   - Create a `plants` table/collection with: `id`, `user_id`, `name`, `species`, `location`, `created_at`
   - Create a `readings` table/collection with: `id`, `plant_id`, `timestamp`, `temperature`, `humidity`, `soil_moisture`, `image_path`, `ai_analysis`

3. **Auth routes**:
   - `GET/POST /register` — registration page
   - `GET/POST /login` — login page  
   - `GET /logout` — logout
   - Protect all dashboard/monitoring routes with login_required

4. **Session management**: Use secure sessions, hash passwords with bcrypt

---

## TASK 3: Multi-Plant Management

Add support for monitoring multiple plants simultaneously:

1. **Plant Registry**: Users can add multiple plants with:
   - Name (e.g., "My Monstera")
   - Species
   - Location/Room
   - Target thresholds (soil moisture min/max, temperature range)
   - Profile photo upload

2. **Plant Dashboard Grid**: Show all plants as cards with:
   - Current sensor readings
   - Health status badge (Healthy 🟢 / Needs Water 🟡 / Critical 🔴)
   - Last updated timestamp
   - Quick action buttons

3. **Per-plant detail page**: `/plant/<id>` showing full history and charts

4. **Innovation features to add**:
   - **Comparative analytics**: Side-by-side charts across plants
   - **Smart watering schedule**: AI-suggested watering times based on historical data
   - **Plant health score** (0-100) combining all sensor metrics
   - **Alerts system**: Flag plants needing immediate attention
   - **Growth journal**: Log notes/observations per plant with timestamps
   - **Streak tracker**: "Day 14 without issues 🔥" per plant

---

## TASK 4: OpenAI Vision Integration

For every image received from the plant camera/upload:

1. **Install OpenAI**: `pip install openai` or `npm install openai`

2. **Create `ai_analysis.py` or `aiAnalysis.js`**:

```python
# Python version
import openai
import base64

def analyze_plant_image(image_path, plant_name, sensor_data):
    with open(image_path, "rb") as f:
        image_data = base64.b64encode(f.read()).decode("utf-8")
    
    client = openai.OpenAI()  # uses OPENAI_API_KEY env var
    
    prompt = f"""You are an expert botanist and plant health specialist.
    
Analyze this image of '{plant_name}' along with its current sensor readings:
- Soil Moisture: {sensor_data.get('soil_moisture', 'N/A')}%
- Temperature: {sensor_data.get('temperature', 'N/A')}°C  
- Humidity: {sensor_data.get('humidity', 'N/A')}%

Please provide:
1. **Visual Health Assessment**: What do you observe about the plant's appearance?
2. **Disease/Pest Detection**: Any signs of disease, pests, yellowing, wilting, or damage?
3. **Growth Stage**: Estimated growth stage and development observations
4. **Immediate Concerns**: Any urgent issues requiring action?
5. **Recommendations**: Specific care actions to take in the next 24-48 hours
6. **Health Score**: Overall health score out of 100

Respond in JSON format:
{{
  "visual_health": "...",
  "diseases_detected": [...],
  "growth_stage": "...",
  "immediate_concerns": [...],
  "recommendations": [...],
  "health_score": 85,
  "summary": "One sentence summary"
}}"""

    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[{
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_data}"}}
            ]
        }],
        max_tokens=1000
    )
    
    return response.choices[0].message.content
```

3. **Trigger analysis**: Call this function every time:
   - A new image is uploaded
   - A scheduled reading is taken (if camera is attached)
   
4. **Store results**: Save the JSON analysis to the `readings` table alongside sensor data

5. **Display in UI**: Show AI analysis card on plant detail page with formatted results

---

## TASK 5: Complete UI Redesign — Blue & White Theme

Redesign the entire frontend. Use **Tailwind CSS via CDN** or write custom CSS. 

### Color Palette:
```css
:root {
  --primary: #1d4ed8;        /* Blue 700 */
  --primary-light: #3b82f6;  /* Blue 500 */
  --primary-dark: #1e3a8a;   /* Blue 900 */
  --accent: #06b6d4;         /* Cyan 500 */
  --bg-main: #f0f9ff;        /* Sky 50 */
  --bg-card: #ffffff;
  --bg-sidebar: #1e3a8a;
  --text-primary: #0f172a;
  --text-secondary: #475569;
  --success: #22c55e;
  --warning: #f59e0b;
  --danger: #ef4444;
}
```

### Layout Structure:

**Sidebar Navigation** (fixed left, dark blue):
```
🌿 PlantIQ  [logo]
─────────────────
📊 Dashboard
🌱 My Plants  
📸 Camera Feed
📈 Analytics
⚙️ Settings
─────────────────
👤 [Username]
🚪 Logout
```

**Main content area** (light blue-white):
- Top header bar with page title + notifications bell + "Add Plant" button
- Responsive grid of plant cards

### Plant Card Design:
```
┌─────────────────────────────┐
│  🌿 [Plant Image]           │
│  ─────────────────────────  │
│  Monstera Deliciosa         │
│  Living Room • Added 3 days │
│                             │
│  💧 72%  🌡️ 22°C  💦 65%  │
│  [Health Score: 87/100] 🟢  │
│                             │
│  [View Details] [Add Note]  │
└─────────────────────────────┘
```

### Pages to create/redesign:
1. **Landing/Login page** — beautiful hero with plant imagery, blue gradient
2. **Register page** — clean form, same design language
3. **Dashboard** — plant card grid, summary stats at top
4. **Plant Detail page** — charts, AI analysis, reading history, notes
5. **Add Plant page** — form with image upload
6. **Analytics page** — comparative charts across all plants
7. **Camera/Upload page** — live feed or image upload interface

### Sensor Gauge Components:
Create circular/arc gauge components for:
- Soil Moisture (0-100%, color: blue gradient)
- Temperature (thresholds: cold < 15°C, ideal 18-28°C, hot > 30°C)
- Humidity (0-100%)
- AI Health Score (0-100, green > 70, yellow 40-70, red < 40)

Use **Chart.js** or **Chart.js via CDN** for:
- Line chart: sensor readings over time (last 24h, 7d, 30d toggle)
- Radar chart: multi-metric plant health overview
- Bar chart: comparative moisture across all plants

---

## TASK 6: Responsive Design & Polish

1. Mobile responsive (hamburger menu on small screens)
2. Loading skeletons for data fetching
3. Toast notifications for actions (plant added, analysis complete, etc.)
4. Smooth page transitions
5. Empty states with helpful CTAs (e.g., "No plants yet — Add your first plant!")
6. Error pages (404, 500) with plant theme

---

## TASK 7: Environment Variables

Create a `.env.example` file:
```
SECRET_KEY=your-secret-key-here
OPENAI_API_KEY=your-openai-api-key-here
DATABASE_URL=sqlite:///plantiq.db
FLASK_ENV=development
```

Create a `.env` file (add to .gitignore):
```
SECRET_KEY=super-secret-dev-key-change-in-production
OPENAI_API_KEY=           # User must fill this in
DATABASE_URL=sqlite:///plantiq.db
```

---

## TASK 8: Git — Auto Push All Changes

After completing ALL tasks above:

```bash
git add -A
git commit -m "feat: Complete PlantIQ redesign

- Added user authentication (register/login/logout)
- Added SQLite database with users, plants, readings tables  
- Added multi-plant management with health scoring
- Integrated OpenAI GPT-4o vision for plant image analysis
- Complete UI redesign: blue/white theme, sidebar layout
- Added comparative analytics dashboard
- Added plant cards with real-time sensor gauges
- Added AI analysis display with disease detection
- Added growth journal and notes per plant
- Added responsive mobile design
- Added smart alerts for plants needing attention"

git push origin main
```

If push fails due to auth, use:
```bash
git remote set-url origin https://YOUR_TOKEN@github.com/angelgarg/pl.git
```

---

## ADDITIONAL INNOVATION IDEAS TO IMPLEMENT

1. **Plant Network Map**: Visual graph showing which plants are in same room/zone
2. **Watering Streak**: Gamification — "You've kept all plants healthy for 7 days! 🏆"
3. **AI Chat per Plant**: "Ask PlantIQ" button — sends plant's full history + current state to GPT-4o for Q&A
4. **Export Report**: Generate PDF health report per plant (weekly/monthly)
5. **Plant Comparison**: "Which plant needs the most attention?" ranked list
6. **Weather Integration**: If outdoor plants, pull local weather to contextualize readings
7. **Notification System**: Browser notifications when plant health score drops below threshold

---

## NOTES FOR CLAUDE CODE

- Always use `os.environ.get('OPENAI_API_KEY')` — never hardcode API keys
- Keep the OpenAI calls behind a try/except — if no key is provided, skip AI analysis gracefully
- Make sure all routes are tested before pushing
- Ensure `requirements.txt` or `package.json` is updated with all new dependencies
- Add a `README.md` with setup instructions
