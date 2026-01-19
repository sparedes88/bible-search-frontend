const admin = require("firebase-admin");

// Initialize Firebase Admin SDK (Make sure you have your service account JSON)
const serviceAccount = require("./path-to-your-service-account.json");

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
    });
}

const db = admin.firestore();

module.exports = { admin, db };
