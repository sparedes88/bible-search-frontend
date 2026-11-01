import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { 
  doc, 
  onSnapshot, 
  getDoc, 
  updateDoc, 
  setDoc,
  deleteDoc,
  collection,
  addDoc,
  getDocs,
  increment
} from 'firebase/firestore';
import { db } from '../firebase';
import CAPTION_LANGUAGES from '../constants/translationLanguages';
import './BroadcastView.css';

const GEMINI_TEXT_MODEL = 'gemini-flash-latest';
const FIREBASE_FUNCTIONS_BASE_URL =
  typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? '/firebase-api'
    : 'https://us-central1-igletechv1.cloudfunctions.net';

const REACTIONS = [
  { key: 'amen', emoji: '🙏', label: 'Amen' },
  { key: 'hallelujah', emoji: '🙌', label: 'Hallelujah' },
  { key: 'like', emoji: '👍', label: 'Like' },
  { key: 'love', emoji: '❤️', label: 'Love' },
  { key: 'fire', emoji: '🔥', label: 'Fire' },
  { key: 'clap', emoji: '👏', label: 'Clap' },
];

const BroadcastView = () => {
  const { id, broadcastId } = useParams();
  const [broadcast, setBroadcast] = useState(null);
  const [currentSong, setCurrentSong] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [viewerCount, setViewerCount] = useState(0);
  const [floatingReactions, setFloatingReactions] = useState([]);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const lastReactionIdRef = useRef(null);
  const audioRef = useRef(null);
  const broadcastVideoRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const lastOfferCandidateRef = useRef(null);
  const [audioAutoplayFailed, setAudioAutoplayFailed] = useState(false);
  const [audioPermissionGranted, setAudioPermissionGranted] = useState(false);
  const [audioStream, setAudioStream] = useState(null);
  const [peerConnection, setPeerConnection] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [captionLanguage, setCaptionLanguage] = useState(
    () => (typeof window !== 'undefined' && window.localStorage.getItem('broadcastCaptionLanguage')) || ''
  );
  // Always starts on "no translation" each visit; a previously cached mode is never restored,
  // so captions/translation only turn on when the viewer explicitly picks one this session.
  const [translationMode, setTranslationMode] = useState('off');
  const [captionText, setCaptionText] = useState('');
  const [translating, setTranslating] = useState(false);
  const [showTranslationSettings, setShowTranslationSettings] = useState(false);
  const defaultAppliedRef = useRef(false);
  // The projector screen usually runs on the same machine as the microphone, so it opens muted
  // to avoid feeding speaker output straight back into the mic.
  const [audioMuted, setAudioMuted] = useState(
    () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('muted') === '1'
  );
  // "tv" is the production-screen variant: no microphone audio, no translation/captions.
  const isTvVariant = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('variant') === 'tv';
  const spokenCaptionRef = useRef('');
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

  // Mobile Safari's address/tab bar changes the visible viewport without firing a reliable
  // resize on `100vh`/`100dvh` in every version, so track the real visible height via
  // visualViewport and expose it as a CSS var the container/buttons size against.
  useEffect(() => {
    const setAppViewportHeight = () => {
      const visibleHeight = window.visualViewport?.height || window.innerHeight;
      document.documentElement.style.setProperty('--app-vh', `${visibleHeight * 0.01}px`);
    };

    setAppViewportHeight();
    window.addEventListener('resize', setAppViewportHeight);
    window.addEventListener('orientationchange', setAppViewportHeight);
    window.visualViewport?.addEventListener('resize', setAppViewportHeight);
    window.visualViewport?.addEventListener('scroll', setAppViewportHeight);

    return () => {
      window.removeEventListener('resize', setAppViewportHeight);
      window.removeEventListener('orientationchange', setAppViewportHeight);
      window.visualViewport?.removeEventListener('resize', setAppViewportHeight);
      window.visualViewport?.removeEventListener('scroll', setAppViewportHeight);
      document.documentElement.style.removeProperty('--app-vh');
    };
  }, []);

  // Locks page-level scrolling while this view is mounted so mobile browsers never let the
  // user scroll to reveal blank space below the fixed-height broadcast container.
  useEffect(() => {
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyPosition = document.body.style.position;
    const previousBodyWidth = document.body.style.width;
    const previousBodyHeight = document.body.style.height;

    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
    document.body.style.height = '100%';

    return () => {
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.position = previousBodyPosition;
      document.body.style.width = previousBodyWidth;
      document.body.style.height = previousBodyHeight;
    };
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch (err) {
      console.error('Fullscreen toggle failed:', err);
    }
  };

  // Keeps the button label in sync when fullscreen is exited with Esc or F11.
  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    const handleKeyDown = (event) => {
      const tagName = event.target?.tagName;
      if (tagName === 'INPUT' || tagName === 'TEXTAREA' || event.target?.isContentEditable) return;
      if (event.key === 'f' || event.key === 'F') toggleFullscreen();
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const offeredLanguages = useMemo(() => {
    const offeredCodes = Array.isArray(broadcast?.translationLanguages)
      ? broadcast.translationLanguages
      : [];
    if (offeredCodes.length === 0) return CAPTION_LANGUAGES;
    return CAPTION_LANGUAGES.filter((language) => offeredCodes.includes(language.code));
  }, [broadcast?.translationLanguages]);

  // Apply the broadcaster's default once, unless this viewer already picked something themselves.
  useEffect(() => {
    if (defaultAppliedRef.current) return;
    if (!broadcast) return;

    defaultAppliedRef.current = true;

    const saved = typeof window !== 'undefined'
      ? window.localStorage.getItem('broadcastCaptionLanguage')
      : '';
    const isSavedOffered = saved && offeredLanguages.some((language) => language.code === saved);
    if (isSavedOffered) {
      setCaptionLanguage(saved);
      return;
    }

    const fallback = String(broadcast?.defaultTranslationLanguage || '');
    if (fallback && offeredLanguages.some((language) => language.code === fallback)) {
      setCaptionLanguage(fallback);
    }
  }, [broadcast, offeredLanguages]);

  const originalCaption = String(broadcast?.caption?.original || '');
  const captionAt = Number(broadcast?.caption?.at) || 0;
  const preTranslated = String(broadcast?.caption?.translations?.[captionLanguage] || '');

  // Prefer the translation the broadcaster already published; only call Gemini for a language
  // that was not pre-translated, and show the original meanwhile so nothing sits blank.
  useEffect(() => {
    if (!captionLanguage || translationMode === 'off' || !originalCaption || !captionAt) {
      setCaptionText('');
      return undefined;
    }

    if (preTranslated) {
      setCaptionText(preTranslated);
      setTranslating(false);
      return undefined;
    }

    let cancelled = false;
    const languageLabel =
      CAPTION_LANGUAGES.find((language) => language.code === captionLanguage)?.label || captionLanguage;

    setCaptionText(originalCaption);
    setTranslating(true);
    fetch(`${FIREBASE_FUNCTIONS_BASE_URL}/generateTimeRotateInvoiceReview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: GEMINI_TEXT_MODEL,
        prompt: `You are a live interpreter for a church service. Translate the following into ${languageLabel}. Return ONLY the translated sentence, with no quotes, notes or commentary. Text: ${originalCaption}`,
      }),
    })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('Translation failed'))))
      .then((data) => {
        if (cancelled) return;
        setCaptionText(String(data?.text || '').trim() || originalCaption);
      })
      .catch((err) => {
        console.error('Caption translation failed:', err);
        if (!cancelled) setCaptionText(originalCaption);
      })
      .finally(() => {
        if (!cancelled) setTranslating(false);
      });

    return () => {
      cancelled = true;
    };
  }, [captionLanguage, originalCaption, captionAt, translationMode, preTranslated]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('broadcastCaptionLanguage', captionLanguage);
      // Translation mode is intentionally not persisted, so every visit defaults to "no translation".
      window.localStorage.removeItem('broadcastTranslationMode');
    }
  }, [captionLanguage]);

  // Speak only finished phrases: partial captions update several times per sentence and would
  // otherwise be read out again on every update.
  useEffect(() => {
    const wantsAudio = translationMode === 'audio' || translationMode === 'both';
    const isPartial = Boolean(broadcast?.caption?.partial);
    if (!wantsAudio || isPartial || !captionText) return;
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    if (spokenCaptionRef.current === captionText) return;

    spokenCaptionRef.current = captionText;
    const utterance = new window.SpeechSynthesisUtterance(captionText);
    utterance.lang =
      CAPTION_LANGUAGES.find((language) => language.code === captionLanguage)?.speech || 'en-US';
    window.speechSynthesis.speak(utterance);
  }, [broadcast?.caption?.partial, captionText, translationMode, captionLanguage]);

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

  // Spawns a floating emoji whenever a new reaction arrives, ignoring the one already on
  // the doc when this viewer first connects so old reactions don't replay on load.
  useEffect(() => {
    const reaction = broadcast?.lastReaction;
    if (!reaction?.id) return;

    if (lastReactionIdRef.current === null) {
      lastReactionIdRef.current = reaction.id;
      return;
    }
    if (lastReactionIdRef.current === reaction.id) return;
    lastReactionIdRef.current = reaction.id;

    const floatId = `${reaction.id}-${Math.random().toString(36).slice(2, 8)}`;
    const label = REACTIONS.find((entry) => entry.key === reaction.key)?.label || '';
    setFloatingReactions((previous) => [
      ...previous,
      { id: floatId, emoji: reaction.emoji, label, left: 10 + Math.random() * 80 },
    ]);

    setTimeout(() => {
      setFloatingReactions((previous) => previous.filter((entry) => entry.id !== floatId));
    }, 3000);
  }, [broadcast?.lastReaction]);

  const handleSendReaction = async (reactionKey, emoji) => {
    if (!id || !broadcastId) return;
    try {
      await updateDoc(doc(db, `churches/${id}/broadcasts`, broadcastId), {
        lastReaction: {
          key: reactionKey,
          emoji,
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        },
        [`reactionCounts.${reactionKey}`]: increment(1),
      });
    } catch (err) {
      console.error('Error sending reaction:', err);
    }
  };

  // Presence-based count: each viewer keeps its own heartbeat doc, so tabs that are closed or
  // crash simply go stale instead of leaving the old shared counter permanently inflated.
  useEffect(() => {
    if (!id || !broadcastId) return;

    const VIEWER_HEARTBEAT_MS = 20000;
    const VIEWER_STALE_MS = 60000;

    const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const viewersRef = collection(db, `churches/${id}/broadcasts/${broadcastId}/viewers`);
    const myViewerRef = doc(viewersRef, sessionId);

    const sendHeartbeat = () =>
      setDoc(myViewerRef, { lastSeen: Date.now() }, { merge: true }).catch((err) =>
        console.error('Error updating viewer presence:', err)
      );

    sendHeartbeat();
    const heartbeatTimer = setInterval(sendHeartbeat, VIEWER_HEARTBEAT_MS);

    const unsubscribe = onSnapshot(
      viewersRef,
      (snapshot) => {
        const cutoff = Date.now() - VIEWER_STALE_MS;
        const activeCount = snapshot.docs.filter((viewerDoc) => {
          const lastSeen = Number(viewerDoc.data()?.lastSeen) || 0;
          return lastSeen > cutoff;
        }).length;
        setViewerCount(activeCount);
      },
      (error) => {
        console.error('Error listening to viewer count:', error);
      }
    );

    const handleUnload = () => {
      deleteDoc(myViewerRef).catch(() => {});
    };
    window.addEventListener('pagehide', handleUnload);

    return () => {
      window.removeEventListener('pagehide', handleUnload);
      clearInterval(heartbeatTimer);
      unsubscribe();
      deleteDoc(myViewerRef).catch((err) => {
        console.error('Error removing viewer presence:', err);
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

  // Keyed on the offer SDP string, not the offer object: every broadcast document write
  // (captions, ICE candidates) produces a new object identity and would otherwise rebuild
  // the connection each time, leaking RTCPeerConnections until the browser refuses more.
  useEffect(() => {
    const offerSdp = broadcast?.offer?.sdp;

    const closeActiveConnection = () => {
      if (peerConnectionRef.current) {
        cleanupPeerConnection(peerConnectionRef.current);
        peerConnectionRef.current = null;
      }
    };

    if (isTvVariant || !broadcast?.micEnabled || !offerSdp) {
      closeActiveConnection();
      setPeerConnection(null);
      return undefined;
    }

    closeActiveConnection();
    lastOfferCandidateRef.current = null;

    let cancelled = false;
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    });
    peerConnectionRef.current = pc;

    pc.onconnectionstatechange = () => {
      console.log('Connection state:', pc.connectionState);
    };

    pc.oniceconnectionstatechange = () => {
      console.log('ICE connection state:', pc.iceConnectionState);
    };

    pc.ontrack = (event) => {
      if (audioRef.current) {
        audioRef.current.srcObject = event.streams[0];
        setAudioStream(event.streams[0]);
        audioRef.current.play()
          .then(() => setAudioAutoplayFailed(false))
          .catch(() => setAudioAutoplayFailed(true));
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        updateDoc(doc(db, `churches/${id}/broadcasts`, broadcastId), {
          viewerIceCandidate: event.candidate.toJSON(),
        }).catch((err) => {
          console.error('Error sending viewer ICE candidate:', err);
        });
      }
    };

    const setupAudioConnection = async () => {
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(broadcast.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        if (cancelled) return;

        await updateDoc(doc(db, `churches/${id}/broadcasts`, broadcastId), {
          answer: {
            type: answer.type,
            sdp: answer.sdp
          }
        });

        if (!cancelled) setPeerConnection(pc);
      } catch (err) {
        if (!cancelled) {
          console.error('Audio setup error:', err);
          setError('Could not connect to audio stream. Please refresh the page.');
        }
      }
    };

    setupAudioConnection();

    return () => {
      cancelled = true;
      cleanupPeerConnection(pc);
      if (peerConnectionRef.current === pc) peerConnectionRef.current = null;
      setPeerConnection(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [broadcast?.micEnabled, broadcast?.offer?.sdp, id, broadcastId]);

  useEffect(() => {
    if (!peerConnection || !broadcast?.iceCandidate) return;

    const nextCandidate = JSON.stringify(broadcast.iceCandidate);
    if (lastOfferCandidateRef.current === nextCandidate) return;

    lastOfferCandidateRef.current = nextCandidate;
    peerConnection
      .addIceCandidate(new RTCIceCandidate(broadcast.iceCandidate))
      .catch((err) => {
        console.error('Error adding offer ICE candidate:', err);
      });
  }, [peerConnection, broadcast?.iceCandidate]);

  useEffect(() => {
    const video = broadcastVideoRef.current;
    if (!video || !broadcast?.videoUrl) return;

    const targetTime = Number(broadcast.videoCurrentTime) || 0;
    if (Number.isFinite(targetTime) && Math.abs(video.currentTime - targetTime) > 1.5) {
      video.currentTime = targetTime;
    }

    if (broadcast.videoPaused) {
      video.pause();
    } else {
      video.play().catch(() => {});
    }
  }, [broadcast?.videoUrl, broadcast?.videoCurrentTime, broadcast?.videoPaused, broadcast?.videoControlAt]);

  // Reactions fade out earlier when there's on-screen text so they don't obscure it as they float up.
  const hasVisibleText = Boolean(captionText)
    || Boolean(broadcast?.bibleVerse)
    || Boolean(currentSong?.lyrics?.[broadcast?.currentLyricIndex])
    || Boolean(captionLanguage && translationMode !== 'off');

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

  // Remove the overlay div and update the broadcast container
  return (
    <div 
      className="broadcast-container"
      style={{ 
        backgroundImage: settings.backgroundType === 'gradient'
          ? `linear-gradient(${settings.gradientAngle}deg, ${settings.gradientColors[0]}, ${settings.gradientColors[1]})`
          : settings.backgroundType === 'ai' || settings.backgroundType === 'image'
            ? Number(broadcast?.backgroundBlur) > 0 ? 'none' : `url("${settings.backgroundColor}")`
            : 'none',
        backgroundColor: settings.backgroundType === 'gradient'
          || settings.backgroundType === 'ai'
          || settings.backgroundType === 'image'
          ? 'transparent'
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
        overflow: 'hidden',
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
      {Number(broadcast?.backgroundBlur) > 0 &&
        (settings.backgroundType === 'ai' || settings.backgroundType === 'image') && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: `url("${settings.backgroundColor}")`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            filter: `blur(${Number(broadcast?.backgroundBlur) || 0}px)`,
            transform: 'scale(1.1)',
            pointerEvents: 'none',
            zIndex: 0,
          }}
        />
      )}

      {!isTvVariant && showTranslationSettings ? (
        <div
          style={{
            position: 'absolute',
            right: '16px',
            bottom: 'calc(78px + env(safe-area-inset-bottom, 0px))',
            zIndex: 26,
            padding: '12px',
            borderRadius: '10px',
            background: 'rgba(0, 0, 0, 0.72)',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            width: 'min(220px, calc(100vw - 24px))',
            maxHeight: 'calc(100vh - 100px)',
            overflowY: 'auto',
            boxSizing: 'border-box',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
          }}
        >
        <select
          value={translationMode}
          onChange={(event) => {
            if (window.speechSynthesis) window.speechSynthesis.cancel();
            setTranslationMode(event.target.value);
          }}
          aria-label="Translation type"
          style={{
            border: '1px solid rgba(255, 255, 255, 0.35)',
            borderRadius: '8px',
            padding: '10px 12px',
            background: 'rgba(0, 0, 0, 0.55)',
            color: '#FFFFFF',
            fontSize: '0.95rem',
            fontWeight: 700,
            backdropFilter: 'blur(4px)',
          }}
        >
          <option value="off" style={{ color: '#000' }}>🚫 No translation</option>
          <option value="text" style={{ color: '#000' }}>💬 Captions</option>
          <option value="audio" style={{ color: '#000' }}>🔊 Audio</option>
          <option value="both" style={{ color: '#000' }}>💬🔊 Captions + Audio</option>
        </select>

        {translationMode !== 'off' ? (
          <select
            value={captionLanguage}
            onChange={(event) => setCaptionLanguage(event.target.value)}
            aria-label="Caption language"
            style={{
              border: '1px solid rgba(255, 255, 255, 0.35)',
              borderRadius: '8px',
              padding: '10px 12px',
              background: 'rgba(0, 0, 0, 0.55)',
              color: '#FFFFFF',
              fontSize: '0.95rem',
              fontWeight: 700,
              backdropFilter: 'blur(4px)',
            }}
          >
            <option value="" style={{ color: '#000' }}>🌐 Choose language</option>
            {offeredLanguages.map((language) => (
              <option key={language.code} value={language.code} style={{ color: '#000' }}>
                {language.label}
              </option>
            ))}
          </select>
        ) : null}

        {audioAutoplayFailed && broadcast?.micEnabled ? (
          <button
            type="button"
            onClick={() => {
              if (!audioRef.current) return;
              audioRef.current.muted = false;
              setAudioMuted(false);
              audioRef.current
                .play()
                .then(() => setAudioAutoplayFailed(false))
                .catch((err) => console.error('Audio playback failed:', err));
            }}
            style={{
              border: '1px solid rgba(255, 255, 255, 0.35)',
              borderRadius: '8px',
              padding: '10px 12px',
              background: '#2563eb',
              color: '#FFFFFF',
              fontSize: '0.95rem',
              fontWeight: 700,
              cursor: 'pointer',
              backdropFilter: 'blur(4px)',
            }}
          >
            🔊 Turn on service audio
          </button>
        ) : null}
        {broadcast?.micEnabled ? (
          <button
            type="button"
            onClick={() => {
              const nextMuted = !audioMuted;
              setAudioMuted(nextMuted);
              if (audioRef.current) {
                audioRef.current.muted = nextMuted;
                if (!nextMuted) audioRef.current.play().catch(() => setAudioAutoplayFailed(true));
              }
            }}
            style={{
              border: '1px solid rgba(255, 255, 255, 0.35)',
              borderRadius: '8px',
              padding: '9px 10px',
              background: audioMuted ? 'rgba(220, 38, 38, 0.75)' : 'rgba(16, 185, 129, 0.75)',
              color: '#FFFFFF',
              fontSize: '0.85rem',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {audioMuted ? '🔇 Service audio muted' : '🎙 Service audio on'}
          </button>
        ) : null}
        </div>
      ) : null}

      {!isTvVariant && captionText && (translationMode === 'text' || translationMode === 'both') ? (
        <div
          style={{
            position: 'absolute',
            bottom: '110px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 20,
            maxWidth: 'min(86%, calc(100vw - 32px))',
            maxHeight: '40vh',
            overflow: 'hidden',
            boxSizing: 'border-box',
            padding: '14px 22px',
            borderRadius: '10px',
            background: 'rgba(0, 0, 0, 0.7)',
            color: '#FFFFFF',
            fontSize: 'clamp(16px, 2.4vw, 34px)',
            lineHeight: 1.35,
            textAlign: 'center',
            backdropFilter: 'blur(4px)',
          }}
        >
          {captionText}
        </div>
      ) : !isTvVariant && captionLanguage && translationMode !== 'off' ? (
        <div
          style={{
            position: 'absolute',
            bottom: '110px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 20,
            maxWidth: 'calc(100vw - 32px)',
            boxSizing: 'border-box',
            padding: '10px 18px',
            borderRadius: '10px',
            background: 'rgba(0, 0, 0, 0.45)',
            color: '#e5e7eb',
            fontSize: 'clamp(12px, 1.4vw, 18px)',
            textAlign: 'center',
            backdropFilter: 'blur(4px)',
          }}
        >
          {broadcast?.translationEnabled
            ? translating
              ? 'Translating...'
              : 'Waiting for the speaker...'
            : 'Translation has not started yet'}
        </div>
      ) : null}

      <div className="viewer-count">
        <span className="viewer-badge">
          👥 {viewerCount} {viewerCount === 1 ? 'viewer' : 'viewers'}
        </span>
      </div>

      {!isTvVariant && (
      <audio 
        ref={audioRef} 
        autoPlay
        playsInline
        controls 
        muted={audioMuted}
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
      )}

      {!isTvVariant && broadcast?.micEnabled && (
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

      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', zIndex: 30, pointerEvents: 'none' }}>
        {floatingReactions.map((reaction) => (
          <div
            key={reaction.id}
            className={`floating-reaction${hasVisibleText ? ' floating-reaction--fade-text' : ''}`}
            style={{ left: `${reaction.left}%` }}
          >
            <span className="floating-reaction-emoji">{reaction.emoji}</span>
            {reaction.label && <span className="floating-reaction-label">{reaction.label}</span>}
          </div>
        ))}
      </div>

      <div
        style={{
          position: 'absolute',
          right: '16px',
          bottom: 'calc(18px + env(safe-area-inset-bottom, 0px))',
          zIndex: 25,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: '10px',
        }}
      >
        {showReactionPicker ? (
          <div
            style={{
              display: 'flex',
              gap: 'clamp(4px, 1.5vw, 8px)',
              flexWrap: 'wrap',
              justifyContent: 'flex-end',
              background: 'rgba(0, 0, 0, 0.65)',
              borderRadius: '16px',
              padding: '8px 10px',
              backdropFilter: 'blur(4px)',
              maxWidth: 'calc(100vw - 32px)',
              boxSizing: 'border-box',
            }}
          >
            {REACTIONS.map((reaction) => (
              <button
                key={reaction.key}
                type="button"
                onClick={() => handleSendReaction(reaction.key, reaction.emoji)}
                title={reaction.label}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '2px',
                  border: 'none',
                  background: 'rgba(255, 255, 255, 0.12)',
                  borderRadius: '10px',
                  padding: 'clamp(4px, 1.2vw, 6px) clamp(6px, 2vw, 10px)',
                  cursor: 'pointer',
                  color: '#fff',
                  flexShrink: 0,
                }}
              >
                <span style={{ fontSize: 'clamp(1.1rem, 4vw, 1.4rem)', lineHeight: 1 }}>{reaction.emoji}</span>
                <span style={{ fontSize: 'clamp(0.6rem, 2vw, 0.7rem)', fontWeight: 700 }}>
                  {Number(broadcast?.reactionCounts?.[reaction.key]) || 0}
                </span>
              </button>
            ))}
          </div>
        ) : null}

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {!isTvVariant && (
          <button
            type="button"
            onClick={() => setShowTranslationSettings((previous) => !previous)}
            aria-label="Translation settings"
            title="Translation settings"
            style={{
              width: '42px',
              height: '42px',
              borderRadius: '50%',
              border: '1px solid rgba(255, 255, 255, 0.35)',
              background: showTranslationSettings ? 'rgba(79, 70, 229, 0.85)' : 'rgba(0, 0, 0, 0.55)',
              color: '#FFFFFF',
              fontSize: '1.2rem',
              lineHeight: 1,
              padding: 0,
              boxSizing: 'border-box',
              cursor: 'pointer',
              backdropFilter: 'blur(4px)',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ⚙
          </button>
          )}

          <button
            type="button"
            onClick={() => setShowReactionPicker((previous) => !previous)}
            aria-label={showReactionPicker ? 'Close reactions' : 'Open reactions'}
            title={showReactionPicker ? 'Close reactions' : 'React'}
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              border: '1px solid rgba(255, 255, 255, 0.35)',
              background: showReactionPicker ? 'rgba(79, 70, 229, 0.85)' : 'rgba(0, 0, 0, 0.55)',
              color: '#fff',
              fontSize: '1.4rem',
              padding: 0,
              boxSizing: 'border-box',
              cursor: 'pointer',
              backdropFilter: 'blur(4px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {showReactionPicker ? '✕' : '😀'}
          </button>
        </div>
      </div>

      {broadcast?.propVisible && broadcast?.propUrl && (
        <div
          style={{
            position: 'absolute',
            right: '4%',
            bottom: '4%',
            zIndex: 15,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: broadcast.propColor || 'transparent',
            borderRadius: '8px',
            padding: '10px',
            pointerEvents: 'none',
          }}
        >
          <img
            src={broadcast.propUrl}
            alt=""
            style={{ width: `${Number(broadcast.propSize) || 30}vw`, maxWidth: '90vw', objectFit: 'contain', display: 'block' }}
          />
        </div>
      )}

      <div 
        className="broadcast-content" 
        style={{ 
          flex: 1, 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          minHeight: 0,
          overflow: 'hidden',
          background: 'transparent' // Add this to ensure no background
        }}
      >
        {broadcast?.videoUrl ? (
          <video
            ref={broadcastVideoRef}
            src={broadcast.videoUrl}
            autoPlay
            loop
            controls
            playsInline
            style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000', position: 'relative', zIndex: 1 }}
          />
        ) : <div
          className="lyrics-container"
          style={{
            color: settings.fontColor,
            fontSize: `min(${settings.fontSize}px, 12vw, 9vh)`,
            fontFamily: settings.fontFamily,
            fontWeight: settings.isBold ? 'bold' : 'normal',
            fontStyle: settings.isItalic ? 'italic' : 'normal',
            textTransform: settings.isUpperCase ? 'uppercase' : 'none',
            textShadow: settings.textShadow,
            filter: `blur(${settings.textBlur}px)`,
            textAlign: 'center',
            padding: 'clamp(10px, 4vw, 20px)',
            maxWidth: '90%',
            maxHeight: '100%',
            overflow: 'hidden',
            overflowWrap: 'break-word',
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
                fontSize: `min(${parseInt(settings.fontSize) * 0.5}px, 6vw, 4.5vh)`,
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
                ''
              )}
            </>
          )}
        </div>}
      </div>
    </div>
  );
};

export default BroadcastView;