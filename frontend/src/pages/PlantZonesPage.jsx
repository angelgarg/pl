import React, { useState, useEffect, useCallback } from 'react';
import * as api from '../api';

// ─── Health color helpers ──────────────────────────────────────────────────
function healthColor(score) {
  if (score >= 80) return '#22c55e';
  if (score >= 60) return '#84cc16';
  if (score >= 40) return '#f59e0b';
  if (score >= 20) return '#f97316';
  return '#ef4444';
}

function statusBadge(status) {
  const map = {
    healthy:         { bg: 'rgba(34,197,94,0.15)',   color: '#4ade80', label: '✅ Healthy' },
    good:            { bg: 'rgba(132,204,22,0.15)',   color: '#a3e635', label: '👍 Good' },
    needs_attention: { bg: 'rgba(245,158,11,0.15)',   color: '#fbbf24', label: '⚠️ Needs Attention' },
    stressed:        { bg: 'rgba(249,115,22,0.15)',   color: '#fb923c', label: '😟 Stressed' },
    critical:        { bg: 'rgba(239,68,68,0.15)',    color: '#f87171', label: '🚨 Critical' },
  };
  return map[status] || map['needs_attention'];
}

function leafBadge(cond) {
  const map = {
    healthy:            '🌿 Healthy',
    wilting:            '😢 Wilting',
    yellowing:          '🟡 Yellowing',
    browning:           '🟤 Browning',
    spotted:            '🔴 Spotted',
    curling:            '🌀 Curling',
    'cannot see clearly': '👁️ Unclear',
  };
  return map[cond] || cond;
}

// ─── Score Ring ────────────────────────────────────────────────────────────
function ScoreRing({ score, size = 72 }) {
  const color = healthColor(score);
  const pct   = Math.max(0, Math.min(100, score));
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `conic-gradient(${color} ${pct * 3.6}deg, rgba(255,255,255,0.07) 0deg)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      position: 'relative', flexShrink: 0
    }}>
      <div style={{
        width: size - 14, height: size - 14, borderRadius: '50%',
        background: 'var(--card-bg, #1a1a2e)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'
      }}>
        <span style={{ fontSize: size * 0.28, fontWeight: 800, color, lineHeight: 1 }}>{score}</span>
        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', marginTop: 1 }}>/ 100</span>
      </div>
    </div>
  );
}

// ─── Zone Card ─────────────────────────────────────────────────────────────
function ZoneCard({ zone, isCritical }) {
  const badge = statusBadge(zone.status);
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{
      background: 'var(--card-bg, #1a1a2e)',
      border: isCritical ? '1.5px solid rgba(239,68,68,0.5)' : '1px solid rgba(255,255,255,0.08)',
      borderRadius: 16, padding: '18px 20px',
      transition: 'transform 0.15s', cursor: 'pointer',
      boxShadow: isCritical ? '0 0 20px rgba(239,68,68,0.1)' : 'none'
    }} onClick={() => setExpanded(e => !e)}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <ScoreRing score={zone.health_score} size={68} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary, #fff)' }}>
              {zone.label}
            </span>
            <span style={{
              fontSize: 11, padding: '2px 8px', borderRadius: 20,
              background: badge.bg, color: badge.color, fontWeight: 600
            }}>{badge.label}</span>
            {isCritical && (
              <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20,
                background: 'rgba(239,68,68,0.15)', color: '#f87171', fontWeight: 700 }}>
                🚨 URGENT
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 4 }}>
            📍 {zone.position} &nbsp;•&nbsp; 🌱 {zone.species || 'Unknown plant'} &nbsp;•&nbsp; {leafBadge(zone.leaf_condition)}
          </div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', marginTop: 5, lineHeight: 1.4 }}>
            {zone.summary}
          </div>
        </div>
        <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 18, flexShrink: 0 }}>
          {expanded ? '▲' : '▼'}
        </span>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, padding: '3px 10px', borderRadius: 20,
              background: 'rgba(139,92,246,0.15)', color: '#c4b5fd', border: '1px solid rgba(139,92,246,0.25)' }}>
              📈 {zone.growth_stage}
            </span>
            {zone.disease && zone.disease !== 'none' && (
              <span style={{ fontSize: 12, padding: '3px 10px', borderRadius: 20,
                background: 'rgba(239,68,68,0.12)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.25)' }}>
                🦠 {zone.disease}
              </span>
            )}
          </div>

          {zone.alerts?.length > 0 && (
            <div style={{ background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.2)',
              borderRadius: 10, padding: '10px 14px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#fb923c', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                🚨 Alerts
              </div>
              {zone.alerts.map((a, i) => (
                <div key={i} style={{ fontSize: 13, color: '#fdba74', marginBottom: 4 }}>• {a}</div>
              ))}
            </div>
          )}

          {zone.immediate_actions?.length > 0 && (
            <div style={{ background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.2)',
              borderRadius: 10, padding: '10px 14px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#a78bfa', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                ⚡ Do Right Now
              </div>
              {zone.immediate_actions.map((a, i) => (
                <div key={i} style={{ fontSize: 13, color: '#c4b5fd', marginBottom: 4 }}>• {a}</div>
              ))}
            </div>
          )}

          {zone.tips?.length > 0 && (
            <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)',
              borderRadius: 10, padding: '10px 14px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#34d399', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                💡 Tips
              </div>
              {zone.tips.map((t, i) => (
                <div key={i} style={{ fontSize: 13, color: '#6ee7b7', marginBottom: 4 }}>• {t}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Daily Report Panel ─────────────────────────────────────────────────────
function DailyReportPanel({ report }) {
  if (!report) return null;
  const trendIcon = report.trend === 'improving' ? '📈' : report.trend === 'declining' ? '📉' : '📊';
  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(139,92,246,0.12), rgba(16,185,129,0.08))',
      border: '1px solid rgba(139,92,246,0.25)', borderRadius: 18, padding: '20px 24px', marginBottom: 24
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <span style={{ fontSize: 22 }}>📋</span>
        <div>
          <div style={{ fontWeight: 800, fontSize: 16, color: '#a78bfa' }}>Today's Daily Report</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
            Generated at {report.generated_at ? new Date(report.generated_at).toLocaleTimeString() : '—'}
          </div>
        </div>
        <span style={{ marginLeft: 'auto', fontSize: 18 }}>{trendIcon}</span>
      </div>

      <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.8)', lineHeight: 1.6, marginBottom: 16 }}>
        {report.overall_summary}
      </p>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        {[
          { label: 'Healthy', count: report.healthy_count, color: '#4ade80' },
          { label: 'Need Attention', count: report.attention_count, color: '#fbbf24' },
          { label: 'Critical', count: report.critical_count, color: '#f87171' },
        ].map(s => (
          <div key={s.label} style={{
            flex: 1, minWidth: 80, textAlign: 'center', padding: '10px 8px',
            background: 'rgba(255,255,255,0.04)', borderRadius: 12,
            border: `1px solid ${s.color}30`
          }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.count ?? 0}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Alerts digest */}
      {report.alerts_digest?.length > 0 && (
        <div style={{ background: 'rgba(239,68,68,0.1)', borderRadius: 10, padding: '10px 14px', marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#f87171', marginBottom: 6, textTransform: 'uppercase' }}>
            🚨 Alert Digest
          </div>
          {report.alerts_digest.map((a, i) => (
            <div key={i} style={{ fontSize: 13, color: '#fca5a5', marginBottom: 3 }}>• {a}</div>
          ))}
        </div>
      )}

      {/* Watering schedule */}
      {report.watering_schedule?.length > 0 && (
        <div style={{ background: 'rgba(96,165,250,0.08)', borderRadius: 10, padding: '10px 14px', marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#60a5fa', marginBottom: 8, textTransform: 'uppercase' }}>
            💧 Today's Watering Schedule
          </div>
          {report.watering_schedule.map((w, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 14 }}>{w.water_today ? '💧' : '⏭️'}</span>
              <span style={{ fontWeight: 600, fontSize: 13, color: 'rgba(255,255,255,0.8)', minWidth: 90 }}>{w.label}</span>
              <span style={{ fontSize: 12, color: w.water_today ? '#93c5fd' : 'rgba(255,255,255,0.35)' }}>
                {w.water_today ? `Water ${w.when}` : 'Not today'} — {w.reason}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Encouragement */}
      {report.encouragement && (
        <div style={{ textAlign: 'center', fontSize: 13, color: '#34d399', fontStyle: 'italic', marginTop: 4 }}>
          🌱 {report.encouragement}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────
export default function PlantZonesPage({ deviceKey, onAddToast }) {
  const [zones, setZones]           = useState(null);
  const [dailyReport, setDailyReport] = useState(null);
  const [loading, setLoading]       = useState(true);
  const [generating, setGenerating] = useState(false);
  const [tab, setTab]               = useState('zones'); // 'zones' | 'report'
  const [lastUpdated, setLastUpdated] = useState(null);

  const fetchData = useCallback(async () => {
    if (!deviceKey) return;
    try {
      const [z, r] = await Promise.allSettled([
        api.getLatestZones(deviceKey),
        api.getDailyPlantReport(deviceKey),
      ]);
      if (z.status === 'fulfilled') { setZones(z.value); setLastUpdated(new Date()); }
      if (r.status === 'fulfilled') setDailyReport(r.value);
    } catch (err) {
      console.error('Zone fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [deviceKey]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-refresh zones every 60s
  useEffect(() => {
    const t = setInterval(fetchData, 60000);
    return () => clearInterval(t);
  }, [fetchData]);

  const handleGenerateReport = async () => {
    setGenerating(true);
    try {
      const report = await api.generatePlantReport(deviceKey);
      setDailyReport(report);
      onAddToast?.('Daily report generated!', 'success');
    } catch (err) {
      onAddToast?.('Failed to generate report: ' + err.message, 'error');
    } finally {
      setGenerating(false);
    }
  };

  // ── Render ────────────────────────────────────────────────
  if (!deviceKey) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: 'rgba(255,255,255,0.5)' }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🌿</div>
        <div style={{ fontSize: 16, fontWeight: 600 }}>No device selected</div>
        <div style={{ fontSize: 13, marginTop: 8 }}>Go to Fields & Devices and select a device to view plant zones.</div>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px 28px', maxWidth: 900, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: 'var(--text-primary, #fff)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span>🌱</span> Plant Zone Monitor
          </h1>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>
            Device: <code style={{ color: '#a78bfa' }}>{deviceKey}</code>
            {lastUpdated && ` • Updated ${lastUpdated.toLocaleTimeString()}`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={fetchData} style={{
            padding: '8px 16px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)',
            background: 'transparent', color: 'rgba(255,255,255,0.7)', cursor: 'pointer', fontSize: 13
          }}>🔄 Refresh</button>
          <button onClick={handleGenerateReport} disabled={generating} style={{
            padding: '8px 16px', borderRadius: 10, border: 'none',
            background: 'linear-gradient(135deg, #7c3aed, #4f46e5)',
            color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600,
            opacity: generating ? 0.7 : 1
          }}>
            {generating ? '⏳ Generating...' : '📋 Generate Report'}
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: 'rgba(255,255,255,0.05)', borderRadius: 12, padding: 4 }}>
        {[
          { key: 'zones',  label: `🌿 Live Zones ${zones ? `(${zones.total_zones})` : ''}` },
          { key: 'report', label: `📋 Daily Report ${dailyReport ? '✓' : ''}` },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            flex: 1, padding: '9px 12px', borderRadius: 9, border: 'none', cursor: 'pointer',
            background: tab === t.key ? 'rgba(139,92,246,0.3)' : 'transparent',
            color: tab === t.key ? '#c4b5fd' : 'rgba(255,255,255,0.5)',
            fontWeight: tab === t.key ? 700 : 400, fontSize: 13, transition: 'all 0.15s'
          }}>{t.label}</button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 48, color: 'rgba(255,255,255,0.4)' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🔍</div>
          <div>Loading zone data...</div>
        </div>
      ) : tab === 'zones' ? (
        <>
          {/* Overall health bar */}
          {zones && (
            <div style={{
              background: 'rgba(255,255,255,0.04)', borderRadius: 14, padding: '14px 20px', marginBottom: 20,
              display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap'
            }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>
                  Overall Garden Health — {zones.total_zones} zones detected
                </div>
                <div style={{ height: 8, background: 'rgba(255,255,255,0.08)', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', width: `${zones.overall_health}%`,
                    background: `linear-gradient(90deg, ${healthColor(zones.overall_health)}, ${healthColor(Math.min(100, zones.overall_health + 20))})`,
                    borderRadius: 4, transition: 'width 0.8s ease'
                  }}/>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: healthColor(zones.overall_health) }}>
                  {zones.overall_health}
                </div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>/ 100</div>
              </div>
              {zones.critical_zones?.length > 0 && (
                <div style={{
                  padding: '6px 14px', borderRadius: 10, background: 'rgba(239,68,68,0.15)',
                  color: '#f87171', fontSize: 13, fontWeight: 600
                }}>
                  🚨 {zones.critical_zones.length} zone{zones.critical_zones.length > 1 ? 's' : ''} need urgent attention
                </div>
              )}
            </div>
          )}

          {/* Zone cards */}
          {zones?.zones?.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {zones.zones.map(zone => (
                <ZoneCard
                  key={zone.zone_id}
                  zone={zone}
                  isCritical={zones.critical_zones?.includes(zone.zone_id)}
                />
              ))}
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', textAlign: 'center', marginTop: 8 }}>
                Zone data updates automatically every 30 seconds with each camera report
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: 48, color: 'rgba(255,255,255,0.4)' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📷</div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>No zone data yet</div>
              <div style={{ fontSize: 13, marginTop: 8 }}>
                Zone analysis runs automatically with each ESP32 camera report.<br/>
                Make sure your device is online and sending data.
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          {dailyReport ? (
            <DailyReportPanel report={dailyReport} />
          ) : (
            <div style={{ textAlign: 'center', padding: 48, color: 'rgba(255,255,255,0.4)' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>No daily report yet</div>
              <div style={{ fontSize: 13, marginTop: 8, marginBottom: 20 }}>
                Reports are auto-generated at 7 AM IST every day.<br/>
                Click the button below to generate one now.
              </div>
              <button onClick={handleGenerateReport} disabled={generating} style={{
                padding: '10px 24px', borderRadius: 12, border: 'none',
                background: 'linear-gradient(135deg, #7c3aed, #4f46e5)',
                color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 600
              }}>
                {generating ? '⏳ Generating...' : '📋 Generate Today\'s Report'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
