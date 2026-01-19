import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { db } from "../firebase";
import { collection, getDocs, doc, updateDoc, deleteDoc, addDoc, serverTimestamp, query, where } from "firebase/firestore";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { IoMdClose } from "react-icons/io";
import { MdDelete, MdModeEdit } from "react-icons/md";
import ChurchHeader from "./ChurchHeader";
import commonStyles from "../pages/commonStyles";
import "./EasyProjector.css";

const SongManager = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [songs, setSongs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [songForm, setSongForm] = useState({ title: "", lyrics: [""] });
  const [showAddSongModal, setShowAddSongModal] = useState(false);
  const [showEditSongModal, setShowEditSongModal] = useState(false);
  const [updatingSong, setUpdatingSong] = useState(false);
  const [editingSong, setEditingSong] = useState(null);
  
  useEffect(() => {
    const fetchSongs = async () => {
      try {
        setLoading(true);
        const songsRef = collection(db, `churches/${id}/songs`);
        const songsSnap = await getDocs(songsRef);
        const songsData = songsSnap.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setSongs(songsData);
      } catch (err) {
        console.error("Error fetching songs:", err);
        toast.error("Failed to load songs");
      } finally {
        setLoading(false);
      }
    };

    if (id) {
      fetchSongs();
    }
  }, [id]);

  const fetchSongLyrics = async (songTitle) => {
    try {
      const apiKey = process.env.REACT_APP_OPENAI_API_KEY;
      console.log("API Key available:", !!apiKey);

      if (!apiKey) {
        toast.error("API key not available. Please check your environment configuration.");
        return null;
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
              content: `Return the lyrics for the song "${songTitle}". Format: Each verse should be returned as a separate item in a list, with no numbering or labels. If multiple versions exist, choose the most common version. If no lyrics are found, respond with "No lyrics found"`,
            },
          ],
          temperature: 0.3,
          max_tokens: 800,
        }),
      });

      if (!response.ok) {
        throw new Error(`API request failed with status ${response.status}`);
      }

      const data = await response.json();
      console.log("API Response:", data);

      if (!data.choices || !data.choices[0]?.message?.content) {
        return null;
      }

      const content = data.choices[0].message.content.trim();

      // Check if lyrics were found
      if (content.includes("No lyrics found")) {
        return null;
      }

      // Process the response to extract verses
      const verses = content
        .split(/\n\n+/)
        .map((verse) => verse.trim())
        .filter((verse) => verse.length > 0);

      if (verses.length === 0) {
        return null;
      }

      return verses;
    } catch (err) {
      console.error("Error fetching lyrics:", err);
      return null;
    }
  };

  const handleAddSong = async (e) => {
    e.preventDefault();

    if (!songForm.lyrics[0] || songForm.lyrics.every((lyric) => !lyric.trim())) {
      toast.error("Please add at least one verse");
      return;
    }

    setUpdatingSong(true);
    try {
      const songsRef = collection(db, `churches/${id}/songs`);
      
      // Check if song with the same title already exists
      const existingQuery = query(songsRef, where("title", "==", songForm.title.trim()));
      const existingSnap = await getDocs(existingQuery);
      
      if (!existingSnap.empty) {
        toast.error("A song with this title already exists");
        setUpdatingSong(false);
        return;
      }
      
      await addDoc(songsRef, {
        title: songForm.title.trim(),
        lyrics: songForm.lyrics.map(lyric => lyric.trim()).filter(lyric => lyric),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // Refresh the song list
      const songsSnap = await getDocs(songsRef);
      const songsData = songsSnap.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      setSongs(songsData);

      // Reset form
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
    e.preventDefault();
    setUpdatingSong(true);
    
    try {
      if (!editingSong) {
        throw new Error("No song selected for editing");
      }
      
      // Validate lyrics
      if (!songForm.lyrics[0] || songForm.lyrics.every((lyric) => !lyric.trim())) {
        toast.error("Please add at least one verse");
        setUpdatingSong(false);
        return;
      }
      
      const songRef = doc(db, `churches/${id}/songs`, editingSong.id);
      
      // Check if title changed and if new title already exists
      if (songForm.title.trim() !== editingSong.title) {
        const songsRef = collection(db, `churches/${id}/songs`);
        const existingQuery = query(songsRef, where("title", "==", songForm.title.trim()));
        const existingSnap = await getDocs(existingQuery);
        
        if (!existingSnap.empty) {
          toast.error("A song with this title already exists");
          setUpdatingSong(false);
          return;
        }
      }
      
      await updateDoc(songRef, {
        title: songForm.title.trim(),
        lyrics: songForm.lyrics.map(lyric => lyric.trim()).filter(lyric => lyric),
        updatedAt: serverTimestamp(),
      });

      // Refresh the song list
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

  const handleCloseModal = () => {
    setShowEditSongModal(false);
    setShowAddSongModal(false);
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

  return (
    <div style={commonStyles.container}>
      <ToastContainer position="top-right" autoClose={5000} />
      <button
        onClick={() => navigate(`/organization/${id}/mi-organizacion`)}
        style={{ ...commonStyles.backButtonLink }}
      >
        ← Back to Organization
      </button>

      <ChurchHeader id={id} applyShadow={false} />

      <h1 style={{ ...commonStyles.title, marginTop: "-30px" }}>Song Manager</h1>
      <p style={{ marginBottom: "20px" }}>
        Create, edit, and manage songs for your church presentations. These songs are shared with EasyProjector.
      </p>

      <div style={{ marginBottom: "30px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "15px",
          }}
        >
          <h2 style={{ ...commonStyles.subTitle, margin: 0 }}>Songs</h2>
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

        {loading ? (
          <div style={{ textAlign: "center", padding: "20px" }}>
            <p>Loading songs...</p>
          </div>
        ) : (
          <div
            style={{
              maxHeight: "600px",
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
              filteredSongs.map((song) => (
                <div
                  key={song.id}
                  style={{
                    backgroundColor: "#fff",
                    color: "#1f262e",
                    border: "1px solid #e5e7eb",
                    borderRadius: "8px",
                    padding: "15px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <h3 style={{ margin: 0, fontSize: "18px" }}>{song.title}</h3>
                    <div style={{ display: "flex", gap: "10px" }}>
                      <button
                        onClick={() => {
                          setEditingSong(song);
                          const processedLyrics = (song.lyrics || [""]).map(
                            (lyric) => typeof lyric === "object" ? lyric.text || "" : lyric
                          );
                          setSongForm({
                            title: song.title,
                            lyrics: processedLyrics,
                          });
                          setShowEditSongModal(true);
                        }}
                        style={{
                          ...commonStyles.orangeButton,
                          padding: "8px 10px",
                          margin: "0",
                        }}
                      >
                        <MdModeEdit size={20} />
                      </button>
                      <button
                        onClick={() => handleDeleteSong(song.id)}
                        style={{
                          ...commonStyles.redButton,
                          padding: "8px 10px",
                          margin: "0",
                        }}
                      >
                        <MdDelete size={20} />
                      </button>
                    </div>
                  </div>
                  
                  <div style={{ 
                    backgroundColor: "#f9fafb", 
                    padding: "10px", 
                    borderRadius: "4px",
                    maxHeight: "100px",
                    overflow: "hidden",
                    position: "relative"
                  }}>
                    <div style={{ 
                      position: "absolute", 
                      bottom: 0, 
                      left: 0, 
                      right: 0, 
                      height: "40px", 
                      background: "linear-gradient(transparent, #f9fafb)", 
                      pointerEvents: "none" 
                    }}/>
                    
                    {song.lyrics && song.lyrics.length > 0 ? (
                      <div>
                        {song.lyrics.slice(0, 2).map((lyric, i) => (
                          <p key={i} style={{ 
                            margin: "0 0 8px 0", 
                            fontSize: "14px",
                            fontStyle: "italic",
                            color: "#4b5563"
                          }}>
                            {typeof lyric === "object" ? lyric.text : lyric}
                          </p>
                        ))}
                        {song.lyrics.length > 2 && (
                          <p style={{ margin: "0", fontSize: "14px", color: "#9ca3af" }}>
                            + {song.lyrics.length - 2} more verses
                          </p>
                        )}
                      </div>
                    ) : (
                      <p style={{ margin: 0, fontStyle: "italic", color: "#9ca3af" }}>No lyrics available</p>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div
                style={{
                  textAlign: "center",
                  padding: "30px",
                  color: "#6b7280",
                  backgroundColor: "#fff",
                  borderRadius: "8px",
                  border: "1px dashed #d1d5db",
                }}
              >
                {searchQuery ? "No songs match your search" : "No songs found. Add your first song!"}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add Song Modal */}
      {showAddSongModal && (
        <div className="edit-song-overlay" onClick={handleModalClick}>
          <div className="edit-song-modal">
            <div className="edit-song-header">
              <h2 className="edit-song-title">Add New Song</h2>
              <IoMdClose
                size={25}
                onClick={handleCloseModal}
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
                          if (songForm.lyrics.length > 1) {
                            const newLyrics = songForm.lyrics.filter(
                              (_, i) => i !== index
                            );
                            setSongForm({ ...songForm, lyrics: newLyrics });
                          }
                        }}
                        style={{ 
                          ...commonStyles.redButton, 
                          margin: "0",
                          visibility: songForm.lyrics.length > 1 ? "visible" : "hidden"
                        }}
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
                  {updatingSong ? "Adding..." : "Add Song"}
                </button>
              </div>
            </form>
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
                          if (songForm.lyrics.length > 1) {
                            const newLyrics = songForm.lyrics.filter(
                              (_, i) => i !== index
                            );
                            setSongForm({ ...songForm, lyrics: newLyrics });
                          }
                        }}
                        style={{ 
                          ...commonStyles.redButton, 
                          margin: "0",
                          visibility: songForm.lyrics.length > 1 ? "visible" : "hidden"
                        }}
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
    </div>
  );
};

export default SongManager;