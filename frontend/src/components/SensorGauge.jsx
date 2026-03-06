import React from 'react';

export default function SensorGauge({ value, max, label, color = 'var(--primary)', unit = '%' }) {
  const percentage = (value / max) * 100;
  const circumference = 2 * Math.PI * 45;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  return (
    <div className="sensor-gauge">
      <div className="sensor-gauge-svg-container">
        <svg viewBox="0 0 120 120" className="sensor-gauge-svg">
          {/* Background circle */}
          <circle cx="60" cy="60" r="45" fill="none" stroke="#e5e7eb" strokeWidth="6" />
          {/* Progress circle */}
          <circle
            cx="60"
            cy="60"
            r="45"
            fill="none"
            stroke={color}
            strokeWidth="6"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className="sensor-gauge-progress"
          />
          {/* Center text */}
          <text x="60" y="55" textAnchor="middle" fontSize="28" fontWeight="bold" fill={color}>
            {value}
          </text>
          <text x="60" y="75" textAnchor="middle" fontSize="14" fill="var(--text-secondary)">
            {unit}
          </text>
        </svg>
      </div>
      <div className="sensor-gauge-label">{label}</div>
    </div>
  );
}
