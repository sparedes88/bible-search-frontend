import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Skeleton from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import { searchChurchById } from "../api"; // Remove getPublicChurchGroups import
import commonStyles from "./commonStyles";
import axios from "axios"; // Import axios for API call

const GroupsPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [church, setChurch] = useState(null);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tapCount, setTapCount] = useState(0);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const churchData = await searchChurchById(id);
        setChurch(churchData);

        // Fetch groups using the provided API
        const response = await axios.get(`https://iglesia-tech-api.e2api.com/api/iglesiaTechApp/groups/filter`, {
          params: {
            idIglesia: id,
            type: "public",
            group_type: 1,
          },
        });
        setGroups(response.data.groups);
      } catch (error) {
        console.error("❌ Error fetching groups:", error);
      }
      setLoading(false);
    };

    fetchData();
  }, [id]);

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

      <h2 style={commonStyles.title}>🎭 Church Groups</h2>

      {/* Groups List */}
      <div style={commonStyles.sectionContainer}>
        {loading ? (
          <Skeleton count={4} />
        ) : groups.length > 0 ? (
          <div style={styles.grid}>
            {groups.map((group) => (
              <div key={group.idGroup} style={styles.groupCard}>
                <img src={`https://iglesia-tech-api.e2api.com${group.picture}`} alt={group.title} style={styles.groupImage} />
                <h3>{group.title}</h3>
                <p>{group.short_description}</p>
              </div>
            ))}
          </div>
        ) : (
          <p>No groups available.</p>
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
  groupCard: {
    padding: "15px",
    borderRadius: "8px",
    backgroundColor: "#fff",
    textAlign: "center",
    boxShadow: "0px 4px 6px rgba(0,0,0,0.1)",
  },
  groupImage: {
    width: "100%",
    height: "150px",
    objectFit: "cover",
    borderRadius: "8px",
  },
};

export default GroupsPage;