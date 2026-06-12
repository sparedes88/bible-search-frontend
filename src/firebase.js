import { initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  browserSessionPersistence,
  connectAuthEmulator,
  getAuth,
  initializeAuth,
} from "firebase/auth";
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  connectFirestoreEmulator,
  doc,
  collection,
  setDoc,
  getDoc,
} from "firebase/firestore";
import { getStorage, connectStorageEmulator } from "firebase/storage";
import { getAnalytics } from "firebase/analytics";
import { getDatabase, connectDatabaseEmulator, onValue, ref as dbRef } from "firebase/database";

// Debug logger with timestamp
const isFirebaseDebugEnabled = process.env.REACT_APP_ENABLE_FIREBASE_DEBUG === "true";
const debugLog = (message) => {
  if (isFirebaseDebugEnabled) {
    console.log(`[Firebase Debug] ${new Date().toISOString()}: ${message}`);
  }
};

const isRunningOnLocalhost =
  typeof window !== "undefined" &&
  ["localhost", "127.0.0.1"].includes(window.location.hostname);

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

const isRealtimeDbEnabled =
  process.env.REACT_APP_ENABLE_REALTIME_DB === "true";
const hasRealtimeDatabaseUrl = Boolean(
  firebaseConfig.databaseURL && /^https?:\/\//.test(firebaseConfig.databaseURL)
);

const hasRealMeasurementId = Boolean(
  firebaseConfig.measurementId &&
  firebaseConfig.measurementId !== "G-XXXXXXXXXX"
);

if (isFirebaseDebugEnabled) {
  console.log("Firebase Config Debug:", {
    apiKey: firebaseConfig.apiKey ? "✓ Set" : "✗ Missing",
    authDomain: firebaseConfig.authDomain ? "✓ Set" : "✗ Missing",
    projectId: firebaseConfig.projectId ? "✓ Set" : "✗ Missing",
    storageBucket: firebaseConfig.storageBucket ? "✓ Set" : "✗ Missing",
    appId: firebaseConfig.appId ? "✓ Set" : "✗ Missing",
    measurementId: firebaseConfig.measurementId ? "✓ Set" : "✗ Missing",
    databaseURL: firebaseConfig.databaseURL ? "✓ Set" : "✗ Missing",
  });
}

const clearStaleFirebaseAuthState = (currentApiKey) => {
  if (!isRunningOnLocalhost || typeof window === "undefined") {
    return;
  }

  let foundStaleKey = false;

  const removeStaleKeys = (storage) => {
    if (!storage) return;

    Object.keys(storage).forEach((key) => {
      if (!key.startsWith("firebase:")) {
        return;
      }

      if (key.includes(currentApiKey)) {
        return;
      }

      foundStaleKey = true;
      storage.removeItem(key);
    });
  };

  try {
    removeStaleKeys(window.localStorage);
    removeStaleKeys(window.sessionStorage);

    if (foundStaleKey && window.indexedDB) {
      window.indexedDB.deleteDatabase("firebaseLocalStorageDb");
    }

    if (foundStaleKey) {
      debugLog("Cleared stale Firebase auth state for localhost");
    }
  } catch (error) {
    console.warn("Failed to clear stale Firebase auth state:", error);
  }
};

clearStaleFirebaseAuthState(firebaseConfig.apiKey);

// Initialize Firebase
debugLog("Initializing Firebase");
const app = initializeApp(firebaseConfig);

// Initialize services
const auth = isRunningOnLocalhost
  ? initializeAuth(app, {
      persistence: [browserLocalPersistence, browserSessionPersistence],
    })
  : getAuth(app);
let db;
try {
  if (isRunningOnLocalhost) {
    db = initializeFirestore(app, {
      // Dev-only transport hardening to reduce watch-stream instability on HMR/proxy setups.
      experimentalAutoDetectLongPolling: true,
      useFetchStreams: false,
    });
    debugLog("Firestore initialized with localhost watch-stream hardening");
  } else {
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    });
    debugLog("Firestore initialized with modern persistent local cache");
  }
} catch (error) {
  db = getFirestore(app);
  debugLog(`Firestore fallback initialization used: ${error.message}`);
}

// Initialize storage with better error handling - make it optional
let storage = null;
try {
  // Prefer default app config first to avoid malformed explicit bucket URLs in production.
  storage = getStorage(app);
  debugLog("Firebase storage initialized with app default bucket");
} catch (error) {
  // Fallback to a computed bucket when env config is incomplete for production builds.
  try {
    const bucketFromProject = firebaseConfig.projectId ? `gs://${firebaseConfig.projectId}.firebasestorage.app` : null;
    if (bucketFromProject) {
      storage = getStorage(app, bucketFromProject);
      debugLog(`Firebase storage initialized with fallback bucket: ${bucketFromProject}`);
    }
  } catch (fallbackError) {
    if (isFirebaseDebugEnabled) {
      console.warn("Firebase storage initialization failed:", error.message);
      console.warn("Firebase storage fallback initialization failed:", fallbackError.message);
    }
    storage = null;
  }
}

// If storage is still null, log a warning but don't crash
if (!storage) {
  if (isFirebaseDebugEnabled) {
    console.warn("Firebase Storage is not available. File upload features will be disabled.");
  }
}

// Lazy initialize database to avoid initialization errors
let databaseInstance = null;
const getDatabaseInstance = () => {
  if (!isRealtimeDbEnabled || !hasRealtimeDatabaseUrl) {
    if (isFirebaseDebugEnabled) {
      const reason = !isRealtimeDbEnabled
        ? "disabled via REACT_APP_ENABLE_REALTIME_DB"
        : "missing/invalid REACT_APP_FIREBASE_DATABASE_URL";
      debugLog(`Realtime Database skipped (${reason})`);
    }
    return null;
  }

  if (!databaseInstance) {
    try {
      databaseInstance = getDatabase(app);
      debugLog("Firebase database initialized successfully");
    } catch (error) {
      if (isFirebaseDebugEnabled) {
        console.warn("Firebase Realtime Database is not available:", error.message);
      }
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

    // Initialize analytics only when a real measurement ID exists.
    if (!isLocal && hasRealMeasurementId) {
      try {
        analytics = getAnalytics(app);
        debugLog("Analytics initialized");
      } catch (analyticsError) {
        debugLog(`Analytics initialization failed: ${analyticsError.message}`);
        analytics = null;
      }
    } else {
      debugLog("Analytics skipped (missing or placeholder measurement ID)");
    }

    // Set up connection monitoring from Realtime Database (non-blocking, async)
    setTimeout(() => {
      try {
        const databaseInstance = getDatabaseInstance();
        if (!databaseInstance) return;

        const connectedRef = dbRef(databaseInstance, ".info/connected");
        onValue(
          connectedRef,
          (snap) => {
            const isConnected = !!snap.val();
            debugLog(`Connection state: ${isConnected ? "Connected" : "Disconnected"}`);
          },
          (error) => debugLog(`Connection monitoring error: ${error.message}`)
        );
      } catch (error) {
        debugLog(`Connection monitoring setup error: ${error.message}`);
      }
    }, 100); // Delay to not block initial load
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

// Initialize with timeout to prevent blocking
const initPromise = Promise.race([
  initializeFirebase(),
  new Promise((_, reject) => 
    setTimeout(() => reject(new Error('Firebase init timeout')), 3000)
  )
])
  .then(() => {
    firebaseInitialized = true;
    debugLog("Firebase initialization completed");
  })
  .catch((error) => {
    if (error.message !== 'Firebase init timeout') {
      console.error("Firebase initialization failed:", error);
    } else {
      debugLog("Firebase initialization taking longer than expected, continuing anyway");
    }
    // Don't throw - allow app to continue
    firebaseInitialized = true; // Mark as initialized anyway
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
