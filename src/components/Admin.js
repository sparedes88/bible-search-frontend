import React, { useEffect, useRef, useState } from "react";
import { db } from "../firebase";
import {
  collection,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  getDoc,
  setDoc,
  serverTimestamp,
  query,
  where,
} from "firebase/firestore";
import { useNavigate, useParams } from "react-router-dom";
import Select from "react-select";
import "bootstrap/dist/css/bootstrap.min.css";
import "./Admin.css";
import { useAuth } from "../contexts/AuthContext";
import { createUserWithEmailAndPassword, sendPasswordResetEmail } from "firebase/auth";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { getAuth } from "firebase/auth";
import { initializeApp } from "firebase/app";
import "./Admin.css";
import commonStyles from "../pages/commonStyles";
import { fetchGroupList } from "../api/church";

const isLocalhostEnvironment =
  typeof window !== "undefined"
  && ["localhost", "127.0.0.1"].includes(window.location.hostname);

const CLOUD_FUNCTIONS_BASE_URL = isLocalhostEnvironment
  ? "/firebase-api"
  : (
      process.env.REACT_APP_CLOUD_FUNCTIONS_BASE_URL
      || "https://us-central1-igletechv1.cloudfunctions.net"
    );

function normalizeRoleValue(roleValue, { preserveCustom = true } = {}) {
  const raw = String(roleValue || "").trim();
  if (!raw) return "member";

  const normalized = raw.toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "globaladmin" || normalized === "global_admin") {
    return "global_admin";
  }
  if (normalized === "administrator" || normalized === "admin") {
    return "admin";
  }
  if (normalized === "member" || normalized === "user") {
    return "member";
  }

  if (["member", "admin", "global_admin"].includes(normalized)) {
    return normalized;
  }

  return preserveCustom ? raw : "member";
}

function isFirestorePermissionDenied(error) {
  const errorCode = String(error?.code || "").toLowerCase();
  const errorMessage = String(error?.message || "").toLowerCase();
  return errorCode.includes("permission-denied") || errorMessage.includes("missing or insufficient permissions");
}

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

const BASE_ROLES = [
  { value: "member", label: "Member", baseRole: "member" },
  { value: "admin", label: "Admin", baseRole: "admin" },
  { value: "global_admin", label: "Global Admin", baseRole: "global_admin" },
];

const Admin = () => {
  const { id } = useParams();
  const { user, loading: authLoading } = useAuth(); // *New*Get user from useAuth
  const [users, setUsers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(10);
  const [savingUsers, setSavingUsers] = useState({});
  const hasShownRolePermissionWarningRef = useRef(false);
  const hasShownUsersPermissionWarningRef = useRef(false);
  const autoSaveTimeoutsRef = useRef({});
  const pendingChangesRef = useRef({});
  const [visibleColumns, setVisibleColumns] = useState({
    email: true,
    name: true,
    lastName: true,
    phone: true,
    role: true,
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
    baseRole: "member",
  });
  const [fieldErrors, setFieldErrors] = useState({
    email: false,
    name: false,
    lastName: false,
    phone: false,
  });
  const [adminUser, setAdminUser] = useState(null); // Add this state to store admin info
  const navigate = useNavigate();
  const [roleOptions, setRoleOptions] = useState(BASE_ROLES);
  const isGlobalAdminUser = normalizeRoleValue(adminUser?.role, { preserveCustom: false }) === "global_admin";

  const callManageUserAccountFunction = async (action, targetUserId) => {
    const authInstance = getAuth();
    const idToken = await authInstance.currentUser?.getIdToken();

    if (!idToken) {
      throw new Error("Missing authentication token");
    }

    const response = await fetch(`${CLOUD_FUNCTIONS_BASE_URL}/manageUserAccount`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        action,
        targetUserId,
        churchId: id,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error || `Cloud Function failed (${response.status})`);
    }

    return data;
  };

  const callHydrateUsersFromAuthFunction = async (userIds = []) => {
    const uniqueUserIds = Array.from(new Set(userIds.map((uid) => String(uid || "").trim()).filter(Boolean)));
    if (uniqueUserIds.length === 0) {
      return { updated: [] };
    }

    const authInstance = getAuth();
    const idToken = await authInstance.currentUser?.getIdToken();

    if (!idToken) {
      throw new Error("Missing authentication token");
    }

    const response = await fetch(`${CLOUD_FUNCTIONS_BASE_URL}/hydrateUsersFromAuth`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        churchId: id,
        userIds: uniqueUserIds,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error || `Cloud Function failed (${response.status})`);
    }

    return data;
  };

  const normalizeAccessStatus = (value) => {
    const normalized = String(value || "approved").trim().toLowerCase();
    if (["pending", "requested"].includes(normalized)) return "pending";
    if (["denied", "rejected"].includes(normalized)) return "denied";
    return "approved";
  };

  const columnOptions = [
    { value: "name", label: "Name" },
    { value: "lastName", label: "Last Name" },
    { value: "email", label: "Login Email" },
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
  const defaultPredefinedOption = predefinedOptions.find(
    (option) => option.value === "userAccess"
  );
  const [selectedPredefinedOption, setSelectedPredefinedOption] = useState(
    defaultPredefinedOption
  );

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
    const fetchRoleOptions = async () => {
      if (authLoading || !id || !user?.uid) return;

      try {
        const roleSnapshots = [];

        for (const fieldName of ["churchId", "churchID", "organizationId"]) {
          try {
            const snapshot = await getDocs(query(collection(db, "roles"), where(fieldName, "==", id)));
            roleSnapshots.push(snapshot);
            if (!snapshot.empty) {
              break;
            }
          } catch (error) {
            if (isFirestorePermissionDenied(error)) {
              continue;
            }
            throw error;
          }
        }

        const customRoleMap = new Map();
        roleSnapshots.flatMap((snapshot) => snapshot.docs).forEach((roleDoc) => {
          const roleData = roleDoc.data() || {};
          const roleName = String(
            roleData?.name
            || roleData?.roleName
            || roleData?.title
            || roleData?.displayName
            || ""
          ).trim();

          if (!roleName) return;

          customRoleMap.set(roleDoc.id, {
            value: roleDoc.id,
            label: roleName,
            baseRole: normalizeRoleValue(roleData?.baseRole || roleData?.basedOn || "member", { preserveCustom: false }),
          });
        });

        const customRoleOptions = Array.from(customRoleMap.values()).sort((a, b) =>
          a.label.localeCompare(b.label)
        );

        setRoleOptions([...BASE_ROLES, ...customRoleOptions]);
      } catch (error) {
        if (isFirestorePermissionDenied(error)) {
          if (!hasShownRolePermissionWarningRef.current) {
            hasShownRolePermissionWarningRef.current = true;
            console.warn("Role options are restricted by Firestore permissions for this user.");
          }
        } else {
          console.error("Error fetching role options:", error);
        }
        setRoleOptions(BASE_ROLES);
      }
    };

    fetchRoleOptions();
  }, [authLoading, id, user]);

  useEffect(() => {
    const checkAuth = async () => {
      if (authLoading) {
        return;
      }

      if (!user) {
        // PrivateRoute handles unauthenticated/not-authorized transitions.
        return;
      }

      // Store admin user info
      setAdminUser(user);

      // Fetch users only for the current church
      const fetchUsers = async () => {
        try {
          const userSnapshots = [];

          try {
            userSnapshots.push(
              await getDocs(query(collection(db, "users"), where("churchId", "==", id)))
            );
          } catch (error) {
            if (isFirestorePermissionDenied(error)) {
              throw error;
            }
            throw error;
          }

          if (userSnapshots[0]?.empty) {
            for (const fieldName of ["churchID", "organizationId"]) {
              try {
                const snapshot = await getDocs(query(collection(db, "users"), where(fieldName, "==", id)));
                userSnapshots.push(snapshot);
                if (!snapshot.empty) {
                  break;
                }
              } catch (error) {
                if (isFirestorePermissionDenied(error)) {
                  continue;
                }
                throw error;
              }
            }
          }

          const uniqueUsers = new Map();
          userSnapshots.flatMap((snapshot) => snapshot.docs).forEach((userDoc) => {
            if (uniqueUsers.has(userDoc.id)) return;
            uniqueUsers.set(userDoc.id, {
              uid: userDoc.id,
              ...userDoc.data(),
            });
          });

          const usersData = Array.from(uniqueUsers.values())
            .filter((userRecord) => {
              const userOrgId = String(
                userRecord?.churchId
                || userRecord?.churchID
                || userRecord?.organizationId
                || ""
              );
              return userOrgId === String(id);
            })
            .map((userRecord) => ({
              ...userRecord,
              role: normalizeRoleValue(userRecord.role),
              baseRole: normalizeRoleValue(userRecord.baseRole || userRecord.role, { preserveCustom: false }),
              accessStatus: normalizeAccessStatus(userRecord.accessStatus || userRecord.approvalStatus),
            }));

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

          const usersMissingEmail = usersWithGroups
            .filter((entry) => !String(entry?.email || "").trim())
            .map((entry) => entry.uid);

          if (usersMissingEmail.length > 0) {
            try {
              const hydrateResult = await callHydrateUsersFromAuthFunction(usersMissingEmail);
              const hydratedEmailMap = new Map(
                (hydrateResult?.updated || []).map((entry) => [
                  String(entry?.userId || "").trim(),
                  String(entry?.email || "").trim(),
                ])
              );

              const hydratedUsers = usersWithGroups.map((entry) => {
                const hydratedEmail = hydratedEmailMap.get(String(entry.uid || "").trim());
                if (!hydratedEmail) return entry;
                return {
                  ...entry,
                  email: hydratedEmail,
                };
              });

              setUsers(hydratedUsers);
            } catch (hydrateError) {
              console.error("Error hydrating missing user emails:", hydrateError);
              setUsers(usersWithGroups);
            }
          } else {
            setUsers(usersWithGroups);
          }
        } catch (error) {
          if (isFirestorePermissionDenied(error)) {
            if (!hasShownUsersPermissionWarningRef.current) {
              hasShownUsersPermissionWarningRef.current = true;
              console.warn("User list is restricted by Firestore permissions for this user.");
            }
            setUsers([]);
          } else {
            console.error("Error fetching users:", error);
          }
        } finally {
          setLoading(false);
        }
      };

      fetchUsers();
    };

    checkAuth();
  }, [authLoading, user, navigate, id]);

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

  useEffect(() => {
    const timeoutMap = autoSaveTimeoutsRef.current;
    return () => {
      Object.values(timeoutMap).forEach((timeoutId) => {
        clearTimeout(timeoutId);
      });
    };
  }, []);

  const flushAutoSave = async (userId) => {
    const pending = pendingChangesRef.current[userId];
    if (!pending || Object.keys(pending).length === 0) return;

    delete pendingChangesRef.current[userId];
    setSavingUsers((prev) => ({ ...prev, [userId]: true }));

    try {
      await updateDoc(doc(db, "users", userId), pending);
    } catch (error) {
      console.error("Error auto-saving user:", error);
      toast.error("Error auto-saving user changes");
    } finally {
      setSavingUsers((prev) => ({ ...prev, [userId]: false }));
    }
  };

  const queueAutoSave = (userId, changedFields) => {
    pendingChangesRef.current[userId] = {
      ...(pendingChangesRef.current[userId] || {}),
      ...changedFields,
    };

    if (autoSaveTimeoutsRef.current[userId]) {
      clearTimeout(autoSaveTimeoutsRef.current[userId]);
    }

    autoSaveTimeoutsRef.current[userId] = setTimeout(() => {
      flushAutoSave(userId);
      delete autoSaveTimeoutsRef.current[userId];
    }, 600);
  };

  const handleInputChange = (e, userId, field) => {
    const { value } = e.target;
    setUsers((prevUsers) =>
      prevUsers.map((user) =>
        user.uid === userId ? { ...user, [field]: value, updated: true } : user
      )
    );
    queueAutoSave(userId, { [field]: value });
  };

  const handleDateChange = (e, userId) => {
    const { value } = e.target;
    setUsers((prevUsers) =>
      prevUsers.map((user) =>
        user.uid === userId ? { ...user, dob: value, updated: true } : user
      )
    );
    queueAutoSave(userId, { dob: value });
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
    } catch (error) {
      console.error("Error updating group members:", error);
      toast.error("Error updating group membership");
    }
  };

  const handleRoleChange = (selectedOption, userId) => {
    const selectedRole = selectedOption ? selectedOption.value : "";
    const selectedBaseRole = selectedOption
      ? normalizeRoleValue(selectedOption.baseRole || selectedRole, { preserveCustom: false })
      : "member";
    setUsers((prevUsers) =>
      prevUsers.map((user) =>
        user.uid === userId
          ? { ...user, role: selectedRole, baseRole: selectedBaseRole, updated: true }
          : user
      )
    );
    queueAutoSave(userId, { role: selectedRole, baseRole: selectedBaseRole });
  };

  const handleResetPassword = async (email) => {
    const loginEmail = (email || "").trim();
    if (!loginEmail) {
      toast.error("This user does not have a login email");
      return;
    }

    try {
      await sendPasswordResetEmail(getAuth(), loginEmail);
      toast.success(`Password reset email sent to ${loginEmail}`);
    } catch (error) {
      console.error("Error sending password reset email:", error);
      toast.error(`Could not send reset email: ${error.message}`);
    }
  };

  const handleBackClick = (id) => {
    navigate(`/organization/${id}/mi-organizacion`);
  };

  const handleApproveUserAccess = async (targetUser) => {
    if (!targetUser?.uid) return;

    try {
      await updateDoc(doc(db, "users", targetUser.uid), {
        accessStatus: "approved",
        approvalStatus: "approved",
        approvedAt: serverTimestamp(),
        approvedBy: user?.uid || null,
        approvedByEmail: user?.email || null,
      });

      setUsers((prevUsers) =>
        prevUsers.map((existingUser) =>
          existingUser.uid === targetUser.uid
            ? { ...existingUser, accessStatus: "approved", approvalStatus: "approved" }
            : existingUser
        )
      );

      toast.success(`Approved access for ${targetUser.email || targetUser.name || "user"}`);
    } catch (approveError) {
      console.error("Error approving user access:", approveError);
      toast.error("Could not approve this user right now");
    }
  };

  const clearPendingAutoSaveForUser = (userId) => {
    if (autoSaveTimeoutsRef.current[userId]) {
      clearTimeout(autoSaveTimeoutsRef.current[userId]);
      delete autoSaveTimeoutsRef.current[userId];
    }
    delete pendingChangesRef.current[userId];
    setSavingUsers((prev) => ({ ...prev, [userId]: false }));
  };

  const removeUserFromAllGroups = async (targetUserId) => {
    const groupsWithUser = groups.filter(
      (group) => (group.members || []).some((member) => member.userId === targetUserId)
    );

    await Promise.all(
      groupsWithUser.map(async (group) => {
        const groupRef = doc(db, "groups", group.id);
        await updateDoc(groupRef, {
          members: (group.members || []).filter((member) => member.userId !== targetUserId),
        });
      })
    );

    setGroups((prevGroups) =>
      prevGroups.map((group) => ({
        ...group,
        members: (group.members || []).filter((member) => member.userId !== targetUserId),
      }))
    );
  };

  const handleToggleUserAccess = async (targetUser) => {
    if (!targetUser?.uid) return;

    if (targetUser.uid === adminUser?.uid) {
      toast.error("You cannot disable your own account");
      return;
    }

    const currentStatus = normalizeAccessStatus(
      targetUser.accessStatus || targetUser.approvalStatus
    );
    const isDisabled = currentStatus === "denied";
    const nextStatus = isDisabled ? "approved" : "denied";

    const confirmed = window.confirm(
      isDisabled
        ? "Enable this user account and allow login access?"
        : "Disable this user account? They will not be able to log in."
    );
    if (!confirmed) return;

    try {
      await callManageUserAccountFunction(isDisabled ? "enable" : "disable", targetUser.uid);

      await updateDoc(doc(db, "users", targetUser.uid), {
        accessStatus: nextStatus,
        approvalStatus: nextStatus,
        disabledAt: isDisabled ? null : serverTimestamp(),
        disabledBy: isDisabled ? null : user?.uid || null,
      });

      setUsers((prevUsers) =>
        prevUsers.map((existingUser) =>
          existingUser.uid === targetUser.uid
            ? {
                ...existingUser,
                accessStatus: nextStatus,
                approvalStatus: nextStatus,
              }
            : existingUser
        )
      );

      toast.success(
        isDisabled
          ? `Enabled ${targetUser.email || targetUser.name || "user"}`
          : `Disabled ${targetUser.email || targetUser.name || "user"}`
      );
    } catch (toggleError) {
      console.error("Error toggling user access:", toggleError);
      toast.error("Could not update user access right now");
    }
  };

  const handleDeleteUser = async (targetUser) => {
    if (!targetUser?.uid) return;

    if (!isGlobalAdminUser) {
      toast.error("Only global admins can delete users");
      return;
    }

    if (targetUser.uid === adminUser?.uid) {
      toast.error("You cannot delete your own account");
      return;
    }

    const targetLabel = targetUser.email || `${targetUser.name || ""} ${targetUser.lastName || ""}`.trim() || "this user";
    const confirmed = window.confirm(
      `Delete ${targetLabel}? This will remove the user record from this organization.`
    );
    if (!confirmed) return;

    try {
      clearPendingAutoSaveForUser(targetUser.uid);
      await removeUserFromAllGroups(targetUser.uid);
      await callManageUserAccountFunction("delete", targetUser.uid);
      await deleteDoc(doc(db, "users", targetUser.uid));

      setUsers((prevUsers) => prevUsers.filter((existingUser) => existingUser.uid !== targetUser.uid));
      toast.success(`Deleted ${targetLabel}`);
    } catch (deleteError) {
      console.error("Error deleting user:", deleteError);
      toast.error("Could not delete user right now");
    }
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
    if (!selectedOption) return;
    setSelectedPredefinedOption(selectedOption);

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
        email: true,
        name: true,
        lastName: true,
        phone: true,
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

  const normalizeSearchValue = (value) => String(value || "").trim().toLowerCase();

  const filteredUsers = users.filter((user) => {
    const searchValue = normalizeSearchValue(searchTerm);
    if (!searchValue) return true;

    return (
      normalizeSearchValue(user.uid).includes(searchValue) ||
      normalizeSearchValue(user.email).includes(searchValue) ||
      normalizeSearchValue(user.name).includes(searchValue) ||
      normalizeSearchValue(user.lastName).includes(searchValue) ||
      normalizeSearchValue(user.accessStatus).includes(searchValue) ||
      normalizeSearchValue(user.phone).includes(searchValue) ||
      normalizeSearchValue(user.dob).includes(searchValue) ||
      normalizeSearchValue(user.memberCity).includes(searchValue) ||
      normalizeSearchValue(user.memberState).includes(searchValue) ||
      normalizeSearchValue(user.memberStreet).includes(searchValue) ||
      normalizeSearchValue(user.memberZip).includes(searchValue)
    );
  });

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
        baseRole: normalizeRoleValue(newUser.baseRole || newUser.role || "member", { preserveCustom: false }),
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
        baseRole: "member",
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
      if (error?.code === "auth/email-already-in-use") {
        toast.error(
          "This email already exists in Firebase Auth. If it is not visible yet, refresh the users table and search by email."
        );
        return;
      }
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
                    options={roleOptions}
                    value={roleOptions.find((role) => role.value === normalizeRoleValue(newUser.role))}
                    onChange={(option) =>
                      setNewUser({
                        ...newUser,
                        role: option.value,
                        baseRole: normalizeRoleValue(option.baseRole || option.value, { preserveCustom: false }),
                      })
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
              defaultValue={defaultPredefinedOption}
              value={selectedPredefinedOption}
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
                    {visibleColumns.name && (
                      <th className="table-header">Name</th>
                    )}
                    {visibleColumns.lastName && (
                      <th className="table-header">Last Name</th>
                    )}
                    {visibleColumns.email && (
                      <th className="table-header">Login Email</th>
                    )}
                    {visibleColumns.phone && (
                      <th className="table-header">Phone Number</th>
                    )}
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
                  {currentUsers.map((user) => {
                    const needsProfileUpdate =
                      !normalizeSearchValue(user.email)
                      || !normalizeSearchValue(user.name)
                      || !normalizeSearchValue(user.lastName)
                      || !normalizeSearchValue(user.phone);

                    return (
                    <tr className={`table-row${needsProfileUpdate ? " table-row-needs-update" : ""}`} key={user.uid}>
                      {visibleColumns.name && (
                        <td className="table-cell">
                          <input
                            className="input"
                            type="text"
                            value={user.name || ""}
                            onChange={(e) =>
                              handleInputChange(e, user.uid, "name")
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
                              handleInputChange(e, user.uid, "lastName")
                            }
                          />
                        </td>
                      )}
                      {visibleColumns.email && (
                        <td className="table-cell">
                          <input
                            className="input"
                            type="text"
                            value={user.email || ""}
                            onChange={(e) =>
                              handleInputChange(e, user.uid, "email")
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
                              handleInputChange(e, user.uid, "phone")
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
                            onChange={(e) => handleDateChange(e, user.uid)}
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
                              handleInputChange(e, user.uid, "memberCity")
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
                              handleInputChange(e, user.uid, "memberState")
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
                              handleInputChange(e, user.uid, "memberStreet")
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
                              handleInputChange(e, user.uid, "memberZip")
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
                            value={
                              roleOptions.find(
                                (role) => role.value === normalizeRoleValue(user.role)
                              )
                              || {
                                value: normalizeRoleValue(user.role),
                                label: normalizeRoleValue(user.role),
                              }
                            }
                            options={roleOptions}
                            onChange={(selectedOption) =>
                              handleRoleChange(selectedOption, user.uid)
                            }
                            isMulti={false}
                          />
                        </td>
                      )}
                      <td className="table-cell">
                        {needsProfileUpdate && (
                          <span className="profile-needs-update-badge">Needs Update</span>
                        )}
                        {normalizeAccessStatus(user.accessStatus || user.approvalStatus) === "denied" ? (
                          <button
                            className="save-button"
                            onClick={() => handleToggleUserAccess(user)}
                            style={{ marginRight: "8px", backgroundColor: "#16a34a" }}
                          >
                            Enable User
                          </button>
                        ) : (
                          <button
                            className="save-button"
                            onClick={() => handleToggleUserAccess(user)}
                            style={{ marginRight: "8px", backgroundColor: "#dc2626" }}
                          >
                            Disable User
                          </button>
                        )}

                        {normalizeAccessStatus(user.accessStatus || user.approvalStatus) === "pending" && (
                          <button
                            className="save-button"
                            onClick={() => handleApproveUserAccess(user)}
                            style={{ marginRight: "8px", backgroundColor: "#16a34a" }}
                          >
                            Approve Access
                          </button>
                        )}

                        <button
                          className="save-button"
                          onClick={() => handleResetPassword(user.email)}
                          style={{ marginRight: "8px", backgroundColor: "#f59e0b" }}
                        >
                          Reset Password
                        </button>
                        <button
                          className="save-button"
                          onClick={() => handleDeleteUser(user)}
                          disabled={!isGlobalAdminUser}
                          style={{ marginRight: "8px", backgroundColor: "#7f1d1d" }}
                          title={isGlobalAdminUser ? "Delete user" : "Only global admins can delete users"}
                        >
                          Delete User
                        </button>
                        <span
                          style={{
                            display: "inline-block",
                            marginRight: "8px",
                            fontSize: "0.8rem",
                            fontWeight: 700,
                            textTransform: "uppercase",
                            color:
                              normalizeAccessStatus(user.accessStatus || user.approvalStatus) === "approved"
                                ? "#166534"
                                : normalizeAccessStatus(user.accessStatus || user.approvalStatus) === "pending"
                                ? "#92400e"
                                : "#991b1b",
                          }}
                        >
                          {normalizeAccessStatus(user.accessStatus || user.approvalStatus)}
                        </span>
                        {savingUsers[user.uid] && <span>Auto-saving...</span>}
                      </td>
                    </tr>
                    );
                  })}
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
