import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Skeleton from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import { searchChurchById } from "../api";
import commonStyles from "./commonStyles";

const GalleryPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [church, setChurch] = useState(null);
  const [gallery, setGallery] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tapCount, setTapCount] = useState(0);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const churchData = await searchChurchById(id);
        setChurch(churchData);

        // Fetch gallery images
        const response = await fetch(`https://iglesia-tech-api.e2api.com/api/iglesiaTechApp/galleries/duda_sync/galleries?idOrganization=${id}`);
        const data = await response.json();

        console.log("Fetched Gallery Data:", data); // ✅ Debugging API Response

        if (data && Array.isArray(data.galleries)) {
          setGallery(data.galleries);
        } else if (Array.isArray(data)) {
          setGallery(data);
        } else {
          setGallery([]);
        }
      } catch (error) {
        console.error("❌ Error fetching gallery:", error);
        setGallery([]);
      }
      setLoading(false);
    };

    fetchData();
  }, [id]);

  const handleGalleryClick = (galleryId) => {
    navigate(`/organization/${id}/gallery/${galleryId}`); // ✅ Navigate to the detailed gallery view
  };

  const handleLogoTap = () => {
    setTapCount(prev => prev + 1);
    if (tapCount + 1 === 4) {
      navigate("/");
      setTapCount(0);
    }
  };

  return (
    <div style={commonStyles.container}>
      {/* Banner */}
      <div style={commonStyles.banner}>
        {loading ? <Skeleton height={300} /> : church?.portadaArticulos ? (
          <img src={`https://iglesia-tech-api.e2api.com${church.portadaArticulos}`} alt="Church Banner" style={commonStyles.bannerImage} />
        ) : <Skeleton height={300} />}
      </div>

      {/* Logo */}
      <div style={commonStyles.logoContainer} onClick={handleLogoTap}>
        {loading ? <Skeleton circle height={90} width={90} /> : church?.Logo ? (
          <img src={`https://iglesia-tech-api.e2api.com${church.Logo}`} alt="Church Logo" style={commonStyles.logo} />
        ) : <Skeleton circle height={90} width={90} />}
      </div>

      {/* Back Button */}
      <button onClick={() => navigate(-1)} style={commonStyles.backButton}>⬅ Volver</button>

      <h2 style={commonStyles.title}>🖼 Church Gallery</h2>

      {/* Gallery List */}
      <div style={commonStyles.sectionContainer}>
        {loading ? (
          <Skeleton count={4} />
        ) : gallery.length > 0 ? (
          <div style={styles.grid}>
            {gallery.map((item) => (
              <div key={item.id} style={styles.galleryCard} onClick={() => handleGalleryClick(item.id)}>
                {item.gallery_cover?.src_path ? (
                  <img
                    src={`https://iglesia-tech-api.e2api.com${item.gallery_cover.src_path}`}
                    alt={item.name}
                    style={styles.galleryImage}
                  />
                ) : (
                  <Skeleton height={150} />
                )}
                <h3>{item.name}</h3>
                <p>{item.description || "Sin descripción disponible"}</p>
              </div>
            ))}
          </div>
        ) : (
          <p>No hay imágenes en la galería.</p>
        )}
      </div>
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
  galleryCard: {
    padding: "15px",
    borderRadius: "8px",
    backgroundColor: "#fff",
    textAlign: "center",
    boxShadow: "0px 4px 6px rgba(0,0,0,0.1)",
    cursor: "pointer", // ✅ Ensures clicking navigates to gallery details
  },
  galleryImage: {
    width: "100%",
    height: "150px",
    objectFit: "cover",
    borderRadius: "8px",
  },
};

export default GalleryPage;
