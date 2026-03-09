const BASE_URL = import.meta.env.VITE_BACKEND_URL || 'https://pl-kp57.onrender.com';

// Token stored in localStorage (works cross-origin, no cookie issues)
export const getToken = () => localStorage.getItem('bhoomiq_token');
export const setToken = (t) => t ? localStorage.setItem('bhoomiq_token', t) : localStorage.removeItem('bhoomiq_token');

// Wake up the Render backend (it sleeps after 15 min on free tier).
// Call this before auth so the user gets a friendly message instead of an error.
export const wakeBackend = async () => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000); // 60s max wait
    await fetch(BASE_URL + '/health', { signal: controller.signal });
    clearTimeout(timeout);
    return true;
  } catch (_) {
    return false;
  }
};

const apiFetch = (path, options = {}, timeoutMs = 60000) => {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...options.headers
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(BASE_URL + path, {
    credentials: 'include',
    signal: controller.signal,
    ...options,
    headers
  }).finally(() => clearTimeout(timeout));
};

// Auth endpoints
export const login = async (username, password) => {
  const res = await apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Login failed');
  if (data.token) setToken(data.token);
  return data;
};

export const register = async (username, email, password, confirmPassword) => {
  const res = await apiFetch('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, email, password, confirmPassword })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Registration failed');
  if (data.token) setToken(data.token);
  return data;
};

export const logout = async () => {
  try {
    await apiFetch('/auth/logout', { method: 'POST' });
  } catch (e) { /* ignore */ }
  setToken(null);
  return { success: true };
};

export const guestLogin = async () => {
  const res = await apiFetch('/auth/guest', { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Guest login failed');
  if (data.token) setToken(data.token);
  return data;
};

export const getMe = async () => {
  const token = getToken();
  if (!token) return null;
  try {
    const res = await apiFetch('/api/me');
    if (res.status === 401) { setToken(null); return null; }
    if (!res.ok) return null;
    return res.json();
  } catch (e) {
    return null;
  }
};

// Plant endpoints
export const getPlants = async () => {
  const res = await apiFetch('/api/plants');
  if (!res.ok) throw new Error('Failed to get plants');
  return res.json();
};

export const getPlant = async (id) => {
  const res = await apiFetch(`/api/plants/${id}`);
  if (!res.ok) throw new Error('Failed to get plant');
  return res.json();
};

export const createPlant = async (data) => {
  const res = await apiFetch('/api/plants', {
    method: 'POST',
    body: JSON.stringify(data)
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to create plant');
  return json;
};

export const updatePlant = async (id, data) => {
  const res = await apiFetch(`/api/plants/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error('Failed to update plant');
  return res.json();
};

export const deletePlant = async (id) => {
  const res = await apiFetch(`/api/plants/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete plant');
  return res.json();
};

// Reading endpoints
export const getPlantReadings = async (plantId, limit = 100) => {
  const res = await apiFetch(`/api/plants/${plantId}/readings?limit=${limit}`);
  if (!res.ok) throw new Error('Failed to get readings');
  return res.json();
};

export const addReading = async (plantId, data) => {
  const token = getToken();
  const res = await fetch(BASE_URL + `/api/plants/${plantId}/readings`, {
    method: 'POST',
    credentials: 'include',
    headers: { ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
    body: data // FormData or JSON
  });
  if (!res.ok) throw new Error('Failed to add reading');
  return res.json();
};

// Note endpoints
export const getPlantNotes = async (plantId) => {
  const res = await apiFetch(`/api/plants/${plantId}/notes`);
  if (!res.ok) throw new Error('Failed to get notes');
  return res.json();
};

export const addNote = async (plantId, content) => {
  const res = await apiFetch(`/api/plants/${plantId}/notes`, {
    method: 'POST',
    body: JSON.stringify({ content })
  });
  if (!res.ok) throw new Error('Failed to add note');
  return res.json();
};

// Dashboard endpoints
export const getDashboard = async () => {
  const res = await apiFetch('/api/dashboard');
  if (!res.ok) throw new Error('Failed to get dashboard');
  return res.json();
};

// Analytics endpoints
export const getAnalytics = async () => {
  const res = await apiFetch('/api/analytics');
  if (!res.ok) throw new Error('Failed to get analytics');
  return res.json();
};

// Alerts endpoints
export const getAlerts = async () => {
  const res = await apiFetch('/api/alerts');
  if (!res.ok) throw new Error('Failed to get alerts');
  return res.json();
};

// Image upload
export const uploadPlantImage = async (plantId, file) => {
  const formData = new FormData();
  formData.append('image', file);
  const token = getToken();
  const res = await fetch(BASE_URL + `/api/plants/${plantId}/upload-image`, {
    method: 'POST',
    credentials: 'include',
    headers: { ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
    body: formData
  });
  if (!res.ok) throw new Error('Failed to upload image');
  return res.json();
};

export const analyzePlant = async (plantId, imagePath) => {
  const res = await apiFetch(`/api/plants/${plantId}/analyze`, {
    method: 'POST',
    body: JSON.stringify({ imagePath })
  });
  if (!res.ok) throw new Error('Failed to analyze plant');
  return res.json();
};

// ── Device / Live Monitor endpoints ─────────────────────────

export const getDeviceLatest = async () => {
  const res = await apiFetch('/api/device/latest');
  if (!res.ok) throw new Error('Failed to get device data');
  return res.json();
};

export const getDeviceHistory = async (limit = 100) => {
  const res = await apiFetch(`/api/device/history?limit=${limit}`);
  if (!res.ok) throw new Error('Failed to get history');
  return res.json();
};

export const getDeviceStats = async () => {
  const res = await apiFetch('/api/device/stats');
  if (!res.ok) throw new Error('Failed to get stats');
  return res.json();
};

// ── Fields endpoints ─────────────────────────────────────────

export const getFields = async () => {
  const res = await apiFetch('/api/fields');
  if (!res.ok) throw new Error('Failed to get fields');
  return res.json();
};

export const getField = async (id) => {
  const res = await apiFetch(`/api/fields/${id}`);
  if (!res.ok) throw new Error('Failed to get field');
  return res.json();
};

export const createField = async (data) => {
  const res = await apiFetch('/api/fields', {
    method: 'POST',
    body: JSON.stringify(data)
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to create field');
  return json;
};

export const updateField = async (id, data) => {
  const res = await apiFetch(`/api/fields/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error('Failed to update field');
  return res.json();
};

export const deleteField = async (id) => {
  const res = await apiFetch(`/api/fields/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete field');
  return res.json();
};

// ── Devices endpoints ─────────────────────────────────────────

export const getDevices = async () => {
  const res = await apiFetch('/api/devices');
  if (!res.ok) throw new Error('Failed to get devices');
  return res.json();
};

export const createDevice = async (fieldId, data) => {
  const res = await apiFetch(`/api/fields/${fieldId}/devices`, {
    method: 'POST',
    body: JSON.stringify(data)
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to create device');
  return json; // includes device_key (shown ONCE)
};

export const updateDevice = async (id, data) => {
  const res = await apiFetch(`/api/devices/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error('Failed to update device');
  return res.json();
};

export const deleteDevice = async (id) => {
  const res = await apiFetch(`/api/devices/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete device');
  return res.json();
};

export const getDeviceLatestById = async (deviceId) => {
  const res = await apiFetch(`/api/devices/${deviceId}/latest`);
  if (!res.ok) throw new Error('Failed to get device data');
  return res.json();
};

export const triggerPump = async (duration_ms = 5000) => {
  const res = await apiFetch('/api/pump/manual', {
    method: 'POST',
    body: JSON.stringify({ duration_ms })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Pump command failed');
  return data;
};
