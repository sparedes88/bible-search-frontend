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
import React, { useEffect, useState } from "react";
import { getDoc } from "firebase/firestore";
import { getFirestore, collection, getDocs, doc, updateDoc, onSnapshot } from "firebase/firestore";
import { Link } from "react-router-dom";

// Simple grid/table for displaying issues
export default function LiveIssueTracker() {
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedProject, setSelectedProject] = useState("");
  const [showPopup, setShowPopup] = useState(false);
  const [popupIssue, setPopupIssue] = useState(null);
  const [tdValue, setTdValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [tdOptions, setTdOptions] = useState([]);

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
    // Fetch technical direction options (one-time)
    const fetchTDOptions = async () => {
      try {
        const configRef = doc(db, "/churches/2155/settings/projectIssueDashboardConfig");
        const configSnap = await getDoc(configRef);
        const configData = configSnap.exists() ? configSnap.data() : {};
        setTdOptions(Array.isArray(configData.technicalDirectionOptions) ? configData.technicalDirectionOptions : []);
      } catch (err) {
        // ignore, already handled above
      }
    };
    fetchTDOptions();
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

  // Filter issues by selected project name
  const filteredIssues = selectedProject
    ? issues.filter(issue => {
        const name = issue["Project Name"] || issue.projectName || issue.project || "";
        return (name === "" ? "--" : name) === selectedProject;
      })
    : issues;

  // Open popup for a specific issue
  const handleOpenPopup = (issue) => {
    setPopupIssue(issue);
    setTdValue(issue["Technical Direction"] || issue.technicalDirection || "");
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
      await updateDoc(issueDocRef, { "Technical Direction": tdValue });
      setShowPopup(false);
      // Update local state for immediate UI feedback
      setIssues(prev => prev.map(iss => iss.id === popupIssue.id ? { ...iss, "Technical Direction": tdValue } : iss));
    } catch (err) {
      setSaveError("Failed to save. " + (err.message || ""));
    }
    setSaving(false);
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 16 }}>
        <Link to="/organization/2155/project-issue-dashboard" style={{ fontWeight: "bold", color: "#0ea5e9" }}>
          📋 Go to Project Issue Dashboard
        </Link>
      </div>
      <h2>Live Issue Tracker</h2>
      <div style={{ margin: "16px 0" }}>
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
                  if (disabled && agile) {
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
          <div style={{ background: "#fff", padding: 32, borderRadius: 8, minWidth: 320, boxShadow: "0 2px 16px #0002" }}>
            <h3 style={{ marginTop: 0 }}>Edit Technical Direction</h3>
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
