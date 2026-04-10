import React, { useState, useEffect, useRef } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer
} from 'recharts';
import * as api from '../api';
import { setDeviceMode } from '../api';

// ─── IST helpers ─────────────────────────────────────────────

function getISTString(iso) {
  const d = iso ? new Date(iso) : new Date();
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: true
  });
}
function getISTDateStr(iso) {
  const d = iso ? new Date(iso) : new Date();
  return d.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
  });
}
function fmtTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true
  });
}
function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short'
  });
  const time = d.toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true
  });
  return { date, time };
}
function timeAgo(iso) {
  if (!iso) return '';
  const sec = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (sec < 60)   return `${sec} second pehle`;
  if (sec < 3600) return `${Math.floor(sec / 60)} min pehle`;
  return `${Math.floor(sec / 3600)} ghante pehle`;
}

// ─── NPK helpers ─────────────────────────────────────────────

function npkLevel(val, low, ok) {
  if (val == null) return null;
  if (val < low)  return 'kam';
  if (val < ok)   return 'theek';
  return 'achha';
}
function npkColor(val, low, ok) {
  const lvl = npkLevel(val, low, ok);
  return lvl === 'achha' ? '#22c55e' : lvl === 'theek' ? '#eab308' : '#ef4444';
}
function npkAdvice(n, p, k) {
  const tips = [];
  if (n != null && n < 50)  tips.push('🌾 N kam hai — Urea daalo');
  if (p != null && p < 25)  tips.push('🟤 P kam hai — DAP khad daalo');
  if (k != null && k < 100) tips.push('🟡 K kam hai — MOP daalo');
  return tips;
}

// ─── Desi status labels ───────────────────────────────────────

function moistureStatus(pct) {
  if (pct < 20) return { label: '🌵 Bahut Sukha!',   color: '#ef4444' };
  if (pct < 30) return { label: '💧 Paani Chahiye',   color: '#f97316' };
  if (pct < 70) return { label: '✅ Theek Hai',       color: '#22c55e' };
  return           { label: '🌊 Zyada Geela',          color: '#eab308' };
}
function tempStatus(c) {
  if (c > 38) return { label: '🔥 Bahut Garam!',  color: '#ef4444' };
  if (c > 35) return { label: '☀️ Thoda Garam',  color: '#f97316' };
  if (c < 10) return { label: '❄️ Bahut Thanda', color: '#3b82f6' };
  return        { label: '🌡️ Sahi Hai',           color: '#22c55e' };
}

function healthColor(score) {
  if (!score && score !== 0) return '#6b7280';
  if (score >= 75) return '#22c55e';
  if (score >= 50) return '#eab308';
  return '#ef4444';
}
function alertColor(level) {
  return {
    none: '#22c55e', low: '#84cc16', medium: '#eab308',
    high: '#ef4444', critical: '#dc2626'
  }[level] || '#6b7280';
}
function alertLabel(level) {
  return {
    none:     '✅ Sab Theek',
    low:      '🟡 Thodi Chinta',
    medium:   '🟠 Dhyan Do',
    high:     '🔴 Khatre ki Ghanti',
    critical: '🚨 Bahut Zaruri'
  }[level] || '❓ Pata Nahi';
}

// ─── Gauge ───────────────────────────────────────────────────

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
      <path
        d={`M ${toXY(-140).x} ${toXY(-140).y} A ${r} ${r} 0 1 1 ${toXY(140).x} ${toXY(140).y}`}
        fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="10" strokeLinecap="round"
      />
      {pct > 0 && (
        <path
          d={`M ${start.x} ${start.y} A ${r} ${r} 0 ${large} 1 ${end.x} ${end.y}`}
          fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
        />
      )}
      <text x="70" y="62" textAnchor="middle" fill="white" fontSize="20" fontWeight="700">
        {value !== null && value !== undefined ? Math.round(value) : '--'}
      </text>
      <text x="70" y="76" textAnchor="middle" fill="rgba(255,255,255,0.55)" fontSize="10">{unit}</text>
      <text x="70" y="92" textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="9">{label}</text>
    </svg>
  );
}

// ─── MAIN ─────────────────────────────────────────────────────

export default function LivePage({ isGuest, onAddToast }) {
  const [live, setLive]             = useState(null);
  const [history, setHistory]       = useState([]);
  const [stats, setStats]           = useState(null);
  const [connected, setConnected]   = useState(false);
  const [pumpLoading, setPumpLoading] = useState(false);
  const [pumpDuration, setPumpDuration] = useState(5);
  const [imgError, setImgError]     = useState(false);
  const [devices, setDevices]           = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('all');
  const [deviceMode, setDeviceMode]     = useState('auto');  // 'auto' | 'semi'
  const [modeLoading, setModeLoading]   = useState(false);
  const [istClock, setIstClock]     = useState(getISTString());
  const esRef = useRef(null);

  const BASE_URL = import.meta.env.VITE_BACKEND_URL || 'https://pl-kp57.onrender.com';

  // IST live clock
  useEffect(() => {
    const t = setInterval(() => setIstClock(getISTString()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    api.getDevices().then(list => {
      setDevices(list || []);
      // Seed mode from first device
      if (list && list.length > 0) setDeviceMode(list[0].mode || 'auto');
    }).catch(() => {});
    api.getDeviceHistory(100).then(h => {
      const rows = h || [];
      setHistory(rows);
      // Seed live with the most recent reading that has an image,
      // so the photo is visible immediately while waiting for next SSE push
      if (rows.length > 0) {
        const withImg = rows.find(r => r.image_path);
        const latest  = rows[0];
        if (withImg && withImg.id !== latest.id) {
          // Merge: latest sensor values + last known image
          setLive({ ...latest, image_path: withImg.image_path,
            ai_visual_status: latest.ai_visual_status ?? withImg.ai_visual_status,
            ai_growth_stage:  latest.ai_growth_stage  ?? withImg.ai_growth_stage });
        } else {
          setLive(latest);
        }
      }
    }).catch(() => {});
    api.getDeviceStats().then(setStats).catch(() => {});
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
        setSelectedDeviceId(sel => {
          if (sel === 'all' || !sel || data.device_id === sel || (!data.device_id && sel === 'legacy')) {
            setLive(prev => {
              // Keep previous image + AI fields until a new image arrives
              const merged = { ...data };
              if (!merged.image_path && prev?.image_path) {
                merged.image_path      = prev.image_path;
                merged.ai_visual_status = merged.ai_visual_status ?? prev.ai_visual_status;
                merged.ai_growth_stage  = merged.ai_growth_stage  ?? prev.ai_growth_stage;
              }
              return merged;
            });
            // Only reset image error when the image actually changes
            if (data.image_path) setImgError(false);
          }
          return sel;
        });
        setHistory(prev => [data, ...prev.filter(r => r.id !== data.id)].slice(0, 500));
      } catch (_) {}
    };
    es.onerror = () => {
      setConnected(false);
      setTimeout(connectSSE, 10000);
    };
  }

  async function handleManualPump() {
    if (isGuest) return onAddToast?.({ type: 'warning', message: 'Guests paani nahi de sakte 🚫' });
    setPumpLoading(true);
    try {
      // Pass the selected device's key so command goes to the right device
      const selDevice = devices.find(d => d.id === selectedDeviceId) || devices[0];
      await api.triggerPump(pumpDuration * 1000, selDevice?.device_key || null);
      const durLabel = pumpDuration >= 60 ? `${Math.round(pumpDuration / 60)} min` : `${pumpDuration} sec`;
      onAddToast?.({ type: 'success', message: `💦 Paani command bhej diya — ${durLabel} ke liye! ~30 second mein valve khulega.` });
    } catch (err) {
      onAddToast?.({ type: 'error', message: err.message || 'Command fail ho gaya' });
    } finally {
      setPumpLoading(false);
    }
  }

  async function handleModeToggle() {
    if (isGuest) return;
    const selDevice = devices.find(d => d.id === selectedDeviceId) || devices[0];
    if (!selDevice) return;
    const newMode = deviceMode === 'auto' ? 'semi' : 'auto';
    setModeLoading(true);
    try {
      await setDeviceMode(selDevice.id, newMode);
      setDeviceMode(newMode);
      // Update local devices list too
      setDevices(prev => prev.map(d => d.id === selDevice.id ? { ...d, mode: newMode } : d));
      onAddToast?.({ type: 'success', message: newMode === 'auto' ? '🤖 Auto mode on — AI valve control karega' : '🔧 Semi-auto mode on — aap khud control karo' });
    } catch (err) {
      onAddToast?.({ type: 'error', message: err.message || 'Mode change fail' });
    } finally {
      setModeLoading(false);
    }
  }

  const filteredHistory = selectedDeviceId === 'all'
    ? history
    : selectedDeviceId === 'legacy'
      ? history.filter(r => !r.device_id)
      : history.filter(r => r.device_id === selectedDeviceId);

  const chartData = [...filteredHistory].reverse().slice(-50).map(r => ({
    t: fmtTime(r.created_at),
    moisture: r.moisture_pct,
    temp: r.temperature_c,
    health: r.ai_health_score
  }));

  const imgSrc = live?.image_path
    ? (live.image_path.startsWith('http') ? live.image_path : `${BASE_URL}${live.image_path}`)
    : null;

  const mStatus = live ? moistureStatus(live.moisture_pct) : null;
  const tStatus = live ? tempStatus(live.temperature_c) : null;

  return (
    <div className="page live-page">

      {/* ── Desi Hero Banner ── */}
      <div className="live-hero-banner">
        <div className="live-hero-left">
          <div className="live-hero-title">🌱 Live Nazar</div>
          <div className="live-hero-sub">AI se real-time paudhe ki sehat dekho — Gemini 2.0 Flash</div>
        </div>
        <div className="live-hero-right">
          <div className={`live-connection-desi ${connected ? 'live-on-desi' : 'live-off-desi'}`}>
            <span className="live-dot" />
            {connected ? 'Juda Hua ✓' : 'Jod Raha Hai…'}
          </div>
          <div className="live-ist-clock">🕐 {istClock} IST</div>
          <div className="live-ist-date">{getISTDateStr()}</div>
        </div>
      </div>

      {/* ── Device selector ── */}
      {devices.length > 0 && (
        <div className="live-device-selector">
          <label className="device-sel-label">📡 Device Chuniye:</label>
          <select
            className="device-sel-dropdown"
            value={selectedDeviceId}
            onChange={e => {
              setSelectedDeviceId(e.target.value);
              setLive(null); setImgError(false);
              const d = devices.find(d => d.id === e.target.value);
              if (d) setDeviceMode(d.mode || 'auto');
            }}
          >
            <option value="all">Sabhi Devices</option>
            {devices.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            <option value="legacy">Purana / Unregistered</option>
          </select>
        </div>
      )}

      {/* ── Guest notice ── */}
      {isGuest && (
        <div className="guest-readonly-notice">
          👀 Guest mode — sirf dekhna hai. Paani dene ke liye account banao!
        </div>
      )}

      {/* ── Waiting state ── */}
      {!live && (
        <div className="live-waiting">
          <div className="live-waiting-icon">📡</div>
          <h3>Device ka Intezaar Hai…</h3>
          <p>Apna ESP32-S3 on karo aur WiFi se jodo.<br />
            Pehla report aate hi yahan dikhega 🌾</p>
        </div>
      )}

      {live && (
        <>
          {/* ── Top grid: Camera + Health + Sensors ── */}
          <div className="live-top-grid">

            {/* Camera card */}
            <div className="live-card live-card-desi camera-card">
              <div className="live-card-header">
                <span>📷 Paudhe ki Photo</span>
                <span className="live-timestamp">{timeAgo(live.created_at)}</span>
              </div>
              {imgSrc && !imgError ? (
                <img src={imgSrc} alt="Plant" className="live-plant-img" onError={() => setImgError(true)} />
              ) : (
                <div className="live-no-img">📸 Abhi koi photo nahi hai</div>
              )}
              {live.ai_growth_stage && (
                <div className="live-growth-tag">🌱 {live.ai_growth_stage}</div>
              )}
            </div>

            {/* Health + Sensors */}
            <div className="live-right-col">

              {/* Health score */}
              <div className="live-card live-card-desi health-card">
                <div className="live-card-header"><span>💚 Sehat Score</span></div>
                <div className="health-score-display" style={{ color: healthColor(live.ai_health_score) }}>
                  {live.ai_health_score ?? '--'}<span style={{ fontSize: 20 }}>/100</span>
                </div>
                <span className="live-alert-badge-desi" style={{
                  background: alertColor(live.ai_alert_level) + '22',
                  color: alertColor(live.ai_alert_level),
                  border: `1px solid ${alertColor(live.ai_alert_level)}55`
                }}>
                  {alertLabel(live.ai_alert_level)}
                </span>
                {live.ai_disease && live.ai_disease !== 'none' && (
                  <div className="live-disease-tag">🦠 {live.ai_disease}</div>
                )}
              </div>

              {/* Sensor gauges */}
              <div className="live-card live-card-desi sensors-card">
                <div className="live-card-header"><span>📊 Sensor Jaankari</span></div>
                <div className="sensor-gauges">
                  <div className="sensor-gauge-wrap">
                    <GaugeSVG value={live.moisture_pct} max={100} color="#3b82f6" label="Nami" unit="%" />
                    <div className="sensor-status" style={{ color: mStatus.color }}>{mStatus.label}</div>
                  </div>
                  <div className="sensor-gauge-wrap">
                    <GaugeSVG value={live.temperature_c} max={50} color="#f97316" label="Garmi" unit="°C" />
                    <div className="sensor-status" style={{ color: tStatus.color }}>{tStatus.label}</div>
                  </div>
                  {live.battery_pct != null && (
                    <div className="sensor-gauge-wrap">
                      <GaugeSVG
                        value={live.battery_pct} max={100}
                        color={live.battery_pct < 20 ? '#ef4444' : live.battery_pct < 50 ? '#eab308' : '#22c55e'}
                        label="Battery" unit="%"
                      />
                      <div className="sensor-status" style={{ color: live.battery_pct < 20 ? '#ef4444' : live.battery_pct < 50 ? '#eab308' : '#22c55e' }}>
                        {live.battery_pct < 20 ? '🔴 Charge Karo!' : live.battery_pct < 50 ? '🟡 Theek Hai' : '🟢 Full Hai'}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* ── NPK card (shown only when slave sends NPK data) ── */}
          {(live.npk_n > 0 || live.npk_p > 0 || live.npk_k > 0) && (
            <div className="live-card live-card-desi npk-card">
              <div className="live-card-header live-card-header-npk">
                <span>🧪 Mitti ki Jaanch (NPK)</span>
                <span className="live-timestamp">{timeAgo(live.created_at)}</span>
              </div>
              <div className="npk-tiles-row">
                {/* N */}
                <div className="npk-tile">
                  <div className="npk-tile-symbol" style={{ color: npkColor(live.npk_n, 50, 120) }}>N</div>
                  <div className="npk-tile-val" style={{ color: npkColor(live.npk_n, 50, 120) }}>
                    {live.npk_n != null ? live.npk_n : '--'}
                  </div>
                  <div className="npk-tile-unit">mg/kg</div>
                  <div className="npk-tile-label">Naajuk / Nitrogen</div>
                  <div className="npk-tile-badge" style={{ background: npkColor(live.npk_n, 50, 120) + '22', color: npkColor(live.npk_n, 50, 120) }}>
                    {npkLevel(live.npk_n, 50, 120) === 'kam' ? '⬇ Kam' : npkLevel(live.npk_n, 50, 120) === 'theek' ? '✓ Theek' : '↑ Achha'}
                  </div>
                </div>
                {/* P */}
                <div className="npk-tile">
                  <div className="npk-tile-symbol" style={{ color: npkColor(live.npk_p, 25, 60) }}>P</div>
                  <div className="npk-tile-val" style={{ color: npkColor(live.npk_p, 25, 60) }}>
                    {live.npk_p != null ? live.npk_p : '--'}
                  </div>
                  <div className="npk-tile-unit">mg/kg</div>
                  <div className="npk-tile-label">Phosphorus</div>
                  <div className="npk-tile-badge" style={{ background: npkColor(live.npk_p, 25, 60) + '22', color: npkColor(live.npk_p, 25, 60) }}>
                    {npkLevel(live.npk_p, 25, 60) === 'kam' ? '⬇ Kam' : npkLevel(live.npk_p, 25, 60) === 'theek' ? '✓ Theek' : '↑ Achha'}
                  </div>
                </div>
                {/* K */}
                <div className="npk-tile">
                  <div className="npk-tile-symbol" style={{ color: npkColor(live.npk_k, 100, 200) }}>K</div>
                  <div className="npk-tile-val" style={{ color: npkColor(live.npk_k, 100, 200) }}>
                    {live.npk_k != null ? live.npk_k : '--'}
                  </div>
                  <div className="npk-tile-unit">mg/kg</div>
                  <div className="npk-tile-label">Potassium</div>
                  <div className="npk-tile-badge" style={{ background: npkColor(live.npk_k, 100, 200) + '22', color: npkColor(live.npk_k, 100, 200) }}>
                    {npkLevel(live.npk_k, 100, 200) === 'kam' ? '⬇ Kam' : npkLevel(live.npk_k, 100, 200) === 'theek' ? '✓ Theek' : '↑ Achha'}
                  </div>
                </div>
                {/* pH — 7-in-1 sensor only */}
                {live.soil_ph > 0 && (
                  <div className="npk-tile">
                    <div className="npk-tile-symbol" style={{ color: '#a855f7' }}>pH</div>
                    <div className="npk-tile-val" style={{ color: '#a855f7' }}>
                      {(live.soil_ph / 10).toFixed(1)}
                    </div>
                    <div className="npk-tile-unit">pH units</div>
                    <div className="npk-tile-label">Mitti ka pH</div>
                    <div className="npk-tile-badge" style={{ background: '#a855f722', color: '#a855f7' }}>
                      {live.soil_ph / 10 < 6 ? '⬇ Tezaabi' : live.soil_ph / 10 > 7.5 ? '↑ Khaari' : '✓ Sahi'}
                    </div>
                  </div>
                )}
                {/* EC — 7-in-1 sensor only */}
                {live.soil_ec > 0 && (
                  <div className="npk-tile">
                    <div className="npk-tile-symbol" style={{ color: '#eab308' }}>EC</div>
                    <div className="npk-tile-val" style={{ color: '#eab308' }}>
                      {live.soil_ec}
                    </div>
                    <div className="npk-tile-unit">μS/cm</div>
                    <div className="npk-tile-label">Chal-Vidyut</div>
                    <div className="npk-tile-badge" style={{ background: '#eab30822', color: '#eab308' }}>
                      {live.soil_ec > 2000 ? '↑ Zyada Namak' : live.soil_ec < 200 ? '⬇ Poshan Kam' : '✓ Sahi'}
                    </div>
                  </div>
                )}
              </div>
              {/* Advice row */}
              {npkAdvice(live.npk_n, live.npk_p, live.npk_k).length > 0 && (
                <div className="npk-advice-row">
                  <div className="npk-advice-title">💡 Salah:</div>
                  {npkAdvice(live.npk_n, live.npk_p, live.npk_k).map((tip, i) => (
                    <div key={i} className="npk-advice-pill">{tip}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── AI Report card ── */}
          <div className="live-card live-card-desi ai-card">
            <div className="ai-card-header">
              <div className="ai-card-header-left">
                <span className="ai-gemini-badge">✦ Gemini 2.0 Flash</span>
                <span className="ai-card-title">Paudhe ki Sehat Report 🌿</span>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="live-timestamp">{getISTString(live.created_at)} IST</div>
                <div className="live-timestamp">{getISTDateStr(live.created_at)}</div>
              </div>
            </div>

            {/* Score + visual status */}
            <div className="ai-hero-row">
              {live.ai_health_score != null && (
                <div className="ai-score-ring" style={{
                  '--score-color': live.ai_health_score >= 70 ? '#4ade80' : live.ai_health_score >= 40 ? '#fbbf24' : '#f87171',
                  '--score-deg': `${(live.ai_health_score / 100) * 360}deg`
                }}>
                  <div className="ai-score-inner">
                    <span className="ai-score-number">{live.ai_health_score}</span>
                    <span className="ai-score-label">/ 100</span>
                  </div>
                </div>
              )}
              {live.ai_visual_status && (
                <div className="ai-visual-status-box">
                  <div className="ai-vs-icon">🌿</div>
                  <p className="ai-visual-status-text">{live.ai_visual_status}</p>
                </div>
              )}
            </div>

            {/* Pump / valve banner */}
            {live.ai_pump_reason && (
              <div className={`ai-pump-banner ${live.pump_activated ? 'pump-yes' : 'pump-no'}`}>
                <div className="ai-pump-icon-wrap">
                  <span className="ai-pump-icon">{live.pump_activated ? '💧' : '✅'}</span>
                </div>
                <div className="ai-pump-text">
                  <div className="ai-pump-label">
                    {live.pump_activated ? '— Valve Khul Raha Hai —' : '— Paani Ki Zarurat Nahi —'}
                  </div>
                  <div className="ai-pump-status-badge">
                    {live.pump_activated ? 'PAANI DE RAHA HAI 💦' : 'MITTI THEEK HAI ✓'}
                  </div>
                  <div className="ai-pump-reason-text">{live.ai_pump_reason}</div>
                </div>
                {live.pump_activated && <div className="ai-pump-pulse-ring" />}
              </div>
            )}

            {/* Three columns */}
            <div className="ai-insights-grid">
              {live.ai_alerts?.length > 0 && (
                <div className="ai-insight-col ai-col-alert">
                  <div className="ai-col-header">
                    <div className="ai-col-icon-box alert-icon-box">🚨</div>
                    <span className="ai-col-title">Chetaavani</span>
                    <span className="ai-col-count">{live.ai_alerts.length}</span>
                  </div>
                  <div className="ai-col-items">
                    {live.ai_alerts.map((a, i) => (
                      <div key={i} className="ai-insight-item ai-alert-pill">
                        <span className="ai-pill-dot alert-dot" />
                        {a}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {live.ai_immediate_actions?.length > 0 && (
                <div className="ai-insight-col ai-col-action">
                  <div className="ai-col-header">
                    <div className="ai-col-icon-box action-icon-box">⚡</div>
                    <span className="ai-col-title">Abhi Karo</span>
                    <span className="ai-col-count">{live.ai_immediate_actions.length}</span>
                  </div>
                  <div className="ai-col-items">
                    {live.ai_immediate_actions.map((a, i) => (
                      <div key={i} className="ai-insight-item ai-action-pill">
                        <span className="ai-step-num">{i + 1}</span>
                        <span>{a}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {live.ai_recommendations?.length > 0 && (
                <div className="ai-insight-col ai-col-rec">
                  <div className="ai-col-header">
                    <div className="ai-col-icon-box rec-icon-box">💡</div>
                    <span className="ai-col-title">Salah</span>
                    <span className="ai-col-count">{live.ai_recommendations.length}</span>
                  </div>
                  <div className="ai-col-items">
                    {live.ai_recommendations.map((r, i) => (
                      <div key={i} className="ai-insight-item ai-rec-pill">
                        <span className="ai-pill-dot rec-dot" />
                        {r}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Meta pills */}
            <div className="ai-meta-row">
              {live.ai_disease && live.ai_disease !== 'none' && (
                <span className="ai-meta-pill ai-pill-danger">🦠 Bimari: {live.ai_disease}</span>
              )}
              {live.ai_growth_stage && live.ai_growth_stage !== 'vegetative' && (
                <span className="ai-meta-pill ai-pill-info">🌱 Avastha: {live.ai_growth_stage}</span>
              )}
              {live.ai_animal_detected && (
                <span className="ai-meta-pill ai-pill-danger">🐾 Janwar dikha: {live.ai_animal_type}</span>
              )}
            </div>
          </div>

          {/* ── Pump / Valve control ── */}
          <div className="live-card live-card-desi pump-card">
            <div className="live-card-header live-card-header-saffron" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>💦 Paani Valve Control</span>
              {/* Mode toggle — only for logged-in users */}
              {!isGuest && (
                <button
                  className={`mode-toggle-btn ${deviceMode === 'auto' ? 'mode-auto' : 'mode-semi'}`}
                  onClick={handleModeToggle}
                  disabled={modeLoading}
                  title={deviceMode === 'auto' ? 'Auto: AI controls valve — click to switch to Semi-Auto' : 'Semi-Auto: You control valve — click to switch to Auto'}
                >
                  {modeLoading ? '⏳' : deviceMode === 'auto' ? '🤖 Auto' : '🔧 Semi-Auto'}
                </button>
              )}
            </div>
            {/* Mode explanation banner */}
            <div className={`mode-banner ${deviceMode === 'auto' ? 'mode-banner-auto' : 'mode-banner-semi'}`}>
              {deviceMode === 'auto'
                ? '🤖 Auto Mode — AI mitti dekhkar khud paani deta hai'
                : '🔧 Semi-Auto Mode — AI sirf salah deta hai, paani aap doge'
              }
            </div>
            <div className="pump-control-row">
              <div className="pump-status-block">
                <div className={`pump-indicator ${live.pump_activated ? 'pump-on' : 'pump-off'}`}>
                  <span className="pump-dot" />
                  {live.pump_activated ? 'Pichhli baar paani diya ✓' : 'Araam Mein Hai'}
                </div>
                {live.pump_activated && (
                  <div className="pump-last">
                    Pichli baar: {live.pump_duration_ms / 1000} sec — {getISTString(live.created_at)} IST
                  </div>
                )}
              </div>

              {!isGuest && (
                <div className="pump-manual-block">
                  <div className="pump-duration-row">
                    <label>Kitna Paani:</label>
                    <input type="range" min="5" max="180" step="5"
                      value={pumpDuration}
                      onChange={e => setPumpDuration(+e.target.value)}
                    />
                    <span className="pump-duration-val">
                      {pumpDuration >= 60 ? `${Math.round(pumpDuration / 60)}min` : `${pumpDuration}s`}
                    </span>
                  </div>
                  <button className="pump-btn-desi" onClick={handleManualPump} disabled={pumpLoading}>
                    {pumpLoading ? '⏳ Bhej Raha Hai…' : '💧 Paani Do'}
                  </button>
                  <p className="pump-note">⚡ ~30 second mein valve khulega</p>
                </div>
              )}
            </div>
          </div>

          {/* ── Charts ── */}
          {chartData.length > 1 && (
            <div className="live-card live-card-desi chart-card">
              <div className="live-card-header">
                <span>📈 Sensor Itihaas (last {chartData.length} readings)</span>
              </div>
              <div className="live-charts-grid">
                <div>
                  <h4 className="chart-sub-title">🌊 Mitti ki Nami %</h4>
                  <ResponsiveContainer width="100%" height={160}>
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="t" tick={{ fill: '#94a3b8', fontSize: 10 }} interval="preserveStartEnd" />
                      <YAxis domain={[0, 100]} tick={{ fill: '#94a3b8', fontSize: 10 }} />
                      <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', color: '#f1f5f9' }} />
                      <Line type="monotone" dataKey="moisture" stroke="#3b82f6" strokeWidth={2} dot={false} name="Nami %" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div>
                  <h4 className="chart-sub-title">🌡️ Garmi °C</h4>
                  <ResponsiveContainer width="100%" height={160}>
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="t" tick={{ fill: '#94a3b8', fontSize: 10 }} interval="preserveStartEnd" />
                      <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} />
                      <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', color: '#f1f5f9' }} />
                      <Line type="monotone" dataKey="temp" stroke="#f97316" strokeWidth={2} dot={false} name="Garmi °C" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div>
                  <h4 className="chart-sub-title">💚 Sehat Score</h4>
                  <ResponsiveContainer width="100%" height={160}>
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="t" tick={{ fill: '#94a3b8', fontSize: 10 }} interval="preserveStartEnd" />
                      <YAxis domain={[0, 100]} tick={{ fill: '#94a3b8', fontSize: 10 }} />
                      <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', color: '#f1f5f9' }} />
                      <Line type="monotone" dataKey="health" stroke="#22c55e" strokeWidth={2} dot={false} name="Sehat" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}

          {/* ── Summary stats ── */}
          {stats && (
            <div className="live-card live-card-desi stats-card">
              <div className="live-card-header"><span>📊 Kul Jaankari</span></div>
              <div className="live-stats-row">
                <div className="live-stat live-stat-desi live-stat-blue">
                  <div className="live-stat-val">{stats.count}</div>
                  <div className="live-stat-lbl">Kul Readings</div>
                  <div className="live-stat-sublbl">Total Records</div>
                </div>
                <div className="live-stat live-stat-desi live-stat-green">
                  <div className="live-stat-val">{stats.avg_moisture ?? '--'}%</div>
                  <div className="live-stat-lbl">Avshat Nami</div>
                  <div className="live-stat-sublbl">Avg Moisture</div>
                </div>
                <div className="live-stat live-stat-desi live-stat-orange">
                  <div className="live-stat-val">{stats.avg_temp ?? '--'}°C</div>
                  <div className="live-stat-lbl">Avshat Garmi</div>
                  <div className="live-stat-sublbl">Avg Temp</div>
                </div>
                <div className="live-stat live-stat-desi live-stat-saffron">
                  <div className="live-stat-val">{stats.pump_activations_last_100}</div>
                  <div className="live-stat-lbl">Paani Diya</div>
                  <div className="live-stat-sublbl">Pump Runs (last 100)</div>
                </div>
              </div>
            </div>
          )}

          {/* ── Recent log ── */}
          <div className="live-card live-card-desi log-card">
            <div className="live-card-header"><span>📋 Haal ki Khabar</span></div>
            <div className="live-log-table-wrap">
              <table className="live-log-table">
                <thead>
                  <tr>
                    <th>Tarikh</th>
                    <th>Samay (IST)</th>
                    <th>Nami</th>
                    <th>Garmi</th>
                    <th>Sehat</th>
                    <th>Alert</th>
                    <th>Paani</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredHistory.slice(0, 20).map(r => {
                    const dt = fmtDateTime(r.created_at);
                    return (
                    <tr key={r.id}>
                      <td className="log-date-cell">{dt.date}</td>
                      <td className="log-time-cell">{dt.time}</td>
                      <td>{r.moisture_pct}%</td>
                      <td>{r.temperature_c}°C</td>
                      <td style={{ color: healthColor(r.ai_health_score) }}>{r.ai_health_score ?? '--'}</td>
                      <td><span style={{ color: alertColor(r.ai_alert_level) }}>{alertLabel(r.ai_alert_level)}</span></td>
                      <td>{r.pump_activated ? `✅ ${r.pump_duration_ms / 1000}s` : '—'}</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
