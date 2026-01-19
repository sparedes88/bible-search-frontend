import React, { useState, useEffect } from "react";
import { db } from "../firebase"; // Import Firebase Firestore
import { doc, getDoc } from "firebase/firestore"; // Firestore functions

const PlaylistDropdown = ({ idIglesia, onSelect }) => {
  const [playlists, setPlaylists] = useState([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState("");

  useEffect(() => {
    const fetchPlaylists = async () => {
      try {
        const playlistDocRef = doc(db, "playlists", idIglesia);
        const playlistDoc = await getDoc(playlistDocRef);
        if (playlistDoc.exists()) {
          const playlistData = playlistDoc.data().playlists || [];
          setPlaylists(playlistData);
        } else {
          console.error("No such document!");
        }
      } catch (error) {
        console.error("Error fetching playlists:", error);
      }
    };

    fetchPlaylists();
  }, [idIglesia]);

  const handleSelectChange = (event) => {
    const selectedId = event.target.value;
    setSelectedPlaylist(selectedId);
    onSelect(selectedId); // Pass selected playlist ID to parent component
  };

  return (
    <div>
      <label htmlFor="playlist">Select a Playlist:</label>
      <select id="playlist" value={selectedPlaylist} onChange={handleSelectChange}>
        <option value="">-- Select a Playlist --</option>
        {playlists.map((playlist) => (
          <option key={playlist.id} value={playlist.id}>
            {playlist.name.replace("Church", "").trim()}
          </option>
        ))}
      </select>
    </div>
  );
};

export default PlaylistDropdown;
