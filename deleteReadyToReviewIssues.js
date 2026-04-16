const admin = require("firebase-admin");

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
});

const db = admin.firestore();

const ORG_ID = "2155"; // Update if needed
const PROJECT_ID = "stanford-ff-rad";

async function deleteReadyToReviewIssues() {
  const issuesCol = db.collection(`churches/${ORG_ID}/bimProjects/${PROJECT_ID}/issues`);
  const snapshot = await issuesCol.where("Status", "==", "Ready for Review").get();
  if (snapshot.empty) {
    console.log("No issues found with Status 'Ready for Review'.");
    return;
  }
  let count = 0;
  const batch = db.batch();
  snapshot.forEach(doc => {
    batch.delete(doc.ref);
    count++;
  });
  await batch.commit();
  console.log(`Deleted ${count} issues with Status 'Ready to Review'.`);
}

deleteReadyToReviewIssues().catch(console.error);
