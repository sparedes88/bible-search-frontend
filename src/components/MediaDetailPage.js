import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { db } from "../firebase";
import { collection, query, where, orderBy, limit, startAfter, getDocs } from "firebase/firestore";
import Skeleton from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import { commonStyles } from "./MediaPageStyles";

const MediaDetailPage = () => {
  const { churchId, playlistId } = useParams();
  const navigate = useNavigate();
  const [media, setMedia] = useState([]);
  const [filteredMedia, setFilteredMedia] = useState([]); // Stores search results
  const [loading, setLoading] = useState(true);
  const [lastVisible, setLastVisible] = useState(null); // Track last document for pagination
  const [hasMore, setHasMore] = useState(true); // Control 'Load More' button
  const [sortBy, setSortBy] = useState("date_desc"); // Sorting option
  const [searchQuery, setSearchQuery] = useState(""); // Search input

  // Fetch Media
  useEffect(() => {
    if (churchId && playlistId) {
      console.log(`Fetching media for churchId: ${churchId}, playlistId: ${playlistId}`);
      fetchMedia(true); // Fetch first batch on mount
    } else {
      console.error("❌ churchId or playlistId is undefined");
    }
  }, [churchId, playlistId, sortBy]);

  const fetchMedia = async (firstLoad = false) => {
    if (!churchId || !playlistId) {
      console.error("❌ churchId or playlistId is undefined");
      return;
    }

    setLoading(true);
    try {
      let mediaQuery = query(
        collection(db, "media"),
        where("churchId", "==", churchId),
        where("idPlaylist", "==", playlistId),
        where("status", "==", true),
        orderBy(sortBy.includes("date") ? "publish_date" : "type", sortBy.includes("asc") ? "asc" : "desc"),
        limit(5)
      );

      if (!firstLoad && lastVisible) {
        mediaQuery = query(mediaQuery, startAfter(lastVisible));
      }

      const querySnapshot = await getDocs(mediaQuery);
      const mediaItems = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      }));

      setMedia(prevMedia => (firstLoad ? mediaItems : [...prevMedia, ...mediaItems]));
      setFilteredMedia(prevMedia => (firstLoad ? mediaItems : [...prevMedia, ...mediaItems])); // Sync search data

      if (querySnapshot.docs.length > 0) {
        setLastVisible(querySnapshot.docs[querySnapshot.docs.length - 1]);
      } else {
        setHasMore(false); // No more items to load
      }
    } catch (error) {
      console.error("❌ Error fetching media:", error);
    }
    setLoading(false);
  };

  // Filter Media when User Searches
  useEffect(() => {
    if (searchQuery.trim() === "") {
      setFilteredMedia(media);
    } else {
      const filteredResults = media.filter(item =>
        item.title.toLowerCase().includes(searchQuery.toLowerCase())
      );
      setFilteredMedia(filteredResults);
    }
  }, [searchQuery, media]);

  return (
    <div style={commonStyles.container}>
      <button onClick={() => navigate(-1)} style={commonStyles.backButton}>← Back to Playlists</button>

      <h2 style={commonStyles.title}>Media for Playlist {playlistId}</h2>

      {/* Search & Sort Section */}
      <div style={commonStyles.filterContainer}>
        <input
          type="text"
          placeholder="Search by title..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={commonStyles.searchInput}
        />

        <label>Sort by:</label>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={commonStyles.sortSelect}>
          <option value="date_desc">Newest First</option>
          <option value="date_asc">Oldest First</option>
          <option value="type_asc">Type (A-Z)</option>
          <option value="type_desc">Type (Z-A)</option>
        </select>
      </div>

      {/* Media List */}
      {loading && media.length === 0 ? <Skeleton height={200} count={5} /> : (
        <div style={commonStyles.cardsContainer}>
          {filteredMedia.length === 0 ? (
            <p style={commonStyles.noData}>No media found.</p>
          ) : (
            filteredMedia.map(item => (
              <div key={item.id} style={commonStyles.card}>
                <img src={item.thumbnail} alt={item.title} style={commonStyles.cardImage} />
                <div style={commonStyles.cardContent}>
                  <h3>{item.title}</h3>
                  <p><strong>Speaker:</strong> {item.speaker}</p>
                  <p><strong>Published:</strong> {new Date(item.publish_date).toLocaleDateString()}</p>

                  {item.type === "video" && (
                    <iframe src={item.embed_frame} width="100%" height="200" allowFullScreen />
                  )}

                  {item.type === "audio" && (
                    <audio controls style={commonStyles.audioPlayer}>
                      <source src={item.link} type="audio/mp3" />
                    </audio>
                  )}

                  {item.type === "document" && (
                    <a href={item.link} target="_blank" rel="noopener noreferrer" style={commonStyles.documentLink}>
                      📄 View Document
                    </a>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Load More Button */}
      {hasMore && !loading && (
        <button onClick={() => fetchMedia(false)} style={commonStyles.loadMoreButton}>Load More</button>
      )}
    </div>
  );
};

export default MediaDetailPage;
