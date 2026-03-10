import React, { useState, useRef, useEffect } from 'react';
import { useLang } from '../LangContext';
import { LANG_OPTIONS } from '../i18n';

export default function Sidebar({ currentPage, setCurrentPage, user, onLogout }) {
  const [isOpen, setIsOpen] = useState(false);
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const { lang, setLang, t } = useLang();
  const langMenuRef = useRef(null);
  const isGuest = user?.isGuest;

  const navItems = [
    { id: 'live',      labelKey: 'navLive',      icon: '📡' },
    { id: 'fields',    labelKey: 'navFields',    icon: '🌾' },
    { id: 'dashboard', labelKey: 'navDashboard', icon: '📊' },
    { id: 'my-plants', labelKey: 'navPlants',    icon: '🌿' },
    { id: 'camera',    labelKey: 'navCamera',    icon: '📷' },
    { id: 'analytics', labelKey: 'navAnalytics', icon: '📈' },
    { id: 'settings',  labelKey: 'navSettings',  icon: '⚙️' }
  ];

  const handleNavClick = (page) => { setCurrentPage(page); setIsOpen(false); setLangMenuOpen(false); };
  const handleLogout = async () => { onLogout(); setIsOpen(false); };

  // Close lang menu on outside click
  useEffect(() => {
    const handler = (e) => {
      if (langMenuRef.current && !langMenuRef.current.contains(e.target)) {
        setLangMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const currentLang = LANG_OPTIONS.find(o => o.value === lang) || LANG_OPTIONS[0];

  return (
    <>
      <button className="sidebar-hamburger" onClick={() => setIsOpen(!isOpen)}>☰</button>
      {isOpen && <div className="sidebar-overlay" onClick={() => setIsOpen(false)} />}

      <nav className={`sidebar ${isOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-logo">🌿 {t('appName')}</div>

          {/* Language selector button */}
          <div className="lang-dropdown-wrap" ref={langMenuRef}>
            <button
              className="lang-toggle-btn"
              onClick={() => setLangMenuOpen(o => !o)}
              title={t('languageLabel')}
            >
              {currentLang.native} ▾
            </button>

            {langMenuOpen && (
              <div className="lang-dropdown-menu">
                {LANG_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    className={`lang-dropdown-item ${lang === opt.value ? 'active' : ''}`}
                    onClick={() => { setLang(opt.value); setLangMenuOpen(false); }}
                  >
                    <span className="lang-item-native">{opt.native}</span>
                    <span className="lang-item-region">{opt.region}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {isGuest && (
          <div className="guest-banner">
            <span className="guest-badge">👀 {t('guestMode')}</span>
            <p className="guest-banner-text">{t('guestBannerText')}</p>
          </div>
        )}

        <ul className="sidebar-nav">
          {navItems.map(item => (
            <li key={item.id}>
              <button
                className={`sidebar-nav-item ${currentPage === item.id ? 'active' : ''} ${item.id === 'live' ? 'sidebar-live-btn' : ''}`}
                onClick={() => handleNavClick(item.id)}
              >
                <span className="sidebar-icon">{item.icon}</span>
                <span className="sidebar-label">{t(item.labelKey)}</span>
                {item.id === 'live' && <span className="sidebar-live-dot" />}
              </button>
            </li>
          ))}
        </ul>

        {user && (
          <div className="sidebar-footer">
            <div className="sidebar-user">
              <div className="sidebar-user-avatar">{isGuest ? '👀' : '👤'}</div>
              <div className="sidebar-user-info">
                <div className="sidebar-user-name">
                  {isGuest ? t('guestMode') : user.username}
                  {isGuest && <span className="guest-tag"> (demo)</span>}
                </div>
                <div className="sidebar-user-email">{isGuest ? 'No account' : user.email}</div>
              </div>
            </div>
            <button className="sidebar-logout-btn" onClick={handleLogout}>
              {isGuest ? t('register') : t('logout')}
            </button>
          </div>
        )}
      </nav>
    </>
  );
}
