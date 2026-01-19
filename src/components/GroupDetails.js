import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import { fetchUserById } from "../api/church";
import commonStyles from "../pages/commonStyles";
import ChurchHeader from "./ChurchHeader";
import { Spinner } from "react-bootstrap";
import { FaArrowLeft, FaCalendar, FaClock, FaMapPin, FaUsers, FaUser } from "react-icons/fa6";
import "./GroupDetails.css";

const GroupDetails = () => {
  const { id, groupId } = useParams();
  const navigate = useNavigate();
  const [group, setGroup] = useState(null);
  const [loading, setLoading] = useState(true);
  const [creator, setCreator] = useState(null);

  useEffect(() => {
    const fetchGroupDetails = async () => {
      try {
        const groupDocRef = doc(db, "groups", groupId);
        const groupDoc = await getDoc(groupDocRef);

        if (groupDoc.exists()) {
          const groupData = groupDoc.data();
          setGroup({ id: groupDoc.id, ...groupData });

          // Fetch creator information
          if (groupData.createdBy) {
            const creatorData = await fetchUserById(groupData.createdBy);
            setCreator(creatorData);
          }
        }
      } catch (error) {
        console.error("Error fetching group details:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchGroupDetails();
  }, [groupId]);

  const formatMeetingTime = (meetingTime) => {
    const date = new Date(meetingTime.date);
    const time = meetingTime.time;
    return `${date.toLocaleDateString()} at ${time} (${meetingTime.dayOfWeek})`;
  };

  if (loading) {
    return (
      <div style={commonStyles.container}>
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "200px" }}>
          <Spinner animation="border" />
        </div>
      </div>
    );
  }

  if (!group) {
    return (
      <div style={commonStyles.container}>
        <div style={{ textAlign: "center", padding: "2rem" }}>
          <h3>Group not found</h3>
          <button
            onClick={() => navigate(`/organization/${id}/manage-groups`)}
            style={commonStyles.backButton}
          >
            Back to Groups
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={commonStyles.container}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <button
          onClick={() => navigate(`/organization/${id}/manage-groups`)}
          style={commonStyles.backButton}
        >
          <FaArrowLeft style={{ marginRight: "0.5rem" }} />
          Back to Groups
        </button>
      </div>

      <ChurchHeader id={id} applyShadow={false} />

      <div className="group-details-container">
        <div className="group-details-header">
          <h2>{group.groupName}</h2>
          {group.description && (
            <p className="group-description">{group.description}</p>
          )}
        </div>

        <div className="group-details-content">
          <div className="group-info-section">
            <h3><FaUsers style={{ marginRight: "0.5rem" }} />Group Information</h3>
            <div className="info-grid">
              <div className="info-item">
                <strong>Members:</strong> {group.members?.length || 0}
              </div>
              <div className="info-item">
                <strong>Created:</strong> {group.createdAt ? new Date(group.createdAt.toDate()).toLocaleDateString() : 'N/A'}
              </div>
              <div className="info-item">
                <strong>Created by:</strong>
                {creator ? `${creator.name} ${creator.lastName}` : 'Unknown'}
              </div>
              {group.recurrence && group.recurrence !== 'none' && (
                <div className="info-item">
                  <strong>Recurrence:</strong> {group.recurrence}
                </div>
              )}
            </div>
          </div>

          {group.address && (
            <div className="group-info-section">
              <h3><FaMapPin style={{ marginRight: "0.5rem" }} />Location</h3>
              <p>{group.address}</p>
            </div>
          )}

          {group.meetingTimes && group.meetingTimes.length > 0 && (
            <div className="group-info-section">
              <h3><FaCalendar style={{ marginRight: "0.5rem" }} />Meeting Times</h3>
              <div className="meeting-times-list">
                {group.meetingTimes.map((meetingTime, index) => (
                  <div key={meetingTime.id || index} className="meeting-time-item">
                    <FaClock style={{ marginRight: "0.5rem" }} />
                    {formatMeetingTime(meetingTime)}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="group-info-section">
            <h3><FaUser style={{ marginRight: "0.5rem" }} />Members</h3>
            <div className="members-list">
              {group.members && group.members.length > 0 ? (
                group.members.map((member, index) => (
                  <div key={member.userId || index} className="member-item">
                    {member.displayName || 'Unknown Member'}
                    {member.role && <span className="member-role">({member.role})</span>}
                  </div>
                ))
              ) : (
                <p>No members found</p>
              )}
            </div>
          </div>
        </div>

        <div className="group-actions">
          <button
            onClick={() => navigate(`/organization/${id}/chat/${group.id}`)}
            className="action-btn chat-btn"
          >
            <FaUsers style={{ marginRight: "0.5rem" }} />
            Join Chat
          </button>
        </div>
      </div>
    </div>
  );
};

export default GroupDetails;