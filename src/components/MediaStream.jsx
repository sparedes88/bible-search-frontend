import React, { useRef, useEffect, useState } from 'react';

export const MediaStream = ({
  enabled,
  deviceId,
  type = 'camera',
  onStreamReady,
  className = '',
}) => {
  const mediaRef = useRef(null);
  const [devices, setDevices] = useState([]);
  const [error, setError] = useState(null);
  const streamRef = useRef(null);

  useEffect(() => {
    if (enabled) {
      startStream();
    } else {
      stopStream();
    }
    return () => stopStream();
  }, [enabled, deviceId, type]);

  const startStream = async () => {
    try {
      let stream;
      
      switch (type) {
        case 'camera':
          stream = await navigator.mediaDevices.getUserMedia({
            video: deviceId ? { deviceId: { exact: deviceId } } : true,
            audio: false
          });
          break;
        case 'microphone':
          stream = await navigator.mediaDevices.getUserMedia({
            audio: deviceId ? { deviceId: { exact: deviceId } } : true,
            video: false
          });
          break;
        case 'screen':
          stream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: true
          });
          break;
        default:
          throw new Error(`Unsupported media type: ${type}`);
      }

      if (mediaRef.current) {
        mediaRef.current.srcObject = stream;
        streamRef.current = stream;
        onStreamReady?.(stream);
      }

      // Get available devices
      const devices = await navigator.mediaDevices.enumerateDevices();
      setDevices(devices.filter(device => 
        type === 'camera' ? device.kind === 'videoinput' : device.kind === 'audioinput'
      ));
    } catch (err) {
      console.error('Media stream error:', err);
      setError(err.message);
    }
  };

  const stopStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (mediaRef.current) {
      mediaRef.current.srcObject = null;
    }
  };

  if (error) {
    return <div className="text-red-500 text-sm">Error: {error}</div>;
  }

  return (
    <div className="relative">
      {(type === 'camera' || type === 'screen') ? (
        <video
          ref={mediaRef}
          autoPlay
          playsInline
          muted={type === 'camera'}
          className={className}
        />
      ) : (
        <audio
          ref={mediaRef}
          autoPlay
          className="hidden"
        />
      )}
      {devices.length > 0 && (
        <select 
          className="absolute top-2 right-2 bg-black/50 text-white px-2 py-1 rounded text-sm"
          value={deviceId || ''}
          onChange={(e) => onStreamReady?.(null, e.target.value)}
        >
          {devices.map(device => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || `${type} ${devices.indexOf(device) + 1}`}
            </option>
          ))}
        </select>
      )}
    </div>
  );
};

export default MediaStream;