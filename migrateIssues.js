// Migration script: Move issues from rows array to issues subcollection
// Usage: node migrateIssues.js

const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function migrateIssues() {
  const churchId = "2155";
  const projectId = "stanford-ff-rad";
  const projectRef = db.collection("churches").doc(churchId).collection("bimProjects").doc(projectId);
  const projectSnap = await projectRef.get();

  if (!projectSnap.exists) {
    console.error("Project not found!");
    return;
  }

  const projectData = projectSnap.data();
  const rows = Array.isArray(projectData.rows) ? projectData.rows : [];


  for (const [rowIndex, row] of rows.entries()) {
    const rowData = row.rowData || row;
    const issueId = rowData["ID"];
    if (!issueId) {
      console.warn("Skipping issue with missing ID field (ID):", rowData);
      continue;
    }

    if (!issueId) {
      console.warn("Skipping issue with missing ID:", rowData);
      continue;
    }

    await projectRef.collection("issues").doc(issueId).set(rowData, { merge: true });
    console.log(`Migrated issue: ${issueId}`);
  }

  console.log("Migration complete.");
}

migrateIssues()
  .then(() => process.exit(0))
  .catch(err => { console.error(err); process.exit(1); });
