import React, { useState, useEffect } from "react";
import { auth, db } from "../firebase";
import { doc, getDoc, updateDoc } from "firebase/firestore";
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

  const fetchChurchData = async () => {
    try {
      const data = await getChurchData(id);
      if (data) {
        setChurch(data);
      }
    } catch (error) {
      console.error("Error fetching church:", error);
      setError("❌ Error cargando los datos de la iglesia.");
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
      setError("❌ Sin conexión a Internet - Por favor revisa tu conexión");
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
        setError("❌ Usuario no autenticado.");
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
          setError("❌ No se encontraron datos del usuario.");
        }
      } catch (error) {
        console.error("Error fetching user data:", error);
        const errorMessage = !isOnline
          ? "❌ No hay conexión a Internet. Por favor, verifica tu conexión."
          : "❌ Error cargando los datos del usuario.";
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
      toast.success("✅Datos actualizados correctamente");
    } catch (error) {
      console.error("Error updating user data:", error);
      setError("❌ Error actualizando los datos del usuario.");
      toast.error("Error al actualizar los datos");
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
        toast.success("🔄 Datos actualizados correctamente");
      } else {
        throw new Error("Still offline");
      }
    } catch (error) {
      setError(`⚠️ Sin conexión - Intento ${retryCount}/3 fallido`);
      toast.warning("No se pudo establecer conexión");
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
        <span>Sin conexión a Internet</span>
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
    <div style={commonStyles.container}>
      {offlineBanner}
      {!isOnline && (
        <button
          onClick={handleRetryConnection}
          disabled={isSyncing || retryCount >= 3}
          className="retry-button"
        >
          {isSyncing ? (
            <>
              <span>Sincronizando...</span>
              <div className="loader" />
            </>
          ) : (
            <>
              <span>🔄</span>
              <span>
                Reintentar conexión {retryCount > 0 ? `(${retryCount}/3)` : ""}
              </span>
            </>
          )}
        </button>
      )}
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <div></div> {/* Empty div to maintain flex layout */}
        <button onClick={handleLogout} style={commonStyles.logoutButton}>
          Cerrar Sesión
        </button>
      </div>
      <ChurchHeader id={id} applyShadow={false} />

      <h2 style={{ marginTop: "-30px" }}>Mi Perfil</h2>

      {error && <p style={{ color: "red" }}>{error}</p>}

      <div className="form-group">
        <label className="form-label">Nombre:</label>
        {loading ? (
          <Skeleton width={200} />
        ) : (
          <input
            type="text"
            className="form-field"
            value={userName}
            onChange={(e) => {
              setUserName(e.target.value);
              setIsUpdated(true);
            }}
            readOnly={userRole === "member"} // Make read-only for "member" role
          />
        )}
      </div>

      <div className="form-group">
        <label className="form-label">Apellido:</label>
        {loading ? (
          <Skeleton width={200} />
        ) : (
          <input
            type="text"
            className="form-field"
            value={userLastName}
            onChange={(e) => {
              setUserLastName(e.target.value);
              setIsUpdated(true);
            }}
            readOnly={userRole === "member"} // Make read-only for "member" role
          />
        )}
      </div>

      <div className="form-group">
        <label className="form-label">Teléfono:</label>
        {loading ? (
          <Skeleton width={200} />
        ) : (
          <input
            type="tel"
            className="form-field"
            value={userPhone}
            onChange={(e) => {
              setUserPhone(e.target.value);
              setIsUpdated(true);
            }}
            readOnly={userRole === "member"} // Make read-only for "member" role
          />
        )}
      </div>

      <div className="form-group">
        <label className="form-label">Correo Electrónico:</label>
        {loading ? (
          <Skeleton width={200} />
        ) : (
          <input
            type="email"
            className="form-field"
            value={userEmail}
            onChange={(e) => {
              setUserEmail(e.target.value);
              setIsUpdated(true);
            }}
            readOnly={userRole === "member"} // Make read-only for "member" role
          />
        )}
      </div>

      {userRole !== "member" && (
        <>
          <div className="form-group">
            <label className="form-label">Rol:</label>
            {loading ? (
              <Skeleton width={200} />
            ) : (
              <Select
                value={roles.find((role) => role.value === userRole)}
                onChange={handleRoleChange}
                options={roles}
                className="form-field"
              />
            )}
          </div>

          <div className="form-group">
            <label className="form-label">Grupos:</label>
            {addingGroup ? (
              <div className="loading-group-adding">
                <Spinner animation="border" variant="primary" size="sm" />
                <p className="loading-text">Updating groups...</p>
              </div>
            ) : (
              <AsyncCreatableSelect
                isMulti
                cacheOptions
                defaultOptions={groups.map((group) => ({
                  value: group.id,
                  label: group.groupName,
                }))}
                loadOptions={(inputValue) => {
                  const filteredGroups = groups.filter((group) =>
                    group.groupName
                      .toLowerCase()
                      .includes(inputValue.toLowerCase())
                  );
                  return filteredGroups.map((group) => ({
                    value: group.id,
                    label: group.groupName,
                  }));
                }}
                value={selectedGroups}
                onChange={handleGroupChange}
                placeholder="Selecciona los grupos"
                className="form-field"
              />
            )}
          </div>
        </>
      )}

      {isUpdated && (
        <button onClick={handleSave} className="form-field" style={buttonStyle}>
          Actualizar
        </button>
      )}

      {/* QR Code Section */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          margin: "10px 0 40px 0",
          padding: "clamp(10px, 3vw, 20px)",
          backgroundColor: "white",
          borderRadius: "8px",
          boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          width: "100%",
          maxWidth: "6in",
        }}
      >
        <h3 style={{ marginBottom: "15px", color: "#374151" }}>Mi Código QR</h3>

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
              includeMargin={true}
            />
            <img src={church?.logo} alt="Church Logo" className="church-logo" />
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
            }}>{church?.nombre || 'Church Name'}</p>
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
        marginTop: "2rem"
      }}>
        <h2 style={{ marginBottom: "1rem", fontSize: "1.5rem", fontWeight: "bold" }}>My Options</h2>
        <div style={{ 
          display: "grid", 
          gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", 
          gap: "1rem" 
        }}>
          <Link 
            to={`/church/${id}/sobre`}
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
              <h3 style={{ margin: "0 0 0.5rem 0" }}>Sobre Mi</h3>
              <p style={{ margin: 0, color: "#6b7280" }}>Update your personal information</p>
            </div>
          </Link>

          <Link 
            to={`/church/${id}/family`}
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
              <h3 style={{ margin: "0 0 0.5rem 0" }}>Mi Familia</h3>
              <p style={{ margin: 0, color: "#6b7280" }}>Manage your family members</p>
            </div>
          </Link>

          <Link 
            to={`/church/${id}/course-categories`}
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
              <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>🎓</div>
              <h3 style={{ margin: "0 0 0.5rem 0" }}>Process</h3>
              <p style={{ margin: 0, color: "#6b7280" }}>View your discipleship journey</p>
            </div>
          </Link>

          <Link 
            to={`/church/${id}/course-admin`}
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
              <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>📚</div>
              <h3 style={{ margin: "0 0 0.5rem 0" }}>Mi Proceso</h3>
              <p style={{ margin: 0, color: "#6b7280" }}>Manage your courses and progression</p>
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
              <h3 style={{ margin: "0 0 0.5rem 0" }}>Mi Iglesia</h3>
              <p style={{ margin: 0, color: "#6b7280" }}>View church organization and tools</p>
            </div>
          </Link>

          <Link 
            to={`/church/${id}/chatv2`}
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
              <h3 style={{ margin: "0 0 0.5rem 0" }}>Mis Grupos</h3>
              <p style={{ margin: 0, color: "#6b7280" }}>Chat and interact with your groups</p>
            </div>
          </Link>

          <Link 
            to={`/church/${id}/gallery-admin`}
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
              <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>🖼️</div>
              <h3 style={{ margin: "0 0 0.5rem 0" }}>Manage Gallery</h3>
              <p style={{ margin: 0, color: "#6b7280" }}>Create and edit photo galleries</p>
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
