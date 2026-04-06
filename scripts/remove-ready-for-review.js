#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
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

const STATUS_ALIASES = ['status', 'state', 'task status'];
const TARGET_STATUS = 'ready for review';

const normalizeValue = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value).trim();
};

const normalizeFieldKey = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const findFieldByAliases = (fields = [], rowData = {}, aliases = []) => {
  const candidates = Array.from(new Set([...(fields || []), ...Object.keys(rowData || {})]));
  if (!candidates.length) return null;

  for (const alias of aliases) {
    const aliasKey = normalizeFieldKey(alias);
    const exact = candidates.find((candidate) => normalizeFieldKey(candidate) === aliasKey);
    if (exact) return exact;
  }

  for (const alias of aliases) {
    const aliasKey = normalizeFieldKey(alias);
    const contains = candidates.find((candidate) => normalizeFieldKey(candidate).includes(aliasKey));
    if (contains) return contains;
  }

  return null;
};

const parseArgs = (argv) => {
  const result = {
    churchId: '',
    projectId: '',
    apply: false,
  };

  argv.forEach((arg) => {
    if (arg === '--apply') {
      result.apply = true;
      return;
    }
    if (arg.startsWith('--churchId=')) {
      result.churchId = arg.slice('--churchId='.length).trim();
      return;
    }
    if (arg.startsWith('--projectId=')) {
      result.projectId = arg.slice('--projectId='.length).trim();
    }
  });

  return result;
};

const printUsage = () => {
  console.log('Usage: node scripts/remove-ready-for-review.js --churchId=<id> [--projectId=<docId>] [--apply]');
  console.log('');
  console.log('Behavior:');
  console.log('- Dry-run by default.');
  console.log('- Add --apply to persist the removal.');
  console.log('- If --projectId is omitted, all bimProjects under the church are scanned.');
};

async function run() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.churchId) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const projectsRef = db.collection('churches').doc(args.churchId).collection('bimProjects');
  const projectSnapshots = [];

  if (args.projectId) {
    const projectDoc = await projectsRef.doc(args.projectId).get();
    if (!projectDoc.exists) {
      throw new Error(`Project not found: churches/${args.churchId}/bimProjects/${args.projectId}`);
    }
    projectSnapshots.push(projectDoc);
  } else {
    const snapshot = await projectsRef.get();
    snapshot.forEach((doc) => projectSnapshots.push(doc));
  }

  if (!projectSnapshots.length) {
    console.log('No BIM projects found for the given scope.');
    return;
  }

  let totalRemoved = 0;
  let touchedProjects = 0;

  for (const projectSnapshot of projectSnapshots) {
    const data = projectSnapshot.data() || {};
    const fields = Array.isArray(data.fields) ? data.fields : [];
    const rows = Array.isArray(data.rows) ? data.rows : [];

    if (!rows.length) continue;

    const remainingRows = [];
    const removedRows = [];

    rows.forEach((row) => {
      const rowData = row?.rowData || {};
      const statusField = findFieldByAliases(fields, rowData, STATUS_ALIASES);
      const statusValue = normalizeValue(statusField ? rowData[statusField] : '').toLowerCase();

      if (statusValue === TARGET_STATUS) {
        removedRows.push({
          rowNumber: row?.rowNumber,
          issueId: normalizeValue(rowData['Issue ID'] || rowData['ID'] || rowData['Id']),
          title: normalizeValue(rowData['Title'] || rowData['title']),
        });
        return;
      }

      remainingRows.push(row);
    });

    if (!removedRows.length) continue;

    touchedProjects += 1;
    totalRemoved += removedRows.length;

    console.log(`\nProject: ${projectSnapshot.id}`);
    console.log(`Removed candidates: ${removedRows.length}`);
    removedRows.slice(0, 20).forEach((row) => {
      console.log(`- row ${row.rowNumber || '?'} | ${row.issueId || '(no issue id)'} | ${row.title || '(no title)'}`);
    });
    if (removedRows.length > 20) {
      console.log(`- ...and ${removedRows.length - 20} more`);
    }

    if (!args.apply) continue;

    await projectSnapshot.ref.update({
      rows: remainingRows,
      updatedAt: new Date(),
    });
  }

  console.log('');
  console.log(`Projects affected: ${touchedProjects}`);
  console.log(`Rows matched: ${totalRemoved}`);
  console.log(args.apply ? 'Changes applied.' : 'Dry-run only. Re-run with --apply to persist changes.');
}

run().catch((error) => {
  console.error('Cleanup failed:', error.message);
  process.exitCode = 1;
});