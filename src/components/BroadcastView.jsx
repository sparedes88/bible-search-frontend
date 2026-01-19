import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { 
  doc, 
  onSnapshot, 
  getDoc, 
  updateDoc, 
  increment,
  setDoc,
  collection,
  addDoc,
  getDocs
} from 'firebase/firestore';
import { db } from '../firebase';
import './BroadcastView.css';

const BroadcastView = () => {
  const { id, broadcastId } = useParams();
  const [broadcast, setBroadcast] = useState(null);
  const [currentSong, setCurrentSong] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [viewerCount, setViewerCount] = useState(0);
  const audioRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const [audioAutoplayFailed, setAudioAutoplayFailed] = useState(false);
  const [audioPermissionGranted, setAudioPermissionGranted] = useState(false);
  const [audioStream, setAudioStream] = useState(null);
  const [peerConnection, setPeerConnection] = useState(null);
  const [settings, setSettings] = useState({
    fontFamily: "Arial",
    fontSize: "48",
    fontColor: "#FFFFFF",
    isBold: false,
    isItalic: false,
    isUpperCase: false,
    textShadow: "none",
    textBlur: 0,
    backgroundColor: "#1e3a8a", // Changed to a nice blue color
    backgroundType: "solid",
    gradientColors: ["#1e3a8a", "#3b82f6"], // Updated default gradient colors to blue
    gradientAngle: 45,
  });

  // Replace the audio visualization code with a simpler version that only shows when receiving
  const setupAudioVisualization = (stream) => {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(stream);
    
    analyser.fftSize = 128;
    source.connect(analyser);
    
    const canvas = document.getElementById('audioVisualizer');
    if (!canvas) return;
    
    const canvasCtx = canvas.getContext('2d');
    
    const draw = () => {
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      
      requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(dataArray);
      
      canvasCtx.fillStyle = 'rgba(0, 0, 0, 0)';
      canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
      canvasCtx.lineWidth = 2;
      canvasCtx.strokeStyle = '#4f46e5';
      canvasCtx.beginPath();
      
      const sliceWidth = canvas.width * 1.0 / bufferLength;
      let x = 0;
      
      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = v * canvas.height / 2;
        
        if (i === 0) {
          canvasCtx.moveTo(x, y);
        } else {
          canvasCtx.lineTo(x, y);
        }
        
        x += sliceWidth;
      }
      
      canvasCtx.lineTo(canvas.width, canvas.height / 2);
      canvasCtx.stroke();
    };
    
    draw();
    return audioContext;
  };

  // Replace or update your existing broadcast listener useEffect
  useEffect(() => {
    if (!id || !broadcastId) {
      setError("Missing church or broadcast ID");
      setLoading(false);
      return;
    }

    const broadcastRef = doc(db, `churches/${id}/broadcasts`, broadcastId);
    
    const unsubscribe = onSnapshot(
      broadcastRef,
      async (docSnapshot) => {
        if (docSnapshot.exists()) {
          const data = docSnapshot.data();
          setBroadcast(data);
          
          // Update settings state with all broadcast settings
          setSettings({
            fontFamily: data.fontFamily || "Arial",
            fontSize: data.fontSize || "48",
            fontColor: data.fontColor || "#FFFFFF",
            isBold: data.isBold || false,
            isItalic: data.isItalic || false,
            isUpperCase: data.isUpperCase || false,
            textShadow: data.textShadow || "none",
            textBlur: data.textBlur || 0,
            backgroundColor: data.backgroundColor || "#1e3a8a", // Changed default
            backgroundType: data.backgroundType || "solid",
            gradientColors: data.gradientColors || ["#1e3a8a", "#3b82f6"], // Changed default
            gradientAngle: data.gradientAngle || 45,
          });

          if (data.songId) {
            const songRef = doc(db, `churches/${id}/songs`, data.songId);
            const songDoc = await getDoc(songRef);
            if (songDoc.exists()) {
              setCurrentSong(songDoc.data());
            }
          }
          setLoading(false);
        } else {
          setError("Broadcast not found");
          setLoading(false);
        }
      },
      (error) => {
        console.error('Error:', error);
        setError(error.message);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [id, broadcastId]);

  // Add connection monitoring
  useEffect(() => {
    if (!id || !broadcastId) return;

    // Use a more efficient listener that only gets required fields
    const broadcastRef = doc(db, `churches/${id}/broadcasts`, broadcastId);
    const unsubscribe = onSnapshot(
      broadcastRef,
      { includeMetadataChanges: false }, // Optimize network usage
      async (docSnapshot) => {
        if (docSnapshot.exists()) {
          const data = docSnapshot.data();
          // Only update what's needed
          setBroadcast(prev => ({
            ...prev,
            backgroundColor: data.backgroundColor,
            fontColor: data.fontColor,
            fontSize: data.fontSize,
            micEnabled: data.micEnabled,
            currentLyricIndex: data.currentLyricIndex,
            songId: data.songId
          }));
        }
      }
    );

    return () => unsubscribe();
  }, [id, broadcastId]);

  // Replace the viewer count effect with this updated version
  useEffect(() => {
    if (!id || !broadcastId) return;

    const viewerRef = doc(db, `churches/${id}/broadcasts/${broadcastId}/viewers`, 'count');
    
    // Initialize or increment viewer count
    const initializeViewer = async () => {
      try {
        // First try to get the current count
        const docSnap = await getDoc(viewerRef);
        
        if (!docSnap.exists()) {
          // Create the document if it doesn't exist
          await setDoc(viewerRef, { count: 1 });
        } else {
          // Increment if it exists
          await updateDoc(viewerRef, {
            count: increment(1)
          });
        }
      } catch (err) {
        console.error('Error managing viewer count:', err);
      }
    };

    // Set up real-time listener for viewer count
    const unsubscribe = onSnapshot(
      viewerRef,
      (docSnapshot) => {
        if (docSnapshot.exists()) {
          const count = docSnapshot.data().count;
          setViewerCount(count || 0);
          console.log('Viewer count updated:', count); // Debug log
        } else {
          setViewerCount(0);
        }
      },
      (error) => {
        console.error('Error listening to viewer count:', error);
      }
    );

    // Initialize count when component mounts
    initializeViewer();

    // Cleanup: decrement count and unsubscribe
    return () => {
      unsubscribe();
      updateDoc(viewerRef, {
        count: increment(-1)
      }).catch(err => {
        console.error('Error decrementing viewer count:', err);
      });
    };
  }, [id, broadcastId]);

  // Add this cleanup utility function at the top of your component
  const cleanupPeerConnection = (pc) => {
    if (pc) {
      pc.ontrack = null;
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;
      pc.close();
    }
  };

  // Replace the WebRTC setup effect with this simplified version
  useEffect(() => {
    if (!broadcast?.micEnabled || !broadcast?.offer) {
      // Cleanup existing connection
      if (peerConnection) {
        peerConnection.close();
        setPeerConnection(null);
      }
      return;
    }

    const setupAudioConnection = async () => {
      try {
        // Create new peer connection
        const pc = new RTCPeerConnection({
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
          ]
        });

        // Add connection state logging
        pc.onconnectionstatechange = () => {
          console.log('Connection state:', pc.connectionState);
        };

        pc.oniceconnectionstatechange = () => {
          console.log('ICE connection state:', pc.iceConnectionState);
        };

        // Handle incoming audio
        pc.ontrack = (event) => {
          console.log('Received audio track');
          if (audioRef.current) {
            audioRef.current.srcObject = event.streams[0];
            audioRef.current.play()
              .then(() => {
                console.log('Audio playing');
                setAudioAutoplayFailed(false);
              })
              .catch(err => {
                console.log('Autoplay failed, waiting for user interaction');
                setAudioAutoplayFailed(true);
              });
          }
        };

        // Set remote description (broadcaster's offer)
        await pc.setRemoteDescription(new RTCSessionDescription(broadcast.offer));

        // Create and set local description (answer)
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        // Send answer back to broadcaster
        await updateDoc(doc(db, `churches/${id}/broadcasts`, broadcastId), {
          answer: {
            type: answer.type,
            sdp: answer.sdp
          }
        });

        setPeerConnection(pc);
        console.log('Audio connection setup complete');

      } catch (err) {
        console.error('Audio setup error:', err);
        setError('Could not connect to audio stream. Please refresh the page.');
      }
    };

    setupAudioConnection();

    // Cleanup function
    return () => {
      if (peerConnection) {
        peerConnection.close();
        setPeerConnection(null);
      }
    };
  }, [broadcast?.micEnabled, broadcast?.offer]);

  useEffect(() => {
    if (!id || !broadcastId) return;

    const broadcastRef = doc(db, `churches/${id}/broadcasts`, broadcastId);
    
    const unsubscribe = onSnapshot(broadcastRef, (docSnapshot) => {
      if (docSnapshot.exists()) {
        const data = docSnapshot.data();
        setBroadcast(data);
        
        // Update settings with all broadcast data
        setSettings({
          fontFamily: data.fontFamily || "Arial",
          fontSize: data.fontSize || "48",
          fontColor: data.fontColor || "#FFFFFF",
          isBold: data.isBold || false,
          isItalic: data.isItalic || false,
          isUpperCase: data.isUpperCase || false,
          textShadow: data.textShadow || "none",
          textBlur: data.textBlur || 0,
          backgroundColor: data.backgroundColor || "#1e3a8a", // Changed default
          backgroundType: data.backgroundType || "solid",
          gradientColors: data.gradientColors || ["#1e3a8a", "#3b82f6"], // Changed default
          gradientAngle: data.gradientAngle || 45,
        });
      }
    });

    return () => unsubscribe();
  }, [id, broadcastId]);

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-message">Loading broadcast...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-screen">
        <div className="error-message">{error}</div>
      </div>
    );
  }

  // Replace the audio permission overlay condition
  if (audioAutoplayFailed && broadcast?.micEnabled && audioStream) {
    return (
      <div className="audio-permission-overlay">
        <div className="permission-content">
          <h2>🎤 Audio Available</h2>
          <p>Browser requires user interaction to play audio</p>
          <button 
            className="enable-audio-btn"
            onClick={() => {
              if (audioRef.current) {
                audioRef.current.play()
                  .then(() => {
                    setAudioAutoplayFailed(false);
                    setAudioPermissionGranted(true);
                    setupAudioVisualization(audioStream);
                  })
                  .catch(err => {
                    console.error('Audio playback failed:', err);
                    setError('Could not play audio. Please try again.');
                  });
              }
            }}
          >
            Play Audio
          </button>
        </div>
      </div>
    );
  }

  // Remove the overlay div and update the broadcast container
  return (
    <div 
      className="broadcast-container"
      style={{ 
        background: settings.backgroundType === 'gradient'
          ? `linear-gradient(${settings.gradientAngle}deg, ${settings.gradientColors[0]}, ${settings.gradientColors[1]})`
          : settings.backgroundType === 'ai' || settings.backgroundType === 'image'
            ? `url("${settings.backgroundColor}")`
            : settings.backgroundColor,
        backgroundSize: (settings.backgroundType === 'ai' || settings.backgroundType === 'image') ? '100% 100%' : undefined,
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        position: 'relative', // Added to ensure proper stacking
      }}
    >
      {/* Remove this overlay div that was here before */}
      {/* {settings.backgroundType === 'ai' && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.4)',
            pointerEvents: 'none',
          }}
        />
      )} */}
      <div className="viewer-count">
        <span className="viewer-badge">
          👥 {viewerCount} {viewerCount === 1 ? 'viewer' : 'viewers'}
        </span>
      </div>

      <audio 
        ref={audioRef} 
        autoPlay
        playsInline
        controls 
        style={{ 
          position: 'fixed',
          top: '10px',
          right: '10px',
          zIndex: 1000,
          maxWidth: '200px'
        }}
        onError={(e) => {
          console.error('Audio playback error:', e.target.error);
          setError('Could not play audio stream');
        }}
      />
      
      {broadcast?.micEnabled && (
        <div className="broadcast-microphone">
          <span className="microphone-indicator">🎤 LIVE</span>
          <div className="audio-visualizer">
            <canvas 
              id="audioVisualizer"
              className="visualizer-canvas"
              width="200"
              height="40"
            />
          </div>
        </div>
      )}

      <div 
        className="broadcast-content" 
        style={{ 
          flex: 1, 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          background: 'transparent' // Add this to ensure no background
        }}
      >
        <div
          className="lyrics-container"
          style={{
            color: settings.fontColor,
            fontSize: `${settings.fontSize}px`,
            fontFamily: settings.fontFamily,
            fontWeight: settings.isBold ? 'bold' : 'normal',
            fontStyle: settings.isItalic ? 'italic' : 'normal',
            textTransform: settings.isUpperCase ? 'uppercase' : 'none',
            textShadow: settings.textShadow,
            filter: `blur(${settings.textBlur}px)`,
            textAlign: 'center',
            padding: '20px',
            maxWidth: '90%',
            wordWrap: 'break-word',
            background: 'transparent', // Add this to ensure no background
            position: 'relative', // Add this
            zIndex: 1 // Add this to ensure text is above background
          }}
        >
          {broadcast?.bibleVerse ? (
            <>
              {broadcast.bibleVerse.text}
              <div style={{ 
                fontSize: `${parseInt(settings.fontSize) * 0.5}px`, 
                marginTop: "1rem", 
                opacity: 0.8 
              }}>
                {broadcast.bibleVerse.reference} ({broadcast.bibleVerse.version})
              </div>
            </>
          ) : (
            <>
              {currentSong?.lyrics?.[broadcast?.currentLyricIndex]?.text ? (
                // Split the lyrics by newlines and render each line separately
                currentSong.lyrics[broadcast.currentLyricIndex].text
                  .split('\n')
                  .map((line, index) => (
                    <React.Fragment key={index}>
                      {line}
                      {index < currentSong.lyrics[broadcast.currentLyricIndex].text.split('\n').length - 1 && <br />}
                    </React.Fragment>
                  ))
              ) : currentSong?.lyrics?.[broadcast?.currentLyricIndex] ? (
                // For backward compatibility, handle lyrics as plain strings
                currentSong.lyrics[broadcast.currentLyricIndex]
                  .split('\n')
                  .map((line, index) => (
                    <React.Fragment key={index}>
                      {line}
                      {index < currentSong.lyrics[broadcast.currentLyricIndex].split('\n').length - 1 && <br />}
                    </React.Fragment>
                  ))
              ) : (
                'No content to display'
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default BroadcastView;