import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import Toast from './components/Toast';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import Dashboard from './pages/Dashboard';
import PlantDetail from './pages/PlantDetail';
import AddPlantPage from './pages/AddPlantPage';
import AnalyticsPage from './pages/AnalyticsPage';
import CameraPage from './pages/CameraPage';
import SettingsPage from './pages/SettingsPage';
import * as api from './api';

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState('login');
  const [currentPlantId, setCurrentPlantId] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [showAddNote, setShowAddNote] = useState(false);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const userData = await api.getMe();
      if (userData) {
        setUser(userData);
        setCurrentPage('dashboard');
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
    setCurrentPage('dashboard');
    addToast({ type: 'success', message: `Welcome back, ${userData.username}!` });
  };

  const handleRegister = (userData) => {
    setUser(userData);
    setCurrentPage('dashboard');
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
    setCurrentPage('dashboard');
    addToast({ type: 'success', message: 'Plant added successfully!' });
  };

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner">🌿</div>
        <p>PlantIQ</p>
      </div>
    );
  }

  // Not logged in
  if (!user) {
    return (
      <>
        {currentPage === 'register' ? (
          <RegisterPage
            onLogin={handleRegister}
            onSwitchToLogin={() => setCurrentPage('login')}
          />
        ) : (
          <LoginPage
            onLogin={handleLogin}
            onSwitchToRegister={() => setCurrentPage('register')}
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

  // Logged in - show sidebar + page
  return (
    <div className="app-layout">
      <Sidebar
        currentPage={currentPage}
        setCurrentPage={setCurrentPage}
        user={user}
        onLogout={handleLogout}
      />

      <main className="main-content">
        {currentPage === 'dashboard' && (
          <Dashboard
            onNavigateToPlant={handleNavigateToPlant}
            onAddNote={handleAddNote}
          />
        )}

        {currentPage === 'my-plants' && (
          <Dashboard
            onNavigateToPlant={handleNavigateToPlant}
            onAddNote={handleAddNote}
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
      </main>

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

export default App;
