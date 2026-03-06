import React, { useState, useEffect } from 'react';
import PlantCard from '../components/PlantCard';
import * as api from '../api';

export default function Dashboard({ onNavigateToPlant, onAddNote }) {
  const [plants, setPlants] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000); // Poll every 60s
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
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <p className="page-subtitle">Monitor your plant collection</p>
      </div>

      {error && <div className="error-message">{error}</div>}

      {stats && (
        <div className="dashboard-stats">
          <div className="stat-card">
            <div className="stat-value">{stats.totalPlants}</div>
            <div className="stat-label">Total Plants</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: 'var(--success)' }}>{stats.healthyCount}</div>
            <div className="stat-label">Healthy</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: 'var(--danger)' }}>{stats.alertCount}</div>
            <div className="stat-label">Needs Attention</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: 'var(--primary-light)' }}>{stats.avgHealthScore}%</div>
            <div className="stat-label">Avg Health</div>
          </div>
        </div>
      )}

      {plants.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-emoji">🌱</div>
          <h2 className="empty-state-title">No plants yet</h2>
          <p className="empty-state-subtitle">Add your first plant to get started with PlantIQ</p>
          <button
            className="empty-state-btn"
            onClick={() => {}}
          >
            Add Plant
          </button>
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
