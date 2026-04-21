  // Disable row handler
  const handleDisableRow = async (issue) => {
    if (!issue || !issue.id) return;
    try {
      const db = getFirestore();
      const issueDocRef = doc(db, "/churches/2155/bimProjects/stanford-ff-rad/issues/" + issue.id);
      await updateDoc(issueDocRef, {
        "Disable Flag": "Yes"
      });
    } catch (err) {
      alert("Failed to disable row. " + (err.message || ""));
    }
  };
// ...imports and main component below...

import React, { useState, useRef, useEffect } from "react";
import { getFirestore, collection, onSnapshot, doc, getDoc, updateDoc, setDoc, writeBatch, serverTimestamp } from "firebase/firestore";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "../firebase";
import { Link } from "react-router-dom";
import * as XLSX from "xlsx";

const ISSUE_ID_ALIASES = ["id", "issue id", "task id", "card id", "row id"];

const normalizeHeaderKey = (value) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");

const normalizeCellValue = (value) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
};

const getIssueIdFromRow = (rowData) => {
  const keys = Object.keys(rowData || {});
  for (const alias of ISSUE_ID_ALIASES) {
    const foundKey = keys.find((key) => normalizeHeaderKey(key) === alias);
    if (!foundKey) continue;
    const candidate = normalizeCellValue(rowData[foundKey]);
    if (candidate) return candidate;
  }
  return "";
};

// Simple grid/table for displaying issues
export default function LiveIssueTracker() {
  // State for edit popup extra fields (must be inside component)
  const [editFields, setEditFields] = useState({
    leadDetailer: "",
    supportTeam: [],
    dataStage: "Testing",
    comments: "",
    documents: [],
    uploadingFiles: [],
    uploadError: ""
  });
  const fileInputRef = useRef();
  const excelUploadInputRef = useRef();
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedProject, setSelectedProject] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [showPopup, setShowPopup] = useState(false);
  const [popupIssue, setPopupIssue] = useState(null);
  const [tdValue, setTdValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [tdOptions, setTdOptions] = useState([]);
  // Add Issue popup state
  const [showAddPopup, setShowAddPopup] = useState(false);
  const [addForm, setAddForm] = useState({
    title: "",
    projectName: "",
    requester: "",
    leadDetailer: "",
    supportTeam: [],
    dataStage: "Testing",
    sendToAgile: "No"
  });
  const [addFormError, setAddFormError] = useState("");
  const [addFormLoading, setAddFormLoading] = useState(false);
  const [projectNameOptions, setProjectNameOptions] = useState([]);
  const [e2DetailerOptions, setE2DetailerOptions] = useState([]);
  const [excelUploading, setExcelUploading] = useState(false);
  const [excelUploadError, setExcelUploadError] = useState("");
  const [excelUploadSummary, setExcelUploadSummary] = useState(null);

  // Generate next ID (TD-xxxx)
  const generateNextId = () => {
    const maxNum = issues
      .map(i => (typeof i.id === "string" && i.id.startsWith("TD-") ? parseInt(i.id.replace("TD-", ""), 10) : 0))
      .filter(n => !isNaN(n))
      .reduce((a, b) => Math.max(a, b), 0);
    return `TD-${(maxNum + 1).toString().padStart(4, "0")}`;
  };

  // Handle add form field changes
  const handleAddFormChange = (field, value) => {
    setAddForm(f => ({ ...f, [field]: value }));
    setAddFormError("");
  };

  // Handle add form submit
  const handleAddFormSubmit = async (e) => {
    e.preventDefault();
    setAddFormError("");
    setAddFormLoading(true);
    const newId = generateNextId();
    const docData = {
      id: newId,
      ID: newId,
      Title: addForm.title,
      "Project Name": addForm.projectName,
      Assignee: addForm.requester,
      "E2 Detailer": addForm.leadDetailer,
      "E2 Detailer Support Team": addForm.supportTeam,
      "Data Stage": addForm.dataStage,
      status: "Open",
      "Disable Flag": addForm.sendToAgile === "Yes" ? "Yes" : "No",
      "E2 Status Update Agile": addForm.sendToAgile === "Yes" ? "To Do List" : ""
    };
    try {
      const db = getFirestore();
      const newDocRef = doc(db, "/churches/2155/bimProjects/stanford-ff-rad/issues/" + newId);
      await setDoc(newDocRef, docData);
      setShowAddPopup(false);
      setAddForm({
        title: "",
        projectName: "",
        requester: "",
        leadDetailer: "",
        supportTeam: [],
        dataStage: "Testing",
        sendToAgile: "No"
      });
    } catch (err) {
      setAddFormError("Failed to add issue. " + (err.message || ""));
    }
    setAddFormLoading(false);
  };

  const handleSecondTabUpload = async (event) => {
    const file = event?.target?.files?.[0];
    if (!file) return;

    setExcelUploading(true);
    setExcelUploadError("");
    setExcelUploadSummary(null);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: "array", cellDates: true });

      if (!Array.isArray(workbook.SheetNames) || workbook.SheetNames.length < 2) {
        throw new Error("The uploaded file does not include a second tab.");
      }

      const secondSheetName = workbook.SheetNames[1];
      const secondSheet = workbook.Sheets[secondSheetName];
      const rawRows = XLSX.utils.sheet_to_json(secondSheet, { defval: "", raw: false });

      if (!rawRows.length) {
        throw new Error("The second tab is empty.");
      }

      const db = getFirestore();
      const existingIds = new Set(
        issues
          .map((issue) => normalizeCellValue(issue?.id || issue?.ID))
          .filter(Boolean)
      );

      let createdCount = 0;
      let updatedCount = 0;
      let skippedMissingId = 0;
      let skippedEmptyRows = 0;
      let processedCount = 0;
      let batch = writeBatch(db);
      let opsInBatch = 0;

      for (const rawRow of rawRows) {
        const normalizedRow = {};
        for (const [header, value] of Object.entries(rawRow || {})) {
          const key = String(header || "").trim();
          if (!key) continue;
          normalizedRow[key] = normalizeCellValue(value);
        }

        if (!Object.keys(normalizedRow).length) {
          skippedEmptyRows += 1;
          continue;
        }

        const issueId = getIssueIdFromRow(normalizedRow);
        if (!issueId) {
          skippedMissingId += 1;
          continue;
        }

        const issueRef = doc(db, "/churches/2155/bimProjects/stanford-ff-rad/issues/" + issueId);
        if (existingIds.has(issueId)) {
          updatedCount += 1;
        } else {
          createdCount += 1;
          existingIds.add(issueId);
        }

        batch.set(
          issueRef,
          {
            ...normalizedRow,
            id: issueId,
            ID: issueId,
            lastExcelImportFile: file.name,
            lastExcelImportAt: serverTimestamp(),
          },
          { merge: true }
        );

        processedCount += 1;
        opsInBatch += 1;

        if (opsInBatch >= 400) {
          await batch.commit();
          batch = writeBatch(db);
          opsInBatch = 0;
        }
      }

      if (opsInBatch > 0) {
        await batch.commit();
      }

      setExcelUploadSummary({
        fileName: file.name,
        sheetName: secondSheetName,
        totalRows: rawRows.length,
        processed: processedCount,
        created: createdCount,
        updated: updatedCount,
        skippedMissingId,
        skippedEmptyRows,
      });
    } catch (err) {
      setExcelUploadError(err?.message || "Failed to upload second tab.");
    } finally {
      setExcelUploading(false);
      if (event?.target) {
        event.target.value = "";
      }
    }
  };

  useEffect(() => {
    const db = getFirestore();
    setLoading(true);
    setError(null);
    // Real-time listener for issues
    const issuesColRef = collection(db, "/churches/2155/bimProjects/stanford-ff-rad/issues");
    const unsubscribe = onSnapshot(issuesColRef, (querySnapshot) => {
      const allIssues = querySnapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
      setIssues(allIssues);
      setLoading(false);
    }, (err) => {
      setError("Failed to fetch issues");
      setIssues([]);
      setLoading(false);
    });
    // Fetch config for dropdowns (one-time)
    const fetchConfigOptions = async () => {
      try {
        const configRef = doc(db, "/churches/2155/settings/projectIssueDashboardConfig");
        const configSnap = await getDoc(configRef);
        const configData = configSnap.exists() ? configSnap.data() : {};
        setTdOptions(Array.isArray(configData.technicalDirectionOptions) ? configData.technicalDirectionOptions : []);
        setProjectNameOptions(Array.isArray(configData.projectNameValues) ? configData.projectNameValues : []);
        setE2DetailerOptions(Array.isArray(configData.e2DetailerOptions) ? configData.e2DetailerOptions : []);
      } catch (err) {
        // ignore, already handled above
      }
    };
    fetchConfigOptions();
    return () => unsubscribe();
  }, []);

  // Get unique project names from issues
  let projectNames = Array.from(
    new Set(
      issues.map(issue => {
        const name = issue["Project Name"] || issue.projectName || issue.project || "";
        return name === "" ? "--" : name;
      })
    )
  );

  // Send to Agile Board handler
  const handleSendToAgile = async (issue) => {
    if (!issue || !issue.id) return;
    try {
      const db = getFirestore();
      const issueDocRef = doc(db, "/churches/2155/bimProjects/stanford-ff-rad/issues/" + issue.id);
      await updateDoc(issueDocRef, {
        "Disable Flag": "Yes",
        "E2 Status Update Agile": "To Do List"
      });
      // Update local state for immediate UI feedback
      setIssues(prev => prev.map(iss =>
        iss.id === issue.id
          ? { ...iss, "Disable Flag": "Yes", "E2 Status Update Agile": "To Do List" }
          : iss
      ));
    } catch (err) {
      alert("Failed to send to Agile Board. " + (err.message || ""));
    }
  };

  // Sort alphabetically, with '--' (empty) always first if present
  projectNames = projectNames.sort((a, b) => {
    if (a === "--") return -1;
    if (b === "--") return 1;
    return a.localeCompare(b);
  });

  // Filter issues by selected project name and search term
  const normalizedSearchTerm = searchTerm.trim().toLowerCase();
  const filteredIssues = issues.filter(issue => {
    const name = issue["Project Name"] || issue.projectName || issue.project || "";
    const projectMatches = !selectedProject || (name === "" ? "--" : name) === selectedProject;
    if (!projectMatches) return false;

    if (!normalizedSearchTerm) return true;

    const issueId = String(issue.id || issue.ID || issue["Issue ID"] || "").toLowerCase();
    const title = String(issue.Title || issue.title || "").toLowerCase();
    return issueId.includes(normalizedSearchTerm) || title.includes(normalizedSearchTerm);
  });

  // Open popup for a specific issue
  const handleOpenPopup = (issue) => {
    setPopupIssue(issue);
    setTdValue(issue["Technical Direction"] || issue.technicalDirection || "");
    setEditFields({
      leadDetailer: issue["E2 Detailer"] || "",
      supportTeam: Array.isArray(issue["E2 Detailer Support Team"]) ? issue["E2 Detailer Support Team"] : [],
      dataStage: issue["Data Stage"] || "Testing",
      comments: issue["e2Comments"] || "",
      documents: Array.isArray(issue["e2Documents"]) ? issue["e2Documents"] : [],
      uploadingFiles: [],
      uploadError: ""
    });
    setShowPopup(true);
    setSaveError("");
  };

  // Save Technical Direction to Firestore
  const handleSaveTD = async () => {
    if (!popupIssue) return;
    setSaving(true);
    setSaveError("");
    try {
      const db = getFirestore();
      const issueDocRef = doc(db, "/churches/2155/bimProjects/stanford-ff-rad/issues/" + popupIssue.id);
      // Upload new documents if any
      let uploadedDocs = editFields.documents || [];
      if (editFields.uploadingFiles && editFields.uploadingFiles.length > 0) {
        uploadedDocs = [...uploadedDocs];
        for (let file of editFields.uploadingFiles) {
          const safeIssueId = (popupIssue.id || "").replace(/[^a-zA-Z0-9-_]/g, "_");
          const ext = file.name.split(".").pop();
          const timestamp = Date.now();
          const storagePath = `churches/2155/bimProjects/stanford-ff-rad/e2-documents/${safeIssueId}/${timestamp}.${ext}`;
          const fileRef = storageRef(storage, storagePath);
          await uploadBytes(fileRef, file);
          const url = await getDownloadURL(fileRef);
          uploadedDocs.push({
            name: file.name,
            url,
            uploadedAt: new Date().toISOString(),
            storagePath,
          });
        }
      }
      await updateDoc(issueDocRef, {
        "Technical Direction": tdValue,
        "E2 Detailer": editFields.leadDetailer,
        "E2 Detailer Support Team": editFields.supportTeam,
        "Data Stage": editFields.dataStage,
        "e2Comments": editFields.comments,
        "e2Documents": uploadedDocs,
        "E2 Status Update": "To Do List"
      });
      setShowPopup(false);
      setEditFields(f => ({ ...f, uploadingFiles: [] }));
    } catch (err) {
      setSaveError("Failed to save. " + (err.message || ""));
    }
    setSaving(false);
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 24 }}>
        <Link
          to="/organization/2155/e2-agile-board"
          style={{
            fontWeight: "bold",
            color: "#fff",
            background: "#f59e42",
            border: "none",
            borderRadius: 4,
            padding: "8px 18px",
            fontSize: 15,
            textDecoration: "none",
            marginRight: 8
          }}
        >
          🏃 Agile Dashboard
        </Link>
        <Link to="/organization/2155/project-issue-dashboard" style={{ fontWeight: "bold", color: "#0ea5e9" }}>
          📋 Go to Project Issue Dashboard
        </Link>
        <button
          style={{ background: "#0ea5e9", color: "#fff", border: "none", borderRadius: 4, padding: "8px 18px", fontWeight: 600, fontSize: 15, cursor: "pointer" }}
          onClick={() => setShowAddPopup(true)}
        >
          ➕ Add a New Issue/Task
        </button>
        <Link
          to="/organization/2155/project-issue-dashboard/e2-detailers"
          style={{
            background: "#f59e42",
            color: "#fff",
            border: "none",
            borderRadius: 4,
            padding: "8px 18px",
            fontWeight: 600,
            fontSize: 15,
            cursor: "pointer",
            textDecoration: "none"
          }}
        >
          🛠️ Manage E2 Fields
        </Link>
        <input
          ref={excelUploadInputRef}
          type="file"
          accept=".xlsx,.xls"
          onChange={handleSecondTabUpload}
          style={{ display: "none" }}
        />
        <button
          style={{
            background: "#0f766e",
            color: "#fff",
            border: "none",
            borderRadius: 4,
            padding: "8px 18px",
            fontWeight: 600,
            fontSize: 15,
            cursor: excelUploading ? "not-allowed" : "pointer",
            opacity: excelUploading ? 0.7 : 1,
          }}
          onClick={() => excelUploadInputRef.current?.click()}
          disabled={excelUploading}
        >
          {excelUploading ? "Uploading Excel File..." : "📥 Upload Excel File"}
        </button>
      </div>
      {(excelUploadError || excelUploadSummary) && (
        <div
          style={{
            position: "fixed",
            left: 0,
            top: 0,
            width: "100vw",
            height: "100vh",
            background: "rgba(0,0,0,0.3)",
            zIndex: 1100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center"
          }}
        >
          <div
            style={{
              background: "#fff",
              padding: 28,
              borderRadius: 8,
              minWidth: 420,
              maxWidth: 560,
              boxShadow: "0 2px 16px #0002"
            }}
          >
            <h3 style={{ marginTop: 0, marginBottom: 16 }}>Excel Upload Summary</h3>
            {excelUploadError && (
              <div style={{ color: "#b91c1c", fontWeight: 600, marginBottom: 16 }}>
                Upload failed: {excelUploadError}
              </div>
            )}
            {excelUploadSummary && (
              <div style={{ display: "grid", gap: 8, marginBottom: 20 }}>
                <div>File: {excelUploadSummary.fileName}</div>
                <div>Tab: {excelUploadSummary.sheetName}</div>
                <div>Total rows read: {excelUploadSummary.totalRows}</div>
                <div>Issues created: {excelUploadSummary.created}</div>
                <div>Issues updated: {excelUploadSummary.updated}</div>
                <div>Rows skipped (missing ID): {excelUploadSummary.skippedMissingId}</div>
                <div>Rows skipped (empty): {excelUploadSummary.skippedEmptyRows}</div>
                <div>Rows processed: {excelUploadSummary.processed}</div>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => {
                  setExcelUploadError("");
                  setExcelUploadSummary(null);
                }}
                style={{
                  padding: "8px 16px",
                  background: "#0ea5e9",
                  color: "#fff",
                  border: "none",
                  borderRadius: 4,
                  cursor: "pointer"
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
            {/* Add Issue Popup */}
            {showAddPopup && (
              <div style={{
                position: "fixed", left: 0, top: 0, width: "100vw", height: "100vh", background: "rgba(0,0,0,0.3)", zIndex: 1000,
                display: "flex", alignItems: "center", justifyContent: "center"
              }}>
                <form
                  onSubmit={handleAddFormSubmit}
                  style={{ background: "#fff", padding: 32, borderRadius: 8, minWidth: 400, boxShadow: "0 2px 16px #0002", maxWidth: 480 }}
                >
                  <h3 style={{ marginTop: 0 }}>Add a New Issue/Task</h3>
                  <div style={{ marginBottom: 14 }}>
                    <label style={{ fontWeight: 500 }}>ID:</label>
                    <input type="text" value={generateNextId()} disabled style={{ width: "100%", marginTop: 6, padding: 8, fontSize: 15, background: "#f3f4f6" }} />
                  </div>
                  <div style={{ marginBottom: 14 }}>
                    <label style={{ fontWeight: 500 }}>Title:</label>
                    <input type="text" value={addForm.title} onChange={e => handleAddFormChange("title", e.target.value)} required style={{ width: "100%", marginTop: 6, padding: 8, fontSize: 15 }} />
                  </div>
                  <div style={{ marginBottom: 14 }}>
                    <label style={{ fontWeight: 500 }}>Project Name:</label>
                    <select value={addForm.projectName} onChange={e => handleAddFormChange("projectName", e.target.value)} required style={{ width: "100%", marginTop: 6, padding: 8, fontSize: 15 }}>
                      <option value="">Select a project</option>
                      {projectNameOptions.map((opt, idx) => (
                        <option key={idx} value={opt}>{opt}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ marginBottom: 14 }}>
                    <label style={{ fontWeight: 500 }}>Requester:</label>
                    <select value={addForm.requester} onChange={e => handleAddFormChange("requester", e.target.value)} required style={{ width: "100%", marginTop: 6, padding: 8, fontSize: 15 }}>
                      <option value="">Select a requester</option>
                      {e2DetailerOptions.map((opt, idx) => (
                        <option key={idx} value={opt}>{opt}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ marginBottom: 14 }}>
                    <label style={{ fontWeight: 500 }}>Lead Detailer:</label>
                    <select value={addForm.leadDetailer} onChange={e => handleAddFormChange("leadDetailer", e.target.value)} required style={{ width: "100%", marginTop: 6, padding: 8, fontSize: 15 }}>
                      <option value="">Select a lead detailer</option>
                      {e2DetailerOptions.map((opt, idx) => (
                        <option key={idx} value={opt}>{opt}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ marginBottom: 14 }}>
                    <label style={{ fontWeight: 500 }}>Support Team:</label>
                    <select
                      multiple
                      value={addForm.supportTeam}
                      onChange={e => {
                        const selected = Array.from(e.target.selectedOptions).map(opt => opt.value);
                        handleAddFormChange("supportTeam", selected);
                      }}
                      style={{ width: "100%", marginTop: 6, padding: 8, fontSize: 15, minHeight: 60 }}
                    >
                      {e2DetailerOptions.map((opt, idx) => (
                        <option
                          key={idx}
                          value={opt}
                          disabled={addForm.leadDetailer === opt}
                          style={addForm.leadDetailer === opt ? { color: "#aaa" } : {}}
                        >
                          {opt}
                        </option>
                      ))}
                    </select>
                    <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>
                      (Lead Detailer is grayed out and cannot be selected here)
                    </div>
                  </div>
                  <div style={{ marginBottom: 14 }}>
                    <label style={{ fontWeight: 500 }}>Data Environment:</label>
                    <select value={addForm.dataStage} onChange={e => handleAddFormChange("dataStage", e.target.value)} required style={{ width: "100%", marginTop: 6, padding: 8, fontSize: 15 }}>
                      <option value="Testing">Testing</option>
                      <option value="Production">Production</option>
                    </select>
                  </div>
                  <div style={{ marginBottom: 18 }}>
                    <label style={{ fontWeight: 500 }}>Send to Agile:</label>
                    <select value={addForm.sendToAgile} onChange={e => handleAddFormChange("sendToAgile", e.target.value)} required style={{ width: "100%", marginTop: 6, padding: 8, fontSize: 15 }}>
                      <option value="No">No</option>
                      <option value="Yes">Yes</option>
                    </select>
                  </div>
                  {addFormError && <div style={{ color: "red", marginBottom: 10 }}>{addFormError}</div>}
                  <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
                    <button type="button" onClick={() => setShowAddPopup(false)} disabled={addFormLoading} style={{ padding: "6px 16px" }}>Cancel</button>
                    <button type="submit" disabled={addFormLoading} style={{ padding: "6px 16px", background: "#0ea5e9", color: "#fff", border: "none", borderRadius: 4 }}>
                      {addFormLoading ? "Saving..." : "Save"}
                    </button>
                  </div>
                </form>
              </div>
            )}
      <h2>Live Issue Tracker</h2>
      <div style={{ margin: "16px 0", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <div>
          <label htmlFor="projectNameSelect" style={{ fontWeight: 500, marginRight: 8 }}>Project Name:</label>
          <select
            id="projectNameSelect"
            value={selectedProject}
            onChange={e => setSelectedProject(e.target.value)}
            style={{ padding: "4px 8px", minWidth: 180 }}
          >
            <option value="">All Projects</option>
            {projectNames.map(name => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="issueSearchInput" style={{ fontWeight: 500, marginRight: 8 }}>Search Issue ID or Title:</label>
          <input
            id="issueSearchInput"
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Type issue ID or title"
            style={{ padding: "4px 8px", minWidth: 240 }}
          />
        </div>
      </div>
      {loading && <div>Loading...</div>}
      {error && <div style={{ color: "red" }}>{error}</div>}
      {!loading && !error && (
        <table border="1" cellPadding="8" style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th>#</th>
              <th>ID</th>
              <th>Markup</th>
              <th>Project Name</th>
              <th>Technical Direction</th>
              <th>Status</th>
              <th>E2 Status Update</th>
              <th>E2 Status Update Agile</th>
              <th>Disable Flag</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredIssues.length === 0 && (
              <tr>
                <td colSpan="10" style={{ textAlign: "center" }}>No issues found.</td>
              </tr>
            )}
            {filteredIssues.map((issue, idx) => (
              <tr
                key={issue.id || idx}
                style={(() => {
                  const disabled = issue["Disable Flag"] === "Yes" || issue.disableFlag === "Yes";
                  const agile = issue["E2 Status Update Agile"] || issue.e2StatusUpdateAgile;
                  const e2Status = issue["E2 Status Update"] || issue.e2StatusUpdate;
                  if (e2Status === "To Do List") {
                    return { background: "#fef9c3" };
                  } else if (disabled && agile) {
                    return { background: "#e0f2fe" };
                  } else if (disabled && !agile) {
                    return { background: "#fee2e2" };
                  }
                  return undefined;
                })()}
              >
                <td>{idx + 1}</td>
                <td>
                  {issue.id ? (
                    <Link
                      to={`/organization/2155/project-issue-dashboard/issue/stanford-ff-rad/${issue.id}`}
                      style={{ color: "#0ea5e9", fontWeight: 600, textDecoration: "underline" }}
                    >
                      {issue.id}
                    </Link>
                  ) : "-"}
                </td>
                <td>
                  {issue["Link to markup"] ? (
                    <img
                      src={issue["Link to markup"]}
                      alt="Markup Preview"
                      style={{ maxWidth: 100, maxHeight: 80, objectFit: "contain", border: "1px solid #ccc", borderRadius: 4 }}
                    />
                  ) : (
                    "-"
                  )}
                </td>
                <td>{issue["Project Name"] || issue.projectName || issue.project || "-"}</td>
                <td>{issue["Technical Direction"] || issue.technicalDirection || "-"}</td>
                <td>{issue.status || "-"}</td>
                <td>{issue["E2 Status Update"] || issue.e2StatusUpdate || "-"}</td>
                <td>{issue["E2 Status Update Agile"] || issue.e2StatusUpdateAgile || "-"}</td>
                <td>{issue["Disable Flag"] !== undefined ? String(issue["Disable Flag"]) : (issue.disableFlag !== undefined ? String(issue.disableFlag) : "-")}</td>
                <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                  <button
                    title="Add Technical Direction"
                    style={{ background: "none", border: "none", cursor: "pointer" }}
                    onClick={() => handleOpenPopup(issue)}
                  >
                    <img
                      src="https://img.icons8.com/ios-filled/32/000000/add--v1.png"
                      alt="Add TD"
                      style={{ width: 24, height: 24, verticalAlign: "middle", marginRight: 4 }}
                    />
                    <span style={{ fontWeight: 600, color: "#0ea5e9", fontSize: 13 }}>Add TD</span>
                  </button>
                  <a
                    href="/live-issue-tracker"
                    title="Send to Agile Board"
                    style={{ marginLeft: 12, display: "inline-block", verticalAlign: "middle" }}
                    onClick={e => {
                      e.preventDefault();
                      handleSendToAgile(issue);
                    }}
                  >
                    <img
                      src="https://img.icons8.com/ios-filled/32/000000/sent.png"
                      alt="Send to Agile Board"
                      style={{ width: 24, height: 24, verticalAlign: "middle" }}
                    />
                  </a>
                  <button
                    title="Disable Row"
                    style={{ background: "none", border: "none", cursor: "pointer", marginLeft: 12 }}
                    onClick={() => handleDisableRow(issue)}
                  >
                    <img
                      src="https://img.icons8.com/ios-filled/32/000000/cancel.png"
                      alt="Disable Row"
                      style={{ width: 24, height: 24, verticalAlign: "middle" }}
                    />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Popup for Technical Direction */}
      {showPopup && popupIssue && (
        <div style={{
          position: "fixed", left: 0, top: 0, width: "100vw", height: "100vh", background: "rgba(0,0,0,0.3)", zIndex: 1000,
          display: "flex", alignItems: "center", justifyContent: "center"
        }}>
          <div style={{ background: "#fff", padding: 32, borderRadius: 8, minWidth: 400, boxShadow: "0 2px 16px #0002", maxWidth: 520 }}>
            <h3 style={{ marginTop: 0 }}>Edit/Add Technical Direction</h3>
            <div style={{ marginBottom: 12, fontWeight: 500, color: '#0ea5e9' }}>
              Issue ID: {popupIssue?.id || "-"}
            </div>
            <div style={{ marginBottom: 16 }}>
              <label htmlFor="tdInput" style={{ fontWeight: 500 }}>Technical Direction:</label>
              <select
                id="tdInput"
                value={tdValue}
                onChange={e => setTdValue(e.target.value)}
                style={{ width: "100%", marginTop: 8, padding: 8, fontSize: 15 }}
                disabled={saving}
              >
                <option value="">Select a value</option>
                {tdOptions.map((opt, idx) => (
                  <option key={idx} value={opt}>{opt}</option>
                ))}
              </select>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontWeight: 500 }}>Lead Detailer:</label>
              <select
                value={editFields.leadDetailer}
                onChange={e => setEditFields(f => ({ ...f, leadDetailer: e.target.value }))}
                disabled={saving}
                style={{ width: "100%", marginTop: 8, padding: 8, fontSize: 15 }}
              >
                <option value="">Select a lead detailer</option>
                {e2DetailerOptions.map((opt, idx) => (
                  <option key={idx} value={opt}>{opt}</option>
                ))}
              </select>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontWeight: 500 }}>Support Team:</label>
              <select
                multiple
                value={editFields.supportTeam}
                onChange={e => {
                  const selected = Array.from(e.target.selectedOptions).map(opt => opt.value);
                  setEditFields(f => ({ ...f, supportTeam: selected }));
                }}
                disabled={saving}
                style={{ width: "100%", marginTop: 8, padding: 8, fontSize: 15, minHeight: 60 }}
              >
                {e2DetailerOptions.map((opt, idx) => (
                  <option
                    key={idx}
                    value={opt}
                    disabled={editFields.leadDetailer === opt}
                    style={editFields.leadDetailer === opt ? { color: "#aaa" } : {}}
                  >
                    {opt}
                  </option>
                ))}
              </select>
              <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>
                (Lead Detailer is grayed out and cannot be selected here)
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontWeight: 500 }}>Data Environment:</label>
              <select
                value={editFields.dataStage}
                onChange={e => setEditFields(f => ({ ...f, dataStage: e.target.value }))}
                disabled={saving}
                style={{ width: "100%", marginTop: 8, padding: 8, fontSize: 15 }}
              >
                <option value="Testing">Testing</option>
                <option value="Production">Production</option>
              </select>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontWeight: 500 }}>Comments:</label>
              <textarea
                value={editFields.comments}
                onChange={e => setEditFields(f => ({ ...f, comments: e.target.value.slice(0, 1000) }))}
                maxLength={1000}
                rows={4}
                style={{ width: "100%", marginTop: 8, padding: 8, fontSize: 15 }}
                disabled={saving}
              />
              <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>{editFields.comments.length}/1000 words</div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontWeight: 500, display: 'block', marginBottom: 6 }}>Documents:</label>
              <div className="pid-detail-upload-area" style={{ margin: 0, padding: '0.75rem 1rem' }}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.png,.jpg,.jpeg,.gif"
                  multiple
                  onChange={e => {
                    const files = Array.from(e.target.files || []);
                    if (files.length + (editFields.documents.length || 0) > 10) {
                      setEditFields(f => ({ ...f, uploadError: "You can upload up to 10 files only." }));
                    } else {
                      setEditFields(f => ({ ...f, uploadingFiles: files, uploadError: "" }));
                    }
                  }}
                  disabled={saving || (editFields.documents.length + (editFields.uploadingFiles?.length || 0) >= 10)}
                  style={{ display: "none" }}
                />
                <button
                  type="button"
                  className="pid-detail-upload-btn"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={saving || (editFields.documents.length + (editFields.uploadingFiles?.length || 0) >= 10)}
                >
                  {saving ? "Uploading…" : "📎 Add Document"}
                </button>
                <span className="pid-detail-upload-hint">
                  {10 - (editFields.documents.length + (editFields.uploadingFiles?.length || 0))} slot{10 - (editFields.documents.length + (editFields.uploadingFiles?.length || 0)) !== 1 ? "s" : ""} available
                </span>
                {editFields.uploadError && <div style={{ color: "#dc2626", fontSize: 13, marginTop: 4 }}>{editFields.uploadError}</div>}
                <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: 13, width: '100%' }}>
                  {(editFields.documents || []).map((doc, idx) => (
                    <li key={idx}><a href={doc.url} target="_blank" rel="noopener noreferrer">{doc.name}</a></li>
                  ))}
                  {editFields.uploadingFiles && editFields.uploadingFiles.map((file, idx) => (
                    <li key={"new-"+idx}>{file.name} (to be uploaded)</li>
                  ))}
                </ul>
              </div>
            </div>
            {saveError && <div style={{ color: "red", marginBottom: 8 }}>{saveError}</div>}
            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
              <button onClick={() => setShowPopup(false)} disabled={saving} style={{ padding: "6px 16px" }}>Cancel</button>
              <button onClick={handleSaveTD} disabled={saving} style={{ padding: "6px 16px", background: "#0ea5e9", color: "#fff", border: "none", borderRadius: 4 }}>
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
