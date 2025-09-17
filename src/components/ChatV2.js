import React, { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { collection, query, where, getDocs, doc, getDoc } from "firebase/firestore";
import { db } from "../firebase"; // Ensure correct Firebase import
import Skeleton from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import commonStyles from "../pages/commonStyles";
import ChurchHeader from "./ChurchHeader";
import { useAuth } from "../contexts/AuthContext";

const ChatV2 = () => {
  const { id } = useParams(); // Church ID
  const { user } = useAuth();
  const navigate = useNavigate();
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [unreadCounts, setUnreadCounts] = useState({});

  console.log("groups >>",groups)

  useEffect(() => {
    const fetchGroups = async () => {
      if (!user) return;
      setLoading(true);

      try {
        const q = query(collection(db, "groups"), where("churchId", "==", id));
        const querySnapshot = await getDocs(q);
        const filteredGroups = [];
        console.log("Snapshot >>",querySnapshot)
        querySnapshot.forEach((doc) => {
          const groupData = { id: doc.id, ...doc.data() };
          if (groupData.members.some((member) => member.userId === user.uid)) {
            filteredGroups.push(groupData);
          }
          // filteredGroups.push(groupData);
        });

        setGroups(filteredGroups);
        
        // Fetch unread counts for each group
        const counts = {};
        for (const group of filteredGroups) {
          const count = await getUnreadMessageCount(group.id, user.uid);
          counts[group.id] = count;
        }
        setUnreadCounts(counts);
      } catch (error) {
        console.error("Error fetching groups:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchGroups();
  }, [id, user]);

  // Function to get unread message count
  const getUnreadMessageCount = async (groupId, userId) => {
    if (!userId) return 0;

    const readStatusRef = doc(db, `groups/${groupId}/readStatus/${userId}`);
    const readStatusDoc = await getDoc(readStatusRef);

    let lastReadTimestamp = null;
    if (readStatusDoc.exists()) {
      lastReadTimestamp = readStatusDoc.data().lastRead;
    }

    const messagesQuery = query(
      collection(db, `groups/${groupId}/messages`),
      where("sentAt", ">", lastReadTimestamp || new Date(0))
    );

    const messagesSnapshot = await getDocs(messagesQuery);
    return messagesSnapshot.size;
  };

  return (
    <div style={commonStyles.container}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <button
          onClick={() => navigate(`/church/${id}/mi-perfil`)}
          style={commonStyles.backButton}
        >
          ⬅ Volver
        </button>
      </div>

      <ChurchHeader id={id} applyShadow={false} />

      <h2 style={{ marginTop: "-30px" }}>Your Groups</h2>

      {loading ? (
        <Skeleton count={3} height={50} />
      ) : groups.length > 0 ? (
        <ul>
          {groups.map((group) => (
            <li
              key={group.id}
              onClick={() => navigate(`/church/${id}/chat/${group.id}`)}
              style={{
                cursor: "pointer",
                color: "blue",
                listStyle: "none",
                border: "1px solid rgb(211, 211, 211)",
                marginBottom: "10px",
                padding: "10px 15px",
                marginLeft: "-30px",
                borderRadius: "8px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span>{group.groupName}</span>
              <span
                style={{
                  backgroundColor:
                    unreadCounts[group.id] > 0 ? "#FF4B4B" : "#E0E0E0",
                  color: unreadCounts[group.id] > 0 ? "white" : "#909090",
                  borderRadius: "12px",
                  padding: "2px 8px",
                  fontSize: "12px",
                  fontWeight: "bold",
                  minWidth: "20px",
                  textAlign: "center",
                  display: "inline-block",
                }}
              >
                {unreadCounts[group.id] || 0}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p>No groups available.</p>
      )}
    </div>
  );
};

export default ChatV2;
