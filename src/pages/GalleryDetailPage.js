import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Skeleton from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import { searchChurchById } from "../api";
import commonStyles from "./commonStyles";

const GalleryDetailPage = () => {
  const { id, galleryId } = useParams();
  const navigate = useNavigate();
  const [church, setChurch] = useState(null);
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchGalleryImages = async () => {
      setLoading(true);
      try {
        // Fetch church profile details that contain gallery photos
        const response = await fetch(
          `https://iglesia-tech-api.e2api.com/api/iglesiaTechApp/iglesias/getIglesiaProfileDetail?idIglesia=${id}`
        );
        const data = await response.json();
        console.log("Fetched Gallery Detail Data:", data);

        // Extract photos related to the specific gallery ID
        if (data && data.iglesia && Array.isArray(data.iglesia.galleries)) {
          const gallery = data.iglesia.galleries.find(gallery => gallery.id === parseInt(galleryId));
          if (gallery && Array.isArray(gallery.photos)) {
            setImages(gallery.photos);
          } else {
            setImages([]);
          }
        } else {
          setImages([]);
        }

        // Fetch church data for banner and logo
        const churchData = await searchChurchById(id);
        setChurch(churchData);
      } catch (error) {
        console.error("❌ Error fetching gallery images:", error);
        setImages([]);
      }
      setLoading(false);
    };

    fetchGalleryImages();
  }, [id, galleryId]);

  return (
    <div style={commonStyles.container}>
      {/* Banner */}
      <div style={commonStyles.banner}>
        {loading ? <Skeleton height={300} /> : church?.portadaArticulos ? (
          <img src={`https://iglesia-tech-api.e2api.com${church.portadaArticulos}`} alt="Church Banner" style={commonStyles.bannerImage} />
        ) : <Skeleton height={300} />}
      </div>

      {/* Logo */}
      <div style={commonStyles.logoContainer}>
        {loading ? <Skeleton circle height={90} width={90} /> : church?.Logo ? (
          <img src={`https://iglesia-tech-api.e2api.com${church.Logo}`} alt="Church Logo" style={commonStyles.logo} />
        ) : <Skeleton circle height={90} width={90} />}
      </div>

      {/* Back Button */}
      <button onClick={() => navigate(-1)} style={commonStyles.backButton}>⬅ Volver</button>

      <h2 style={commonStyles.title}>📷 Galería</h2>

      <div style={commonStyles.sectionContainer}>
        {loading ? (
          <Skeleton count={6} />
        ) : images.length > 0 ? (
          <div style={styles.grid}>
            {images.map((image) => (
              <div key={image.id} style={styles.imageCard}>
                <img src={`https://iglesia-tech-api.e2api.com${image.src_path}`} alt="Gallery Item" style={styles.galleryImage} />
              </div>
            ))}
          </div>
        ) : (
          <p>No hay imágenes disponibles.</p>
        )}
      </div>
    </div>
  );
};

// ✅ Ensuring styles object exists
const styles = {
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
    gap: "10px",
  },
  imageCard: {
    textAlign: "center",
  },
  galleryImage: {
    width: "100%",
    borderRadius: "8px",
  },
};

export default GalleryDetailPage;