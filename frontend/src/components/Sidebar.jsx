import React, { useState } from 'react';

export default function Sidebar({ currentPage, setCurrentPage, user, onLogout }) {
  const [isOpen, setIsOpen] = useState(false);
  const isGuest = user?.isGuest;

  const navItems = [
    { id: 'live',      label: 'Live Monitor', icon: '📡' },
    { id: 'dashboard', label: 'Dashboard',    icon: '📊' },
    { id: 'my-plants', label: 'My Plants',    icon: '🌿' },
    { id: 'camera',    label: 'Camera',       icon: '📷' },
    { id: 'analytics', label: 'Analytics',    icon: '📈' },
    { id: 'settings',  label: 'Settings',     icon: '⚙️' }
  ];

  const handleNavClick = (page) => { setCurrentPage(page); setIsOpen(false); };
  const handleLogout = async () => { onLogout(); setIsOpen(false); };

  return (
    <>
      <button className="sidebar-hamburger" onClick={() => setIsOpen(!isOpen)}>☰</button>
      {isOpen && <div className="sidebar-overlay" onClick={() => setIsOpen(false)} />}

      <nav className={`sidebar ${isOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-logo">🌿 PlantIQ</div>
        </div>

        {isGuest && (
          <div className="guest-banner">
            <span className="guest-badge">👀 Guest Mode</span>
            <p className="guest-banner-text">Viewing demo data — read only</p>
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
                <span className="sidebar-label">{item.label}</span>
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
                  {isGuest ? 'Guest' : user.username}
                  {isGuest && <span className="guest-tag"> (demo)</span>}
                </div>
                <div className="sidebar-user-email">{isGuest ? 'No account' : user.email}</div>
              </div>
            </div>
            <button className="sidebar-logout-btn" onClick={handleLogout}>
              {isGuest ? 'Sign Up' : 'Logout'}
            </button>
          </div>
        )}
      </nav>
    </>
  );
}
