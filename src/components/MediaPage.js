import React, { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import Skeleton from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import { db } from "../firebase"; // Firebase Firestore import
import { collection, getDocs, query, where } from "firebase/firestore"; // Firestore functions
import Select from "react-select";
import { customSelectStyles, commonStyles } from "./MediaPageStyles"; // Styles
import PlaylistDropdown from "../components/PlaylistDropdown"; // Import PlaylistDropdown component

const MediaPage = () => {
  const { id: churchId, idiglesia } = useParams();
  const [loading, setLoading] = useState(true);
  const [mediaItems, setMediaItems] = useState([]);
  const [selectedMediaType, setSelectedMediaType] = useState("all"); // State for selected media type
  const [selectedPlaylist, setSelectedPlaylist] = useState(null); // State for selected playlist

  // Fetch Media Items
  useEffect(() => {
    const fetchMediaItems = async () => {
      setLoading(true);
      try {
        const mediaQuery = query(collection(db, "media"), where("churchId", "==", churchId));
        const querySnapshot = await getDocs(mediaQuery);

        const allMediaItems = querySnapshot.docs.map(doc => {
          const docName = doc.id;
          const [idPlaylist, extractedChurchId] = docName.split("_"); // Extracts idPlaylist and churchId from document name

          const mediaData = doc.data();
          const mediaFiles = mediaData.media_files || [];

          return {
            id: doc.id,
            idPlaylist,
            extractedChurchId,
            ...mediaData,
            media_files: mediaFiles,
          };
        });

        const filteredMediaItems = allMediaItems.filter(media => media.extractedChurchId === churchId);
        setMediaItems(filteredMediaItems);
      } catch (error) {
        console.error("❌ Error fetching media items:", error);
      }
      setLoading(false);
    };

    fetchMediaItems();
  }, [churchId]);

  // Filter media items based on selected media type and playlist
  const filteredMediaItems = mediaItems.filter(media => {
    if (selectedMediaType !== "all" && media.type !== selectedMediaType) return false;
    if (selectedPlaylist && media.idPlaylist !== selectedPlaylist) return false;
    return true;
  });

  const handlePlaylistSelect = (playlistId) => {
    setSelectedPlaylist(playlistId);
  };

  return (
    <div style={commonStyles.container}>
      <Link to={`/churchprofile/${idiglesia}`} style={commonStyles.backButton}>← Back</Link>

      {/* Search Bar */}
      <div style={commonStyles.searchContainer}>
        {loading ? <Skeleton height={40} /> : (
          <>
            <Select
              options={[
                { value: "all", label: "All" },
                { value: "videos", label: "Videos" },
                { value: "audios", label: "Audios" },
                { value: "documents", label: "Documents" },
              ]}
              value={{ value: selectedMediaType, label: selectedMediaType.charAt(0).toUpperCase() + selectedMediaType.slice(1) }}
              onChange={(option) => setSelectedMediaType(option.value)}
              placeholder="Select media type"
              styles={customSelectStyles}
            />
            <PlaylistDropdown idIglesia={idiglesia} onSelect={handlePlaylistSelect} />
          </>
        )}
      </div>

      {/* Media Items Cards */}
      <div style={commonStyles.cardsContainer}>
        {mediaItems.length === 0 && !loading ? (
          <p style={commonStyles.noData}>No media items available for this church.</p>
        ) : (
          filteredMediaItems.map((media) => (
            <div key={media.id} style={commonStyles.card}>
              {media.media_files.map((file, index) => (
                <div key={index}>
                  <img src={`https://iglesia-tech-api.e2api.com${file.thumbnail}`} alt={media.title} style={commonStyles.cardImage} />
                  <div style={commonStyles.cardContent}>
                    <h3>{media.title}</h3>
                    <p><strong>Speaker:</strong> {file.speaker}</p>
                    <p><strong>Published:</strong> {new Date(file.publish_date).toLocaleDateString()}</p>
                    <p><strong>Type:</strong> {media.type}</p>
                    <p><strong>idPlaylist:</strong> {media.idPlaylist}</p>
                    <p><strong>idplaylist_name:</strong> {playlists[media.idPlaylist]}</p> {/* Display idplaylist_name */}
                    <p><strong>Description:</strong> {file.description}</p>
                    {media.type === "video" && (
                      <div dangerouslySetInnerHTML={{ __html: file.embed_frame }} />
                    )}
                    {media.type === "audio" && (
                      <audio controls style={commonStyles.audioPlayer}>
                        <source src={file.src_path} type="audio/mp3" />
                      </audio>
                    )}
                    {media.type === "document" && (
                      <a href={file.src_path} target="_blank" rel="noopener noreferrer" style={commonStyles.documentLink}>
                        📄 View Document
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default MediaPage;
