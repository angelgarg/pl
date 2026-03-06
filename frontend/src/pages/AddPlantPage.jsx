import React, { useState } from 'react';
import * as api from '../api';

export default function AddPlantPage({ onSuccess, onCancel }) {
  const [formData, setFormData] = useState({
    name: '',
    species: '',
    location: '',
    moisture_min: 30,
    moisture_max: 70,
    temp_min: 15,
    temp_max: 28,
    humidity_min: 40,
    humidity_max: 70
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: isNaN(value) ? value : parseFloat(value)
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await api.createPlant(formData);
      setSuccess(true);
      setTimeout(() => onSuccess(), 1500);
    } catch (err) {
      setError(err.message || 'Failed to create plant');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="page">
        <div className="success-message">
          <div className="success-icon">✅</div>
          <h2>Plant Added Successfully!</h2>
          <p>Redirecting to dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Add New Plant</h1>
        <p className="page-subtitle">Tell us about your plant</p>
      </div>

      {error && <div className="error-message">{error}</div>}

      <form onSubmit={handleSubmit} className="add-plant-form">
        <div className="form-section">
          <h3>Basic Information</h3>

          <div className="form-group">
            <label htmlFor="name">Plant Name *</label>
            <input
              id="name"
              name="name"
              type="text"
              placeholder="e.g., My Monstera"
              value={formData.name}
              onChange={handleChange}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="species">Species *</label>
            <input
              id="species"
              name="species"
              type="text"
              placeholder="e.g., Monstera Deliciosa"
              value={formData.species}
              onChange={handleChange}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="location">Location</label>
            <input
              id="location"
              name="location"
              type="text"
              placeholder="e.g., Living Room Window"
              value={formData.location}
              onChange={handleChange}
            />
          </div>
        </div>

        <div className="form-section">
          <h3>Optimal Conditions</h3>

          <div className="form-row">
            <div className="form-group">
              <label>Soil Moisture Range (%)</label>
              <div className="range-inputs">
                <input
                  name="moisture_min"
                  type="number"
                  min="0"
                  max="100"
                  value={formData.moisture_min}
                  onChange={handleChange}
                />
                <span>-</span>
                <input
                  name="moisture_max"
                  type="number"
                  min="0"
                  max="100"
                  value={formData.moisture_max}
                  onChange={handleChange}
                />
              </div>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Temperature Range (°C)</label>
              <div className="range-inputs">
                <input
                  name="temp_min"
                  type="number"
                  min="-10"
                  max="50"
                  value={formData.temp_min}
                  onChange={handleChange}
                />
                <span>-</span>
                <input
                  name="temp_max"
                  type="number"
                  min="-10"
                  max="50"
                  value={formData.temp_max}
                  onChange={handleChange}
                />
              </div>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Humidity Range (%)</label>
              <div className="range-inputs">
                <input
                  name="humidity_min"
                  type="number"
                  min="0"
                  max="100"
                  value={formData.humidity_min}
                  onChange={handleChange}
                />
                <span>-</span>
                <input
                  name="humidity_max"
                  type="number"
                  min="0"
                  max="100"
                  value={formData.humidity_max}
                  onChange={handleChange}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="form-actions">
          <button
            type="button"
            onClick={onCancel}
            className="form-btn form-btn-secondary"
            disabled={loading}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="form-btn form-btn-primary"
            disabled={loading}
          >
            {loading ? 'Adding Plant...' : 'Add Plant'}
          </button>
        </div>
      </form>
    </div>
  );
}
