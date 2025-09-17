import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Skeleton from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import commonStyles from "./commonStyles";
import { db } from "../firebase"; // Import Firebase Firestore
import { collection, query, where, getDocs } from "firebase/firestore"; // Import Firestore functions

const PDFPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [playlists, setPlaylists] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPlaylists = async () => {
      setLoading(true);
      try {
        const q = query(collection(db, "playlists_category"), where("idIglesia", "==", id));
        const querySnapshot = await getDocs(q);
        const playlistData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setPlaylists(playlistData);
      } catch (error) {
        console.error("❌ Error fetching playlists:", error);
        setPlaylists([]);
      }
      setLoading(false);
    };

    fetchPlaylists();
  }, [id]);

  return (
    <div style={commonStyles.container}>
      <button onClick={() => navigate(-1)} style={commonStyles.backButton}>⬅ Volver</button>
      <h2 style={commonStyles.title}>📄 Documentos PDF</h2>

      {loading ? (
        <Skeleton count={5} />
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "20px" }}>
          {playlists.map((playlist) => (
            <div key={playlist.id} style={{ border: "1px solid #ccc", borderRadius: "8px", padding: "10px", width: "200px" }}>
              <img src={playlist.thumbnail} alt={playlist.title} style={{ width: "100%", borderRadius: "8px" }} />
              <h3>{playlist.title}</h3>
              <p>{playlist.description}</p>
              <p><strong>Speaker:</strong> {playlist.speaker}</p>
              <a href={playlist.src_path} target="_blank" rel="noopener noreferrer">Ver Documento</a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default PDFPage;
