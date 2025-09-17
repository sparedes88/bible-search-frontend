import React, { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { db, storage } from "../firebase";
import {
  doc,
  getDoc,
  updateDoc,
  collection,
  addDoc,
  onSnapshot,
  query,
  getDocs,
  deleteDoc,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { toast } from "react-toastify";
import { motion } from "framer-motion";
import commonStyles from "../pages/commonStyles";
import ChurchHeader from "./ChurchHeader";
import "./EasyProjector.css";
import { MdDelete, MdModeEdit } from "react-icons/md";
import { IoMdClose } from "react-icons/io";

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
      if (peerConnectionRef.current && answer) {
        await peerConnectionRef.current.setRemoteDescription(
          new RTCSessionDescription(answer)
        );
      }
    } catch (err) {
      console.error("Error handling answer:", err);
      toast.error("Failed to establish audio connection");
    }
  };

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

  const fetchBibleVerse = async (reference) => {
    setLoadingVerse(true);
    try {
      const apiKey = process.env.REACT_APP_OPENAI_API_KEY;
      console.log("API Key available:", !!apiKey);

      if (!apiKey) {
        throw new Error("OpenAI API key not configured. Check your .env file");
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
              content: `Return only the text of this Bible verse: ${reference} in ${bibleVersion} version. Format: Just the verse text, no reference. If it's a Spanish version (RVR1960, NVI, DHH, or TLA), return the text in Spanish.`,
            },
          ],
          temperature: 0.3,
          max_tokens: 200,
        }),
      });

      if (!response.ok) {
        const errorData = await response.text();
        console.error("API Error Response:", errorData);
        throw new Error(`API request failed: ${response.status}`);
      }

      const data = await response.json();
      console.log("API Response:", data);

      if (!data.choices || !data.choices[0]?.message?.content) {
        throw new Error("Invalid response format from API");
      }

      const verseText = data.choices[0].message.content.trim();

      await updateDoc(doc(db, `churches/${id}/broadcasts`, broadcastId), {
        bibleVerse: {
          reference,
          version: bibleVersion,
          text: verseText,
        },
        songId: null,
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

  const handleClearScreen = async () => {
    if (!broadcastId) return;

    try {
      await updateDoc(doc(db, `churches/${id}/broadcasts`, broadcastId), {
        songId: null,
        bibleVerse: null,
        currentLyricIndex: 0,
        updatedAt: new Date(),
      });
      toast.success("Screen cleared");
    } catch (err) {
      console.error("Error clearing screen:", err);
      toast.error("Failed to clear screen");
    }
  };

  const generateAIBackground = async (prompt, type) => {
    if (!prompt.trim()) {
      toast.error("Please enter a description");
      return;
    }

    try {
      const apiKey = process.env.REACT_APP_OPENAI_API_KEY;
      if (!apiKey) {
        toast.error("API key not configured");
        return;
      }

      setGeneratingImage(true);
      toast.info(`Generating ${type === "ai" ? "background" : "image"}...`);

      const imageResponse = await fetch(
        "https://api.openai.com/v1/images/generations",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            prompt:
              type === "ai"
                ? `Abstract background pattern: ${prompt}. Make it subtle and suitable for text overlay.`
                : `High quality photograph: ${prompt}. Make it suitable for text overlay.`,
            n: 1,
            size: "1024x1024",
            response_format: "url",
          }),
        }
      );

      if (!imageResponse.ok) throw new Error("Failed to generate image");

      const imageData = await imageResponse.json();
      const imageUrl = imageData.data[0].url;

      setPreviewSettings((prev) => ({
        ...prev,
        backgroundType: type,
        backgroundColor: imageUrl,
      }));

      toast.success(
        `${type === "ai" ? "Background" : "Image"} generated successfully!`
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

  const handleApplyChanges = async () => {
    try {
      if (!broadcastId) return;

      const broadcastRef = doc(db, `churches/${id}/broadcasts`, broadcastId);
      await updateDoc(broadcastRef, {
        ...previewSettings,
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
    <div style={commonStyles.container}>
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
                    const url = `${window.location.origin}/church/${id}/broadcast/${b.id}`;
                    window.open(url, "_blank", "noopener,noreferrer");
                  }}
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

      {/* Display Settings */}
      <div
        style={{
          marginBottom: "20px",
          border: "2px solid #e7e7e7",
          padding: "15px",
          borderRadius: "8px",
        }}
      >
        <h3 style={{ ...commonStyles.title, margin: "0px 0px 20px 0px" }}>
          Display Settings
        </h3>

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
            <div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                }}
              >
                <textarea
                  id="aiPrompt"
                  placeholder={
                    previewSettings.backgroundType === "ai"
                      ? "Describe your desired background pattern... (e.g., 'Abstract flowing shapes in blue and purple' or 'Subtle geometric patterns')"
                      : "Describe your desired image... (e.g., 'A serene mountain landscape' or 'Beautiful church interior')"
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
                        previewSettings.backgroundType
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
                <small style={{ color: "#6b7280", marginTop: "4px" }}>
                  {previewSettings.backgroundType === "ai"
                    ? "Examples: 'Abstract worship patterns', 'Subtle geometric shapes', 'Flowing light patterns'"
                    : "Examples: 'Ethereal church interior', 'Gentle nature scene', 'Mountain landscape at sunset'"}
                </small>
              </div>
            </div>
          )}
        </div>

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
                  backgroundImage: `url("${previewSettings.backgroundColor}")`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                  backgroundRepeat: "no-repeat",
                }
              : {
                  backgroundColor: previewSettings.backgroundColor,
                }),
            minHeight: "150px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            position: "relative",
          }}
        >
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

      {/* Microphone Control */}
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
      </div>

      {/* Replace the existing songs section with this updated version */}
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
            maxHeight: "400px",
            backgroundColor: "#f5f5f5",
            overflowY: "auto",
            padding: "15px",
            borderRadius: "8px",
            display: "flex",
            flexDirection: "column",
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
                    onClick={() => {
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
                    onClick={() => handleDeleteSong(song.id)}
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
      </div>

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
      <div style={{ marginBottom: "20px" }}>
        <h2 style={commonStyles.title}>Bible Verses</h2>
        <div
          style={{
            backgroundColor: "#f9fafb",
            padding: "15px",
            borderRadius: "8px",
            border: "1px solid #e5e7eb",
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
            </div>
          </div>
          {broadcast?.bibleVerse && (
            <div
              style={{
                backgroundColor: "#ffffff",
                padding: "15px",
                borderRadius: "6px",
                border: "1px solid #e5e7eb",
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
            </div>
          )}
        </div>
      </div>

      {/* Replace the existing Broadcast Link section */}
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
              const url = `${window.location.origin}/church/${id}/broadcast/${broadcastId}`;
              window.open(url, "_blank", "noopener,noreferrer");
            }}
            style={{ ...commonStyles.indigoButton, margin: "0", flex: 1 }}
          >
            Open Broadcast <span className="text-xs">↗</span>
          </button>
          <button
            onClick={() => {
              const url = `${window.location.origin}/church/${id}/broadcast/${broadcastId}`;
              navigator.clipboard.writeText(url);
              toast.success("Broadcast link copied to clipboard!");
            }}
            style={{ ...commonStyles.greenButton, margin: "0", flex: 1 }}
          >
            Copy Link
          </button>
          <button
            onClick={handleClearScreen}
            style={{ ...commonStyles.redButton, margin: "0", flex: 1 }}
          >
            Clear Screen
          </button>
        </div>
      )}

      {/* Live Preview */}
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
                  backgroundImage: `url("${liveSettings.backgroundColor}")`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                  backgroundRepeat: "no-repeat",
                }
              : {
                  backgroundColor: liveSettings.backgroundColor,
                }),
            minHeight: "200px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
          }}
        >
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

      {/* Add these controls after the songs list section */}
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
  );
};

export default EasyProjector;
