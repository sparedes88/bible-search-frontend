import React, { useEffect, useState } from "react";
import { getPublicChurchGroups } from "../api";
import { useNavigate } from "react-router-dom";

const ChatLog = ({ churchID }) => {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchGroups = async () => {
      if (churchID) {
        try {
          const groupsData = await getPublicChurchGroups(churchID);
          setGroups(groupsData);
        } catch (error) {
          console.error("Error fetching groups:", error);
        } finally {
          setLoading(false);
        }
      }
    };
    fetchGroups();
  }, [churchID]);

  const handleGroupClick = (groupId) => {
    navigate(`/chat/${groupId}`);
  };

  return (
    <div>
      <h2>🎭 Church Groups</h2>
      <div style={styles.grid}>
        {loading ? (
          <p>Loading groups...</p>
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

export default ChatLog;