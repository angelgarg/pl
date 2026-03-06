# PlantIQ - Smart Plant Monitoring System

PlantIQ is a full-stack plant monitoring system that combines IoT sensors (ESP32), real-time data visualization, and AI-powered plant health analysis to help you keep your plants thriving.

## Features

- **Real-time Sensor Monitoring**: Track soil moisture, temperature, and humidity
- **AI Plant Analysis**: Uses OpenAI vision to analyze plant images and detect diseases
- **Health Scoring**: Intelligent health scoring based on sensor data and AI insights
- **Multi-plant Management**: Monitor multiple plants with individual profiles
- **Growth Journal**: Log notes and track your plants' progress over time
- **Responsive Analytics**: Visualize trends and compare plants side-by-side
- **Beautiful UI**: Modern, intuitive interface with a blue color palette
- **User Authentication**: Secure login and registration with session management

## Architecture

### Backend
- **Runtime**: Node.js + Express
- **Database**: JSON file-based (no SQL required)
- **Auth**: Crypto-based password hashing and HMAC token signing
- **Image Processing**: OpenAI gpt-4o vision model for plant analysis
- **File Uploads**: Multer for image handling

### Frontend
- **Framework**: React 18
- **Styling**: Custom CSS with CSS variables (no Tailwind)
- **Charts**: Recharts for data visualization
- **Routing**: State-based (no react-router)
- **API**: Fetch with cookie-based credentials

## Project Structure

```
plant-monitor/
├── backend/
│   ├── db.js                 # JSON database layer
│   ├── auth.js              # Authentication utilities
│   ├── ai_analysis.js       # OpenAI vision integration
│   ├── server.js            # Express server with all routes
│   ├── data/                # JSON data files
│   │   ├── users.json
│   │   ├── plants.json
│   │   ├── readings.json
│   │   └── notes.json
│   ├── uploads/             # User uploaded images
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   ├── styles.css
│   │   ├── api.js           # API client
│   │   ├── components/
│   │   │   ├── Sidebar.jsx
│   │   │   ├── PlantCard.jsx
│   │   │   ├── SensorGauge.jsx
│   │   │   └── Toast.jsx
│   │   └── pages/
│   │       ├── LoginPage.jsx
│   │       ├── RegisterPage.jsx
│   │       ├── Dashboard.jsx
│   │       ├── PlantDetail.jsx
│   │       ├── AddPlantPage.jsx
│   │       ├── AnalyticsPage.jsx
│   │       ├── CameraPage.jsx
│   │       └── SettingsPage.jsx
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
├── .env
├── .env.example
└── README.md
```

## Installation

### Prerequisites
- Node.js 16+
- npm 8+
- OpenAI API key (optional, for AI plant analysis)

### Backend Setup

```bash
cd backend
npm install
```

### Frontend Setup

```bash
cd frontend
npm install
```

### Environment Variables

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

Key variables:
- `SECRET_KEY`: For token signing (change in production!)
- `OPENAI_API_KEY`: Optional, enables AI plant analysis
- `PORT`: Backend server port (default: 3001)

## Running the Application

### Start Backend

```bash
cd backend
npm start
```

Server will run on `http://localhost:3001`

### Start Frontend

```bash
cd frontend
npm run dev
```

Frontend will run on `http://localhost:5173`

## API Endpoints

### Authentication
- `POST /auth/register` - Create new account
- `POST /auth/login` - Sign in
- `POST /auth/logout` - Sign out
- `GET /api/me` - Get current user

### Plants
- `GET /api/plants` - List user's plants
- `POST /api/plants` - Create new plant
- `GET /api/plants/:id` - Get plant details
- `PUT /api/plants/:id` - Update plant
- `DELETE /api/plants/:id` - Delete plant

### Readings
- `GET /api/plants/:id/readings` - Get sensor readings
- `POST /api/plants/:id/readings` - Add reading with optional image

### Notes
- `GET /api/plants/:id/notes` - Get growth journal
- `POST /api/plants/:id/notes` - Add note

### Analysis & Media
- `POST /api/plants/:id/upload-image` - Upload and analyze image
- `POST /api/plants/:id/analyze` - Analyze image with AI

### Dashboard & Analytics
- `GET /api/dashboard` - Dashboard stats
- `GET /api/analytics` - Detailed analytics
- `GET /api/alerts` - Plant health alerts

## Health Score Calculation

The health score (0-100) combines sensor data with optional AI analysis:

```
Moisture: 30-70% is ideal
Temperature: 18-28°C is ideal
Humidity: 40-70% is ideal

Score calculation:
- Start at 100
- Penalize for out-of-range values
- If AI analysis available: 40% sensor + 60% AI score
```

Health status:
- **Green (≥70%)**: Healthy
- **Yellow (40-70%)**: Needs water
- **Red (<40%)**: Critical

## Database Schema

### users.json
```json
{
  "id": "uuid",
  "username": "string",
  "email": "string",
  "password_hash": "scrypt:salt:hash",
  "created_at": "ISO 8601",
  "updated_at": "ISO 8601"
}
```

### plants.json
```json
{
  "id": "uuid",
  "user_id": "uuid",
  "name": "string",
  "species": "string",
  "location": "string",
  "moisture_min": 30,
  "moisture_max": 70,
  "temp_min": 15,
  "temp_max": 28,
  "humidity_min": 40,
  "humidity_max": 70,
  "profile_image": "string|null",
  "health_score": 100,
  "last_reading_at": "ISO 8601|null",
  "created_at": "ISO 8601",
  "updated_at": "ISO 8601"
}
```

### readings.json
```json
{
  "id": "uuid",
  "plant_id": "uuid",
  "temperature": 22.5,
  "humidity": 55,
  "soil_moisture": 45,
  "image_path": "/uploads/filename.jpg|null",
  "ai_analysis": { ... }|null,
  "health_score": 75,
  "created_at": "ISO 8601"
}
```

### notes.json
```json
{
  "id": "uuid",
  "plant_id": "uuid",
  "user_id": "uuid",
  "content": "string",
  "created_at": "ISO 8601"
}
```

## Authentication

### Token Format
Tokens are HMAC-signed payloads:
```
base64(userId:timestamp).hmac_sha256_hex
```

### Cookie
- Name: `plantiq_token`
- HttpOnly: true
- Secure: true (in production)
- SameSite: Lax
- Max-Age: 7 days

## Color Palette

```css
--primary: #1d4ed8       /* Main blue */
--primary-light: #3b82f6 /* Bright blue */
--primary-dark: #1e3a8a  /* Dark blue */
--accent: #06b6d4        /* Cyan */
--success: #22c55e       /* Green */
--warning: #f59e0b       /* Amber */
--danger: #ef4444        /* Red */
```

## Development Tips

### Adding a New Plant Sensor
1. Add field to plant schema
2. Update `PlantDetail` gauge component
3. Update health score calculation in `ai_analysis.js`
4. Update sensor reading POST handler

### Customizing Health Score
Edit `calculateHealthScore()` in `/backend/ai_analysis.js`

### Modifying the UI Theme
Update CSS variables in `/frontend/src/styles.css`

### Connecting Real Sensors
Update `POST /api/plants/:id/readings` to accept your ESP32 data

## Troubleshooting

### CORS Errors
Make sure backend is running on `http://localhost:3001` and CORS is configured in `server.js`

### Token Invalid
Clear cookies and re-login. Tokens expire after 7 days.

### AI Analysis Not Working
Ensure `OPENAI_API_KEY` is set in `.env`. Analysis will gracefully fail if key is missing.

### Images Not Uploading
Check `/backend/uploads/` directory exists and is writable

## Performance

- Frontend builds: ~3-5 seconds with Vite
- Backend startup: <1 second
- Data loads: <500ms for typical plant collections
- Image analysis: 3-10 seconds (depends on OpenAI)

## Security Notes

- Change `SECRET_KEY` in production!
- Use HTTPS in production
- Set `HttpOnly` and `Secure` on cookies
- Validate all user inputs
- Rate limit authentication endpoints
- Don't expose API keys in frontend

## Future Enhancements

- [ ] Email notifications for plant alerts
- [ ] Mobile app (React Native)
- [ ] WebSocket for real-time updates
- [ ] Plant recommendations based on location
- [ ] Automated watering schedule
- [ ] Social features (plant communities)
- [ ] Machine learning trend predictions
- [ ] Integration with smart home systems

## License

MIT

## Support

For issues and feature requests, please open an issue in the repository.

---

Built with for plant lovers everywhere. 🌿
