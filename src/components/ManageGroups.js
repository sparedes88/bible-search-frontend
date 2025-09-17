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
} from "@firebase/firestore";
import { db } from "../firebase";
import { Spinner } from "react-bootstrap";
import { MdDelete } from "react-icons/md";
import { fetchUserById } from "../api/church";
import { FaEye } from "react-icons/fa6";
import { Tooltip } from "react-tooltip";

const ManageGroups = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [newGroupName, setNewGroupName] = useState("");
  const [isCreatingGroup, setCreatingGroup] = useState(false);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isDeletingGroup, setDeletingGroup] = useState(false);
  const [refresh, setRefresh] = useState(false);
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
        churchId: id,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
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

  return (
    <div style={commonStyles.container}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <button
          onClick={() => navigate(`/church/${id}/mi-organizacion`)}
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
                  <div>
                    <p>Members: {group.members.length}</p>
                    <p>Created by: {group.creator.displayName}</p>
                  </div>
                  <div>
                    <button
                      onClick={() => navigate(`/church/${id}/chat/${group.id}`)}
                      className="icon-button"
                      disabled={isDeletingGroup}
                    >
                      <FaEye
                        size={20}
                        color="#228af2"
                        data-tooltip-id="view-tooltip"
                        data-tooltip-content="View Group chat"
                      />
                      <Tooltip id="view-tooltip" place="top" effect="solid" />
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
    </div>
  );
};

export default ManageGroups;
