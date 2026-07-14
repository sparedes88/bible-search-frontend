import React, { Suspense, useEffect, useState } from "react";
import {
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence
} from "firebase/auth";
import { getDownloadURL, ref } from "firebase/storage";
import { auth, db, storage } from "../firebase";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { doc, getDoc, collection, query, where, getDocs, limit, setDoc } from "firebase/firestore";
import "react-loading-skeleton/dist/skeleton.css";
import commonStyles from "../pages/commonStyles";
import "../styles/LoginStyles.css";
import "./Register.css";
import {
  decodeSwitchPassword,
  encodeSwitchPassword,
  getSwitchAccountsForOrganization,
  removeSwitchAccountForOrganization,
  saveSwitchAccountForOrganization,
} from "../utils/accountSwitching";

const ChurchHeader = React.lazy(() => import("./ChurchHeader"));
const IGLESIA_TECH_API_BASE_URL = "https://iglesia-tech-api.e2api.com";

const getBrandLogoCandidate = (brand = {}) => (
  brand?.logo
  || brand?.Logo
  || brand?.logoUrl
  || brand?.logoURL
  || brand?.churchLogo
  || brand?.brandLogo
  || brand?.image
  || brand?.imageUrl
  || brand?.imageURL
  || brand?.icon
  || brand?.iconUrl
  || brand?.files?.[0]?.url
  || brand?.attachments?.[0]?.url
  || brand?.documents?.[0]?.url
  || null
);

const getBrandDisplayName = (brand = {}, index = 0) => (
  brand?.name
  || brand?.nombre
  || brand?.brand
  || brand?.title
  || `Brand ${index + 1}`
);

const buildApiAssetUrl = (assetPath) => {
  const normalizedPath = String(assetPath || "").trim();
  if (!normalizedPath) return null;
  return normalizedPath.startsWith("/")
    ? `${IGLESIA_TECH_API_BASE_URL}${normalizedPath}`
    : `${IGLESIA_TECH_API_BASE_URL}/${normalizedPath}`;
};

const buildFirebaseStorageMediaUrl = (assetPath) => {
  const normalizedPath = String(assetPath || "").trim().replace(/^\//, "");
  if (!normalizedPath) return null;
  return `https://firebasestorage.googleapis.com/v0/b/igletechv1.firebasestorage.app/o/${encodeURIComponent(normalizedPath)}?alt=media`;
};

const isLikelyApiRelativePath = (pathValue) => {
  const normalizedPath = String(pathValue || "").trim();
  if (!normalizedPath) return false;
  return /^(\/?)(image_server|uploads|images|media)\//i.test(normalizedPath);
};

const normalizeOrganizationId = (value) => {
  if (value === null || value === undefined) return null;

  if (typeof value === "string" || typeof value === "number") {
    const normalized = String(value).trim();
    return normalized || null;
  }

  if (typeof value === "object") {
    const objectId = value.id
      || value.churchId
      || value.churchID
      || value.organizationId
      || value.organizationID
      || value.value
      || null;

    if (objectId === null || objectId === undefined) return null;
    const normalized = String(objectId).trim();
    return normalized || null;
  }

  return null;
};

const collectOrganizationIdsFromUserData = (userData = {}) => {
  const ids = new Set();

  const singleValueCandidates = [
    userData?.churchId,
    userData?.churchID,
    userData?.organizationId,
    userData?.organizationID,
    userData?.orgId,
    userData?.defaultChurchId,
    userData?.defaultOrganizationId,
  ];

  singleValueCandidates
    .map((value) => normalizeOrganizationId(value))
    .filter(Boolean)
    .forEach((value) => ids.add(value));

  const listCandidates = [
    userData?.churchIds,
    userData?.churchIDs,
    userData?.organizationIds,
    userData?.organizationIDs,
    userData?.organizations,
    userData?.churches,
    userData?.accessibleOrganizations,
    userData?.allowedOrganizations,
    userData?.allowedChurchIds,
    userData?.allowedOrganizationIds,
  ];

  listCandidates.forEach((candidate) => {
    if (!Array.isArray(candidate)) return;

    candidate
      .map((value) => normalizeOrganizationId(value))
      .filter(Boolean)
      .forEach((value) => ids.add(value));
  });

  return Array.from(ids);
};

const collectStrings = (value, out = []) => {
  if (value === null || value === undefined) return out;

  if (
    typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean"
  ) {
    out.push(String(value));
    return out;
  }

  if (Array.isArray(value)) {
    value.forEach((entry) => collectStrings(entry, out));
    return out;
  }

  if (typeof value === "object") {
    Object.keys(value).forEach((key) => collectStrings(value[key], out));
    return out;
  }

  try {
    out.push(String(value));
  } catch (error) {
    // Ignore non-stringable values.
  }

  return out;
};

const matchesBrandReference = (churchData = {}, brandData = {}) => {
  const churchBrandRaw = churchData?.brand
    || churchData?.brandId
    || churchData?.brand_id
    || churchData?.brands
    || null;

  const churchTokens = collectStrings(churchBrandRaw)
    .map((token) => token.toLowerCase().trim())
    .filter(Boolean);

  if (churchTokens.length === 0) {
    return false;
  }

  const brandTokens = collectStrings([
    brandData?.id,
    brandData?.name,
    brandData?.nombre,
    brandData?.brand,
    brandData?.title,
  ])
    .map((token) => token.toLowerCase().trim())
    .filter(Boolean);

  if (brandTokens.length === 0) {
    return false;
  }

  return churchTokens.some((churchToken) =>
    brandTokens.some((brandToken) =>
      churchToken === brandToken
      || churchToken.includes(brandToken)
      || brandToken.includes(churchToken)
    )
  );
};

const resolveBrandLogoUrl = async (assetValue) => {
  if (!assetValue) return null;

  const rawValue = String(assetValue).trim();
  if (!rawValue) return null;

  if (
    rawValue.startsWith("http://")
    || rawValue.startsWith("https://")
    || rawValue.startsWith("data:")
    || rawValue.startsWith("blob:")
    || rawValue.startsWith("/img/")
  ) {
    return rawValue;
  }

  if (isLikelyApiRelativePath(rawValue)) {
    return buildApiAssetUrl(rawValue);
  }

  if (rawValue.startsWith("gs://") && storage) {
    try {
      return await getDownloadURL(ref(storage, rawValue));
    } catch (error) {
      console.warn("Failed to resolve brand logo from gs path:", error.message);
    }
  }

  if (storage && !rawValue.startsWith("/")) {
    try {
      return await getDownloadURL(ref(storage, rawValue));
    } catch (error) {
      // Continue to other fallbacks.
    }
  }

  if (rawValue.startsWith("/")) {
    if (isLikelyApiRelativePath(rawValue)) {
      return buildApiAssetUrl(rawValue);
    }
    return buildFirebaseStorageMediaUrl(rawValue);
  }

  return rawValue;
};

const Login = () => {
  const MAX_COOLDOWN_SECONDS = 120;
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [retryCount, setRetryCount] = useState(0);
  const [resetEmailSent, setResetEmailSent] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loginDisabled, setLoginDisabled] = useState(false);
  const [cooldownTime, setCooldownTime] = useState(0);
  const [rememberMe, setRememberMe] = useState(true);
  const [providerDisabled, setProviderDisabled] = useState(false);
  const [brandLogos, setBrandLogos] = useState([]);
  const [switchAccounts, setSwitchAccounts] = useState([]);
  const [useForSwitching, setUseForSwitching] = useState(true);
  const [showAccessRecovery, setShowAccessRecovery] = useState(false);
  const [accessibleOrganizations, setAccessibleOrganizations] = useState([]);
  const [isResolvingAccessOptions, setIsResolvingAccessOptions] = useState(false);
  const safeCooldownTime = Number.isFinite(cooldownTime)
    ? Math.max(0, Math.min(Math.floor(cooldownTime), MAX_COOLDOWN_SECONDS))
    : 0;
  
  // Extract return URL from query parameters if present
  const urlParams = new URLSearchParams(location.search);
  const returnUrl = urlParams.get('returnUrl');
  const isSwitchUserFlow = urlParams.get("switchUser") === "1";

  const clearAccessRecoveryState = () => {
    setShowAccessRecovery(false);
    setAccessibleOrganizations([]);
    setIsResolvingAccessOptions(false);
  };

  const getOrganizationAccessList = async (userData = {}) => {
    const normalizedRole = String(userData?.role || "").trim().toLowerCase();
    if (["global_admin", "system_global_admin"].includes(normalizedRole)) {
      const churchesSnapshot = await getDocs(collection(db, "churches"));
      return churchesSnapshot.docs.map((organizationDoc) => ({
        id: organizationDoc.id,
        ...organizationDoc.data(),
      }));
    }

    const organizationIds = collectOrganizationIdsFromUserData(userData);
    if (organizationIds.length === 0) {
      return [];
    }

    const organizations = await Promise.all(
      organizationIds.map(async (organizationId) => {
        try {
          const organizationSnap = await getDoc(doc(db, "churches", String(organizationId)));
          if (!organizationSnap.exists()) return null;

          return {
            id: organizationSnap.id,
            ...organizationSnap.data(),
          };
        } catch (readError) {
          return null;
        }
      })
    );

    return organizations.filter(Boolean);
  };

  const handlePermissionDeniedAccess = async (userData = {}, deniedMessage) => {
    setShowAccessRecovery(true);
    setError(`❌ ${deniedMessage}`);
    setIsResolvingAccessOptions(true);

    try {
      const organizations = await getOrganizationAccessList(userData);
      const filteredOrganizations = organizations.filter(
        (organization) => String(organization?.id || "") !== String(id || "")
      );
      setAccessibleOrganizations(filteredOrganizations);
    } catch (orgError) {
      console.error("Error resolving accessible organizations:", orgError);
      setAccessibleOrganizations([]);
    } finally {
      setIsResolvingAccessOptions(false);
    }
  };

  const handleRequestPermission = () => {
    navigate(`/organization/${id}/register?requestAccess=1`);
  };

  const handleSwitchOrganization = (nextOrganizationId) => {
    if (!nextOrganizationId) return;
    navigate(`/organization/${nextOrganizationId}/mi-organizacion`);
  };

  const getOrganizationLabel = (organization = {}) => {
    return (
      organization?.nombre
      || organization?.name
      || organization?.organizationName
      || organization?.churchName
      || organization?.title
      || `Organization ${organization?.id || ""}`
    );
  };

  useEffect(() => {
    clearAccessRecoveryState();
  }, [id]);

  useEffect(() => {
    if (!id) {
      setSwitchAccounts([]);
      return;
    }

    setSwitchAccounts(getSwitchAccountsForOrganization(id));
  }, [id]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setError(null);
    };

    const handleOffline = () => {
      setIsOnline(false);
      setError("❌ No internet connection - Please check your connection");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Cooldown timer for rate limiting
  useEffect(() => {
    let timer;
    if (loginDisabled && safeCooldownTime > 0) {
      timer = setInterval(() => {
        setCooldownTime(prevTime => {
          const normalizedPrevTime = Number.isFinite(prevTime)
            ? Math.max(0, Math.min(Math.floor(prevTime), MAX_COOLDOWN_SECONDS))
            : 0;

          if (normalizedPrevTime <= 1) {
            clearInterval(timer);
            setLoginDisabled(false);
            return 0;
          }
          return normalizedPrevTime - 1;
        });
      }, 1000);
    } else if (loginDisabled && safeCooldownTime <= 0) {
      setLoginDisabled(false);
    }
    return () => clearInterval(timer);
  }, [loginDisabled, safeCooldownTime]);

  useEffect(() => {
    let isMounted = true;

    const loadOrganizationBrandLogos = async () => {
      if (!id) {
        if (isMounted) setBrandLogos([]);
        return;
      }

      const dedupeByUrl = (brands = []) => {
        const seen = new Set();
        return brands.filter((brandItem) => {
          const normalizedUrl = String(brandItem?.url || "").trim();
          if (!normalizedUrl || seen.has(normalizedUrl)) {
            return false;
          }
          seen.add(normalizedUrl);
          return true;
        });
      };

      try {
        const churchSnap = await getDoc(doc(db, "churches", String(id)));
        const churchData = churchSnap.exists() ? (churchSnap.data() || {}) : {};
        let resolvedLogos = [];

        try {
          const brandsQuery = query(collection(db, `churches/${id}/brands`), limit(36));
          const brandsSnapshot = await getDocs(brandsQuery);

          const brandItems = await Promise.all(
            brandsSnapshot.docs.map(async (docSnap, index) => {
              const data = docSnap.data() || {};
              const logoUrl = await resolveBrandLogoUrl(getBrandLogoCandidate(data));
              if (!logoUrl) return null;

              return {
                id: docSnap.id,
                name: getBrandDisplayName(data, index),
                url: logoUrl,
              };
            })
          );

          resolvedLogos = brandItems.filter(Boolean);
        } catch (subcollectionError) {
          console.warn("Could not load churches/{id}/brands logos:", subcollectionError?.message || subcollectionError);
        }

        // Fallback 1: global brands mapped by church brand reference.
        if (resolvedLogos.length === 0 && churchData) {
          try {
            const globalBrandsSnapshot = await getDocs(query(collection(db, "brands"), limit(120)));
            const matchingGlobalBrands = globalBrandsSnapshot.docs
              .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }))
              .filter((brandDoc) => matchesBrandReference(churchData, brandDoc));

            const globalBrandItems = await Promise.all(
              matchingGlobalBrands.map(async (brandDoc, index) => {
                const logoUrl = await resolveBrandLogoUrl(getBrandLogoCandidate(brandDoc));
                if (!logoUrl) return null;

                return {
                  id: brandDoc.id || `global-brand-${index}`,
                  name: getBrandDisplayName(brandDoc, index),
                  url: logoUrl,
                };
              })
            );

            resolvedLogos = globalBrandItems.filter(Boolean);
          } catch (globalBrandsError) {
            console.warn("Could not load global brands fallback:", globalBrandsError?.message || globalBrandsError);
          }
        }

        // Fallback 2: church-level logo if no brand row is readable yet.
        if (resolvedLogos.length === 0 && churchData) {
          const churchLogoUrl = await resolveBrandLogoUrl(
            churchData?.brandLogo
            || churchData?.logo
            || churchData?.Logo
            || null
          );

          if (churchLogoUrl) {
            resolvedLogos = [{
              id: "church-brand-fallback",
              name: getBrandDisplayName(churchData, 0),
              url: churchLogoUrl,
            }];
          }
        }

        if (isMounted) {
          setBrandLogos(dedupeByUrl(resolvedLogos).slice(0, 18));
        }
      } catch (brandError) {
        console.warn("Could not load organization brand logos:", brandError);
        if (isMounted) setBrandLogos([]);
      }
    };

    loadOrganizationBrandLogos();

    return () => {
      isMounted = false;
    };
  }, [id]);

  // Check if input is an email or phone number
  const isEmail = (value) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(value);
  };

  // Format phone number for consistency
  const formatPhoneNumber = (value) => {
    if (!value) return value;
    
    // Remove all non-digits
    const digitsOnly = value.replace(/[^\d]/g, "");
    
    if (digitsOnly.length === 11 && digitsOnly.charAt(0) === '1') {
      return digitsOnly.substring(1);
    }
    
    return digitsOnly;
  };

  const checkIfAdminEmail = (email) => {
    const emailLower = email.toLowerCase();
    return emailLower.includes("admin") ||
           emailLower.endsWith("@iglesiatech.app") ||
           emailLower.endsWith("@churchadmin.app");
  };

  const refreshSwitchAccounts = () => {
    if (!id) return;
    setSwitchAccounts(getSwitchAccountsForOrganization(id));
  };

  const rememberAccountForSwitching = async (
    identifierUsedForLogin,
    resolvedEmail,
    uid,
    rawPassword
  ) => {
    if (!id || !useForSwitching) return;

    const passwordCipher = await encodeSwitchPassword(rawPassword);

    saveSwitchAccountForOrganization(id, {
      identifier: identifierUsedForLogin,
      email: resolvedEmail,
      uid,
      passwordCipher,
      passwordUpdatedAt: Date.now(),
      lastUsedAt: Date.now(),
    });
    refreshSwitchAccounts();
  };

  const handleRemoveSwitchAccount = (identifierToRemove) => {
    removeSwitchAccountForOrganization(id, identifierToRemove);
    refreshSwitchAccounts();
  };

  const handleQuickSwitchLogin = async (account) => {
    if (!account?.identifier || loginDisabled || loading) {
      return;
    }

    setIdentifier(account.identifier);
    setError("");
    clearAccessRecoveryState();

    if (!isOnline) {
      setError("❌ No internet connection - Please check your connection");
      return;
    }

    if (providerDisabled) {
      setError("❌ Email/password sign-in is disabled in Firebase for this project. Enable it in Authentication > Sign-in method.");
      return;
    }

    const restoredPassword = await decodeSwitchPassword(account.passwordCipher);
    if (!restoredPassword) {
      setPassword("");
      setError("Please enter password once for this account, then it can switch automatically next time.");
      return;
    }

    setLoading(true);

    try {
      await setPersistence(auth, browserLocalPersistence);

      const userCredential = await signInWithEmailAndPassword(
        auth,
        String(account.email || account.identifier).trim(),
        restoredPassword
      );

      if (useForSwitching) {
        await rememberAccountForSwitching(
          account.identifier,
          String(account.email || account.identifier).trim(),
          userCredential?.user?.uid,
          restoredPassword
        );
      }

      const isAdminEmail = checkIfAdminEmail(String(account.email || account.identifier));
      if (isAdminEmail) {
        if (returnUrl) {
          navigate(returnUrl);
        } else {
          navigate(`/organization/${id}/mi-organizacion`);
        }
      } else {
        await checkUserChurchAccess(userCredential.user.uid);
      }
    } catch (err) {
      handleAuthError(err);
    } finally {
      setLoading(false);
    }
  };

  const findUserByPhone = async (formattedPhone) => {
    try {
      const usersRef = collection(db, "users");
      let foundUser = null;
      
      const phoneFields = ["phone", "phoneNumber", "mobilePhone"];
      
      for (const field of phoneFields) {
        if (foundUser) break;
        
        const q = query(usersRef, where(field, "==", formattedPhone), limit(1));
        const querySnapshot = await getDocs(q);
        
        if (!querySnapshot.empty) {
          foundUser = {
            ...querySnapshot.docs[0].data(),
            id: querySnapshot.docs[0].id
          };
        }
      }
      
      return foundUser;
    } catch (err) {
      console.error("Phone lookup error:", err);
      return null;
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    let shouldClearPassword = false;
    
    // Clear previous errors
    setError("");
    clearAccessRecoveryState();
    
    if (!isOnline) {
      setError("❌ No internet connection - Please check your connection");
      return;
    }

    if (!identifier || !password) {
      setError("Please enter your email/phone and password");
      return;
    }

    if (providerDisabled) {
      setError("❌ Email/password sign-in is disabled in Firebase for this project. Enable it in Authentication > Sign-in method.");
      return;
    }

    if (loginDisabled) {
      setError(`❌ Too many attempts. Please wait ${safeCooldownTime} seconds.`);
      return;
    }

    setLoading(true);
    
    try {
      // Set persistence based on rememberMe checkbox
      await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);
      
      // We'll always use Firebase Authentication directly
      try {
        // If identifier is an email, use it directly
        // If it's a phone number, we'll look up the email first
        let loginEmail = identifier;
        
        // If it's not an email (likely a phone number), try to find matching user
        if (!isEmail(identifier)) {
          const foundUser = await findUserByPhone(formatPhoneNumber(identifier));
          if (!foundUser) {
            setError("❌ No account was found with this phone number");
            setLoading(false);
            return;
          }
          
          if (!foundUser.email) {
            setError("❌ The account found does not have an email associated");
            setLoading(false);
            return;
          }
          
          loginEmail = foundUser.email;
        }
        
        // Now we have an email (either directly or from phone lookup)
        // Proceed with Firebase Auth login
        const userCredential = await signInWithEmailAndPassword(
          auth,
          loginEmail.trim(),
          password
        );
        shouldClearPassword = true;

        await rememberAccountForSwitching(
          identifier,
          loginEmail.trim(),
          userCredential?.user?.uid,
          password
        );
        
        // Check user access
        const user = userCredential.user;
        
        // Special handling for global admin emails
        const isAdminEmail = checkIfAdminEmail(loginEmail);
        
        // For admin emails, skip checking Firestore
        if (isAdminEmail) {
          console.log("Admin email detected, bypassing Firestore check");
          
          // Redirect to return URL if it exists, otherwise to profile
          if (returnUrl) {
            navigate(returnUrl);
          } else {
            navigate(`/organization/${id}/mi-organizacion`);
          }
        } else {
          // Normal user - check church access in Firestore
          await checkUserChurchAccess(user.uid);
        }
      } catch (err) {
        handleAuthError(err);
      }
    } catch (err) {
      console.error("Login error:", err);
      handleAuthError(err);
    } finally {
      if (shouldClearPassword) {
        setPassword("");
      }
      setLoading(false);
    }
  };

  // Centralized error handler
  const handleAuthError = (err) => {
    const expectedAuthCodes = new Set([
      "auth/network-request-failed",
      "auth/user-not-found",
      "auth/invalid-credential",
      "auth/wrong-password",
      "auth/too-many-requests",
      "auth/user-disabled",
      "auth/invalid-email",
      "auth/operation-not-allowed",
    ]);

    if (expectedAuthCodes.has(err?.code)) {
      console.warn(`Authentication handled error: ${err.code}`);
    } else {
      console.error("Authentication error:", err);
    }
    
    let errorMessage = "❌ ";
    let cooldown = 0;
    
    switch (err.code) {
      case "auth/network-request-failed":
        errorMessage += "Connection error. Please check your internet connection.";
        break;
      case "auth/user-not-found":
        errorMessage += "User not found. Please verify your email or phone.";
        break;
      case "auth/invalid-credential":
        errorMessage += "Invalid credentials. Please verify your email/phone and password.";
        cooldown = 5; // Small cooldown to prevent brute force
        break;
      case "auth/wrong-password":
        errorMessage += "Incorrect password. Please try again.";
        cooldown = 5;
        break;
      case "auth/too-many-requests":
        errorMessage += "Too many attempts. Your account has been temporarily locked.";
        cooldown = 60; // 1 minute cooldown
        break;
      case "auth/user-disabled":
        errorMessage += "This account has been disabled. Contact the administrator.";
        break;
      case "auth/invalid-email":
        errorMessage += "Invalid email format.";
        break;
      case "auth/operation-not-allowed":
        errorMessage += "Email/password sign-in is not enabled in Firebase Auth for this project. Enable Email/Password in Authentication > Sign-in method.";
        setProviderDisabled(true);
        setLoginDisabled(false);
        setCooldownTime(0);
        break;
      default:
        errorMessage += err.message || "Unknown error. Please try again later.";
    }
    
    setError(errorMessage);
    
    // Implement cooldown if needed
    if (cooldown > 0 && !providerDisabled) {
      setLoginDisabled(true);
      setCooldownTime(Math.min(cooldown, MAX_COOLDOWN_SECONDS));
    }
    
    // Track retry count for network issues
    if (err.code === "auth/network-request-failed") {
      setRetryCount(prev => prev + 1);
    }
  };

  // Check user church access
  const checkUserChurchAccess = async (userId) => {
    const normalizeValue = (value) => String(value || "").trim().toLowerCase();
    const isPermissionDenied = (error) =>
      error?.code === "permission-denied" ||
      error?.code === "firestore/permission-denied";

    const navigateToAuthorizedArea = () => {
      localStorage.setItem("userChurchId", String(id || ""));
      if (returnUrl) {
        navigate(returnUrl);
      } else {
        navigate(`/organization/${id}/mi-organizacion`);
      }
    };

    try {
      const userRef = doc(db, "users", userId);
      let userDoc;

      try {
        userDoc = await getDoc(userRef);
      } catch (readError) {
        if (!isPermissionDenied(readError)) {
          throw readError;
        }

        // Force token refresh once before giving up; Firestore auth can lag immediately after sign-in.
        const authUser = auth.currentUser;
        if (authUser) {
          await authUser.getIdToken(true);
        }
        userDoc = await getDoc(userRef);
      }
      
      console.log("User document exists:", userDoc.exists());
      console.log("User ID being checked:", userId);
      
      if (userDoc.exists()) {
        const userData = userDoc.data();
        console.log("User data retrieved:", userData);

        const normalizedAccessStatus = String(
          userData?.accessStatus
          || userData?.approvalStatus
          || "approved"
        ).trim().toLowerCase();

        const requiresApproval = ["pending", "requested", "denied", "rejected"].includes(normalizedAccessStatus);

        if (requiresApproval) {
          if (normalizedAccessStatus === "denied" || normalizedAccessStatus === "rejected") {
            await handlePermissionDeniedAccess(
              userData,
              "Your access request was not approved yet. You can request permission again or switch organizations."
            );
            return;
          }

          await handlePermissionDeniedAccess(
            userData,
            "Your account is waiting for admin approval in this organization."
          );
          return;
        }

        const normalizedRole = normalizeValue(
          userData?.customRoleId ||
          userData?.customRole ||
          userData?.assignedRoleId ||
          userData?.role
        );
        const normalizedBaseRole = normalizeValue(
          userData?.baseRole ||
          userData?.basedOn ||
          userData?.roleBase ||
          userData?.systemRole ||
          userData?.role
        );

        const scopedChurchId = String(
          userData?.churchId ||
          userData?.churchID ||
          userData?.organizationId ||
          userData?.idIglesia ||
          ""
        ).trim();

        const hasAdminRole = ["global_admin", "system_global_admin", "admin", "system_admin"].includes(normalizedRole)
          || ["global_admin", "admin"].includes(normalizedBaseRole);
        const belongsToChurch = scopedChurchId && String(scopedChurchId) === String(id);

        // Check if user is admin/global admin, or matches organization scope.
        if (
          hasAdminRole ||
          belongsToChurch
        ) {
          navigateToAuthorizedArea();
        } else {
          await handlePermissionDeniedAccess(
            userData,
            "You do not have permission to access this organization."
          );
        }
      } else {
        // Special case: If the email indicates it's a admin or global admin
        // For example, if email contains admin or ends with specific domains
        const user = auth.currentUser;
        const email = user?.email || identifier;
        
        if (email) {
          const emailLower = email.toLowerCase();
          const isLikelyAdmin = emailLower.includes("admin") ||
                                emailLower.endsWith("@iglesiatech.app") ||
                                emailLower.endsWith("@churchadmin.app");
                                
          if (isLikelyAdmin) {
            console.log("This appears to be an admin account without a Firestore record");
            
            // For these special accounts, we'll grant access directly
            // We can't create the document due to permission issues, but we can let them in
            navigateToAuthorizedArea();
            return;
          }
        }
        
        // For normal users, we require a Firestore record
        await handlePermissionDeniedAccess(
          {},
          "This account is not linked to this organization yet. Request permission to continue."
        );
      }
    } catch (err) {
      console.error("Church access check error:", err);
      if (isPermissionDenied(err)) {
        // Last-resort fallback: route-level and Firestore rules still enforce data access.
        navigateToAuthorizedArea();
        return;
      }
      if (!showAccessRecovery) {
        setError(`❌ ${err.message}`);
      }
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!identifier) {
      setError("Please enter your email address first.");
      return;
    }

    if (!isEmail(identifier)) {
      setError("Please enter a valid email address to reset your password.");
      return;
    }

    try {
      setIsLoading(true);

      const configuredResetUrl = process.env.REACT_APP_AUTH_CONTINUE_URL?.trim();
      const originResetUrl = `${window.location.origin}/organization/${id}/login`;
      const authDomain = auth?.config?.authDomain || process.env.REACT_APP_FIREBASE_AUTH_DOMAIN;
      const fallbackResetUrl = authDomain ? `https://${authDomain}` : null;
      const primaryResetUrl = configuredResetUrl || originResetUrl;

      try {
        await sendPasswordResetEmail(auth, identifier.trim(), {
          url: primaryResetUrl,
          handleCodeInApp: false,
        });
      } catch (error) {
        if (error?.code === "auth/unauthorized-continue-uri" && fallbackResetUrl) {
          await sendPasswordResetEmail(auth, identifier.trim(), {
            url: fallbackResetUrl,
            handleCodeInApp: false,
          });
        } else {
          throw error;
        }
      }

      setResetEmailSent(true);
      setError(null);
      setTimeout(() => {
        setResetEmailSent(false);
      }, 5000);
    } catch (error) {
      console.error("Password reset error:", error);
      if (error?.code === "auth/unauthorized-continue-uri") {
        setError(
          "Could not send the email. This app domain is not authorized in Firebase Auth. Add the domain in Authorized domains or configure REACT_APP_AUTH_CONTINUE_URL."
        );
      } else {
        setError("Could not send the password reset email. Please verify your address.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="login-page-container"
      style={{
        ...commonStyles.fullWidthContainer,
        paddingLeft: 0,
        paddingRight: 0,
        overflowX: "hidden",
        margin: 0,
        backgroundColor: "transparent",
        boxShadow: "none",
        borderRadius: 0,
      }}
    >
      {/* Top actions */}
      <div className="login-top-actions">
        <div className="login-top-actions-inner">
          <button
            onClick={() => navigate('/')}
            style={commonStyles.backButton}
          >
            ⬅ Back
          </button>
        </div>
      </div>

      {id && (
        <Suspense fallback={<div style={{ minHeight: 120 }} />}>
          <ChurchHeader id={id} applyShadow={false} />
        </Suspense>
      )}

      {/* Network Status */}
      {!isOnline && (
        <div className="network-status offline">
          <span>📡 Offline</span>
        </div>
      )}

      {/* Login layout */}
      <div className="login-content-shell">
        <section className="login-intro-panel" aria-label="Access information">
          <p className="login-kicker">Secure Access</p>

          <h1 className="login-title">Welcome to your organization</h1>
          <p className="login-subtitle">
            Sign in to manage members, events, and church resources from a trusted workspace.
          </p>
          <ul className="login-benefits-list">
            <li>Email or phone authentication</li>
            <li>Optional persistent session on your device</li>
            <li>Fast password recovery</li>
          </ul>
        </section>

        <section className="login-card" aria-label="Sign-in form">
          <h2 className="login-card-title">Sign In</h2>
          <p className="login-card-subtitle">Use your credentials to continue</p>

          {isSwitchUserFlow && (
            <p className="login-alert login-alert-info">
              Tap a saved user below to switch instantly. Password is only needed for unsaved users.
            </p>
          )}

          {switchAccounts.length > 0 && (
            <div className="login-switch-accounts" aria-label="Quick switch users">
              <p className="login-switch-title">Recent users on this device</p>
              <div className="login-switch-grid">
                {switchAccounts.map((account) => {
                  const isSelected =
                    String(identifier || "").trim().toLowerCase()
                    === String(account.identifier || "").trim().toLowerCase();

                  return (
                    <div key={account.identifier} className="login-switch-item">
                      <button
                        type="button"
                        className={`login-switch-pick ${isSelected ? "is-selected" : ""}`}
                        onClick={() => handleQuickSwitchLogin(account)}
                        disabled={loginDisabled || loading}
                      >
                        <span className="login-switch-primary">{account.identifier}</span>
                        {!!account.email && account.email !== account.identifier && (
                          <span className="login-switch-secondary">{account.email}</span>
                        )}
                      </button>
                      <button
                        type="button"
                        className="login-switch-remove"
                        onClick={() => handleRemoveSwitchAccount(account.identifier)}
                        aria-label={`Remove ${account.identifier} from quick switch`}
                        disabled={loginDisabled}
                      >
                        Remove
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {error && <p className="login-alert login-alert-error">{error}</p>}

          {showAccessRecovery && (
            <div className="login-access-recovery" aria-live="polite">
              <p className="login-access-recovery-title">Need access to this organization?</p>
              <p className="login-access-recovery-text">
                Request permission from this organization admin, or switch to one you already have access to.
              </p>
              <button
                type="button"
                className="login-access-request-btn"
                onClick={handleRequestPermission}
                disabled={loading}
              >
                Request Permission
              </button>

              <div className="login-access-switch-list" aria-label="Accessible organizations">
                <p className="login-access-switch-title">Switch to an organization you can access</p>

                {isResolvingAccessOptions && (
                  <p className="login-access-switch-empty">Finding your available organizations...</p>
                )}

                {!isResolvingAccessOptions && accessibleOrganizations.length === 0 && (
                  <p className="login-access-switch-empty">
                    No additional organizations were found for this account yet.
                  </p>
                )}

                {!isResolvingAccessOptions && accessibleOrganizations.length > 0 && (
                  <div className="login-access-switch-grid">
                    {accessibleOrganizations.map((organization) => (
                      <button
                        key={organization.id}
                        type="button"
                        className="login-access-switch-item"
                        onClick={() => handleSwitchOrganization(organization.id)}
                      >
                        <span className="login-access-switch-name">
                          {getOrganizationLabel(organization)}
                        </span>
                        <span className="login-access-switch-id">ID: {organization.id}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {loginDisabled && safeCooldownTime > 0 && (
            <div className="login-alert login-alert-cooldown">
              Please wait {safeCooldownTime} seconds before trying again.
            </div>
          )}

          {retryCount >= 2 && (
            <div className="login-alert login-alert-warning">
              <p>We detected connection issues. Please:</p>
              <ul className="login-warning-list">
                <li>Check your internet connection</li>
                <li>Try again in a few moments</li>
                <li>If the issue continues, contact support</li>
              </ul>
            </div>
          )}

          {/* Email Login Form */}
          <form onSubmit={handleSubmit} className="login-form" noValidate>
            <input
              type="text"
              placeholder="Email or Phone Number"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              required
              className="form-field"
              disabled={loginDisabled}
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="form-field"
              disabled={loginDisabled}
            />
            
            <label className="login-remember" htmlFor="rememberMe">
              <input
                type="checkbox"
                id="rememberMe"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                disabled={loginDisabled}
              />
              <span>Keep me signed in</span>
            </label>

            <label className="login-remember" htmlFor="useForSwitching">
              <input
                type="checkbox"
                id="useForSwitching"
                checked={useForSwitching}
                onChange={(e) => setUseForSwitching(e.target.checked)}
                disabled={loginDisabled}
              />
              <span>Use this account for switching between users</span>
            </label>
            
            <button 
              type="submit" 
              className="loging-btn" 
              disabled={loading || loginDisabled}
            >
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>

          <button
            onClick={() => navigate(`/organization/${id}/register`)}
            className="login-secondary-action"
            disabled={loginDisabled}
          >
            Do not have an account? Register
          </button>

          {resetEmailSent ? (
            <p className="login-alert login-alert-success">
              ✅ Password reset email sent successfully!
            </p>
          ) : (
            <button
              onClick={handleForgotPassword}
              disabled={isLoading || loginDisabled}
              className="login-reset-link"
            >
              {isLoading
                ? "Sending email..."
                : "Forgot your password?"}
            </button>
          )}
        </section>
      </div>

      {brandLogos.length > 0 && (
        <div className="login-brand-row" aria-label="Organization brand logos">
          <div className="login-brand-strip login-brand-strip-bottom">
            {brandLogos.map((brand) => (
              <div key={brand.id} className="login-brand-logo-item" title={brand.name}>
                <img
                  src={brand.url}
                  alt={`${brand.name} logo`}
                  className="login-brand-logo-image"
                  loading="lazy"
                  onError={(event) => {
                    event.currentTarget.style.display = "none";
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default Login;
