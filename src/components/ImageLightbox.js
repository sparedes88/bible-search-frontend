import React from 'react';

const ImageLightbox = ({ isOpen, onClose, imageUrl }) => {
  if (!isOpen) return null;

  return (
    <div 
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 1000
      }}
      onClick={onClose}
    >
      <img 
        src={imageUrl} 
        alt="Full size"
        style={{
          maxWidth: '90%',
          maxHeight: '90%',
          objectFit: 'contain'
        }}
      />
    </div>
  );
};

export default ImageLightbox;
