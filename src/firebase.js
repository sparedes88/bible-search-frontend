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

// Initialize storage with better error handling - make it optional
let storage = null;
try {
  // Try to initialize storage with explicit bucket first
  if (firebaseConfig.storageBucket) {
    storage = getStorage(app, firebaseConfig.storageBucket);
    console.log("Firebase storage initialized with explicit bucket:", firebaseConfig.storageBucket);
  } else {
    // Fallback to default bucket
    storage = getStorage(app);
    console.log("Firebase storage initialized with default bucket");
  }
} catch (error) {
  console.warn("Firebase storage initialization failed:", error.message);
  storage = null;
}

// If storage is still null, log a warning but don't crash
if (!storage) {
  console.warn("Firebase Storage is not available. File upload features will be disabled.");
}

// Lazy initialize database to avoid initialization errors
let databaseInstance = null;
const getDatabaseInstance = () => {
  if (!databaseInstance) {
    try {
      databaseInstance = getDatabase(app);
      console.log("Firebase database initialized successfully");
    } catch (error) {
      console.warn("Firebase Realtime Database is not available:", error.message);
      databaseInstance = null;
    }
  }
  return databaseInstance;
};

const database = getDatabaseInstance();
let analytics = null;

// Initialize Firebase with proper error handling
const initializeFirebase = async () => {
  try {
    // Connect to emulators in development first
    if (isLocal) {
      connectAuthEmulator(auth, "http://localhost:9099", {
        disableWarnings: true,
      });
      connectFirestoreEmulator(db, "localhost", 8080);
      if (storage) {
        connectStorageEmulator(storage, "localhost", 9199);
      }
      const databaseInstance = getDatabaseInstance();
      if (databaseInstance) {
        connectDatabaseEmulator(databaseInstance, "localhost", 9000);
      }
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

    // Initialize Analytics only in production and after everything else is set up
    if (!isLocal) {
      try {
        analytics = getAnalytics(app);
        debugLog("Analytics initialized");
      } catch (analyticsError) {
        debugLog(`Analytics initialization failed: ${analyticsError.message}`);
        analytics = null;
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

// Initialize Firebase services asynchronously (non-blocking)
// This allows the app to start faster
let firebaseInitialized = false;
const initPromise = initializeFirebase()
  .then(() => {
    firebaseInitialized = true;
    debugLog("Firebase initialization completed");
  })
  .catch((error) => {
    console.error("Firebase initialization failed:", error);
    // Don't throw - allow app to continue
  });

// Export initialization promise for components that need it
export const firebaseReady = () => initPromise;

export {
  auth,
  db,
  storage,
  analytics,
  getDatabaseInstance as database,
  getCoursesCollection,
  getCategoriesCollection,
  debugLog as firebaseDebug,
  isLocal,
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
    if (!storage) {
      throw new Error("Firebase storage is not available - file upload disabled");
    }

    // Upload file to Storage under leicaProjects/{projectName}/{fileName}
    const filePath = `leicaProjects/${projectName}/${fileName}`;

    try {
      // Modular SDK
      const { ref: sRef, uploadBytes, getDownloadURL } = await import("firebase/storage");
      const modularRef = sRef(storage, filePath);
      await uploadBytes(modularRef, file);
      const url = await getDownloadURL(modularRef);
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
