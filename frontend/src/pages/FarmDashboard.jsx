import { useState, useEffect, useCallback } from 'react';
import { getFarmStatus, sendSlavePumpCommand, getDevices, setDeviceMode } from '../api';

// ─── health helpers ───────────────────────────────────────────
const moistureColor = (pct) => {
  if (pct === null || pct === undefined) return '#6b7280';
  if (pct < 20) return '#ef4444';
  if (pct < 40) return '#f59e0b';
  if (pct < 65) return '#22c55e';
  return '#3b82f6';
};

const moistureLabel = (pct) => {
  if (pct === null || pct === undefined) return 'Unknown';
  if (pct < 20) return 'Critical';
  if (pct < 40) return 'Dry';
  if (pct < 65) return 'Healthy';
  return 'Wet';
};

const healthBadge = (overall) => {
  const map = {
    good:     { bg: 'rgba(34,197,94,0.15)',  border: 'rgba(34,197,94,0.4)',  color: '#4ade80', label: '✅ Healthy Farm' },
    fair:     { bg: 'rgba(251,191,36,0.15)', border: 'rgba(251,191,36,0.4)', color: '#fbbf24', label: '⚠️ Needs Attention' },
    critical: { bg: 'rgba(239,68,68,0.15)',  border: 'rgba(239,68,68,0.4)',  color: '#f87171', label: '🚨 Critical' },
  };
  return map[overall] || map.fair;
};

// ─── ZoneCard component ───────────────────────────────────────
function ZoneCard({ zone, deviceKey, onPumpCommand, isMaster }) {
  const [pumpLoading, setPumpLoading] = useState(false);
  const [pumpMsg, setPumpMsg] = useState('');
  const [expanded, setExpanded] = useState(false);

  const color  = moistureColor(zone.moisture_pct);
  const label  = moistureLabel(zone.moisture_pct);
  const pct    = zone.moisture_pct ?? 0;
  const online = zone.online !== false;

  const runPump = async (durationMs) => {
    setPumpLoading(true);
    setPumpMsg('');
    try {
      await sendSlavePumpCommand(deviceKey, zone.slave_id || 'MASTER', true, durationMs);
      setPumpMsg(`✅ Pump queued for ${durationMs / 1000}s`);
      onPumpCommand?.();
    } catch (err) {
      setPumpMsg('❌ Failed to queue pump command');
    } finally {
      setPumpLoading(false);
      setTimeout(() => setPumpMsg(''), 4000);
    }
  };

  return (
    <div style={{
      background: isMaster
        ? 'linear-gradient(135deg, rgba(44,95,45,0.15), rgba(44,95,45,0.05))'
        : 'rgba(255,255,255,0.04)',
      border: `1px solid ${isMaster ? 'rgba(151,188,98,0.35)' : 'rgba(255,255,255,0.09)'}`,
      borderRadius: 20,
      padding: '24px',
      transition: 'border-color 0.3s, transform 0.2s',
      cursor: 'pointer',
      position: 'relative',
    }}
      onClick={() => setExpanded(e => !e)}
      onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-3px)'}
      onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}
    >
      {/* Online / Offline badge */}
      <div style={{
        position: 'absolute', top: 16, right: 16,
        display: 'flex', alignItems: 'center', gap: 6,
        fontSize: 11, color: online ? '#4ade80' : '#9ca3af',
      }}>
        <div style={{
          width: 7, height: 7, borderRadius: '50%',
          background: online ? '#4ade80' : '#6b7280',
          boxShadow: online ? '0 0 6px #4ade80' : 'none',
        }} />
        {online ? 'Online' : 'Offline'}
        {isMaster && <span style={{ marginLeft: 4, color: '#97bc62', fontWeight: 700 }}>★ Master</span>}
      </div>

      {/* Zone header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
        <div style={{
          width: 48, height: 48, borderRadius: 12,
          background: `${color}22`, border: `2px solid ${color}44`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 22,
        }}>
          {isMaster ? '🏠' : '🌱'}
        </div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>
            {zone.zone_name || zone.slave_id}
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>
            {zone.slave_id}
            {zone.last_seen && <span style={{ marginLeft: 8 }}>
              · {zone.last_seen_s > 0 ? `${zone.last_seen_s}s ago` : 'just now'}
            </span>}
          </div>
          {zone.land_area_acres && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              marginTop: 5, padding: '2px 8px',
              background: 'rgba(82,183,136,0.15)', borderRadius: 10,
              border: '1px solid rgba(82,183,136,0.3)',
            }}>
              <span style={{ fontSize: 11, color: '#52b788', fontWeight: 600 }}>
                {zone.land_area_acres} acres
              </span>
              {zone.land_area_bigha && (
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>
                  ({zone.land_area_bigha} bigha)
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Moisture bar */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>Soil Moisture</span>
          <span style={{ fontSize: 13, fontWeight: 700, color }}>
            {pct}% — {label}
          </span>
        </div>
        <div style={{ height: 8, background: 'rgba(255,255,255,0.08)', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{
            height: '100%', width: `${pct}%`,
            background: `linear-gradient(90deg, ${color}aa, ${color})`,
            borderRadius: 4, transition: 'width 0.8s ease',
          }} />
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{
          flex: 1, background: 'rgba(255,255,255,0.05)', borderRadius: 10,
          padding: '10px 14px', textAlign: 'center',
        }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#60a5fa' }}>
            {zone.temperature_c != null ? `${zone.temperature_c.toFixed(1)}°` : '—'}
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>Temp °C</div>
        </div>
        {zone.health_score != null && (
          <div style={{
            flex: 1, background: 'rgba(255,255,255,0.05)', borderRadius: 10,
            padding: '10px 14px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: moistureColor(zone.health_score) }}>
              {zone.health_score}
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>Health</div>
          </div>
        )}
        <div style={{
          flex: 1, background: 'rgba(255,255,255,0.05)', borderRadius: 10,
          padding: '10px 14px', textAlign: 'center',
        }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: pct < 25 ? '#f87171' : '#4ade80' }}>
            {pct < 25 ? '💧' : '✅'}
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>
            {pct < 25 ? 'Needs Water' : 'OK'}
          </div>
        </div>
      </div>

      {/* NPK panel — shown only for NPK slaves */}
      {zone.slave_type === 1 && (zone.npk_n > 0 || zone.npk_p > 0 || zone.npk_k > 0) && (
        <div style={{
          marginTop: 16,
          background: 'rgba(16,185,129,0.06)',
          border: '1px solid rgba(16,185,129,0.2)',
          borderRadius: 12,
          padding: '12px 14px',
        }}>
          <div style={{ fontSize: 11, color: '#34d399', fontWeight: 700, marginBottom: 10, letterSpacing: '0.5px' }}>
            🧪 SOIL NUTRIENTS (mg/kg)
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            {[
              { label: 'N', sub: 'Nitrogen',    value: zone.npk_n, color: '#4ade80' },
              { label: 'P', sub: 'Phosphorus',  value: zone.npk_p, color: '#60a5fa' },
              { label: 'K', sub: 'Potassium',   value: zone.npk_k, color: '#fbbf24' },
            ].map(n => (
              <div key={n.label} style={{
                flex: 1, textAlign: 'center',
                background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: '8px 4px',
                border: `1px solid ${n.color}22`,
              }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: n.color }}>{n.value ?? '—'}</div>
                <div style={{ fontSize: 11, color: n.color, fontWeight: 700 }}>{n.label}</div>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', marginTop: 1 }}>{n.sub}</div>
              </div>
            ))}
            {zone.soil_ph > 0 && (
              <div style={{
                flex: 1, textAlign: 'center',
                background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: '8px 4px',
                border: '1px solid rgba(167,139,250,0.2)',
              }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#c4b5fd' }}>{zone.soil_ph?.toFixed(1)}</div>
                <div style={{ fontSize: 11, color: '#c4b5fd', fontWeight: 700 }}>pH</div>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', marginTop: 1 }}>Acidity</div>
              </div>
            )}
            {zone.soil_ec > 0 && (
              <div style={{
                flex: 1, textAlign: 'center',
                background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: '8px 4px',
                border: '1px solid rgba(251,191,36,0.2)',
              }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#fde68a' }}>{Math.round(zone.soil_ec)}</div>
                <div style={{ fontSize: 11, color: '#fde68a', fontWeight: 700 }}>EC</div>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', marginTop: 1 }}>μS/cm</div>
              </div>
            )}
          </div>
          {/* NPK interpretation */}
          <div style={{ marginTop: 8, fontSize: 11, color: 'rgba(255,255,255,0.4)', lineHeight: 1.5 }}>
            {zone.npk_n < 50  ? '⚠️ Low Nitrogen — consider urea' :
             zone.npk_n > 200 ? '✅ Nitrogen sufficient' : '🟡 Nitrogen moderate'}
            {' · '}
            {zone.npk_p < 25  ? '⚠️ Low Phosphorus — add DAP' :
             zone.npk_p > 100 ? '✅ Phosphorus good' : '🟡 Phosphorus ok'}
            {' · '}
            {zone.npk_k < 100 ? '⚠️ Low Potassium — add MOP' :
             zone.npk_k > 300 ? '✅ Potassium high' : '✅ Potassium good'}
          </div>
        </div>
      )}

      {/* Expanded pump controls */}
      {expanded && (
        <div onClick={e => e.stopPropagation()}
          style={{ marginTop: 16, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 16 }}>
          {zone.ai_summary && (
            <div style={{
              fontSize: 12, color: 'rgba(255,255,255,0.55)', lineHeight: 1.6,
              marginBottom: 14, fontStyle: 'italic',
            }}>
              🤖 {zone.ai_summary}
            </div>
          )}
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 10 }}>
            Manual Pump Control
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[5, 10, 20, 30].map(sec => (
              <button key={sec}
                disabled={pumpLoading}
                onClick={() => runPump(sec * 1000)}
                style={{
                  background: 'rgba(44,95,45,0.3)', border: '1px solid rgba(151,188,98,0.4)',
                  color: '#97bc62', borderRadius: 20, padding: '6px 16px',
                  fontSize: 12, cursor: 'pointer', fontWeight: 600,
                  opacity: pumpLoading ? 0.5 : 1,
                }}>
                {sec}s
              </button>
            ))}
          </div>
          {pumpMsg && (
            <div style={{ fontSize: 12, marginTop: 10, color: pumpMsg.startsWith('✅') ? '#4ade80' : '#f87171' }}>
              {pumpMsg}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main FarmDashboard ───────────────────────────────────────
export default function FarmDashboard() {
  const [farmData,       setFarmData]       = useState(null);
  const [loading,        setLoading]        = useState(true);
  const [error,          setError]          = useState('');
  const [lastRefresh,    setLastRefresh]    = useState(null);
  const [devices,        setDevices]        = useState([]);
  const [selectedKey,    setSelectedKey]    = useState(null);
  const [deviceMode,     setFarmMode]       = useState('auto'); // 'auto' | 'semi'
  const [modeLoading,    setModeLoading]    = useState(false);

  // Load user's own devices on mount, then auto-select the first one
  useEffect(() => {
    getDevices()
      .then(list => {
        setDevices(list || []);
        if (list && list.length > 0) {
          setSelectedKey(list[0].device_key);
          setFarmMode(list[0].mode || 'auto');
        } else setLoading(false);
      })
      .catch(() => { setLoading(false); setError('Could not load your devices.'); });
  }, []);

  async function handleModeToggle() {
    const selDevice = devices.find(d => d.device_key === selectedKey);
    if (!selDevice) return;
    const newMode = deviceMode === 'auto' ? 'semi' : 'auto';
    setModeLoading(true);
    try {
      await setDeviceMode(selDevice.id, newMode);
      setFarmMode(newMode);
      setDevices(prev => prev.map(d => d.id === selDevice.id ? { ...d, mode: newMode } : d));
    } catch (_) {}
    finally { setModeLoading(false); }
  }

  const load = useCallback(async () => {
    if (!selectedKey) return;
    try {
      const data = await getFarmStatus(selectedKey);
      setFarmData(data);
      setLastRefresh(new Date());
      setError('');
    } catch (err) {
      setError('Could not load farm data. Make sure device is reporting.');
    } finally {
      setLoading(false);
    }
  }, [selectedKey]);

  useEffect(() => {
    if (!selectedKey) return;
    setLoading(true);
    load();
    const interval = setInterval(load, 15000); // refresh every 15s
    return () => clearInterval(interval);
  }, [load, selectedKey]);

  const badge = farmData?.overall_health ? healthBadge(farmData.overall_health) : null;

  return (
    <div style={{
      minHeight: '100vh', padding: '32px 24px',
      background: 'linear-gradient(160deg, #050c05 0%, #080f08 100%)',
      color: '#fff', fontFamily: "'Segoe UI', Arial, sans-serif",
    }}>
      {/* Header */}
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32, flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h1 style={{ fontSize: 32, fontWeight: 900, margin: 0 }}>
              🌾 Farm Dashboard
            </h1>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.45)', marginTop: 6 }}>
              Master + Slave zone monitoring — real-time via ESP-NOW
            </p>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Device selector — shows user's own registered devices */}
            {devices.length > 1 && (
              <select
                value={selectedKey || ''}
                onChange={e => setSelectedKey(e.target.value)}
                style={{
                  background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(151,188,98,0.3)',
                  color: '#e2e8f0', borderRadius: 20, padding: '8px 16px',
                  fontSize: 13, cursor: 'pointer', outline: 'none',
                }}
              >
                {devices.map(d => (
                  <option key={d.id} value={d.device_key}>{d.name}</option>
                ))}
              </select>
            )}
            {badge && (
              <div style={{
                background: badge.bg, border: `1px solid ${badge.border}`,
                borderRadius: 20, padding: '6px 16px',
                fontSize: 13, color: badge.color, fontWeight: 700,
              }}>
                {badge.label}
              </div>
            )}
            {/* Mode toggle */}
            <button
              onClick={handleModeToggle}
              disabled={modeLoading}
              className={`mode-toggle-btn ${deviceMode === 'auto' ? 'mode-auto' : 'mode-semi'}`}
              title={deviceMode === 'auto' ? 'Auto: AI controls valves — click for Semi-Auto' : 'Semi-Auto: manual control only — click for Auto'}
            >
              {modeLoading ? '⏳' : deviceMode === 'auto' ? '🤖 Auto Mode' : '🔧 Semi-Auto'}
            </button>
            <button onClick={load} style={{
              background: 'rgba(44,95,45,0.3)', border: '1px solid rgba(151,188,98,0.3)',
              color: '#97bc62', borderRadius: 20, padding: '8px 20px',
              fontSize: 13, cursor: 'pointer', fontWeight: 600,
            }}>
              ↻ Refresh
            </button>
          </div>
        </div>

        {/* Mode banner */}
        <div className={`mode-banner ${deviceMode === 'auto' ? 'mode-banner-auto' : 'mode-banner-semi'}`} style={{ marginBottom: 20 }}>
          {deviceMode === 'auto'
            ? '🤖 Auto Mode — AI moisture dekh ke slave valves khud control karta hai'
            : '🔧 Semi-Auto Mode — Slave valves sirf aapke manual command par chalenge'
          }
        </div>

        {/* Stats summary bar */}
        {farmData && (
          <div style={{
            display: 'flex', gap: 16, marginBottom: 32, flexWrap: 'wrap',
          }}>
            {[
              { label: 'Total Zones',    value: farmData.total_zones,  color: '#97bc62' },
              { label: 'Slave Nodes',    value: farmData.slave_count,  color: '#60a5fa' },
              { label: 'Critical Zones', value: farmData.critical_zones?.length || 0, color: farmData.critical_zones?.length ? '#f87171' : '#4ade80' },
              { label: 'Last Update',    value: farmData.last_updated ? new Date(farmData.last_updated).toLocaleTimeString() : '—', color: 'rgba(255,255,255,0.6)' },
            ].map(s => (
              <div key={s.label} style={{
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)',
                borderRadius: 14, padding: '16px 24px', flex: '1 1 160px',
              }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Critical alert banner */}
        {farmData?.critical_zones?.length > 0 && (
          <div style={{
            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: 14, padding: '14px 20px', marginBottom: 24,
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <span style={{ fontSize: 20 }}>🚨</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#f87171' }}>
                Critical Moisture Alert
              </div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', marginTop: 2 }}>
                Zones below 25% moisture: <strong style={{ color: '#fca5a5' }}>
                  {farmData.critical_zones.join(', ')}
                </strong> — tap zone card to trigger pump
              </div>
            </div>
          </div>
        )}

        {/* Loading / Error states */}
        {loading && (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'rgba(255,255,255,0.4)' }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>🌾</div>
            <div>Loading farm data...</div>
          </div>
        )}

        {!loading && error && (
          <div style={{
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)',
            borderRadius: 16, padding: '40px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>📡</div>
            <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.6)', marginBottom: 8 }}>{error}</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)' }}>
              Waiting for master device to come online and report slave data.
            </div>
          </div>
        )}

        {/* Zone grid */}
        {!loading && farmData?.zones?.length > 0 && (
          <>
            {/* Master zone */}
            {farmData.zones.filter(z => z.is_master).map(zone => (
              <div key="master" style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 10 }}>
                  Master Node
                </div>
                <ZoneCard
                  zone={zone}
                  deviceKey={selectedKey}
                  onPumpCommand={load}
                  isMaster={true}
                />
              </div>
            ))}

            {/* Slave zones grid */}
            {farmData.zones.filter(z => !z.is_master).length > 0 && (
              <div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12 }}>
                  Slave Zones ({farmData.slave_count})
                </div>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                  gap: 16,
                }}>
                  {farmData.zones.filter(z => !z.is_master).map(zone => (
                    <ZoneCard
                      key={zone.slave_id}
                      zone={zone}
                      deviceKey={selectedKey}
                      onPumpCommand={load}
                      isMaster={false}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Empty state — no slaves yet */}
        {!loading && !error && farmData?.slave_count === 0 && (
          <div style={{
            background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: 16, padding: '40px', textAlign: 'center', marginTop: 20,
          }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>📡</div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>No Slave Nodes Connected Yet</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', maxWidth: 480, margin: '0 auto', lineHeight: 1.7 }}>
              Flash <code style={{ color: '#97bc62' }}>slave_monitor.ino</code> onto ESP32 nodes,
              set <code style={{ color: '#97bc62' }}>MASTER_MAC</code> to the address shown in master Serial Monitor,
              and place them in each zone. They'll appear here automatically.
            </div>
          </div>
        )}

        {/* Footer */}
        {lastRefresh && (
          <div style={{ textAlign: 'center', marginTop: 32, fontSize: 12, color: 'rgba(255,255,255,0.25)' }}>
            Auto-refreshes every 15s · Last: {lastRefresh.toLocaleTimeString()}
          </div>
        )}
      </div>
    </div>
  );
}
