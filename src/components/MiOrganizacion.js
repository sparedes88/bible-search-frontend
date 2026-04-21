import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { db } from "../firebase";
import { collection, doc, getDoc, getDocs, updateDoc } from "firebase/firestore";
import { toast } from "react-toastify";
import {
  getModuleVisibilityRoleKeys,
  MODULE_METADATA_DOC_ID,
  MODULE_LAYOUT_DOC_ID,
  MODULE_LAYOUT_FIELD,
  MODULE_SETTINGS_SUBCOLLECTION,
  MODULE_VISIBILITY_DOC_ID,
  MODULE_VISIBILITY_FIELD,
  getResolvedOrganizationModuleSections,
  mergeModuleLayoutSettings,
  mergeModuleVisibilitySettings,
  normalizeModuleVisibilityRole,
} from "../utils/organizationModules";
import { clearSwitchAccountsForOrganization } from "../utils/accountSwitching";
import "./MiOrganizacion.css";
import ChurchHeader from "./ChurchHeader";
import commonStyles from "../pages/commonStyles";
import Skeleton from "react-loading-skeleton";

const formatPhoneNumber = (value) => {
  if (!value) return value;

  const phoneNumber = value.replace(/[^\d]/g, "");

  if (phoneNumber.length < 4) return phoneNumber;
  if (phoneNumber.length < 7) {
    return `(${phoneNumber.slice(0, 3)})${phoneNumber.slice(3)}`;
  }
  return `(${phoneNumber.slice(0, 3)})${phoneNumber.slice(
    3,
    6
  )}-${phoneNumber.slice(6, 10)}`;
};

const ContactSection = ({ icon, label, value, link }) => {
  if (!value) return null;

  const content = link ? (
    <a
      href={link}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-600 hover:text-blue-800"
    >
      {value}
    </a>
  ) : (
    <span>{value}</span>
  );

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "5px",
        }}
      >
        <div>{icon}</div>
        <p style={{ marginTop: 0, marginBottom: 0 }}>{label} :</p>
      </div>
      <p style={{ marginTop: 0, marginBottom: 0 }}>{content}</p>
    </div>
  );
};

const formGroupStyle = {
  marginBottom: "0px",
  width: "100%",
};

const formLabelStyle = {
  fontSize: "14px",
  fontWeight: "500",
  color: "#374151",
  marginBottom: "4px",
  display: "block",
};

const getOrganizationLogoUrl = (organization) => {
  const logo = String(organization?.logo || organization?.Logo || "").trim();
  if (!logo) return "";

  if (
    logo.startsWith("http://") ||
    logo.startsWith("https://") ||
    logo.startsWith("data:") ||
    logo.startsWith("blob:") ||
    logo.startsWith("/img/")
  ) {
    return logo;
  }

  if (logo.startsWith("/")) {
    const normalizedPath = logo.substring(1);
    return `https://firebasestorage.googleapis.com/v0/b/igletechv1.firebasestorage.app/o/${encodeURIComponent(normalizedPath)}?alt=media`;
  }

  return logo;
};

const getOrganizationDisplayName = (organization) =>
  organization?.nombre || organization?.name || organization?.churchId || organization?.id || "";

const baseRoleLabelMap = {
  global_admin: "Global Admin",
  admin: "Admin",
  member: "Member",
};

const getRoleDisplayName = (roleData = {}) =>
  String(
    roleData?.customRoleName
    || roleData?.customRoleLabel
    || roleData?.roleName
    || roleData?.roleLabel
    || roleData?.assignedRoleName
    || roleData?.assignedRoleLabel
    || ""
  ).trim();

const isGenericCustomRoleValue = (value) => {
  const normalizedValue = String(value || "").trim().toLowerCase().replace(/[_-]+/g, " ");
  return ["custom role", "custom", "role"].includes(normalizedValue);
};

const getPreferredUserRoleKey = (userData = {}) => {
  const roleCandidates = [
    userData?.customRoleId,
    userData?.customRole,
    userData?.assignedRoleId,
    userData?.role,
  ];

  const concreteRole = roleCandidates.find((value) => {
    const trimmedValue = String(value || "").trim();
    return trimmedValue && !isGenericCustomRoleValue(trimmedValue);
  });

  if (concreteRole) {
    return String(concreteRole).trim();
  }

  const fallbackRole = roleCandidates.find((value) => String(value || "").trim());
  return fallbackRole ? String(fallbackRole).trim() : "";
};

const normalizeRoleSettingsKeys = (settings = {}) =>
  Object.entries(settings || {}).reduce((accumulator, [roleKey, roleSettings]) => {
    const normalizedRoleKey = normalizeModuleVisibilityRole(roleKey);
    if (!normalizedRoleKey) {
      return accumulator;
    }

    const existingSettings = accumulator[normalizedRoleKey];
    if (
      existingSettings &&
      typeof existingSettings === "object" &&
      !Array.isArray(existingSettings) &&
      roleSettings &&
      typeof roleSettings === "object" &&
      !Array.isArray(roleSettings)
    ) {
      accumulator[normalizedRoleKey] = {
        ...existingSettings,
        ...roleSettings,
      };
      return accumulator;
    }

    accumulator[normalizedRoleKey] = roleSettings;
    return accumulator;
  }, {});

const normalizeRoleMapKeys = (roleMap = {}) =>
  Object.entries(roleMap || {}).reduce((accumulator, [roleKey, value]) => {
    const normalizedRoleKey = normalizeModuleVisibilityRole(roleKey);
    if (!normalizedRoleKey) {
      return accumulator;
    }

    accumulator[normalizedRoleKey] = value;
    return accumulator;
  }, {});

const getMappedRoleValue = (roleMap = {}, roleKey = "") => {
  const normalizedMap = normalizeRoleMapKeys(roleMap);
  const normalizedRoleKey = normalizeModuleVisibilityRole(roleKey);
  if (!normalizedRoleKey) {
    return "";
  }

  const exactMatch = normalizedMap[normalizedRoleKey];
  if (String(exactMatch || "").trim()) {
    return String(exactMatch).trim();
  }

  return "";
};

const formatBaseRoleLabel = (role) => {
  const normalizedRole = String(role || "").trim().toLowerCase();
  return baseRoleLabelMap[normalizedRole] || "Member";
};

const MiOrganizacion = () => {
  const { id } = useParams();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const normalizedRole = String(getPreferredUserRoleKey(user) || "").trim().toLowerCase();
  const isGlobalAdminUser = ["global_admin", "system_global_admin"].includes(normalizedRole);
  const isAdminUser = isGlobalAdminUser || ["admin", "system_admin"].includes(normalizedRole);
  const sameOrganization = String(user?.churchId || "") === String(id || "");
  const [resolvedModuleRole, setResolvedModuleRole] = useState("member");
  const [activeModuleRole, setActiveModuleRole] = useState("member");
  const [resolvedRoleLabel, setResolvedRoleLabel] = useState("member");
  const [resolvedRoleBaseLabel, setResolvedRoleBaseLabel] = useState("Member");
  const [loading, setLoading] = useState(true);
  const [organizationData, setOrganizationData] = useState(null);
  const [error, setError] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    address: "",
    website: "",
    email: "",
    phone: "",
  });
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [validationErrors, setValidationErrors] = useState({});
  const [userPermissions, setUserPermissions] = useState({});
  const [moduleVisibilitySettings, setModuleVisibilitySettings] = useState(() =>
    mergeModuleVisibilitySettings()
  );
  const [moduleLayoutSettings, setModuleLayoutSettings] = useState(() =>
    mergeModuleLayoutSettings()
  );
  const [availableOrganizations, setAvailableOrganizations] = useState([]);
  const [isOrganizationDropdownOpen, setIsOrganizationDropdownOpen] = useState(false);
  const [organizationSearchQuery, setOrganizationSearchQuery] = useState("");
  const organizationDropdownRef = useRef(null);

  const moduleRole = resolvedModuleRole;

  useEffect(() => {
    const resolveRoleForModules = () => {
      const systemRoleAliases = {
        system_global_admin: "global_admin",
        system_admin: "admin",
        system_member: "member",
      };

      const rawRole = String(getPreferredUserRoleKey(user) || "").trim();
      const normalizedRawRole = String(rawRole || "").trim().toLowerCase();
      const mappedSystemRole = systemRoleAliases[normalizedRawRole] || normalizedRawRole;
      const userRoleLabel = getRoleDisplayName(user || {});

      if (["global_admin", "admin", "member"].includes(mappedSystemRole)) {
        const moduleRoleKey = mappedSystemRole === "admin" ? "global_admin" : mappedSystemRole;
        setResolvedModuleRole(moduleRoleKey);
        setResolvedRoleLabel(mappedSystemRole.replace(/_/g, " "));
        setResolvedRoleBaseLabel(formatBaseRoleLabel(mappedSystemRole));
        return;
      }

      if (!id || !user) {
        setResolvedModuleRole("member");
        setActiveModuleRole("member");
        setResolvedRoleLabel("member");
        setResolvedRoleBaseLabel("Member");
        return;
      }

      const fallbackRoleKey = normalizeModuleVisibilityRole(rawRole || "member");
      const fallbackRoleLabel = (userRoleLabel && !isGenericCustomRoleValue(userRoleLabel))
        ? userRoleLabel
        || (
          rawRole && /^[a-z0-9]{12,}$/i.test(rawRole)
            ? "custom role"
            : (rawRole || "member").replace(/_/g, " ")
        )
        : (
          rawRole && /^[a-z0-9]{12,}$/i.test(rawRole)
            ? "custom role"
            : (rawRole || "member").replace(/_/g, " ")
        );
      setResolvedModuleRole(fallbackRoleKey);
      setResolvedRoleLabel(fallbackRoleLabel);
      setResolvedRoleBaseLabel(formatBaseRoleLabel(user?.baseRole || user?.role));
    };

    resolveRoleForModules();
  }, [id, user]);

  const navigationSections = useMemo(() => {
    const sections = getResolvedOrganizationModuleSections(
      id,
      activeModuleRole,
      moduleVisibilitySettings,
      moduleLayoutSettings
    );

    return sections.map((section) => ({
      title: section.title,
      cards: section.cards,
    }));
  }, [activeModuleRole, id, moduleLayoutSettings, moduleVisibilitySettings]);

  useEffect(() => {
    const fetchOrganizationData = async () => {
      if (!id) {
        setError("Organization ID is missing.");
        setLoading(false);
        return;
      }

      if (!user) {
        setLoading(false);
        // Don't set error - let PrivateRoute handle authentication
        return;
      }

      // Reset error state when ID changes
      setError(null);

      // Check if user has access to this organization
      // Global admins can access any organization
      // Regular users (admin, member) can only access their assigned church
      if (!isGlobalAdminUser && user.churchId && String(user.churchId) !== String(id)) {
        setError("Access Denied: You don't have permission to access this organization.");
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const [organizationSnap, visibilitySnap, layoutSnap, metadataSnap] = await Promise.all([
          getDoc(doc(db, "churches", id)),
          getDoc(doc(db, "churches", id, MODULE_SETTINGS_SUBCOLLECTION, MODULE_VISIBILITY_DOC_ID)),
          getDoc(doc(db, "churches", id, MODULE_SETTINGS_SUBCOLLECTION, MODULE_LAYOUT_DOC_ID)),
          getDoc(doc(db, "churches", id, MODULE_SETTINGS_SUBCOLLECTION, MODULE_METADATA_DOC_ID)),
        ]);
        
        if (organizationSnap.exists()) {
          const data = organizationSnap.data();
          setOrganizationData(data);

          const visibilityData = visibilitySnap.exists()
            ? visibilitySnap.data()?.settings
            : data?.[MODULE_VISIBILITY_FIELD];
          const layoutData = layoutSnap.exists()
            ? layoutSnap.data()?.settings
            : data?.[MODULE_LAYOUT_FIELD];

          const normalizedVisibilityData = normalizeRoleSettingsKeys(visibilityData || {});
          const normalizedLayoutData = normalizeRoleSettingsKeys(layoutData || {});
          const storedRoleKeys = Array.from(
            new Set([
              ...Object.keys(normalizedVisibilityData || {}),
              ...Object.keys(normalizedLayoutData || {}),
            ].filter(Boolean))
          );
          const customStoredRoleKeys = storedRoleKeys.filter(
            (roleKey) => !["global_admin", "member"].includes(roleKey)
          );

          const normalizeRoleAlias = (value) =>
            String(value || "")
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "");

          const roleCandidates = [
            moduleRole,
            normalizeModuleVisibilityRole(user?.customRoleId),
            normalizeModuleVisibilityRole(user?.customRole),
            normalizeModuleVisibilityRole(user?.assignedRoleId),
            normalizeModuleVisibilityRole(user?.role),
          ]
            .filter(Boolean)
            .filter((roleKey) => !isGenericCustomRoleValue(roleKey));

          const labelCandidateAlias = normalizeRoleAlias(resolvedRoleLabel);
          const matchedStoredRoleKey = roleCandidates.find((roleKey) =>
            storedRoleKeys.includes(roleKey)
          );
          const fuzzyMatchedStoredRoleKey =
            matchedStoredRoleKey
            || storedRoleKeys.find((storedRoleKey) => {
              const normalizedStoredRoleKey = normalizeRoleAlias(storedRoleKey);
              if (!normalizedStoredRoleKey) {
                return false;
              }

              return roleCandidates.some((candidateRole) => {
                const normalizedCandidateRole = normalizeRoleAlias(candidateRole);
                return normalizedCandidateRole && normalizedCandidateRole === normalizedStoredRoleKey;
              });
            });
          const labelMatchedStoredRoleKey =
            !fuzzyMatchedStoredRoleKey && labelCandidateAlias
              ? storedRoleKeys.find((storedRoleKey) =>
                  normalizeRoleAlias(storedRoleKey) === labelCandidateAlias
                )
              : "";
          const effectiveRoleKey = matchedStoredRoleKey
            || fuzzyMatchedStoredRoleKey
            || labelMatchedStoredRoleKey
            || (
              !["global_admin", "member"].includes(moduleRole) &&
              customStoredRoleKeys.length === 1
                ? customStoredRoleKeys[0]
                : (roleCandidates[0] || moduleRole)
            );

          const mergedRoleKeys = getModuleVisibilityRoleKeys({
            storedVisibilitySettings: normalizedVisibilityData,
            storedLayoutSettings: normalizedLayoutData,
            availableRoles: [
              effectiveRoleKey,
              moduleRole,
              ...roleCandidates,
            ].filter(Boolean),
          });

          const resolvedActiveRole = mergedRoleKeys.includes(effectiveRoleKey)
            ? effectiveRoleKey
            : mergedRoleKeys.includes(moduleRole)
            ? moduleRole
            : "member";

          const metadata = metadataSnap.exists() ? metadataSnap.data() || {} : {};
          const metadataRoleNameMap = {
            ...(data?.miOrganizacionRoleNameMap || {}),
            ...(metadata?.roleNameMap || {}),
          };
          const metadataRoleBaseRoleMap = {
            ...(data?.miOrganizacionRoleBaseRoleMap || {}),
            ...(metadata?.roleBaseRoleMap || {}),
          };

          const metadataResolvedRoleName = getMappedRoleValue(metadataRoleNameMap, resolvedActiveRole);
          const metadataResolvedBaseRole = String(
            getMappedRoleValue(metadataRoleBaseRoleMap, resolvedActiveRole)
            || user?.baseRole
            || user?.role
            || "member"
          ).trim().toLowerCase();

          if (metadataResolvedRoleName) {
            setResolvedRoleLabel(metadataResolvedRoleName);
          }
          setResolvedRoleBaseLabel(formatBaseRoleLabel(metadataResolvedBaseRole));

          setActiveModuleRole(resolvedActiveRole);

          setModuleVisibilitySettings(
            mergeModuleVisibilitySettings(normalizedVisibilityData, mergedRoleKeys)
          );
          setModuleLayoutSettings(
            mergeModuleLayoutSettings(normalizedLayoutData, mergedRoleKeys)
          );
          setFormData({
            address: data.address || "",
            website: data.website || "",
            email: data.email || "",
            phone: data.phone || "",
          });
        } else {
          setError("Organization not found");
          setActiveModuleRole(moduleRole);
          setModuleVisibilitySettings(mergeModuleVisibilitySettings({}));
          setModuleLayoutSettings(mergeModuleLayoutSettings({}));
        }
      } catch (err) {
        console.error("Error fetching data:", err);
        setError("Error loading data");
      } finally {
        setLoading(false);
      }
    };

    fetchOrganizationData();
  }, [id, moduleRole, user]);

  useEffect(() => {
    const formsVisibleFromModules = navigationSections.some((section) =>
      (section.cards || []).some((card) => card.id === "forms")
    );

    setUserPermissions({
      forms: formsVisibleFromModules || isAdminUser,
    });
  }, [isAdminUser, navigationSections]);

  useEffect(() => {
    const fetchAvailableOrganizations = async () => {
      if (!user || !id) {
        setAvailableOrganizations([]);
        return;
      }

      try {
        if (isGlobalAdminUser) {
          const churchesSnapshot = await getDocs(collection(db, "churches"));
          const organizations = churchesSnapshot.docs.map((churchDoc) => ({
            id: churchDoc.id,
            ...churchDoc.data(),
          }));
          setAvailableOrganizations(organizations);
          return;
        }

        const organizationSnap = await getDoc(doc(db, "churches", id));
        if (organizationSnap.exists()) {
          const organization = { id: organizationSnap.id, ...organizationSnap.data() };
          setAvailableOrganizations([organization]);
        } else {
          setAvailableOrganizations([]);
        }
      } catch (fetchError) {
        console.error("Error fetching organizations for switcher:", fetchError);
      }
    };

    fetchAvailableOrganizations();
  }, [id, isGlobalAdminUser, user]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        organizationDropdownRef.current &&
        !organizationDropdownRef.current.contains(event.target)
      ) {
        setIsOrganizationDropdownOpen(false);
        setOrganizationSearchQuery("");
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleInputChange = (e) => {
    const { name, value } = e.target;

    if (name === "phone") {
      const cleaned = value.replace(/[^\d\s()-]/g, "");
      setFormData((prev) => ({
        ...prev,
        [name]: formatPhoneNumber(cleaned),
      }));
    } else {
      setFormData((prev) => ({
        ...prev,
        [name]: value,
      }));
    }
  };

  const validateForm = () => {
    const errors = {};

    if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      errors.email = "Invalid email";
    }

    if (formData.phone) {
      const phoneDigits = formData.phone.replace(/[^\d]/g, "");
      if (phoneDigits.length !== 10) {
        errors.phone = "Phone number must have 10 digits";
      } else if (!/^\(\d{3}\)\d{3}-\d{4}$/.test(formData.phone)) {
        errors.phone = "Format must be (123)456-7890";
      }
    }

    if (
      formData.website &&
      !/^(https?:\/\/)?([\da-z.-]+)\.([a-z.]{2,6})([/\w .-]*)*\/?$/.test(
        formData.website
      )
    ) {
      errors.website = "Invalid URL";
    }

    if (isEditing && !formData.address.trim()) {
      errors.address = "Address is required";
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleLogout = async () => {
    try {
      const returnUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      const logoutRoutePrefix =
        typeof window !== "undefined" && window.location?.pathname?.includes("/church/")
          ? "/church"
          : "/organization";
      clearSwitchAccountsForOrganization(id);
      await logout();
      navigate(`${logoutRoutePrefix}/${id}/login?returnUrl=${encodeURIComponent(returnUrl)}`);
    } catch (err) {
      console.error("Error logging out:", err);
      toast.error("Failed to logout");
    }
  };

  const handleSwitchUser = async () => {
    try {
      const returnUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      const logoutRoutePrefix =
        typeof window !== "undefined" && window.location?.pathname?.includes("/church/")
          ? "/church"
          : "/organization";
      await logout();
      navigate(
        `${logoutRoutePrefix}/${id}/login?switchUser=1&returnUrl=${encodeURIComponent(returnUrl)}`
      );
    } catch (err) {
      console.error("Error switching user:", err);
      toast.error("Failed to switch user");
    }
  };

  const handleSave = async () => {
    if (!validateForm()) {
      return;
    }

    try {
      setLoading(true);
      const organizationRef = doc(db, "churches", id);
      await updateDoc(organizationRef, {
        address: formData.address,
        website: formData.website,
        email: formData.email,
        phone: formData.phone,
      });
      
      setOrganizationData((prev) => ({
        ...prev,
        ...formData,
      }));
      setIsEditing(false);
      setSaveSuccess(true);
      toast.success("Organization information updated successfully!");
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error("Error updating organization data:", err);
      setError("Failed to update organization information");
      toast.error("Failed to update organization information");
    } finally {
      setLoading(false);
    }
  };

  const handleOrganizationSwitch = (nextOrganizationId) => {
    if (!nextOrganizationId || String(nextOrganizationId) === String(id)) {
      return;
    }

    setIsOrganizationDropdownOpen(false);
    setOrganizationSearchQuery("");

    const routeType = routePrefix === "/church" ? "church" : "organization";
    navigate(`/${routeType}/${nextOrganizationId}/mi-organizacion`);
  };

  const currentOrganization = availableOrganizations.find(
    (organization) => String(organization?.id) === String(id)
  );

  // Filter navigation cards based on user permissions
  const getFilteredNavigationSections = () => {
    return navigationSections
      .map((section) => ({
        ...section,
        cards: section.cards.filter((card) => {
          if (!card.requiresPermission) return true;
          return userPermissions[card.requiresPermission] === true;
        }),
      }))
      .filter((section) => section.cards.length > 0);
  };

  // Determine route prefix based on current URL (with safety check)
  const routePrefix = (typeof window !== 'undefined' && window.location?.pathname?.includes('/church/')) 
    ? '/church' 
    : '/organization';

  if (error) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(180deg, #F8FAFC 0%, #EEF2FF 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px'
      }}>
        <div style={{
          maxWidth: '500px',
          margin: '0 auto',
          backgroundColor: 'white',
          padding: '3rem',
          borderRadius: '16px',
          border: '1px solid #E5E7EB',
          boxShadow: '0 12px 24px rgba(15, 23, 42, 0.08)',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>🚫</div>
          <h1 style={{ ...commonStyles.title, marginBottom: '1rem', color: '#ef4444' }}>
            Access Denied
          </h1>
          <p style={{ color: '#6b7280', marginBottom: '2rem', fontSize: '1.1rem' }}>
            {error}
          </p>
          {user?.churchId && (
            <button
              onClick={() => {
                console.log('Navigating to church:', user.churchId);
                navigate(`/organization/${user.churchId}/mi-organizacion`, { replace: true });
              }}
              style={{
                backgroundColor: '#4F46E5',
                color: 'white',
                padding: '12px 24px',
                borderRadius: '8px',
                textDecoration: 'none',
                display: 'inline-block',
                fontWeight: '500',
                marginBottom: '1rem',
                border: 'none',
                cursor: 'pointer'
              }}
            >
              Go to My Organization
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="" style={commonStyles.fullWidthContainer}>
      <Link to={`${routePrefix}/${id}/mi-perfil`} style={commonStyles.backButtonLink}>
        ← Back to Profile
      </Link>
      <ChurchHeader id={id} applyShadow={false} allowEditBannerLogo={true} />
      <div style={{ marginTop: "-30px" }}>
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          marginBottom: '1rem'
        }}>
          <h1 style={commonStyles.title}>My Organization</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {isGlobalAdminUser && availableOrganizations.length > 1 && (
              <div
                ref={organizationDropdownRef}
                style={{
                  position: 'relative',
                  minWidth: '260px',
                }}
              >
                <button
                  type="button"
                  aria-label="Switch organization"
                  onClick={() => setIsOrganizationDropdownOpen((prev) => !prev)}
                  style={{
                    width: '100%',
                    backgroundColor: '#FFFFFF',
                    border: '1px solid #E5E7EB',
                    borderRadius: '8px',
                    padding: '8px 10px',
                    color: '#1F2937',
                    fontSize: '0.9rem',
                    fontWeight: '600',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px',
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                    {!!getOrganizationLogoUrl(currentOrganization) && (
                      <img
                        src={getOrganizationLogoUrl(currentOrganization)}
                        alt={getOrganizationDisplayName(currentOrganization) || 'Organization logo'}
                        style={{
                          width: '22px',
                          height: '22px',
                          borderRadius: '999px',
                          objectFit: 'cover',
                          flexShrink: 0,
                        }}
                        onError={(event) => {
                          event.currentTarget.style.display = 'none';
                        }}
                      />
                    )}
                    <span
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {getOrganizationDisplayName(currentOrganization) || 'Select organization...'}
                    </span>
                  </span>
                  <span
                    style={{
                      transform: isOrganizationDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                      transition: 'transform 0.2s',
                      flexShrink: 0,
                    }}
                  >
                    v
                  </span>
                </button>

                {isOrganizationDropdownOpen && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 'calc(100% + 6px)',
                      left: 0,
                      right: 0,
                      backgroundColor: 'white',
                      border: '1px solid #E5E7EB',
                      borderRadius: '8px',
                      boxShadow: '0 8px 24px rgba(15, 23, 42, 0.12)',
                      zIndex: 1200,
                      maxHeight: '320px',
                      overflowY: 'auto',
                    }}
                  >
                    <div style={{ padding: '8px', borderBottom: '1px solid #E5E7EB' }}>
                      <input
                        type="text"
                        placeholder="Search organizations..."
                        value={organizationSearchQuery}
                        onChange={(event) => setOrganizationSearchQuery(event.target.value)}
                        style={{
                          width: '100%',
                          padding: '8px 10px',
                          border: '1px solid #D1D5DB',
                          borderRadius: '6px',
                          fontSize: '0.875rem',
                          boxSizing: 'border-box',
                        }}
                        autoFocus
                      />
                    </div>
                    <div>
                      {availableOrganizations
                        .slice()
                        .sort((a, b) =>
                          String(getOrganizationDisplayName(a)).toLowerCase().localeCompare(
                            String(getOrganizationDisplayName(b)).toLowerCase()
                          )
                        )
                        .filter((organization) =>
                          String(getOrganizationDisplayName(organization))
                            .toLowerCase()
                            .includes(organizationSearchQuery.toLowerCase())
                        )
                        .map((organization) => (
                          <button
                            key={organization.id}
                            type="button"
                            onClick={() => handleOrganizationSwitch(organization.id)}
                            style={{
                              width: '100%',
                              textAlign: 'left',
                              padding: '9px 10px',
                              border: 'none',
                              borderBottom: '1px solid #F3F4F6',
                              backgroundColor:
                                String(organization.id) === String(id) ? '#EEF2FF' : 'white',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              fontWeight: String(organization.id) === String(id) ? '700' : '500',
                            }}
                          >
                            {!!getOrganizationLogoUrl(organization) && (
                              <img
                                src={getOrganizationLogoUrl(organization)}
                                alt={`${getOrganizationDisplayName(organization)} logo`}
                                style={{
                                  width: '20px',
                                  height: '20px',
                                  borderRadius: '999px',
                                  objectFit: 'cover',
                                  flexShrink: 0,
                                }}
                                onError={(event) => {
                                  event.currentTarget.style.display = 'none';
                                }}
                              />
                            )}
                            <span>{getOrganizationDisplayName(organization)}</span>
                          </button>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            <div style={{
              backgroundColor: '#F3F4F6',
              padding: '8px 16px',
              borderRadius: '8px',
              border: '1px solid #E5E7EB',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              <span style={{ fontSize: '1.2rem' }}>👤</span>
              <div>
                <div style={{ fontSize: '0.75rem', color: '#6B7280', fontWeight: '500' }}>Your Role</div>
                <div style={{ fontSize: '0.95rem', fontWeight: '600', color: '#1F2937', textTransform: 'capitalize' }}>
                  {resolvedRoleLabel}
                </div>
                <div style={{ fontSize: '0.78rem', color: '#475569', fontWeight: '600' }}>
                  Based on: {resolvedRoleBaseLabel}
                </div>
              </div>
            </div>
            <button
              onClick={handleSwitchUser}
              style={{
                backgroundColor: '#0F766E',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                padding: '10px 16px',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              Switch User
            </button>
            <button
              onClick={handleLogout}
              style={{
                backgroundColor: '#DC2626',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                padding: '10px 16px',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              Log Out
            </button>
          </div>
        </div>
        {(user && (isGlobalAdminUser || (isAdminUser && (!user?.churchId || sameOrganization)))) && (
          <div
            style={{
              display: "flex",
              gap: "10px",
            }}
          >
            <button
              onClick={() => navigate(`${routePrefix}/${id}/module-visibility-settings`)}
              className="form-field"
              style={{
                backgroundColor: "#0F766E",
                color: "white",
                padding: "10px 20px",
                borderRadius: "8px",
                border: "none",
                cursor: "pointer",
                width: "100%",
              }}
            >
              Manage Modules
            </button>
            <button
              onClick={() => (isEditing ? handleSave() : setIsEditing(true))}
              className="form-field"
              style={{
                backgroundColor: isEditing ? "#56b868" : "#4F46E5",
                color: "white",
                padding: "10px 20px",
                borderRadius: "8px",
                border: "none",
                cursor: "pointer",
                width: "100%",
              }}
              disabled={loading}
            >
              {loading
                ? "Saving..."
                : isEditing
                ? "Save Changes"
                : "Edit Information"}
            </button>
            {isEditing && (
              <button
                onClick={() => setIsEditing(false)}
                className="form-field"
                style={{
                  backgroundColor: "#d69824",
                  color: "white",
                  padding: "10px 20px",
                  borderRadius: "8px",
                  border: "none",
                  cursor: "pointer",
                  width: "100%",
                }}
                disabled={loading}
              >
                Cancel
              </button>
            )}
          </div>
        )}
        {loading ? (
          <div className="p-4">
            <Skeleton count={5} className="mb-2" />
          </div>
        ) : (
          <>
            {organizationData && (
              <div className="grid gap-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="form-group" style={formGroupStyle}>
                    {isEditing ? (
                      <>
                        <label
                          className="block text-sm font-medium text-gray-700"
                          style={formLabelStyle}
                        >
                          Address
                        </label>
                        <input
                          type="text"
                          name="address"
                          value={formData.address}
                          onChange={handleInputChange}
                          className="form-field"
                          style={{
                            width: "100%",
                            padding: "10px",
                            borderRadius: "8px",
                            border: validationErrors.address
                              ? "1px solid #EF4444"
                              : "1px solid #E5E7EB",
                            marginTop: "8px",
                            fontSize: "14px",
                          }}
                        />
                        {validationErrors.address && (
                          <p className="text-red-600 text-sm">
                            {validationErrors.address}
                          </p>
                        )}
                      </>
                    ) : (
                      <ContactSection
                        icon="📍"
                        label="Address"
                        value={organizationData.address}
                      />
                    )}
                  </div>
                  <div className="form-group" style={formGroupStyle}>
                    {isEditing ? (
                      <>
                        <label
                          className="block text-sm font-medium text-gray-700"
                          style={formLabelStyle}
                        >
                          Website
                        </label>
                        <input
                          type="url"
                          name="website"
                          value={formData.website}
                          onChange={handleInputChange}
                          className="form-field"
                          style={{
                            width: "100%",
                            padding: "10px",
                            borderRadius: "8px",
                            border: validationErrors.website
                              ? "1px solid #EF4444"
                              : "1px solid #E5E7EB",
                            marginTop: "8px",
                            fontSize: "14px",
                          }}
                        />
                        {validationErrors.website && (
                          <p className="text-red-600 text-sm">
                            {validationErrors.website}
                          </p>
                        )}
                      </>
                    ) : (
                      <ContactSection
                        icon="🌐"
                        label="Website"
                        value={organizationData.website}
                        link={
                          organizationData.website?.startsWith("http")
                            ? organizationData.website
                            : `https://${organizationData.website}`
                        }
                      />
                    )}
                  </div>
                  <div className="form-group" style={formGroupStyle}>
                    {isEditing ? (
                      <>
                        <label
                          className="block text-sm font-medium text-gray-700"
                          style={formLabelStyle}
                        >
                          Email
                        </label>
                        <input
                          type="email"
                          name="email"
                          value={formData.email}
                          onChange={handleInputChange}
                          className="form-field"
                          style={{
                            width: "100%",
                            padding: "10px",
                            borderRadius: "8px",
                            border: validationErrors.email
                              ? "1px solid #EF4444"
                              : "1px solid #E5E7EB",
                            marginTop: "8px",
                            fontSize: "14px",
                          }}
                        />
                        {validationErrors.email && (
                          <p className="text-red-600 text-sm">
                            {validationErrors.email}
                          </p>
                        )}
                      </>
                    ) : (
                      <ContactSection
                        icon="📧"
                        label="Email"
                        value={organizationData.email}
                        link={`mailto:${organizationData.email}`}
                      />
                    )}
                  </div>
                  <div className="form-group" style={formGroupStyle}>
                    {isEditing ? (
                      <>
                        <label
                          className="block text-sm font-medium text-gray-700"
                          style={formLabelStyle}
                        >
                          Phone
                        </label>
                        <input
                          type="tel"
                          name="phone"
                          value={formData.phone}
                          onChange={handleInputChange}
                          placeholder="(123)456-7890"
                          maxLength="13"
                          className="form-field"
                          style={{
                            width: "100%",
                            padding: "10px",
                            borderRadius: "8px",
                            border: validationErrors.phone
                              ? "1px solid #EF4444"
                              : "1px solid #E5E7EB",
                            marginTop: "8px",
                            fontSize: "14px",
                          }}
                        />
                        {validationErrors.phone && (
                          <p className="text-red-600 text-sm">
                            {validationErrors.phone}
                          </p>
                        )}
                      </>
                    ) : (
                      <ContactSection
                        icon="📞"
                        label="Phone"
                        value={formatPhoneNumber(organizationData.phone)}
                        link={`tel:${organizationData.phone}`}
                      />
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Navigation Cards */}
      <div style={{ marginTop: "2rem" }}>
        {getFilteredNavigationSections().map((section, sectionIndex) => (
          <div key={sectionIndex} style={{ marginBottom: "2rem" }}>
            <h2 style={{ marginBottom: "1rem", fontSize: "1.5rem", fontWeight: "bold" }}>{section.title}</h2>
            <div style={{ 
              display: "grid", 
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", 
              gap: "1rem" 
            }}>
              {section.cards.map((card, cardIndex) => (
                <Link 
                  key={cardIndex} 
                  to={card.path}
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
                    <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>{card.icon}</div>
                    <h3 style={{ margin: "0 0 0.5rem 0" }}>{card.title}</h3>
                    <p style={{ margin: 0, color: "#6b7280" }}>{card.description}</p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Success message */}
      {saveSuccess && (
        <div style={{
          position: "fixed",
          bottom: "20px",
          right: "20px",
          backgroundColor: "#10B981",
          color: "white",
          padding: "1rem",
          borderRadius: "0.5rem",
          boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
          zIndex: 50
        }}>
          Organization information updated successfully!
        </div>
      )}
    </div>
  );
};

export default MiOrganizacion;
