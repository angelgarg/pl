import React, { useState, useRef, useCallback } from 'react';
import * as api from '../api';

const EXHIBIT_DEVICE_KEY = 'piq-A85578-742051';

export default function CameraPage({ onAddToast, onNavigate }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [stream, setStream] = useState(null);

  const fileInputRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  const handleFileSelect = (e) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;
    setFile(selectedFile);
    const reader = new FileReader();
    reader.onload = (ev) => setPreview(ev.target?.result);
    reader.readAsDataURL(selectedFile);
    setAnalysis(null);
  };

  const openCamera = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      setStream(s);
      setCameraOpen(true);
      setTimeout(() => { if (videoRef.current) videoRef.current.srcObject = s; }, 100);
    } catch {
      onAddToast({ type: 'error', message: 'Camera permission denied — use file upload instead' });
    }
  };

  const capturePhoto = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      const f = new File([blob], 'capture.jpg', { type: 'image/jpeg' });
      setFile(f);
      setPreview(canvas.toDataURL('image/jpeg'));
      setAnalysis(null);
    }, 'image/jpeg', 0.9);
    closeCamera();
  }, []);

  const closeCamera = () => {
    stream?.getTracks().forEach(t => t.stop());
    setStream(null);
    setCameraOpen(false);
  };

  const handleUpload = async () => {
    if (!file) { onAddToast({ type: 'error', message: 'Pehle photo lo ya select karo' }); return; }
    setUploading(true);
    try {
      const result = await api.uploadDevicePhoto(EXHIBIT_DEVICE_KEY, file);
      setAnalysis(result.analysis || result);
      onAddToast({ type: 'success', message: 'Photo upload ho gayi! Live Monitor pe dikh rahi hai...' });
      setTimeout(() => onNavigate?.('live'), 2500);
    } catch (err) {
      onAddToast({ type: 'error', message: err.message });
    } finally {
      setUploading(false);
    }
  };

  const alertColor = (lvl) => {
    if (lvl === 'critical' || lvl === 'high') return '#ef4444';
    if (lvl === 'medium') return '#f59e0b';
    return '#22c55e';
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">📷 Plant Camera</h1>
        <p className="page-subtitle">Apne phone ya PC se photo lo — AI plant ki sehat batayega</p>
      </div>

      <div style={{ maxWidth: 600, margin: '0 auto', padding: '0 1rem' }}>

        {/* Camera / Upload buttons */}
        {!cameraOpen && (
          <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
            <button onClick={openCamera} style={btnStyle('#16a34a')}>
              📸 Camera Kholo
            </button>
            <button onClick={() => fileInputRef.current?.click()} style={btnStyle('#2563eb')}>
              🖼️ Gallery se Choose karo
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" capture="environment"
              onChange={handleFileSelect} style={{ display: 'none' }} />
          </div>
        )}

        {/* Live camera view */}
        {cameraOpen && (
          <div style={{ marginBottom: 16, borderRadius: 12, overflow: 'hidden', background: '#000' }}>
            <video ref={videoRef} autoPlay playsInline
              style={{ width: '100%', maxHeight: 360, display: 'block' }} />
            <canvas ref={canvasRef} style={{ display: 'none' }} />
            <div style={{ display: 'flex', gap: 8, padding: 8 }}>
              <button onClick={capturePhoto} style={btnStyle('#16a34a', true)}>📸 Photo Lo</button>
              <button onClick={closeCamera} style={btnStyle('#6b7280', true)}>✕ Band Karo</button>
            </div>
          </div>
        )}

        {/* Preview */}
        {preview && !cameraOpen && (
          <div style={{ marginBottom: 16, borderRadius: 12, overflow: 'hidden', border: '2px solid #334155' }}>
            <img src={preview} alt="Preview" style={{ width: '100%', maxHeight: 360, objectFit: 'contain', background: '#0f172a' }} />
          </div>
        )}

        {/* Upload button */}
        {file && !cameraOpen && (
          <button onClick={handleUpload} disabled={uploading} style={btnStyle(uploading ? '#475569' : '#7c3aed', true)}>
            {uploading ? '⏳ AI Analysis ho rahi hai...' : '🤖 AI se Analyze Karwao'}
          </button>
        )}

        {/* Analysis result */}
        {analysis && (
          <div style={{ marginTop: 20, background: '#1e293b', borderRadius: 12, padding: 20 }}>
            <h3 style={{ color: '#f1f5f9', marginTop: 0 }}>AI Analysis</h3>

            <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
              <ScoreBadge score={analysis.health_score} />
              {analysis.alert_level && (
                <div style={{ padding: '6px 14px', borderRadius: 20, background: alertColor(analysis.alert_level) + '22', border: `1px solid ${alertColor(analysis.alert_level)}`, color: alertColor(analysis.alert_level), fontSize: 13, fontWeight: 600 }}>
                  {analysis.alert_level?.toUpperCase()}
                </div>
              )}
              {analysis.pump_needed && (
                <div style={{ padding: '6px 14px', borderRadius: 20, background: '#0ea5e922', border: '1px solid #0ea5e9', color: '#0ea5e9', fontSize: 13, fontWeight: 600 }}>
                  💧 Paani Chahiye
                </div>
              )}
            </div>

            {analysis.visual_status && <InfoRow label="Paudha kaisa dikhta hai" value={analysis.visual_status} />}
            {analysis.pump_reason   && <InfoRow label="Paani ki zaroorat" value={analysis.pump_reason} />}
            {analysis.leaf_condition && <InfoRow label="Patte ki halat" value={analysis.leaf_condition} />}
            {analysis.growth_stage  && <InfoRow label="Growth stage" value={analysis.growth_stage} />}
            {analysis.disease_detected && analysis.disease_detected !== 'none' &&
              <InfoRow label="Bimari" value={analysis.disease_detected} highlight="#ef4444" />}

            {analysis.alerts?.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 6 }}>ALERTS</div>
                {analysis.alerts.map((a, i) => (
                  <div key={i} style={{ color: '#fbbf24', fontSize: 14, marginBottom: 4 }}>⚠ {a}</div>
                ))}
              </div>
            )}

            {analysis.recommendations?.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 6 }}>TIPS</div>
                {analysis.recommendations.map((r, i) => (
                  <div key={i} style={{ color: '#86efac', fontSize: 14, marginBottom: 4 }}>✓ {r}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function btnStyle(bg, fullWidth = false) {
  return {
    background: bg, color: '#fff', border: 'none', borderRadius: 8,
    padding: '10px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
    ...(fullWidth ? { width: '100%' } : { flex: 1 })
  };
}

function ScoreBadge({ score }) {
  const color = score >= 70 ? '#22c55e' : score >= 40 ? '#f59e0b' : '#ef4444';
  return (
    <div style={{ padding: '6px 14px', borderRadius: 20, background: color + '22', border: `1px solid ${color}`, color, fontSize: 15, fontWeight: 700 }}>
      ❤️ {score}/100
    </div>
  );
}

function InfoRow({ label, value, highlight }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ color: '#94a3b8', fontSize: 12 }}>{label.toUpperCase()}</div>
      <div style={{ color: highlight || '#e2e8f0', fontSize: 14, marginTop: 2 }}>{value}</div>
    </div>
  );
}
