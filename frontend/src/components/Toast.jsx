import React, { useEffect } from 'react';

export default function Toast({ message, type = 'info', onClose }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 3500);
    return () => clearTimeout(timer);
  }, [onClose]);

  let icon = 'ℹ️';
  let bgColor = 'var(--primary-light)';

  if (type === 'success') {
    icon = '✅';
    bgColor = 'var(--success)';
  } else if (type === 'error') {
    icon = '❌';
    bgColor = 'var(--danger)';
  } else if (type === 'warning') {
    icon = '⚠️';
    bgColor = 'var(--warning)';
  }

  return (
    <div className="toast" style={{ backgroundColor: bgColor }}>
      <span className="toast-icon">{icon}</span>
      <span className="toast-message">{message}</span>
    </div>
  );
}
