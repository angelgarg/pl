import React, { useState, useEffect } from 'react';
import { LangProvider, useLang } from './LangContext';
import Sidebar from './components/Sidebar';
import Toast from './components/Toast';
import ChatWidget from './components/ChatWidget';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import Dashboard from './pages/Dashboard';
import PlantDetail from './pages/PlantDetail';
import AddPlantPage from './pages/AddPlantPage';
import AnalyticsPage from './pages/AnalyticsPage';
import CameraPage from './pages/CameraPage';
import SettingsPage from './pages/SettingsPage';
import LivePage from './pages/LivePage';
import FieldsPage from './pages/FieldsPage';
import * as api from './api';

// Inner app — has access to LangContext
function AppInner() {
  const { t } = useLang();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState('login');
  const [currentPlantId, setCurrentPlantId] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [showAddNote, setShowAddNote] = useState(false);

  useEffect(() => {
    // If URL has ?token=... navigate to reset-password page
    const params = new URLSearchParams(window.location.search);
    if (params.get('token')) {
      setCurrentPage('reset-password');
      setLoading(false);
      return;
    }
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const userData = await api.getMe();
      if (userData) {
        setUser(userData);
        setCurrentPage('live');
      } else {
        setCurrentPage('login');
      }
    } catch (err) {
      console.error('Auth check error:', err);
      setCurrentPage('login');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = (userData) => {
    setUser(userData);
    setCurrentPage('live');
    addToast({ type: "success", message: userData.isGuest ? "Exploring in guest mode 👀" : `Welcome back, ${userData.username}!` });
  };

  const handleRegister = (userData) => {
    setUser(userData);
    setCurrentPage('live');
    addToast({ type: 'success', message: 'Account created successfully!' });
  };

  const handleLogout = async () => {
    try {
      await api.logout();
      setUser(null);
      setCurrentPage('login');
      addToast({ type: 'success', message: 'Logged out successfully' });
    } catch (err) {
      addToast({ type: 'error', message: 'Logout failed' });
    }
  };

  const addToast = (toast) => {
    const id = Date.now();
    const newToast = { ...toast, id };
    setToasts(prev => [...prev, newToast]);
  };

  const removeToast = (id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  const handleNavigateToPlant = (plantId) => {
    setCurrentPlantId(plantId);
    setCurrentPage('plant-detail');
  };

  const handleAddNote = (plantId) => {
    setCurrentPlantId(plantId);
    setShowAddNote(true);
  };

  const handleAddPlantSuccess = () => {
    setCurrentPage('live');
    addToast({ type: 'success', message: 'Plant added successfully!' });
  };

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner">🌿</div>
        <p>{t('appName')}</p>
      </div>
    );
  }

  // Not logged in
  if (!user) {
    return (
      <>
        {currentPage === 'register' && (
          <RegisterPage
            onLogin={handleRegister}
            onSwitchToLogin={() => setCurrentPage('login')}
          />
        )}
        {currentPage === 'forgot-password' && (
          <ForgotPasswordPage
            onBack={() => setCurrentPage('login')}
          />
        )}
        {currentPage === 'reset-password' && (
          <ResetPasswordPage
            onBack={() => setCurrentPage('login')}
            onResetSuccess={() => {
              setCurrentPage('login');
              addToast({ type: 'success', message: 'Password reset! Please log in.' });
            }}
          />
        )}
        {(currentPage === 'login' || (currentPage !== 'register' && currentPage !== 'forgot-password' && currentPage !== 'reset-password')) && (
          <LoginPage
            onLogin={handleLogin}
            onSwitchToRegister={() => setCurrentPage('register')}
            onForgotPassword={() => setCurrentPage('forgot-password')}
          />
        )}
        <div className="toasts-container">
          {toasts.map(toast => (
            <Toast
              key={toast.id}
              message={toast.message}
              type={toast.type}
              onClose={() => removeToast(toast.id)}
            />
          ))}
        </div>
      </>
    );
  }

  // Logged in — show sidebar + page + chat widget
  return (
    <div className="app-layout">
      <Sidebar
        currentPage={currentPage}
        setCurrentPage={setCurrentPage}
        user={user}
        onLogout={handleLogout}
      />

      <main className="main-content">
        {(currentPage === 'dashboard' || currentPage === 'my-plants') && (
          <Dashboard
            onNavigateToPlant={handleNavigateToPlant}
            onAddNote={handleAddNote}
            onAddPlant={() => setCurrentPage('add-plant')}
            isGuest={user?.isGuest}
          />
        )}

        {currentPage === 'plant-detail' && (
          <PlantDetail
            plantId={currentPlantId}
            onBack={() => setCurrentPage('dashboard')}
          />
        )}

        {currentPage === 'add-plant' && (
          <AddPlantPage
            onSuccess={handleAddPlantSuccess}
            onCancel={() => setCurrentPage('dashboard')}
          />
        )}

        {currentPage === 'analytics' && (
          <AnalyticsPage />
        )}

        {currentPage === 'camera' && (
          <CameraPage onAddToast={addToast} />
        )}

        {currentPage === 'settings' && (
          <SettingsPage user={user} />
        )}

        {currentPage === 'live' && (
          <LivePage isGuest={user?.isGuest} onAddToast={addToast} />
        )}

        {currentPage === 'fields' && (
          <FieldsPage isGuest={user?.isGuest} onAddToast={addToast} />
        )}
      </main>

      {/* Floating AI Chat Widget — always visible when logged in */}
      <ChatWidget />

      <div className="toasts-container">
        {toasts.map(toast => (
          <Toast
            key={toast.id}
            message={toast.message}
            type={toast.type}
            onClose={() => removeToast(toast.id)}
          />
        ))}
      </div>
    </div>
  );
}

// Root — wraps everything with LangProvider
function App() {
  return (
    <LangProvider>
      <AppInner />
    </LangProvider>
  );
}

export default App;
