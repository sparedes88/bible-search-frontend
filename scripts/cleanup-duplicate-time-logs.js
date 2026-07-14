// One-time cleanup utility for duplicate TimeRotate log entries.
//
// Default behavior is DRY RUN (no deletes).
//
// Duplicate definition:
// Same church + same user key + same issueId + same projectName + same startedAt.
//
// Keep strategy per duplicate group:
// 1) Keep doc with greatest endedAt
// 2) Tie-breaker: greatest durationMs
// 3) Tie-breaker: latest createTime
//
// Usage examples:
//   node scripts/cleanup-duplicate-time-logs.js --church=2155
//   node scripts/cleanup-duplicate-time-logs.js --church=2155 --apply
//   node scripts/cleanup-duplicate-time-logs.js --church=2155 --from=2026-06-01 --to=2026-06-30 --apply

const fs = require("fs");
const path = require("path");
const { initializeApp, cert, applicationDefault, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

function resolveCredential() {
  const serviceAccountPath = path.resolve(__dirname, "../serviceAccountKey.json");
  if (fs.existsSync(serviceAccountPath)) {
    const serviceAccount = require(serviceAccountPath);
    return cert(serviceAccount);
  }

  // Fallback to GOOGLE_APPLICATION_CREDENTIALS or gcloud ADC.
  return applicationDefault();
}

function parseArgs(argv) {
  const result = {
    churchId: "",
    projectId: "",
    apply: false,
    fromMs: Number.NaN,
    toMs: Number.NaN,
    verbose: false,
    maxGroupsPreview: 20,
  };

  argv.forEach((token) => {
    if (token === "--apply") {
      result.apply = true;
      return;
    }

    if (token === "--verbose") {
      result.verbose = true;
      return;
    }

    if (token.startsWith("--church=")) {
      result.churchId = token.split("=").slice(1).join("=").trim();
      return;
    }

    if (token.startsWith("--project=")) {
      result.projectId = token.split("=").slice(1).join("=").trim();
      return;
    }

    if (token.startsWith("--from=")) {
      result.fromMs = parseDateOrMillis(token.split("=").slice(1).join("=").trim());
      return;
    }

    if (token.startsWith("--to=")) {
      result.toMs = parseDateOrMillis(token.split("=").slice(1).join("=").trim());
      return;
    }

    if (token.startsWith("--max-groups-preview=")) {
      const parsed = Number(token.split("=").slice(1).join("=").trim());
      if (Number.isFinite(parsed) && parsed > 0) {
        result.maxGroupsPreview = Math.floor(parsed);
      }
    }
  });

  return result;
}

function parseDateOrMillis(raw) {
  if (!raw) return Number.NaN;

  const numeric = Number(raw);
  if (Number.isFinite(numeric)) return numeric;

  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function normalizeValue(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function toMs(value) {
  if (value === null || value === undefined) return 0;

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value?.toMillis === "function") {
    const millis = Number(value.toMillis());
    return Number.isFinite(millis) ? millis : 0;
  }

  if (typeof value?.seconds === "number") {
    const nanos = typeof value?.nanoseconds === "number" ? value.nanoseconds : 0;
    return (value.seconds * 1000) + Math.floor(nanos / 1000000);
  }

  const parsed = Date.parse(normalizeValue(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildUserKey(data) {
  const userId = normalizeValue(data.userId).toLowerCase();
  const userEmail = normalizeValue(data.userEmail).toLowerCase();
  const registeredBy = normalizeValue(data.registeredBy).toLowerCase();
  return userId || userEmail || registeredBy || "unknown-user";
}

function buildDuplicateKey(churchId, data) {
  const userKey = buildUserKey(data);
  const issueId = normalizeValue(data.issueId).toLowerCase() || "-";
  const projectName = normalizeValue(data.projectName).toLowerCase() || "-";
  const startedAt = toMs(data.startedAt) || 0;
  return `${churchId}||${userKey}||${issueId}||${projectName}||${startedAt}`;
}

function pickDocToKeep(groupDocs) {
  return groupDocs
    .slice()
    .sort((left, right) => {
      const leftEndedAt = toMs(left.data.endedAt);
      const rightEndedAt = toMs(right.data.endedAt);
      if (rightEndedAt !== leftEndedAt) return rightEndedAt - leftEndedAt;

      const leftDuration = Number(left.data.durationMs) || 0;
      const rightDuration = Number(right.data.durationMs) || 0;
      if (rightDuration !== leftDuration) return rightDuration - leftDuration;

      const leftCreated = toMs(left.createTime);
      const rightCreated = toMs(right.createTime);
      return rightCreated - leftCreated;
    })[0];
}

function shouldIncludeByDate(data, fromMs, toMs) {
  const startedAt = toMs(data.startedAt);
  if (Number.isFinite(fromMs) && startedAt < fromMs) return false;
  if (Number.isFinite(toMs) && startedAt > toMs) return false;
  return true;
}

function resolveProjectId(cliProjectId) {
  const fromCli = normalizeValue(cliProjectId);
  if (fromCli) return fromCli;

  return (
    normalizeValue(process.env.GOOGLE_CLOUD_PROJECT)
    || normalizeValue(process.env.GCLOUD_PROJECT)
    || normalizeValue(process.env.FIREBASE_PROJECT_ID)
    || normalizeValue(process.env.REACT_APP_FIREBASE_PROJECT_ID)
  );
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const resolvedProjectId = resolveProjectId(args.projectId);

  if (!args.churchId) {
    throw new Error("Missing required argument --church=<churchId>");
  }

  if (getApps().length === 0) {
    initializeApp({
      credential: resolveCredential(),
      projectId: resolvedProjectId || undefined,
    });
  }

  const db = getFirestore();

  const collectionRef = db.collection("churches").doc(args.churchId).collection("timeRotateLogs");
  const snapshot = await collectionRef.get();

  const allDocs = snapshot.docs
    .map((docSnap) => ({
      id: docSnap.id,
      ref: docSnap.ref,
      data: docSnap.data() || {},
      createTime: docSnap.createTime,
    }))
    .filter((entry) => shouldIncludeByDate(entry.data, args.fromMs, args.toMs));

  const groupsMap = new Map();

  allDocs.forEach((entry) => {
    const key = buildDuplicateKey(args.churchId, entry.data);
    if (!groupsMap.has(key)) {
      groupsMap.set(key, []);
    }
    groupsMap.get(key).push(entry);
  });

  const duplicateGroups = Array.from(groupsMap.entries())
    .filter(([, docs]) => docs.length > 1)
    .map(([key, docs]) => ({ key, docs }));

  const deletePlan = [];
  duplicateGroups.forEach((group) => {
    const keep = pickDocToKeep(group.docs);
    group.docs.forEach((docItem) => {
      if (docItem.id !== keep.id) {
        deletePlan.push({
          ref: docItem.ref,
          id: docItem.id,
          key: group.key,
          keepId: keep.id,
          startedAt: toMs(docItem.data.startedAt),
          endedAt: toMs(docItem.data.endedAt),
          durationMs: Number(docItem.data.durationMs) || 0,
          issueId: normalizeValue(docItem.data.issueId),
          projectName: normalizeValue(docItem.data.projectName),
          userId: normalizeValue(docItem.data.userId),
          userEmail: normalizeValue(docItem.data.userEmail),
          registeredBy: normalizeValue(docItem.data.registeredBy),
        });
      }
    });
  });

  console.log("---- Duplicate Time Logs Cleanup ----");
  console.log(`Church ID: ${args.churchId}`);
  console.log(`Project ID: ${resolvedProjectId || "(auto-detect)"}`);
  console.log(`Mode: ${args.apply ? "APPLY (delete)" : "DRY RUN (no delete)"}`);
  console.log(`Scanned docs: ${allDocs.length}`);
  console.log(`Duplicate groups: ${duplicateGroups.length}`);
  console.log(`Docs to delete: ${deletePlan.length}`);

  if (duplicateGroups.length === 0) {
    console.log("No duplicates found.");
    return;
  }

  const previewGroups = duplicateGroups.slice(0, args.maxGroupsPreview);
  console.log(`\nPreview (first ${previewGroups.length} groups):`);
  previewGroups.forEach((group, index) => {
    const keep = pickDocToKeep(group.docs);
    const sample = group.docs[0]?.data || {};
    console.log(
      `${index + 1}. keep=${keep.id} count=${group.docs.length} user=${buildUserKey(sample)} issue=${normalizeValue(sample.issueId) || "-"} project=${normalizeValue(sample.projectName) || "-"} startedAt=${toMs(sample.startedAt)}`
    );

    if (args.verbose) {
      group.docs.forEach((docItem) => {
        const marker = docItem.id === keep.id ? "KEEP" : "DEL";
        console.log(
          `   - ${marker} ${docItem.id} endedAt=${toMs(docItem.data.endedAt)} duration=${Number(docItem.data.durationMs) || 0}`
        );
      });
    }
  });

  if (!args.apply) {
    console.log("\nDry run complete. Re-run with --apply to delete duplicates.");
    return;
  }

  let deletedCount = 0;
  const chunkSize = 400;

  for (let start = 0; start < deletePlan.length; start += chunkSize) {
    const chunk = deletePlan.slice(start, start + chunkSize);
    const batch = db.batch();
    chunk.forEach((item) => batch.delete(item.ref));
    await batch.commit();
    deletedCount += chunk.length;
    console.log(`Deleted ${deletedCount}/${deletePlan.length}...`);
  }

  console.log(`\nCleanup complete. Deleted ${deletedCount} duplicate docs.`);
}

run().catch((error) => {
  console.error("Cleanup failed:", error);
  process.exitCode = 1;
});
