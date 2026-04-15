const admin = require("firebase-admin");

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
});

const db = admin.firestore();

const ORG_ID = "2155";
const PROJECT_ID = "stanford-ff-rad";

async function migrate() {
  const projectRef = db.doc(`churches/${ORG_ID}/bimProjects/${PROJECT_ID}`);
  const issuesCol = db.collection(`churches/${ORG_ID}/bimProjects/${PROJECT_ID}/issues`);
  const projectSnap = await projectRef.get();
  if (!projectSnap.exists) {
    console.error("Project not found.");
    return;
  }
  const data = projectSnap.data();
  const rows = Array.isArray(data.rows) ? data.rows : [];
  console.log(`Migrating ${rows.length} issues...`);
  let count = 0;
  for (const row of rows) {
    const rowData = row.rowData || {};
    // Use issueId, ID, or fallback to rowNumber as doc ID
    const docId =
      rowData.issueId ||
      rowData["Issue ID"] ||
      rowData.ID ||
      row.rowNumber?.toString() ||
      `row${count + 1}`;
    await issuesCol.doc(docId).set(rowData, { merge: true });
    count++;
  }
  console.log(`Migration complete. ${count} issues migrated.`);
}

migrate().catch(console.error);