import React, { useState } from 'react';
import { useLang } from '../LangContext';
import { LANG_OPTIONS } from '../i18n';

export default function SettingsPage({ user }) {
  const { lang, setLang, t } = useLang();
  const [notifications, setNotifications] = useState({
    healthAlerts: true,
    wateringReminders: true,
    weeklyReport: false,
  });
  const [saved, setSaved] = useState(false);

  const handleToggle = (key) => {
    setNotifications(prev => ({ ...prev, [key]: !prev[key] }));
    setSaved(false);
  };

  const handleSave = () => {
    // Persist to localStorage for now (backend can be added later)
    try {
      localStorage.setItem('bhoomiq_notifications', JSON.stringify(notifications));
    } catch {}
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">{t('settingsTitle')}</h1>
        <p className="page-subtitle">{t('settingsSubtitle')}</p>
      </div>

      {/* Account */}
      <div className="settings-section">
        <h3>{t('account')}</h3>
        <div className="settings-card">
          <div className="settings-field">
            <label>{t('username')}</label>
            <input type="text" value={user?.username || ''} disabled />
          </div>
          <div className="settings-field">
            <label>{t('email')}</label>
            <input type="email" value={user?.email || ''} disabled />
          </div>
        </div>
      </div>

      {/* Language */}
      <div className="settings-section">
        <h3>{t('language')}</h3>
        <div className="settings-card">
          <div className="settings-field">
            <label>{t('languageLabel')}</label>
            <div className="lang-selector-row">
              {LANG_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  className={`lang-option-btn ${lang === opt.value ? 'active' : ''}`}
                  onClick={() => setLang(opt.value)}
                >
                  {opt.native} <span className="lang-option-sub">({opt.label})</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Notifications */}
      <div className="settings-section">
        <h3>{t('notifications')}</h3>
        <div className="settings-card">
          <div className="settings-checkbox">
            <input
              type="checkbox"
              id="healthAlerts"
              checked={notifications.healthAlerts}
              onChange={() => handleToggle('healthAlerts')}
            />
            <label htmlFor="healthAlerts">{t('healthAlerts')}</label>
          </div>
          <div className="settings-checkbox">
            <input
              type="checkbox"
              id="wateringReminders"
              checked={notifications.wateringReminders}
              onChange={() => handleToggle('wateringReminders')}
            />
            <label htmlFor="wateringReminders">{t('wateringReminders')}</label>
          </div>
          <div className="settings-checkbox">
            <input
              type="checkbox"
              id="weeklyReport"
              checked={notifications.weeklyReport}
              onChange={() => handleToggle('weeklyReport')}
            />
            <label htmlFor="weeklyReport">{t('weeklyReport')}</label>
          </div>
        </div>
      </div>

      {/* AI Engine */}
      <div className="settings-section">
        <h3>AI &amp; Integrations</h3>
        <div className="settings-card">
          <div className="settings-field">
            <label>{t('apiStatus')}</label>
            <div className="api-key-status">
              <span className="status-indicator" style={{ color: 'var(--success)' }}>●</span>
              <span>Azure GPT-4o — {t('connected')}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Save button */}
      <button className="settings-save-btn" onClick={handleSave}>
        {saved ? `✅ ${t('saved')}` : t('saveSettings')}
      </button>

      {/* About */}
      <div className="settings-section" style={{ marginTop: '2rem' }}>
        <h3>{t('aboutTitle')}</h3>
        <div className="settings-card">
          <p style={{ color: 'var(--text-secondary)', marginBottom: 6 }}>{t('appName')} v1.0</p>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 12 }}>{t('aboutText')}</p>
          <a href="#" className="settings-link">Privacy Policy</a>
          <a href="#" className="settings-link" style={{ marginLeft: 16 }}>Terms of Service</a>
        </div>
      </div>
    </div>
  );
}
