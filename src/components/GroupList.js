import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import axios from "axios";

const GroupList = () => {
  const { idIglesia } = useParams(); // Get idIglesia from URL
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null); // Add error state
  const navigate = useNavigate();

  useEffect(() => {
    const fetchGroups = async () => {
      if (idIglesia) {
        try {
          console.log(`Fetching groups for idIglesia: ${idIglesia}`); // Debugging
          const response = await axios.get(`https://iglesia-tech-api.e2api.com/api/iglesiaTechApp/groups/filter`, {
            params: {
              idIglesia: idIglesia,
              type: "public",
              group_type: 1,
            },
          });
          console.log('Groups fetched:', response.data.groups); // Debugging
          setGroups(response.data.groups);
        } catch (error) {
          console.error("Error fetching groups:", error);
          setError("Error fetching groups. Please try again later."); // Set error message
        } finally {
          setLoading(false);
        }
      }
    };
    fetchGroups();
  }, [idIglesia]);

  const handleGroupClick = (groupId) => {
    navigate(`/chat/${groupId}`);
  };

  return (
    <div>
      <h2>🎭 Church Groups</h2>
      <div style={styles.grid}>
        {loading ? (
          <p>Loading groups...</p>
        ) : error ? (
          <p>{error}</p> // Display error message
        ) : groups.length > 0 ? (
          groups.map((group) => (
            <button key={group.idGroup} style={styles.groupButton} onClick={() => handleGroupClick(group.idGroup)}>
              {group.title}
            </button>
          ))
        ) : (
          <p>No public groups available.</p>
        )}
      </div>
    </div>
  );
};

const styles = {
  grid: {
    display: "flex",
    flexWrap: "wrap",
    gap: "10px",
    marginTop: "10px"
  },
  groupButton: {
    padding: "10px 20px",
    border: "1px solid #ddd",
    borderRadius: "5px",
    fontSize: "16px",
    background: "#007bff",
    color: "#fff",
    cursor: "pointer",
    flex: "1 1 calc(33.333% - 20px)",
    textAlign: "center"
  }
};

export default GroupList;