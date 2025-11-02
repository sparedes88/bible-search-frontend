import React, { useState, useEffect } from "react";
import { auth, db } from "../firebase";
import { 
  doc, getDoc, updateDoc,
  collection, getDocs, where, query
} from "firebase/firestore";
import { getUserAccessibleForms } from "../utils/enhancedPermissions";
import { signOut, updateEmail } from "firebase/auth";
import { useNavigate, useParams, Link, useLocation } from "react-router-dom";
import Skeleton from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import AsyncCreatableSelect from "react-select/async-creatable";
import Select from "react-select";
import { getPublicChurchGroups } from "../api";
import { toast } from "react-toastify";
import "./MiPerfil.css"; // Add this import
import ChurchHeader from "./ChurchHeader";
import { QRCodeSVG } from "qrcode.react";
import commonStyles from "../pages/commonStyles";
import { useAuth } from "../contexts/AuthContext";
import { fetchGroupList, getChurchData } from "../api/church";
import { FaRobot } from "react-icons/fa";
import { Spinner } from "react-bootstrap";
import ReactDOM from "react-dom";
import { PDFDownloadLink } from "@react-pdf/renderer";
import QRCodeLabel from "./QRCodeLabel";
import QRCode from "react-qr-code";

const MiPerfil = () => {
  const { id, idiglesia } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [church, setChurch] = useState(null);
  const [debugLog, setDebugLog] = useState([]);
  const [showDebugLog, setShowDebugLog] = useState(false);
  const [groups, setGroups] = useState([]);
  const [selectedGroups, setSelectedGroups] = useState([]);
  const [isUpdated, setIsUpdated] = useState(false);
  const [userName, setUserName] = useState("");
  const [userLastName, setUserLastName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [userPhone, setUserPhone] = useState("");
  const [userRole, setUserRole] = useState("");
  const [roles, setRoles] = useState([
    { value: "member", label: "Member" },
    { value: "leader", label: "Leader" },
    { value: "admin", label: "Admin" },
    { value: "global_admin", label: "Global Admin" },
  ]);
  const [isOnline, setIsOnline] = useState(true);
  const [retryCount, setRetryCount] = useState(0);
  const [lastSync, setLastSync] = useState(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [forceOffline, setForceOffline] = useState(false);
  const [addingGroup, setAddingGroup] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 480);
  // Cool Techy Badge state
  const [badgeLoading, setBadgeLoading] = useState(true);
  const [eligibleForms, setEligibleForms] = useState([]); // [{id, title, description}]
  const [formProgress, setFormProgress] = useState([]); // [{formId, title, lastSubmittedAt, daysAgo, withinWindow}]
  const [badgeSummary, setBadgeSummary] = useState({ total: 0, completed: 0, active: false, expiresInDays: null, expiresAt: null });
  // I'm So Cool Badge state - tracks profile completion
  const [profileBadge, setProfileBadge] = useState({ complete: false, missing: [], total: 0, completed: 0 });

  const fetchChurchData = async () => {
    try {
      const data = await getChurchData(id);
      if (data) {
        setChurch(data);
      }
    } catch (error) {
      console.error("Error fetching organization:", error);
      setError("❌ Error loading organization data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const checkAuth = async () => {
      if (!user) {
        const returnUrl = `${location.pathname}${location.search}${location.hash}`;
        navigate(`/church/${id}/login?returnUrl=${encodeURIComponent(returnUrl)}`);
        return;
      }
    };

    checkAuth();
  }, [user, id, navigate, location]);

  useEffect(() => {
    fetchChurchData();
  }, [id]);

  useEffect(() => {
    const handleOnline = () => {
      if (!forceOffline) {
        setIsOnline(true);
        setError(null);
        setDebugLog((prev) => [...prev, "✅ Connection restored"]);
      }
    };

    const handleOffline = () => {
      setIsOnline(false);
      setError("❌ No Internet connection - Please check your connection");
      setDebugLog((prev) => [...prev, "❌ Connection lost"]);
    };

    // Set initial state
    setIsOnline(navigator.onLine && !forceOffline);

    // Add event listeners
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Cleanup
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [forceOffline]);

  useEffect(() => {
    const fetchUserData = async () => {
      if (!auth.currentUser) {
        setError("❌ User not authenticated.");
        setLoading(false);
        return;
      }

      try {
        const userDoc = await getDoc(doc(db, "users", auth.currentUser.uid));
        if (userDoc.exists()) {
          const data = userDoc.data();
          console.log("User data from Firestore:", data); // Debug log
          
          // Use exact field names from registration
          setUserName(data.name || "");
          setUserLastName(data.lastName || "");
          setUserEmail(data.email || "");
          setUserPhone(data.phone || data.phoneNumber || "");
          setUserRole(data.role || "");
        } else {
          setError("❌ User data not found.");
        }
      } catch (error) {
        console.error("Error fetching user data:", error);
        const errorMessage = !isOnline
          ? "❌ No Internet connection. Please check your connection."
          : "❌ Error loading user data.";
        setError(errorMessage);
      }
      setLoading(false);
    };

    fetchUserData();
  }, []);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 480);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Load badge-eligible forms and user's latest submissions for each (last 90 days)
  useEffect(() => {
    const loadBadgeProgress = async () => {
      try {
        if (!id || !user?.email) {
          setBadgeLoading(false);
          return;
        }
        setBadgeLoading(true);
        // Try permission-aware list first; if empty, fall back to all forms (public read rules may allow)
        let accessible = await getUserAccessibleForms(user, id);
        if (!accessible || accessible.length === 0) {
          const formsRef = collection(db, 'churches', id, 'forms');
          const formsSnap = await getDocs(formsRef);
          accessible = formsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        }
        const badgeForms = (accessible || []).filter(f => f.badgeEligible && f.isActive !== false);
        setEligibleForms(badgeForms.map(f => ({ id: f.id, title: f.title || 'Untitled', description: f.description || '' })));

        const now = new Date();
        const windowMs = 90 * 24 * 60 * 60 * 1000; // rolling 90 days
        const since = new Date(now.getTime() - windowMs);

        const results = [];
        for (const f of badgeForms) {
          try {
            const entriesRef = collection(db, 'churches', id, 'forms', f.id, 'entries');
            // Filter by submittedBy equals current user's email; we'll compute latest client-side
            const q1 = query(entriesRef, where('submittedBy', '==', user.email));
            const subSnap = await getDocs(q1);
            let latest = null;
            subSnap.forEach(docSnap => {
              const data = docSnap.data();
              const ts = data.submittedAt?.toDate ? data.submittedAt.toDate() : (data.submittedAt || null);
              if (ts && (!latest || ts > latest)) latest = ts;
            });
            const within = latest ? latest >= since : false;
            const daysAgo = latest ? Math.ceil((now - latest) / (24*60*60*1000)) : null;
            results.push({ formId: f.id, title: f.title || 'Untitled', lastSubmittedAt: latest, daysAgo, withinWindow: within });
          } catch (e) {
            console.warn('Badge progress fetch error for form', f.id, e);
            results.push({ formId: f.id, title: f.title || 'Untitled', lastSubmittedAt: null, daysAgo: null, withinWindow: false });
          }
        }

        // Compute summary and expiry
        const total = badgeForms.length;
        const completed = results.filter(r => r.withinWindow).length;
        let active = total > 0 && completed === total;
        let expiresAt = null;
        if (active) {
          // Badge expires at the earliest of (lastSubmittedAt + 90 days) across all forms
          const expiries = results
            .filter(r => r.lastSubmittedAt)
            .map(r => new Date(r.lastSubmittedAt.getTime() + windowMs));
          if (expiries.length > 0) {
            expiresAt = expiries.reduce((min, d) => d < min ? d : min, expiries[0]);
          }
        }
        const expiresInDays = expiresAt ? Math.max(0, Math.ceil((expiresAt - now) / (24*60*60*1000))) : null;

        setFormProgress(results);
        setBadgeSummary({ total, completed, active, expiresInDays, expiresAt });
      } catch (e) {
        console.error('Failed to load badge progress', e);
      } finally {
        setBadgeLoading(false);
      }
    };
    loadBadgeProgress();
  }, [id, user?.email]);

  // Track "I'm So Cool" badge - profile completeness
  useEffect(() => {
    const checkProfileCompletion = async () => {
      try {
        if (!user?.uid) return;
        
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (!userDoc.exists()) return;
        
        const data = userDoc.data();
        const requiredFields = [
          { key: 'name', label: 'First Name', value: data.name },
          { key: 'lastName', label: 'Last Name', value: data.lastName },
          { key: 'email', label: 'Email', value: data.email },
          { key: 'phone', label: 'Phone', value: data.phone },
          { key: 'dateOfBirth', label: 'Date of Birth', value: data.dateOfBirth },
          { key: 'gender', label: 'Gender', value: data.gender },
          { key: 'maritalStatus', label: 'Marital Status', value: data.maritalStatus },
          { key: 'address.street', label: 'Street Address', value: data.address?.street },
          { key: 'address.city', label: 'City', value: data.address?.city },
          { key: 'address.state', label: 'State', value: data.address?.state },
          { key: 'address.zipCode', label: 'Zip Code', value: data.address?.zipCode },
          { key: 'address.country', label: 'Country', value: data.address?.country },
          { key: 'profileImg', label: 'Profile Image', value: data.profileImg }
        ];
        
        const missing = requiredFields.filter(f => !f.value || (typeof f.value === 'string' && f.value.trim() === ''));
        const completed = requiredFields.length - missing.length;
        const complete = missing.length === 0;
        
        setProfileBadge({ 
          complete, 
          missing: missing.map(m => m.label), 
          total: requiredFields.length, 
          completed 
        });
      } catch (e) {
        console.error('Error checking profile completion', e);
      }
    };
    checkProfileCompletion();
  }, [user?.uid, userName, userLastName, userEmail, userPhone]);

  const fetchGroups = async () => {
    try {
      const groupsData = await fetchGroupList(id);

      // Filter groups where current user is a member
      const userGroups = groupsData.filter(
        (group) =>
          group.members &&
          group.members.some((member) => member.userId === user?.uid)
      );

      // Set all groups for the dropdown options
      setGroups(groupsData);

      // Set selected groups based on user membership
      const selectedOptions = userGroups.map((group) => ({
        value: group.id,
        label: group.groupName,
      }));
      setSelectedGroups(selectedOptions);
    } catch (error) {
      console.error("Error fetching groups:", error);
    }
  };

  useEffect(() => {
    fetchGroups();
  }, [id]);

  const handleLogout = async () => {
    await signOut(auth);
    navigate(`/church/${id}/login`);
  };

  // Format phone number to US format (XXX) XXX-XXXX
  const formatPhoneNumber = (value) => {
    // Remove all non-numeric characters
    const phoneNumber = value.replace(/\D/g, '');
    
    // Limit to 10 digits
    const limitedPhone = phoneNumber.slice(0, 10);
    
    // Format as (XXX) XXX-XXXX
    if (limitedPhone.length <= 3) {
      return limitedPhone;
    } else if (limitedPhone.length <= 6) {
      return `(${limitedPhone.slice(0, 3)}) ${limitedPhone.slice(3)}`;
    } else {
      return `(${limitedPhone.slice(0, 3)}) ${limitedPhone.slice(3, 6)}-${limitedPhone.slice(6)}`;
    }
  };

  const handlePhoneChange = (e) => {
    const formatted = formatPhoneNumber(e.target.value);
    setUserPhone(formatted);
    setIsUpdated(true);
  };

  const handleSave = async () => {
    try {
      // Update Firestore user document with basic profile info
      await updateDoc(doc(db, "users", auth.currentUser.uid), {
        name: userName,
        lastName: userLastName,
        email: userEmail,
        phone: userPhone,
        role: userRole,
      });

      // Update Firebase Auth email if changed
      if (auth.currentUser.email !== userEmail) {
        await updateEmail(auth.currentUser, userEmail);
      }

      // Update user's displayName and role in all groups they're a member of
      const allGroups = await fetchGroupList(id);
      const userGroups = allGroups.filter(
        (group) =>
          group.members &&
          group.members.some((member) => member.userId === user?.uid)
      );

      for (const group of userGroups) {
        const groupRef = doc(db, "groups", group.id);
            const updatedMembers = group.members.map((member) =>
              member.userId === user?.uid
                ? {
                    ...member,
                    displayName: `${userName} ${userLastName}`,
                    role: userRole,
                  }
                : member
            );        await updateDoc(groupRef, { members: updatedMembers });
      }

      setIsUpdated(false); // Hide the update button after saving
      toast.success("✅Data updated successfully");
    } catch (error) {
      console.error("Error updating user data:", error);
      setError("❌ Error updating user data.");
      toast.error("Error updating data");
    }
  };

  const handleGroupChange = async (selectedOptions) => {
    try {
      setAddingGroup(true);
      // Remove duplicates
      const uniqueOptions = selectedOptions.filter(
        (option, index, self) =>
          index === self.findIndex((t) => t.value === option.value)
      );

      // Find groups that were removed and added
      const removedGroups = selectedGroups.filter(
        (group) => !uniqueOptions.some((option) => option.value === group.value)
      );
      const addedGroups = uniqueOptions.filter(
        (option) =>
          !selectedGroups.some((group) => group.value === option.value)
      );

      // Handle removed groups
      for (const removedGroup of removedGroups) {
        const groupRef = doc(db, "groups", removedGroup.value);
        const groupDoc = await getDoc(groupRef);

        if (groupDoc.exists()) {
          const groupData = groupDoc.data();
          const updatedMembers = groupData.members.filter(
            (member) => member.userId !== user?.uid
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

          if (!members.some((member) => member.userId === user?.uid)) {
            const newMember = {
              userId: user?.uid,
              displayName: `${userName} ${userLastName}`,
              role: userRole,
            };

            await updateDoc(groupRef, {
              members: [...members, newMember],
            });
          }
        }
      }

      // Update user's groups in Firestore
      // await updateDoc(doc(db, "users", user?.uid), {
      //   groups: uniqueOptions.map(option => option.value)
      // });

      // Set the selected groups with proper value/label structure
      const formattedOptions = uniqueOptions.map((option) => ({
        value: option.value,
        label: option.label,
      }));

      setSelectedGroups(formattedOptions);

      if (removedGroups.length > 0) {
        toast.success("Removed your selected group");
      }
      if (addedGroups.length > 0) {
        toast.success("Added your selected group");
      }
    } catch (error) {
      console.error("Error updating group members:", error);
      toast.error("Error updating group membership");
    } finally {
      setAddingGroup(false);
    }
  };

  const handleRoleChange = (selectedOption) => {
    setUserRole(selectedOption.value);
    setIsUpdated(true); // Show the update button when there is a change
  };

  const buttonStyle = {
    padding: "5px 10px",
    fontSize: "12px",
    height: "30px",
    lineHeight: "20px",
  };

  const mainButtonStyle = {
    backgroundColor: "#4F46E5",
    color: "white",
    padding: "12px",
    width: "100%",
    border: "none",
    borderRadius: "8px",
    fontSize: "14px",
    fontWeight: "500",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    textDecoration: "none",
    marginBottom: "10px",
    transition: "background-color 0.2s ease",
    ":hover": {
      backgroundColor: "#4338CA",
    },
  };

  const handleAdminPanelClick = () => {
    navigate(`/admin/${id}`);
  };

  const handleAvailableGroupsClick = () => {
    navigate(`/church/${id}/chatv2`);
  };

  const handleSobreMiClick = () => {
    navigate(`/church/${id}/sobre`);
  };

  const handleMiFamiliaClick = () => {
    navigate(`/church/${id}/family`);
  };

  const handleProcessClick = async () => {
    try {
      const configRef = doc(db, "churches", id, "config", "process");
      const configDoc = await getDoc(configRef);

      if (configDoc.exists()) {
        const categoryIds = configDoc.data().categoryIds || [];
        if (categoryIds.length > 0) {
          navigate(
            `/church/${id}/course-categories?categories=${categoryIds.join(
              ","
            )}`
          );
          return;
        }
      }

      navigate(`/church/${id}/course-categories`);
    } catch (error) {
      console.error("Error fetching process configuration:", error);
      navigate(`/church/${id}/course-categories`);
    }
  };

  const handleRetryConnection = async () => {
    setIsSyncing(true);
    setDebugLog((prev) => [...prev, "Manual connection retry requested"]);

    try {
      setRetryCount((prev) => prev + 1);

      // Try to reconnect to Firestore
      const connectedRef = doc(db, ".info/connected");
      const snapshot = await getDoc(connectedRef);
      const isConnected = snapshot.exists() && snapshot.data()?.connected;

      if (isConnected) {
        // Refresh data
        await Promise.all([fetchUserData(), fetchChurchData(), fetchGroups()]);

        setLastSync(new Date().toISOString());
        setError(null);
        toast.success("🔄 Data updated successfully");
      } else {
        throw new Error("Still offline");
      }
    } catch (error) {
      setError(`⚠️ No connection - Attempt ${retryCount}/3 failed`);
      toast.warning("Could not establish connection");
    } finally {
      setIsSyncing(false);
    }
  };

  // Update the generateQRData function
  const generateQRData = () => {
    if (!auth.currentUser) return "";
    return `${auth.currentUser.uid}`; // Now only returns the userId
  };

  const offlineBanner = !isOnline && (
    <div className="offline-banner">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "8px",
        }}
      >
        <span role="img" aria-label="warning">
          ⚠️
        </span>
        <span>No Internet connection</span>
      </div>
      <button onClick={() => window.location.reload()} className="retry-button">
        <span>🔄</span>
        <span>Reintentar conexión</span>
      </button>
    </div>
  );

  if (!userRole || loading) {
    return (
      <div style={commonStyles.container}>
        {loading ? (
          <div className="loading-container">
            <Skeleton count={5} />
            <p>Cargando perfil...</p>
          </div>
        ) : (
          <div
            className="error-container"
            style={{ textAlign: "center", padding: "2rem" }}
          >
            <h2 style={{ color: "#DC2626" }}>⚠️ Acceso Restringido</h2>
            <p>No tienes permiso para ver esta página.</p>
            <button
              onClick={() => navigate(`/church/${id}/login`)}
              style={{
                marginTop: "1rem",
                padding: "0.5rem 1rem",
                backgroundColor: "#3B82F6",
                color: "white",
                border: "none",
                borderRadius: "0.25rem",
                cursor: "pointer",
              }}
            >
              Iniciar Sesión
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={commonStyles.fullWidthContainer}>
      {offlineBanner}
      {!isOnline && (
        <button
          onClick={handleRetryConnection}
          disabled={isSyncing || retryCount >= 3}
          className="retry-button"
        >
          {isSyncing ? (
            <>
              <span>Syncing...</span>
              <div className="loader" />
            </>
          ) : (
            <>
              <span>🔄</span>
              <span>
                Retry Connection {retryCount > 0 ? `(${retryCount}/3)` : ""}
              </span>
            </>
          )}
        </button>
      )}
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <div></div> {/* Empty div to maintain flex layout */}
        <button onClick={handleLogout} style={commonStyles.logoutButton}>
          Logout
        </button>
      </div>
      <ChurchHeader id={id} applyShadow={false} />

      <h2 style={{ marginTop: "-30px" }}>My Profile</h2>

      {/* I'm So Cool Badge Section - Profile Completion */}
      <div style={{
        marginTop: '1rem',
        marginBottom: '1.5rem',
        padding: '1rem',
        background: 'white',
        border: '1px solid #E5E7EB',
        borderRadius: 12,
        boxShadow: '0 6px 12px rgba(15,23,42,0.05)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: '1.1rem', color: '#111827' }}>I'm So Cool Badge</div>
            <div style={{ color: '#6B7280', fontSize: '0.9rem' }}>Complete all your profile information</div>
          </div>
          <div>
            {profileBadge.complete ? (
              <span style={{
                display: 'inline-block',
                background: 'linear-gradient(135deg,#8B5CF6,#EC4899)',
                color: 'white',
                padding: '0.5rem 0.75rem',
                borderRadius: 999,
                fontWeight: 800
              }}>😎 Badge Earned!</span>
            ) : (
              <span style={{
                display: 'inline-block',
                background: '#FEF3C7',
                color: '#92400E',
                padding: '0.5rem 0.75rem',
                borderRadius: 999,
                fontWeight: 700
              }}>In Progress</span>
            )}
          </div>
        </div>
        <div style={{ marginBottom: 8, color: '#374151' }}>
          Completed {profileBadge.completed} of {profileBadge.total} required fields
        </div>
        {/* Progress bar */}
        <div style={{ background: '#F3F4F6', borderRadius: 8, height: 10, marginBottom: 12 }}>
          <div style={{
            width: `${Math.min(100, Math.round((profileBadge.completed / Math.max(1, profileBadge.total)) * 100))}%`,
            background: 'linear-gradient(90deg,#8B5CF6,#EC4899)',
            height: '100%',
            borderRadius: 8
          }} />
        </div>
        {/* Missing fields with inline editing */}
        {profileBadge.missing.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontWeight: 700, color: '#DC2626', marginBottom: 12, fontSize: '1rem' }}>✗ Complete Your Profile</div>
            <div style={{ display: 'grid', gap: 16 }}>
              {profileBadge.missing.map((field, idx) => {
                const fieldKey = field.toLowerCase().replace(/ /g, '');
                return (
                  <div key={idx} style={{
                    padding: '1rem',
                    background: '#FEF2F2',
                    border: '2px solid #FCA5A5',
                    borderRadius: 8
                  }}>
                    <label style={{ display: 'block', fontWeight: 600, color: '#991B1B', marginBottom: 8 }}>
                      {field}
                    </label>
                    {field === 'Profile Image' ? (
                      <a
                        href={`/organization/${id}/sobre`}
                        style={{
                          display: 'inline-block',
                          background: '#8B5CF6',
                          color: 'white',
                          padding: '0.5rem 0.85rem',
                          borderRadius: 6,
                          textDecoration: 'none',
                          fontWeight: 600,
                          fontSize: '0.9rem'
                        }}
                      >
                        Upload Image →
                      </a>
                    ) : field === 'First Name' ? (
                      <input
                        type="text"
                        value={userName}
                        onChange={(e) => { setUserName(e.target.value); setIsUpdated(true); }}
                        placeholder="Enter first name"
                        style={{
                          width: '100%',
                          padding: '0.6rem',
                          border: '2px solid #E5E7EB',
                          borderRadius: 6,
                          fontSize: '0.95rem'
                        }}
                      />
                    ) : field === 'Last Name' ? (
                      <input
                        type="text"
                        value={userLastName}
                        onChange={(e) => { setUserLastName(e.target.value); setIsUpdated(true); }}
                        placeholder="Enter last name"
                        style={{
                          width: '100%',
                          padding: '0.6rem',
                          border: '2px solid #E5E7EB',
                          borderRadius: 6,
                          fontSize: '0.95rem'
                        }}
                      />
                    ) : field === 'Phone' ? (
                      <input
                        type="tel"
                        value={userPhone}
                        onChange={handlePhoneChange}
                        placeholder="(XXX) XXX-XXXX"
                        style={{
                          width: '100%',
                          padding: '0.6rem',
                          border: '2px solid #E5E7EB',
                          borderRadius: 6,
                          fontSize: '0.95rem'
                        }}
                      />
                    ) : (
                      <a
                        href={`/organization/${id}/sobre`}
                        style={{
                          display: 'inline-block',
                          background: '#8B5CF6',
                          color: 'white',
                          padding: '0.5rem 0.85rem',
                          borderRadius: 6,
                          textDecoration: 'none',
                          fontWeight: 600,
                          fontSize: '0.9rem'
                        }}
                      >
                        Complete in About Me →
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
            {isUpdated && (
              <button
                onClick={handleSave}
                style={{
                  marginTop: 16,
                  background: '#10B981',
                  color: 'white',
                  padding: '0.75rem 1.5rem',
                  borderRadius: 8,
                  border: 'none',
                  cursor: 'pointer',
                  fontWeight: 700,
                  fontSize: '1rem'
                }}
              >
                Save Changes
              </button>
            )}
          </div>
        )}
      </div>

      {/* Cool Techy Badge Section */}
      <div style={{
        marginTop: '1rem',
        marginBottom: '1.5rem',
        padding: '1rem',
        background: 'white',
        border: '1px solid #E5E7EB',
        borderRadius: 12,
        boxShadow: '0 6px 12px rgba(15,23,42,0.05)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: '1.1rem', color: '#111827' }}>Cool Techy Badge</div>
            <div style={{ color: '#6B7280', fontSize: '0.9rem' }}>Complete all badge forms within the last 90 days</div>
          </div>
          <div>
            {badgeSummary.active ? (
              <span style={{
                display: 'inline-block',
                background: 'linear-gradient(135deg,#22C55E,#06B6D4)',
                color: 'white',
                padding: '0.5rem 0.75rem',
                borderRadius: 999,
                fontWeight: 800
              }}>Badge Active</span>
            ) : (
              <span style={{
                display: 'inline-block',
                background: '#EEF2FF',
                color: '#3730A3',
                padding: '0.5rem 0.75rem',
                borderRadius: 999,
                fontWeight: 700
              }}>In Progress</span>
            )}
          </div>
        </div>
        {badgeLoading ? (
          <div style={{ color: '#6B7280' }}>Loading badge progress…</div>
        ) : (
          <>
            <div style={{ marginBottom: 8, color: '#374151' }}>
              {badgeSummary.total > 0 ? (
                <>
                  Completed {badgeSummary.completed} of {badgeSummary.total} required forms
                  {badgeSummary.active && badgeSummary.expiresInDays != null && (
                    <span style={{ marginLeft: 8, color: '#10B981' }}>• Expires in {badgeSummary.expiresInDays} days</span>
                  )}
                </>
              ) : (
                <span>No eligible forms have been assigned yet.</span>
              )}
            </div>
            {/* Progress bar */}
            {badgeSummary.total > 0 && (
              <div style={{ background: '#F3F4F6', borderRadius: 8, height: 10, marginBottom: 12 }}>
                <div style={{
                  width: `${Math.min(100, Math.round((badgeSummary.completed / Math.max(1,badgeSummary.total)) * 100))}%`,
                  background: 'linear-gradient(90deg,#6366F1,#22C55E)',
                  height: '100%',
                  borderRadius: 8
                }} />
              </div>
            )}
            {/* Completed Forms Section */}
            {eligibleForms.length > 0 && (() => {
              const completed = eligibleForms.filter(f => formProgress.find(p => p.formId === f.id)?.withinWindow);
              return completed.length > 0 ? (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontWeight: 800, color: '#10B981', marginBottom: 8, fontSize: '1rem' }}>✓ Completed Forms</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 12 }}>
                    {completed.map(f => {
                      const prog = formProgress.find(p => p.formId === f.id);
                      const days = prog?.daysAgo;
                      const daysRemaining = 90 - (days || 0);
                      return (
                        <div key={f.id} style={{ 
                          border: '2px solid #10B981', 
                          borderRadius: 10, 
                          padding: '0.85rem', 
                          background: '#ECFDF5',
                          position: 'relative'
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                            <div style={{ fontWeight: 700, color: '#047857', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                              {f.title}
                            </div>
                            <div style={{ fontSize: 20 }}>⭐</div>
                          </div>
                          <div style={{ color: '#065F46', fontSize: '0.85rem', marginBottom: 6 }}>
                            Last submitted: {days === 0 ? 'Today' : `${days} day${days === 1 ? '' : 's'} ago`}
                          </div>
                          <div style={{ 
                            background: daysRemaining <= 14 ? '#FEF2F2' : '#F0FDF4',
                            color: daysRemaining <= 14 ? '#991B1B' : '#166534',
                            padding: '0.4rem 0.6rem',
                            borderRadius: 6,
                            fontSize: '0.8rem',
                            fontWeight: 700,
                            display: 'inline-block'
                          }}>
                            {daysRemaining <= 0 ? 'Expired' : `Expires in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}`}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null;
            })()}

            {/* Incomplete Forms Section */}
            {eligibleForms.length > 0 && (() => {
              const incomplete = eligibleForms.filter(f => !formProgress.find(p => p.formId === f.id)?.withinWindow);
              return incomplete.length > 0 ? (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontWeight: 800, color: '#DC2626', marginBottom: 8, fontSize: '1rem' }}>✗ Forms to Complete</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 12 }}>
                    {incomplete.map(f => {
                      const prog = formProgress.find(p => p.formId === f.id);
                      const days = prog?.daysAgo;
                      return (
                        <div key={f.id} style={{ 
                          border: '2px dashed #F87171', 
                          borderRadius: 10, 
                          padding: '0.85rem', 
                          background: '#FEF2F2' 
                        }}>
                          <div style={{ fontWeight: 700, color: '#991B1B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 6 }}>
                            {f.title}
                          </div>
                          <div style={{ color: '#7F1D1D', fontSize: '0.85rem', marginBottom: 8 }}>
                            {days == null ? 'Never submitted' : `Last submission: ${days} day${days === 1 ? '' : 's'} ago (expired)`}
                          </div>
                          <div style={{ marginTop: 8 }}>
                            <a
                              href={`/church/${id}/form/${f.id}`}
                              style={{
                                display: 'inline-block',
                                background: '#DC2626',
                                color: 'white',
                                padding: '0.5rem 0.85rem',
                                borderRadius: 8,
                                textDecoration: 'none',
                                fontWeight: 700,
                                fontSize: '0.9rem'
                              }}
                            >
                              Fill out now →
                            </a>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null;
            })()}
          </>
        )}
      </div>

      {/* QR Code Section */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          margin: "10px 0 40px 0",
          padding: "2rem",
          backgroundColor: "white",
          borderRadius: "8px",
          boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          width: "100%",
          maxWidth: "100%",
        }}
      >
        <h3 style={{ marginBottom: "15px", color: "#374151" }}>My QR Code</h3>

        {/* QR Code Preview */}
        <div style={{
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          border: '1px solid #e5e7eb',
          borderRadius: '8px',
          padding: '16px',
          marginBottom: '20px',
          backgroundColor: 'white',
          width: '100%',
          maxWidth: '432px',
          minHeight: isMobile ? 'auto' : '144px',
          alignItems: 'center',
          gap: '16px'
        }}>
          <div style={{
            width: isMobile ? '100%' : '40%',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            position:"relative"
          }}>
            <QRCode
              value={generateQRData()}
              size={isMobile ? 120 : 144}
              level="H"
            />
            <img src={church?.logo} alt="Organization Logo" className="church-logo" />
          </div>
          <div style={{
            width: isMobile ? '100%' : '60%',
            paddingLeft: isMobile ? '0' : '10px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: isMobile ? 'center' : 'flex-start'
          }}>
            <p style={{ 
              fontSize: '12px', 
              marginBottom: '5px',
              textAlign: isMobile ? 'center' : 'left',
              width: '100%'
            }}>{church?.nombre || 'Organization Name'}</p>
            <p style={{ 
              fontSize: '12px', 
              marginBottom: '5px',
              textAlign: isMobile ? 'center' : 'left',
              width: '100%'
            }}>{userName}</p>
            <p style={{ 
              fontSize: '12px', 
              marginBottom: '5px',
              textAlign: isMobile ? 'center' : 'left',
              width: '100%'
            }}>ID: {generateQRData()}</p>
          </div>
        </div>

        {/* PDF Download Link */}
        <PDFDownloadLink
          document={
            <QRCodeLabel
              qrValue={generateQRData()}
              userName={userName}
              church={church}
            />
          }
          fileName="QRCodeLabel.pdf"
          style={{
            display: 'inline-block',
            padding: '8px 16px',
            backgroundColor: '#4F46E5',
            color: 'white',
            borderRadius: '6px',
            textDecoration: 'none',
            fontSize: '14px',
            width: isMobile ? '100%' : 'auto',
            textAlign: 'center'
          }}
        >
          <span>📄</span> Download Label PDF
        </PDFDownloadLink>
      </div>

      {/* Debug Log Section */}
      {showDebugLog && (
        <div
          style={{
            marginTop: "20px",
            padding: "10px",
            backgroundColor: "#f3f4f6",
            borderRadius: "8px",
          }}
        >
          <pre>{debugLog}</pre>
        </div>
      )}

      {/* Admin Panel Buttons */}
      <div style={{ 
        marginTop: "2rem",
        padding: "0 2rem",
        width: "100%"
      }}>
        <h2 style={{ marginBottom: "1rem", fontSize: "1.5rem", fontWeight: "bold" }}>My Options</h2>
        <div style={{ 
          display: "grid", 
          gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", 
          gap: "1rem",
          width: "100%"
        }}>
          <Link 
            to={`/organization/${id}/sobre`}
            style={{
              textDecoration: "none",
              color: "inherit"
            }}  
          >
            <div style={{
              border: "1px solid #e5e7eb",
              borderRadius: "8px",
              padding: "1.5rem",
              transition: "transform 0.2s, box-shadow 0.2s",
              cursor: "pointer",
              backgroundColor: "white"
            }}>
              <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>👤</div>
              <h3 style={{ margin: "0 0 0.5rem 0" }}>About Me</h3>
              <p style={{ margin: 0, color: "#6b7280" }}>Update your personal information</p>
            </div>
          </Link>

          <Link 
            to={`/organization/${id}/family`}
            style={{
              textDecoration: "none",
              color: "inherit"
            }}  
          >
            <div style={{
              border: "1px solid #e5e7eb",
              borderRadius: "8px",
              padding: "1.5rem",
              transition: "transform 0.2s, box-shadow 0.2s",
              cursor: "pointer",
              backgroundColor: "white"
            }}>
              <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>👪</div>
              <h3 style={{ margin: "0 0 0.5rem 0" }}>My Family</h3>
              <p style={{ margin: 0, color: "#6b7280" }}>Manage your family members</p>
            </div>
          </Link>

          <Link 
            to={`/organization/${id}/mi-organizacion`}
            style={{
              textDecoration: "none",
              color: "inherit"
            }}  
          >
            <div style={{
              border: "1px solid #e5e7eb",
              borderRadius: "8px",
              padding: "1.5rem",
              transition: "transform 0.2s, box-shadow 0.2s",
              cursor: "pointer",
              backgroundColor: "white"
            }}>
              <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>⛪</div>
              <h3 style={{ margin: "0 0 0.5rem 0" }}>My Organization</h3>
              <p style={{ margin: 0, color: "#6b7280" }}>View organization and tools</p>
            </div>
          </Link>

          <Link 
            to={`/organization/${id}/manage-groups`}
            style={{
              textDecoration: "none",
              color: "inherit"
            }}  
          >
            <div style={{
              border: "1px solid #e5e7eb",
              borderRadius: "8px",
              padding: "1.5rem",
              transition: "transform 0.2s, box-shadow 0.2s",
              cursor: "pointer",
              backgroundColor: "white"
            }}>
              <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>💬</div>
              <h3 style={{ margin: "0 0 0.5rem 0" }}>My Groups</h3>
              <p style={{ margin: 0, color: "#6b7280" }}>Manage and interact with your groups</p>
            </div>
          </Link>
        </div>
      </div>

      {process.env.NODE_ENV === "development" && (
        <button
          onClick={() => setForceOffline(!forceOffline)}
          style={{
            position: "fixed",
            bottom: "20px",
            right: "20px",
            padding: "8px",
            background: forceOffline ? "#DC2626" : "#059669",
            color: "white",
            borderRadius: "4px",
            border: "none",
            cursor: "pointer",
          }}
        >
          {forceOffline ? "🔌 Disable Forced Offline" : "🔌 Force Offline Mode"}
        </button>
      )}
    </div>
  );
};

export default MiPerfil;
