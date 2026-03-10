import React, { useState, useEffect } from 'react';
import PlantCard from '../components/PlantCard';
import * as api from '../api';
import { useLang } from '../LangContext';

export default function Dashboard({ onNavigateToPlant, onAddNote, isGuest }) {
  const { t } = useLang();
  const [plants, setPlants] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    try {
      setError('');
      const [plantsData, statsData] = await Promise.all([
        api.getPlants(),
        api.getDashboard()
      ]);
      setPlants(plantsData);
      setStats(statsData);
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
        <h1 className="page-title">{t('dashboardTitle')}</h1>
        <p className="page-subtitle">{t('dashboardSubtitle')}</p>
      </div>

      {error && <div className="error-message">{error}</div>}

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
            <button className="empty-state-btn" onClick={() => {}}>
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
