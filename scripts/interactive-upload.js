#!/usr/bin/env node

/**
 * Interactive Excel Upload Tool
 * Lists available churches in Firestore and uploads Excel file to selected church
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const XLSX = require('xlsx');

// Initialize Firebase Admin SDK
const admin = require('firebase-admin');

if (!admin.apps.length) {
  const serviceAccountPath = path.join(__dirname, '../e2tech-vdc-service-account.json');
  
  if (fs.existsSync(serviceAccountPath)) {
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } else {
    admin.initializeApp();
  }
}

const db = admin.firestore();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (prompt) => {
  return new Promise(resolve => {
    rl.question(prompt, resolve);
  });
};

const normalizeValue = (value) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
};

async function listChurches() {
  console.log('\n🏢 Fetching available organizations...\n');
  
  try {
    const snapshot = await db.collection('churches').limit(50).get();
    const churches = [];
    
    snapshot.forEach(doc => {
      churches.push({
        id: doc.id,
        name: doc.data().Name || doc.data().name || doc.id,
        data: doc.data()
      });
    });
    
    if (churches.length === 0) {
      console.log('❌ No organizations found in Firestore');
      return null;
    }
    
    console.log(`✅ Found ${churches.length} organization(s):\n`);
    churches.forEach((church, index) => {
      console.log(`  ${index + 1}. ${church.name}`);
      console.log(`     ID: ${church.id}\n`);
    });
    
    return churches;
  } catch (error) {
    console.error(`❌ Error fetching churches: ${error.message}`);
    return null;
  }
}

async function uploadExcelToBIM(excelPath, churchId, projectName) {
  try {
    console.log(`\n📄 Reading Excel file: ${excelPath}`);
    
    if (!fs.existsSync(excelPath)) {
      throw new Error(`File not found: ${excelPath}`);
    }

    // Read Excel file
    const workbook = XLSX.readFile(excelPath);
    const firstSheetName = workbook.SheetNames[0];
    
    if (!firstSheetName) {
      throw new Error("No worksheet found in the uploaded file.");
    }

    const worksheet = workbook.Sheets[firstSheetName];
    const rangeRef = worksheet?.["!ref"];

    if (!rangeRef) {
      throw new Error("Worksheet has no data range.");
    }

    // Parse headers
    const headerRow = XLSX.utils.decode_range(rangeRef).s.r;
    const fields = [];
    for (let col = 0; col < 100; col++) {
      const cellAddress = XLSX.utils.encode_cell({ r: headerRow, c: col });
      const cell = worksheet[cellAddress];
      if (!cell || !cell.v) break;
      fields.push(String(cell.v).trim());
    }

    console.log(`✅ Found ${fields.length} fields`);

    // Parse rows
    const rows = [];
    for (let row = headerRow + 1; row < 10000; row++) {
      const rowData = {};
      let hasData = false;

      for (let col = 0; col < fields.length; col++) {
        const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
        const cell = worksheet[cellAddress];
        if (cell && cell.v !== undefined && cell.v !== null) {
          rowData[fields[col]] = normalizeValue(cell.v);
          hasData = true;
        }
      }

      if (!hasData) break;

      rows.push({
        rowNumber: row - headerRow,
        rowData,
      });
    }

    console.log(`✅ Parsed ${rows.length} data rows`);
    
    if (rows.length === 0) {
      throw new Error("No data rows found in worksheet.");
    }

    console.log(`\n📊 Sample first row:`);
    console.log(JSON.stringify(rows[0]?.rowData, null, 2));

    // Create project document
    const projectId = `bim-project-${Date.now()}`;
    const projectRef = db.collection("churches").doc(churchId).collection("bimProjects").doc(projectId);

    const projectData = {
      name: projectName || path.basename(excelPath, path.extname(excelPath)),
      fields,
      rows,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      internalCardMeta: {},
    };

    console.log(`\n🚀 Uploading to Firestore...`);
    
    await projectRef.set(projectData);

    console.log(`\n✅ Successfully uploaded BIM project!`);
    console.log(`📍 Location: churches/${churchId}/bimProjects/${projectId}`);
    console.log(`📝 Project name: ${projectData.name}`);
    console.log(`📊 Rows: ${rows.length}`);
    console.log(`🏷️  Fields: ${fields.length}\n`);

    return { projectId, projectData };

  } catch (error) {
    console.error(`\n❌ Error: ${error.message}\n`);
    throw error;
  }
}

async function main() {
  try {
    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║       E2 Tech - Excel to Firestore BIM Uploader         ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');

    // List available churches
    const churches = await listChurches();
    if (!churches || churches.length === 0) {
      console.log('Cannot proceed without organizations.');
      rl.close();
      process.exit(1);
    }

    // Ask user to select church
    const choice = await question('Enter organization number (1-' + churches.length + ') or "q" to quit: ');
    
    if (choice.toLowerCase() === 'q') {
      console.log('\nAborted.');
      rl.close();
      process.exit(0);
    }

    const churchIndex = parseInt(choice) - 1;
    if (isNaN(churchIndex) || churchIndex < 0 || churchIndex >= churches.length) {
      console.log('\n❌ Invalid selection');
      rl.close();
      process.exit(1);
    }

    const selectedChurch = churches[churchIndex];
    console.log(`\n✅ Selected: ${selectedChurch.name} (${selectedChurch.id})\n`);

    // Ask for Excel file path
    const excelPath = await question('Enter full path to Excel file: ');
    if (!excelPath.trim()) {
      console.log('\n❌ No file path provided');
      rl.close();
      process.exit(1);
    }

    // Ask for project name (optional)
    const projectName = await question('Enter project name (press Enter for filename): ');

    // Upload
    await uploadExcelToBIM(excelPath.trim(), selectedChurch.id, projectName.trim());

    rl.close();
    process.exit(0);

  } catch (error) {
    console.error(`\n❌ Fatal error: ${error.message}`);
    rl.close();
    process.exit(1);
  }
}

main();
