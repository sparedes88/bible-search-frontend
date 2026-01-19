import React, { useState } from 'react';

const DebugPanel = ({ data, title = "Debug Information" }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <details style={{
      marginTop: '1rem',
      border: '1px solid #e5e7eb',
      borderRadius: '8px',
      backgroundColor: '#f9fafb'
    }}>
      <summary
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          cursor: 'pointer',
          padding: '0.75rem',
          fontSize: '0.9rem',
          color: '#6b7280',
          userSelect: 'none'
        }}
      >
        🔍 {title} {isExpanded ? '▼' : '▶'}
      </summary>
      {isExpanded && (
        <div style={{
          padding: '1rem',
          fontSize: '0.85rem',
          fontFamily: 'monospace',
          backgroundColor: 'white',
          borderTop: '1px solid #e5e7eb'
        }}>
          {Object.entries(data).map(([key, value]) => (
            <div key={key} style={{ marginBottom: '0.5rem' }}>
              <strong>{key}:</strong>{' '}
              <span style={{ color: '#374151' }}>
                {typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
              </span>
            </div>
          ))}
        </div>
      )}
    </details>
  );
};

export default DebugPanel;