const BASE_URL = 'http://localhost:3001';

const apiFetch = (path, options = {}) => {
  return fetch(BASE_URL + path, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    ...options
  });
};

// Auth endpoints
export const login = async (username, password) => {
  const res = await apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });
  if (!res.ok) throw new Error('Login failed');
  return res.json();
};

export const register = async (username, email, password, confirmPassword) => {
  const res = await apiFetch('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, email, password, confirmPassword })
  });
  if (!res.ok) throw new Error('Registration failed');
  return res.json();
};

export const logout = async () => {
  const res = await apiFetch('/auth/logout', {
    method: 'POST'
  });
  if (!res.ok) throw new Error('Logout failed');
  return res.json();
};

export const getMe = async () => {
  const res = await apiFetch('/api/me');
  if (res.status === 401) return null;
  if (!res.ok) throw new Error('Failed to get user');
  return res.json();
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
  if (!res.ok) throw new Error('Failed to create plant');
  return res.json();
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
  const res = await apiFetch(`/api/plants/${id}`, {
    method: 'DELETE'
  });
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
  const res = await apiFetch(`/api/plants/${plantId}/readings`, {
    method: 'POST',
    body: JSON.stringify(data),
    headers: {}
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

// Image upload endpoints
export const uploadPlantImage = async (plantId, file) => {
  const formData = new FormData();
  formData.append('image', file);

  const res = await fetch(BASE_URL + `/api/plants/${plantId}/upload-image`, {
    method: 'POST',
    credentials: 'include',
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
