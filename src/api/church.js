import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  where,
} from "firebase/firestore";
import { getDownloadURL, ref } from "firebase/storage";
import { db, storage } from "../firebase";

const getChurchDisplayName = (churchData = {}) => (
  churchData.nombre
  || churchData.name
  || churchData.churchName
  || churchData.organizationName
  || churchData.orgName
  || ""
);

const getChurchAssetCandidate = (churchData = {}, field) => {
  if (field === "logo") {
    return churchData.logo
      || churchData.Logo
      || churchData.logoUrl
      || churchData.logoURL
      || churchData.churchLogo
      || null;
  }

  if (field === "banner") {
    return churchData.banner
      || churchData.Banner
      || churchData.bannerUrl
      || churchData.bannerURL
      || churchData.churchBanner
      || null;
  }

  return null;
};

const buildFirebaseStorageMediaUrl = (assetPath) => {
  const normalizedPath = String(assetPath || "").trim().replace(/^\//, "");
  if (!normalizedPath) return null;
  return `https://firebasestorage.googleapis.com/v0/b/igletechv1.firebasestorage.app/o/${encodeURIComponent(normalizedPath)}?alt=media`;
};

const resolveChurchAssetUrl = async (assetValue) => {
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

  if (!storage) {
    return rawValue.startsWith("/") ? buildFirebaseStorageMediaUrl(rawValue) : rawValue;
  }

  if (rawValue.startsWith("gs://")) {
    try {
      return await getDownloadURL(ref(storage, rawValue));
    } catch (error) {
      console.warn("Failed to resolve church asset from gs path:", error.message);
    }
  }

  const storagePath = rawValue.startsWith("/") ? rawValue.slice(1) : rawValue;
  if (storagePath) {
    try {
      return await getDownloadURL(ref(storage, storagePath));
    } catch (error) {
      console.warn("Failed to resolve church asset from storage path:", error.message);
    }
  }

  if (rawValue.startsWith("/")) {
    return buildFirebaseStorageMediaUrl(rawValue);
  }

  return rawValue;
};

export const getChurchData = async (id) => {
  try {
    // Fetch church data from Firestore
    const churchRef = doc(db, "churches", id);
    const churchSnap = await getDoc(churchRef);
    const churchData = churchSnap.data();

    if (!churchData) {
      console.log("No church found!");
      return null;
    }

    // Fetch downloadable URLs for logo and banner
    const [logoURL, bannerURL] = await Promise.all([
      resolveChurchAssetUrl(getChurchAssetCandidate(churchData, "logo")),
      resolveChurchAssetUrl(getChurchAssetCandidate(churchData, "banner")),
    ]);

    // Return modified church data with logo and banner URLs
    return {
      ...churchData,
      id: churchSnap.id,
      name: getChurchDisplayName(churchData),
      churchName: getChurchDisplayName(churchData),
      logo: logoURL,
      banner: bannerURL,
    };
  } catch (error) {
    console.error("Error fetching church data:", error);
    return null;
  }
};

export const fetchGroupList = async (churchId) => {
  try {
    const groupsQuery = query(
      collection(db, "groups"),
      where("churchId", "==", churchId)
    );
    const querySnapshot = await getDocs(groupsQuery);
    const groupsList = querySnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    return groupsList;
  } catch (error) {
    console.error("Error fetching groups:", error);
  }
};

export const fetchUserById = async (userId) => {
  try {
    const userRef = doc(db, "users", userId);
    const userSnap = await getDoc(userRef);
    
    if (!userSnap.exists()) {
      console.log("No user found with this ID!");
      return null;
    }

    return {
      uid: userSnap.id,
      ...userSnap.data()
    };
  } catch (error) {
    console.error("Error fetching user:", error);
    return null;
  }
};

/**
 * Sends leadership data to OpenAI for analysis and returns leadership recommendations
 * @param {Object} data - The data containing members and visitors to analyze
 * @param {string} prompt - The prompt to send to OpenAI
 * @returns {Promise<Object>} - The analyzed leadership data
 */
export const analyzeLeadership = async (data, prompt) => {
  try {
    const response = await fetch('/api/analyze-leadership', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ data, prompt }),
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error analyzing leadership:', error);
    throw error;
  }
};

/**
 * Sends location data to OpenAI for analysis and returns location recommendations
 * @param {Object} data - The data containing member and visitor locations to analyze
 * @param {string} prompt - The prompt to send to OpenAI
 * @returns {Promise<Object>} - The analyzed location data
 */
export const analyzeLocations = async (data, prompt) => {
  try {
    const response = await fetch('/api/analyze-locations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ data, prompt }),
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error analyzing locations:', error);
    throw error;
  }
};

/**
 * Analyzes form entries using AI for pastoral insights
 * @param {string} formTitle - The title of the form
 * @param {Array} fields - The form fields
 * @param {Array} entries - The form entries
 * @param {Object} pastoralContext - Pastor's context and questions
 * @param {Object} previousAnalysis - Previous analysis for comparison
 * @returns {Promise<Object>} - The AI analysis results
 */
export const analyzeFormEntries = async (formTitle, fields, entries, pastoralContext = null, previousAnalysis = null) => {
  try {
    const response = await fetch('https://us-central1-igletechv1.cloudfunctions.net/analyzeFormEntries', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        formTitle,
        fields,
        entries,
        pastoralContext,
        previousAnalysis
      }),
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error analyzing form entries:', error);
    throw error;
  }
};
