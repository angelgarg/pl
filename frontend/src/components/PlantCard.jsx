import React from 'react';

export default function PlantCard({ plant, onViewDetails, onAddNote }) {
  const healthScore = plant.health_score || 0;
  const lastReading = plant.latestReading;

  let healthStatus = 'Healthy';
  let healthEmoji = '🟢';
  let healthColor = 'var(--success)';

  if (healthScore < 40) {
    healthStatus = 'Critical';
    healthEmoji = '🔴';
    healthColor = 'var(--danger)';
  } else if (healthScore < 70) {
    healthStatus = 'Needs Water';
    healthEmoji = '🟡';
    healthColor = 'var(--warning)';
  }

  const lastUpdated = lastReading
    ? new Date(lastReading.created_at).toLocaleDateString()
    : 'No data';

  return (
    <div className="plant-card">
      <div className="plant-card-image">
        {plant.profile_image ? (
          <img src={plant.profile_image} alt={plant.name} />
        ) : (
          <div className="plant-card-emoji">🌱</div>
        )}
      </div>

      <div className="plant-card-content">
        <h3 className="plant-card-name">{plant.name}</h3>
        <p className="plant-card-species">{plant.species}</p>
        <p className="plant-card-location">📍 {plant.location || 'No location'}</p>

        <div className="plant-card-sensors">
          {lastReading ? (
            <>
              <div className="plant-card-sensor">
                <span className="plant-card-sensor-icon">💧</span>
                <span>{lastReading.soil_moisture}%</span>
              </div>
              <div className="plant-card-sensor">
                <span className="plant-card-sensor-icon">🌡️</span>
                <span>{lastReading.temperature}°C</span>
              </div>
              <div className="plant-card-sensor">
                <span className="plant-card-sensor-icon">💨</span>
                <span>{lastReading.humidity}%</span>
              </div>
            </>
          ) : (
            <p className="plant-card-no-data">No sensor data</p>
          )}
        </div>

        <div className="plant-card-health">
          <div className="plant-card-health-gauge">
            <svg viewBox="0 0 100 100" className="plant-card-gauge-svg">
              <circle cx="50" cy="50" r="40" fill="none" stroke="#e5e7eb" strokeWidth="8" />
              <circle
                cx="50"
                cy="50"
                r="40"
                fill="none"
                stroke={healthColor}
                strokeWidth="8"
                strokeDasharray={`${healthScore * 2.51} 251`}
                strokeLinecap="round"
                className="plant-card-gauge-fill"
              />
              <text x="50" y="55" textAnchor="middle" fontSize="20" fontWeight="bold" fill={healthColor}>
                {healthScore}
              </text>
            </svg>
          </div>
          <div className="plant-card-health-status">
            <div className="plant-card-health-badge">
              {healthEmoji} {healthStatus}
            </div>
            <div className="plant-card-last-updated">Updated {lastUpdated}</div>
          </div>
        </div>

        <div className="plant-card-actions">
          <button className="plant-card-btn plant-card-btn-primary" onClick={onViewDetails}>
            View Details
          </button>
          <button className="plant-card-btn plant-card-btn-secondary" onClick={onAddNote}>
            Add Note
          </button>
        </div>
      </div>
    </div>
  );
}
