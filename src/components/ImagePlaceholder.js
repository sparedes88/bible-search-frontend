import React from 'react';

const ImagePlaceholder = ({ style, text = "No image available" }) => (
  <div style={{
    width: '100%',
    height: '200px',
    backgroundColor: '#f9fafb',
    borderRadius: '0.5rem',
    border: '2px dashed #d1d5db',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    ...style
  }}>
    <span style={{ 
      color: '#6b7280',
      fontSize: '0.875rem',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '0.5rem'
    }}>
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ width: '48px', height: '48px' }}>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
      <span>{text}</span>
    </span>
  </div>
);

export default ImagePlaceholder;