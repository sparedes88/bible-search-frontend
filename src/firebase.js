import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import {
  getFirestore,
  enableIndexedDbPersistence,
  connectFirestoreEmulator,
  doc,
  onSnapshot,
  collection,
  setDoc,
  getDoc,
} from "firebase/firestore";
import { getStorage, connectStorageEmulator } from "firebase/storage";
import { getAnalytics } from "firebase/analytics";
import { getDatabase, connectDatabaseEmulator } from "firebase/database";
import { getMessaging, getToken, onMessage } from "firebase/messaging";

// Debug logger with timestamp
const debugLog = (message) => {
  console.log(`[Firebase Debug] ${new Date().toISOString()}: ${message}`);
};

// Environment detection
const isLocal = false; // Change this to false to prevent forced offline mode

const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
  measurementId: process.env.REACT_APP_FIREBASE_MEASUREMENT_ID,
  databaseURL: isLocal
    ? "http://localhost:9000"
    : process.env.REACT_APP_FIREBASE_DATABASE_URL,
};

// Debug: Log the Firebase configuration
console.log("Firebase Config Debug:", {
  apiKey: firebaseConfig.apiKey ? "✓ Set" : "✗ Missing",
  authDomain: firebaseConfig.authDomain ? "✓ Set" : "✗ Missing",
  projectId: firebaseConfig.projectId ? "✓ Set" : "✗ Missing",
  storageBucket: firebaseConfig.storageBucket ? "✓ Set" : "✗ Missing",
  messagingSenderId: firebaseConfig.messagingSenderId ? "✓ Set" : "✗ Missing",
  appId: firebaseConfig.appId ? "✓ Set" : "✗ Missing",
  measurementId: firebaseConfig.measurementId ? "✓ Set" : "✗ Missing",
  databaseURL: firebaseConfig.databaseURL ? "✓ Set" : "✗ Missing",
});

// Initialize Firebase
debugLog("Initializing Firebase");
const app = initializeApp(firebaseConfig);

// Initialize services
const auth = getAuth(app);
const db = getFirestore(app);

// Explicitly set the storage bucket URL to ensure it's using the right one
const storage = getStorage(app, firebaseConfig.storageBucket);
console.log("Firebase storage bucket:", firebaseConfig.storageBucket);

const database = getDatabase(app);
const messaging = getMessaging(app);
let analytics = null;

// Initialize Firebase with proper error handling
const initializeFirebase = async () => {
  try {
    // Initialize Analytics only in production
    if (!isLocal) {
      analytics = getAnalytics(app);
      debugLog("Analytics initialized");
    }

    // Connect to emulators in development
    if (isLocal) {
      connectAuthEmulator(auth, "http://localhost:9099", {
        disableWarnings: true,
      });
      connectFirestoreEmulator(db, "localhost", 8080);
      connectStorageEmulator(storage, "localhost", 9199);
      connectDatabaseEmulator(database, "localhost", 9000);
      debugLog("Connected to local emulators");
    }

    // Enable offline persistence with retry logic
    try {
      await enableIndexedDbPersistence(db);
      debugLog("Multi-tab persistence enabled");
    } catch (err) {
      if (err.code === "failed-precondition") {
        debugLog("Multiple tabs open, persistence enabled in another tab");
      } else if (err.code === "unimplemented") {
        debugLog("Browser doesn't support persistence");
      } else {
        throw err;
      }
    }

    // Set up connection monitoring
    const connectedRef = doc(db, ".info/connected");
    onSnapshot(
      connectedRef,
      (snap) => {
        const isConnected = snap.exists() && snap.data()?.connected;
        debugLog(
          `Connection state: ${isConnected ? "Connected" : "Disconnected"}`
        );
      },
      (error) => debugLog(`Connection monitoring error: ${error.message}`)
    );
  } catch (error) {
    debugLog(`Firebase initialization error: ${error.message}`);
    console.error("Firebase initialization failed:", error);
    throw error;
  }
};

// Collection helpers
const getCoursesCollection = () => collection(db, "courses");
const getCategoriesCollection = () => collection(db, "categories");

// Initialize Firebase services
initializeFirebase().catch(console.error);

export {
  auth,
  db,
  storage,
  analytics,
  database,
  messaging,
  getCoursesCollection,
  getCategoriesCollection,
  debugLog as firebaseDebug,
  isLocal,
};

// Function to request notification permission and save FCM token
export const requestForToken = async () => {
  try {
    // Check if browser supports notifications
    if (!("Notification" in window)) {
      console.log("This browser does not support desktop notification");
      return null;
    }
    
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      try {
        // Get the token, using the VAPID key from Firebase Console
        const token = await getToken(messaging, {
          vapidKey: process.env.REACT_APP_FIREBASE_VAPID_KEY || "BKTjXq4_hJ1kNUZ0WWKXuScwgrio4oqWBX9gWY5c74qIBd7CPmEXvItuxWBTs7aEnrgtv_HkCmt5TAvlrNm3U1s",
        });

        console.log("FCM Token successfully generated");
        
        // Only try to save token if user is authenticated
        if (auth.currentUser) {
          try {
            // Save the token to Firestore under user's document
            const userRef = doc(db, "users", auth.currentUser.uid);
            await setDoc(userRef, { fcmToken: token }, { merge: true });
          } catch (saveError) {
            // Non-blocking error - just log it and continue
            console.warn("Could not save FCM token to user document:", saveError.message);
          }
        }
        
        return token;
      } catch (tokenError) {
        console.warn("Error generating FCM token:", tokenError.message);
        return null;
      }
    } else {
      console.warn("Push notifications permission denied by user.");
      return null;
    }
  } catch (error) {
    console.warn("Error requesting notification permission:", error.message);
    return null;
  }
};

// Listen for foreground messages
export const onMessageListener = () => {
  return new Promise((resolve) => {
    onMessage(messaging, (payload) => {
      console.log("Foreground Notification:", payload);
      resolve(payload);
    });
  });
};

// Leica project config helpers
/**
 * Save Leica project config and optionally upload the associated file to Firebase Storage.
 * @param {string} projectName - The project name (used as Firestore doc ID and storage folder)
 * @param {object} config - The config object to save (column selections, codeCol, visibleCodes, etc.)
 * @param {File|Blob|null} file - The file to upload (optional)
 * @param {string} fileName - The file name (required if file is provided)
 * @returns {Promise<void>}
 */
export const saveLeicaProjectConfig = async (projectName, config, file = null, fileName = "") => {
  if (!projectName) throw new Error("Project name required");
  const ref = doc(db, "leicaProjects", projectName);

  let fileUrl = config.fileUrl || null;
  let savedFileName = config.fileName || null;

  if (file && fileName) {
    // Upload file to Storage under leicaProjects/{projectName}/{fileName}
    const storageRef = storage.ref ? storage.ref() : storage; // compat or modular
    const filePath = `leicaProjects/${projectName}/${fileName}`;
    const fileRef = storageRef.child ? storageRef.child(filePath) : storageRef._location ? storageRef : storageRef.child(filePath); // compat or modular fallback
    // Modular SDK
    let uploadTask, url;
    try {
      if (typeof storageRef.uploadBytes === "function") {
        // Modular
        const { ref: sRef, uploadBytes, getDownloadURL } = await import("firebase/storage");
        const modularRef = sRef(storage, filePath);
        await uploadBytes(modularRef, file);
        url = await getDownloadURL(modularRef);
      } else {
        // Compat
        await fileRef.put(file);
        url = await fileRef.getDownloadURL();
      }
      fileUrl = url;
      savedFileName = fileName;
    } catch (err) {
      debugLog(`File upload failed: ${err.message}`);
      throw err;
    }
  }

  // Save config with fileUrl and fileName
  await setDoc(ref, { ...config, fileUrl, fileName: savedFileName }, { merge: true });
};

export const loadLeicaProjectConfig = async (projectName) => {
  if (!projectName) throw new Error("Project name required");
  const ref = doc(db, "leicaProjects", projectName);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return snap.data();
};
