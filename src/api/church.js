import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  where,
} from "@firebase/firestore";
import { getDownloadURL, getStorage, ref } from "firebase/storage";
import { db } from "../firebase";

export const getChurchData = async (id) => {
  try {
    const db = getFirestore();
    const storage = getStorage();

    // Fetch church data from Firestore
    const churchRef = doc(db, "churches", id);
    const churchSnap = await getDoc(churchRef);
    const churchData = churchSnap.data();

    if (!churchData) {
      console.log("No church found!");
      return null;
    }

    // Fetch downloadable URLs for logo and banner
    const logoURL = churchData.logo
      ? await getDownloadURL(ref(storage, churchData.logo))
      : null;
    const bannerURL = churchData.banner
      ? await getDownloadURL(ref(storage, churchData.banner))
      : null;

    // Return modified church data with logo and banner URLs
    return {
      ...churchData,
      id: churchSnap.id,
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
