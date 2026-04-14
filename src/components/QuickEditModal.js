import "./QuickEditModal.css";
import React, { useState, useEffect } from "react";
import { findFieldByAliases } from "./ProjectIssueDetail";


export default function QuickEditModal({ isOpen, onClose, issue, issueId, onSubmit, projectNameOptions, technicalDirectionOptions, leadDetailerOptions, supportTeamOptions, dataStageOptions }) {
      const [supportTeamDropdownOpen, setSupportTeamDropdownOpen] = useState(false);
    // Debug: print the full rowData for this issue when the modal opens
    React.useEffect(() => {
      if (isOpen && issue) {
        console.log('[QuickEditModal rowData]', issue.rowData);
      }
    }, [isOpen, issue]);
  // Prefer value from rowData if available
  const supportTeamRaw = issue?.rowData?.["E2 Detailer Support Team"] ?? issue?.e2DetailerSupportTeam;
  // Always map E2 Comments to the 'e2Comments' field in Firestore
  const rowData = issue?.rowData || {};
  const e2CommentsValue = rowData['e2Comments'] ?? issue?.e2Comments ?? "";
  const [form, setForm] = useState({
    projectName: issue?.projectName || "",
    title: issue?.title || "",
    technicalDirection: issue?.technicalDirection || "",
    e3LeadDetailer: issue?.e3LeadDetailer || "",
    e2DetailerSupportTeam: Array.isArray(supportTeamRaw)
      ? supportTeamRaw
      : typeof supportTeamRaw === "string" && supportTeamRaw.includes(",")
      ? supportTeamRaw.split(",").map(s => s.trim()).filter(Boolean)
      : typeof supportTeamRaw === "string" && supportTeamRaw
      ? [supportTeamRaw]
      : [],
    e2Comments: e2CommentsValue,
    dataStage: issue?.dataStage || "",
  });
  // Issue ID is now passed as a prop for reliability
  const [documents, setDocuments] = useState(issue?.e2Documents || []);

  // Always load latest values when issue or isOpen changes
  useEffect(() => {
    const supportTeamRaw = issue?.rowData?.["E2 Detailer Support Team"] ?? issue?.e2DetailerSupportTeam;
    const rowData = issue?.rowData || {};
    const e2CommentsValue = rowData['e2Comments'] ?? issue?.e2Comments ?? "";
    setForm({
      projectName: issue?.projectName || "",
      title: issue?.title || "",
      technicalDirection: issue?.technicalDirection || "",
      e3LeadDetailer: issue?.e3LeadDetailer || "",
      e2DetailerSupportTeam: Array.isArray(supportTeamRaw)
        ? supportTeamRaw
        : typeof supportTeamRaw === "string" && supportTeamRaw.includes(",")
        ? supportTeamRaw.split(",").map(s => s.trim()).filter(Boolean)
        : typeof supportTeamRaw === "string" && supportTeamRaw
        ? [supportTeamRaw]
        : [],
      e2Comments: e2CommentsValue,
      dataStage: issue?.dataStage || "",
    });
    setDocuments(issue?.e2Documents || []);
  }, [issue, isOpen]);

  if (!isOpen) return null;

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleFileChange = (e) => {
    setDocuments([...documents, ...Array.from(e.target.files)]);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    // Always save as array for compatibility
    const e2DetailerSupportTeam = Array.isArray(form.e2DetailerSupportTeam)
      ? form.e2DetailerSupportTeam
      : form.e2DetailerSupportTeam
      ? [form.e2DetailerSupportTeam]
      : [];
    onSubmit({ ...form, e2DetailerSupportTeam, e2Documents: documents });
  };

  return (
    <div className="quick-edit-overlay">
      <div className="quick-edit-modal">
        <div className="quick-edit-header">
          <span className="quick-edit-title">Quick Edit Issue</span>
          <button className="quick-edit-close" onClick={onClose}>&times;</button>
        </div>
        <form className="quick-edit-form" onSubmit={handleSubmit}>
          <label>Issue ID:
            <input type="text" value={issueId} disabled style={{ background: '#f0f0f0', color: '#333', fontWeight: 'bold' }} />
          </label>
          <label>Project Name:
            <select value={form.projectName} onChange={e => handleChange('projectName', e.target.value)}>
              <option value="">Select...</option>
              {projectNameOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          </label>
          <label>Title:
            <input type="text" value={form.title} onChange={e => handleChange('title', e.target.value)} />
          </label>
          <label>Technical Direction:
            <select value={form.technicalDirection} onChange={e => handleChange('technicalDirection', e.target.value)}>
              <option value="">Select...</option>
              {technicalDirectionOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          </label>
          <label>E2 Lead Detailer:
            <select value={form.e3LeadDetailer} onChange={e => handleChange('e3LeadDetailer', e.target.value)}>
              <option value="">Select...</option>
              {leadDetailerOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          </label>
          <label>E2 Detailer Support Team:
            <div className="quick-edit-support-team-dropdown">
              <button
                type="button"
                className="quick-edit-support-team-trigger"
                aria-label="Select E2 Detailer Support Team"
                onClick={() => setSupportTeamDropdownOpen((prev) => !prev)}
                style={{ minWidth: 180, padding: '6px 12px', border: '1px solid #ccc', borderRadius: 4, background: '#fff', cursor: 'pointer', textAlign: 'left' }}
              >
                <span style={{ color: form.e2DetailerSupportTeam.length ? '#222' : '#888' }}>
                  {form.e2DetailerSupportTeam.length ? form.e2DetailerSupportTeam.join(", ") : "Select support team..."}
                </span>
              </button>
              {supportTeamDropdownOpen && (
                <div className="quick-edit-support-team-menu" style={{ position: 'absolute', zIndex: 10, background: '#fff', border: '1px solid #ccc', borderRadius: 4, marginTop: 4, minWidth: 180, boxShadow: '0 2px 8px #0002', padding: 8 }}>
                  <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                    {supportTeamOptions.map((name) => {
                      const isSelected = form.e2DetailerSupportTeam.some(
                        (item) => item.toLowerCase() === name.toLowerCase()
                      );
                      return (
                        <button
                          key={name}
                          type="button"
                          className={`quick-edit-support-team-option${isSelected ? " is-selected" : ""}`}
                          style={{
                            display: 'block',
                            width: '100%',
                            textAlign: 'left',
                            padding: '6px 10px',
                            background: isSelected ? '#e0e7ff' : '#fff',
                            color: isSelected ? '#3730a3' : '#222',
                            border: 'none',
                            borderRadius: 3,
                            marginBottom: 2,
                            cursor: 'pointer',
                            fontWeight: isSelected ? 600 : 400
                          }}
                          onClick={() => {
                            const current = form.e2DetailerSupportTeam;
                            const next = isSelected
                              ? current.filter((item) => item.toLowerCase() !== name.toLowerCase())
                              : [...current, name];
                            handleChange('e2DetailerSupportTeam', next);
                          }}
                        >
                          {name}
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ textAlign: 'right', marginTop: 8 }}>
                    <button
                      type="button"
                      className="quick-edit-support-team-done-btn"
                      style={{ padding: '4px 14px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 3, fontWeight: 600, cursor: 'pointer' }}
                      onClick={() => setSupportTeamDropdownOpen(false)}
                    >
                      {form.e2DetailerSupportTeam.length > 0 ? `Done (${form.e2DetailerSupportTeam.length} selected)` : 'Done'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </label>
          <label>E2 Comments:
            <textarea value={form.e2Comments} onChange={e => handleChange('e2Comments', e.target.value)} />
          </label>
          <label>E2 Documents:
            <input type="file" multiple onChange={handleFileChange} />
            <ul>
              {documents.map((doc, idx) => <li key={idx}>{doc.name || doc}</li>)}
            </ul>
          </label>
          <label>Data Stage:
            <select value={form.dataStage} onChange={e => handleChange('dataStage', e.target.value)}>
              <option value="">Select...</option>
              {dataStageOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          </label>
          <div className="quick-edit-actions">
            <button type="submit">Submit</button>
            <button type="button" onClick={onClose}>Close</button>
          </div>
        </form>
      </div>
    </div>
  );
}
