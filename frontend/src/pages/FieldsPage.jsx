import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as api from '../api';

// ─── Helpers ──────────────────────────────────────────────────

function formatDate(iso) {
  if (!iso) return 'Never';
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return d.toLocaleDateString();
}

function alertColor(level) {
  if (level === 'critical' || level === 'high') return '#ef4444';
  if (level === 'medium') return '#f59e0b';
  if (level === 'low') return '#3b82f6';
  return '#22c55e';
}

// ─── Map Component (Leaflet) ───────────────────────────────────

function FieldMap({ fields, devices, onFieldClick, onMapClick, drawMode, onPolygonComplete }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const layersRef = useRef([]);
  const drawPointsRef = useRef([]);
  const drawLayersRef = useRef([]);

  // Initialise Leaflet map
  useEffect(() => {
    if (mapInstanceRef.current) return;
    if (!window.L) return;

    const map = window.L.map(mapRef.current, {
      center: [20.5937, 78.9629], // India default
      zoom: 5
    });

    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    mapInstanceRef.current = map;

    // Try to geolocate
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(pos => {
        map.setView([pos.coords.latitude, pos.coords.longitude], 14);
      });
    }
  }, []);

  // Drawing mode click handler
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    function handleClick(e) {
      if (!drawMode) return;
      const L = window.L;
      drawPointsRef.current.push([e.latlng.lat, e.latlng.lng]);

      // Draw marker
      const m = L.circleMarker(e.latlng, { radius: 5, color: '#16a34a', fillOpacity: 1 }).addTo(map);
      drawLayersRef.current.push(m);

      // Draw polygon outline as we go
      if (drawPointsRef.current.length >= 2) {
        drawLayersRef.current.filter(l => l._isPreviewPoly).forEach(l => map.removeLayer(l));
        const poly = L.polygon(drawPointsRef.current, { color: '#16a34a', fillOpacity: 0.15 }).addTo(map);
        poly._isPreviewPoly = true;
        drawLayersRef.current.push(poly);
      }
    }

    map.on('click', handleClick);
    return () => map.off('click', handleClick);
  }, [drawMode]);

  // Complete drawing on double-click
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    function handleDblClick(e) {
      if (!drawMode) return;
      if (drawPointsRef.current.length >= 3) {
        const coords = [...drawPointsRef.current];
        const center = coords.reduce((acc, p) => [acc[0] + p[0] / coords.length, acc[1] + p[1] / coords.length], [0, 0]);
        onPolygonComplete(coords, center[0], center[1]);
      }
      // Clear drawing layers
      drawLayersRef.current.forEach(l => map.removeLayer(l));
      drawLayersRef.current = [];
      drawPointsRef.current = [];
    }

    map.on('dblclick', handleDblClick);
    return () => map.off('dblclick', handleDblClick);
  }, [drawMode, onPolygonComplete]);

  // Render fields + devices on map
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !window.L) return;
    const L = window.L;

    // Remove old layers
    layersRef.current.forEach(l => map.removeLayer(l));
    layersRef.current = [];

    // Draw fields as polygons
    fields.forEach(field => {
      if (!field.boundary || field.boundary.length < 3) return;
      const poly = L.polygon(field.boundary, {
        color: '#16a34a', fillColor: '#bbf7d0', fillOpacity: 0.3, weight: 2
      }).addTo(map);
      poly.bindTooltip(field.name, { permanent: false });
      poly.on('click', () => onFieldClick(field));
      layersRef.current.push(poly);
    });

    // Draw devices as markers
    devices.forEach(device => {
      if (!device.location_lat || !device.location_lng) return;
      const alertLvl = device.last_reading?.ai_alert_level || 'none';
      const color = alertColor(alertLvl);
      const icon = L.divIcon({
        html: `<div style="background:${color};width:16px;height:16px;border-radius:50%;border:3px solid white;box-shadow:0 2px 4px rgba(0,0,0,0.3)"></div>`,
        className: '',
        iconSize: [16, 16],
        iconAnchor: [8, 8]
      });
      const marker = L.marker([device.location_lat, device.location_lng], { icon }).addTo(map);
      marker.bindTooltip(`📡 ${device.name}`, { permanent: false });
      layersRef.current.push(marker);
    });
  }, [fields, devices, onFieldClick]);

  return (
    <div
      ref={mapRef}
      className="field-map"
      style={{ cursor: drawMode ? 'crosshair' : 'grab' }}
    />
  );
}

// ─── Key reveal modal ──────────────────────────────────────────

function KeyRevealModal({ device, onClose }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(device.device_key).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <h3>🔑 Device Key — Save It Now!</h3>
        </div>
        <div className="key-reveal-body">
          <p className="key-warn">
            ⚠️ This key will <strong>never be shown again</strong>. Copy it and paste it into your ESP32 firmware as <code>DEVICE_KEY</code>.
          </p>
          <div className="key-box">
            <code className="key-text">{device.device_key}</code>
            <button className="key-copy-btn" onClick={copy}>
              {copied ? '✅ Copied!' : '📋 Copy'}
            </button>
          </div>
          <div className="key-firmware-hint">
            In your firmware, set:<br />
            <code>{`const char* DEVICE_KEY = "${device.device_key}";`}</code>
          </div>
          <button className="btn-primary" onClick={onClose} style={{ marginTop: 16, width: '100%' }}>
            I've saved the key — Continue
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Create Field Modal ────────────────────────────────────────

function CreateFieldModal({ onClose, onCreated, onStartDraw, pendingBoundary, pendingCenter }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return setError('Field name is required');
    setLoading(true);
    try {
      const field = await api.createField({
        name: name.trim(),
        description,
        boundary: pendingBoundary || null,
        center_lat: pendingCenter?.[0] || null,
        center_lng: pendingCenter?.[1] || null
      });
      onCreated(field);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>🌾 Create New Field</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {error && <div className="form-error">{error}</div>}

        <form onSubmit={submit} className="modal-form">
          <div className="form-group">
            <label>Field Name *</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. North Wheat Field" required />
          </div>
          <div className="form-group">
            <label>Description</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional notes about this field..." rows={2} />
          </div>

          <div className="field-boundary-section">
            <label>Boundary on Map</label>
            {pendingBoundary ? (
              <div className="boundary-set">
                ✅ Boundary drawn ({pendingBoundary.length} points)
                <button type="button" className="btn-link" onClick={onStartDraw}>Redraw</button>
              </div>
            ) : (
              <button type="button" className="btn-outline" onClick={onStartDraw}>
                ✏️ Draw boundary on map
              </button>
            )}
            <p className="form-hint">Click points on the map to mark the field boundary, then double-click to finish.</p>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Creating...' : 'Create Field'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Create Device Modal ───────────────────────────────────────

function CreateDeviceModal({ field, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return setError('Device name is required');
    setLoading(true);
    try {
      const device = await api.createDevice(field.id, { name: name.trim() });
      onCreated(device);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>📡 Add Device to "{field.name}"</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {error && <div className="form-error">{error}</div>}

        <form onSubmit={submit} className="modal-form">
          <div className="form-group">
            <label>Device Name *</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Sensor Node A" required />
          </div>
          <p className="form-hint">After creating the device, you'll receive a unique device key to flash into your ESP32 firmware.</p>

          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Creating...' : 'Create Device & Get Key'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Field Detail Panel ────────────────────────────────────────

function FieldDetailPanel({ field, devices, onAddDevice, onDeleteDevice, onDeleteField, onClose }) {
  const fieldDevices = devices.filter(d => d.field_id === field.id);

  return (
    <div className="field-detail-panel">
      <div className="panel-header">
        <div>
          <h3 className="panel-title">🌾 {field.name}</h3>
          {field.description && <p className="panel-desc">{field.description}</p>}
        </div>
        <button className="modal-close" onClick={onClose}>✕</button>
      </div>

      <div className="panel-stats">
        <div className="panel-stat">
          <span className="stat-val">{fieldDevices.length}</span>
          <span className="stat-label">Devices</span>
        </div>
        <div className="panel-stat">
          <span className="stat-val">{field.boundary ? `${field.boundary.length}pts` : 'None'}</span>
          <span className="stat-label">Boundary</span>
        </div>
      </div>

      <div className="devices-section">
        <div className="devices-header">
          <h4>Devices</h4>
          <button className="btn-primary btn-sm" onClick={() => onAddDevice(field)}>+ Add Device</button>
        </div>

        {fieldDevices.length === 0 ? (
          <div className="empty-devices">
            <p>No devices yet. Add your first ESP32 sensor node.</p>
          </div>
        ) : (
          <div className="device-list">
            {fieldDevices.map(device => {
              const status = device.is_active ? 'Online' : 'Offline';
              const statusColor = device.is_active ? '#22c55e' : '#94a3b8';
              return (
                <div key={device.id} className="device-item">
                  <div className="device-info">
                    <div className="device-status-dot" style={{ background: statusColor }} />
                    <div>
                      <div className="device-name">📡 {device.name}</div>
                      <div className="device-meta">Last seen: {formatDate(device.last_seen_at)}</div>
                    </div>
                  </div>
                  <button
                    className="btn-danger-sm"
                    onClick={() => onDeleteDevice(device.id)}
                    title="Remove device"
                  >✕</button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="panel-footer">
        <button className="btn-danger-outline" onClick={() => onDeleteField(field.id)}>
          🗑️ Delete Field
        </button>
      </div>
    </div>
  );
}

// ─── Main FieldsPage ───────────────────────────────────────────

export default function FieldsPage({ isGuest, onAddToast }) {
  const [fields, setFields] = useState([]);
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modals
  const [showCreateField, setShowCreateField] = useState(false);
  const [drawMode, setDrawMode] = useState(false);
  const [pendingBoundary, setPendingBoundary] = useState(null);
  const [pendingCenter, setPendingCenter] = useState(null);

  const [selectedField, setSelectedField] = useState(null);
  const [showAddDevice, setShowAddDevice] = useState(false);
  const [addDeviceField, setAddDeviceField] = useState(null);
  const [newDevice, setNewDevice] = useState(null); // shows key reveal

  const load = useCallback(async () => {
    try {
      const [f, d] = await Promise.all([api.getFields(), api.getDevices()]);
      setFields(f);
      setDevices(d);
    } catch (err) {
      onAddToast?.({ type: 'error', message: 'Failed to load fields: ' + err.message });
    } finally {
      setLoading(false);
    }
  }, [onAddToast]);

  useEffect(() => { load(); }, [load]);

  const handlePolygonComplete = useCallback((coords, lat, lng) => {
    setPendingBoundary(coords);
    setPendingCenter([lat, lng]);
    setDrawMode(false);
    setShowCreateField(true);
  }, []);

  const handleCreateField = async (field) => {
    setFields(prev => [...prev, { ...field, device_count: 0 }]);
    setShowCreateField(false);
    setPendingBoundary(null);
    setPendingCenter(null);
    onAddToast?.({ type: 'success', message: `Field "${field.name}" created!` });
  };

  const handleDeleteField = async (fieldId) => {
    if (!confirm('Delete this field? Devices in this field will also be removed.')) return;
    try {
      await api.deleteField(fieldId);
      setFields(prev => prev.filter(f => f.id !== fieldId));
      setDevices(prev => prev.filter(d => d.field_id !== fieldId));
      setSelectedField(null);
      onAddToast?.({ type: 'success', message: 'Field deleted' });
    } catch (err) {
      onAddToast?.({ type: 'error', message: err.message });
    }
  };

  const handleAddDevice = (field) => {
    setAddDeviceField(field);
    setShowAddDevice(true);
  };

  const handleDeviceCreated = (device) => {
    setDevices(prev => [...prev, device]);
    setFields(prev => prev.map(f => f.id === device.field_id
      ? { ...f, device_count: (f.device_count || 0) + 1 }
      : f
    ));
    setShowAddDevice(false);
    setNewDevice(device); // trigger key reveal modal
  };

  const handleDeleteDevice = async (deviceId) => {
    if (!confirm('Remove this device? Its history will remain.')) return;
    try {
      await api.deleteDevice(deviceId);
      setDevices(prev => prev.filter(d => d.id !== deviceId));
      onAddToast?.({ type: 'success', message: 'Device removed' });
    } catch (err) {
      onAddToast?.({ type: 'error', message: err.message });
    }
  };

  if (loading) {
    return (
      <div className="page-loading">
        <div className="loading-spinner">🌾</div>
        <p>Loading fields...</p>
      </div>
    );
  }

  return (
    <div className="fields-page">
      {/* Header */}
      <div className="fields-header">
        <div>
          <h1 className="fields-title">🌾 Fields & Devices</h1>
          <p className="fields-subtitle">
            {fields.length} field{fields.length !== 1 ? 's' : ''} · {devices.length} device{devices.length !== 1 ? 's' : ''}
          </p>
        </div>
        {!isGuest && (
          <button
            className="btn-primary"
            onClick={() => { setShowCreateField(true); setPendingBoundary(null); }}
          >
            + Add Field
          </button>
        )}
      </div>

      {/* Map + panel layout */}
      <div className="fields-layout">
        <div className="fields-map-wrap">
          {drawMode && (
            <div className="draw-banner">
              ✏️ Click to add boundary points · Double-click to finish
              <button className="btn-link" onClick={() => setDrawMode(false)}>Cancel</button>
            </div>
          )}
          <FieldMap
            fields={fields}
            devices={devices}
            onFieldClick={setSelectedField}
            drawMode={drawMode}
            onPolygonComplete={handlePolygonComplete}
          />
        </div>

        {/* Fields sidebar list */}
        <div className="fields-sidebar">
          {selectedField ? (
            <FieldDetailPanel
              field={selectedField}
              devices={devices}
              onAddDevice={handleAddDevice}
              onDeleteDevice={handleDeleteDevice}
              onDeleteField={handleDeleteField}
              onClose={() => setSelectedField(null)}
            />
          ) : (
            <div className="fields-list">
              <h3 className="fields-list-title">Your Fields</h3>
              {fields.length === 0 ? (
                <div className="fields-empty">
                  <div className="fields-empty-icon">🌾</div>
                  <p>No fields yet.</p>
                  {!isGuest && (
                    <button className="btn-primary" onClick={() => setShowCreateField(true)}>
                      Create your first field
                    </button>
                  )}
                </div>
              ) : (
                fields.map(field => (
                  <div
                    key={field.id}
                    className="field-card"
                    onClick={() => setSelectedField(field)}
                  >
                    <div className="field-card-icon">🌾</div>
                    <div className="field-card-body">
                      <div className="field-card-name">{field.name}</div>
                      <div className="field-card-meta">
                        {field.device_count || 0} device{(field.device_count || 0) !== 1 ? 's' : ''}
                        {field.boundary ? ` · ${field.boundary.length}-point boundary` : ' · No boundary'}
                      </div>
                    </div>
                    <span className="field-card-arrow">›</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Create Field Modal */}
      {showCreateField && (
        <CreateFieldModal
          onClose={() => { setShowCreateField(false); setDrawMode(false); }}
          onCreated={handleCreateField}
          onStartDraw={() => { setShowCreateField(false); setDrawMode(true); }}
          pendingBoundary={pendingBoundary}
          pendingCenter={pendingCenter}
        />
      )}

      {/* Create Device Modal */}
      {showAddDevice && addDeviceField && (
        <CreateDeviceModal
          field={addDeviceField}
          onClose={() => setShowAddDevice(false)}
          onCreated={handleDeviceCreated}
        />
      )}

      {/* Key Reveal Modal */}
      {newDevice && (
        <KeyRevealModal
          device={newDevice}
          onClose={() => setNewDevice(null)}
        />
      )}
    </div>
  );
}
