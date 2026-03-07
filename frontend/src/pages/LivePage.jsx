import React, { useState, useEffect, useRef } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import * as api from '../api';

// ─── helpers ─────────────────────────────────────────────────

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function fmtFull(iso) {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleString();
}
function timeAgo(iso) {
  if (!iso) return '';
  const sec = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec/60)}m ago`;
  return `${Math.floor(sec/3600)}h ago`;
}

function healthColor(score) {
  if (!score && score !== 0) return '#6b7280';
  if (score >= 75) return '#22c55e';
  if (score >= 50) return '#eab308';
  return '#ef4444';
}
function alertColor(level) {
  return { none: '#22c55e', low: '#84cc16', medium: '#eab308', high: '#ef4444', critical: '#dc2626' }[level] || '#6b7280';
}

function GaugeSVG({ value = 0, max = 100, color, label, unit }) {
  const pct = Math.min(1, Math.max(0, value / max));
  const angle = -140 + pct * 280;
  const r = 52, cx = 70, cy = 70;
  const toXY = (deg) => {
    const rad = (deg * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };
  const start = toXY(-140);
  const end   = toXY(angle);
  const large = pct * 280 > 180 ? 1 : 0;
  return (
    <svg width="140" height="100" viewBox="0 0 140 100">
      <path d={`M ${toXY(-140).x} ${toXY(-140).y} A ${r} ${r} 0 1 1 ${toXY(140).x} ${toXY(140).y}`}
        fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="10" strokeLinecap="round" />
      {pct > 0 && (
        <path d={`M ${start.x} ${start.y} A ${r} ${r} 0 ${large} 1 ${end.x} ${end.y}`}
          fill="none" stroke={color} strokeWidth="10" strokeLinecap="round" />
      )}
      <text x="70" y="62" textAnchor="middle" fill="white" fontSize="20" fontWeight="700">
        {value !== null && value !== undefined ? Math.round(value) : '--'}
      </text>
      <text x="70" y="76" textAnchor="middle" fill="rgba(255,255,255,0.55)" fontSize="10">{unit}</text>
      <text x="70" y="92" textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="9">{label}</text>
    </svg>
  );
}

function AlertBadge({ level }) {
  const labels = { none: '✅ All Good', low: '🟡 Low Alert', medium: '🟠 Medium Alert', high: '🔴 High Alert', critical: '🚨 Critical' };
  return (
    <span className="live-alert-badge" style={{ background: alertColor(level) + '33', color: alertColor(level), border: `1px solid ${alertColor(level)}66` }}>
      {labels[level] || '❓ Unknown'}
    </span>
  );
}

// ─── MAIN COMPONENT ──────────────────────────────────────────

export default function LivePage({ isGuest, onAddToast }) {
  const [live, setLive]       = useState(null);
  const [history, setHistory] = useState([]);
  const [stats, setStats]     = useState(null);
  const [connected, setConnected]     = useState(false);
  const [pumpLoading, setPumpLoading] = useState(false);
  const [pumpDuration, setPumpDuration] = useState(5);
  const [imgError, setImgError]       = useState(false);
  const esRef = useRef(null);

  const BASE_URL = import.meta.env.VITE_BACKEND_URL || 'https://pl-kp57.onrender.com';

  useEffect(() => {
    // Fetch history on mount
    api.getDeviceHistory(100).then(h => setHistory(h || [])).catch(() => {});
    api.getDeviceStats().then(setStats).catch(() => {});

    // Connect SSE
    connectSSE();
    return () => { if (esRef.current) esRef.current.close(); };
  }, []);

  function connectSSE() {
    if (esRef.current) esRef.current.close();
    const token = api.getToken();
    const url = `${BASE_URL}/api/live-stream${token ? `?token=${token}` : ''}`;
    const es = new EventSource(url, { withCredentials: true });
    esRef.current = es;

    es.onopen = () => setConnected(true);
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        setLive(data);
        setImgError(false);
        setHistory(prev => {
          const next = [data, ...prev.filter(r => r.id !== data.id)];
          return next.slice(0, 500);
        });
      } catch (_) {}
    };
    es.onerror = () => {
      setConnected(false);
      // Retry after 10s
      setTimeout(connectSSE, 10000);
    };
  }

  async function handleManualPump() {
    if (isGuest) return onAddToast?.({ type: 'warning', message: 'Guests cannot control the pump' });
    setPumpLoading(true);
    try {
      await api.triggerPump(pumpDuration * 1000);
      onAddToast?.({ type: 'success', message: `💦 Pump queued for ${pumpDuration}s — will activate on next device report` });
    } catch (err) {
      onAddToast?.({ type: 'error', message: err.message || 'Pump command failed' });
    } finally {
      setPumpLoading(false);
    }
  }

  // Chart data — last 50 readings reversed (oldest first)
  const chartData = [...history].reverse().slice(-50).map(r => ({
    t: fmtTime(r.created_at),
    moisture: r.moisture_pct,
    temp: r.temperature_c,
    health: r.ai_health_score
  }));

  const imgSrc = live?.image_path ? `${BASE_URL}${live.image_path}` : null;

  return (
    <div className="page live-page">
      {/* ── Header ── */}
      <div className="live-header">
        <div>
          <h1 className="page-title">🌿 Live Monitor</h1>
          <p className="page-subtitle">
            AI-powered real-time plant health — Azure GPT-4o Vision
          </p>
        </div>
        <div className={`live-connection ${connected ? 'live-on' : 'live-off'}`}>
          <span className="live-dot" />
          {connected ? 'Live' : 'Connecting…'}
        </div>
      </div>

      {/* ── Guest notice ── */}
      {isGuest && (
        <div className="guest-readonly-notice">
          👀 Guest mode — live feed is read-only. Create an account to control the pump.
        </div>
      )}

      {/* ── Waiting state ── */}
      {!live && (
        <div className="live-waiting">
          <div className="live-waiting-icon">📡</div>
          <h3>Waiting for device…</h3>
          <p>Make sure your ESP32-S3 is powered and connected to WiFi.<br />
            Data will appear here as soon as the first report arrives.</p>
        </div>
      )}

      {live && (
        <>
          {/* ── Top grid: Camera + Health + Sensors ── */}
          <div className="live-top-grid">

            {/* Camera card */}
            <div className="live-card camera-card">
              <div className="live-card-header">
                <span>📷 Plant Camera</span>
                <span className="live-timestamp">{timeAgo(live.created_at)}</span>
              </div>
              {imgSrc && !imgError ? (
                <img
                  src={imgSrc}
                  alt="Plant"
                  className="live-plant-img"
                  onError={() => setImgError(true)}
                />
              ) : (
                <div className="live-no-img">📸 No image from device</div>
              )}
              {live.ai_growth_stage && (
                <div className="live-growth-tag">🌱 {live.ai_growth_stage}</div>
              )}
            </div>

            {/* Health + Sensors */}
            <div className="live-right-col">

              {/* Health score */}
              <div className="live-card health-card">
                <div className="live-card-header"><span>💚 Health Score</span></div>
                <div className="health-score-display" style={{ color: healthColor(live.ai_health_score) }}>
                  {live.ai_health_score ?? '--'}<span style={{ fontSize: 20 }}>/100</span>
                </div>
                <AlertBadge level={live.ai_alert_level} />
                {live.ai_disease && live.ai_disease !== 'none' && (
                  <div className="live-disease-tag">🦠 {live.ai_disease}</div>
                )}
              </div>

              {/* Sensor gauges */}
              <div className="live-card sensors-card">
                <div className="live-card-header"><span>📊 Sensors</span></div>
                <div className="sensor-gauges">
                  <div className="sensor-gauge-wrap">
                    <GaugeSVG value={live.moisture_pct} max={100} color="#3b82f6" label="Moisture" unit="%" />
                    <div className="sensor-status" style={{ color: live.moisture_pct < 30 ? '#ef4444' : live.moisture_pct > 70 ? '#eab308' : '#22c55e' }}>
                      {live.moisture_pct < 20 ? 'Critically dry' : live.moisture_pct < 30 ? 'Needs water' : live.moisture_pct < 70 ? 'Good' : 'Wet'}
                    </div>
                  </div>
                  <div className="sensor-gauge-wrap">
                    <GaugeSVG value={live.temperature_c} max={50} color="#f97316" label="Temperature" unit="°C" />
                    <div className="sensor-status" style={{ color: live.temperature_c > 35 || live.temperature_c < 10 ? '#ef4444' : '#22c55e' }}>
                      {live.temperature_c > 35 ? 'Too hot' : live.temperature_c < 10 ? 'Too cold' : 'Normal'}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── AI Analysis card ── */}
          <div className="live-card ai-card">
            <div className="live-card-header">
              <span>🤖 AI Analysis — GPT-4o Vision</span>
              <span className="live-timestamp">{fmtFull(live.created_at)}</span>
            </div>
            {live.ai_visual_status && (
              <p className="ai-visual-status">{live.ai_visual_status}</p>
            )}
            <div className="ai-details-grid">
              {/* Alerts */}
              {live.ai_alerts?.length > 0 && (
                <div className="ai-section">
                  <h4 className="ai-section-title">⚠️ Alerts</h4>
                  {live.ai_alerts.map((a, i) => (
                    <div key={i} className="ai-item alert-item">⚠ {a}</div>
                  ))}
                </div>
              )}
              {/* Immediate actions */}
              {live.ai_immediate_actions?.length > 0 && (
                <div className="ai-section">
                  <h4 className="ai-section-title">🚀 Immediate Actions</h4>
                  {live.ai_immediate_actions.map((a, i) => (
                    <div key={i} className="ai-item action-item">→ {a}</div>
                  ))}
                </div>
              )}
              {/* Recommendations */}
              {live.ai_recommendations?.length > 0 && (
                <div className="ai-section">
                  <h4 className="ai-section-title">💡 Recommendations</h4>
                  {live.ai_recommendations.map((r, i) => (
                    <div key={i} className="ai-item rec-item">• {r}</div>
                  ))}
                </div>
              )}
            </div>
            {live.ai_pump_reason && (
              <div className="ai-pump-reason">
                💦 Pump decision: <strong>{live.ai_pump_reason}</strong>
              </div>
            )}
          </div>

          {/* ── Pump control ── */}
          <div className="live-card pump-card">
            <div className="live-card-header"><span>💦 Water Pump Control</span></div>
            <div className="pump-control-row">
              <div className="pump-status-block">
                <div className={`pump-indicator ${live.pump_activated ? 'pump-on' : 'pump-off'}`}>
                  <span className="pump-dot" />
                  {live.pump_activated ? 'Activated last cycle' : 'Idle'}
                </div>
                {live.pump_activated && (
                  <div className="pump-last">
                    Last run: {live.pump_duration_ms / 1000}s at {fmtFull(live.created_at)}
                  </div>
                )}
              </div>

              {!isGuest && (
                <div className="pump-manual-block">
                  <div className="pump-duration-row">
                    <label>Duration:</label>
                    <input
                      type="range"
                      min="3" max="30" step="1"
                      value={pumpDuration}
                      onChange={e => setPumpDuration(+e.target.value)}
                    />
                    <span className="pump-duration-val">{pumpDuration}s</span>
                  </div>
                  <button
                    className="pump-btn"
                    onClick={handleManualPump}
                    disabled={pumpLoading}
                  >
                    {pumpLoading ? '⏳ Queuing…' : '💧 Water Now'}
                  </button>
                  <p className="pump-note">Command queues until the next device report</p>
                </div>
              )}
            </div>
          </div>

          {/* ── History charts ── */}
          {chartData.length > 1 && (
            <div className="live-card chart-card">
              <div className="live-card-header"><span>📈 Sensor History (last {chartData.length} readings)</span></div>
              <div className="live-charts-grid">
                {/* Moisture chart */}
                <div>
                  <h4 className="chart-sub-title">Soil Moisture %</h4>
                  <ResponsiveContainer width="100%" height={160}>
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="t" tick={{ fill: '#94a3b8', fontSize: 10 }} interval="preserveStartEnd" />
                      <YAxis domain={[0, 100]} tick={{ fill: '#94a3b8', fontSize: 10 }} />
                      <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', color: '#f1f5f9' }} />
                      <Line type="monotone" dataKey="moisture" stroke="#3b82f6" strokeWidth={2} dot={false} name="Moisture %" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                {/* Temp chart */}
                <div>
                  <h4 className="chart-sub-title">Temperature °C</h4>
                  <ResponsiveContainer width="100%" height={160}>
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="t" tick={{ fill: '#94a3b8', fontSize: 10 }} interval="preserveStartEnd" />
                      <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} />
                      <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', color: '#f1f5f9' }} />
                      <Line type="monotone" dataKey="temp" stroke="#f97316" strokeWidth={2} dot={false} name="Temp °C" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                {/* Health chart */}
                <div>
                  <h4 className="chart-sub-title">AI Health Score</h4>
                  <ResponsiveContainer width="100%" height={160}>
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="t" tick={{ fill: '#94a3b8', fontSize: 10 }} interval="preserveStartEnd" />
                      <YAxis domain={[0, 100]} tick={{ fill: '#94a3b8', fontSize: 10 }} />
                      <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', color: '#f1f5f9' }} />
                      <Line type="monotone" dataKey="health" stroke="#22c55e" strokeWidth={2} dot={false} name="Health Score" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}

          {/* ── Stats summary ── */}
          {stats && (
            <div className="live-card stats-card">
              <div className="live-card-header"><span>📊 Summary Stats</span></div>
              <div className="live-stats-row">
                <div className="live-stat">
                  <div className="live-stat-val">{stats.count}</div>
                  <div className="live-stat-lbl">Total Readings</div>
                </div>
                <div className="live-stat">
                  <div className="live-stat-val">{stats.avg_moisture ?? '--'}%</div>
                  <div className="live-stat-lbl">Avg Moisture</div>
                </div>
                <div className="live-stat">
                  <div className="live-stat-val">{stats.avg_temp ?? '--'}°C</div>
                  <div className="live-stat-lbl">Avg Temp</div>
                </div>
                <div className="live-stat">
                  <div className="live-stat-val">{stats.pump_activations_last_100}</div>
                  <div className="live-stat-lbl">Pump Runs (last 100)</div>
                </div>
              </div>
            </div>
          )}

          {/* ── Recent log ── */}
          <div className="live-card log-card">
            <div className="live-card-header"><span>📋 Recent Log</span></div>
            <div className="live-log-table-wrap">
              <table className="live-log-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Moisture</th>
                    <th>Temp</th>
                    <th>Health</th>
                    <th>Alert</th>
                    <th>Pump</th>
                  </tr>
                </thead>
                <tbody>
                  {history.slice(0, 20).map(r => (
                    <tr key={r.id}>
                      <td>{fmtTime(r.created_at)}</td>
                      <td>{r.moisture_pct}%</td>
                      <td>{r.temperature_c}°C</td>
                      <td style={{ color: healthColor(r.ai_health_score) }}>{r.ai_health_score ?? '--'}</td>
                      <td><span style={{ color: alertColor(r.ai_alert_level) }}>{r.ai_alert_level || '--'}</span></td>
                      <td>{r.pump_activated ? `✅ ${r.pump_duration_ms/1000}s` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
