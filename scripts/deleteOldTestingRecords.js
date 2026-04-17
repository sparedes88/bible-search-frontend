// Script to delete all records from the old data structure where Data Stage = Testing
// Location: /churches/2155/bimProjects/stanford-ff-rad
// Usage: node scripts/deleteOldTestingRecords.js

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const serviceAccount = require('../serviceAccountKey.json');

initializeApp({
  credential: cert(serviceAccount),
});

const db = getFirestore();

const PROJECT_PATH = 'churches/2155/bimProjects/stanford-ff-rad';

async function deleteTestingRecords() {
  const projectDoc = db.doc(PROJECT_PATH);
  const docSnap = await projectDoc.get();
  if (!docSnap.exists) {
    console.log('Project document does not exist.');
    return;
  }
  const data = docSnap.data();
  if (!data.rows || !Array.isArray(data.rows)) {
    console.log('No rows array found in project document.');
    return;
  }
  const originalLength = data.rows.length;
  const filteredRows = data.rows.filter(row => {
    // Accept if not Testing, filter out if Testing
    return (row.DataStage || row.dataStage || row['Data Stage']) !== 'Testing';
  });
  if (filteredRows.length === originalLength) {
    console.log('No records with Data Stage = Testing found.');
    return;
  }
  await projectDoc.update({ rows: filteredRows });
  console.log(`Deleted ${originalLength - filteredRows.length} records with Data Stage = Testing.`);
}

deleteTestingRecords().catch(err => {
  console.error('Error deleting records:', err);
});
