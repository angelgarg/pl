import React, { useState, useEffect } from 'react';
import PlantCard from '../components/PlantCard';
import * as api from '../api';
import { useLang } from '../LangContext';

export default function Dashboard({ onNavigateToPlant, onAddNote, onAddPlant, isGuest }) {
  const { t } = useLang();
  const [plants, setPlants] = useState([]);
  const [stats, setStats] = useState(null);
  const [deviceData, setDeviceData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [animalDismissed, setAnimalDismissed] = useState(false);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    try {
      setError('');
      const [plantsData, statsData, deviceLatest] = await Promise.all([
        api.getPlants(),
        api.getDashboard(),
        api.getDeviceLatest().catch(() => null)   // non-fatal if device never reported
      ]);
      setPlants(plantsData);
      setStats(statsData);
      if (deviceLatest) {
        setDeviceData(deviceLatest);
        // Reset dismiss when a new animal is detected
        if (deviceLatest.ai_animal_detected) setAnimalDismissed(false);
      }
    } catch (err) {
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="page">
        <div className="loading-skeleton">
          <div className="loading-skeleton-item" style={{ height: '80px', marginBottom: '20px' }} />
          <div className="loading-skeleton-item" style={{ height: '200px', marginBottom: '20px' }} />
          <div className="loading-skeleton-item" style={{ height: '200px' }} />
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      {isGuest && (
        <div className="guest-readonly-notice">
          👀 You're in guest mode — browsing demo data. <strong style={{marginLeft:4}}>Create an account</strong> to add your own plants.
        </div>
      )}
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('dashboardTitle')}</h1>
          <p className="page-subtitle">{t('dashboardSubtitle')}</p>
        </div>
        {!isGuest && (
          <button className="btn-add-plant" onClick={onAddPlant}>
            + Add Plant
          </button>
        )}
      </div>

      {error && <div className="error-message">{error}</div>}

      {/* ── Animal Detection Alert Banner ── */}
      {deviceData?.ai_animal_detected && !animalDismissed && (
        <div style={{
          background: 'linear-gradient(135deg, #2a0808, #1a0505)',
          border: '1.5px solid #EF4444',
          borderRadius: '10px',
          padding: '14px 18px',
          marginBottom: '18px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          boxShadow: '0 0 18px rgba(239,68,68,0.25)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '26px' }}>⚠️</span>
            <div>
              <div style={{ color: '#EF4444', fontWeight: 700, fontSize: '15px', marginBottom: '2px' }}>
                Animal Detected — Buzzer Triggered
              </div>
              <div style={{ color: '#ffaaaa', fontSize: '13px' }}>
                <strong style={{ textTransform: 'capitalize' }}>
                  {deviceData.ai_animal_type !== 'none' ? deviceData.ai_animal_type : 'Unknown animal'}
                </strong>
                {' '}spotted near your plants
                {deviceData.ai_animal_threat && deviceData.ai_animal_threat !== 'none' && (
                  <span style={{
                    marginLeft: '8px',
                    background: deviceData.ai_animal_threat === 'high' ? '#7a1010' : '#5a2a10',
                    color: deviceData.ai_animal_threat === 'high' ? '#ff8888' : '#ffbb88',
                    borderRadius: '4px', padding: '1px 7px', fontSize: '11px', fontWeight: 600
                  }}>
                    {deviceData.ai_animal_threat.toUpperCase()} THREAT
                  </span>
                )}
                <span style={{ color: '#7a4a4a', marginLeft: '10px', fontSize: '11px' }}>
                  {deviceData.created_at ? new Date(deviceData.created_at).toLocaleTimeString() : ''}
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={() => setAnimalDismissed(true)}
            style={{
              background: 'none', border: '1px solid #7a3a3a', borderRadius: '6px',
              color: '#EF4444', padding: '4px 12px', cursor: 'pointer', fontSize: '12px',
              whiteSpace: 'nowrap'
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {stats && (
        <div className="dashboard-stats">
          <div className="stat-card">
            <div className="stat-value">{stats.totalPlants}</div>
            <div className="stat-label">{t('totalPlants')}</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: 'var(--success)' }}>{stats.healthyCount}</div>
            <div className="stat-label">{t('healthy')}</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: 'var(--danger)' }}>{stats.alertCount}</div>
            <div className="stat-label">{t('needsAttention')}</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: 'var(--primary-light)' }}>{stats.avgHealthScore}%</div>
            <div className="stat-label">{t('avgHealth')}</div>
          </div>
        </div>
      )}

      {plants.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-emoji">🌱</div>
          <h2 className="empty-state-title">{t('noPlantsTitle')}</h2>
          <p className="empty-state-subtitle">{t('noPlantsText')}</p>
          {!isGuest && (
            <button className="empty-state-btn" onClick={onAddPlant}>
              {t('addFirstPlant')}
            </button>
          )}
        </div>
      ) : (
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
      )}
    </div>
  );
}
