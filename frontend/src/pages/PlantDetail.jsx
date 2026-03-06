import React, { useState, useEffect } from 'react';
import SensorGauge from '../components/SensorGauge';
import { LineChart, Line, BarChart, Bar, RadarChart, Radar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PolarAngleAxis, PolarRadiusAxis } from 'recharts';
import * as api from '../api';

export default function PlantDetail({ plantId, onBack }) {
  const [plant, setPlant] = useState(null);
  const [readings, setReadings] = useState([]);
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [timeRange, setTimeRange] = useState('7d');
  const [newNote, setNewNote] = useState('');

  useEffect(() => {
    fetchData();
  }, [plantId, timeRange]);

  const fetchData = async () => {
    try {
      setError('');
      const [plantData, readingsData, notesData] = await Promise.all([
        api.getPlant(plantId),
        api.getPlantReadings(plantId, 100),
        api.getPlantNotes(plantId)
      ]);

      setPlant(plantData);
      setReadings(readingsData);
      setNotes(notesData);
    } catch (err) {
      setError(err.message || 'Failed to load plant data');
    } finally {
      setLoading(false);
    }
  };

  const handleAddNote = async (e) => {
    e.preventDefault();
    if (!newNote.trim()) return;

    try {
      await api.addNote(plantId, newNote);
      setNewNote('');
      fetchData();
    } catch (err) {
      setError(err.message);
    }
  };

  const getFilteredReadings = () => {
    const now = new Date();
    let daysBack = 7;

    if (timeRange === '24h') daysBack = 1;
    else if (timeRange === '30d') daysBack = 30;

    const cutoffDate = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
    return readings.filter(r => new Date(r.created_at) >= cutoffDate).reverse();
  };

  const latestReading = readings[0];
  const filteredReadings = getFilteredReadings();
  const chartData = filteredReadings.map(r => ({
    date: new Date(r.created_at).toLocaleDateString(),
    moisture: r.soil_moisture,
    temperature: r.temperature,
    humidity: r.humidity,
    healthScore: r.health_score
  }));

  const radarData = latestReading ? [
    { metric: 'Moisture', value: Math.min(latestReading.soil_moisture, 100) },
    { metric: 'Temperature', value: Math.min((latestReading.temperature / 35) * 100, 100) },
    { metric: 'Humidity', value: Math.min(latestReading.humidity, 100) },
    { metric: 'Health', value: latestReading.health_score }
  ] : [];

  if (loading) {
    return (
      <div className="page">
        <button onClick={onBack} className="back-btn">← Back</button>
        <div className="loading-skeleton">
          <div className="loading-skeleton-item" style={{ height: '200px', marginBottom: '20px' }} />
          <div className="loading-skeleton-item" style={{ height: '300px' }} />
        </div>
      </div>
    );
  }

  if (!plant) {
    return (
      <div className="page">
        <button onClick={onBack} className="back-btn">← Back</button>
        <div className="error-message">Plant not found</div>
      </div>
    );
  }

  return (
    <div className="page">
      <button onClick={onBack} className="back-btn">← Back</button>

      <div className="plant-detail-header">
        <div className="plant-detail-image">
          {plant.profile_image ? (
            <img src={plant.profile_image} alt={plant.name} />
          ) : (
            <div className="plant-detail-emoji">🌿</div>
          )}
        </div>
        <div className="plant-detail-info">
          <h1 className="plant-detail-name">{plant.name}</h1>
          <p className="plant-detail-species">{plant.species}</p>
          <p className="plant-detail-location">📍 {plant.location || 'No location'}</p>
          {latestReading && (
            <div className="plant-detail-health-badge">
              Health Score: {latestReading.health_score}%
            </div>
          )}
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}

      {latestReading && (
        <div className="sensor-gauges">
          <SensorGauge
            value={latestReading.soil_moisture}
            max={100}
            label="Soil Moisture"
            color="var(--accent)"
          />
          <SensorGauge
            value={latestReading.temperature}
            max={35}
            label="Temperature"
            color="var(--warning)"
            unit="°C"
          />
          <SensorGauge
            value={latestReading.humidity}
            max={100}
            label="Humidity"
            color="var(--primary-light)"
          />
          <SensorGauge
            value={latestReading.health_score}
            max={100}
            label="Health Score"
            color="var(--success)"
          />
        </div>
      )}

      <div className="charts-section">
        <div className="chart-container">
          <div className="chart-header">
            <h3>Sensor Readings Over Time</h3>
            <div className="time-range-buttons">
              {['24h', '7d', '30d'].map(range => (
                <button
                  key={range}
                  className={`time-range-btn ${timeRange === range ? 'active' : ''}`}
                  onClick={() => setTimeRange(range)}
                >
                  {range}
                </button>
              ))}
            </div>
          </div>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid #e5e7eb' }} />
                <Legend />
                <Line type="monotone" dataKey="moisture" stroke="var(--accent)" name="Moisture %" />
                <Line type="monotone" dataKey="temperature" stroke="var(--warning)" name="Temp °C" />
                <Line type="monotone" dataKey="humidity" stroke="var(--primary-light)" name="Humidity %" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="no-data-message">No data to display</p>
          )}
        </div>

        {radarData.length > 0 && (
          <div className="chart-container">
            <h3>Health Overview</h3>
            <ResponsiveContainer width="100%" height={300}>
              <RadarChart data={radarData}>
                <PolarAngleAxis dataKey="metric" />
                <PolarRadiusAxis />
                <Radar name="Health Metrics" dataKey="value" stroke="var(--primary-light)" fill="var(--primary-light)" fillOpacity={0.6} />
                <Tooltip contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid #e5e7eb' }} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="notes-section">
        <h3>Growth Journal</h3>
        <form onSubmit={handleAddNote} className="note-form">
          <input
            type="text"
            placeholder="Add a note about your plant..."
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            className="note-input"
          />
          <button type="submit" className="note-submit-btn">Add Note</button>
        </form>

        {notes.length > 0 ? (
          <div className="notes-list">
            {notes.map(note => (
              <div key={note.id} className="note-item">
                <div className="note-date">{new Date(note.created_at).toLocaleDateString()}</div>
                <div className="note-content">{note.content}</div>
              </div>
            ))}
          </div>
        ) : (
          <p className="no-data-message">No notes yet. Add one to track your plant's progress!</p>
        )}
      </div>
    </div>
  );
}
