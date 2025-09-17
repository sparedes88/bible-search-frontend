import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { searchChurchById } from "../api";
import { auth } from "../firebase"; // ✅ Import Firebase Authentication
import commonStyles from "./commonStyles";
import ChurchHeader from "../components/ChurchHeader";

const ChurchPage = () => {
  const { id } = useParams(); // ✅ Get Church ID from URL
  const navigate = useNavigate();
  const [church, setChurch] = useState(null);
  const [clickCount, setClickCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [imageLoaded, setImageLoaded] = useState({}); // Track image load state

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        console.log(`Fetching church details for ID: ${id}`);
        const churchData = await searchChurchById(id);
        setChurch(churchData);
      } catch (error) {
        console.error("Error fetching church:", error);
      }
      setLoading(false);
    };
    fetchData();
  }, [id]);

  useEffect(() => {
    if (clickCount === 4) {
      navigate("/");
    }
  }, [clickCount, navigate]);

  const handleLogoClick = () => {
    setClickCount((prevCount) => prevCount + 1);
  };

  const handleProfileClick = () => {
    if (auth.currentUser) {
      navigate(`/church/${id}/mi-perfil`); // ✅ If logged in, go to profile
    } else {
      navigate(`/church/${id}/login`); // ✅ If NOT logged in, go to login
    }
  };

  const handleImageLoad = (index) => {
    console.log(`Image ${index} loaded`);
    setImageLoaded((prevState) => ({ ...prevState, [index]: true }));
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Banner & Logo Image */}
      <ChurchHeader id={id} applyShadow={false}/>

      {/* Navigation Buttons */}
      <div style={styles.cardsContainer}>
        {[
          { path: 'info', label: '📜 Basic Information', background: 'background1.jpg' },
          { path: 'events', label: '📅 Events', background: 'background2.jpg' },
          { path: 'groups', label: '🎭 Groups', background: 'background3.jpg' },
          { path: 'directory', label: '📖 Directory', background: 'background4.jpg' },
          { path: 'contact', label: '📞 Contact', background: 'background5.jpg' },
          { path: 'articles', label: '📰 Articles', background: 'background6.jpg' },
          { path: 'media', label: '🎥 Media', background: 'background7.jpg' },
          { path: 'gallery', label: '🖼 Gallery', background: 'background8.jpg' },
          { path: 'bible', label: '📖 Bible', background: 'background9.jpg' },
          { path: 'mi-perfil', label: '👤 Mi Perfil', background: 'background10.jpg', onClick: handleProfileClick },
        ].map((item, index) => (
          <div
            key={index}
            style={{
              ...styles.tallCard,
              backgroundImage: `url('/image_server/${church?.idIglesia}/${item.background}')`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              backgroundColor: '#1A237E', // Fallback color
            }}
            onClick={() => item.onClick ? item.onClick() : navigate(`/church/${id}/${item.path}`)}
          >
            {!imageLoaded[index] && <h3>{item.label}</h3>}
            <img
              src={`/image_server/${church?.idIglesia}/${item.background}`}
              alt={item.label}
              style={{ display: 'none' }}
              onLoad={() => handleImageLoad(index)}
              onError={() => console.error(`Failed to load image: /image_server/${church?.idIglesia}/${item.background}`)}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

const styles = {
  container: {
    maxWidth: "600px",
    margin: "auto",
    padding: "20px",
    fontFamily: "'Nunito', sans-serif",
    textAlign: "center",
  },
  banner: {
    width: "100%",
    height: "200px",
    backgroundSize: "cover",
    backgroundPosition: "center",
  },
  bannerImage: {
    width: "100%",
    height: "200px",
    objectFit: "cover",
    borderRadius: "10px",
  },
  logoContainer: {
    display: "flex",
    justifyContent: "center",
    marginTop: "-50px",
    cursor: "pointer",
  },
  logo: {
    width: "100px",
    height: "100px",
    borderRadius: "50%",
    border: "4px solid white",
    boxShadow: "0px 4px 6px rgba(0,0,0,0.2)",
  },
  churchName: {
    marginTop: "10px",
    fontSize: "22px",
    fontWeight: "700",
  },
  cardsContainer: {
    display: "flex",
    flexDirection: "column",
    gap: "15px",
    marginTop: "20px",
  },
  tallCard: {
    padding: "30px",
    backgroundColor: "#1A237E",
    color: "white",
    textAlign: "center",
    borderRadius: "8px",
    cursor: "pointer",
    fontSize: "18px",
    fontWeight: "600",
    height: "190px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "background 0.3s ease",
    backgroundSize: 'cover',
    backgroundPosition: 'center',
  },
};

export default ChurchPage;