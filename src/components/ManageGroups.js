import React, { useState, useEffect } from "react";
import commonStyles from "../pages/commonStyles";
import ChurchHeader from "./ChurchHeader";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import "./ManageGroups.css";
import { toast } from "react-toastify";
import {
  addDoc,
  collection,
  serverTimestamp,
  query,
  where,
  getDocs,
  doc,
  deleteDoc,
  getDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "../firebase";
import { Spinner } from "react-bootstrap";
import { MdDelete, MdEdit, MdAdd, MdLocationOn, MdSchedule } from "react-icons/md";
import { FaEye, FaPenToSquare, FaCalendarAlt, FaClock, FaLocationPin } from "react-icons/fa6";
import { Tooltip } from "react-tooltip";
import Modal from "react-modal";
import { fetchUserById } from "../api/church";

// Set the app element for accessibility
Modal.setAppElement('#root');

const ManageGroups = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  // Basic state
  const [newGroupName, setNewGroupName] = useState("");
  const [isCreatingGroup, setCreatingGroup] = useState(false);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isDeletingGroup, setDeletingGroup] = useState(false);
  const [refresh, setRefresh] = useState(false);

  // Edit modal state
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState(null);
  const [editFormData, setEditFormData] = useState({
    groupName: "",
    description: "",
    address: {
      street: "",
      city: "",
      zipCode: "",
      state: "",
      country: ""
    },
    meetingTimes: [],
    recurrence: "none"
  });

  // Meeting time form state
  const [newMeetingTime, setNewMeetingTime] = useState({
    date: "",
    time: "",
    dayOfWeek: ""
  });

  console.log("groups >>", groups);
  useEffect(() => {
    const fetchGroups = async () => {
      try {
        const groupsQuery = query(
          collection(db, "groups"),
          where("churchId", "==", id)
        );
        const querySnapshot = await getDocs(groupsQuery);
        // Fetch groups and their creators' data
        const groupsList = await Promise.all(
          querySnapshot.docs.map(async (doc) => {
            const groupData = doc.data();
            const creatorData = await fetchUserById(groupData.createdBy);

            return {
              id: doc.id,
              ...groupData,
              creator: {
                displayName: `${creatorData.name} ${creatorData.lastName}`,
                userId: creatorData.uid,
              },
            };
          })
        );

        setGroups(groupsList);
      } catch (error) {
        console.error("Error fetching groups:", error);
        toast.error("Failed to load groups");
      } finally {
        setLoading(false);
      }
    };

    fetchGroups();
  }, [id, refresh]);

  const handleCreateGroup = async () => {
    if (!newGroupName) {
      toast.warn("Please enter group name first!");
      return;
    }
    setCreatingGroup(true);
    try {
      const newGroup = {
        groupName: newGroupName,
        description: "",
        address: "",
        meetingTimes: [],
        recurrence: "none",
        churchId: id,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        members: [
          {
            userId: user.uid,
            displayName: `${user.name} ${user.lastName}`,
            role: user.role,
          },
        ],
      };
      const docRef = await addDoc(collection(db, "groups"), newGroup);
      if (docRef.id) {
        toast.success("Group created successfully!");
        setNewGroupName("");
        setRefresh(!refresh);
      }
    } catch (error) {
      console.error("Error creating group:", error);
      toast.error("Failed to create group");
    } finally {
      setCreatingGroup(false);
    }
  };

  const handleDeleteGroup = async (groupId) => {
    if (!groupId) {
      toast.warn("Oops, Try refresh browser!");
      return;
    }
    setDeletingGroup(true);
    try {
      const groupDocRef = doc(db, "groups", groupId);
      await deleteDoc(groupDocRef);
      // Verify if the document is deleted
      const docSnap = await getDoc(groupDocRef);

      if (!docSnap.exists()) {
        toast.success("Group deleted successfully!");
        setRefresh(!refresh);
      }
    } catch (error) {
      console.error("Error deleting group:", error);
      toast.error("Failed to delete group");
    } finally {
      setDeletingGroup(false);
    }
  };

  const openEditModal = (group) => {
    setEditingGroup(group);
    // Handle both old string format and new object format for address
    let addressData = {
      street: "",
      city: "",
      zipCode: "",
      state: "",
      country: ""
    };

    if (typeof group.address === 'string') {
      // Old format - just put the whole address in street for now
      addressData.street = group.address;
    } else if (group.address && typeof group.address === 'object') {
      // New format
      addressData = { ...addressData, ...group.address };
    }

    setEditFormData({
      groupName: group.groupName || "",
      description: group.description || "",
      address: addressData,
      meetingTimes: group.meetingTimes || [],
      recurrence: group.recurrence || "none"
    });
    setIsEditModalOpen(true);
  };

  const closeEditModal = () => {
    setIsEditModalOpen(false);
    setEditingGroup(null);
    setEditFormData({
      groupName: "",
      description: "",
      address: {
        street: "",
        city: "",
        zipCode: "",
        state: "",
        country: ""
      },
      meetingTimes: [],
      recurrence: "none"
    });
    setNewMeetingTime({ date: "", time: "", dayOfWeek: "" });
  };

  const handleUpdateGroup = async () => {
    if (!editFormData.groupName.trim()) {
      toast.warn("Please enter group name!");
      return;
    }

    try {
      const groupDocRef = doc(db, "groups", editingGroup.id);
      await updateDoc(groupDocRef, {
        ...editFormData,
        updatedAt: serverTimestamp(),
      });

      toast.success("Group updated successfully!");
      setRefresh(!refresh);
      closeEditModal();
    } catch (error) {
      console.error("Error updating group:", error);
      toast.error("Failed to update group");
    }
  };

  const addMeetingTime = () => {
    if (!newMeetingTime.date || !newMeetingTime.time) {
      toast.warn("Please select both date and time!");
      return;
    }

    const meetingTime = {
      id: Date.now().toString(),
      date: newMeetingTime.date,
      time: newMeetingTime.time,
      dayOfWeek: newMeetingTime.dayOfWeek || getDayOfWeek(newMeetingTime.date)
    };

    setEditFormData(prev => ({
      ...prev,
      meetingTimes: [...prev.meetingTimes, meetingTime]
    }));

    setNewMeetingTime({ date: "", time: "", dayOfWeek: "" });
  };

  const removeMeetingTime = (meetingTimeId) => {
    setEditFormData(prev => ({
      ...prev,
      meetingTimes: prev.meetingTimes.filter(mt => mt.id !== meetingTimeId)
    }));
  };

  const getDayOfWeek = (dateString) => {
    const date = new Date(dateString);
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[date.getDay()];
  };

  const formatMeetingTime = (meetingTime) => {
    const date = new Date(meetingTime.date);
    const time = meetingTime.time;
    return `${date.toLocaleDateString()} at ${time} (${meetingTime.dayOfWeek})`;
  };

  return (
    <div style={commonStyles.fullWidthContainer}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <button
          onClick={() => navigate(`/organization/${id}/mi-organizacion`)}
          style={commonStyles.backButton}
        >
          ⬅ Back to Organization
        </button>
      </div>

      <ChurchHeader id={id} applyShadow={false} />

      <div className="create-group-container">
        <h3>Create New Group</h3>
        <div>
          <input
            type="text"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            placeholder="Enter group name"
          />
        </div>
        <button
          onClick={handleCreateGroup}
          className="create-group-btn"
          disabled={isCreatingGroup || !newGroupName}
        >
          {isCreatingGroup ? "Creating..." : "Create Group"}
        </button>
      </div>

      <div className="group-list-container">
        <h3>Group List</h3>
        {loading ? (
          <p>Loading groups...</p>
        ) : groups.length === 0 ? (
          <p>No groups found</p>
        ) : (
          <div className="group-grid">
            {groups.map((group) => (
              <div key={group.id} className="group-card">
                <h4>{group.groupName}</h4>
                <div className="group-card-body">
                  <div className="group-info">
                    <p><strong>Members:</strong> {group.members.length}</p>
                    <p><strong>Created by:</strong> {group.creator.displayName}</p>
                    {group.address && (
                      <div className="group-address">
                        <FaLocationPin style={{ marginRight: '5px', marginBottom: '2px' }} />
                        {typeof group.address === 'string' ? (
                          <span>{group.address}</span>
                        ) : (
                          <div className="full-address">
                            {group.address.street && <div>{group.address.street}</div>}
                            {(group.address.city || group.address.state || group.address.zipCode) && (
                              <div>
                                {group.address.city}
                                {group.address.city && group.address.state && ', '}
                                {group.address.state}
                                {(group.address.city || group.address.state) && group.address.zipCode && ' '}
                                {group.address.zipCode}
                              </div>
                            )}
                            {group.address.country && <div>{group.address.country}</div>}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="group-actions">
                    <button
                      onClick={() => navigate(`/organization/${id}/chat/${group.id}`)}
                      className="icon-button"
                      disabled={isDeletingGroup}
                    >
                      <FaEye
                        size={20}
                        color="#228af2"
                        data-tooltip-id="chat-tooltip"
                        data-tooltip-content="Chat with Group"
                      />
                      <Tooltip id="chat-tooltip" place="top" effect="solid" />
                    </button>
                    <button
                      onClick={() => navigate(`/organization/${id}/group-details/${group.id}`)}
                      className="icon-button"
                      disabled={isDeletingGroup}
                    >
                      <MdSchedule
                        size={20}
                        color="#17a2b8"
                        data-tooltip-id="view-tooltip"
                        data-tooltip-content="View Group Details"
                      />
                      <Tooltip id="view-tooltip" place="top" effect="solid" />
                    </button>
                    <button
                      onClick={() => openEditModal(group)}
                      className="icon-button"
                      disabled={isDeletingGroup}
                    >
                      <FaPenToSquare
                        size={20}
                        color="#28a745"
                        data-tooltip-id="edit-tooltip"
                        data-tooltip-content="Edit Group"
                      />
                      <Tooltip id="edit-tooltip" place="top" effect="solid" />
                    </button>
                    <button
                      onClick={() => handleDeleteGroup(group.id)}
                      className="icon-button"
                      disabled={isDeletingGroup}
                    >
                      <MdDelete
                        size={20}
                        color="#ac4343"
                        data-tooltip-id="delete-tooltip"
                        data-tooltip-content="Delete Group"
                      />
                      <Tooltip id="delete-tooltip" place="top" effect="solid" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Edit Group Modal */}
      {isEditModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3>Edit Group</h3>
              <button onClick={closeEditModal} className="close-button">×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Group Name *</label>
                <input
                  type="text"
                  value={editFormData.groupName}
                  onChange={(e) => setEditFormData(prev => ({ ...prev, groupName: e.target.value }))}
                  placeholder="Enter group name"
                />
              </div>

              <div className="form-group">
                <label>Description</label>
                <textarea
                  value={editFormData.description}
                  onChange={(e) => setEditFormData(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Enter group description"
                  rows="3"
                />
              </div>

              <div className="form-group">
                <label>Address</label>
                <div className="address-fields">
                  <input
                    type="text"
                    value={editFormData.address.street}
                    onChange={(e) => setEditFormData(prev => ({
                      ...prev,
                      address: { ...prev.address, street: e.target.value }
                    }))}
                    placeholder="Street Address"
                  />
                  <div className="address-row">
                    <input
                      type="text"
                      value={editFormData.address.city}
                      onChange={(e) => setEditFormData(prev => ({
                        ...prev,
                        address: { ...prev.address, city: e.target.value }
                      }))}
                      placeholder="City"
                    />
                    <input
                      type="text"
                      value={editFormData.address.zipCode}
                      onChange={(e) => setEditFormData(prev => ({
                        ...prev,
                        address: { ...prev.address, zipCode: e.target.value }
                      }))}
                      placeholder="ZIP Code"
                    />
                  </div>
                  <div className="address-row">
                    <input
                      type="text"
                      value={editFormData.address.state}
                      onChange={(e) => setEditFormData(prev => ({
                        ...prev,
                        address: { ...prev.address, state: e.target.value }
                      }))}
                      placeholder="State"
                    />
                    <input
                      type="text"
                      value={editFormData.address.country}
                      onChange={(e) => setEditFormData(prev => ({
                        ...prev,
                        address: { ...prev.address, country: e.target.value }
                      }))}
                      placeholder="Country"
                    />
                  </div>
                </div>
              </div>

              <div className="form-group">
                <label>Recurrence</label>
                <select
                  value={editFormData.recurrence}
                  onChange={(e) => setEditFormData(prev => ({ ...prev, recurrence: e.target.value }))}
                >
                  <option value="none">No recurrence</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>

              <div className="form-group">
                <label>Meeting Times</label>
                <div className="meeting-times-list">
                  {editFormData.meetingTimes.map((meetingTime) => (
                    <div key={meetingTime.id} className="meeting-time-item">
                      <span>{formatMeetingTime(meetingTime)}</span>
                      <button
                        onClick={() => removeMeetingTime(meetingTime.id)}
                        className="remove-meeting-time-btn"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>

                <div className="add-meeting-time">
                  <input
                    type="date"
                    value={newMeetingTime.date}
                    onChange={(e) => setNewMeetingTime(prev => ({ ...prev, date: e.target.value }))}
                  />
                  <input
                    type="time"
                    value={newMeetingTime.time}
                    onChange={(e) => setNewMeetingTime(prev => ({ ...prev, time: e.target.value }))}
                  />
                  <button onClick={addMeetingTime} className="add-meeting-time-btn">
                    Add Meeting Time
                  </button>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={closeEditModal} className="cancel-btn">
                Cancel
              </button>
              <button onClick={handleUpdateGroup} className="save-btn">
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ManageGroups;
