import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Skeleton from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import { searchChurchById } from "../api";
import commonStyles from "./commonStyles";

const AudioPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [church, setChurch] = useState(null);
  const [audios, setAudios] = useState([]);
  const [audioLinks, setAudioLinks] = useState({});
  const [loading, setLoading] = useState(true);
  const [limit, setLimit] = useState(7); // Load first 7 audios initially

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const churchData = await searchChurchById(id);
        setChurch(churchData);

        // Fetch audio files using the main API
        const response = await fetch(
          `https://iglesia-tech-api.e2api.com/api/iglesiaTechApp/videos/getVideos/?idIglesia=${id}&type=audio&sort=desc`
        );
        const data = await response.json();
        console.log("Fetched Audio Data:", data);

        if (data && Array.isArray(data.videos)) {
          // Filter audios with "status": true
          const validAudios = data.videos.filter(audio => audio.status === true);
          setAudios(validAudios.slice(0, limit)); // Load only the first 7 audios

          // Fetch individual audio links for each valid audio
          validAudios.forEach(audio => fetchAudioDetail(audio.idVideo));
        } else {
          setAudios([]);
        }
      } catch (error) {
        console.error("❌ Error fetching audios:", error);
        setAudios([]);
      }
      setLoading(false);
    };

    fetchData();
  }, [id, limit]);

  // Fetch actual audio play link using idVideo
  const fetchAudioDetail = async (idVideo) => {
    try {
      const response = await fetch(
        `https://iglesia-tech-api.e2api.com/api/iglesiaTechApp/videos/detail/${idVideo}?idIglesia=${id}`
      );
      const data = await response.json();
      console.log(`Fetched Audio Detail for ID ${idVideo}:`, data);

      if (data && data.video && data.video.link) {
        setAudioLinks(prevLinks => ({ ...prevLinks, [idVideo]: data.video.link }));
      } else {
        console.warn(`🚨 No audio link found for ID ${idVideo}`);
      }
    } catch (error) {
      console.error(`❌ Error fetching audio details for ID ${idVideo}:`, error);
    }
  };

  // Load More Audios
  const loadMoreAudios = () => {
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

      <h2 style={commonStyles.title}>🎵 Audios</h2>

      <div style={commonStyles.sectionContainer}>
        {loading ? (
          <Skeleton count={4} />
        ) : audios.length > 0 ? (
          <div style={styles.grid}>
            {audios.map((audio) => (
              <div key={audio.idVideo} style={styles.audioCard}>
                {/* Audio Thumbnail */}
                {audio.thumbnail ? (
                  <img
                    src={`https://iglesia-tech-api.e2api.com${audio.thumbnail}`}
                    alt={audio.title}
                    style={styles.audioThumbnail}
                  />
                ) : (
                  <Skeleton height={150} />
                )}

                {/* Audio Details */}
                <h3>{audio.title}</h3>
                {audio.sermon_notes && <p><strong>📝 Notas:</strong> {audio.sermon_notes}</p>}
                <p><strong>🎤 Predicador:</strong> {audio.speaker || "Desconocido"}</p>
                <p><strong>📅 Fecha:</strong> {audio.publish_date ? new Date(audio.publish_date).toLocaleDateString() : "N/A"}</p>
                <p>{audio.description || "Sin descripción disponible"}</p>

                {/* Play Audio */}
                {audioLinks[audio.idVideo] ? (
                  <audio controls style={styles.audioPlayer}>
                    <source src={`https://iglesia-tech-api.e2api.com${audioLinks[audio.idVideo]}`} type="audio/mpeg" />
                    Tu navegador no soporta el elemento de audio.
                  </audio>
                ) : (
                  <Skeleton height={50} />
                )}
              </div>
            ))}
          </div>
        ) : (
          <p>No hay audios disponibles.</p>
        )}
      </div>

      {/* Load More Button */}
      {audios.length >= limit && (
        <button onClick={loadMoreAudios} style={styles.loadMoreButton}>
          Cargar más audios
        </button>
      )}
    </div>
  );
};

// ✅ Ensuring styles object exists
const styles = {
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))",
    gap: "15px",
    marginTop: "10px",
  },
  audioCard: {
    padding: "15px",
    borderRadius: "8px",
    backgroundColor: "#fff",
    textAlign: "center",
    boxShadow: "0px 4px 6px rgba(0,0,0,0.1)",
  },
  audioThumbnail: {
    width: "100%",
    height: "150px",
    objectFit: "cover",
    borderRadius: "8px",
  },
  audioPlayer: {
    width: "100%",
    marginTop: "10px",
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

export default AudioPage;
