import React, { useEffect, useState } from "react";
import { db } from "../firebase";
import {
  collection,
  getDocs,
  doc,
  updateDoc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";
import { useNavigate, useParams } from "react-router-dom";
import Select from "react-select";
import "bootstrap/dist/css/bootstrap.min.css";
import "./Admin.css";
import { useAuth } from "../contexts/AuthContext";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { getAuth } from "firebase/auth";
import { initializeApp } from "firebase/app";
import "./Admin.css";
import commonStyles from "../pages/commonStyles";
import { fetchGroupList } from "../api/church";

// Remove the firebaseConfig import and create a secondary auth instance differently
const secondaryAuth = getAuth(
  initializeApp(
    {
      apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
      authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
      projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
      storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.REACT_APP_FIREBASE_APP_ID,
      measurementId: process.env.REACT_APP_FIREBASE_MEASUREMENT_ID,
    },
    "secondary"
  )
);

const Admin = () => {
  const { id } = useParams();
  const { user } = useAuth(); // *New*Get user from useAuth
  const [users, setUsers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(10);
  const [isChanged, setIsChanged] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState({
    name: true,
    lastName: true,
    phone: true, // Add this line
    memberStreet: true,
    memberCity: true,
    memberState: true,
    memberZip: true,
  });
  const [authChecking, setAuthChecking] = useState(true);
  const [hasProcessAccess, setHasProcessAccess] = useState(false);
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUser, setNewUser] = useState({
    email: "",
    name: "",
    lastName: "",
    phone: "",
    role: "member",
  });
  const [fieldErrors, setFieldErrors] = useState({
    email: false,
    name: false,
    lastName: false,
    phone: false,
  });
  const [adminUser, setAdminUser] = useState(null); // Add this state to store admin info
  const navigate = useNavigate();
  const roles = [
    { value: "member", label: "Member" },
    { value: "admin", label: "Admin" },
    { value: "global_admin", label: "Global Admin" },
  ];
console.log(groups)
console.log("users list >>",users)
  const columnOptions = [
    { value: "email", label: "Email" },
    { value: "name", label: "Name" },
    { value: "lastName", label: "Last Name" },
    { value: "phone", label: "Phone Number" }, // Add this line
    { value: "dob", label: "Date of Birth" },
    { value: "memberCity", label: "Member City" },
    { value: "memberState", label: "Member State" },
    { value: "memberStreet", label: "Member Street" },
    { value: "memberZip", label: "Member ZIP" },
    { value: "groups", label: "Groups" },
    { value: "role", label: "Role" },
  ];

  const predefinedOptions = [
    { value: "contacts", label: "Contacts" },
    { value: "groups", label: "Groups" },
    { value: "userAccess", label: "User Access" },
  ];

  const fetchGroups = async () => {
    try {
      const groupsData = await fetchGroupList(id);
      setGroups(groupsData);
    } catch (error) {
      console.error("Error fetching groups:", error);
    }
  };

  useEffect(() => {
    fetchGroups();
  }, [id]);

  useEffect(() => {
    const checkAuth = async () => {
      if (!user) {
        navigate("/not-authorized");
        return;
      }

      // Store admin user info
      setAdminUser(user);

      // Check if user role is global_admin or admin
      if (user?.role !== "global_admin" && user?.role !== "admin") {
        navigate("/not-authorized");
        return;
      }

      // Fetch users only for the current church
      const fetchUsers = async () => {
        try {
          const querySnapshot = await getDocs(collection(db, "users"));
          const usersData = querySnapshot.docs
            .map((doc) => ({ uid: doc.id, ...doc.data() }))
            .filter((user) => user.churchId === id); // Filter by church ID

          // Get all groups first
          const groupsData = await fetchGroupList(id);
          setGroups(groupsData);

          // Map users with their group memberships
          const usersWithGroups = usersData.map(user => {
            const userGroups = groupsData.filter(group => 
              group.members && group.members.some(member => member.userId === user.uid)
            );
            
            return {
              ...user,
              groupMemberships: userGroups.map(group => ({
                groupId: group.id,
                groupName: group.groupName
              }))
            };
          });

          setUsers(usersWithGroups);
        } catch (error) {
          console.error("Error fetching users:", error);
        } finally {
          setLoading(false);
        }
      };

      fetchUsers();
    };

    checkAuth();
  }, [user, navigate, id]);

  useEffect(() => {
    const checkProcessAccess = async () => {
      if (!user) return;

      try {
        const configRef = doc(db, "churches", id, "config", "process");
        await getDoc(configRef);
        setHasProcessAccess(true);
      } catch (error) {
        console.error("Process access check failed:", error);
        setHasProcessAccess(false);
      } finally {
        setAuthChecking(false);
      }
    };

    checkProcessAccess();
  }, [user, id]);

  const handleInputChange = (e, userId, field) => {
    const { value } = e.target;
    setUsers((prevUsers) =>
      prevUsers.map((user) =>
        user.id === userId ? { ...user, [field]: value, updated: true } : user
      )
    );
    setIsChanged(true);
  };

  const handleDateChange = (e, userId) => {
    const { value } = e.target;
    setUsers((prevUsers) =>
      prevUsers.map((user) =>
        user.id === userId ? { ...user, dob: value, updated: true } : user
      )
    );
    setIsChanged(true);
  };

  const handleGroupChange = async (selectedOptions, userId) => {
    try {
      // Find the user being modified
      const targetUser = users.find(user => user.uid === userId);
      if (!targetUser) {
        toast.error("User not found");
        return;
      }

      // Remove duplicates from selected options
      const uniqueOptions = selectedOptions ? selectedOptions.filter(
        (option, index, self) =>
          index === self.findIndex((t) => t.value === option.value)
      ) : [];

      // Immediately update local state for UI responsiveness
      setUsers(prevUsers => prevUsers.map(user => {
        if (user.uid === userId) {
          return {
            ...user,
            // Store the full group objects for proper UI rendering
            groupMemberships: uniqueOptions.map(option => ({
              groupId: option.value,
              groupName: option.label
            }))
          };
        }
        return user;
      }));

      // Get current user's groups
      const currentGroups = groups.filter(group => 
        group.members && group.members.some(member => member.userId === userId)
      );

      // Convert current groups to same format as selected options
      const currentOptions = currentGroups.map(group => ({
        value: group.id,
        label: group.groupName
      }));

      // Find groups that were removed and added
      const removedGroups = currentOptions.filter(
        group => !uniqueOptions.some(option => option.value === group.value)
      );
      const addedGroups = uniqueOptions.filter(
        option => !currentOptions.some(group => group.value === option.value)
      );

      // Handle removed groups
      for (const removedGroup of removedGroups) {
        const groupRef = doc(db, "groups", removedGroup.value);
        const groupDoc = await getDoc(groupRef);

        if (groupDoc.exists()) {
          const groupData = groupDoc.data();
          const updatedMembers = groupData.members.filter(
            member => member.userId !== userId
          );

          await updateDoc(groupRef, {
            members: updatedMembers,
          });
        }
      }

      // Handle added groups
      for (const addedGroup of addedGroups) {
        const groupRef = doc(db, "groups", addedGroup.value);
        const groupDoc = await getDoc(groupRef);

        if (groupDoc.exists()) {
          const groupData = groupDoc.data();
          const members = groupData.members || [];

          if (!members.some(member => member.userId === userId)) {
            const newMember = {
              userId: userId,
              displayName: `${targetUser.name} ${targetUser.lastName}`,
              role: targetUser.role,
            };

            await updateDoc(groupRef, {
              members: [...members, newMember],
            });
          }
        }
      }

      // Update groups state to reflect changes
      setGroups(prevGroups => prevGroups.map(group => {
        if (uniqueOptions.some(option => option.value === group.id)) {
          // This is a selected group - ensure user is in members
          const members = group.members || [];
          if (!members.some(member => member.userId === userId)) {
            return {
              ...group,
              members: [...members, {
                userId: userId,
                displayName: `${targetUser.name} ${targetUser.lastName}`,
                role: targetUser.role,
              }]
            };
          }
        } else {
          // This is not a selected group - remove user from members
          return {
            ...group,
            members: (group.members || []).filter(member => member.userId !== userId)
          };
        }
        return group;
      }));

      if (removedGroups.length > 0) {
        toast.success("Removed selected groups");
      }
      if (addedGroups.length > 0) {
        toast.success("Added selected groups");
      }
      
      setIsChanged(true);
    } catch (error) {
      console.error("Error updating group members:", error);
      toast.error("Error updating group membership");
    }
  };

  const handleRoleChange = (selectedOption, userId) => {
    const selectedRole = selectedOption ? selectedOption.value : "";
    setUsers((prevUsers) =>
      prevUsers.map((user) =>
        user.id === userId
          ? { ...user, role: selectedRole, updated: true }
          : user
      )
    );
    setIsChanged(true);
  };

  const handleSave = async (userId) => {
    const user = users.find((user) => user.id === userId);
    const updatedFields = Object.keys(user).reduce((acc, key) => {
      if (
        visibleColumns[key] &&
        key !== "id" &&
        key !== "updated" &&
        user[key] !== undefined
      ) {
        acc[key] = user[key];
      }
      return acc;
    }, {});

    try {
      await updateDoc(doc(db, "users", userId), updatedFields);
      alert("User updated successfully");
      setIsChanged(false);
    } catch (error) {
      console.error("Error updating user:", error);
      alert("Error updating user");
    }
  };

  const handleBackClick = (id) => {
    navigate(`/organization/${id}/mi-organizacion`);
  };

  const handleSearchChange = (e) => {
    setSearchTerm(e.target.value);
  };

  const handleColumnToggle = (selectedOptions) => {
    const selectedColumns = selectedOptions
      ? selectedOptions.map((option) => option.value)
      : [];
    const newVisibleColumns = columnOptions.reduce((acc, column) => {
      acc[column.value] = selectedColumns.includes(column.value);
      return acc;
    }, {});
    setVisibleColumns(newVisibleColumns);
  };

  const handlePredefinedOptionChange = (selectedOption) => {
    let newVisibleColumns = {};
    if (selectedOption.value === "contacts") {
      newVisibleColumns = {
        name: true,
        lastName: true,
        phone: true, // Add this line
        memberStreet: true,
        memberCity: true,
        memberState: true,
        memberZip: true,
      };
    } else if (selectedOption.value === "groups") {
      newVisibleColumns = {
        name: true,
        lastName: true,
        groups: true,
      };
    } else if (selectedOption.value === "userAccess") {
      newVisibleColumns = {
        name: true,
        lastName: true,
        role: true,
      };
    }
    setVisibleColumns(newVisibleColumns);
    handleColumnToggle(
      Object.keys(newVisibleColumns).map((key) => ({
        value: key,
        label: columnOptions.find((option) => option.value === key).label,
      }))
    );
  };

  const filteredUsers = users.filter(
    (user) =>
      user.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.lastName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.phone?.toLowerCase().includes(searchTerm.toLowerCase()) || // Add this line
      user.dob?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.memberCity?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.memberState?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.memberStreet?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.memberZip?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentUsers = filteredUsers.slice(indexOfFirstItem, indexOfLastItem);

  const totalPages = Math.ceil(filteredUsers.length / itemsPerPage);

  // Update the handleAddUser function
  const handleAddUser = async () => {
    try {
      // Validate fields
      const errors = {
        email: !newUser.email,
        name: !newUser.name,
        lastName: !newUser.lastName,
        phone: !newUser.phone,
      };

      setFieldErrors(errors);

      if (Object.values(errors).some((error) => error)) {
        toast.error("Please fill in all required fields");
        return;
      }

      // Create password
      const cleanPhone = newUser.phone.replace(/\D/g, "");
      if (cleanPhone.length < 4) {
        toast.error("Phone number must have at least 4 digits");
        return;
      }
      const last4Digits = cleanPhone.slice(-4);
      const tempPassword = `${newUser.lastName}${last4Digits}`;

      // Create new user using secondary auth instance
      const userCredential = await createUserWithEmailAndPassword(
        secondaryAuth,
        newUser.email,
        tempPassword
      );

      // Prepare user data
      const userData = {
        email: newUser.email,
        name: newUser.name,
        lastName: newUser.lastName,
        phone: newUser.phone,
        role: newUser.role || "member",
        createdAt: serverTimestamp(),
        churchId: id,
      };

      // Add user to Firestore
      const userRef = doc(db, "users", userCredential.user.uid);
      await setDoc(userRef, userData);

      // Update local state with the new user
      setUsers((prevUsers) => [
        ...prevUsers,
        {
          ...userData,
          uid: userCredential.user.uid,
          groupMemberships: [], // Initialize empty group memberships
        },
      ]);

      // Sign out from secondary auth instance
      await secondaryAuth.signOut();

      // Reset form
      setShowAddUser(false);
      setNewUser({
        email: "",
        name: "",
        lastName: "",
        phone: "",
        role: "member",
      });

      toast.success(
        <div>
          User created successfully!
          <br />
          Password: <strong>{tempPassword}</strong>
          <br />
          Please share this with the user securely.
        </div>,
        { autoClose: 5000 }
      );
    } catch (error) {
      console.error("Error creating user:", error);
      toast.error(`Error creating user: ${error.message}`);
    }
  };

  return (
    <div className="admin-container">
      <ToastContainer
        position="top-right"
        autoClose={5000}
        hideProgressBar={false}
        newestOnTop
        closeOnClick
        rtl={false}
        pauseOnFocusLoss
        draggable
        pauseOnHover
      />
      {authChecking ? (
        <div className="loading-container">
          <p>Checking authorization...</p>
        </div>
      ) : (
        <div className="admin-content">
          <button style={commonStyles.backButton} onClick={() => handleBackClick(id)}>
          ← Back to Organization
          </button>
          <h2 className="header top-border">Admin Panel - Users</h2>
          <input
            className="search-input"
            type="text"
            placeholder="Search by email, name, last name, or other fields"
            value={searchTerm}
            onChange={handleSearchChange}
          />
          <div className="add-user-section">
            <button
              className="add-user-button"
              onClick={() => setShowAddUser(!showAddUser)}
            >
              {showAddUser ? "− Cancel" : "+ Add User"}
            </button>

            {showAddUser && (
              <div className="add-user-form">
                <h3>Add New User</h3>
                <div className="form-grid">
                  <div>
                    <input
                      type="email"
                      placeholder="Email *"
                      value={newUser.email}
                      onChange={(e) =>
                        setNewUser({ ...newUser, email: e.target.value })
                      }
                      className={`input ${
                        fieldErrors.email ? "input-error" : ""
                      }`}
                    />
                    {fieldErrors.email && (
                      <div className="error-message">Email is required</div>
                    )}
                  </div>

                  <div>
                    <input
                      type="text"
                      placeholder="Name *"
                      value={newUser.name}
                      onChange={(e) =>
                        setNewUser({ ...newUser, name: e.target.value })
                      }
                      className={`input ${
                        fieldErrors.name ? "input-error" : ""
                      }`}
                    />
                    {fieldErrors.name && (
                      <div className="error-message">Name is required</div>
                    )}
                  </div>

                  <div>
                    <input
                      type="text"
                      placeholder="Last Name *"
                      value={newUser.lastName}
                      onChange={(e) =>
                        setNewUser({ ...newUser, lastName: e.target.value })
                      }
                      className={`input ${
                        fieldErrors.lastName ? "input-error" : ""
                      }`}
                    />
                    {fieldErrors.lastName && (
                      <div className="error-message">Last name is required</div>
                    )}
                  </div>

                  <div>
                    <input
                      type="tel"
                      placeholder="Phone Number *"
                      value={newUser.phone}
                      onChange={(e) =>
                        setNewUser({ ...newUser, phone: e.target.value })
                      }
                      className={`input ${
                        fieldErrors.phone ? "input-error" : ""
                      }`}
                    />
                    {fieldErrors.phone && (
                      <div className="error-message">
                        Phone number is required
                      </div>
                    )}
                  </div>

                  <Select
                    options={roles}
                    value={roles.find((role) => role.value === newUser.role)}
                    onChange={(option) =>
                      setNewUser({ ...newUser, role: option.value })
                    }
                    className="role-select"
                    placeholder="Select Role"
                  />
                </div>
                <button
                  className="create-user-button"
                  onClick={handleAddUser}
                  disabled={!newUser.email || !newUser.name}
                >
                  Create User
                </button>
              </div>
            )}
          </div>
          <div style={{ marginBottom: "20px" }}>
            <Select
              options={predefinedOptions}
              onChange={handlePredefinedOptionChange}
              placeholder="Select predefined column set"
              defaultValue={predefinedOptions[0]}
              value={predefinedOptions[0]}
            />
          </div>
          <div>
            <Select
              isMulti
              options={columnOptions}
              onChange={handleColumnToggle}
              placeholder="Select columns to display"
            />
          </div>
          {loading ? (
            <p>Loading users...</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="table">
                <thead>
                  <tr>
                    {visibleColumns.email && (
                      <th className="table-header">Email</th>
                    )}
                    {visibleColumns.name && (
                      <th className="table-header">Name</th>
                    )}
                    {visibleColumns.lastName && (
                      <th className="table-header">Last Name</th>
                    )}
                    {visibleColumns.phone && (
                      <th className="table-header">Phone Number</th>
                    )}{" "}
                    {/* Add this line */}
                    {visibleColumns.dob && (
                      <th className="table-header">Date of Birth</th>
                    )}
                    {visibleColumns.memberCity && (
                      <th className="table-header">Member City</th>
                    )}
                    {visibleColumns.memberState && (
                      <th className="table-header">Member State</th>
                    )}
                    {visibleColumns.memberStreet && (
                      <th className="table-header">Member Street</th>
                    )}
                    {visibleColumns.memberZip && (
                      <th className="table-header">Member ZIP</th>
                    )}
                    {visibleColumns.groups && (
                      <th className="table-header">Groups</th>
                    )}
                    {visibleColumns.role && (
                      <th className="table-header">Role</th>
                    )}
                    <th className="table-header">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {currentUsers.map((user) => (
                    <tr className="table-row" key={user.id}>
                      {visibleColumns.email && (
                        <td className="table-cell">
                          <input
                            className="input"
                            type="text"
                            value={user.email || ""}
                            onChange={(e) =>
                              handleInputChange(e, user.id, "email")
                            }
                          />
                        </td>
                      )}
                      {visibleColumns.name && (
                        <td className="table-cell">
                          <input
                            className="input"
                            type="text"
                            value={user.name || ""}
                            onChange={(e) =>
                              handleInputChange(e, user.id, "name")
                            }
                          />
                        </td>
                      )}
                      {visibleColumns.lastName && (
                        <td className="table-cell">
                          <input
                            className="input"
                            type="text"
                            value={user.lastName || ""}
                            onChange={(e) =>
                              handleInputChange(e, user.id, "lastName")
                            }
                          />
                        </td>
                      )}
                      {visibleColumns.phone && (
                        <td className="table-cell">
                          <input
                            className="input"
                            type="tel"
                            value={user.phone || ""}
                            onChange={(e) =>
                              handleInputChange(e, user.id, "phone")
                            }
                            placeholder="(123) 456-7890"
                          />
                        </td>
                      )}
                      {visibleColumns.dob && (
                        <td className="table-cell">
                          <input
                            className="input"
                            type="date"
                            value={
                              user.dob
                                ? new Date(user.dob).toISOString().substr(0, 10)
                                : ""
                            }
                            onChange={(e) => handleDateChange(e, user.id)}
                          />
                        </td>
                      )}
                      {visibleColumns.memberCity && (
                        <td className="table-cell">
                          <input
                            className="input"
                            type="text"
                            value={user.memberCity || ""}
                            onChange={(e) =>
                              handleInputChange(e, user.id, "memberCity")
                            }
                          />
                        </td>
                      )}
                      {visibleColumns.memberState && (
                        <td className="table-cell">
                          <input
                            className="input"
                            type="text"
                            value={user.memberState || ""}
                            onChange={(e) =>
                              handleInputChange(e, user.id, "memberState")
                            }
                          />
                        </td>
                      )}
                      {visibleColumns.memberStreet && (
                        <td className="table-cell">
                          <input
                            className="input"
                            type="text"
                            value={user.memberStreet || ""}
                            onChange={(e) =>
                              handleInputChange(e, user.id, "memberStreet")
                            }
                          />
                        </td>
                      )}
                      {visibleColumns.memberZip && (
                        <td className="table-cell">
                          <input
                            className="input"
                            type="text"
                            value={user.memberZip || ""}
                            onChange={(e) =>
                              handleInputChange(e, user.id, "memberZip")
                            }
                          />
                        </td>
                      )}
                      {visibleColumns.groups && (
                        <td className="table-cell">
                          <Select
                            isMulti
                            value={user.groupMemberships ? 
                              user.groupMemberships.map(membership => ({
                                value: membership.groupId,
                                label: membership.groupName
                              }))
                              : []
                            }
                            options={groups.map(group => ({
                              value: group.id,
                              label: group.groupName
                            }))}
                            onChange={(selectedOptions) => handleGroupChange(selectedOptions, user.uid)}
                            placeholder="Select groups"
                          />
                        </td>
                      )}
                      {visibleColumns.role && (
                        <td className="table-cell">
                          <Select
                            value={roles.find(
                              (role) => role.value === user.role
                            )}
                            options={roles}
                            onChange={(selectedOption) =>
                              handleRoleChange(selectedOption, user.id)
                            }
                            isMulti={false}
                          />
                        </td>
                      )}
                      <td className="table-cell">
                        <button
                          className={`save-button ${
                            isChanged ? "is-changed" : ""
                          }`}
                          onClick={() => handleSave(user.id)}
                          disabled={!isChanged}
                        >
                          Save
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="pagination-container">
            <button
              className="pagination-button"
              onClick={() =>
                setCurrentPage((prevPage) => Math.max(prevPage - 1, 1))
              }
              disabled={currentPage === 1}
            >
              Previous
            </button>
            {Array.from({ length: totalPages }, (_, index) => (
              <button
                key={index + 1}
                className="pagination-button"
                onClick={() => setCurrentPage(index + 1)}
                disabled={currentPage === index + 1}
              >
                {index + 1}
              </button>
            ))}
            <button
              className="pagination-button"
              onClick={() =>
                setCurrentPage((prevPage) => Math.min(prevPage + 1, totalPages))
              }
              disabled={currentPage === totalPages}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Admin;
