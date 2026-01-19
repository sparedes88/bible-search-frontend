import { useParams } from "react-router-dom";
import { useState, useEffect, useRef } from "react";
import { db } from "@/firebase";
import { doc, getDoc, onSnapshot, updateDoc } from "firebase/firestore";
import { motion } from "framer-motion";

export default function BroadcastView() {
  const { broadcastId } = useParams();
  const [broadcast, setBroadcast] = useState(null);
  const [song, setSong] = useState(null);
  const [error, setError] = useState(null);
  const [audioAutoplayFailed, setAudioAutoplayFailed] = useState(false);
  const audioRef = useRef(new Audio());
  const peerConnectionRef = useRef(null);

  // Listen to broadcast changes
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "broadcasts", broadcastId), async (snap) => {
      const data = snap.data();
      setBroadcast(data);
      
      if (data?.songId) {
        const songRef = doc(db, "songs", data.songId);
        const songSnap = await getDoc(songRef);
        if (songSnap.exists()) setSong(songSnap.data());
      }
    });
    return () => unsub();
  }, [broadcastId]);

  // Handle WebRTC audio connection
  useEffect(() => {
    if (!broadcast?.micEnabled || !broadcast?.offer) {
      // Clean up existing connection if mic is disabled
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }
      if (audioRef.current.srcObject) {
        audioRef.current.srcObject = null;
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

        peerConnectionRef.current = pc;

        // Handle incoming audio track
        pc.ontrack = (event) => {
          console.log('Received audio track');
          audioRef.current.srcObject = event.streams[0];
          audioRef.current.play()
            .then(() => {
              console.log('Audio playing');
              setAudioAutoplayFailed(false);
            })
            .catch(err => {
              console.log('Autoplay failed:', err);
              setAudioAutoplayFailed(true);
            });
        };

        // Set remote description (broadcaster's offer)
        await pc.setRemoteDescription(new RTCSessionDescription(broadcast.offer));

        // Create and set local description (answer)
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        // Send answer back through Firestore
        await updateDoc(doc(db, "broadcasts", broadcastId), {
          answer: {
            type: answer.type,
            sdp: answer.sdp
          }
        });

      } catch (err) {
        console.error('Error setting up audio:', err);
        setError('Could not connect to audio stream');
      }
    };

    setupAudioConnection();

    // Cleanup on unmount
    return () => {
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }
    };
  }, [broadcast?.micEnabled, broadcast?.offer, broadcastId]);

  // Handle autoplay failure
  useEffect(() => {
    const handleUserInteraction = () => {
      if (audioAutoplayFailed && audioRef.current.srcObject) {
        audioRef.current.play()
          .then(() => setAudioAutoplayFailed(false))
          .catch(err => console.error('Still cannot play audio:', err));
      }
    };

    document.addEventListener('click', handleUserInteraction);
    return () => document.removeEventListener('click', handleUserInteraction);
  }, [audioAutoplayFailed]);

  if (!broadcast) return <div className="text-white text-center">Loading...</div>;
  
  return (
    <div
      className="w-screen h-screen flex items-center justify-center text-white text-6xl font-bold relative"
      style={{
        backgroundImage: `url(${broadcast.background})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      {/* Audio autoplay message */}
      {audioAutoplayFailed && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-red-600 text-white px-4 py-2 rounded-full text-sm">
          👆 Click anywhere to enable audio
        </div>
      )}

      {/* Audio status indicator */}
      {broadcast.micEnabled && (
        <div className="absolute top-4 right-4">
          <span className="px-3 py-1 bg-red-600 text-white rounded-full text-sm flex items-center gap-2">
            🎤 LIVE
          </span>
        </div>
      )}

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        key={song?.lyrics[broadcast.currentLyricIndex]?.text}
        className="p-8 text-center shadow-xl bg-black bg-opacity-40 rounded-2xl"
      >
        {song?.lyrics[broadcast.currentLyricIndex]?.text || ''}
      </motion.div>
    </div>
  );
}
