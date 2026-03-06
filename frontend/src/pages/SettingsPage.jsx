import React, { useState, useEffect } from 'react';
import * as api from '../api';

export default function SettingsPage({ user }) {
  const [apiKeyVisible, setApiKeyVisible] = useState(false);

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">Manage your account and preferences</p>
      </div>

      <div className="settings-section">
        <h3>Account Information</h3>
        <div className="settings-card">
          <div className="settings-field">
            <label>Username</label>
            <input type="text" value={user?.username || ''} disabled />
          </div>
          <div className="settings-field">
            <label>Email</label>
            <input type="email" value={user?.email || ''} disabled />
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3>Notifications</h3>
        <div className="settings-card">
          <div className="settings-checkbox">
            <input type="checkbox" id="healthAlerts" defaultChecked />
            <label htmlFor="healthAlerts">Plant health alerts</label>
          </div>
          <div className="settings-checkbox">
            <input type="checkbox" id="wateringReminders" defaultChecked />
            <label htmlFor="wateringReminders">Watering reminders</label>
          </div>
          <div className="settings-checkbox">
            <input type="checkbox" id="weeklyReport" defaultChecked />
            <label htmlFor="weeklyReport">Weekly report</label>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3>API & Integrations</h3>
        <div className="settings-card">
          <div className="settings-field">
            <label>OpenAI API Key Status</label>
            <div className="api-key-status">
              <span className="status-indicator">●</span>
              <span>{process.env.REACT_APP_OPENAI_KEY ? 'Connected' : 'Not configured'}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3>About PlantIQ</h3>
        <div className="settings-card">
          <p>PlantIQ v1.0</p>
          <p>Smart plant monitoring with AI-powered insights</p>
          <a href="#" className="settings-link">Privacy Policy</a>
          <a href="#" className="settings-link">Terms of Service</a>
        </div>
      </div>
    </div>
  );
}
