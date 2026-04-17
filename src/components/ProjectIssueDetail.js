import React, { useEffect, useMemo, useRef, useState } from "react";
// Log entry structure: { update: string, percent: number, timestamp: string }
// Helper to format timestamp
const formatTimestamp = (ts) => {
  if (!ts) return "-";
  const date = new Date(ts);
  if (isNaN(date.getTime())) return ts;
  return date.toLocaleString();
};
// Default log structure if not present
const getInitialLog = () => [
  {
    update: "Issue created.",
    percent: 0,
    timestamp: new Date().toISOString(),
  },
];
import { Link, useParams } from "react-router-dom";
import { doc, getDoc, updateDoc, onSnapshot } from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes, deleteObject } from "firebase/storage";
import { toast } from "react-toastify";
import commonStyles from "../pages/commonStyles";
import ChurchHeader from "./ChurchHeader";
import { db, storage } from "../firebase";
import "./ProjectIssueDetail.css";

// ── helpers (mirrored from ProjectIssueDashboard) ──────────────────────────────

const normalizeValue = (value) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value instanceof Date) return value.toISOString();
  if (typeof value?.toDate === "function") return value.toDate().toISOString();
  return String(value).trim();
};

const normalizeFieldKey = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9]/g, "");

export const findFieldByAliases = (fields = [], rowData = {}, aliases = []) => {
  const candidates = Array.from(new Set([...fields, ...Object.keys(rowData)]));
  for (const alias of aliases) {
    const key = normalizeFieldKey(alias);
    const exact = candidates.find((c) => normalizeFieldKey(c) === key);
    if (exact) return exact;
  }
  for (const alias of aliases) {
    const key = normalizeFieldKey(alias);
    const found = candidates.find((c) => normalizeFieldKey(c).includes(key));
    if (found) return found;
  }
  return null;
};

const normalizeIssueIdDisplay = (value) => {
  const raw = normalizeValue(value);
  if (!raw) return "-";
  const compact = raw.replace(/\s+/g, "");
  const match = compact.match(/^([a-zA-Z]+)[-_]?(\d+)$/);
  if (match) return `${match[1].toUpperCase()}-${match[2]}`;
  return raw.toUpperCase().replace(/\s+/g, "-");
};

const isUrl = (str) => /^https?:\/\//i.test(String(str || ""));

const STORAGE_PREFIX = "pid-detail-fields-";

const DEFAULT_SELECTED_FIELDS = [
  "GUID",
  "ID",
  "Snapshot",
  "Created",
  "Status",
  "Priority",
  "Title",
  "Assignee",
  "Reporter",
  "Deadline",
  "Watchers",
  "Tags",
  "Level",
  "Room",
  "Area",
  "Zone",
  "E2 Detailer",
  "E2 Status Update",
  "E2 Status Date",
  "Markup",
  "Comment",
  "Comment reporter",
  "Comment date",
  "View in Revizto",
  "Grid",
  "Link to markup",
  "Assignee location",
  "View in web issue tracker",
  "Clashes",
  "Clashing models",
  "Issue type",
  "Status category",
  "Coordinate on alignment",
  "Technical Details Available",
  "E2 Detailer Support Team",
];

const DEFAULT_SELECTED_FIELD_KEYS = new Set(
  DEFAULT_SELECTED_FIELDS.map((f) => normalizeFieldKey(f))
);

// ── component ──────────────────────────────────────────────────────────────────


const ProjectIssueDetail = () => {
  // Log state
  const [logEntries, setLogEntries] = useState(getInitialLog());
  const [newLogUpdate, setNewLogUpdate] = useState("");
  const [newLogPercent, setNewLogPercent] = useState("");
  const [logLoading, setLogLoading] = useState(false);
  const { id, projectDocId, issueId } = useParams();
  const decodedIssueId = decodeURIComponent(issueId || "");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rowData, setRowData] = useState({});
  const [fields, setFields] = useState([]);
  const [projectName, setProjectName] = useState("");

  // Column sort state: 'default', 'az', 'custom'
  const [columnSort, setColumnSort] = useState('default');

  const [hiddenFields, setHiddenFields] = useState(() => {
    try {
      const stored = localStorage.getItem(`${STORAGE_PREFIX}${projectDocId}`);
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });

  const [e2Comments, setE2Comments] = useState("");
  const [e2Documents, setE2Documents] = useState([]);
  const [savingE2Metadata, setSavingE2Metadata] = useState(false);
  const [uploadingDocuments, setUploadingDocuments] = useState(false);
  const [cardKey, setCardKey] = useState("");
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!id || !projectDocId || !decodedIssueId) return;
    setLoading(true);
    setError(null);

    // Listen to project doc for project name and meta only
    const unsubProject = onSnapshot(doc(db, "churches", id, "bimProjects", projectDocId), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        setProjectName(normalizeValue(data.name));
        const internalCardMeta = data.internalCardMeta || {};
        // Documents can still fallback to meta
        const normalizeCardKey = (id, rowNumber) => {
          const norm = String(id || "").trim().toUpperCase();
          return norm ? `id:${norm}` : `row:${rowNumber || "unknown"}`;
        };
        const computedCardKey = normalizeCardKey(decodedIssueId);
        // No longer setE2Documents from internalCardMeta; handled below from issue doc
      }
    });

    // Listen to Issue doc for all field values
    const issueDocRef = doc(db, "churches", id, "bimProjects", projectDocId, "issues", decodedIssueId);
    const unsubIssueDoc = onSnapshot(issueDocRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        setRowData(data || {});
        setFields(Object.keys(data || {}));
        if (typeof data.e2Comments === "string") setE2Comments(data.e2Comments);
        if (Array.isArray(data.e2Documents)) setE2Documents(data.e2Documents);
        else setE2Documents([]);
        if (Array.isArray(data.LogEntries) && data.LogEntries.length > 0) {
          setLogEntries(data.LogEntries);
        } else {
          setLogEntries(getInitialLog());
        }
      } else {
        setRowData({});
        setFields([]);
        setE2Documents([]);
        setLogEntries(getInitialLog());
      }
      setLoading(false);
    }, (err) => {
      console.error("Issue doc fetch error:", err);
      setRowData({});
      setFields([]);
      setE2Documents([]);
      setLogEntries(getInitialLog());
      setLoading(false);
    });

    // Listen to the Issue document for LogEntries
    const issueRef = doc(db, "churches", id, "bimProjects", projectDocId, "issues", decodedIssueId);
    const unsubIssue = onSnapshot(issueRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        setLogEntries(data.LogEntries);
      } else {
        setLogEntries(getInitialLog());
      }
      setLoading(false);
    }, (err) => {
      console.error("Issue log fetch error:", err);
      setLogEntries(getInitialLog());
      setLoading(false);
    });

    return () => {
      unsubProject();
      unsubIssueDoc();
    };
  }, [id, projectDocId, decodedIssueId]);
  // Add new log entry
  const handleAddLogEntry = async () => {
    if (!newLogUpdate.trim() || !id || !projectDocId || !decodedIssueId) return;
    setLogLoading(true);
    const entry = {
      update: newLogUpdate.trim(),
      percent: Number(newLogPercent) || 0,
      timestamp: new Date().toISOString(),
    };
    try {
      const issueRef = doc(db, "churches", id, "bimProjects", projectDocId, "issues", decodedIssueId);
      const snapshot = await getDoc(issueRef);
      const data = snapshot.exists() ? snapshot.data() : {};
      const prevLog = Array.isArray(data.LogEntries) ? data.LogEntries : [];
      const nextLog = [entry, ...prevLog];
      await updateDoc(issueRef, { LogEntries: nextLog });
      setLogEntries(nextLog);
      setNewLogUpdate("");
      setNewLogPercent("");
    } catch (err) {
      toast.error("Could not add log entry.");
    } finally {
      setLogLoading(false);
    }
  };

  // ── derived data ─────────────────────────────────────────────────────────────


  // Sorting logic for columns
  const orderedFields = useMemo(() => {
    const keys = new Set([...fields, ...Object.keys(rowData)]);
    let arr = Array.from(keys).filter(Boolean);
    if (columnSort === 'az') {
      arr = arr.slice().sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    }
    // 'custom' can be implemented later (stub)
    return arr;
  }, [fields, rowData, columnSort]);
  // Handler for column sort dropdown
  const handleColumnSortChange = (e) => {
    setColumnSort(e.target.value);
  };

  const visibleFields = useMemo(
    () => orderedFields.filter((f) => !hiddenFields[f]),
    [orderedFields, hiddenFields]
  );

  useEffect(() => {
    if (!projectDocId || !orderedFields.length) return;
    let hasStoredPreferences = false;
    try {
      hasStoredPreferences = localStorage.getItem(`${STORAGE_PREFIX}${projectDocId}`) !== null;
    } catch {}
    if (hasStoredPreferences) return;

    const nextHidden = {};
    orderedFields.forEach((fieldName) => {
      nextHidden[fieldName] = !DEFAULT_SELECTED_FIELD_KEYS.has(normalizeFieldKey(fieldName));
    });

    setHiddenFields(nextHidden);
    persistHidden(nextHidden);
  }, [projectDocId, orderedFields]);

  const idFieldName = useMemo(
    () => findFieldByAliases(fields, rowData, ["id", "issue id", "task id", "card id", "row id"]),
    [fields, rowData]
  );
  const titleFieldName = useMemo(
    () => findFieldByAliases(fields, rowData, ["title", "task title", "name"]),
    [fields, rowData]
  );
  const statusFieldName = useMemo(
    () => findFieldByAliases(fields, rowData, ["status", "state", "task status"]),
    [fields, rowData]
  );
  const snapshotFieldName = useMemo(
    () =>
      findFieldByAliases(fields, rowData, [
        "snapshot url",
        "snapshoturl",
        "snapshot",
        "picture",
        "photo",
        "image",
      ]),
    [fields, rowData]
  );
  const linkFieldName = useMemo(
    () => findFieldByAliases(fields, rowData, ["link", "url", "issue url", "card url", "task url"]),
    [fields, rowData]
  );

  const displayId = normalizeIssueIdDisplay(
    idFieldName ? rowData[idFieldName] : decodedIssueId
  );
  const title = titleFieldName ? normalizeValue(rowData[titleFieldName]) : "";
  const status = statusFieldName ? normalizeValue(rowData[statusFieldName]) : "";
  const snapshotUrl = snapshotFieldName ? normalizeValue(rowData[snapshotFieldName]) : "";
  const externalLink = linkFieldName ? normalizeValue(rowData[linkFieldName]) : "";

  // ── field selector handlers ───────────────────────────────────────────────────

  const persistHidden = (next) => {
    try {
      localStorage.setItem(`${STORAGE_PREFIX}${projectDocId}`, JSON.stringify(next));
    } catch {}
  };

  const toggleField = (fieldName) => {
    setHiddenFields((prev) => {
      const next = { ...prev, [fieldName]: !prev[fieldName] };
      persistHidden(next);
      return next;
    });
  };

  const showAll = () => {
    setHiddenFields({});
    persistHidden({});
  };

  const hideAll = () => {
    const next = Object.fromEntries(orderedFields.map((f) => [f, true]));
    setHiddenFields(next);
    persistHidden(next);
  };

  // ── E2 metadata handlers ──────────────────────────────────────────────────────

  const saveE2Comments = async () => {
    if (!id || !projectDocId || !decodedIssueId) return;
    setSavingE2Metadata(true);
    try {
      const issueRef = doc(db, "churches", id, "bimProjects", projectDocId, "issues", decodedIssueId);
      await updateDoc(issueRef, { e2Comments: normalizeValue(e2Comments) });
      toast.success("E2 Comments saved.");
    } catch (err) {
      console.error("Error saving E2 Comments:", err);
      toast.error("Could not save E2 Comments.");
    } finally {
      setSavingE2Metadata(false);
    }
  };

  const handleDocumentUpload = async (event) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    if (!id || !projectDocId || !issueId) {
      toast.error("Issue data not fully loaded. Please refresh the page.");
      return;
    }

    const allowedCount = 10 - e2Documents.length;
    if (allowedCount <= 0) {
      toast.warn("Maximum 10 documents allowed.");
      return;
    }

    const filesToUpload = Array.from(files).slice(0, allowedCount);
    if (filesToUpload.length < files.length) {
      toast.warn(`Only ${allowedCount} document(s) can be added. Uploading the first ${allowedCount}.`);
    }

    setUploadingDocuments(true);

    try {
      const uploadedDocs = [];

      for (const file of filesToUpload) {
        const safeIssueId = (issueId || "").replace(/[^a-zA-Z0-9-_]/g, "_");
        const ext = file.name.split(".").pop();
        const timestamp = Date.now();
        const storagePath = `churches/${id}/bimProjects/${projectDocId}/e2-documents/${safeIssueId}/${timestamp}.${ext}`;
        const fileRef = storageRef(storage, storagePath);

        await uploadBytes(fileRef, file);
        const downloadURL = await getDownloadURL(fileRef);

        uploadedDocs.push({
          name: file.name,
          url: downloadURL,
          uploadedAt: new Date().toISOString(),
          storagePath,
        });
      }

      // Update Firestore: store in the issue doc's e2Documents array
      const issueDocRef = doc(db, "churches", id, "bimProjects", projectDocId, "issues", decodeURIComponent(issueId));
      const snapshot = await getDoc(issueDocRef);
      const data = snapshot.exists() ? snapshot.data() : {};
      const prevDocs = Array.isArray(data.e2Documents) ? data.e2Documents : [];
      const nextDocs = [...prevDocs, ...uploadedDocs];
      await updateDoc(issueDocRef, { e2Documents: nextDocs });

      setE2Documents(nextDocs);
      toast.success(`${uploadedDocs.length} document(s) uploaded.`);
    } catch (err) {
      console.error("Error uploading documents:", err);
      toast.error(err?.message || "Could not upload document(s).");
    } finally {
      setUploadingDocuments(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const deleteDocument = async (index) => {
    if (index < 0 || index >= e2Documents.length) return;

    const docToDelete = e2Documents[index];
    const confirmed = window.confirm(`Delete "${docToDelete.name}"?`);
    if (!confirmed) return;

    setSavingE2Metadata(true);

    try {
      // Delete from storage
      if (docToDelete.storagePath) {
        const fileRef = storageRef(storage, docToDelete.storagePath);
        await deleteObject(fileRef).catch((err) => {
          if (err.code !== "storage/object-not-found") throw err;
        });
      }

      // Update Firestore: remove from issue doc's e2Documents array
      const issueDocRef = doc(db, "churches", id, "bimProjects", projectDocId, "issues", decodeURIComponent(issueId));
      const snapshot = await getDoc(issueDocRef);
      const data = snapshot.exists() ? snapshot.data() : {};
      const prevDocs = Array.isArray(data.e2Documents) ? data.e2Documents : [];
      const updatedDocs = prevDocs.filter((_, i) => i !== index);
      await updateDoc(issueDocRef, { e2Documents: updatedDocs });

      setE2Documents(updatedDocs);
      toast.success("Document deleted.");
    } catch (err) {
      console.error("Error deleting document:", err);
      toast.error("Could not delete document.");
    } finally {
      setSavingE2Metadata(false);
    }
  };

  // ── render ────────────────────────────────────────────────────────────────────

  return (
    <div style={commonStyles.fullWidthContainer}>
      <ChurchHeader />

      <div className="pid-detail-wrap">
        {/* Back navigation */}

        <div className="pid-detail-nav" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Link
            to={`/organization/${id}/project-issue-dashboard`}
            className="pid-detail-back-link"
          >
            ← Go to Live Issues Tracker
          </Link>
          <Link
            to={`/organization/${id}/e2-agile-board`}
            className="pid-detail-back-link"
            style={{ marginLeft: 8 }}
          >
            E2 Agile Board
          </Link>
          {projectName && (
            <span className="pid-detail-project-label">{projectName}</span>
          )}
        </div>

        {loading && (
          <div className="pid-detail-status">Loading issue details…</div>
        )}
        {error && (
          <div className="pid-detail-status pid-detail-status--error">{error}</div>
        )}

        {!loading && !error && (
          <>
            {/* Hero card */}
            <div className="pid-detail-hero">
              <div className="pid-detail-hero-top">
                <div className="pid-detail-hero-ids">
                  <span className="pid-detail-hero-id">{displayId}</span>
                  {status && (
                    <span className="pid-detail-hero-status">{status}</span>
                  )}
                </div>
                {externalLink && isUrl(externalLink) && (
                  <a
                    href={externalLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="pid-detail-ext-link"
                  >
                    Open in App ↗
                  </a>
                )}
              </div>
              {title && <h2 className="pid-detail-hero-title">{title}</h2>}
              {snapshotUrl && isUrl(snapshotUrl) && (
                <div className="pid-detail-snapshot">
                  <img
                    src={snapshotUrl}
                    alt="Issue snapshot"
                    className="pid-detail-snapshot-img"
                  />
                </div>
              )}
            </div>

            <div className="pid-detail-main-grid">
              {/* Field selector panel (always visible, left side) */}
              <aside className="pid-detail-field-bar">
                <div className="pid-detail-field-selector">
                  <div className="pid-detail-fields-heading" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span className="pid-detail-fields-title">Fields</span>
                    <span className="pid-detail-fields-count">
                      ({visibleFields.length} / {orderedFields.length})
                    </span>
                  </div>
                  <div style={{ margin: '10px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <label htmlFor="column-sort-select" style={{ fontSize: '0.97em', color: '#374151' }}>Sort:</label>
                    <select id="column-sort-select" value={columnSort} onChange={handleColumnSortChange} style={{ padding: '2px 8px', borderRadius: 4 }}>
                      <option value="default">Default</option>
                      <option value="az">A-Z</option>
                      <option value="custom" disabled>Custom (coming soon)</option>
                    </select>
                  </div>
                  <div className="pid-detail-fs-actions">
                    <button
                      type="button"
                      className="pid-detail-fs-btn"
                      onClick={showAll}
                    >
                      Show all
                    </button>
                    <button
                      type="button"
                      className="pid-detail-fs-btn pid-detail-fs-btn--muted"
                      onClick={hideAll}
                    >
                      Hide all
                    </button>
                  </div>
                  <div className="pid-detail-field-checkboxes">
                    {orderedFields.map((fieldName) => (
                      <label key={fieldName} className="pid-detail-field-chk">
                        <input
                          type="checkbox"
                          checked={!hiddenFields[fieldName]}
                          onChange={() => toggleField(fieldName)}
                        />
                        <span>{fieldName}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </aside>

              {/* Detail table */}
              <div className="pid-detail-main-content">
                {visibleFields.length === 0 ? (
                  <p className="pid-detail-no-fields">
                    All fields are hidden. Use the Fields panel on the left to show fields.
                  </p>
                ) : (
                  <div className="pid-detail-table-wrap">
                    <table className="pid-detail-table">
                      <tbody>
                        {visibleFields.map((fieldName) => {
                          const raw = normalizeValue(rowData[fieldName]);
                          const isEmpty = !raw;
                          const isImageField =
                            /snapshot|photo|image|picture/i.test(fieldName);
                          const isUrlValue = isUrl(raw);

                          return (
                            <tr key={fieldName} className="pid-detail-row">
                              <th className="pid-detail-field-name">{fieldName}</th>
                              <td
                                className={`pid-detail-field-value${
                                  isEmpty ? " pid-detail-field-value--empty" : ""
                                }`}
                              >
                                {isEmpty ? (
                                  <span className="pid-detail-empty">—</span>
                                ) : isImageField && isUrlValue ? (
                                  <a
                                    href={raw}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    <img
                                      src={raw}
                                      alt={fieldName}
                                      className="pid-detail-inline-img"
                                    />
                                  </a>
                                ) : isUrlValue ? (
                                  <a
                                    href={raw}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="pid-detail-link"
                                  >
                                    {raw}
                                  </a>
                                ) : (
                                  raw
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* E2 Comments & Documents Section */}
            <div className="pid-detail-e2-section">
              {/* E2 Comments */}
              <div className="pid-detail-e2-box">
                <h3 className="pid-detail-e2-title">E2 Comments</h3>
                <textarea
                  className="pid-detail-e2-textarea"
                  value={e2Comments}
                  onChange={e => {
                    // Limit to 1000 words
                    const words = e.target.value.split(/\s+/);
                    if (words.length <= 1000) setE2Comments(e.target.value);
                  }}
                  placeholder="Add notes, observations, or feedback for E2 team members…"
                  rows={4}
                  disabled={savingE2Metadata}
                />
                <div style={{ textAlign: 'right', fontSize: '0.95em', color: e2Comments.split(/\s+/).length > 1000 ? '#dc2626' : '#666' }}>
                  {e2Comments.trim() ? e2Comments.split(/\s+/).length : 0}/1000 words
                </div>
                <div className="pid-detail-e2-actions">
                  <button
                    type="button"
                    className="pid-detail-e2-save-btn"
                    onClick={saveE2Comments}
                    disabled={savingE2Metadata}
                  >
                    {savingE2Metadata ? "Saving…" : "Add/Edit Comments"}
                  </button>
                </div>
              </div>

              {/* E2 Documents */}
              <div className="pid-detail-e2-box">
                <h3 className="pid-detail-e2-title">
                  E2 Documents
                  <span className="pid-detail-e2-count">
                    ({e2Documents.length} / 10)
                  </span>
                </h3>

                {/* Upload Area */}
                {e2Documents.length < 10 && (
                  <div className="pid-detail-upload-area">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.png,.jpg,.jpeg,.gif"
                      multiple
                      onChange={handleDocumentUpload}
                      disabled={uploadingDocuments || e2Documents.length >= 10}
                      style={{ display: "none" }}
                    />
                    <button
                      type="button"
                      className="pid-detail-upload-btn"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingDocuments || e2Documents.length >= 10}
                    >
                      {uploadingDocuments ? "Uploading…" : "📎 Add Document"}
                    </button>
                    <span className="pid-detail-upload-hint">
                      {10 - e2Documents.length} slot{10 - e2Documents.length !== 1 ? "s" : ""} available
                    </span>
                  </div>
                )}

                {/* Document List */}
                {e2Documents.length === 0 ? (
                  <p className="pid-detail-no-docs">No documents attached yet.</p>
                ) : (
                  <div className="pid-detail-doc-list">
                    {e2Documents.map((doc, index) => (
                      <div key={index} className="pid-detail-doc-item">
                        <div className="pid-detail-doc-info">
                          <a
                            href={doc.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="pid-detail-doc-name"
                          >
                            📄 {doc.name}
                          </a>
                          {doc.uploadedAt && (
                            <span className="pid-detail-doc-date">
                              {new Date(doc.uploadedAt).toLocaleDateString()} {new Date(doc.uploadedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          className="pid-detail-doc-delete"
                          onClick={() => deleteDocument(index)}
                          disabled={savingE2Metadata}
                          title="Delete this document"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          {/* Log Section */}
          <div className="pid-detail-log-section" style={{ marginTop: 40 }}>
            <h3 style={{ fontWeight: 600, marginBottom: 12 }}>Issue Log</h3>
            <div style={{ marginBottom: 16 }}>
              <input
                type="text"
                placeholder="Update description"
                value={newLogUpdate}
                onChange={e => setNewLogUpdate(e.target.value)}
                style={{ width: 240, marginRight: 8 }}
                disabled={logLoading}
              />
              <input
                type="number"
                placeholder="% Completed"
                value={newLogPercent}
                onChange={e => setNewLogPercent(e.target.value)}
                style={{ width: 120, marginRight: 8 }}
                min={0}
                max={100}
                disabled={logLoading}
              />
              <button
                type="button"
                onClick={handleAddLogEntry}
                disabled={logLoading || !newLogUpdate.trim()}
                style={{ padding: "6px 16px" }}
              >
                {logLoading ? "Adding…" : "Add Log Entry"}
              </button>
            </div>
            <table className="pid-detail-log-table" style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#f3f4f6" }}>
                  <th style={{ padding: 8, borderBottom: "1px solid #e5e7eb" }}>Update</th>
                  <th style={{ padding: 8, borderBottom: "1px solid #e5e7eb" }}>% Completed</th>
                  <th style={{ padding: 8, borderBottom: "1px solid #e5e7eb" }}>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {logEntries.length === 0 ? (
                  <tr><td colSpan={3} style={{ textAlign: "center", padding: 16 }}>No log entries yet.</td></tr>
                ) : (
                  logEntries.map((entry, idx) => (
                    <tr key={idx}>
                      <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>{entry.update}</td>
                      <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>{entry.percent}%</td>
                      <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>{formatTimestamp(entry.timestamp)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  </div>
  );
};

export default ProjectIssueDetail;
