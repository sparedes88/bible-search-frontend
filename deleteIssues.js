const admin = require("firebase-admin");
admin.initializeApp({
  credential: admin.credential.applicationDefault(),
});
const db = admin.firestore();

const churchId = "2155"; // <-- set your church ID
const projectId = "stanford-ff-rad"; // <-- set your project ID

async function deleteAllIssues() {
  const issuesRef = db.collection("churches").doc(churchId)
    .collection("bimProjects").doc(projectId)
    .collection("issues");

  const snapshot = await issuesRef.get();
  if (snapshot.empty) {
    console.log("No issues to delete.");
    return;
  }

  const batch = db.batch();
  snapshot.docs.forEach(doc => {
    batch.delete(doc.ref);
    console.log("Scheduled for deletion:", doc.id);
  });

  await batch.commit();
  console.log("All issue documents deleted.");
}

deleteAllIssues().catch(console.error);