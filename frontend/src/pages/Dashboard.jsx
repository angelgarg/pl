import React, { useState, useEffect } from 'react';
import PlantCard from '../components/PlantCard';
import * as api from '../api';
import { useLang } from '../LangContext';

// ── IST helpers ──────────────────────────────────────────────
function getISTNow() {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000);
}
function getDesiGreeting() {
  const h = getISTNow().getUTCHours();
  if (h >= 5  && h < 12) return { hi: 'सुप्रभात',   en: 'Good Morning',   emoji: '🌄' };
  if (h >= 12 && h < 17) return { hi: 'नमस्ते',     en: 'Good Afternoon', emoji: '☀️' };
  if (h >= 17 && h < 21) return { hi: 'शुभ संध्या', en: 'Good Evening',   emoji: '🌇' };
  return                         { hi: 'शुभ रात्रि', en: 'Good Night',     emoji: '🌙' };
}
function getISTDateStr() {
  const d = getISTNow();
  const days   = ['Ravivar','Somvar','Mangalvar','Budhvar','Guruvar','Shukravar','Shanivar'];
  const months = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
  return `${days[d.getUTCDay()]}, ${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export default function Dashboard({ onNavigateToPlant, onAddNote, onAddPlant, isGuest }) {
  const { t } = useLang();
  const [plants, setPlants]                   = useState([]);
  const [stats, setStats]                     = useState(null);
  const [deviceData, setDeviceData]           = useState(null);
  const [loading, setLoading]                 = useState(true);
  const [error, setError]                     = useState('');
  const [animalDismissed, setAnimalDismissed] = useState(false);
  const [currentTime, setCurrentTime]         = useState(getISTNow());

  useEffect(() => {
    fetchData();
    const dataInterval  = setInterval(fetchData, 30000);
    const clockInterval = setInterval(() => setCurrentTime(getISTNow()), 60000);
    return () => { clearInterval(dataInterval); clearInterval(clockInterval); };
  }, []);

  const fetchData = async () => {
    try {
      setError('');
      const [plantsData, statsData, deviceLatest] = await Promise.all([
        api.getPlants(),
        api.getDashboard(),
        api.getDeviceLatest().catch(() => null)
      ]);
      setPlants(plantsData);
      setStats(statsData);
      if (deviceLatest) {
        setDeviceData(deviceLatest);
        if (deviceLatest.ai_animal_detected) setAnimalDismissed(false);
      }
    } catch (err) {
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const greeting = getDesiGreeting();

  if (loading) {
    return (
      <div className="page">
        <div className="loading-skeleton">
          <div className="loading-skeleton-item" style={{ height: '120px', marginBottom: '20px', borderRadius: '20px' }} />
          <div className="loading-skeleton-item" style={{ height: '180px', marginBottom: '20px' }} />
          <div className="loading-skeleton-item" style={{ height: '200px' }} />
        </div>
      </div>
    );
  }

  return (
    <div className="page">

      {/* ── Desi Hero Banner ── */}
      <div className="dash-hero">
        <div className="dash-hero-left">
          <div className="dash-hero-greeting">
            <span className="dash-hero-emoji">{greeting.emoji}</span>
            <div>
              <div className="dash-hi-text">{greeting.hi} 🙏</div>
              <div className="dash-en-text">{greeting.en}, Kisan Ji!</div>
            </div>
          </div>
          <div className="dash-date-row">
            <span className="dash-date-badge">📅 {getISTDateStr()}</span>
            <span className="dash-date-badge dash-ist-badge">
              🕐 {currentTime.getUTCHours().toString().padStart(2,'0')}:{currentTime.getUTCMinutes().toString().padStart(2,'0')} IST
            </span>
          </div>
          <div className="dash-tagline">भूमि की देखभाल, AI के साथ 🌿</div>
        </div>
        <div className="dash-hero-right">
          {!isGuest && (
            <button className="dash-add-btn" onClick={onAddPlant}>
              + नया पौधा
            </button>
          )}
          <div className="dash-hero-motif">🌾🪴🌻</div>
        </div>
      </div>

      {/* ── Guest Notice ── */}
      {isGuest && (
        <div className="guest-readonly-notice">
          👋 Mehmaan mode mein hain aap — demo data dekh rahe hain.{' '}
          <strong style={{ marginLeft: 4 }}>Account banao</strong> apne paudhe track karne ke liye.
        </div>
      )}

      {error && <div className="error-message">{error}</div>}

      {/* ── Animal Detection Alert ── */}
      {deviceData?.ai_animal_detected && !animalDismissed && (
        <div className="dash-animal-alert">
          <div className="dash-animal-left">
            <span className="dash-animal-icon">⚠️</span>
            <div>
              <div className="dash-animal-title">जानवर दिखा! — Buzzer बज गया 🔔</div>
              <div className="dash-animal-sub">
                <strong style={{ textTransform: 'capitalize' }}>
                  {deviceData.ai_animal_type !== 'none' ? deviceData.ai_animal_type : 'Koi jaanvar'}
                </strong>
                {' '}aapke paudho ke paas aaya
                {deviceData.ai_animal_threat && deviceData.ai_animal_threat !== 'none' && (
                  <span className={`dash-threat-pill dash-threat-${deviceData.ai_animal_threat}`}>
                    {deviceData.ai_animal_threat.toUpperCase()} THREAT
                  </span>
                )}
                <span className="dash-animal-time">
                  {deviceData.created_at ? new Date(deviceData.created_at).toLocaleTimeString('en-IN') : ''}
                </span>
              </div>
            </div>
          </div>
          <button className="dash-dismiss-btn" onClick={() => setAnimalDismissed(true)}>
            Theek Hai ✓
          </button>
        </div>
      )}

      {/* ── Stats — Fasal ki Jaankari ── */}
      {stats && (
        <>
          <div className="dash-section-head">
            <span className="dash-section-line" />
            <span className="dash-section-label">🌾 Fasal ki Jaankari</span>
            <span className="dash-section-line" />
          </div>
          <div className="dashboard-stats">
            <div className="stat-card stat-card-desi stat-green">
              <div className="stat-desi-icon">🌿</div>
              <div className="stat-value">{stats.totalPlants}</div>
              <div className="stat-label">Kul Paudhe</div>
              <div className="stat-sublabel">Total Plants</div>
            </div>
            <div className="stat-card stat-card-desi stat-emerald">
              <div className="stat-desi-icon">💚</div>
              <div className="stat-value" style={{ color: 'var(--success)' }}>{stats.healthyCount}</div>
              <div className="stat-label">Swasth</div>
              <div className="stat-sublabel">Healthy</div>
            </div>
            <div className="stat-card stat-card-desi stat-saffron">
              <div className="stat-desi-icon">⚠️</div>
              <div className="stat-value" style={{ color: '#E68A00' }}>{stats.alertCount}</div>
              <div className="stat-label">Dhyan Do</div>
              <div className="stat-sublabel">Needs Attention</div>
            </div>
            <div className="stat-card stat-card-desi stat-blue">
              <div className="stat-desi-icon">📊</div>
              <div className="stat-value" style={{ color: 'var(--primary-light)' }}>{stats.avgHealthScore}%</div>
              <div className="stat-label">Sehat Score</div>
              <div className="stat-sublabel">Avg Health</div>
            </div>
          </div>
        </>
      )}

      {/* ── Plant Grid ── */}
      {plants.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-emoji">🌱</div>
          <h2 className="empty-state-title">Abhi koi paudha nahi hai</h2>
          <p className="empty-state-subtitle">
            Ek beej lagao, ek sapna ugao 🌾
            <br />
            <span style={{ fontSize: '13px', opacity: 0.7 }}>Add your first plant to get started</span>
          </p>
          {!isGuest && (
            <button className="empty-state-btn" onClick={onAddPlant}>
              + Pehla Paudha Lagao
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="dash-section-head" style={{ marginTop: '8px' }}>
            <span className="dash-section-line" />
            <span className="dash-section-label">🪴 Aapke Paudhe ({plants.length})</span>
            <span className="dash-section-line" />
          </div>
          <div className="plant-grid">
            {plants.map(plant => (
              <PlantCard
                key={plant.id}
                plant={plant}
                onViewDetails={() => onNavigateToPlant(plant.id)}
                onAddNote={() => onAddNote(plant.id)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
