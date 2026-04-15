const admin = require("firebase-admin");

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
});

const db = admin.firestore();

const ORG_ID = "2155"; // Update if needed
const PROJECT_ID = "stanford-ff-rad";

async function deleteReadyForReviewFromParent() {
  const projectRef = db.doc(`churches/${ORG_ID}/bimProjects/${PROJECT_ID}`);
  const projectSnap = await projectRef.get();
  if (!projectSnap.exists) {
    console.error("Project not found.");
    return;
  }
  const data = projectSnap.data();
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const originalCount = rows.length;
  const filteredRows = rows.filter(row => {
    const status = row?.rowData?.Status || row?.rowData?.status;
    return status !== "Ready for Review";
  });
  const deletedCount = originalCount - filteredRows.length;
  if (deletedCount === 0) {
    console.log("No issues with Status 'Ready for Review' found.");
    return;
  }
  await projectRef.update({ rows: filteredRows });
  console.log(`Deleted ${deletedCount} issues with Status 'Ready for Review' from parent document.`);
}

deleteReadyForReviewFromParent().catch(console.error);
