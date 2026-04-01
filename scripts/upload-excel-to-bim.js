#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

// Initialize Firebase Admin SDK
const admin = require('firebase-admin');

// Check if Firebase is already initialized
if (!admin.apps.length) {
  const serviceAccountPath = path.join(__dirname, '../e2tech-vdc-service-account.json');
  
  // Try to use service account if available
  if (fs.existsSync(serviceAccountPath)) {
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } else {
    // Use default credentials from environment
    admin.initializeApp();
  }
}

const db = admin.firestore();

const normalizeValue = (value) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
};

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

    console.log(`✅ Found ${fields.length} fields: ${fields.join(", ")}`);

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

    // Display sample data
    console.log(`\n📊 Sample first row:`);
    console.log(JSON.stringify(rows[0]?.rowData, null, 2));

    // Validate church ID
    if (!churchId) {
      throw new Error("Church ID is required");
    }

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

    console.log(`\n🚀 Uploading to Firestore at: churches/${churchId}/bimProjects/${projectId}`);
    
    await projectRef.set(projectData);

    console.log(`✅ Successfully uploaded BIM project!`);
    console.log(`📍 Location: churches/${churchId}/bimProjects/${projectId}`);
    console.log(`📝 Project name: ${projectData.name}`);
    console.log(`📊 Rows: ${rows.length}`);
    console.log(`🏷️  Fields: ${fields.length}`);

    return { projectId, projectData };

  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }
}

// Main execution
const args = process.argv.slice(2);
const excelPath = args[0];
const churchId = args[1];
const projectName = args[2];

if (!excelPath || !churchId) {
  console.log(`
Usage: node upload-excel-to-bim.js <excelPath> <churchId> [projectName]

Example:
  node upload-excel-to-bim.js "C:\\path\\to\\file.xlsx" "church-id-123" "Project Name"

Arguments:
  excelPath    - Full path to the Excel file
  churchId     - Firebase church/organization ID
  projectName  - (Optional) Project name. Defaults to filename

  `);
  process.exit(1);
}

uploadExcelToBIM(excelPath, churchId, projectName).then(() => {
  process.exit(0);
});
