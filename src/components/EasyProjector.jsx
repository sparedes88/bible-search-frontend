import React, { useState, useEffect, useMemo, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { db, storage, auth } from "../firebase";
import {
  doc,
  getDoc,
  updateDoc,
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  getDocs,
  deleteDoc,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { toast } from "react-toastify";
import { motion } from "framer-motion";
import commonStyles from "../pages/commonStyles";
import TRANSLATION_LANGUAGES from "../constants/translationLanguages";
import ChurchHeader from "./ChurchHeader";
import "./EasyProjector.css";
import { MdDelete, MdModeEdit } from "react-icons/md";
import { IoMdClose } from "react-icons/io";

const GEMINI_TEXT_MODEL = "gemini-flash-latest";
const GEMINI_IMAGE_MODEL = "gemini-2.0-flash-exp-image-generation";

const panelStyle = {
  border: "2px solid #e7e7e7",
  borderRadius: "8px",
  padding: "15px",
  marginBottom: "20px",
  textAlign: "left",
  background: "#ffffff",
};

const panelHeadingStyle = {
  margin: "0 0 14px 0",
  fontSize: "1.1rem",
  fontWeight: 700,
  color: "#0F172A",
};

const twoColumnStyle = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "flex-start",
  gap: "20px",
};

const DEFAULT_MEDIA_CATEGORIES = [  "Worship",
  "Sermon",
  "Announcements",
  "Christmas",
  "Easter",
  "Youth",
  "Prayer",
  "Uncategorized",
];

const REACTION_TYPES = [
  { key: "amen", emoji: "🙏", label: "Amen" },
  { key: "hallelujah", emoji: "🙌", label: "Hallelujah" },
  { key: "like", emoji: "👍", label: "Like" },
  { key: "love", emoji: "❤️", label: "Love" },
  { key: "fire", emoji: "🔥", label: "Fire" },
  { key: "clap", emoji: "👏", label: "Clap" },
];

const AI_IMAGE_STYLES = [
  { value: "photo", label: "📷 Photorealistic Photo", descriptor: "A high quality, photorealistic photograph with natural lighting and realistic detail" },
  { value: "cinematic", label: "🎬 Cinematic Scene", descriptor: "A cinematic film still with dramatic lighting, rich color grading and shallow depth of field" },
  { value: "nature", label: "🏔️ Nature / Landscape", descriptor: "A breathtaking real landscape photograph shot on a professional camera" },
  { value: "worship", label: "⛪ Worship / Church", descriptor: "A reverent, atmospheric worship scene suitable for a church service" },
  { value: "illustration", label: "🎨 Digital Illustration", descriptor: "A clean, modern digital illustration with bold shapes and harmonious colors" },
  { value: "watercolor", label: "🖌️ Watercolor Painting", descriptor: "A soft watercolor painting with flowing pigment and visible paper texture" },
  { value: "oil", label: "🖼️ Oil Painting", descriptor: "A rich oil painting with visible brush strokes and classical composition" },
  { value: "render3d", label: "🧊 3D Render", descriptor: "A polished 3D render with soft studio lighting and realistic materials" },
  { value: "abstract", label: "〰️ Abstract Graphic", descriptor: "An abstract graphic pattern with smooth shapes and gentle color transitions" },
  { value: "minimal", label: "◽ Minimal / Clean", descriptor: "A minimal, clean composition with lots of negative space and a restrained palette" },
];
const FIREBASE_FUNCTIONS_BASE_URL =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "/firebase-api"
    : "https://us-central1-igletechv1.cloudfunctions.net";

const EasyProjector = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [broadcastId, setBroadcastId] = useState(null);
  const [broadcast, setBroadcast] = useState(null);
  const [songs, setSongs] = useState([]);
  const [backgroundColor, setBackgroundColor] = useState("#000000");
  const [error, setError] = useState(null);
  const [showAddSongModal, setShowAddSongModal] = useState(false);
  const [showEditSongModal, setShowEditSongModal] = useState(false);
  const [editingSong, setEditingSong] = useState(null);
  const [songForm, setSongForm] = useState({
    title: "",
    lyrics: [""],
  });
  const [audioStream, setAudioStream] = useState(null);
  const [fontSize, setFontSize] = useState("48");
  const [fontColor, setFontColor] = useState("#FFFFFF");
  const peerConnectionRef = useRef(null);
  const lastViewerCandidateRef = useRef(null);
  const pendingViewerCandidateRef = useRef(null);
  const [updatingSong, setUpdatingSong] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [bibleVersion, setBibleVersion] = useState("NIV");
  const [bibleVerseInput, setBibleVerseInput] = useState("");
  const [loadingVerse, setLoadingVerse] = useState(false);
  const [fontFamily, setFontFamily] = useState("Arial");
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [textShadow, setTextShadow] = useState("none");
  const [backgroundType, setBackgroundType] = useState("solid");
  const [gradientColors, setGradientColors] = useState(["#000000", "#000000"]);
  const [gradientAngle, setGradientAngle] = useState(45);
  const [textBlur, setTextBlur] = useState(0);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [isUpperCase, setIsUpperCase] = useState(false);
  const [videoFile, setVideoFile] = useState(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState("");
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const videoControlRef = useRef(null);
  const videoSyncWriteRef = useRef(0);

  const [activeTab, setActiveTab] = useState("live");
  const [playlists, setPlaylists] = useState([]);
  const [activePlaylistId, setActivePlaylistId] = useState("");
  const [playlistItems, setPlaylistItems] = useState([]);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [savingPlaylistItem, setSavingPlaylistItem] = useState(false);
  const [isRenamingPlaylist, setIsRenamingPlaylist] = useState(false);
  const [playlistRenameDraft, setPlaylistRenameDraft] = useState("");
  const [aiStyle, setAiStyle] = useState("photo");
  const [aiCandidates, setAiCandidates] = useState([]);
  const [mediaItems, setMediaItems] = useState([]);
  const [mediaCategory, setMediaCategory] = useState("Worship");
  const [mediaFilter, setMediaFilter] = useState("all");
  const [storedCategories, setStoredCategories] = useState(DEFAULT_MEDIA_CATEGORIES);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [editingCategory, setEditingCategory] = useState("");
  const [categoryRenameDraft, setCategoryRenameDraft] = useState("");
  const [showDesignSaveForm, setShowDesignSaveForm] = useState(false);
  const [designSaveName, setDesignSaveName] = useState("");
  const [designSavePlaylistId, setDesignSavePlaylistId] = useState("");
  const [addItemType, setAddItemType] = useState("song");
  const [addSongId, setAddSongId] = useState("");
  const [addMediaId, setAddMediaId] = useState("");
  const [addVerseRef, setAddVerseRef] = useState("");
  const [addingPlaylistItem, setAddingPlaylistItem] = useState(false);
  const [versePlaylistId, setVersePlaylistId] = useState("");
  const [backgroundBlur, setBackgroundBlur] = useState(0);
  const [translationEnabled, setTranslationEnabled] = useState(false);
  const [speechLanguage, setSpeechLanguage] = useState("es-ES");
  const [targetLanguages, setTargetLanguages] = useState(["en"]);
  const [defaultLanguage, setDefaultLanguage] = useState("en");
  const [languageSearch, setLanguageSearch] = useState("");
  const [lastCaption, setLastCaption] = useState("");
  const [translationStatus, setTranslationStatus] = useState("");
  const recognitionRef = useRef(null);
  const translationQueueRef = useRef(Promise.resolve());
  const appliedAnswerRef = useRef("");
  const lastInterimWriteRef = useRef(0);
  const lastInterimTranslateRef = useRef(0);
  const interimTranslateBusyRef = useRef(false);
  const lastFinalPhraseRef = useRef("");
  const [micLevel, setMicLevel] = useState(0);
  const [shortLinkCode, setShortLinkCode] = useState("");
  const [creatingShortLink, setCreatingShortLink] = useState(false);
  const shortLinkRequestedRef = useRef("");
  const addItemLockRef = useRef(false);

  const [propImages, setPropImages] = useState([]);
  const [uploadingProps, setUploadingProps] = useState(false);
  const [propSize, setPropSize] = useState(30);
  const [propColor, setPropColor] = useState("#ffffff");

  const [previewSettings, setPreviewSettings] = useState({
    fontFamily: "Arial",
    fontSize: "48",
    fontColor: "#FFFFFF",
    isBold: false,
    isItalic: false,
    isUpperCase: false,
    textShadow: "none",
    textBlur: 0,
    backgroundColor: "#1e3a8a",
    backgroundType: "solid",
    gradientColors: ["#1e3a8a", "#3b82f6"],
    gradientAngle: 45,
  });

  const [liveSettings, setLiveSettings] = useState({
    fontFamily: "Arial",
    fontSize: "48",
    fontColor: "#FFFFFF",
    isBold: false,
    isItalic: false,
    isUpperCase: false,
    textShadow: "none",
    textBlur: 0,
    backgroundColor: "#1e3a8a",
    backgroundType: "solid",
    gradientColors: ["#1e3a8a", "#3b82f6"],
    gradientAngle: 45,
  });

  const [openSections, setOpenSections] = useState({
    preview: true,
    displaySettings: false,
    microphone: false,
    songs: false,
    bibleVerses: false,
  });

  const toggleSection = (section) => {
    setOpenSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const BIBLE_VERSIONS = [
    { value: "NIV", label: "New International Version" },
    { value: "KJV", label: "King James Version" },
    { value: "ESV", label: "English Standard Version" },
    { value: "NLT", label: "New Living Translation" },
    { value: "RVR1960", label: "Reina-Valera 1960" },
    { value: "NVI", label: "Nueva Versión Internacional" },
    { value: "LBLA", label: "La Biblia de las Américas" },
    { value: "DHH", label: "Dios Habla Hoy" },
  ];

  const FONT_FAMILIES = [
    { value: "Arial", label: "Arial" },
    { value: "Times New Roman", label: "Times New Roman" },
    { value: "Helvetica", label: "Helvetica" },
    { value: "Georgia", label: "Georgia" },
    { value: "Verdana", label: "Verdana" },
    { value: "Roboto", label: "Roboto" },
    { value: "Open Sans", label: "Open Sans" },
    { value: "Playfair Display", label: "Playfair Display" },
    { value: "Montserrat", label: "Montserrat" },
    { value: "Lato", label: "Lato" },
  ];

  const buttonClasses =
    "px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors";
  const smallButtonClasses =
    "p-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors";
  const dangerButtonClasses =
    "px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors";

  const Section = ({ title, isOpen, onToggle, children }) => (
    <div
      style={{
        marginBottom: "20px",
        border: "2px solid #e7e7e7",
        borderRadius: "8px",
        overflow: "hidden",
      }}
    >
      <div
        onClick={onToggle}
        style={{
          padding: "15px",
          backgroundColor: "#f8f9fa",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        <h3 style={{ ...commonStyles.title, margin: 0 }}>{title}</h3>
        <span
          style={{
            transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.3s ease",
          }}
        >
          ▼
        </span>
      </div>
      <div
        style={{
          padding: isOpen ? "15px" : "0",
          maxHeight: isOpen ? "2000px" : "0",
          overflow: "hidden",
          transition: "all 0.3s ease-in-out",
        }}
      >
        {isOpen && children}
      </div>
    </div>
  );

  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renamingBroadcast, setRenamingBroadcast] = useState(null);
  const [newName, setNewName] = useState("");

  const handleRename = async () => {
    if (!newName.trim() || !renamingBroadcast) {
      toast.error("Please enter a name for the broadcast");
      return;
    }

    try {
      const broadcastRef = doc(
        db,
        `churches/${id}/broadcasts`,
        renamingBroadcast.id
      );
      await updateDoc(broadcastRef, {
        name: newName.trim(),
        updatedAt: new Date(),
      });
      setShowRenameModal(false);
      setRenamingBroadcast(null);
      setNewName("");
      toast.success("Screen renamed successfully!");
    } catch (err) {
      console.error("Error renaming broadcast:", err);
      toast.error("Failed to rename broadcast");
    }
  };

  const [broadcastSettings, setBroadcastSettings] = useState({
    fontFamily: "Arial",
    fontSize: "48",
    fontColor: "#FFFFFF",
    isBold: false,
    isItalic: false,
    isUpperCase: false,
    textShadow: "none",
    textBlur: 0,
    backgroundColor: "#1e3a8a",
    backgroundType: "solid",
    gradientColors: ["#1e3a8a", "#3b82f6"],
    gradientAngle: 45,
  });

  useEffect(() => {
    const setupBroadcast = async () => {
      if (!id) return;

      try {
        const broadcastsRef = collection(db, `churches/${id}/broadcasts`);
        const broadcastsSnap = await getDocs(broadcastsRef);

        let existingBroadcast = broadcastsSnap.docs[0];
        let broadcastDocRef;

        if (existingBroadcast) {
          broadcastDocRef = existingBroadcast.ref;
          setBroadcastId(existingBroadcast.id);
          setBroadcast(existingBroadcast.data());
        } else {
          const broadcastData = {
            backgroundColor: "#000000",
            backgroundType: "solid",
            backgroundUrl: null,
            micEnabled: false,
            songId: null,
            currentLyricIndex: 0,
            fontSize: "48",
            fontColor: "#FFFFFF",
            fontFamily: "Arial",
            isBold: false,
            isItalic: false,
            isUpperCase: false,
            textShadow: "none",
            gradientColors: ["#000000", "#000000"],
            gradientAngle: 45,
            textBlur: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          const newBroadcastDoc = await addDoc(broadcastsRef, broadcastData);
          broadcastDocRef = newBroadcastDoc;
          setBroadcastId(newBroadcastDoc.id);
          setBroadcast(broadcastData);
        }

        const unsubscribe = onSnapshot(broadcastDocRef, (doc) => {
          if (doc.exists()) {
            const data = doc.data();
            setBroadcast(data);
            setBackgroundColor(data.backgroundColor || "#000000");
            setFontColor(data.fontColor || "#FFFFFF");
            setFontSize(data.fontSize || "48");
          }
        });

        const songsRef = collection(db, `churches/${id}/songs`);
        const songsSnap = await getDocs(songsRef);
        const songsData = songsSnap.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setSongs(songsData);

        setLoading(false);

        return () => unsubscribe();
      } catch (err) {
        console.error("Setup error:", err);
        setError(err.message);
        setLoading(false);
      }
    };

    setupBroadcast();
  }, [id]);

  useEffect(() => {
    if (!id || !broadcastId) return;

    const unsubscribe = onSnapshot(
      doc(db, `churches/${id}/broadcasts`, broadcastId),
      (doc) => {
        if (doc.exists()) {
          const data = doc.data();

          const settings = {
            fontFamily: data.fontFamily || "Arial",
            fontSize: data.fontSize || "48",
            fontColor: data.fontColor || "#FFFFFF",
            isBold: data.isBold || false,
            isItalic: data.isItalic || false,
            isUpperCase: data.isUpperCase || false,
            textShadow: data.textShadow || "none",
            textBlur: data.textBlur || 0,
            backgroundColor: data.backgroundColor || "#000000",
            backgroundType: data.backgroundType || "solid",
            gradientColors: data.gradientColors || ["#000000", "#000000"],
            gradientAngle: data.gradientAngle || 45,
          };

          setPreviewSettings(settings);
          setLiveSettings(settings);
          setBroadcastSettings(settings);
        }
      }
    );

    return () => unsubscribe();
  }, [id, broadcastId]);

  useEffect(() => {
    if (broadcast) {
      const settings = {
        fontFamily: broadcast.fontFamily || "Arial",
        fontSize: broadcast.fontSize || "48",
        fontColor: broadcast.fontColor || "#FFFFFF",
        isBold: broadcast.isBold || false,
        isItalic: broadcast.isItalic || false,
        isUpperCase: broadcast.isUpperCase || false,
        textShadow: broadcast.textShadow || "none",
        textBlur: broadcast.textBlur || 0,
        backgroundColor: broadcast.backgroundColor || "#000000",
        backgroundType: broadcast.backgroundType || "solid",
        gradientColors: broadcast.gradientColors || ["#000000", "#000000"],
        gradientAngle: broadcast.gradientAngle || 45,
      };
      setPreviewSettings(settings);
      setLiveSettings(settings);
    }
  }, [broadcast]);

  useEffect(() => {
    if (broadcast) {
      const initialSettings = {
        fontFamily: broadcast.fontFamily || "Arial",
        fontSize: broadcast.fontSize || "48",
        fontColor: broadcast.fontColor || "#FFFFFF",
        isBold: broadcast.isBold || false,
        isItalic: broadcast.isItalic || false,
        isUpperCase: broadcast.isUpperCase || false,
        textShadow: broadcast.textShadow || "none",
        textBlur: broadcast.textBlur || 0,
        backgroundColor: broadcast.backgroundColor || "#000000",
        backgroundType: broadcast.backgroundType || "solid",
        gradientColors: broadcast.gradientColors || ["#000000", "#000000"],
        gradientAngle: broadcast.gradientAngle || 45,
      };

      setPreviewSettings(initialSettings);
      setLiveSettings(initialSettings);
    }
  }, [broadcast]);

  const handleSongSelect = async (songId) => {
    if (!broadcastId) return;

    try {
      const selectedSong = songs.find((s) => s.id === songId);
      if (!selectedSong) return;

      const formattedLyrics = selectedSong.lyrics.map((lyric) =>
        typeof lyric === "string" ? lyric : lyric.text || ""
      );

      await updateDoc(doc(db, `churches/${id}/broadcasts`, broadcastId), {
        songId,
        currentLyricIndex: 0,
        bibleVerse: null,
        videoUrl: "",
        videoName: "",
        lyrics: formattedLyrics,
        updatedAt: new Date(),
      });
    } catch (err) {
      console.error("Error selecting song:", err);
      toast.error("Failed to select song");
    }
  };

  const handleIncomingAnswer = async (answer) => {
    try {
      const pc = peerConnectionRef.current;
      if (!pc || !answer?.sdp) return;

      // Every broadcast document write re-delivers the same answer; only apply it once,
      // and only while the connection is still waiting for one.
      if (appliedAnswerRef.current === answer.sdp) return;
      if (pc.signalingState !== "have-local-offer") return;

      appliedAnswerRef.current = answer.sdp;
      await pc.setRemoteDescription(new RTCSessionDescription(answer));

      if (pendingViewerCandidateRef.current) {
        try {
          await pc.addIceCandidate(
            new RTCIceCandidate(pendingViewerCandidateRef.current)
          );
          pendingViewerCandidateRef.current = null;
        } catch (candidateErr) {
          console.error("Error adding pending ICE candidate:", candidateErr);
        }
      }
    } catch (err) {
      console.error("Error handling answer:", err);
    }
  };

  // Measures the outgoing mic stream so the operator can confirm audio is actually leaving.
  useEffect(() => {
    if (!audioStream) {
      setMicLevel(0);
      return undefined;
    }

    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return undefined;

    const audioContext = new AudioContextCtor();
    const source = audioContext.createMediaStreamSource(audioStream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);

    const samples = new Uint8Array(analyser.frequencyBinCount);
    let animationFrame = null;
    let lastPaintedAt = 0;

    const measure = (timestamp) => {
      animationFrame = requestAnimationFrame(measure);
      if (timestamp - lastPaintedAt < 60) return;
      lastPaintedAt = timestamp;

      analyser.getByteTimeDomainData(samples);
      let sumOfSquares = 0;
      for (let index = 0; index < samples.length; index += 1) {
        const deviation = (samples[index] - 128) / 128;
        sumOfSquares += deviation * deviation;
      }
      const rms = Math.sqrt(sumOfSquares / samples.length);
      setMicLevel(Math.min(100, Math.round(rms * 320)));
    };

    animationFrame = requestAnimationFrame(measure);

    return () => {
      if (animationFrame) cancelAnimationFrame(animationFrame);
      source.disconnect();
      audioContext.close().catch(() => {});
      setMicLevel(0);
    };
  }, [audioStream]);

  const toggleMicrophone = async () => {
    if (!broadcastId) return;

    try {
      const newMicState = !broadcast?.micEnabled;

      if (newMicState) {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });

        const pc = new RTCPeerConnection({
          iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun1.l.google.com:19302" },
          ],
        });
        peerConnectionRef.current = pc;

        stream.getTracks().forEach((track) => {
          pc.addTrack(track, stream);
        });

        pc.onicecandidate = (event) => {
          if (event.candidate) {
            updateDoc(doc(db, `churches/${id}/broadcasts`, broadcastId), {
              iceCandidate: event.candidate.toJSON(),
            });
          }
        };

        pc.onconnectionstatechange = () => {
          console.log("Connection state:", pc.connectionState);
          if (pc.connectionState === "failed") {
            toast.error("Audio connection failed. Please try reconnecting.");
          }
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        await updateDoc(doc(db, `churches/${id}/broadcasts`, broadcastId), {
          micEnabled: true,
          offer: {
            type: offer.type,
            sdp: offer.sdp,
          },
        });

        setAudioStream(stream);
        toast.success("Microphone enabled");

        const unsubAnswer = onSnapshot(
          doc(db, `churches/${id}/broadcasts`, broadcastId),
          (doc) => {
            const data = doc.data();
            if (data?.answer && pc.currentRemoteDescription === null) {
              handleIncomingAnswer(data.answer);
            }

            if (data?.viewerIceCandidate) {
              const nextCandidate = JSON.stringify(data.viewerIceCandidate);
              if (lastViewerCandidateRef.current !== nextCandidate) {
                lastViewerCandidateRef.current = nextCandidate;
                if (pc.currentRemoteDescription) {
                  pc.addIceCandidate(new RTCIceCandidate(data.viewerIceCandidate)).catch(
                    (err) => {
                      console.error("Error adding viewer ICE candidate:", err);
                    }
                  );
                } else {
                  pendingViewerCandidateRef.current = data.viewerIceCandidate;
                }
              }
            }
          }
        );

        pc.unsubAnswer = unsubAnswer;
      } else {
        if (audioStream) {
          audioStream.getTracks().forEach((track) => track.stop());
          setAudioStream(null);
        }

        if (peerConnectionRef.current) {
          if (peerConnectionRef.current.unsubAnswer) {
            peerConnectionRef.current.unsubAnswer();
          }
          peerConnectionRef.current.close();
          peerConnectionRef.current = null;
        }

        await updateDoc(doc(db, `churches/${id}/broadcasts`, broadcastId), {
          micEnabled: false,
          offer: null,
          answer: null,
          iceCandidate: null,
          viewerIceCandidate: null,
        });

        toast.success("Microphone disabled");
      }
    } catch (err) {
      console.error("Error toggling microphone:", err);
      toast.error("Failed to toggle microphone: " + err.message);
    }
  };

  const fetchSongLyrics = async (songTitle) => {
    try {
      const apiKey = process.env.REACT_APP_OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error("OpenAI API key not configured");
      }

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-3.5-turbo",
          messages: [
            {
              role: "user",
              content: `Please provide the lyrics for the song "${songTitle}" formatted as an array of verses. Each verse should be a complete stanza. Return only the array of verses, no extra text. Format it like this example:
            [
              "Amazing grace, how sweet the sound\\nThat saved a wretch like me\\nI once was lost, but now am found\\nWas blind but now I see",
              "T'was grace that taught my heart to fear\\nAnd grace my fears relieved\\nHow precious did that grace appear\\nThe hour I first believed"
            ]"`,
            },
          ],
          temperature: 0.3,
          max_tokens: 1000,
        }),
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
      }

      const data = await response.json();
      if (!data.choices || !data.choices[0]?.message?.content) {
        throw new Error("Invalid response format from API");
      }

      try {
        const lyricsArray = JSON.parse(data.choices[0].message.content);
        if (Array.isArray(lyricsArray)) {
          return lyricsArray;
        }
      } catch (e) {
        console.error("Error parsing lyrics:", e);
      }

      return data.choices[0].message.content
        .split(/\n\n+/)
        .map((verse) => verse.trim())
        .filter((verse) => verse);
    } catch (err) {
      console.error("Error fetching lyrics:", err);
      return null;
    }
  };

  const handleAddSong = async (e) => {
    e.preventDefault();

    if (!songForm.lyrics[0] || songForm.lyrics.every((lyric) => !lyric.trim())) {
      setUpdatingSong(true);
      try {
        const fetchedLyrics = await fetchSongLyrics(songForm.title);

        if (fetchedLyrics && fetchedLyrics.length > 0) {
          const useAILyrics = window.confirm(
            "Lyrics found! Would you like to use these lyrics?\n\nFirst verse preview:\n" +
              fetchedLyrics[0]
          );

          if (useAILyrics) {
            setSongForm((prev) => ({
              ...prev,
              lyrics: fetchedLyrics,
            }));
            toast.success("Lyrics imported successfully!");
            setUpdatingSong(false);
            return;
          }
        }
      } catch (err) {
        console.error("Error fetching lyrics:", err);
      } finally {
        setUpdatingSong(false);
      }
    }

    setUpdatingSong(true);
    try {
      const songData = {
        title: songForm.title,
        lyrics: songForm.lyrics.filter((lyric) => lyric.trim() !== ""),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const songRef = collection(db, `churches/${id}/songs`);
      await addDoc(songRef, songData);

      const songsSnap = await getDocs(songRef);
      const songsData = songsSnap.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      setSongs(songsData);

      setShowAddSongModal(false);
      setSongForm({ title: "", lyrics: [""] });
      toast.success("Song added successfully");
    } catch (err) {
      console.error("Error adding song:", err);
      toast.error("Failed to add song");
    } finally {
      setUpdatingSong(false);
    }
  };

  const handleEditSong = async (e) => {
    setUpdatingSong(true);
    e.preventDefault();
    try {
      const songData = {
        title: songForm.title,
        lyrics: songForm.lyrics
          .filter((lyric) => lyric.trim() !== "")
          .map((lyric) => ({ text: lyric })),
        updatedAt: new Date(),
      };

      await updateDoc(
        doc(db, `churches/${id}/songs`, editingSong.id),
        songData
      );

      const songsRef = collection(db, `churches/${id}/songs`);
      const songsSnap = await getDocs(songsRef);
      const songsData = songsSnap.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      setSongs(songsData);

      setShowEditSongModal(false);
      setEditingSong(null);
      setSongForm({ title: "", lyrics: [""] });
      toast.success("Song updated successfully");
    } catch (err) {
      console.error("Error updating song:", err);
      toast.error("Failed to update song");
    } finally {
      setUpdatingSong(false);
    }
  };

  const handleDeleteSong = async (songId) => {
    if (!window.confirm("Are you sure you want to delete this song?")) return;

    try {
      await deleteDoc(doc(db, `churches/${id}/songs`, songId));
      setSongs(songs.filter((song) => song.id !== songId));
      toast.success("Song deleted successfully");
    } catch (err) {
      console.error("Error deleting song:", err);
      toast.error("Failed to delete song");
    }
  };

  const handleLyricNavigation = async (direction) => {
    if (!broadcast?.songId || !broadcastId) return;

    try {
      const currentSong = songs.find((s) => s.id === broadcast.songId);
      if (!currentSong) return;

      const maxIndex = currentSong.lyrics.length - 1;
      const currentIndex = broadcast.currentLyricIndex || 0;
      const newIndex =
        direction === "next"
          ? currentIndex < maxIndex
            ? currentIndex + 1
            : 0
          : currentIndex > 0
          ? currentIndex - 1
          : maxIndex;

      const broadcastRef = doc(db, `churches/${id}/broadcasts`, broadcastId);
      await updateDoc(broadcastRef, {
        currentLyricIndex: newIndex,
        updatedAt: new Date(),
      });

      console.log("Updated verse to:", newIndex);
    } catch (err) {
      console.error("Error updating verse:", err);
      toast.error("Failed to change verse");
    }
  };

  useEffect(() => {
    if (showEditSongModal) {
      document.body.classList.add("modal-open");
    } else {
      document.body.classList.remove("modal-open");
    }

    return () => {
      document.body.classList.remove("modal-open");
    };
  }, [showEditSongModal]);

  const handleCloseModal = () => {
    setShowEditSongModal(false);
    setEditingSong(null);
    setSongForm({ title: "", lyrics: [""] });
  };

  const handleModalClick = (e) => {
    if (e.target.classList.contains("edit-song-overlay")) {
      handleCloseModal();
    }
  };

  const filteredSongs = songs.filter((song) =>
    song.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const fetchVerseText = async (reference, version) => {
    const response = await fetch(`${FIREBASE_FUNCTIONS_BASE_URL}/generateTimeRotateInvoiceReview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: GEMINI_TEXT_MODEL,
        prompt: `Return only the text of this Bible verse: ${reference} in ${version} version. Format: Just the verse text, no reference, no quotation marks, no commentary. If it's a Spanish version (RVR1960, NVI, DHH, or TLA), return the text in Spanish.`,
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error("Gemini Error Response:", errorData);
      throw new Error(`Bible verse request failed: ${response.status}`);
    }

    const data = await response.json();
    const verseText = String(data?.text || "").trim();
    if (!verseText) throw new Error("Gemini returned no text for this reference");

    return verseText;
  };

  const fetchBibleVerse = async (reference) => {
    setLoadingVerse(true);
    try {
      const verseText = await fetchVerseText(reference, bibleVersion);

      await updateDoc(doc(db, `churches/${id}/broadcasts`, broadcastId), {
        bibleVerse: {
          reference,
          version: bibleVersion,
          text: verseText,
        },
        songId: null,
        videoUrl: "",
        videoName: "",
        currentLyricIndex: 0,
        updatedAt: new Date(),
      });

      toast.success("Bible verse updated");
    } catch (err) {
      console.error("Error fetching Bible verse:", err);
      toast.error(err.message || "Failed to fetch Bible verse");
    } finally {
      setLoadingVerse(false);
    }
  };

  const playlistsRef = useMemo(
    () => (id ? collection(db, `churches/${id}/projectorPlaylists`) : null),
    [id]
  );

  useEffect(() => {
    if (!playlistsRef) return undefined;

    return onSnapshot(
      playlistsRef,
      (snapshot) => {
        const loaded = snapshot.docs
          .map((playlistDoc) => ({ id: playlistDoc.id, ...playlistDoc.data() }))
          .sort((left, right) => String(left.name || "").localeCompare(String(right.name || "")));
        setPlaylists(loaded);
        setActivePlaylistId((previous) =>
          previous && loaded.some((item) => item.id === previous) ? previous : loaded[0]?.id || ""
        );
      },
      (err) => console.error("Failed to load playlists:", err)
    );
  }, [playlistsRef]);

  useEffect(() => {
    if (!id || !activePlaylistId) {
      setPlaylistItems([]);
      return undefined;
    }

    return onSnapshot(
      query(collection(db, `churches/${id}/projectorPlaylists/${activePlaylistId}/items`), orderBy("order")),
      (snapshot) => setPlaylistItems(snapshot.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() }))),
      (err) => console.error("Failed to load playlist items:", err)
    );
  }, [id, activePlaylistId]);

  const handleCreatePlaylist = async () => {
    const name = newPlaylistName.trim();
    if (!name) {
      toast.warning("Enter a playlist name.");
      return;
    }

    try {
      const created = await addDoc(playlistsRef, {
        name,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      setNewPlaylistName("");
      setActivePlaylistId(created.id);
      toast.success("Playlist created.");
    } catch (err) {
      console.error("Error creating playlist:", err);
      toast.error("Could not create the playlist.");
    }
  };

  const handleRenamePlaylist = async () => {
    const name = playlistRenameDraft.trim();
    if (!name) {
      toast.warning("Enter a playlist name.");
      return;
    }

    try {
      await updateDoc(doc(db, `churches/${id}/projectorPlaylists`, activePlaylistId), {
        name,
        updatedAt: new Date(),
      });
      setIsRenamingPlaylist(false);
      toast.success("Playlist renamed.");
    } catch (err) {
      console.error("Error renaming playlist:", err);
      toast.error("Could not rename the playlist.");
    }
  };

  const handleDeletePlaylist = async () => {    if (!activePlaylistId) return;
    if (!window.confirm("Delete this playlist and everything in it?")) return;

    try {
      const itemsSnap = await getDocs(
        collection(db, `churches/${id}/projectorPlaylists/${activePlaylistId}/items`)
      );
      const batch = writeBatch(db);
      itemsSnap.docs.forEach((itemDoc) => batch.delete(itemDoc.ref));
      batch.delete(doc(db, `churches/${id}/projectorPlaylists`, activePlaylistId));
      await batch.commit();
      toast.success("Playlist deleted.");
    } catch (err) {
      console.error("Error deleting playlist:", err);
      toast.error("Could not delete the playlist.");
    }
  };

  const addItemToPlaylist = async (item, targetPlaylistId) => {
    const playlistId = targetPlaylistId || activePlaylistId;
    if (!playlistId) {
      toast.warning("Create or select a playlist first.");
      return;
    }

    // A second click while the first write is still in flight would otherwise add the item twice.
    if (addItemLockRef.current) return;
    addItemLockRef.current = true;

    try {
      const itemsPath = `churches/${id}/projectorPlaylists/${playlistId}/items`;
      // Read the target playlist directly so items can be added to a playlist that isn't open.
      const existingSnap = await getDocs(collection(db, itemsPath));

      const isSameItem = (existing) => {
        if (existing.type !== item.type) return false;
        if (item.type === "song") return existing.songId === item.songId;
        if (item.type === "verse") {
          return existing.reference === item.reference && existing.version === item.version;
        }
        if (item.type === "media") return existing.url === item.url;
        if (item.type === "video") return existing.url === item.url;
        if (item.type === "prop") return existing.url === item.url;
        return false;
      };

      if (existingSnap.docs.some((entry) => isSameItem(entry.data() || {}))) {
        toast.info("That item is already in this playlist.");
        return;
      }

      const nextOrder = existingSnap.empty
        ? 0
        : Math.max(...existingSnap.docs.map((entry) => Number(entry.data()?.order) || 0)) + 1;
      await addDoc(collection(db, itemsPath), {
        ...item,
        order: nextOrder,
        createdAt: new Date(),
      });
      toast.success("Added to playlist.");
    } catch (err) {
      console.error("Error adding playlist item:", err);
      toast.error("Could not add to the playlist.");
    } finally {
      addItemLockRef.current = false;
    }
  };

  const handleAddVerseToPlaylist = async () => {
    const reference = bibleVerseInput.trim();
    if (!reference) {
      toast.warning("Enter a verse reference first.");
      return;
    }

    setSavingPlaylistItem(true);
    try {
      const text = await fetchVerseText(reference, bibleVersion);
      await addItemToPlaylist(
        { type: "verse", reference, version: bibleVersion, text, title: reference },
        versePlaylistId || activePlaylistId
      );
    } catch (err) {
      console.error("Error saving verse to playlist:", err);
      toast.error(err.message || "Could not save the verse.");
    } finally {
      setSavingPlaylistItem(false);
    }
  };

  useEffect(() => {
    if (!id) return undefined;

    return onSnapshot(
      query(collection(db, `churches/${id}/projectorMedia`), orderBy("createdAt", "desc")),
      (snapshot) => setMediaItems(snapshot.docs.map((mediaDoc) => ({ id: mediaDoc.id, ...mediaDoc.data() }))),
      (err) => console.error("Failed to load projector media:", err)
    );
  }, [id]);

  const mediaCategories = useMemo(() => {
    const used = mediaItems.map((item) => String(item.category || "Uncategorized"));
    return Array.from(new Set([...storedCategories, ...used])).sort();
  }, [mediaItems, storedCategories]);

  const mediaCategorySettingsRef = useMemo(
    () => (id ? doc(db, `churches/${id}/settings`, "projectorMedia") : null),
    [id]
  );

  useEffect(() => {
    if (!mediaCategorySettingsRef) return undefined;

    return onSnapshot(
      mediaCategorySettingsRef,
      (snapshot) => {
        const saved = snapshot.data()?.categories;
        setStoredCategories(Array.isArray(saved) && saved.length ? saved : DEFAULT_MEDIA_CATEGORIES);
      },
      (err) => console.error("Failed to load media categories:", err)
    );
  }, [mediaCategorySettingsRef]);

  const persistCategories = async (values) => {
    await setDoc(mediaCategorySettingsRef, { categories: values, updatedAt: new Date() }, { merge: true });
  };

  const handleAddCategory = async () => {
    const name = newCategoryName.trim();
    if (!name) {
      toast.warning("Enter a category name.");
      return;
    }
    if (mediaCategories.some((category) => category.toLowerCase() === name.toLowerCase())) {
      toast.info("That category already exists.");
      return;
    }

    try {
      await persistCategories([...storedCategories, name]);
      setNewCategoryName("");
      toast.success("Category added.");
    } catch (err) {
      console.error("Error adding category:", err);
      toast.error("Could not add the category.");
    }
  };

  const handleRenameCategory = async () => {
    const name = categoryRenameDraft.trim();
    if (!name) {
      toast.warning("Enter a category name.");
      return;
    }

    try {
      const nextValues = Array.from(
        new Set(storedCategories.map((category) => (category === editingCategory ? name : category)))
      );
      await persistCategories(nextValues);

      const affected = mediaItems.filter((item) => (item.category || "Uncategorized") === editingCategory);
      if (affected.length) {
        const batch = writeBatch(db);
        affected.forEach((item) =>
          batch.update(doc(db, `churches/${id}/projectorMedia`, item.id), { category: name })
        );
        await batch.commit();
      }

      if (mediaFilter === editingCategory) setMediaFilter(name);
      if (mediaCategory === editingCategory) setMediaCategory(name);
      setEditingCategory("");
      toast.success("Category renamed.");
    } catch (err) {
      console.error("Error renaming category:", err);
      toast.error("Could not rename the category.");
    }
  };

  const handleDeleteCategory = async (category) => {
    const affected = mediaItems.filter((item) => (item.category || "Uncategorized") === category);
    const message = affected.length
      ? `Delete "${category}"? ${affected.length} image(s) will move to Uncategorized.`
      : `Delete "${category}"?`;
    if (!window.confirm(message)) return;

    try {
      await persistCategories(storedCategories.filter((entry) => entry !== category));

      if (affected.length) {
        const batch = writeBatch(db);
        affected.forEach((item) =>
          batch.update(doc(db, `churches/${id}/projectorMedia`, item.id), { category: "Uncategorized" })
        );
        await batch.commit();
      }

      if (mediaFilter === category) setMediaFilter("all");
      if (mediaCategory === category) setMediaCategory("Uncategorized");
      toast.success("Category deleted.");
    } catch (err) {
      console.error("Error deleting category:", err);
      toast.error("Could not delete the category.");
    }
  };

  const visibleMediaItems = useMemo(
    () => (mediaFilter === "all" ? mediaItems : mediaItems.filter((item) => (item.category || "Uncategorized") === mediaFilter)),
    [mediaItems, mediaFilter]
  );

  const handleUseMediaAsBackground = (item) => {
    if (item.type === "video") {
      updateDoc(doc(db, `churches/${id}/broadcasts`, broadcastId), {
        videoUrl: item.url,
        videoName: item.prompt || "",
        videoCurrentTime: 0,
        videoPaused: false,
        videoControlAt: Date.now(),
        songId: null,
        bibleVerse: null,
        updatedAt: new Date(),
      }).then(() => toast.success("Video pushed live.")).catch(() => toast.error("Could not push video live."));
      return;
    }

    setPreviewSettings((prev) => ({
      ...prev,
      backgroundType: "image",
      backgroundColor: item.url,
    }));
    setActiveTab("design");
    toast.success("Loaded into Design. Press Apply Changes to go live.");
  };

  const handleChangeMediaCategory = async (item, category) => {
    try {
      await updateDoc(doc(db, `churches/${id}/projectorMedia`, item.id), { category });
    } catch (err) {
      console.error("Error updating media category:", err);
      toast.error("Could not update the category.");
    }
  };

  const handleDeleteMedia = async (item) => {
    if (!window.confirm("Delete this image from your media library?")) return;

    try {
      await deleteDoc(doc(db, `churches/${id}/projectorMedia`, item.id));
      if (item.storagePath) {
        await deleteObject(ref(storage, item.storagePath)).catch(() => {});
      }
      toast.success("Image deleted.");
    } catch (err) {
      console.error("Error deleting media:", err);
      toast.error("Could not delete the image.");
    }
  };

  const handleSaveCurrentToMedia = async () => {
    const imageUrl = previewSettings.backgroundColor;
    const isImageBackground =
      (previewSettings.backgroundType === "ai" || previewSettings.backgroundType === "image")
      && String(imageUrl || "").startsWith("http");

    if (!isImageBackground) {
      toast.warning("Generate or upload an image background first.");
      return;
    }

    if (mediaItems.some((item) => item.url === imageUrl)) {
      toast.info("This image is already in your media library.");
      return;
    }

    try {
      const promptValue = document.getElementById("aiPrompt")?.value || "";
      const matchingCandidate = aiCandidates.find((candidate) => candidate.url === imageUrl);
      await addDoc(collection(db, `churches/${id}/projectorMedia`), {
        url: imageUrl,
        storagePath: matchingCandidate?.storagePath || "",
        category: mediaCategory || "Uncategorized",
        prompt: promptValue.trim() || "Saved from Design",
        style: "",
        createdAt: new Date(),
        createdByUid: auth.currentUser?.uid || "",
      });
      toast.success(`Saved to Media (${mediaCategory || "Uncategorized"}).`);
    } catch (err) {
      console.error("Error saving to media:", err);
      toast.error("Could not save to media.");
    }
  };

  const saveCandidateToMedia = async (candidate) => {
    if (!candidate?.url) return;
    if (mediaItems.some((item) => item.url === candidate.url)) {
      toast.info("This image is already in your media library.");
      return;
    }

    try {
      const promptValue = document.getElementById("aiPrompt")?.value || "";
      await addDoc(collection(db, `churches/${id}/projectorMedia`), {
        url: candidate.url,
        storagePath: candidate.storagePath || "",
        category: mediaCategory || "Uncategorized",
        prompt: promptValue.trim() || "Saved from Design",
        style: aiStyle,
        createdAt: new Date(),
        createdByUid: auth.currentUser?.uid || "",
      });
      toast.success(`Option saved to Media (${mediaCategory || "Uncategorized"}).`);
    } catch (err) {
      console.error("Error saving generated option to media:", err);
      toast.error("Could not save this option to Media.");
    }
  };

  const pushCandidateLive = async (candidate) => {
    if (!candidate?.url || !broadcastId) return;

    const nextSettings = { ...previewSettings, backgroundType: "image", backgroundColor: candidate.url };
    try {
      await updateDoc(doc(db, `churches/${id}/broadcasts`, broadcastId), {
        ...nextSettings,
        backgroundBlur,
        videoUrl: "",
        videoName: "",
        updatedAt: new Date(),
      });
      setPreviewSettings(nextSettings);
      setLiveSettings(nextSettings);
      toast.success("Selected image pushed live.");
    } catch (err) {
      console.error("Error pushing generated option live:", err);
      toast.error("Could not push this option live.");
    }
  };

  const openDesignSaveForm = () => {
    setDesignSaveName(`Design ${new Date().toLocaleDateString()}`);
    setDesignSavePlaylistId(activePlaylistId || playlists[0]?.id || "");
    setShowDesignSaveForm(true);
  };

  const handleAddDesignToPlaylist = async () => {
    if (!designSavePlaylistId) {
      toast.warning("Choose a playlist first.");
      return;
    }

    const title = designSaveName.trim() || `Design ${new Date().toLocaleDateString()}`;

    await addItemToPlaylist(
      {
        type: "design",
        title,
        settings: { ...previewSettings, backgroundBlur },
        thumbnailUrl:
          previewSettings.backgroundType === "ai" || previewSettings.backgroundType === "image"
            ? previewSettings.backgroundColor
            : "",
      },
      designSavePlaylistId
    );

    setShowDesignSaveForm(false);
  };

  const handleAddCurrentToPlaylist = async () => {
    const targetPlaylistId = versePlaylistId || activePlaylistId;

    if (broadcast?.bibleVerse?.reference) {
      await addItemToPlaylist(
        {
          type: "verse",
          reference: broadcast.bibleVerse.reference,
          version: broadcast.bibleVerse.version || bibleVersion,
          text: broadcast.bibleVerse.text || "",
          title: broadcast.bibleVerse.reference,
        },
        targetPlaylistId
      );
      return;
    }

    if (broadcast?.songId) {
      const liveSong = songs.find((song) => song.id === broadcast.songId);
      await addItemToPlaylist(
        {
          type: "song",
          songId: broadcast.songId,
          title: liveSong?.title || "Song",
        },
        targetPlaylistId
      );
      return;
    }

    toast.warning("Nothing is on screen yet.");
  };

  const handleAddSelectedToPlaylist = async () => {
    if (!activePlaylistId) {
      toast.warning("Create or select a playlist first.");
      return;
    }

    setAddingPlaylistItem(true);
    try {
      if (addItemType === "song") {
        const song = songs.find((entry) => entry.id === addSongId);
        if (!song) {
          toast.warning("Choose a song.");
          return;
        }
        await addItemToPlaylist({ type: "song", songId: song.id, title: song.title });
        setAddSongId("");
        return;
      }

      if (addItemType === "media") {
        const media = mediaItems.find((entry) => entry.id === addMediaId);
        if (!media) {
          toast.warning("Choose an image.");
          return;
        }
        await addItemToPlaylist({
          type: media.type === "video" ? "video" : "media",
          title: media.prompt ? String(media.prompt).slice(0, 60) : media.category || "Image",
          url: media.url,
          thumbnailUrl: media.url,
        });
        setAddMediaId("");
        return;
      }

      const reference = addVerseRef.trim();
      if (!reference) {
        toast.warning("Enter a verse reference.");
        return;
      }
      const text = await fetchVerseText(reference, bibleVersion);
      await addItemToPlaylist({ type: "verse", reference, version: bibleVersion, text, title: reference });
      setAddVerseRef("");
    } catch (err) {
      console.error("Error adding playlist item:", err);
      toast.error(err.message || "Could not add the item.");
    } finally {
      setAddingPlaylistItem(false);
    }
  };

  const handleRemovePlaylistItem = async (itemId) => {
    try {
      await deleteDoc(doc(db, `churches/${id}/projectorPlaylists/${activePlaylistId}/items`, itemId));
    } catch (err) {
      console.error("Error removing playlist item:", err);
      toast.error("Could not remove the item.");
    }
  };

  // Swaps the order values of two neighbours so the saved service order survives a reload.
  const handleMovePlaylistItem = async (index, direction) => {
    const target = playlistItems[index];
    const swapWith = playlistItems[direction === "up" ? index - 1 : index + 1];
    if (!target || !swapWith) return;

    try {
      const batch = writeBatch(db);
      const basePath = `churches/${id}/projectorPlaylists/${activePlaylistId}/items`;
      batch.update(doc(db, basePath, target.id), { order: Number(swapWith.order) || 0 });
      batch.update(doc(db, basePath, swapWith.id), { order: Number(target.order) || 0 });
      await batch.commit();
    } catch (err) {
      console.error("Error reordering playlist:", err);
      toast.error("Could not reorder the playlist.");
    }
  };

  const handlePlayPlaylistItem = async (item) => {
    if (!broadcastId) return;

    try {
      if (item.type === "song") {
        await handleSongSelect(item.songId);
        return;
      }

      const isVideoItem = item.type === "video"
        || (item.type === "media" && mediaItems.some((media) => media.type === "video" && media.url === item.url));

      if (isVideoItem) {
        await updateDoc(doc(db, `churches/${id}/broadcasts`, broadcastId), {
          videoUrl: item.url,
          videoName: item.title || "",
          videoCurrentTime: 0,
          videoPaused: false,
          videoControlAt: Date.now(),
          songId: null,
          bibleVerse: null,
          updatedAt: new Date(),
        });
        toast.success("Video pushed live.");
        return;
      }

      if (item.type === "media") {
        await updateDoc(doc(db, `churches/${id}/broadcasts`, broadcastId), {
          backgroundType: "image",
          backgroundColor: item.url,
          videoUrl: "",
          videoName: "",
          updatedAt: new Date(),
        });
        setPreviewSettings((prev) => ({ ...prev, backgroundType: "image", backgroundColor: item.url }));
        toast.success("Image applied.");
        return;
      }

      if (item.type === "prop") {
        await updateDoc(doc(db, `churches/${id}/broadcasts`, broadcastId), {
          propUrl: item.url,
          propSize: item.propSize || 30,
          propColor: item.propColor || "#ffffff",
          propVisible: true,
          updatedAt: new Date(),
        });
        toast.success("Prop broadcast to screen.");
        return;
      }

      if (item.type === "design") {
        const settings = item.settings || {};
        await updateDoc(doc(db, `churches/${id}/broadcasts`, broadcastId), {
          ...settings,
          videoUrl: "",
          videoName: "",
          backgroundColor:
            settings.backgroundType === "gradient"
              ? `linear-gradient(${settings.gradientAngle}deg, ${settings.gradientColors?.[0]}, ${settings.gradientColors?.[1]})`
              : settings.backgroundColor,
          updatedAt: new Date(),
        });
        setPreviewSettings((prev) => ({ ...prev, ...settings }));
        toast.success("Design applied.");
        return;
      }

      await updateDoc(doc(db, `churches/${id}/broadcasts`, broadcastId), {
        bibleVerse: { reference: item.reference, version: item.version, text: item.text },
        songId: null,
        videoUrl: "",
        videoName: "",
        currentLyricIndex: 0,
        updatedAt: new Date(),
      });
    } catch (err) {
      console.error("Error displaying playlist item:", err);
      toast.error("Could not display this item.");
    }
  };


  const nowShowingLabel = useMemo(() => {
    if (broadcast?.bibleVerse?.reference) {
      return `${broadcast.bibleVerse.reference}${broadcast.bibleVerse.version ? ` (${broadcast.bibleVerse.version})` : ""}`;
    }
    if (broadcast?.songId) {
      return songs.find((song) => song.id === broadcast.songId)?.title || "Song";
    }
    return "";
  }, [broadcast?.bibleVerse, broadcast?.songId, songs]);

  const hasBackgroundImage = useMemo(
    () =>
      (broadcast?.backgroundType === "ai" || broadcast?.backgroundType === "image")
      && String(broadcast?.backgroundColor || "").startsWith("http"),
    [broadcast?.backgroundType, broadcast?.backgroundColor]
  );

  const handleClearBackground = async () => {
    if (!broadcastId) return;

    try {
      await updateDoc(doc(db, `churches/${id}/broadcasts`, broadcastId), {
        backgroundType: "solid",
        backgroundColor: "#000000",
        backgroundBlur: 0,
        updatedAt: new Date(),
      });
      setPreviewSettings((prev) => ({ ...prev, backgroundType: "solid", backgroundColor: "#000000" }));
      setBackgroundBlur(0);
      toast.success("Background image cleared");
    } catch (err) {
      console.error("Error clearing background:", err);
      toast.error("Failed to clear background");
    }
  };

  const translateToAllLanguages = async (text) => {
    if (targetLanguages.length === 0) return null;

    const languageList = targetLanguages
      .map((code) => `${code} (${TRANSLATION_LANGUAGES.find((entry) => entry.code === code)?.label || code})`)
      .join(", ");

    const response = await fetch(`${FIREBASE_FUNCTIONS_BASE_URL}/generateTimeRotateInvoiceReview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: GEMINI_TEXT_MODEL,
        prompt: [
          "You are a live interpreter for a church service.",
          `Translate the text into these languages: ${languageList}.`,
          "Return ONLY a raw JSON object whose keys are the language codes and whose values are the translations.",
          "No markdown, no code fences, no commentary. Keep it natural and spoken.",
          `Text: ${text}`,
        ].join(" "),
      }),
    });

    if (!response.ok) return null;

    const data = await response.json();
    const raw = String(data?.text || "")
      .trim()
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/, "")
      .trim();

    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };

  // Streams partial speech so captions move with the speaker instead of waiting for a pause.
  const publishInterim = (text) => {
    if (!broadcastId) return;

    const now = Date.now();
    const broadcastRef = doc(db, `churches/${id}/broadcasts`, broadcastId);

    if (now - lastInterimWriteRef.current > 500) {
      lastInterimWriteRef.current = now;
      updateDoc(broadcastRef, {
        caption: { original: text, sourceLanguage: speechLanguage, at: now, partial: true },
      }).catch(() => {});
    }

    if (interimTranslateBusyRef.current || now - lastInterimTranslateRef.current < 1500) return;

    interimTranslateBusyRef.current = true;
    lastInterimTranslateRef.current = now;
    translateToAllLanguages(text)
      .then((translations) => {
        if (!translations) return;
        return updateDoc(broadcastRef, {
          caption: { original: text, sourceLanguage: speechLanguage, translations, at: Date.now(), partial: true },
        });
      })
      .catch(() => {})
      .finally(() => {
        interimTranslateBusyRef.current = false;
      });
  };

  // Publishes the transcript immediately, then fills in translations for every available
  // language in a single call so viewers never wait on their own round trip.
  const publishTranslation = async (spokenText) => {
    const text = String(spokenText || "").trim();
    if (!text || !broadcastId) return;
    if (lastFinalPhraseRef.current === text) return;
    lastFinalPhraseRef.current = text;

    const broadcastRef = doc(db, `churches/${id}/broadcasts`, broadcastId);
    const at = Date.now();

    await updateDoc(broadcastRef, {
      caption: { original: text, sourceLanguage: speechLanguage, at },
      updatedAt: new Date(),
    });
    setLastCaption(text);

    const translations = await translateToAllLanguages(text);
    if (!translations) return;

    await updateDoc(broadcastRef, {
      caption: { original: text, sourceLanguage: speechLanguage, translations, at },
      updatedAt: new Date(),
    });
  };

  useEffect(() => {
    if (!translationEnabled) {
      if (recognitionRef.current) {
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
      setTranslationStatus("");
      return undefined;
    }

    const SpeechRecognitionCtor =
      typeof window !== "undefined"
        ? window.SpeechRecognition || window.webkitSpeechRecognition
        : null;

    if (!SpeechRecognitionCtor) {
      toast.error("Live translation needs Chrome or Edge (Speech Recognition is unavailable here).");
      setTranslationEnabled(false);
      return undefined;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = speechLanguage;
    recognition.continuous = true;
    recognition.interimResults = true;
    let stopped = false;

    recognition.onresult = (event) => {
      let finalPhrase = "";
      let interimPhrase = "";

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result[0]?.transcript || "";
        if (result.isFinal) finalPhrase += `${transcript} `;
        else interimPhrase += `${transcript} `;
      }

      finalPhrase = finalPhrase.trim();
      interimPhrase = interimPhrase.trim();

      if (finalPhrase) {
        setTranslationStatus(`Heard: ${finalPhrase}`);
        // Chain requests so captions publish in the order they were spoken.
        translationQueueRef.current = translationQueueRef.current
          .then(() => publishTranslation(finalPhrase))
          .catch((err) => console.error("Translation error:", err));
        return;
      }

      if (!interimPhrase) return;

      setTranslationStatus(`Listening: ${interimPhrase}`);
      publishInterim(interimPhrase);
    };

    recognition.onerror = (event) => {
      if (event.error === "not-allowed") {
        toast.error("Microphone access is required for live translation.");
        setTranslationEnabled(false);
      }
    };

    // Chrome ends recognition periodically; restart so the session keeps running.
    recognition.onend = () => {
      if (!stopped) {
        try {
          recognition.start();
        } catch {
          /* already starting */
        }
      }
    };

    try {
      recognition.start();
      setTranslationStatus("Listening...");
    } catch (err) {
      console.error("Could not start speech recognition:", err);
    }

    recognitionRef.current = recognition;

    return () => {
      stopped = true;
      recognition.onend = null;
      recognition.stop();
      recognitionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [translationEnabled, speechLanguage]);

  // Publish which languages are on offer so the broadcast screen only lists those.
  useEffect(() => {
    if (!id || !broadcastId) return;

    updateDoc(doc(db, `churches/${id}/broadcasts`, broadcastId), {
      translationEnabled,
      translationLanguages: targetLanguages,
      defaultTranslationLanguage: targetLanguages.includes(defaultLanguage) ? defaultLanguage : "",
    }).catch((err) => console.error("Failed to publish translation settings:", err));
  }, [id, broadcastId, translationEnabled, targetLanguages, defaultLanguage]);

  // Keeps the picker short: common languages plus anything already chosen, until you search.
  const visibleLanguages = useMemo(() => {
    const search = languageSearch.trim().toLowerCase();
    if (search) {
      return TRANSLATION_LANGUAGES.filter(
        (language) =>
          language.label.toLowerCase().includes(search) || language.code.toLowerCase().includes(search)
      );
    }
    return TRANSLATION_LANGUAGES.filter(
      (language) => language.common || targetLanguages.includes(language.code)
    );
  }, [languageSearch, targetLanguages]);

  // Short, typeable code (no 0/O/1/I) that viewers can enter instead of the full broadcast URL.
  const generateShortCode = () => {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    return Array.from({ length: 5 })
      .map(() => alphabet[Math.floor(Math.random() * alphabet.length)])
      .join("");
  };

  const handleGetShortLink = async () => {
    if (!broadcastId) return;

    setCreatingShortLink(true);
    try {
      const existingCode = String(broadcast?.shortCode || "").trim();
      if (existingCode) {
        const existingSnapshot = await getDoc(doc(db, "broadcastLinks", existingCode));
        if (existingSnapshot.exists()) {
          setShortLinkCode(existingCode);
          return;
        }
      }

      let code = "";
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const candidate = generateShortCode();
        // eslint-disable-next-line no-await-in-loop
        const candidateSnapshot = await getDoc(doc(db, "broadcastLinks", candidate));
        if (!candidateSnapshot.exists()) {
          code = candidate;
          break;
        }
      }

      if (!code) throw new Error("Could not generate a free code. Try again.");

      await setDoc(doc(db, "broadcastLinks", code), {
        churchId: id,
        broadcastId,
        createdAt: new Date(),
      });
      await updateDoc(doc(db, `churches/${id}/broadcasts`, broadcastId), { shortCode: code });

      setShortLinkCode(code);
      toast.success("Short link ready.");
    } catch (err) {
      console.error("Error creating short link:", err);
      toast.error(err.message || "Could not create a short link.");
    } finally {
      setCreatingShortLink(false);
    }
  };

  // Make sure every screen has a short code ready before anyone needs to share it.
  useEffect(() => {
    if (!id || !broadcastId) return;

    const existing = String(broadcast?.shortCode || "").trim();
    if (existing) {
      setShortLinkCode(existing);
      return;
    }

    if (shortLinkRequestedRef.current === broadcastId) return;
    shortLinkRequestedRef.current = broadcastId;
    handleGetShortLink();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, broadcastId, broadcast?.shortCode]);

  const handleClearCaption = async () => {
    if (!broadcastId) return;
    await updateDoc(doc(db, `churches/${id}/broadcasts`, broadcastId), {
      caption: null,
      updatedAt: new Date(),
    });
    setLastCaption("");
  };

  const handleClearScreen = async () => {
    if (!broadcastId) return;

    try {
      await updateDoc(doc(db, `churches/${id}/broadcasts`, broadcastId), {
        songId: null,
        bibleVerse: null,
        videoUrl: "",
        videoName: "",
        currentLyricIndex: 0,
        caption: null,
        updatedAt: new Date(),
      });
      setLastCaption("");
      toast.success("Screen cleared");
    } catch (err) {
      console.error("Error clearing screen:", err);
      toast.error("Failed to clear screen");
    }
  };

  const handleResetReactions = async () => {
    if (!broadcastId) return;

    try {
      const resetCounts = REACTION_TYPES.reduce((acc, reaction) => {
        acc[reaction.key] = 0;
        return acc;
      }, {});
      await updateDoc(doc(db, `churches/${id}/broadcasts`, broadcastId), {
        reactionCounts: resetCounts,
        lastReaction: null,
        updatedAt: new Date(),
      });
      toast.success("Reactions reset");
    } catch (err) {
      console.error("Error resetting reactions:", err);
      toast.error("Failed to reset reactions");
    }
  };

  const generateSingleAIImage = async ({ prompt, type, styleDescriptor, idToken, variationHint }) => {
    const imageResponse = await fetch(`${FIREBASE_FUNCTIONS_BASE_URL}/generateDesignWithGemini`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        churchId: id,
        model: GEMINI_IMAGE_MODEL,
        prompt: [
          `${styleDescriptor}: ${prompt}.`,
          "Composition: 16:9 widescreen, suitable for projection on a large screen.",
          type === "ai"
            ? "Keep the overall contrast low and leave the centre visually calm so large overlaid text stays readable."
            : "Keep the subject clear and well composed.",
          "Do not render any text, words, letters, watermarks or logos in the image.",
          variationHint,
        ].join(" "),
      }),
    });

    const payload = await imageResponse.json().catch(() => ({}));

    if (!imageResponse.ok || !payload?.imageBase64) {
      throw new Error(payload?.message || payload?.error || "Failed to generate image");
    }

    const mimeType = payload.mimeType || "image/png";
    const imageBlob = await (await fetch(`data:${mimeType};base64,${payload.imageBase64}`)).blob();
    const extension = mimeType.includes("jpeg") ? "jpg" : "png";
    const generatedRef = ref(
      storage,
      `images/${id}/projector/gemini_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${extension}`
    );
    await uploadBytes(generatedRef, imageBlob, { contentType: mimeType });
    const downloadUrl = await getDownloadURL(generatedRef);

    return { url: downloadUrl, storagePath: generatedRef.fullPath };
  };

  const generateAIBackground = async (prompt, type, style) => {
    if (!prompt.trim()) {
      toast.error("Please enter a description");
      return;
    }

    try {
      setGeneratingImage(true);
      setAiCandidates([]);
      toast.info("Generating 3 options with Gemini...");

      const styleDescriptor =
        AI_IMAGE_STYLES.find((entry) => entry.value === style)?.descriptor
        || AI_IMAGE_STYLES[0].descriptor;

      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) {
        throw new Error("Please sign in again before generating an image.");
      }

      // Distinct hints keep the three options visually different instead of near-duplicates.
      const variationHints = [
        "Use a wide establishing composition.",
        "Use a closer, more intimate composition with a different colour mood.",
        "Use a different angle and lighting direction from a typical version.",
      ];

      const results = await Promise.allSettled(
        variationHints.map((variationHint) =>
          generateSingleAIImage({ prompt, type, styleDescriptor, idToken, variationHint })
        )
      );

      const urls = results
        .filter((result) => result.status === "fulfilled")
        .map((result) => result.value);

      if (urls.length === 0) {
        const firstError = results.find((result) => result.status === "rejected");
        throw new Error(firstError?.reason?.message || "Failed to generate image");
      }

      setAiCandidates(urls);
      setPreviewSettings((prev) => ({
        ...prev,
        backgroundType: type,
        backgroundColor: urls[0].url,
      }));

      toast.success(
        urls.length === 3
          ? "3 options ready - pick one, then Save to Media to keep it."
          : `${urls.length} option(s) ready - pick one, then Save to Media to keep it.`
      );
    } catch (err) {
      console.error("Error generating:", err);
      toast.error("Failed to generate: " + err.message);
    } finally {
      setGeneratingImage(false);
    }
  };

  const handleImageUpload = async (e) => {
    e.preventDefault(); // Prevent page refresh
    const file = e.target.files[0];
    if (!file) return;

    try {
      setUploading(true);
      const timestamp = Date.now();
      const filesRef = ref(
        storage,
        `images/${id}/projector/${timestamp}_${file.name}`
      );
      await uploadBytes(filesRef, file);
      const fileUrl = await getDownloadURL(filesRef);
      setPreviewSettings((prev) => ({
        ...prev,
        backgroundType: "image",
        backgroundColor: fileUrl,
      }));
      toast.success("Image uploaded successfully!");
    } catch (err) {
      console.error("Error uploading image:", err);
      toast.error("Failed to upload image");
    } finally {
      setUploading(false);
    }
  };

  const handleVideoUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      toast.error("Please choose a video file.");
      return;
    }

    setUploadingVideo(true);
    try {
      const videoRef = ref(storage, `videos/${id}/projector/${Date.now()}_${file.name}`);
      await uploadBytes(videoRef, file, { contentType: file.type });
      const url = await getDownloadURL(videoRef);
      setVideoFile(file);
      setVideoPreviewUrl(url);
      toast.success("Video uploaded. Click Push Video Live to display it.");
    } catch (err) {
      console.error("Error uploading video:", err);
      toast.error("Could not upload the video.");
    } finally {
      setUploadingVideo(false);
    }
  };

  const handlePushVideoLive = async () => {
    if (!broadcastId || !videoPreviewUrl) return;
    try {
      await updateDoc(doc(db, `churches/${id}/broadcasts`, broadcastId), {
        videoUrl: videoPreviewUrl,
        videoName: videoFile?.name || "",
        videoCurrentTime: 0,
        videoPaused: false,
        videoControlAt: Date.now(),
        songId: null,
        bibleVerse: null,
        updatedAt: new Date(),
      });
      toast.success("Video pushed live.");
    } catch (err) {
      console.error("Error pushing video live:", err);
      toast.error("Could not push the video live.");
    }
  };

  const updateVideoControl = async (updates = {}) => {
    if (!broadcastId || !broadcast?.videoUrl) return;
    await updateDoc(doc(db, `churches/${id}/broadcasts`, broadcastId), {
      ...updates,
      videoControlAt: Date.now(),
      updatedAt: new Date(),
    });
  };

  const handleVideoPlayPause = async () => {
    const video = videoControlRef.current;
    if (!video) return;
    const nextPaused = !video.paused;
    if (nextPaused) video.pause();
    else await video.play().catch(() => {});
    await updateVideoControl({ videoCurrentTime: video.currentTime, videoPaused: nextPaused });
  };

  const handleVideoSeek = async (seconds) => {
    const video = videoControlRef.current;
    if (!video) return;
    const nextTime = Math.max(0, Math.min(video.duration || Number.MAX_SAFE_INTEGER, video.currentTime + seconds));
    video.currentTime = nextTime;
    await updateVideoControl({ videoCurrentTime: nextTime, videoPaused: video.paused });
  };

  const handleVideoTimeUpdate = () => {
    const video = videoControlRef.current;
    const now = Date.now();
    if (!video || !broadcast?.videoUrl || now - videoSyncWriteRef.current < 5000) return;
    videoSyncWriteRef.current = now;
    updateVideoControl({ videoCurrentTime: video.currentTime, videoPaused: video.paused }).catch(() => {});
  };

  const handleSaveVideoToMedia = async () => {
    if (!videoPreviewUrl) return;
    if (mediaItems.some((item) => item.type === "video" && item.url === videoPreviewUrl)) {
      toast.info("This video is already in Media.");
      return;
    }

    try {
      await addDoc(collection(db, `churches/${id}/projectorMedia`), {
        type: "video",
        url: videoPreviewUrl,
        storagePath: "",
        category: mediaCategory || "Uncategorized",
        prompt: videoFile?.name || "Saved video",
        createdAt: new Date(),
        createdByUid: auth.currentUser?.uid || "",
      });
      toast.success(`Video saved to Media (${mediaCategory || "Uncategorized"}).`);
    } catch (err) {
      console.error("Error saving video to Media:", err);
      toast.error("Could not save the video to Media.");
    }
  };

  const handleAddVideoToPlaylist = async () => {
    if (!videoPreviewUrl) return;
    await addItemToPlaylist({
      type: "video",
      title: videoFile?.name || "Video",
      url: videoPreviewUrl,
      thumbnailUrl: "",
    });
  };

  const handleClearVideo = async () => {
    if (!broadcastId) return;
    await updateDoc(doc(db, `churches/${id}/broadcasts`, broadcastId), {
      videoUrl: "",
      videoName: "",
      videoCurrentTime: 0,
      videoPaused: true,
      updatedAt: new Date(),
    });
    toast.success("Video cleared.");
  };

  const videoControlUrl = broadcast?.videoUrl || videoPreviewUrl;

  const handlePropImagesUpload = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    if (!imageFiles.length) {
      toast.error("Please choose image file(s).");
      return;
    }

    setUploadingProps(true);
    try {
      const uploaded = [];
      for (const file of imageFiles) {
        const propRef = ref(
          storage,
          `images/${id}/projector/props/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${file.name}`
        );
        await uploadBytes(propRef, file, { contentType: file.type });
        const url = await getDownloadURL(propRef);
        uploaded.push({ id: propRef.fullPath, url, storagePath: propRef.fullPath, name: file.name });
      }
      setPropImages((prev) => [...uploaded, ...prev]);
      toast.success(`${uploaded.length} image(s) uploaded.`);
    } catch (err) {
      console.error("Error uploading prop image(s):", err);
      toast.error("Could not upload the image(s).");
    } finally {
      setUploadingProps(false);
    }
  };

  const handleRemovePropImage = (propItem) => {
    setPropImages((prev) => prev.filter((entry) => entry.id !== propItem.id));
  };

  const handleSavePropToMedia = async (propItem) => {
    if (mediaItems.some((media) => media.url === propItem.url)) {
      toast.info("This image is already in your media library.");
      return;
    }

    try {
      await addDoc(collection(db, `churches/${id}/projectorMedia`), {
        url: propItem.url,
        storagePath: propItem.storagePath || "",
        category: mediaCategory || "Uncategorized",
        prompt: propItem.name || "Prop image",
        type: "prop",
        createdAt: new Date(),
        createdByUid: auth.currentUser?.uid || "",
      });
      toast.success(`Saved to Media (${mediaCategory || "Uncategorized"}).`);
    } catch (err) {
      console.error("Error saving prop to media:", err);
      toast.error("Could not save to media.");
    }
  };

  const handlePushPropLive = async (propItem) => {
    if (!broadcastId) return;

    try {
      await updateDoc(doc(db, `churches/${id}/broadcasts`, broadcastId), {
        propUrl: propItem.url,
        propSize,
        propColor,
        propVisible: true,
        updatedAt: new Date(),
      });
      toast.success("Prop broadcast to screen.");
    } catch (err) {
      console.error("Error broadcasting prop:", err);
      toast.error("Could not broadcast the prop.");
    }
  };

  const handleClearProp = async () => {
    if (!broadcastId) return;

    try {
      await updateDoc(doc(db, `churches/${id}/broadcasts`, broadcastId), {
        propUrl: "",
        propVisible: false,
        updatedAt: new Date(),
      });
      toast.success("Prop cleared from screen.");
    } catch (err) {
      console.error("Error clearing prop:", err);
      toast.error("Could not clear the prop.");
    }
  };

  const handleAddPropToPlaylist = async (propItem) => {
    await addItemToPlaylist({
      type: "prop",
      title: propItem.name || "Prop",
      url: propItem.url,
      propSize,
      propColor,
      thumbnailUrl: propItem.url,
    });
  };

  const [broadcasts, setBroadcasts] = useState([]);
  const [showNewBroadcastModal, setShowNewBroadcastModal] = useState(false);
  const [newBroadcastName, setNewBroadcastName] = useState("");

  useEffect(() => {
    const setupBroadcasts = async () => {
      if (!id) return;

      try {
        const broadcastsRef = collection(db, `churches/${id}/broadcasts`);
        const broadcastsSnap = await getDocs(broadcastsRef);

        if (broadcastsSnap.empty) {
          const defaultBroadcast = {
            name: "Main Screen",
            backgroundColor: "#000000",
            backgroundType: "solid",
            backgroundUrl: null,
            micEnabled: false,
            songId: null,
            currentLyricIndex: 0,
            fontSize: "48",
            fontColor: "#FFFFFF",
            fontFamily: "Arial",
            isBold: false,
            isItalic: false,
            isUpperCase: false,
            textShadow: "none",
            gradientColors: ["#000000", "#000000"],
            gradientAngle: 45,
            textBlur: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          const newBroadcastDoc = await addDoc(broadcastsRef, defaultBroadcast);
          setBroadcastId(newBroadcastDoc.id);
          setBroadcast(defaultBroadcast);
          setBroadcasts([{ id: newBroadcastDoc.id, ...defaultBroadcast }]);
        } else {
          const broadcastsData = broadcastsSnap.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
          }));
          setBroadcasts(broadcastsData);
          setBroadcastId(broadcastsData[0].id);
          setBroadcast(broadcastsData[0]);
        }

        const unsubscribe = onSnapshot(broadcastsRef, (snapshot) => {
          const updatedBroadcasts = snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
          }));
          setBroadcasts(updatedBroadcasts);

          if (broadcastId) {
            const currentBroadcast = updatedBroadcasts.find(
              (b) => b.id === broadcastId
            );
            if (currentBroadcast) {
              setBroadcast(currentBroadcast);
            }
          }
        });

        setLoading(false);
        return () => unsubscribe();
      } catch (err) {
        console.error("Setup error:", err);
        setError(err.message);
        setLoading(false);
      }
    };

    setupBroadcasts();
  }, [id]);

  const createNewBroadcast = async () => {
    if (!newBroadcastName.trim()) {
      toast.error("Please enter a name for the broadcast");
      return;
    }

    try {
      const broadcastData = {
        name: newBroadcastName,
        backgroundColor: "#000000",
        backgroundType: "solid",
        backgroundUrl: null,
        micEnabled: false,
        songId: null,
        currentLyricIndex: 0,
        fontSize: "48",
        fontColor: "#FFFFFF",
        fontFamily: "Arial",
        isBold: false,
        isItalic: false,
        isUpperCase: false,
        textShadow: "none",
        gradientColors: ["#000000", "#000000"],
        gradientAngle: 45,
        textBlur: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const broadcastsRef = collection(db, `churches/${id}/broadcasts`);
      await addDoc(broadcastsRef, broadcastData);
      setShowNewBroadcastModal(false);
      setNewBroadcastName("");
      toast.success("New broadcast screen created!");
    } catch (err) {
      console.error("Error creating broadcast:", err);
      toast.error("Failed to create broadcast");
    }
  };

  const deleteBroadcast = async (broadcastId) => {
    if (broadcasts.length <= 1) {
      toast.error("Cannot delete the last broadcast screen");
      return;
    }

    if (
      !window.confirm(
        "Are you sure you want to delete this broadcast screen?"
      )
    ) {
      return;
    }

    try {
      await deleteDoc(doc(db, `churches/${id}/broadcasts`, broadcastId));
      toast.success("Broadcast screen deleted");
    } catch (err) {
      console.error("Error deleting broadcast:", err);
      toast.error("Failed to delete broadcast");
    }
  };

  const screenButtonStyles = {
    padding: "6px 12px",
    fontSize: "0.875rem",
    minWidth: "70px",
  };

  useEffect(() => {
    if (!id || !broadcastId) return;

    const unsubscribe = onSnapshot(
      doc(db, `churches/${id}/broadcasts`, broadcastId),
      (doc) => {
        if (doc.exists()) {
          const data = doc.data();

          const newSettings = {
            fontFamily: data.fontFamily || "Arial",
            fontSize: data.fontSize || "48",
            fontColor: data.fontColor || "#FFFFFF",
            isBold: data.isBold || false,
            isItalic: data.isItalic || false,
            isUpperCase: data.isUpperCase || false,
            textShadow: data.textShadow || "none",
            textBlur: data.textBlur || 0,
            backgroundColor: data.backgroundColor || "#000000",
            backgroundType: data.backgroundType || "solid",
            gradientColors: data.gradientColors || ["#000000", "#000000"],
            gradientAngle: data.gradientAngle || 45,
          };

          setPreviewSettings(newSettings);
          setLiveSettings(newSettings);

          setBackgroundColor(data.backgroundColor || "#000000");
          setFontColor(data.fontColor || "#FFFFFF");
          setFontSize(data.fontSize || "48");
          setFontFamily(data.fontFamily || "Arial");
          setIsBold(data.isBold || false);
          setIsItalic(data.isItalic || false);
          setIsUpperCase(data.isUpperCase || false);
          setTextShadow(data.textShadow || "none");
          setTextBlur(data.textBlur || 0);
          setBackgroundType(data.backgroundType || "solid");
          setGradientColors(data.gradientColors || ["#000000", "#000000"]);
          setGradientAngle(data.gradientAngle || 45);
        }
      }
    );

    return () => unsubscribe();
  }, [id, broadcastId]);

  const handleApplySettings = async () => {
    try {
      if (!broadcastId) return;

      const broadcastRef = doc(db, `churches/${id}/broadcasts`, broadcastId);

      const updateData = {
        fontFamily: previewSettings.fontFamily,
        fontSize: previewSettings.fontSize,
        fontColor: previewSettings.fontColor,
        isBold: previewSettings.isBold,
        isItalic: previewSettings.isItalic,
        isUpperCase: previewSettings.isUpperCase,
        textShadow: previewSettings.textShadow,
        textBlur: previewSettings.textBlur,
        backgroundType: previewSettings.backgroundType,
        backgroundColor:
          previewSettings.backgroundType === "gradient"
            ? `linear-gradient(${previewSettings.gradientAngle}deg, ${previewSettings.gradientColors[0]}, ${previewSettings.gradientColors[1]})`
            : previewSettings.backgroundColor,
        gradientColors: previewSettings.gradientColors,
        gradientAngle: previewSettings.gradientAngle,
        updatedAt: new Date(),
      };

      await updateDoc(broadcastRef, updateData);

      setLiveSettings({ ...previewSettings });

      toast.success("Display settings applied!");
    } catch (err) {
      console.error("Error applying settings:", err);
      toast.error("Failed to apply settings");
    }
  };

  useEffect(() => {
    if (!id || !broadcastId) return;

    const unsubscribe = onSnapshot(
      doc(db, `churches/${id}/broadcasts`, broadcastId),
      (doc) => {
        if (doc.exists()) {
          const data = doc.data();

          const settings = {
            fontFamily: data.fontFamily || "Arial",
            fontSize: data.fontSize || "48",
            fontColor: data.fontColor || "#FFFFFF",
            isBold: data.isBold || false,
            isItalic: data.isItalic || false,
            isUpperCase: data.isUpperCase || false,
            textShadow: data.textShadow || "none",
            textBlur: data.textBlur || 0,
            backgroundColor: data.backgroundColor || "#000000",
            backgroundType: data.backgroundType || "solid",
            gradientColors: data.gradientColors || ["#000000", "#000000"],
            gradientAngle: data.gradientAngle || 45,
          };

          setLiveSettings(settings);
          setBroadcastSettings(settings);
          setPreviewSettings(settings);

          setBackgroundColor(data.backgroundColor || "#000000");
          setFontColor(data.fontColor || "#FFFFFF");
          setFontSize(data.fontSize || "48");
          setFontFamily(data.fontFamily || "Arial");
          setIsBold(data.isBold || false);
          setIsItalic(data.isItalic || false);
          setIsUpperCase(data.isUpperCase || false);
          setTextShadow(data.textShadow || "none");
          setTextBlur(data.textBlur || 0);
          setBackgroundType(data.backgroundType || "solid");
          setGradientColors(data.gradientColors || ["#000000", "#000000"]);
          setGradientAngle(data.gradientAngle || 45);
        }
      }
    );

    return () => unsubscribe();
  }, [id, broadcastId]);

  const handleSettingChange = (key, value) => {
    setPreviewSettings((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  // Background blur is stored outside previewSettings, so mirror it when the broadcast loads.
  useEffect(() => {
    if (broadcast) setBackgroundBlur(Number(broadcast.backgroundBlur) || 0);
  }, [broadcast]);

  const handleApplyChanges = async () => {
    try {
      if (!broadcastId) return;

      const broadcastRef = doc(db, `churches/${id}/broadcasts`, broadcastId);
      await updateDoc(broadcastRef, {
        ...previewSettings,
        backgroundBlur,
        videoUrl: "",
        videoName: "",
        backgroundColor:
          previewSettings.backgroundType === "gradient"
            ? `linear-gradient(${previewSettings.gradientAngle}deg, ${previewSettings.gradientColors[0]}, ${previewSettings.gradientColors[1]})`
            : previewSettings.backgroundColor,
        updatedAt: new Date(),
      });

      setLiveSettings({ ...previewSettings });
      toast.success("Changes applied successfully!");
    } catch (err) {
      console.error("Error applying changes:", err);
      toast.error("Failed to apply changes");
    }
  };

  useEffect(() => {
    const handleKeyDown = (event) => {
      // Only handle keyboard navigation when a song is actively selected
      if (!broadcast?.songId) return;

      if (event.key === 'j') {
        // Navigate to next verse with the 'j' key
        handleLyricNavigation("next");
      } else if (event.key === 'k') {
        // Navigate to previous verse with the 'k' key
        handleLyricNavigation("prev");
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    // Clean up event listener when component unmounts
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [broadcast?.songId, broadcast?.currentLyricIndex]); // Re-attach when song or verse changes

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-xl">Initializing broadcast...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-xl text-red-600">Error: {error}</div>
      </div>
    );
  }

  return (
    <div style={commonStyles.fullWidthContainer}>
      <button
        onClick={() => navigate(`/church/${id}/mi-perfil`)}
        style={{ ...commonStyles.backButtonLink, width: "100px" }}
      >
        ← Back
      </button>
      <ChurchHeader id={id} applyShadow={false} />

      <h1
        style={{
          ...commonStyles.topBorder,
          marginTop: "-30px",
          ...commonStyles.title,
        }}
      >
        Easy Projector
      </h1>

      <div style={{ order: 1, display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "center", marginBottom: "20px" }}>
        {[
          { key: "live", label: "▶ Live" },
          { key: "playlist", label: "☰ Playlist" },
          { key: "songs", label: "🎵 Songs" },
          { key: "bible", label: "📖 Bible" },
          { key: "video", label: "🎬 Video" },
          { key: "media", label: "🖼 Media" },
          { key: "props", label: "🏷 Props" },
          { key: "design", label: "🎨 Design" },
          { key: "screens", label: "🖥 Screens" },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              border: activeTab === tab.key ? "1px solid #4F46E5" : "1px solid #d1d5db",
              background: activeTab === tab.key ? "#4F46E5" : "#ffffff",
              color: activeTab === tab.key ? "#ffffff" : "#374151",
              borderRadius: "999px",
              padding: "10px 18px",
              fontWeight: 700,
              fontSize: "0.95rem",
              cursor: "pointer",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "playlist" && (
        <div style={{ order: 10, ...panelStyle }}>
          <h2 style={panelHeadingStyle}>Service Playlist</h2>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "12px",
              flexWrap: "wrap",
              padding: "12px",
              borderRadius: "8px",
              marginBottom: "15px",
              background: nowShowingLabel ? "#ecfdf5" : "#f3f4f6",
              border: `1px solid ${nowShowingLabel ? "#a7f3d0" : "#e5e7eb"}`,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              <span
                style={{
                  width: "10px",
                  height: "10px",
                  borderRadius: "50%",
                  background: nowShowingLabel ? "#10b981" : "#9ca3af",
                  display: "inline-block",
                }}
              />
              <strong style={{ color: nowShowingLabel ? "#065f46" : "#4b5563" }}>
                {nowShowingLabel ? `Now showing: ${nowShowingLabel}` : "Nothing is showing"}
              </strong>
            </div>
            <button
              onClick={handleClearScreen}
              disabled={!nowShowingLabel}
              title="Stop displaying and clear the screen"
              style={{
                ...commonStyles.redButton,
                margin: 0,
                padding: "8px 18px",
                opacity: nowShowingLabel ? 1 : 0.5,
                cursor: nowShowingLabel ? "pointer" : "not-allowed",
              }}
            >
              ⏹ Stop Display
            </button>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "12px",
              flexWrap: "wrap",
              padding: "12px",
              borderRadius: "8px",
              marginBottom: "15px",
              background: hasBackgroundImage ? "#eff6ff" : "#f3f4f6",
              border: `1px solid ${hasBackgroundImage ? "#bfdbfe" : "#e5e7eb"}`,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              {hasBackgroundImage ? (
                <img
                  src={broadcast.backgroundColor}
                  alt=""
                  style={{ width: "56px", height: "32px", objectFit: "cover", borderRadius: "4px" }}
                />
              ) : (
                <span
                  style={{
                    width: "10px",
                    height: "10px",
                    borderRadius: "50%",
                    background: "#9ca3af",
                    display: "inline-block",
                  }}
                />
              )}
              <strong style={{ color: hasBackgroundImage ? "#1e40af" : "#4b5563" }}>
                {hasBackgroundImage ? "Background image active" : "No background image"}
              </strong>
            </div>
            <button
              onClick={handleClearBackground}
              disabled={!hasBackgroundImage}
              title="Remove the background image only, leaving the current song or verse on screen"
              style={{
                ...commonStyles.orangeButton,
                margin: 0,
                padding: "8px 18px",
                opacity: hasBackgroundImage ? 1 : 0.5,
                cursor: hasBackgroundImage ? "pointer" : "not-allowed",
              }}
            >
              🖼 Clear Image
            </button>
          </div>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center", marginBottom: "15px" }}>
            <select
              value={activePlaylistId}
              onChange={(e) => {
                setActivePlaylistId(e.target.value);
                setIsRenamingPlaylist(false);
              }}
              style={{ padding: "10px", borderRadius: "8px", border: "1px solid #d1d5db", minWidth: "220px" }}
            >
              <option value="">{playlists.length ? "Select a playlist" : "No playlists yet"}</option>
              {playlists.map((playlist) => (
                <option key={playlist.id} value={playlist.id}>{playlist.name}</option>
              ))}
            </select>
            {activePlaylistId && !isRenamingPlaylist && (
              <button
                onClick={() => {
                  setPlaylistRenameDraft(
                    playlists.find((playlist) => playlist.id === activePlaylistId)?.name || ""
                  );
                  setIsRenamingPlaylist(true);
                }}
                style={{ ...commonStyles.orangeButton, margin: 0 }}
              >
                ✏️ Rename
              </button>
            )}
            <input
              type="text"
              value={newPlaylistName}
              onChange={(e) => setNewPlaylistName(e.target.value)}
              placeholder="New playlist name (e.g. Sunday AM)"
              style={{ padding: "10px", borderRadius: "8px", border: "1px solid #d1d5db", minWidth: "240px" }}
            />
            <button onClick={handleCreatePlaylist} style={{ ...commonStyles.greenButton, margin: 0 }}>
              + Create
            </button>
            {activePlaylistId && (
              <button onClick={handleDeletePlaylist} style={{ ...commonStyles.redButton, margin: 0 }}>
                Delete Playlist
              </button>
            )}
          </div>

          {isRenamingPlaylist && activePlaylistId && (
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center", marginBottom: "15px", padding: "12px", background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: "8px" }}>
              <label style={{ fontWeight: 600 }}>Rename playlist</label>
              <input
                type="text"
                value={playlistRenameDraft}
                onChange={(e) => setPlaylistRenameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRenamePlaylist();
                  if (e.key === "Escape") setIsRenamingPlaylist(false);
                }}
                autoFocus
                style={{ padding: "10px", borderRadius: "8px", border: "1px solid #d1d5db", minWidth: "240px" }}
              />
              <button onClick={handleRenamePlaylist} style={{ ...commonStyles.greenButton, margin: 0 }}>
                Save
              </button>
              <button
                onClick={() => setIsRenamingPlaylist(false)}
                style={{ ...commonStyles.backButton, margin: 0, width: "auto", padding: "10px 16px" }}
              >
                Cancel
              </button>
            </div>
          )}

          {activePlaylistId && (
            <div style={{ border: "1px solid #e5e7eb", background: "#f9fafb", borderRadius: "8px", padding: "12px", marginBottom: "15px" }}>
              <strong style={{ display: "block", marginBottom: "10px" }}>Add to this playlist</strong>
              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
                <select
                  value={addItemType}
                  onChange={(e) => setAddItemType(e.target.value)}
                  style={{ padding: "10px", borderRadius: "8px", border: "1px solid #d1d5db", minWidth: "150px" }}
                >
                  <option value="song">🎵 Song</option>
                  <option value="media">🖼 Media Image</option>
                  <option value="verse">📖 Bible Verse</option>
                </select>

                {addItemType === "song" && (
                  <select
                    value={addSongId}
                    onChange={(e) => setAddSongId(e.target.value)}
                    style={{ padding: "10px", borderRadius: "8px", border: "1px solid #d1d5db", minWidth: "240px" }}
                  >
                    <option value="">{songs.length ? "Select a song" : "No songs yet"}</option>
                    {songs.map((song) => (
                      <option key={song.id} value={song.id}>{song.title}</option>
                    ))}
                  </select>
                )}

                {addItemType === "media" && (
                  <select
                    value={addMediaId}
                    onChange={(e) => setAddMediaId(e.target.value)}
                    style={{ padding: "10px", borderRadius: "8px", border: "1px solid #d1d5db", minWidth: "240px" }}
                  >
                    <option value="">{mediaItems.length ? "Select an image" : "No saved media yet"}</option>
                    {mediaItems.map((media) => (
                      <option key={media.id} value={media.id}>
                        {`${media.category || "Uncategorized"} — ${String(media.prompt || "Image").slice(0, 40)}`}
                      </option>
                    ))}
                  </select>
                )}

                {addItemType === "verse" && (
                  <>
                    <select
                      value={bibleVersion}
                      onChange={(e) => setBibleVersion(e.target.value)}
                      style={{ padding: "10px", borderRadius: "8px", border: "1px solid #d1d5db", minWidth: "170px" }}
                    >
                      {BIBLE_VERSIONS.map((version) => (
                        <option key={version.value} value={version.value}>{version.value}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={addVerseRef}
                      onChange={(e) => setAddVerseRef(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleAddSelectedToPlaylist(); }}
                      placeholder="e.g. John 3:16"
                      style={{ padding: "10px", borderRadius: "8px", border: "1px solid #d1d5db", minWidth: "200px" }}
                    />
                  </>
                )}

                <button
                  onClick={handleAddSelectedToPlaylist}
                  disabled={addingPlaylistItem}
                  style={{ ...commonStyles.greenButton, margin: 0, opacity: addingPlaylistItem ? 0.6 : 1 }}
                >
                  {addingPlaylistItem ? "Adding..." : "+ Add"}
                </button>
              </div>
            </div>
          )}

          <div style={{ background: "#f5f5f5", borderRadius: "8px", padding: "15px", display: "flex", flexDirection: "column", gap: "10px" }}>
            {!activePlaylistId ? (
              <div style={{ textAlign: "center", color: "#6b7280", padding: "20px" }}>
                Create a playlist, then add songs from the Songs tab and verses from the Bible tab.
              </div>
            ) : playlistItems.length === 0 ? (
              <div style={{ textAlign: "center", color: "#6b7280", padding: "20px" }}>
                This playlist is empty. Add songs and Bible verses to build your service order.
              </div>
            ) : (
              playlistItems.map((item, index) => {
                const isLiveItem = item.type === "song"
                  ? broadcast?.songId === item.songId
                  : item.type === "verse"
                    ? broadcast?.bibleVerse?.reference === item.reference
                    : item.type === "video"
                      ? broadcast?.videoUrl === item.url
                    : item.type === "media"
                      ? broadcast?.backgroundColor === item.url
                      : broadcast?.backgroundColor === item.settings?.backgroundColor;

                return (
                  <div
                    key={item.id}
                    style={{
                      background: isLiveItem ? "#dbeafe" : "#ffffff",
                      border: `1px solid ${isLiveItem ? "#2563eb" : "#d1d5db"}`,
                      borderRadius: "8px",
                      padding: "12px",
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      flexWrap: "wrap",
                    }}
                  >
                    <span style={{ fontWeight: 700, color: "#6b7280", minWidth: "24px" }}>{index + 1}.</span>
                    {isLiveItem && (
                      <span
                        style={{
                          background: "#10b981",
                          color: "#fff",
                          borderRadius: "999px",
                          padding: "2px 8px",
                          fontSize: "0.7rem",
                          fontWeight: 700,
                          letterSpacing: "0.05em",
                        }}
                      >
                        LIVE
                      </span>
                    )}
                    {item.type === "video" ? (
                      <video src={item.url} muted playsInline style={{ width: "64px", height: "36px", objectFit: "cover", borderRadius: "4px", background: "#000" }} />
                    ) : (item.type === "design" || item.type === "media" || item.type === "prop") && item.thumbnailUrl ? (
                      <img
                        src={item.thumbnailUrl}
                        alt=""
                        style={{ width: "64px", height: "36px", objectFit: "cover", borderRadius: "4px" }}
                      />
                    ) : (
                      <span style={{ fontSize: "1.2rem" }}>
                        {item.type === "song" ? "🎵" : item.type === "design" ? "🎨" : item.type === "video" ? "🎬" : item.type === "prop" ? "🏷" : item.type === "media" ? "🖼" : "📖"}
                      </span>
                    )}
                    <div style={{ flex: 1, minWidth: "180px" }}>
                      <div style={{ fontWeight: 600 }}>
                        {item.title || item.reference}
                        {item.type === "verse" && item.version ? ` (${item.version})` : ""}
                      </div>
                      {item.type === "media" && (
                        <div style={{ fontSize: "0.85rem", color: "#6b7280", marginTop: "2px" }}>
                          Image — sets the background
                        </div>
                      )}
                      {item.type === "prop" && (
                        <div style={{ fontSize: "0.85rem", color: "#6b7280", marginTop: "2px" }}>
                          Prop — overlays on top of the screen
                        </div>
                      )}
                      {item.type === "video" && (
                        <div style={{ fontSize: "0.85rem", color: "#6b7280", marginTop: "2px" }}>
                          Video — plays on the broadcast screen
                        </div>
                      )}
                      {item.type === "design" && (
                        <div style={{ fontSize: "0.85rem", color: "#6b7280", marginTop: "2px" }}>
                          Design — fonts, colors and background
                        </div>
                      )}
                      {item.type === "verse" && (
                        <div style={{ fontSize: "0.85rem", color: "#6b7280", marginTop: "2px" }}>
                          {String(item.text || "").slice(0, 110)}
                          {String(item.text || "").length > 110 ? "..." : ""}
                        </div>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <button
                        onClick={() => handleMovePlaylistItem(index, "up")}
                        disabled={index === 0}
                        title="Move up"
                        style={{ ...commonStyles.backButton, margin: 0, width: "auto", padding: "8px 10px", opacity: index === 0 ? 0.4 : 1 }}
                      >
                        ↑
                      </button>
                      <button
                        onClick={() => handleMovePlaylistItem(index, "down")}
                        disabled={index === playlistItems.length - 1}
                        title="Move down"
                        style={{ ...commonStyles.backButton, margin: 0, width: "auto", padding: "8px 10px", opacity: index === playlistItems.length - 1 ? 0.4 : 1 }}
                      >
                        ↓
                      </button>
                      <button
                        onClick={() => handlePlayPlaylistItem(item)}
                        style={{ ...commonStyles.greenButton, margin: 0, padding: "8px 14px" }}
                      >
                        Display
                      </button>
                      <button
                        onClick={() => handleRemovePlaylistItem(item.id)}
                        style={{ ...commonStyles.redButton, margin: 0, padding: "8px 10px" }}
                      >
                        <MdDelete size={18} color="white" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {activeTab === "video" && (
        <div style={{ order: 10, ...panelStyle }}>
          <h2 style={panelHeadingStyle}>Video Broadcast</h2>
          <p style={{ color: "#64748B", marginTop: 0 }}>
            Control the live video from here. Upload a new video or control one started from Media or a playlist.
          </p>
          <input
            type="file"
            accept="video/*"
            onChange={handleVideoUpload}
            disabled={uploadingVideo}
            style={{ display: "block", marginBottom: "12px" }}
          />
          {uploadingVideo ? <div style={{ color: "#475569", marginBottom: "12px" }}>Uploading video...</div> : null}
          {videoControlUrl ? (
            <div style={{ display: "grid", gap: "12px", maxWidth: "900px" }}>
              <video
                ref={videoControlRef}
                src={videoControlUrl}
                controls
                muted
                playsInline
                onTimeUpdate={handleVideoTimeUpdate}
                style={{ width: "100%", maxHeight: "520px", background: "#000", borderRadius: "8px" }}
              />
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button onClick={() => handleVideoSeek(-10)} style={{ ...commonStyles.backButton, margin: 0, width: "auto" }}>
                  ↶ 10s
                </button>
                <button onClick={handleVideoPlayPause} style={{ ...commonStyles.indigoButton, margin: 0 }}>
                  {videoControlRef.current?.paused ? "▶ Play" : "⏸ Pause"}
                </button>
                <button onClick={() => handleVideoSeek(10)} style={{ ...commonStyles.backButton, margin: 0, width: "auto" }}>
                  10s ↷
                </button>
                {videoPreviewUrl ? (
                  <>
                    <button onClick={handleSaveVideoToMedia} style={{ ...commonStyles.orangeButton, margin: 0 }}>
                      💾 Save to Media
                    </button>
                    <button onClick={handleAddVideoToPlaylist} style={{ ...commonStyles.indigoButton, margin: 0 }}>
                      + Add to Playlist
                    </button>
                    <button onClick={handlePushVideoLive} style={{ ...commonStyles.greenButton, margin: 0 }}>
                      ▶ Push Video Live
                    </button>
                  </>
                ) : null}
                {broadcast?.videoUrl ? (
                  <button onClick={handleClearVideo} style={{ ...commonStyles.redButton, margin: 0 }}>
                    Clear Live Video
                  </button>
                ) : null}
              </div>
              <small style={{ color: "#64748B" }}>{videoFile?.name || broadcast?.videoName || "Live video"}</small>
            </div>
          ) : (
            <div style={{ padding: "24px", background: "#F8FAFC", border: "1px dashed #CBD5E1", borderRadius: "8px", color: "#64748B" }}>
              Choose a video file to preview it here.
            </div>
          )}
        </div>
      )}

      {activeTab === "media" && (
        <div style={{ order: 10, ...panelStyle }}>
          <h2 style={panelHeadingStyle}>Media Library</h2>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center", marginBottom: "15px" }}>
            <strong>Filter by category:</strong>
            <select
              value={mediaFilter}
              onChange={(e) => setMediaFilter(e.target.value)}
              style={{ padding: "10px", borderRadius: "8px", border: "1px solid #d1d5db", minWidth: "200px" }}
            >
              <option value="all">All categories ({mediaItems.length})</option>
              {mediaCategories.map((category) => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
            <span style={{ color: "#6b7280" }}>
              Showing {visibleMediaItems.length} image{visibleMediaItems.length === 1 ? "" : "s"}
            </span>
          </div>

          <div style={{ border: "1px solid #e5e7eb", borderRadius: "8px", padding: "12px", marginBottom: "15px", background: "#f9fafb" }}>
            <strong style={{ display: "block", marginBottom: "10px" }}>Manage Categories</strong>

            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "12px" }}>
              <input
                type="text"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleAddCategory(); }}
                placeholder="New category name"
                style={{ padding: "10px", borderRadius: "8px", border: "1px solid #d1d5db", minWidth: "220px" }}
              />
              <button onClick={handleAddCategory} style={{ ...commonStyles.greenButton, margin: 0 }}>
                + Add Category
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {mediaCategories.map((category) => {
                const count = mediaItems.filter((item) => (item.category || "Uncategorized") === category).length;
                const isEditing = editingCategory === category;

                return (
                  <div
                    key={category}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      flexWrap: "wrap",
                      background: "#fff",
                      border: "1px solid #e5e7eb",
                      borderRadius: "6px",
                      padding: "8px 10px",
                    }}
                  >
                    {isEditing ? (
                      <>
                        <input
                          type="text"
                          value={categoryRenameDraft}
                          onChange={(e) => setCategoryRenameDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleRenameCategory();
                            if (e.key === "Escape") setEditingCategory("");
                          }}
                          autoFocus
                          style={{ padding: "8px", borderRadius: "6px", border: "1px solid #d1d5db", flex: 1, minWidth: "180px" }}
                        />
                        <button onClick={handleRenameCategory} style={{ ...commonStyles.greenButton, margin: 0, padding: "6px 12px" }}>
                          Save
                        </button>
                        <button
                          onClick={() => setEditingCategory("")}
                          style={{ ...commonStyles.backButton, margin: 0, width: "auto", padding: "6px 12px" }}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <span style={{ flex: 1, minWidth: "160px", fontWeight: 600 }}>{category}</span>
                        <span style={{ color: "#6b7280", fontSize: "0.85rem" }}>
                          {count} image{count === 1 ? "" : "s"}
                        </span>
                        <button
                          onClick={() => {
                            setEditingCategory(category);
                            setCategoryRenameDraft(category);
                          }}
                          style={{ ...commonStyles.orangeButton, margin: 0, padding: "6px 10px" }}
                        >
                          <MdModeEdit size={16} color="white" />
                        </button>
                        <button
                          onClick={() => handleDeleteCategory(category)}
                          disabled={category === "Uncategorized"}
                          title={category === "Uncategorized" ? "The fallback category cannot be deleted" : "Delete category"}
                          style={{
                            ...commonStyles.redButton,
                            margin: 0,
                            padding: "6px 10px",
                            opacity: category === "Uncategorized" ? 0.4 : 1,
                          }}
                        >
                          <MdDelete size={16} color="white" />
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {visibleMediaItems.length === 0 ? (
            <div style={{ background: "#f5f5f5", borderRadius: "8px", padding: "30px", textAlign: "center", color: "#6b7280" }}>
              No saved media yet. Images you generate in the Design tab are saved here automatically.
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "14px" }}>
              {visibleMediaItems.map((item) => (
                <div key={item.id} style={{ border: "1px solid #d1d5db", borderRadius: "8px", overflow: "hidden", background: "#fff" }}>
                  {item.type === "video" ? (
                    <video
                      src={item.url}
                      controls
                      muted
                      playsInline
                      style={{ width: "100%", aspectRatio: "16 / 9", objectFit: "cover", display: "block", background: "#000" }}
                    />
                  ) : (
                    <img
                      src={item.url}
                      alt={item.prompt || "Saved media"}
                      style={{ width: "100%", aspectRatio: "16 / 9", objectFit: "cover", display: "block" }}
                    />
                  )}
                  <div style={{ padding: "10px", display: "flex", flexDirection: "column", gap: "8px" }}>
                    <div style={{ fontSize: "0.85rem", color: "#374151", minHeight: "34px" }}>
                      {String(item.prompt || "No description").slice(0, 90)}
                    </div>
                    <select
                      value={item.category || "Uncategorized"}
                      onChange={(e) => handleChangeMediaCategory(item, e.target.value)}
                      style={{ padding: "6px", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "0.85rem" }}
                    >
                      {mediaCategories.map((category) => (
                        <option key={category} value={category}>{category}</option>
                      ))}
                    </select>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <button
                        onClick={() => handleUseMediaAsBackground(item)}
                        style={{ ...commonStyles.indigoButton, margin: 0, padding: "8px 10px", flex: 1, fontSize: "0.85rem" }}
                      >
                        {item.type === "video" ? "▶ Push Live" : "Use"}
                      </button>
                      <button
                        onClick={() => handleDeleteMedia(item)}
                        style={{ ...commonStyles.redButton, margin: 0, padding: "8px 10px" }}
                      >
                        <MdDelete size={18} color="white" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "props" && (
        <div style={{ order: 10, ...panelStyle }}>
          <h2 style={panelHeadingStyle}>Props</h2>
          <p style={{ color: "#6b7280", marginTop: "-6px", marginBottom: "15px" }}>
            Upload one or more overlay images (logos, icons, lower-thirds), then broadcast them on top of
            the current screen, save them to Media, or add them to a playlist.
          </p>

          <div style={{ border: "1px solid #e5e7eb", background: "#f9fafb", borderRadius: "8px", padding: "12px", marginBottom: "15px" }}>
            <strong style={{ display: "block", marginBottom: "10px" }}>Upload Image(s)</strong>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={handlePropImagesUpload}
              disabled={uploadingProps}
              style={{ marginBottom: "10px" }}
            />
            {uploadingProps && <div style={{ color: "#4F46E5" }}>Uploading...</div>}

            <div style={{ display: "flex", gap: "20px", flexWrap: "wrap", alignItems: "center", marginTop: "10px" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: "220px" }}>
                <span style={{ fontWeight: 600 }}>Size ({propSize}%)</span>
                <input
                  type="range"
                  min="10"
                  max="100"
                  value={propSize}
                  onChange={(e) => setPropSize(Number(e.target.value))}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <span style={{ fontWeight: 600 }}>Backdrop Color</span>
                <input
                  type="color"
                  value={propColor}
                  onChange={(e) => setPropColor(e.target.value)}
                  style={{ width: "60px", height: "36px", padding: "2px", border: "1px solid #d1d5db", borderRadius: "6px" }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: "200px" }}>
                <span style={{ fontWeight: 600 }}>Save to Category</span>
                <select
                  value={mediaCategory}
                  onChange={(e) => setMediaCategory(e.target.value)}
                  style={{ padding: "10px", borderRadius: "8px", border: "1px solid #d1d5db" }}
                >
                  {mediaCategories.map((category) => (
                    <option key={category} value={category}>{category}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {broadcast?.propUrl && (
            <div style={{ border: "1px solid #10b981", background: "#ecfdf5", borderRadius: "8px", padding: "12px", marginBottom: "15px", display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
              <img src={broadcast.propUrl} alt="Live prop" style={{ width: "64px", height: "64px", objectFit: "contain", background: broadcast.propColor || "#fff", borderRadius: "6px" }} />
              <strong style={{ color: "#065f46" }}>Currently live on screen</strong>
              <button onClick={handleClearProp} style={{ ...commonStyles.redButton, margin: 0, padding: "8px 14px" }}>
                Clear Prop
              </button>
            </div>
          )}

          {propImages.length === 0 ? (
            <div style={{ background: "#f5f5f5", borderRadius: "8px", padding: "30px", textAlign: "center", color: "#6b7280" }}>
              No images uploaded yet. Choose one or more images above to get started.
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "14px" }}>
              {propImages.map((propItem) => (
                <div key={propItem.id} style={{ border: "1px solid #d1d5db", borderRadius: "8px", overflow: "hidden", background: "#fff" }}>
                  <div style={{ background: propColor, display: "flex", alignItems: "center", justifyContent: "center", aspectRatio: "1 / 1" }}>
                    <img src={propItem.url} alt={propItem.name} style={{ width: `${propSize}%`, objectFit: "contain" }} />
                  </div>
                  <div style={{ padding: "10px", display: "flex", flexDirection: "column", gap: "8px" }}>
                    <div style={{ fontSize: "0.85rem", color: "#374151" }}>{propItem.name}</div>
                    <button
                      onClick={() => handlePushPropLive(propItem)}
                      style={{ ...commonStyles.indigoButton, margin: 0, padding: "8px 10px", fontSize: "0.85rem" }}
                    >
                      📡 Broadcast
                    </button>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <button
                        onClick={() => handleSavePropToMedia(propItem)}
                        style={{ ...commonStyles.greenButton, margin: 0, padding: "8px 10px", flex: 1, fontSize: "0.85rem" }}
                      >
                        💾 Save
                      </button>
                      <button
                        onClick={() => handleAddPropToPlaylist(propItem)}
                        style={{ ...commonStyles.orangeButton, margin: 0, padding: "8px 10px", flex: 1, fontSize: "0.85rem" }}
                      >
                        ➕ Playlist
                      </button>
                      <button
                        onClick={() => handleRemovePropImage(propItem)}
                        style={{ ...commonStyles.redButton, margin: 0, padding: "8px 10px" }}
                      >
                        <MdDelete size={16} color="white" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "screens" && (
      <div style={{ order: 10, ...panelStyle }}>
      {/* Broadcast Screen Management */}
      <div style={{ marginBottom: "20px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "15px",
          }}
        >
          <h2 style={commonStyles.title}>Broadcast Screens</h2>
          <button
            onClick={() => setShowNewBroadcastModal(true)}
            style={commonStyles.greenButton}
          >
            Add New Screen
          </button>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}
        >
          {broadcasts.map((b) => (
            <div
              key={b.id}
              style={{
                display: "flex",
                alignItems: "center",
                padding: "8px 12px",
                backgroundColor: b.id === broadcastId ? "#dbeafe" : "#ffffff",
                border: `1px solid ${
                  b.id === broadcastId ? "#2563eb" : "#e5e7eb"
                }`,
                borderRadius: "8px",
                gap: "8px",
              }}
            >
              <div style={{ flex: 1, overflow: "hidden" }}>
                <h3
                  style={{
                    margin: 0,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {b.name}
                </h3>
              </div>
              <div style={{ display: "flex", gap: "4px" }}>
                <button
                  onClick={() => {
                    setBroadcastId(b.id);
                    setBroadcast(b);
                  }}
                  style={{
                    ...screenButtonStyles,
                    ...(b.id === broadcastId
                      ? commonStyles.greenButton
                      : commonStyles.indigoButton),
                    margin: 0,
                  }}
                >
                  {b.id === broadcastId ? "Active" : "Select"}
                </button>
                <button
                  onClick={() => {
                    setRenamingBroadcast(b);
                    setNewName(b.name);
                    setShowRenameModal(true);
                  }}
                  style={{
                    ...screenButtonStyles,
                    ...commonStyles.orangeButton,
                    margin: 0,
                    padding: "6px 8px",
                  }}
                >
                  ✏️
                </button>
                <button
                  onClick={() => {
                    const url = `${window.location.origin}/church/${id}/broadcast/${b.id}?muted=1`;
                    window.open(url, "_blank", "noopener,noreferrer");
                  }}
                  title="Open Broadcast"
                  style={{
                    ...screenButtonStyles,
                    ...commonStyles.indigoButton,
                    margin: 0,
                    padding: "6px 8px",
                  }}
                >
                  ↗
                </button>
                <button
                  onClick={() => {
                    const url = `${window.location.origin}/church/${id}/broadcast/${b.id}?muted=1&variant=mobile`;
                    window.open(url, "_blank", "noopener,noreferrer");
                  }}
                  title="Open Mobile (mic + translation + reactions)"
                  style={{
                    ...screenButtonStyles,
                    ...commonStyles.indigoButton,
                    margin: 0,
                    padding: "6px 8px",
                  }}
                >
                  📱
                </button>
                <button
                  onClick={() => {
                    const url = `${window.location.origin}/church/${id}/broadcast/${b.id}?variant=tv`;
                    window.open(url, "_blank", "noopener,noreferrer");
                  }}
                  title="Open TV (no microphone or translation)"
                  style={{
                    ...screenButtonStyles,
                    ...commonStyles.indigoButton,
                    margin: 0,
                    padding: "6px 8px",
                  }}
                >
                  📺
                </button>
                <button
                  onClick={() => {
                    const url = `${window.location.origin}/church/${id}/broadcast/${b.id}`;
                    navigator.clipboard.writeText(url);
                    toast.success("Link copied!");
                  }}
                  style={{
                    ...screenButtonStyles,
                    ...commonStyles.orangeButton,
                    margin: 0,
                    padding: "6px 8px",
                  }}
                >
                  📋
                </button>
                <button
                  onClick={() => deleteBroadcast(b.id)}
                  style={{
                    ...screenButtonStyles,
                    ...commonStyles.redButton,
                    margin: 0,
                    padding: "6px 8px",
                  }}
                  disabled={broadcasts.length <= 1}
                >
                  🗑️
                </button>
              </div>
            </div>
          ))}
        </div>

      </div>
      </div>
      )}

      {/* New Broadcast Modal */}
      {showNewBroadcastModal && (
        <div
          className="edit-song-overlay"
          onClick={(e) => {
            if (e.target.classList.contains("edit-song-overlay")) {
              setShowNewBroadcastModal(false);
            }
          }}
        >
          <div className="edit-song-modal">
            <div className="edit-song-header">
              <h2 className="edit-song-title">New Broadcast Screen</h2>
              <IoMdClose
                size={25}
                onClick={() => setShowNewBroadcastModal(false)}
                className="close-icon"
              />
            </div>
            <div style={{ padding: "20px" }}>
              <label className="form-label">Screen Name</label>
              <input
                type="text"
                value={newBroadcastName}
                onChange={(e) => setNewBroadcastName(e.target.value)}
                placeholder="Enter screen name..."
                className="form-input"
              />
              <div
                style={{ display: "flex", gap: "10px", marginTop: "20px" }}
              >
                <button
                  onClick={() => setShowNewBroadcastModal(false)}
                  style={commonStyles.redButton}
                >
                  Cancel
                </button>
                <button
                  onClick={createNewBroadcast}
                  style={commonStyles.greenButton}
                >
                  Create Screen
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Rename Modal */}
      {showRenameModal && (
        <div
          className="edit-song-overlay"
          onClick={(e) => {
            if (e.target.classList.contains("edit-song-overlay")) {
              setShowRenameModal(false);
              setRenamingBroadcast(null);
              setNewName("");
            }
          }}
        >
          <div className="edit-song-modal">
            <div className="edit-song-header">
              <h2 className="edit-song-title">Rename Screen</h2>
              <IoMdClose
                size={25}
                onClick={() => {
                  setShowRenameModal(false);
                  setRenamingBroadcast(null);
                  setNewName("");
                }}
                className="close-icon"
              />
            </div>
            <div style={{ padding: "20px" }}>
              <label className="form-label">Screen Name</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Enter new screen name..."
                className="form-input"
              />
              <div
                style={{ display: "flex", gap: "10px", marginTop: "20px" }}
              >
                <button
                  onClick={() => {
                    setShowRenameModal(false);
                    setRenamingBroadcast(null);
                    setNewName("");
                  }}
                  style={commonStyles.redButton}
                >
                  Cancel
                </button>
                <button onClick={handleRename} style={commonStyles.greenButton}>
                  Rename Screen
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Song Modal */}
      {showAddSongModal && (
        <div className="edit-song-overlay" onClick={handleModalClick}>
          <div className="edit-song-modal">
            <div className="edit-song-header">
              <h2 className="edit-song-title">Add New Song</h2>
              <IoMdClose
                size={25}
                onClick={() => {
                  setShowAddSongModal(false);
                  setSongForm({ title: "", lyrics: [""] });
                }}
                className="close-icon"
              />
            </div>
            <form onSubmit={handleAddSong} className="edit-song-form">
              <div className="form-group">
                <label className="form-label">Title</label>
                <div style={{ display: "flex", gap: "10px" }}>
                  <input
                    type="text"
                    value={songForm.title}
                    placeholder="Enter title..."
                    className="form-input"
                    style={{ flex: 1 }}
                    onChange={(e) =>
                      setSongForm({ ...songForm, title: e.target.value })
                    }
                    required
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      if (!songForm.title.trim()) {
                        toast.error("Please enter a song title first");
                        return;
                      }
                      setUpdatingSong(true);
                      try {
                        const fetchedLyrics = await fetchSongLyrics(
                          songForm.title
                        );
                        if (fetchedLyrics && fetchedLyrics.length > 0) {
                          const useAILyrics = window.confirm(
                            "Lyrics found! Would you like to use these lyrics?\n\nFirst verse preview:\n" +
                              fetchedLyrics[0]
                          );
                          if (useAILyrics) {
                            setSongForm((prev) => ({
                              ...prev,
                              lyrics: fetchedLyrics,
                            }));
                            toast.success("Lyrics imported successfully!");
                          }
                        } else {
                          toast.error("No lyrics found for this song");
                        }
                      } catch (err) {
                        console.error("Error fetching lyrics:", err);
                        toast.error("Failed to fetch lyrics");
                      } finally {
                        setUpdatingSong(false);
                      }
                    }}
                    style={{
                      ...commonStyles.indigoButton,
                      margin: 0,
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                      padding: "8px 16px",
                    }}
                    disabled={updatingSong}
                  >
                    {updatingSong ? (
                      <>
                        <span className="animate-spin">🔄</span>
                        Fetching...
                      </>
                    ) : (
                      <>
                        <span role="img" aria-label="sparkles">
                          ✨
                        </span>
                        AI Fetch
                      </>
                    )}
                  </button>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Lyrics</label>
                <div className="lyrics-container">
                  {songForm.lyrics.map((lyric, index) => (
                    <div key={index} className="verse-container">
                      <textarea
                        value={lyric}
                        onChange={(e) => {
                          const newLyrics = [...songForm.lyrics];
                          newLyrics[index] = e.target.value;
                          setSongForm({ ...songForm, lyrics: newLyrics });
                        }}
                        className="verse-textarea"
                        placeholder={`Verse ${index + 1}`}
                        rows="3"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const newLyrics = songForm.lyrics.filter(
                            (_, i) => i !== index
                          );
                          setSongForm({ ...songForm, lyrics: newLyrics });
                        }}
                        style={{ ...commonStyles.redButton, margin: "0" }}
                      >
                        <MdDelete size={20} />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      setSongForm({
                        ...songForm,
                        lyrics: [...songForm.lyrics, ""],
                      })
                    }
                    style={{ ...commonStyles.indigoButton, margin: "0" }}
                  >
                    + Add Verse
                  </button>
                </div>
              </div>
              <div className="edit-modal-footer">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddSongModal(false);
                    setSongForm({ title: "", lyrics: [""] });
                  }}
                  style={{
                    ...commonStyles.redButton,
                    margin: "0",
                    width: "100%",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{
                    ...commonStyles.greenButton,
                    margin: "0",
                    width: "100%",
                  }}
                  disabled={updatingSong}
                >
                  {updatingSong ? "Adding..." : "Add Song"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {activeTab === "design" && (
      <div style={{ order: 10 }}>
      {/* Display Settings */}
      <div
        style={{
          marginBottom: "20px",
          border: "2px solid #e7e7e7",
          padding: "15px",
          borderRadius: "8px",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "flex-start",
          gap: "20px",
          textAlign: "left",
        }}
      >
        <h3 style={{ ...commonStyles.title, margin: "0px", flexBasis: "100%" }}>
          Display Settings
        </h3>

        <div style={{ order: 2, flex: "1 1 380px", minWidth: 0 }}>

        {/* Text Styling */}
        <div style={{ marginBottom: "20px" }}>
          <h4 style={{ marginBottom: "10px" }}>Text Styling</h4>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "10px",
            }}
          >
            {/* Font Family */}
            <div>
              <label>Font Family</label>
              <select
                value={previewSettings.fontFamily}
                onChange={(e) =>
                  handleSettingChange("fontFamily", e.target.value)
                }
                style={{
                  width: "100%",
                  padding: "8px",
                  borderRadius: "6px",
                  border: "1px solid #d1d5db",
                }}
              >
                {FONT_FAMILIES.map((font) => (
                  <option key={font.value} value={font.value}>
                    {font.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Font Size */}
            <div>
              <label>Font Size: {fontSize}px</label>
              <input
                type="range"
                min="12"
                max="96"
                value={previewSettings.fontSize}
                onChange={(e) =>
                  handleSettingChange("fontSize", e.target.value)
                }
                style={{ width: "100%" }}
              />
            </div>

            <div>
              <label htmlFor="design-text-color">Text Color</label>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <input
                  id="design-text-color"
                  type="color"
                  value={previewSettings.fontColor}
                  onChange={(e) => handleSettingChange("fontColor", e.target.value)}
                  aria-label="Choose text color"
                  style={{ width: "52px", height: "40px", padding: "2px", border: "1px solid #d1d5db", borderRadius: "6px", cursor: "pointer" }}
                />
                <input
                  type="text"
                  value={previewSettings.fontColor}
                  onChange={(e) => handleSettingChange("fontColor", e.target.value)}
                  pattern="^#[0-9A-Fa-f]{6}$"
                  aria-label="Text color hex value"
                  style={{ flex: 1, minWidth: 0, padding: "8px", borderRadius: "6px", border: "1px solid #d1d5db", textTransform: "uppercase" }}
                />
              </div>
            </div>
          </div>

          {/* Text Effects */}
          <div style={{ display: "flex", gap: "10px", marginTop: "10px" }}>
            <button
              onClick={() =>
                handleSettingChange("isBold", !previewSettings.isBold)
              }
              style={{
                padding: "8px 16px",
                borderRadius: "6px",
                border: "1px solid #d1d5db",
                backgroundColor: previewSettings.isBold ? "#e5e7eb" : "#fff",
              }}
            >
              Bold
            </button>
            <button
              onClick={() =>
                handleSettingChange("isItalic", !previewSettings.isItalic)
              }
              style={{
                padding: "8px 16px",
                borderRadius: "6px",
                border: "1px solid #d1d5db",
                backgroundColor: previewSettings.isItalic ? "#e5e7eb" : "#fff",
              }}
            >
              Italic
            </button>
            <button
              onClick={() =>
                handleSettingChange("isUpperCase", !previewSettings.isUpperCase)
              }
              style={{
                padding: "8px 16px",
                borderRadius: "6px",
                border: "1px solid #d1d5db",
                backgroundColor: previewSettings.isUpperCase
                  ? "#e5e7eb"
                  : "#fff",
              }}
            >
              CAPS
            </button>
          </div>

          {/* Text Shadow and Blur */}
          <div style={{ marginTop: "10px" }}>
            <label>Text Shadow</label>
            <select
              value={previewSettings.textShadow}
              onChange={(e) =>
                handleSettingChange("textShadow", e.target.value)
              }
              style={{
                width: "100%",
                padding: "8px",
                borderRadius: "6px",
                border: "1px solid #d1d5db",
              }}
            >
              <option value="none">None</option>
              <option value="2px 2px 4px rgba(0,0,0,0.5)">Light Shadow</option>
              <option value="4px 4px 8px rgba(0,0,0,0.5)">Medium Shadow</option>
              <option value="6px 6px 12px rgba(0,0,0,0.5)">Heavy Shadow</option>
              <option value="0 0 8px rgba(255,255,255,0.5)">Glow Effect</option>
            </select>
          </div>

          <div style={{ marginTop: "10px" }}>
            <label>Text Blur: {previewSettings.textBlur}px</label>
            <input
              type="range"
              min="0"
              max="10"
              value={previewSettings.textBlur}
              onChange={(e) =>
                handleSettingChange("textBlur", e.target.value)
              }
              style={{ width: "100%" }}
            />
          </div>
        </div>

        {/* Background Settings */}
        <div>
          <h4 style={{ marginBottom: "10px" }}>Background Settings</h4>
          <div style={{ marginBottom: "10px" }}>
            <select
              value={previewSettings.backgroundType}
              onChange={(e) => {
                const type = e.target.value;
                const newSettings = { ...previewSettings };

                newSettings.backgroundType = type;

                switch (type) {
                  case "solid":
                    newSettings.backgroundColor = "#1e3a8a";
                    break;
                  case "gradient":
                    newSettings.gradientColors = ["#1e3a8a", "#3b82f6"];
                    newSettings.gradientAngle = 45;
                    break;
                  case "ai":
                  case "image":
                    if (!newSettings.backgroundColor?.startsWith("http")) {
                      newSettings.backgroundColor = "";
                    }
                    break;
                }

                setPreviewSettings(newSettings);
              }}
              style={{
                width: "100%",
                padding: "8px",
                borderRadius: "6px",
                border: "1px solid #d1d5db",
              }}
            >
              <option value="solid">Solid Color</option>
              <option value="gradient">Gradient</option>
              <option value="ai">AI Generated Background</option>
              <option value="image">AI Generated Image</option>
            </select>
          </div>

          {previewSettings.backgroundType === "solid" && (
            <div>
              <label>Background Color</label>
              <input
                type="color"
                value={previewSettings.backgroundColor}
                onChange={(e) =>
                  handleSettingChange("backgroundColor", e.target.value)
                }
                style={{ width: "100%", height: "50px" }}
              />
            </div>
          )}

          {previewSettings.backgroundType === "gradient" && (
            <div>
              <div
                style={{
                  display: "flex",
                  gap: "10px",
                  marginBottom: "10px",
                }}
              >
                <div style={{ flex: 1 }}>
                  <label>Color 1</label>
                  <input
                    type="color"
                    value={previewSettings.gradientColors[0]}
                    onChange={(e) =>
                      handleSettingChange("gradientColors", [
                        e.target.value,
                        previewSettings.gradientColors[1],
                      ])
                    }
                    style={{ width: "100%", height: "50px" }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label>Color 2</label>
                  <input
                    type="color"
                    value={previewSettings.gradientColors[1]}
                    onChange={(e) =>
                      handleSettingChange("gradientColors", [
                        previewSettings.gradientColors[0],
                        e.target.value,
                      ])
                    }
                    style={{ width: "100%", height: "50px" }}
                  />
                </div>
              </div>
              <div>
                <label>Gradient Angle: {previewSettings.gradientAngle}°</label>
                <input
                  type="range"
                  min="0"
                  max="360"
                  value={previewSettings.gradientAngle}
                  onChange={(e) =>
                    handleSettingChange("gradientAngle", e.target.value)
                  }
                  style={{ width: "100%" }}
                />
              </div>
            </div>
          )}

          {(previewSettings.backgroundType === "ai" ||
            previewSettings.backgroundType === "image") && (
            <div style={{ marginBottom: "10px" }}>
              <label>Image Blur: {backgroundBlur}px</label>
              <input
                type="range"
                min="0"
                max="30"
                value={backgroundBlur}
                onChange={(e) => setBackgroundBlur(Number(e.target.value))}
                style={{ width: "100%" }}
              />
              <small style={{ color: "#6b7280" }}>
                Blurs the background image only, keeping text sharp.
              </small>
            </div>
          )}

          {(previewSettings.backgroundType === "ai" ||
            previewSettings.backgroundType === "image") && (
            <div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                }}
              >
                <label style={{ fontWeight: 600, textAlign: "left" }}>Save to Category</label>
                <select
                  value={mediaCategory}
                  onChange={(e) => setMediaCategory(e.target.value)}
                  disabled={generatingImage}
                  style={{
                    width: "100%",
                    padding: "10px",
                    borderRadius: "6px",
                    border: "1px solid #d1d5db",
                  }}
                >
                  {mediaCategories.map((category) => (
                    <option key={category} value={category}>{category}</option>
                  ))}
                </select>
                <label style={{ fontWeight: 600, textAlign: "left" }}>Image Style</label>
                <select
                  value={aiStyle}
                  onChange={(e) => setAiStyle(e.target.value)}
                  disabled={generatingImage}
                  style={{
                    width: "100%",
                    padding: "10px",
                    borderRadius: "6px",
                    border: "1px solid #d1d5db",
                  }}
                >
                  {AI_IMAGE_STYLES.map((style) => (
                    <option key={style.value} value={style.value}>{style.label}</option>
                  ))}
                </select>
                <textarea
                  id="aiPrompt"
                  placeholder={
                    previewSettings.backgroundType === "ai"
                      ? "Describe your desired background... (e.g., 'Sunrise over misty mountains', 'Soft blue and purple light', 'Wooden cross on a hillside')"
                      : "Describe your desired image... (e.g., 'A serene mountain landscape', 'Beautiful church interior', 'Hands raised in worship')"
                  }
                  style={{
                    width: "100%",
                    padding: "12px",
                    borderRadius: "6px",
                    border: "1px solid #d1d5db",
                    minHeight: "80px",
                    resize: "vertical",
                  }}
                  disabled={generatingImage}
                />
                <div style={{ display: "flex", gap: "10px" }}>
                  <button
                    onClick={() => {
                      setGeneratingImage(true);
                      generateAIBackground(
                        document.getElementById("aiPrompt").value,
                        previewSettings.backgroundType,
                        aiStyle
                      ).finally(() => setGeneratingImage(false));
                    }}
                    style={{
                      ...commonStyles.indigoButton,
                      flex: "1",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "8px",
                      opacity: generatingImage ? 0.7 : 1,
                    }}
                    disabled={generatingImage}
                  >
                    {generatingImage ? (
                      <>
                        <span className="animate-spin">🔄</span>
                        Generating...
                      </>
                    ) : (
                      <>
                        <span role="img" aria-label="sparkles">
                          ✨
                        </span>
                        Generate{" "}
                        {previewSettings.backgroundType === "ai"
                          ? "Background"
                          : "Image"}
                      </>
                    )}
                  </button>
                </div>
                {aiCandidates.length > 0 && (
                  <div style={{ marginTop: "6px" }}>
                    <div style={{ fontWeight: 600, textAlign: "left", marginBottom: "8px" }}>
                      Choose an option ({aiCandidates.length})
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "10px" }}>
                      {aiCandidates.map((candidate, candidateIndex) => {
                        const candidateUrl = candidate.url;
                        const isSelected = previewSettings.backgroundColor === candidateUrl;
                        return (
                          <div
                            key={candidateUrl}
                            onClick={() =>
                              setPreviewSettings((prev) => ({ ...prev, backgroundColor: candidateUrl }))
                            }
                            role="button"
                            tabIndex={0}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                setPreviewSettings((prev) => ({ ...prev, backgroundColor: candidateUrl }));
                              }
                            }}
                            style={{
                              padding: "0 0 8px 0",
                              border: isSelected ? "3px solid #4F46E5" : "1px solid #d1d5db",
                              borderRadius: "8px",
                              overflow: "hidden",
                              cursor: "pointer",
                              background: "#fff",
                              position: "relative",
                            }}
                          >
                            <img
                              src={candidateUrl}
                              alt={`AI option ${candidateIndex + 1}`}
                              style={{ width: "100%", aspectRatio: "16 / 9", objectFit: "cover", display: "block" }}
                            />
                            <span
                              style={{
                                position: "absolute",
                                bottom: "6px",
                                left: "6px",
                                background: isSelected ? "#4F46E5" : "rgba(0,0,0,0.6)",
                                color: "#fff",
                                borderRadius: "999px",
                                padding: "3px 10px",
                                fontSize: "0.78rem",
                                fontWeight: 700,
                              }}
                            >
                              {isSelected ? "✓ Selected" : `Option ${candidateIndex + 1}`}
                            </span>
                            <div style={{ display: "flex", gap: "6px", padding: "8px 8px 0" }}>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  saveCandidateToMedia(candidate);
                                }}
                                style={{ ...commonStyles.orangeButton, margin: 0, padding: "6px 8px", flex: 1, fontSize: "0.78rem" }}
                              >
                                💾 Save to Media
                              </button>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  pushCandidateLive(candidate);
                                }}
                                style={{ ...commonStyles.greenButton, margin: 0, padding: "6px 8px", flex: 1, fontSize: "0.78rem" }}
                              >
                                ▶ Push Live
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <small style={{ color: "#6b7280", display: "block", marginTop: "6px" }}>
                      Pick one, then press Apply Changes to send it live, or Save to Media to keep it for later.
                    </small>
                  </div>
                )}
                <small style={{ color: "#6b7280", marginTop: "4px" }}>
                  {previewSettings.backgroundType === "ai"
                    ? "Pick a style above, then describe the scene. Backgrounds are kept low contrast so lyrics stay readable."
                    : "Pick a style above, then describe the scene. Try 'Sunrise over a calm lake', 'Empty sanctuary at golden hour', 'Open Bible on a wooden table'."}
                </small>
              </div>
            </div>
          )}
        </div>

        </div>

        <div style={{ order: 1, flex: "1 1 420px", minWidth: 0, position: "sticky", top: "12px" }}>

        {/* Preview Box */}
        <div
          className="p-4 rounded mt-4"
          style={{
            ...(previewSettings.backgroundType === "gradient"
              ? {
                  backgroundImage: `linear-gradient(${previewSettings.gradientAngle}deg, ${previewSettings.gradientColors[0]}, ${previewSettings.gradientColors[1]})`,
                }
              : previewSettings.backgroundType === "ai" ||
                previewSettings.backgroundType === "image"
              ? {
                  backgroundImage: backgroundBlur > 0 ? "none" : `url("${previewSettings.backgroundColor}")`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                  backgroundRepeat: "no-repeat",
                }
              : {
                  backgroundColor: previewSettings.backgroundColor,
                }),
            minHeight: "320px",
            aspectRatio: "16 / 9",
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            position: "relative",
            overflow: "hidden",
          }}
        >
          {backgroundBlur > 0 &&
            (previewSettings.backgroundType === "ai" || previewSettings.backgroundType === "image") && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                backgroundImage: `url("${previewSettings.backgroundColor}")`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                filter: `blur(${backgroundBlur}px)`,
                transform: "scale(1.1)",
                pointerEvents: "none",
                zIndex: 0,
              }}
            />
          )}
          {previewSettings.backgroundType === "ai" && (
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: "rgba(0, 0, 0, 0.4)",
                pointerEvents: "none",
              }}
            />
          )}
          <span
            style={{
              position: "relative",
              zIndex: 1,
              color: previewSettings.fontColor,
              fontSize: `${previewSettings.fontSize}px`,
              fontFamily: previewSettings.fontFamily,
              fontWeight: previewSettings.isBold ? "bold" : "normal",
              fontStyle: previewSettings.isItalic ? "italic" : "normal",
              textShadow: previewSettings.textShadow,
              filter: `blur(${previewSettings.textBlur}px)`,
              textTransform: previewSettings.isUpperCase ? "uppercase" : "none",
            }}
          >
            Preview Text
          </span>
        </div>

        {showDesignSaveForm && (
          <div
            style={{
              marginTop: "16px",
              padding: "12px",
              border: "1px solid #bbf7d0",
              background: "#f0fdf4",
              borderRadius: "8px",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
            }}
          >
            <strong style={{ color: "#166534" }}>Save this design to a playlist</strong>
            <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "0.85rem" }}>
              Design name
              <input
                type="text"
                value={designSaveName}
                onChange={(e) => setDesignSaveName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddDesignToPlaylist();
                  if (e.key === "Escape") setShowDesignSaveForm(false);
                }}
                autoFocus
                placeholder="e.g. Worship background"
                style={{ padding: "10px", borderRadius: "6px", border: "1px solid #d1d5db" }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "0.85rem" }}>
              Playlist
              <select
                value={designSavePlaylistId}
                onChange={(e) => setDesignSavePlaylistId(e.target.value)}
                style={{ padding: "10px", borderRadius: "6px", border: "1px solid #d1d5db" }}
              >
                <option value="">{playlists.length ? "Select a playlist" : "No playlists yet"}</option>
                {playlists.map((playlist) => (
                  <option key={playlist.id} value={playlist.id}>{playlist.name}</option>
                ))}
              </select>
            </label>
            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button
                onClick={() => setShowDesignSaveForm(false)}
                style={{
                  padding: "8px 16px",
                  borderRadius: "6px",
                  border: "1px solid #d1d5db",
                  backgroundColor: "#fff",
                  color: "#374151",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleAddDesignToPlaylist}
                style={{ ...commonStyles.greenButton, margin: 0, padding: "8px 16px" }}
              >
                Save to Playlist
              </button>
            </div>
          </div>
        )}

        {/* Replace the preview box buttons section with this: */}
        <div
          style={{
            marginTop: "20px",
            padding: "15px",
            borderTop: "1px solid #e5e7eb",
            display: "flex",
            justifyContent: "flex-end",
            gap: "10px",
          }}
        >
          <button
            onClick={() => setPreviewSettings({ ...liveSettings })}
            style={{
              padding: "8px 16px",
              borderRadius: "6px",
              border: "1px solid #d1d5db",
              backgroundColor: "#fff",
              color: "#374151",
            }}
          >
            Reset
          </button>
          <button
            onClick={handleSaveCurrentToMedia}
            title="Save the current background image to your Media library"
            style={{
              ...commonStyles.orangeButton,
              margin: 0,
              padding: "8px 16px",
            }}
          >
            💾 Save to Media
          </button>
          <button
            onClick={openDesignSaveForm}
            style={{
              ...commonStyles.greenButton,
              margin: 0,
              padding: "8px 16px",
            }}
          >
            + Add to Playlist
          </button>
          <button
            onClick={handleApplyChanges}
            style={{
              ...commonStyles.indigoButton,
              margin: 0,
              padding: "8px 16px",
            }}
          >
            Apply Changes
          </button>
        </div>
        </div>
      </div>
      </div>
      )}

      {/* Microphone Control */}
      {activeTab === "live" && (
      <div style={{ order: 40, ...panelStyle }}>
      <div style={{ margin: "20px" }}>
        <h2 style={commonStyles.title}>Reactions</h2>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "10px" }}>
          {REACTION_TYPES.map((reaction) => (
            <div
              key={reaction.key}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "2px",
                border: "1px solid #e5e7eb",
                borderRadius: "10px",
                padding: "8px 14px",
                background: "#f9fafb",
                minWidth: "64px",
              }}
            >
              <span style={{ fontSize: "1.4rem", lineHeight: 1 }}>{reaction.emoji}</span>
              <span style={{ fontWeight: 700, color: "#374151" }}>
                {Number(broadcast?.reactionCounts?.[reaction.key]) || 0}
              </span>
            </div>
          ))}
        </div>
        <button onClick={handleResetReactions} style={{ ...commonStyles.backButton, margin: 0, width: "auto", padding: "8px 16px" }}>
          Reset Reactions
        </button>
      </div>
      <div style={{ margin: "20px" }}>
        <h2 style={commonStyles.title}>Microphone</h2>
        <button
          onClick={toggleMicrophone}
          style={
            broadcast?.micEnabled
              ? commonStyles.redButton
              : commonStyles.indigoButton
          }
        >
          {broadcast?.micEnabled ? "Disable Microphone" : "Enable Microphone"}
        </button>

        {broadcast?.micEnabled && (
          <div style={{ marginTop: "14px", textAlign: "left" }}>
            {audioStream ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
                  <span
                    style={{
                      background: micLevel > 2 ? "#dc2626" : "#9ca3af",
                      color: "#fff",
                      borderRadius: "999px",
                      padding: "2px 10px",
                      fontSize: "0.72rem",
                      fontWeight: 700,
                      letterSpacing: "0.05em",
                    }}
                  >
                    ● LIVE
                  </span>
                  <span style={{ fontSize: "0.85rem", color: "#4b5563" }}>
                    {micLevel > 2 ? "Audio is going out" : "No sound detected - check your mic"}
                  </span>
                </div>

                <div style={{ display: "flex", gap: "3px", alignItems: "flex-end", height: "40px" }}>
                  {Array.from({ length: 24 }).map((_, barIndex) => {
                    const threshold = ((barIndex + 1) / 24) * 100;
                    const isActive = micLevel >= threshold;
                    const barColor = threshold > 85 ? "#dc2626" : threshold > 60 ? "#f59e0b" : "#10b981";
                    return (
                      <div
                        key={barIndex}
                        style={{
                          flex: 1,
                          height: `${20 + (barIndex / 24) * 20}px`,
                          borderRadius: "2px",
                          background: isActive ? barColor : "#e5e7eb",
                          transition: "background 80ms linear",
                        }}
                      />
                    );
                  })}
                </div>
              </>
            ) : (
              <div style={{ padding: "10px", borderRadius: "6px", background: "#fef3c7", border: "1px solid #fde68a", fontSize: "0.85rem", color: "#92400e" }}>
                This screen is marked as live, but this browser is not capturing audio (the page was
                probably reloaded). Click Disable Microphone, then Enable Microphone again.
              </div>
            )}
          </div>
        )}

        <div style={{ marginTop: "20px", paddingTop: "16px", borderTop: "1px solid #e5e7eb" }}>
          <h3 style={{ margin: "0 0 10px 0", fontSize: "1rem", fontWeight: 700 }}>
            🌐 Live Translation
          </h3>
          <p style={{ margin: "0 0 12px 0", color: "#6b7280", fontSize: "0.85rem" }}>
            Listens to your microphone, translates with Gemini, and sends captions to viewers.
            Each viewer picks their own language on the broadcast screen.
          </p>

          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center", marginBottom: "12px" }}>
            <button
              onClick={() => setTranslationEnabled((previous) => !previous)}
              style={translationEnabled ? commonStyles.redButton : commonStyles.greenButton}
            >
              {translationEnabled ? "⏹ Stop Translation" : "▶ Start Translation"}
            </button>

            <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "0.85rem", textAlign: "left" }}>
              Spoken language
              <select
                value={speechLanguage}
                onChange={(e) => setSpeechLanguage(e.target.value)}
                style={{ padding: "8px", borderRadius: "6px", border: "1px solid #d1d5db", minWidth: "180px" }}
              >
                {TRANSLATION_LANGUAGES.map((language) => (
                  <option key={language.code} value={language.speech}>{language.label}</option>
                ))}
              </select>
            </label>

            {translationEnabled && (
              <button onClick={handleClearCaption} style={{ ...commonStyles.backButton, margin: 0, width: "auto", padding: "10px 16px" }}>
                Clear Caption
              </button>
            )}
          </div>

          <div style={{ textAlign: "left", marginBottom: "10px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              <strong style={{ fontSize: "0.85rem" }}>
                Languages available to viewers ({targetLanguages.length}):
              </strong>
              {targetLanguages.length > 0 && (
                <button
                  onClick={() => { setTargetLanguages([]); setDefaultLanguage(""); }}
                  style={{ border: "1px solid #d1d5db", borderRadius: "6px", padding: "4px 10px", background: "#fff", fontSize: "0.78rem", cursor: "pointer" }}
                >
                  Clear all
                </button>
              )}
            </div>

            <input
              type="search"
              value={languageSearch}
              onChange={(e) => setLanguageSearch(e.target.value)}
              placeholder="Search all 48 languages (e.g. Korean, Tagalog, Kreyòl)"
              style={{
                width: "100%",
                marginTop: "8px",
                padding: "9px 10px",
                borderRadius: "6px",
                border: "1px solid #d1d5db",
                fontSize: "0.85rem",
              }}
            />

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))",
                gap: "6px",
                marginTop: "8px",
                maxHeight: "190px",
                overflowY: "auto",
                border: "1px solid #e5e7eb",
                borderRadius: "6px",
                padding: "10px",
              }}
            >
              {visibleLanguages.length === 0 ? (
                <div style={{ color: "#6b7280", fontSize: "0.85rem" }}>No language matches that search.</div>
              ) : (
                visibleLanguages.map((language) => (
                  <label key={language.code} style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "0.85rem" }}>
                    <input
                      type="checkbox"
                      checked={targetLanguages.includes(language.code)}
                      onChange={(e) => {
                        const isChecked = e.target.checked;
                        setTargetLanguages((previous) => {
                          const next = isChecked
                            ? [...previous, language.code]
                            : previous.filter((code) => code !== language.code);
                          setDefaultLanguage((currentDefault) => {
                            if (isChecked && !currentDefault) return language.code;
                            if (!isChecked && currentDefault === language.code) return next[0] || "";
                            return currentDefault;
                          });
                          return next;
                        });
                      }}
                    />
                    {language.label}
                  </label>
                ))
              )}
            </div>

            {!languageSearch.trim() && (
              <small style={{ color: "#6b7280", display: "block", marginTop: "6px" }}>
                Showing the most common languages. Type above to find any of the other 48.
              </small>
            )}

            <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "0.85rem", marginTop: "12px", maxWidth: "280px" }}>
              <strong>Default language for viewers</strong>
              <select
                value={defaultLanguage}
                onChange={(e) => setDefaultLanguage(e.target.value)}
                disabled={targetLanguages.length === 0}
                style={{ padding: "8px", borderRadius: "6px", border: "1px solid #d1d5db" }}
              >
                <option value="">No translation (viewer chooses)</option>
                {targetLanguages.map((code) => (
                  <option key={code} value={code}>
                    {TRANSLATION_LANGUAGES.find((language) => language.code === code)?.label || code}
                  </option>
                ))}
              </select>
              <small style={{ color: "#6b7280" }}>
                Viewers open the broadcast already set to this language.
              </small>
            </label>
          </div>

          {translationEnabled && (
            <div style={{ textAlign: "left", padding: "10px", borderRadius: "6px", background: "#f0fdf4", border: "1px solid #bbf7d0" }}>
              <div style={{ fontSize: "0.8rem", color: "#166534", fontWeight: 700 }}>{translationStatus || "Listening..."}</div>
              {lastCaption && (
                <div style={{ fontSize: "0.85rem", color: "#374151", marginTop: "4px" }}>Sent: {lastCaption}</div>
              )}
            </div>
          )}
        </div>
      </div>
      </div>
      )}

      {/* Replace the existing songs section with this updated version */}
      {activeTab === "songs" && (
      <div style={{ order: 10, ...panelStyle }}>
      <div style={{ marginBottom: "20px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "15px",
          }}
        >
          <h2 style={commonStyles.title}>Songs</h2>
          <button
            onClick={() => setShowAddSongModal(true)}
            style={{
              ...commonStyles.greenButton,
              margin: 0,
              padding: "8px 16px",
            }}
          >
            Add New Song
          </button>
        </div>
        <div
          style={{
            marginBottom: "15px",
            display: "flex",
            alignItems: "center",
            gap: "10px",
          }}
        >
          <input
            type="text"
            placeholder="Search songs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: "100%",
              padding: "10px",
              borderRadius: "8px",
              border: "1px solid #e5e7eb",
              fontSize: "16px",
              outline: "none",
              boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
            }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              style={{
                padding: "10px",
                borderRadius: "8px",
                border: "none",
                backgroundColor: "#ef4444",
                color: "white",
                cursor: "pointer",
              }}
            >
              Clear
            </button>
          )}
        </div>

        {/* Rest of your songs list code remains the same */}
        <div
          style={{
            maxHeight: "460px",
            backgroundColor: "#f5f5f5",
            overflowY: "auto",
            padding: "15px",
            borderRadius: "8px",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: "10px",
          }}
        >
          {filteredSongs.length > 0 ? (
            filteredSongs.map((song, i) => (
              <div
                key={i}
                onClick={() => handleSongSelect(song.id)}
                style={
                  broadcast?.songId === song.id
                    ? {
                        backgroundColor: "#dbeafe",
                        color: "#2563eb",
                        border: "1px solid #2563eb",
                        borderRadius: "8px",
                        padding: "10px",
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                      }
                    : {
                        backgroundColor: "#fff",
                        color: "#1f262e",
                        border: "1px solid #1f262e",
                        borderRadius: "8px",
                        padding: "10px",
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        cursor: "pointer",
                      }
                }
              >
                <p style={{ margin: "0", flex: "1", textAlign: "left" }}>
                  {song.title}
                </p>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "end",
                    gap: "10px",
                  }}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      addItemToPlaylist({ type: "song", songId: song.id, title: song.title });
                    }}
                    title="Add to playlist"
                    style={{
                      ...commonStyles.greenButton,
                      padding: "8px 10px 8px 10px",
                      margin: "0",
                    }}
                  >
                    + Playlist
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingSong(song);
                      const processedLyrics = (song.lyrics || [""]).map(
                        (lyric) =>
                          typeof lyric === "object" ? lyric.text || "" : lyric
                      );
                      setSongForm({
                        title: song.title,
                        lyrics: processedLyrics,
                      });
                      setShowEditSongModal(true);
                    }}
                    style={{
                      ...commonStyles.orangeButton,
                      padding: "8px 10px 8px 10px",
                      margin: "0",
                    }}
                  >
                    <MdModeEdit size={20} color="white" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteSong(song.id);
                    }}
                    style={{
                      ...commonStyles.redButton,
                      padding: "8px 10px 8px 10px",
                      margin: "0",
                    }}
                  >
                    <MdDelete size={20} color="white" />
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div
              style={{
                textAlign: "center",
                padding: "20px",
                color: "#6b7280",
              }}
            >
              No songs found
            </div>
          )}
        </div>

        {broadcast?.songId && (
          <div style={{ marginTop: "15px", padding: "14px", border: "1px solid #bfdbfe", borderRadius: "8px", background: "#eff6ff", textAlign: "left" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", flexWrap: "wrap", marginBottom: "10px" }}>
              <strong style={{ color: "#1e3a8a" }}>
                Select a verse: {songs.find((song) => song.id === broadcast.songId)?.title || "Current song"}
              </strong>
              <span style={{ color: "#475569", fontSize: "0.85rem" }}>
                Verse {(broadcast.currentLyricIndex || 0) + 1} of {songs.find((song) => song.id === broadcast.songId)?.lyrics?.length || 0}
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "8px", maxHeight: "320px", overflowY: "auto" }}>
              {(songs.find((song) => song.id === broadcast.songId)?.lyrics || []).map((verse, verseIndex) => {
                const verseText = typeof verse === "object" ? verse?.text || "" : verse;
                const isActiveVerse = verseIndex === (broadcast.currentLyricIndex || 0);
                return (
                  <button
                    key={`songs-verse-${verseIndex}`}
                    type="button"
                    onClick={async () => {
                      try {
                        await updateDoc(doc(db, `churches/${id}/broadcasts`, broadcastId), {
                          currentLyricIndex: verseIndex,
                          updatedAt: new Date(),
                        });
                      } catch (err) {
                        console.error("Error selecting song verse:", err);
                        toast.error("Could not select this verse.");
                      }
                    }}
                    style={{ textAlign: "left", padding: "10px", borderRadius: "7px", border: isActiveVerse ? "2px solid #2563eb" : "1px solid #cbd5e1", background: isActiveVerse ? "#dbeafe" : "#ffffff", color: "#1e293b", cursor: "pointer" }}
                  >
                    <div style={{ fontWeight: 700, color: "#1d4ed8", marginBottom: "4px" }}>
                      Verse {verseIndex + 1}{isActiveVerse ? " • LIVE" : ""}
                    </div>
                    <div style={{ fontSize: "0.82rem", lineHeight: 1.35 }}>
                      {verseText || "No lyrics"}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
      </div>
      )}

      {/* Edit Song Modal */}
      {showEditSongModal && (
        <div className="edit-song-overlay" onClick={handleModalClick}>
          <div className="edit-song-modal">
            <div className="edit-song-header">
              <h2 className="edit-song-title">Edit Song</h2>
              <IoMdClose
                size={25}
                onClick={handleCloseModal}
                className="close-icon"
              />
            </div>
            <form onSubmit={handleEditSong} className="edit-song-form">
              <div className="form-group">
                <label className="form-label">Title</label>
                <input
                  type="text"
                  value={songForm.title}
                  onChange={(e) =>
                    setSongForm({ ...songForm, title: e.target.value })
                  }
                  className="form-input"
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Lyrics</label>
                <div className="lyrics-container">
                  {songForm.lyrics.map((lyric, index) => (
                    <div key={index} className="verse-container">
                      <textarea
                        value={lyric}
                        onChange={(e) => {
                          const newLyrics = [...songForm.lyrics];
                          newLyrics[index] = e.target.value;
                          setSongForm({ ...songForm, lyrics: newLyrics });
                        }}
                        className="verse-textarea"
                        placeholder={`Verse ${index + 1}`}
                        rows="3"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const newLyrics = songForm.lyrics.filter(
                            (_, i) => i !== index
                          );
                          setSongForm({ ...songForm, lyrics: newLyrics });
                        }}
                        style={{ ...commonStyles.redButton, margin: "0" }}
                      >
                        <MdDelete size={20} />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      setSongForm({
                        ...songForm,
                        lyrics: [...songForm.lyrics, ""],
                      })
                    }
                    style={{ ...commonStyles.indigoButton, margin: "0" }}
                  >
                    + Add Verse
                  </button>
                </div>
              </div>
              <div className="edit-modal-footer">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  style={{
                    ...commonStyles.redButton,
                    margin: "0",
                    width: "100%",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{
                    ...commonStyles.greenButton,
                    margin: "0",
                    width: "100%",
                  }}
                  disabled={updatingSong}
                >
                  {updatingSong ? "Updating..." : "Update Song"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add this before or after your Songs section */}
      {activeTab === "bible" && (
      <div style={{ order: 10 }}>
      <div style={panelStyle}>
        <h2 style={panelHeadingStyle}>Bible Verses</h2>
        <div style={twoColumnStyle}>
        <div
          style={{
            backgroundColor: "#f9fafb",
            padding: "15px",
            borderRadius: "8px",
            border: "1px solid #e5e7eb",
            flex: "1 1 320px",
            minWidth: 0,
          }}
        >
          <div style={{ marginBottom: "15px" }}>
            <label style={{ display: "block", marginBottom: "5px" }}>
              Bible Version
            </label>
            <select
              value={bibleVersion}
              onChange={(e) => setBibleVersion(e.target.value)}
              style={{
                width: "100%",
                padding: "8px",
                borderRadius: "6px",
                border: "1px solid #d1d5db",
              }}
            >
              {BIBLE_VERSIONS.map((version) => (
                <option key={version.value} value={version.value}>
                  {version.label}
                </option>
              ))}
            </select>
          </div>
          <div style={{ marginBottom: "15px" }}>
            <label style={{ display: "block", marginBottom: "5px" }}>
              Verse Reference
            </label>
            <div style={{ display: "flex", gap: "10px" }}>
              <input
                type="text"
                placeholder="e.g., John 3:16"
                value={bibleVerseInput}
                onChange={(e) => setBibleVerseInput(e.target.value)}
                style={{
                  flex: 1,
                  padding: "8px",
                  borderRadius: "6px",
                  border: "1px solid #d1d5db",
                }}
              />
              <button
                onClick={() => fetchBibleVerse(bibleVerseInput)}
                disabled={loadingVerse || !bibleVerseInput}
                style={{
                  ...commonStyles.indigoButton,
                  margin: 0,
                  opacity: loadingVerse || !bibleVerseInput ? 0.5 : 1,
                }}
              >
                {loadingVerse ? "Loading..." : "Display Verse"}
              </button>
              <button
                onClick={handleAddVerseToPlaylist}
                disabled={savingPlaylistItem || !bibleVerseInput}
                title="Save this verse to the selected playlist"
                style={{
                  ...commonStyles.greenButton,
                  margin: 0,
                  opacity: savingPlaylistItem || !bibleVerseInput ? 0.5 : 1,
                }}
              >
                {savingPlaylistItem ? "Saving..." : "+ Playlist"}
              </button>
            </div>
          </div>
          <div style={{ marginBottom: "15px" }}>
            <label style={{ display: "block", marginBottom: "5px" }}>
              Add to Playlist
            </label>
            <select
              value={versePlaylistId || activePlaylistId}
              onChange={(e) => setVersePlaylistId(e.target.value)}
              style={{
                width: "100%",
                padding: "8px",
                borderRadius: "6px",
                border: "1px solid #d1d5db",
              }}
            >
              <option value="">{playlists.length ? "Select a playlist" : "No playlists yet"}</option>
              {playlists.map((playlist) => (
                <option key={playlist.id} value={playlist.id}>{playlist.name}</option>
              ))}
            </select>
          </div>
          </div>
          {broadcast?.bibleVerse && (
            <div
              style={{
                backgroundColor: "#ffffff",
                padding: "15px",
                borderRadius: "6px",
                border: "1px solid #e5e7eb",
                flex: "1 1 320px",
                minWidth: 0,
              }}
            >
              <div
                style={{
                  fontSize: "14px",
                  color: "#6b7280",
                  marginBottom: "5px",
                }}
              >
                Currently displaying:
              </div>
              <div style={{ fontWeight: "500", marginBottom: "5px" }}>
                {broadcast.bibleVerse.reference} ({broadcast.bibleVerse.version})
              </div>
              <div style={{ color: "#374151" }}>
                {broadcast.bibleVerse.text}
              </div>
              <button
                onClick={async () => {
                  setSavingPlaylistItem(true);
                  try {
                    await handleAddCurrentToPlaylist();
                  } finally {
                    setSavingPlaylistItem(false);
                  }
                }}
                disabled={savingPlaylistItem}
                style={{
                  ...commonStyles.greenButton,
                  margin: "10px 0 0 0",
                  padding: "8px 14px",
                  opacity: savingPlaylistItem ? 0.6 : 1,
                }}
              >
                {savingPlaylistItem ? "Saving..." : "+ Add to Playlist"}
              </button>
            </div>
          )}
        </div>
      </div>
      </div>
      )}

      {/* Replace the existing Broadcast Link section */}
      {activeTab === "live" && (
      <div style={{ order: 30 }}>
      {broadcastId && (
        <div style={{ ...panelStyle, marginTop: "1rem" }}>
          <h3 style={{ ...panelHeadingStyle, fontSize: "1rem" }}>Share this screen</h3>

          {(shortLinkCode || broadcast?.shortCode) ? (
            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center", marginBottom: "12px" }}>
              <code
                style={{
                  fontSize: "1.5rem",
                  fontWeight: 800,
                  letterSpacing: "0.08em",
                  background: "#eef2ff",
                  border: "1px solid #c7d2fe",
                  borderRadius: "8px",
                  padding: "10px 18px",
                  color: "#3730a3",
                }}
              >
                {`${window.location.host}/b/${shortLinkCode || broadcast.shortCode}`}
              </code>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(
                    `${window.location.origin}/b/${shortLinkCode || broadcast.shortCode}`
                  );
                  toast.success("Short link copied!");
                }}
                style={{ ...commonStyles.greenButton, margin: 0 }}
              >
                Copy Short Link
              </button>
              <button
                onClick={() => {
                  const url = `${window.location.origin}/b/${shortLinkCode || broadcast.shortCode}`;
                  window.open(url, "_blank", "noopener,noreferrer");
                }}
                style={{ ...commonStyles.indigoButton, margin: 0 }}
              >
                Open Short Link ↗
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center", marginBottom: "12px" }}>
              <button
                onClick={handleGetShortLink}
                disabled={creatingShortLink}
                style={{ ...commonStyles.indigoButton, margin: 0, opacity: creatingShortLink ? 0.6 : 1 }}
              >
                {creatingShortLink ? "Creating..." : "🔗 Get Short Link"}
              </button>
            </div>
          )}

          <small style={{ color: "#6b7280" }}>
            Viewers can type this short address into any browser to join. Codes skip look-alike
            characters (no 0/O or 1/I) so they are easy to read out loud.
          </small>
        </div>
      )}
      {broadcastId && (
        <div
          style={{
            margin: "1rem 0rem 2rem 0rem",
            display: "flex",
            gap: "1rem",
          }}
        >
          <button
            onClick={() => {
              const url = `${window.location.origin}/church/${id}/broadcast/${broadcastId}?muted=1`;
              window.open(url, "_blank", "noopener,noreferrer");
            }}
            style={{ ...commonStyles.indigoButton, margin: "0", flex: 1 }}
          >
            Open Broadcast <span className="text-xs">↗</span>
          </button>
          <button
            onClick={() => {
              const url = `${window.location.origin}/church/${id}/broadcast/${broadcastId}?muted=1&variant=mobile`;
              window.open(url, "_blank", "noopener,noreferrer");
            }}
            title="Mobile-friendly layout with reactions, mic and translation"
            style={{ ...commonStyles.indigoButton, margin: "0", flex: 1 }}
          >
            📱 Open Mobile <span className="text-xs">↗</span>
          </button>
          <button
            onClick={() => {
              const url = `${window.location.origin}/church/${id}/broadcast/${broadcastId}?variant=tv`;
              window.open(url, "_blank", "noopener,noreferrer");
            }}
            title="Production TV screen: no microphone audio, no translation/captions"
            style={{ ...commonStyles.indigoButton, margin: "0", flex: 1 }}
          >
            📺 Open TV <span className="text-xs">↗</span>
          </button>
          <button
            onClick={() => {
              const code = shortLinkCode || broadcast?.shortCode;
              const url = code
                ? `${window.location.origin}/b/${code}`
                : `${window.location.origin}/church/${id}/broadcast/${broadcastId}`;
              navigator.clipboard.writeText(url);
              toast.success(code ? "Short link copied!" : "Broadcast link copied!");
            }}
            style={{ ...commonStyles.greenButton, margin: "0", flex: 1 }}
          >
            Copy Link
          </button>
          <button
            onClick={async () => {
              setSavingPlaylistItem(true);
              try {
                await handleAddCurrentToPlaylist();
              } finally {
                setSavingPlaylistItem(false);
              }
            }}
            disabled={savingPlaylistItem}
            title="Save what is currently on screen to the selected playlist"
            style={{ ...commonStyles.orangeButton, margin: "0", flex: 1, opacity: savingPlaylistItem ? 0.6 : 1 }}
          >
            {savingPlaylistItem ? "Saving..." : "+ Add Current to Playlist"}
          </button>
          <button
            onClick={handleClearScreen}
            style={{ ...commonStyles.redButton, margin: "0", flex: 1 }}
          >
            Clear Screen
          </button>
        </div>
      )}
      </div>
      )}

      {/* Live Preview */}
      {activeTab === "live" && (
      <div style={{ order: 10, ...panelStyle }}>
      <div className="mb-6">
        <h2 style={{ ...commonStyles.title }}>Live Preview</h2>
        <div
          className="p-4 rounded"
          style={{
            ...(liveSettings.backgroundType === "gradient"
              ? {
                  backgroundImage: `linear-gradient(${liveSettings.gradientAngle}deg, ${liveSettings.gradientColors[0]}, ${liveSettings.gradientColors[1]})`,
                }
              : liveSettings.backgroundType === "ai" ||
                liveSettings.backgroundType === "image"
              ? {
                  backgroundImage: Number(broadcast?.backgroundBlur) > 0 ? "none" : `url("${liveSettings.backgroundColor}")`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                  backgroundRepeat: "no-repeat",
                }
              : {
                  backgroundColor: liveSettings.backgroundColor,
                }),
            minHeight: "420px",
            aspectRatio: "16 / 9",
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
            overflow: "hidden",
          }}
        >
          {Number(broadcast?.backgroundBlur) > 0 &&
            (liveSettings.backgroundType === "ai" || liveSettings.backgroundType === "image") && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                backgroundImage: `url("${liveSettings.backgroundColor}")`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                filter: `blur(${Number(broadcast?.backgroundBlur) || 0}px)`,
                transform: "scale(1.1)",
                pointerEvents: "none",
                zIndex: 0,
              }}
            />
          )}
          {backgroundType === "ai" && (
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: "rgba(0, 0, 0, 0.4)",
                pointerEvents: "none",
              }}
            />
          )}
          {broadcast?.micEnabled && (
            <div className="absolute top-2 right-2">
              <span className="px-2 py-1 bg-red-600 text-white rounded-full text-sm">
                🎤 LIVE
              </span>
            </div>
          )}
          <div
            style={{
              position: "relative",
              zIndex: 1,
              color: liveSettings.fontColor,
              fontSize: `${liveSettings.fontSize}px`,
              fontFamily: liveSettings.fontFamily,
              fontWeight: liveSettings.isBold ? "bold" : "normal",
              fontStyle: liveSettings.isItalic ? "italic" : "normal",
              textShadow: liveSettings.textShadow,
              filter: `blur(${liveSettings.textBlur}px)`,
              textTransform: liveSettings.isUpperCase ? "uppercase" : "none",
              textAlign: "center",
              whiteSpace: "pre-wrap",
              width: "100%",
            }}
          >
            {broadcast?.bibleVerse ? (
              <>
                {broadcast.bibleVerse.text}
                <div
                  style={{
                    fontSize: `${parseInt(fontSize) * 0.5}px`,
                    marginTop: "1rem",
                    opacity: 0.8,
                  }}
                >
                  {broadcast.bibleVerse.reference} ({broadcast.bibleVerse.version})
                </div>
              </>
            ) : broadcast?.songId ? (
              <>
                {(() => {
                  const currentSong = songs.find((s) => s.id === broadcast.songId);
                  const lyricIndex = broadcast.currentLyricIndex || 0;
                  
                  if (!currentSong) return "No song selected";
                  
                  const lyric = currentSong.lyrics[lyricIndex];
                  // Handle both object format and string format lyrics
                  const lyricText = typeof lyric === "object" ? lyric?.text : lyric;
                  
                  if (!lyricText) return "No lyrics available";
                  
                  // Return the lyrics with line breaks preserved
                  return lyricText.split('\n').map((line, index) => (
                    <React.Fragment key={index}>
                      {line}
                      {index < lyricText.split('\n').length - 1 && <br />}
                    </React.Fragment>
                  ));
                })()}
              </>
            ) : (
              "Select a song or Bible verse to display"
            )}
          </div>
        </div>
      </div>
      </div>
      )}

      {/* Add these controls after the songs list section */}
      {activeTab === "live" && (
      <div style={{ order: 20, ...panelStyle }}>
      {broadcast?.songId && (
        <div style={{ margin: "2rem 0rem 0rem 0rem" }}>
          <h2 style={{ ...commonStyles.subTitle }}>Quick Verse Selection</h2>
          <div className="verse-selection">
            {songs
              .find((s) => s.id === broadcast.songId)
              ?.lyrics.map((verse, index) => (
                <button
                  key={index}
                  onClick={async () => {
                    try {
                      const broadcastRef = doc(
                        db,
                        `churches/${id}/broadcasts`,
                        broadcastId
                      );
                      console.log("Updating to verse:", index);
                      await updateDoc(broadcastRef, {
                        currentLyricIndex: index,
                        updatedAt: new Date(),
                      });
                    } catch (err) {
                      console.error("Error selecting verse:", err);
                      toast.error("Failed to select verse");
                    }
                  }}
                  style={{
                    padding: "1rem",
                    borderRadius: "8px",
                    border: "1px solid #d1d5db",
                    transition: "border-color 0.2s",
                    cursor: "pointer",
                    color: "#1f2937",
                    backgroundColor:
                      index === broadcast?.currentLyricIndex ? "#e5e7eb" : "#fff",
                    boxShadow:
                      index === broadcast?.currentLyricIndex
                        ? "0 4px 6px rgba(0, 0, 0, 0.1)"
                        : "none",
                    "&:hover": {
                      backgroundColor: "#f9f9f9",
                      borderColor: "#3b82f6",
                      boxShadow: "0 0 0 2px rgba(59, 130, 246, 0.1)",
                    },
                  }}
                >
                  <div className="font-medium text-blue-900 mb-1">
                    Verse {index + 1}
                  </div>
                  <div className="text-sm text-gray-600 line-clamp-3">
                    {typeof verse === "object" ? verse.text || "No lyrics" : verse}
                  </div>
                </button>
              ))}
          </div>
          {broadcast?.songId && (
            <div style={{ margin: "1rem 0rem 0rem 0rem" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  gap: "1rem",
                }}
              >
                <button
                  onClick={() => handleLyricNavigation("prev")}
                  style={{
                    ...commonStyles.backButton,
                    margin: "0",
                    width: "100%",
                    cursor:
                      broadcast?.currentLyricIndex === 0
                        ? "not-allowed"
                        : "pointer",
                  }}
                  disabled={broadcast?.currentLyricIndex === 0}
                >
                  Previous Verse
                </button>
                <button
                  onClick={() => handleLyricNavigation("next")}
                  style={{
                    ...commonStyles.backButton,
                    margin: "0",
                    width: "100%",
                    cursor:
                      broadcast?.currentLyricIndex ===
                      (songs.find((s) => s.id === broadcast.songId)?.lyrics
                        .length || 0) -
                        1
                        ? "not-allowed"
                        : "pointer",
                  }}
                  disabled={
                    broadcast?.currentLyricIndex ===
                    (songs.find((s) => s.id === broadcast.songId)?.lyrics.length ||
                      0) -
                      1
                  }
                >
                  Next Verse
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      </div>
      )}
    </div>
  );
};

export default EasyProjector;
