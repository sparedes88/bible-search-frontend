const admin = require("firebase-admin");
const fs = require("fs");

// Path to your service account key
const serviceAccount = require("./serviceAccountKey.json");

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

const CHURCH_ID = "2155"; // <-- Replace with your church document ID
const PROJECT_ID = "stanford-ff-rad";

async function exportStanfordIssues() {
  try {
    const docRef = db.collection("churches").doc(CHURCH_ID).collection("bimProjects").doc(PROJECT_ID);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      console.error("Document not found!");
      return;
    }

    const data = docSnap.data();
    const issues = data.rows || [];

    fs.writeFileSync("stanford-ff-rad-issues-backup.json", JSON.stringify(issues, null, 2));
    console.log(`Exported ${issues.length} issues to stanford-ff-rad-issues-backup.json`);
  } catch (err) {
    console.error("Error exporting issues:", err);
  }
}

exportStanfordIssues();