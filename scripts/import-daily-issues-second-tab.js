#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const { initializeApp } = require("firebase/app");
const { getAuth, signInWithEmailAndPassword } = require("firebase/auth");
const {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} = require("firebase/firestore");

const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY || "AIzaSyCY_XOuio1JgIW6EmUhmP7SCbUj8fXQJw0",
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN || "igletechv1.firebaseapp.com",
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID || "igletechv1",
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET || "igletechv1.firebasestorage.app",
  appId: process.env.REACT_APP_FIREBASE_APP_ID || "1:656473490321:web:0ed1496532e9c6be8ad030",
};

const DEFAULT_FILE =
  "C:/Users/BenSolorzano/OneDrive - E2 Tech Support/E2 Tech Team - VDC Project - Equipo Operativo/Exports/Daily-Issue-List-All-Projects-2026-04-01.xlsx";
const DEFAULT_SHEET = "Issues with one last comment";
const DEFAULT_CHURCH_ID = "2155";
const DEFAULT_PROJECT_ID = "stanford-ff-rad";

const normalizeValue = (value) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
};

const mergeFields = (existingFields, excelHeaders) => {
  const seen = new Set();
  const merged = [];

  for (const field of [...existingFields, ...excelHeaders]) {
    const normalized = normalizeValue(field);
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    merged.push(normalized);
  }

  return merged;
};

const parseSheet = (filePath, sheetName) => {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Excel file not found: ${filePath}`);
  }

  const workbook = XLSX.readFile(filePath);
  if (!workbook.SheetNames.includes(sheetName)) {
    throw new Error(`Worksheet not found: ${sheetName}`);
  }

  const worksheet = workbook.Sheets[sheetName];
  const parsedRows = XLSX.utils.sheet_to_json(worksheet, {
    defval: "",
    raw: false,
  });

  const headers = parsedRows.length
    ? Object.keys(parsedRows[0]).map((header) => normalizeValue(header)).filter(Boolean)
    : [];

  const rows = parsedRows.map((rowData, index) => {
    const normalizedRow = {};
    for (const key of Object.keys(rowData || {})) {
      const normalizedKey = normalizeValue(key);
      if (!normalizedKey) continue;
      normalizedRow[normalizedKey] = normalizeValue(rowData[key]);
    }

    return {
      rowNumber: index + 1,
      rowData: normalizedRow,
    };
  });

  return { headers, rows };
};

async function main() {
  const email = process.env.FIREBASE_EMAIL;
  const password = process.env.FIREBASE_PASSWORD;

  const excelPath = process.env.EXCEL_FILE || DEFAULT_FILE;
  const sheetName = process.env.EXCEL_SHEET || DEFAULT_SHEET;
  const churchId = process.env.CHURCH_ID || DEFAULT_CHURCH_ID;
  const projectId = process.env.PROJECT_ID || DEFAULT_PROJECT_ID;

  if (!email || !password) {
    throw new Error("Missing FIREBASE_EMAIL or FIREBASE_PASSWORD env var.");
  }

  const { headers: excelHeaders, rows } = parseSheet(excelPath, sheetName);

  if (!rows.length) {
    throw new Error("No rows found in selected worksheet.");
  }

  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);

  await signInWithEmailAndPassword(auth, email, password);

  const projectRef = doc(db, "churches", churchId, "bimProjects", projectId);
  const projectSnap = await getDoc(projectRef);
  const existingData = projectSnap.exists() ? projectSnap.data() : {};
  const existingFields = Array.isArray(existingData.fields) ? existingData.fields : [];

  const fields = mergeFields(existingFields, excelHeaders);

  await setDoc(
    projectRef,
    {
      name: existingData.name || "STANFORD -  FF / RAD",
      fields,
      rows,
      rowCount: rows.length,
      lastFileName: path.basename(excelPath),
      lastUploadAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedBy: auth.currentUser?.uid || null,
      updatedByEmail: auth.currentUser?.email || null,
    },
    { merge: true }
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        churchId,
        projectId,
        excelPath,
        sheetName,
        rowCount: rows.length,
        preservedFieldCount: existingFields.length,
        mergedFieldCount: fields.length,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
