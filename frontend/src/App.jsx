import { useState, useEffect, useRef, useCallback } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine
} from "recharts";

// ── CONFIG — replace with your actual URLs ──────────────────
const BACKEND_URL  = "https://pl-kp57.onrender.com";

const CAM_STREAM_URL = "https://balkiest-sarina-nonceremonially.ngrok-free.dev/stream";
const CAM_SNAP_URL   = "https://balkiest-sarina-nonceremonially.ngrok-free.dev/snapshot";

// Supabase (for realtime)
const SUPABASE_URL  = "https://YOUR_PROJECT.supabase.co";
const SUPABASE_ANON = "YOUR_ANON_KEY";
// ── Helpers ─────────────────────────────────────────────────
function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ── Moisture gauge component ─────────────────────────────────
function MoistureGauge({ pct }) {
  const angle = -135 + (pct / 100) * 270;
  const color =
    pct < 25 ? "#ef4444" :
    pct < 50 ? "#f59e0b" :
    "#22c55e";

  return (
    <div className="flex flex-col items-center">
      <svg width="180" height="120" viewBox="0 0 180 120">
        {/* Track arc */}
        <path
          d="M 20 105 A 70 70 0 1 1 160 105"
          fill="none" stroke="#1e293b" strokeWidth="14"
          strokeLinecap="round"
        />
        {/* Color fill arc — computed via stroke-dasharray trick */}
        <path
          d="M 20 105 A 70 70 0 1 1 160 105"
          fill="none"
          stroke={color}
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={`${(pct / 100) * 220} 220`}
          style={{ transition: "stroke-dasharray 1s ease, stroke 0.5s" }}
        />
        {/* Needle */}
        <g transform={`rotate(${angle}, 90, 105)`}>
          <line x1="90" y1="105" x2="90" y2="44"
            stroke={color} strokeWidth="3" strokeLinecap="round"
            style={{ transition: "transform 1s ease" }}
          />
          <circle cx="90" cy="105" r="5" fill={color} />
        </g>
        {/* Labels */}
        <text x="14" y="120" fill="#64748b" fontSize="11">0%</text>
        <text x="152" y="120" fill="#64748b" fontSize="11">100%</text>
      </svg>
      <div style={{ color, fontSize: 40, fontFamily: "'Space Mono', monospace", fontWeight: 700, lineHeight: 1, marginTop: -8 }}>
        {pct}<span style={{ fontSize: 20 }}>%</span>
      </div>
      <div style={{ color: "#64748b", fontSize: 13, marginTop: 4, fontFamily: "monospace" }}>
        SOIL MOISTURE
      </div>
    </div>
  );
}

// ── Custom chart tooltip ─────────────────────────────────────
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{
      background: "#0f172a", border: "1px solid #334155",
      borderRadius: 8, padding: "10px 14px", fontSize: 12
    }}>
      <div style={{ color: "#94a3b8" }}>{formatDate(label)}</div>
      <div style={{ color: "#22c55e", fontWeight: 700, fontSize: 16 }}>
        {d.moisture_pct}%
      </div>
      {d.pump_on !== null && (
        <div style={{ color: d.pump_on ? "#3b82f6" : "#475569", marginTop: 4 }}>
          💧 Pump {d.pump_on ? "activated" : "off"}
        </div>
      )}
    </div>
  );
}

// ── Main App ─────────────────────────────────────────────────
export default function PlantMonitor() {
  const [readings,    setReadings]    = useState([]);
  const [pumpEvents,  setPumpEvents]  = useState([]);
  const [latest,      setLatest]      = useState(null);
  const [camMode,     setCamMode]     = useState("stream"); // "stream" | "snap"
  const [camError,    setCamError]    = useState(false);
  const [pumpLoading, setPumpLoading] = useState(false);
  const [toast,       setToast]       = useState(null);

  const imgRef = useRef(null);

  // ── Fetch data ─────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    try {
      const [rRes, pRes] = await Promise.all([
        fetch(`${BACKEND_URL}/api/readings?limit=24`),
        fetch(`${BACKEND_URL}/api/pump-events?limit=30`),
      ]);
      const rData = await rRes.json();
      const pData = await pRes.json();
      // readings come newest-first; chart wants oldest-first
      setReadings([...rData].reverse());
      setPumpEvents(pData);
      if (rData.length > 0) setLatest(rData[0]);
    } catch (e) {
      console.error("Fetch error:", e);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000); // refresh every minute
    return () => clearInterval(interval);
  }, [fetchData]);

  // ── Manual pump override ────────────────────────────────────
  const triggerPump = async (on) => {
    setPumpLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/pump-override`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pump_on: on }),
      });
      if (!res.ok) throw new Error("Server error");
      showToast(on ? "💧 Pump activated manually!" : "🛑 Pump stopped");
      fetchData();
    } catch (e) {
      showToast("❌ Failed to control pump");
    }
    setPumpLoading(false);
  };

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const currentMoisture = latest?.moisture_pct ?? 0;
  const moistureColor =
    currentMoisture < 25 ? "#ef4444" :
    currentMoisture < 50 ? "#f59e0b" :
    "#22c55e";

  const moistureStatus =
    currentMoisture < 25 ? "CRITICALLY DRY" :
    currentMoisture < 50 ? "SLIGHTLY DRY" :
    currentMoisture < 75 ? "OPTIMAL" : "WELL WATERED";

  const styles = {
    app: {
      minHeight: "100vh",
      background: "#020c18",
      color: "#e2e8f0",
      fontFamily: "'Space Mono', 'Courier New', monospace",
      padding: "0 0 40px",
    },
    header: {
      background: "linear-gradient(180deg, #041527 0%, #020c18 100%)",
      borderBottom: "1px solid #0f2a3d",
      padding: "20px 32px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
    },
    headerTitle: {
      fontSize: 20,
      fontWeight: 700,
      color: "#22c55e",
      letterSpacing: 2,
      display: "flex",
      alignItems: "center",
      gap: 10,
    },
    headerSub: { color: "#475569", fontSize: 11, marginTop: 2, letterSpacing: 1 },
    statusPill: {
      background: "#0a1f0a",
      border: `1px solid ${moistureColor}40`,
      borderRadius: 20,
      padding: "6px 16px",
      fontSize: 11,
      color: moistureColor,
      letterSpacing: 2,
      fontWeight: 700,
    },
    grid: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gridTemplateRows: "auto auto",
      gap: 20,
      maxWidth: 1200,
      margin: "24px auto",
      padding: "0 24px",
    },
    card: {
      background: "#071422",
      border: "1px solid #0f2a3d",
      borderRadius: 16,
      padding: 24,
      position: "relative",
      overflow: "hidden",
    },
    cardTitle: {
      fontSize: 10,
      color: "#475569",
      letterSpacing: 3,
      fontWeight: 700,
      marginBottom: 16,
      display: "flex",
      alignItems: "center",
      gap: 8,
    },
    // Camera card spans full width
    cameraCard: {
      gridColumn: "1 / -1",
      background: "#071422",
      border: "1px solid #0f2a3d",
      borderRadius: 16,
      padding: 20,
      overflow: "hidden",
    },
    camFrame: {
      width: "100%",
      maxHeight: 360,
      objectFit: "cover",
      borderRadius: 10,
      background: "#000",
      display: "block",
    },
    camToggle: {
      display: "flex",
      gap: 8,
      marginBottom: 12,
    },
    tabBtn: (active) => ({
      background: active ? "#22c55e20" : "transparent",
      border: `1px solid ${active ? "#22c55e" : "#1e3a4a"}`,
      color: active ? "#22c55e" : "#475569",
      borderRadius: 6,
      padding: "5px 14px",
      fontSize: 11,
      cursor: "pointer",
      letterSpacing: 1,
      fontFamily: "inherit",
    }),
    pumpBtn: (on) => ({
      background: on
        ? "linear-gradient(135deg, #1d4ed8 0%, #2563eb 100%)"
        : "linear-gradient(135deg, #ef444420 0%, #ef444430 100%)",
      border: `1px solid ${on ? "#3b82f6" : "#ef4444"}`,
      color: on ? "#93c5fd" : "#fca5a5",
      borderRadius: 10,
      padding: "12px 24px",
      fontSize: 12,
      cursor: "pointer",
      letterSpacing: 1,
      fontFamily: "inherit",
      fontWeight: 700,
      flex: 1,
      transition: "all 0.2s",
      opacity: pumpLoading ? 0.5 : 1,
    }),
    eventRow: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "10px 0",
      borderBottom: "1px solid #0f2a3d",
      fontSize: 12,
    },
    eventIcon: (on, manual) => ({
      width: 32, height: 32, borderRadius: 8,
      background: on
        ? (manual ? "#7c3aed20" : "#1d4ed820")
        : "#ef444420",
      border: `1px solid ${on ? (manual ? "#7c3aed" : "#3b82f6") : "#ef4444"}40`,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 14, flexShrink: 0,
    }),
    toast: {
      position: "fixed",
      bottom: 32,
      left: "50%",
      transform: "translateX(-50%)",
      background: "#0f172a",
      border: "1px solid #334155",
      borderRadius: 12,
      padding: "12px 24px",
      fontSize: 13,
      color: "#e2e8f0",
      zIndex: 999,
      boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
      whiteSpace: "nowrap",
    },
  };

  return (
    <div style={styles.app}>
      {/* Google Font */}
      <link
        href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap"
        rel="stylesheet"
      />

      {/* Header */}
      <div style={styles.header}>
        <div>
          <div style={styles.headerTitle}>
            <span>🌿</span> PLANT MONITOR
          </div>
          <div style={styles.headerSub}>IoT • ESP32-S3 • ESP32-CAM • GPT-4o • Supabase</div>
        </div>
        <div style={styles.statusPill}>{moistureStatus}</div>
      </div>

      <div style={styles.grid}>

        {/* ── LIVE CAMERA ────────────────────────────────────── */}
        <div style={styles.cameraCard}>
          <div style={styles.cardTitle}>
            <span>📷</span> LIVE CAMERA FEED
            <span style={{ marginLeft: "auto", color: "#ef4444", fontSize: 9 }}>● LIVE</span>
          </div>
          <div style={styles.camToggle}>
            <button style={styles.tabBtn(camMode === "stream")}
              onClick={() => { setCamMode("stream"); setCamError(false); }}>
              ▶ STREAM
            </button>
            <button style={styles.tabBtn(camMode === "snap")}
              onClick={() => { setCamMode("snap"); setCamError(false); }}>
              📷 SNAPSHOT
            </button>
          </div>

          {camError ? (
            <div style={{
              ...styles.camFrame, height: 280,
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#475569", flexDirection: "column", gap: 8,
            }}>
              <span style={{ fontSize: 40 }}>📷</span>
              <span style={{ fontSize: 12 }}>Camera offline or CORS issue</span>
              <span style={{ fontSize: 11, color: "#334155" }}>
                Check that ESP32-CAM is on your network
              </span>
              <button
                style={{ ...styles.tabBtn(false), marginTop: 8 }}
                onClick={() => setCamError(false)}
              >
                RETRY
              </button>
            </div>
          ) : camMode === "stream" ? (
            <img
              ref={imgRef}
              src={CAM_STREAM_URL}
              alt="Live plant feed"
              style={styles.camFrame}
              onError={() => setCamError(true)}
            />
          ) : (
            <img
              src={`${CAM_SNAP_URL}?t=${Date.now()}`}
              alt="Plant snapshot"
              style={styles.camFrame}
              onError={() => setCamError(true)}
            />
          )}

          {latest?.snapshot_url && (
            <div style={{ marginTop: 10, fontSize: 11, color: "#334155" }}>
              Last AI snapshot:{" "}
              <a href={latest.snapshot_url} target="_blank" rel="noreferrer"
                style={{ color: "#3b82f6" }}>
                view ↗
              </a>
            </div>
          )}
        </div>

        {/* ── MOISTURE GAUGE ─────────────────────────────────── */}
        <div style={styles.card}>
          <div style={styles.cardTitle}>
            <span>💧</span> CURRENT MOISTURE
          </div>
          <MoistureGauge pct={currentMoisture} />

          {/* Last reading meta */}
          {latest && (
            <div style={{
              marginTop: 16,
              background: "#0a1f2e",
              borderRadius: 10,
              padding: "12px 16px",
              fontSize: 11,
              color: "#64748b",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span>Last reading</span>
                <span style={{ color: "#94a3b8" }}>{formatDate(latest.created_at)}</span>
              </div>
              {latest.reason && (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>AI verdict</span>
                  <span style={{
                    color: latest.pump_on ? "#3b82f6" : "#22c55e",
                    maxWidth: "65%", textAlign: "right",
                  }}>
                    {latest.reason}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Manual override */}
          <div style={{ marginTop: 20 }}>
            <div style={{ ...styles.cardTitle, marginBottom: 10 }}>
              <span>🔧</span> MANUAL PUMP CONTROL
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                style={styles.pumpBtn(true)}
                onClick={() => triggerPump(true)}
                disabled={pumpLoading}
              >
                💧 WATER NOW
              </button>
              <button
                style={styles.pumpBtn(false)}
                onClick={() => triggerPump(false)}
                disabled={pumpLoading}
              >
                🛑 STOP PUMP
              </button>
            </div>
            <div style={{ fontSize: 10, color: "#334155", marginTop: 8 }}>
              Manual commands are logged and override the next auto-cycle
            </div>
          </div>
        </div>

        {/* ── MOISTURE CHART ──────────────────────────────────── */}
        <div style={styles.card}>
          <div style={styles.cardTitle}>
            <span>📈</span> MOISTURE HISTORY (LAST 24 READINGS)
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={readings} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
              <CartesianGrid stroke="#0f2a3d" strokeDasharray="3 3" />
              <XAxis
                dataKey="created_at"
                tickFormatter={formatTime}
                stroke="#1e3a4a"
                tick={{ fill: "#475569", fontSize: 10 }}
              />
              <YAxis
                domain={[0, 100]}
                stroke="#1e3a4a"
                tick={{ fill: "#475569", fontSize: 10 }}
              />
              <Tooltip content={<ChartTooltip />} />
              {/* Danger zones */}
              <ReferenceLine y={25} stroke="#ef444440" strokeDasharray="4 4" label={{ value: "DRY", fill: "#ef4444", fontSize: 9 }} />
              <ReferenceLine y={50} stroke="#f59e0b40" strokeDasharray="4 4" label={{ value: "OK", fill: "#f59e0b", fontSize: 9 }} />
              <Line
                type="monotone"
                dataKey="moisture_pct"
                stroke="#22c55e"
                strokeWidth={2}
                dot={(props) => {
                  const { cx, cy, payload } = props;
                  if (!payload.pump_on) return null;
                  return <circle key={cx} cx={cx} cy={cy} r={5} fill="#3b82f6" stroke="#fff" strokeWidth={1.5} />;
                }}
                activeDot={{ r: 6, fill: "#22c55e" }}
              />
            </LineChart>
          </ResponsiveContainer>
          <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 10, color: "#475569" }}>
            <span><span style={{ color: "#22c55e" }}>─</span> Moisture %</span>
            <span><span style={{ color: "#3b82f6" }}>●</span> Pump activated</span>
            <span><span style={{ color: "#ef4444" }}>- -</span> Dry threshold (25%)</span>
          </div>
        </div>

        {/* ── PUMP LOG ───────────────────────────────────────── */}
        <div style={{ ...styles.card, gridColumn: "1 / -1" }}>
          <div style={styles.cardTitle}>
            <span>📋</span> PUMP EVENT LOG
          </div>
          {pumpEvents.length === 0 ? (
            <div style={{ color: "#334155", fontSize: 12, textAlign: "center", padding: "32px 0" }}>
              No pump events yet
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: "0 32px" }}>
              {pumpEvents.map((ev) => (
                <div key={ev.id} style={styles.eventRow}>
                  <div style={styles.eventIcon(ev.pump_on, ev.trigger_source === "manual")}>
                    {ev.pump_on ? "💧" : "🔌"}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{
                      color: ev.pump_on ? "#93c5fd" : "#94a3b8",
                      fontWeight: 700, fontSize: 12,
                    }}>
                      Pump {ev.pump_on ? "ON" : "OFF"}
                      {" "}
                      <span style={{
                        background: ev.trigger_source === "manual" ? "#7c3aed20" : "#1d4ed820",
                        border: `1px solid ${ev.trigger_source === "manual" ? "#7c3aed" : "#3b82f6"}40`,
                        color: ev.trigger_source === "manual" ? "#a78bfa" : "#60a5fa",
                        borderRadius: 4, padding: "1px 6px", fontSize: 9,
                      }}>
                        {ev.trigger_source.toUpperCase()}
                      </span>
                    </div>
                    <div style={{ color: "#475569", fontSize: 10, marginTop: 2 }}>
                      {formatDate(ev.created_at)}
                      {ev.duration_sec && ` · ${ev.duration_sec}s`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>

      {/* Toast */}
      {toast && <div style={styles.toast}>{toast}</div>}
    </div>
  );
}
