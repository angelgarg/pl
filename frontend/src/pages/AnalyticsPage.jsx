import React, { useState, useEffect } from 'react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import * as api from '../api';

export default function AnalyticsPage() {
  const [analytics, setAnalytics] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setError('');
      const [analyticsData, alertsData] = await Promise.all([
        api.getAnalytics(),
        api.getAlerts()
      ]);
      setAnalytics(analyticsData);
      setAlerts(alertsData.alerts);
    } catch (err) {
      setError(err.message || 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="page">
        <div className="loading-skeleton">
          <div className="loading-skeleton-item" style={{ height: '300px', marginBottom: '20px' }} />
          <div className="loading-skeleton-item" style={{ height: '300px' }} />
        </div>
      </div>
    );
  }

  const moistureData = analytics?.plants?.map(p => ({
    name: p.name,
    moisture: p.avgMoisture
  })) || [];

  const healthTrendData = analytics?.plants
    ?.filter(p => p.readings.length > 0)
    ?.map(p => ({
      name: p.name,
      readings: p.readings.slice(-10).map(r => ({
        date: new Date(r.date).toLocaleDateString(),
        healthScore: r.healthScore
      }))
    })) || [];

  const plantsByAttention = (analytics?.plants || [])
    .map(p => ({
      name: p.name,
      avgHealth: p.readings.length > 0
        ? Math.round(p.readings.reduce((sum, r) => sum + r.healthScore, 0) / p.readings.length)
        : 0
    }))
    .sort((a, b) => a.avgHealth - b.avgHealth)
    .slice(0, 5);

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Analytics</h1>
        <p className="page-subtitle">Insights across your plant collection</p>
      </div>

      {error && <div className="error-message">{error}</div>}

      <div className="charts-section">
        <div className="chart-container">
          <h3>Average Moisture by Plant</h3>
          {moistureData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={moistureData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} />
                <YAxis />
                <Tooltip contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid #e5e7eb' }} />
                <Bar dataKey="moisture" fill="var(--accent)" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="no-data-message">No data available</p>
          )}
        </div>
      </div>

      <div className="charts-section">
        {healthTrendData.length > 0 && (
          <div className="chart-container">
            <h3>Health Score Trends</h3>
            {healthTrendData.map(plant => (
              <div key={plant.name} style={{ marginBottom: '30px' }}>
                <h4>{plant.name}</h4>
                {plant.readings.length > 0 ? (
                  <ResponsiveContainer width="100%" height={250}>
                    <LineChart data={plant.readings}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="date" />
                      <YAxis domain={[0, 100]} />
                      <Tooltip contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid #e5e7eb' }} />
                      <Line type="monotone" dataKey="healthScore" stroke="var(--primary-light)" name="Health Score" />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="no-data-message">No readings available</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="analytics-section">
        <h3>Plants Needing Most Attention</h3>
        {plantsByAttention.length > 0 ? (
          <div className="attention-list">
            {plantsByAttention.map((plant, idx) => (
              <div key={plant.name} className="attention-item">
                <div className="attention-rank">#{idx + 1}</div>
                <div className="attention-content">
                  <div className="attention-name">{plant.name}</div>
                  <div className="attention-health">
                    Health Score: <strong>{plant.avgHealth}%</strong>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="no-data-message">No plants to analyze yet</p>
        )}
      </div>

      <div className="analytics-section">
        <h3>Active Alerts ({alerts.length})</h3>
        {alerts.length > 0 ? (
          <div className="alerts-list">
            {alerts.map((alert, idx) => (
              <div key={idx} className={`alert-item alert-${alert.severity}`}>
                <div className="alert-plant">{alert.plantName}</div>
                <div className="alert-message">{alert.message}</div>
              </div>
            ))}
          </div>
        ) : (
          <p className="no-data-message">All plants are healthy!</p>
        )}
      </div>
    </div>
  );
}
