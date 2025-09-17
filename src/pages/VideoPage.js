import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Skeleton from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import { searchChurchById } from "../api";
import commonStyles from "./commonStyles";

const VideoPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [church, setChurch] = useState(null);
  const [videos, setVideos] = useState([]);
  const [playlistName, setPlaylistName] = useState("Playlist");
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [limit, setLimit] = useState(7); // Load first 7 videos

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const churchData = await searchChurchById(id);
        setChurch(churchData);

        // Fetch video playlist using the correct API
        const response = await fetch(
          `https://iglesia-tech-api.e2api.com/api/iglesiaTechApp/videos/playlists/detail/3150?idIglesia=${id}&sort_type=date_desc`
        );
        const data = await response.json();
        console.log("Fetched Video Data:", data);

        if (data && data.playlist && Array.isArray(data.playlist.videos)) {
          // Sort videos by publish_date (newest to oldest)
          const sortedVideos = data.playlist.videos.sort((a, b) =>
            new Date(b.publish_date) - new Date(a.publish_date)
          );

          setVideos(sortedVideos.slice(0, limit)); // Load first 7 videos
          setPlaylistName(`${data.playlist.name} (${sortedVideos.length})`); // ✅ Show playlist name & video count
        } else {
          setVideos([]);
        }
      } catch (error) {
        console.error("❌ Error fetching videos:", error);
        setVideos([]);
      }
      setLoading(false);
    };

    fetchData();
  }, [id, limit]);

  // Function to load more videos
  const loadMoreVideos = () => {
    setLimit(prevLimit => prevLimit + 7);
  };

  return (
    <div style={commonStyles.container}>
      {/* Banner */}
      <div style={commonStyles.banner}>
        {loading ? <Skeleton height={200} /> : church?.portadaArticulos ? (
          <img src={`https://iglesia-tech-api.e2api.com${church.portadaArticulos}`} alt="Church Banner" style={commonStyles.bannerImage} />
        ) : <Skeleton height={200} />}
      </div>

      {/* Logo */}
      <div style={commonStyles.logoContainer}>
        {loading ? <Skeleton circle height={90} width={90} /> : church?.Logo ? (
          <img src={`https://iglesia-tech-api.e2api.com${church.Logo}`} alt="Church Logo" style={commonStyles.logo} />
        ) : <Skeleton circle height={90} width={90} />}
      </div>

      {/* Back Button */}
      <button onClick={() => navigate(-1)} style={commonStyles.backButton}>⬅ Volver</button>

      <h2 style={commonStyles.title}>🎥 {playlistName}</h2>

      {/* Search Box */}
      <div style={styles.filterContainer}>
        <input
          type="text"
          placeholder="Buscar por título..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={styles.searchInput}
        />
      </div>

      {/* Videos List */}
      <div style={commonStyles.sectionContainer}>
        {loading ? (
          <Skeleton count={4} />
        ) : videos.length > 0 ? (
          <div style={styles.grid}>
            {videos.map((video) => (
              <div key={video.idVideo} style={styles.videoCard}>
                {/* Video Thumbnail */}
                {video.thumbnail ? (
                  <img
                    src={`https://iglesia-tech-api.e2api.com${video.thumbnail}`}
                    alt={video.title}
                    style={styles.videoThumbnail}
                  />
                ) : (
                  <Skeleton height={150} />
                )}

                {/* Video Title & Details */}
                <h3>{video.title}</h3>
                <p><strong>📅 Fecha:</strong> {video.publish_date ? new Date(video.publish_date).toLocaleDateString() : "N/A"}</p>
                <p><strong>🎤 Predicador:</strong> {video.speaker || "Desconocido"}</p>
                <p>{video.description || "Sin descripción disponible"}</p>

                {/* Video Embed (Fixed Overflow Issue) */}
                <div style={styles.videoFrameContainer}>
                  <iframe
                    src={video.embed_frame.match(/src="([^"]+)"/)?.[1] || ""}
                    title={video.title}
                    allow="autoplay; fullscreen; picture-in-picture"
                    allowFullScreen
                    style={styles.videoFrame}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p>No hay videos disponibles.</p>
        )}
      </div>

      {/* Load More Button */}
      {videos.length > limit && (
        <button onClick={loadMoreVideos} style={styles.loadMoreButton}>
          Cargar más videos
        </button>
      )}
    </div>
  );
};

// ✅ Ensuring styles object exists
const styles = {
  filterContainer: {
    display: "flex",
    justifyContent: "center",
    marginBottom: "15px",
  },
  searchInput: {
    padding: "10px",
    fontSize: "16px",
    width: "60%",
    borderRadius: "5px",
    border: "1px solid #ccc",
    outline: "none",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))",
    gap: "15px",
    marginTop: "10px",
  },
  videoCard: {
    padding: "15px",
    borderRadius: "8px",
    backgroundColor: "#fff",
    textAlign: "center",
    boxShadow: "0px 4px 6px rgba(0,0,0,0.1)",
  },
  videoThumbnail: {
    width: "100%",
    height: "150px",
    objectFit: "cover",
    borderRadius: "8px",
  },
  videoFrameContainer: {
    position: "relative",
    width: "100%",
    paddingBottom: "56.25%", // ✅ Maintains 16:9 aspect ratio
    height: "0",
    overflow: "hidden",
    borderRadius: "8px",
  },
  videoFrame: {
    position: "absolute",
    top: "0",
    left: "0",
    width: "100%",
    height: "100%",
    border: "none",
  },
  loadMoreButton: {
    marginTop: "15px",
    padding: "10px 15px",
    borderRadius: "6px",
    backgroundColor: "#007bff",
    color: "#fff",
    fontSize: "16px",
    cursor: "pointer",
    border: "none",
  },
};

export default VideoPage;
