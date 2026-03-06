import React, { useState } from 'react';

export default function Sidebar({ currentPage, setCurrentPage, user, onLogout }) {
  const [isOpen, setIsOpen] = useState(false);

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: '📊' },
    { id: 'my-plants', label: 'My Plants', icon: '🌿' },
    { id: 'camera', label: 'Camera', icon: '📷' },
    { id: 'analytics', label: 'Analytics', icon: '📈' },
    { id: 'settings', label: 'Settings', icon: '⚙️' }
  ];

  const handleNavClick = (page) => {
    setCurrentPage(page);
    setIsOpen(false);
  };

  const handleLogout = async () => {
    onLogout();
    setIsOpen(false);
  };

  return (
    <>
      {/* Mobile hamburger */}
      <button
        className="sidebar-hamburger"
        onClick={() => setIsOpen(!isOpen)}
      >
        ☰
      </button>

      {/* Overlay for mobile */}
      {isOpen && <div className="sidebar-overlay" onClick={() => setIsOpen(false)} />}

      {/* Sidebar */}
      <nav className={`sidebar ${isOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-logo">
            🌿 PlantIQ
          </div>
        </div>

        <ul className="sidebar-nav">
          {navItems.map(item => (
            <li key={item.id}>
              <button
                className={`sidebar-nav-item ${currentPage === item.id ? 'active' : ''}`}
                onClick={() => handleNavClick(item.id)}
              >
                <span className="sidebar-icon">{item.icon}</span>
                <span className="sidebar-label">{item.label}</span>
              </button>
            </li>
          ))}
        </ul>

        {user && (
          <div className="sidebar-footer">
            <div className="sidebar-user">
              <div className="sidebar-user-avatar">👤</div>
              <div className="sidebar-user-info">
                <div className="sidebar-user-name">{user.username}</div>
                <div className="sidebar-user-email">{user.email}</div>
              </div>
            </div>
            <button
              className="sidebar-logout-btn"
              onClick={handleLogout}
            >
              Logout
            </button>
          </div>
        )}
      </nav>
    </>
  );
}
