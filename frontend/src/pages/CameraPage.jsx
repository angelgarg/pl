import React, { useState, useRef } from 'react';
import * as api from '../api';

export default function CameraPage({ onAddToast }) {
  const [plants, setPlants] = useState([]);
  const [selectedPlantId, setSelectedPlantId] = useState('');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const fileInputRef = useRef(null);

  const handleFileSelect = (e) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      const reader = new FileReader();
      reader.onload = (e) => {
        setPreview(e.target?.result);
      };
      reader.readAsDataURL(selectedFile);
    }
  };

  const handleUpload = async () => {
    if (!file || !selectedPlantId) {
      onAddToast({ type: 'error', message: 'Select plant and image' });
      return;
    }

    setUploading(true);
    try {
      const result = await api.uploadPlantImage(selectedPlantId, file);
      setAnalysis(result.analysis);
      onAddToast({ type: 'success', message: 'Image uploaded successfully' });
    } catch (err) {
      onAddToast({ type: 'error', message: err.message });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Camera & Images</h1>
        <p className="page-subtitle">Upload and analyze plant images</p>
      </div>

      <div className="camera-container">
        <div className="upload-section">
          <h3>Upload Image</h3>

          <div className="form-group">
            <label htmlFor="plantSelect">Select Plant</label>
            <select
              id="plantSelect"
              value={selectedPlantId}
              onChange={(e) => setSelectedPlantId(e.target.value)}
            >
              <option value="">Choose a plant...</option>
              {plants.map(plant => (
                <option key={plant.id} value={plant.id}>{plant.name}</option>
              ))}
            </select>
          </div>

          <div className="upload-area" onClick={() => fileInputRef.current?.click()}>
            {preview ? (
              <img src={preview} alt="Preview" className="upload-preview" />
            ) : (
              <div className="upload-placeholder">
                <div className="upload-icon">📷</div>
                <p>Click to select image</p>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />
          </div>

          <button
            onClick={handleUpload}
            disabled={!file || !selectedPlantId || uploading}
            className="upload-btn"
          >
            {uploading ? 'Uploading...' : 'Upload & Analyze'}
          </button>
        </div>

        {analysis && (
          <div className="analysis-section">
            <h3>AI Analysis</h3>
            <div className="analysis-card">
              <div className="analysis-row">
                <strong>Visual Health:</strong>
                <span>{analysis.visual_health}</span>
              </div>
              {analysis.diseases_detected?.length > 0 && (
                <div className="analysis-row">
                  <strong>Diseases:</strong>
                  <span>{analysis.diseases_detected.join(', ')}</span>
                </div>
              )}
              <div className="analysis-row">
                <strong>Growth Stage:</strong>
                <span>{analysis.growth_stage}</span>
              </div>
              <div className="analysis-row">
                <strong>Health Score:</strong>
                <span>{analysis.health_score}%</span>
              </div>
              <div className="analysis-row">
                <strong>Summary:</strong>
                <span>{analysis.summary}</span>
              </div>
              {analysis.recommendations?.length > 0 && (
                <div className="analysis-recommendations">
                  <strong>Recommendations:</strong>
                  <ul>
                    {analysis.recommendations.map((rec, idx) => (
                      <li key={idx}>{rec}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
