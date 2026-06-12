import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { db, storage } from "../firebase";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes, deleteObject } from "firebase/storage";
import { toast } from "react-toastify";
import "./AgileUpdateModal.css";

export default function AgileUpdateModal({
  isOpen, onClose, onSave, latestUpdate, onChange, newUpdate, loading,
  percentCompleted, onPercentChange, churchId, issue,
  requireDocument = false,
}) {
  const [e2Documents, setE2Documents] = useState([]);
  const [docLoading, setDocLoading] = useState(false);
  const [uploadingDocuments, setUploadingDocuments] = useState(false);
  const fileInputRef = useRef(null);
  const resolvedIssueDocId = issue?.issueDocId || issue?.issueId;

  // Fetch live e2Documents from Firestore whenever the modal opens or issue changes
  useEffect(() => {
    if (!isOpen || !churchId || !issue?.projectDocId || !resolvedIssueDocId) {
      setE2Documents([]);
      return;
    }
    setDocLoading(true);
    const issueRef = doc(db, "churches", churchId, "bimProjects", issue.projectDocId, "issues", resolvedIssueDocId);
    getDoc(issueRef)
      .then((snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setE2Documents(Array.isArray(data.e2Documents) ? data.e2Documents : []);
        } else {
          setE2Documents([]);
        }
      })
      .catch(() => setE2Documents([]))
      .finally(() => setDocLoading(false));
  }, [isOpen, churchId, issue?.projectDocId, resolvedIssueDocId]);

  const handleDocumentUpload = async (event) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    if (!churchId || !issue?.projectDocId || !resolvedIssueDocId) {
      toast.error("Issue data not fully loaded. Please try again.");
      return;
    }

    if (!storage) {
      toast.error("File storage is not configured in this environment.");
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
        const safeIssueId = (issue.issueId || "").replace(/[^a-zA-Z0-9-_]/g, "_");
        const ext = file.name.split(".").pop();
        const timestamp = Date.now();
        const storagePath = `churches/${churchId}/bimProjects/${issue.projectDocId}/e2-documents/${safeIssueId}/${timestamp}.${ext}`;
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

      const issueDocRef = doc(db, "churches", churchId, "bimProjects", issue.projectDocId, "issues", resolvedIssueDocId);
      const snapshot = await getDoc(issueDocRef);
      const data = snapshot.exists() ? snapshot.data() : {};
      const prevDocs = Array.isArray(data.e2Documents) ? data.e2Documents : [];
      const nextDocs = [...prevDocs, ...uploadedDocs];
      await updateDoc(issueDocRef, { e2Documents: nextDocs });
      setE2Documents(nextDocs);
      toast.success(`${uploadedDocs.length} document(s) uploaded.`);
    } catch (err) {
      console.error("Error uploading documents:", err);
      const errorCode = err?.code ? ` (${err.code})` : "";
      const errorMessage = err?.message || "Could not upload document(s).";
      toast.error(`Upload failed${errorCode}: ${errorMessage}`);
    } finally {
      setUploadingDocuments(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const deleteDocument = async (index) => {
    if (index < 0 || index >= e2Documents.length) return;
    const docToDelete = e2Documents[index];
    const confirmed = window.confirm(`Delete "${docToDelete.name}"?`);
    if (!confirmed) return;

    if (!storage) {
      toast.error("File storage is not configured in this environment.");
      return;
    }

    setUploadingDocuments(true);
    try {
      if (docToDelete.storagePath) {
        const fileRef = storageRef(storage, docToDelete.storagePath);
        await deleteObject(fileRef).catch((err) => {
          if (err.code !== "storage/object-not-found") throw err;
        });
      }
      const issueDocRef = doc(db, "churches", churchId, "bimProjects", issue.projectDocId, "issues", resolvedIssueDocId);
      const snapshot = await getDoc(issueDocRef);
      const data = snapshot.exists() ? snapshot.data() : {};
      const prevDocs = Array.isArray(data.e2Documents) ? data.e2Documents : [];
      const updatedDocs = prevDocs.filter((_, i) => i !== index);
      await updateDoc(issueDocRef, { e2Documents: updatedDocs });
      setE2Documents(updatedDocs);
      toast.success("Document deleted.");
    } catch (err) {
      console.error("Error deleting document:", err);
      const errorCode = err?.code ? ` (${err.code})` : "";
      const errorMessage = err?.message || "Could not delete document.";
      toast.error(`Delete failed${errorCode}: ${errorMessage}`);
    } finally {
      setUploadingDocuments(false);
    }
  };

  if (!isOpen) return null;

  // latestUpdate is now an object: { text, percentCompleted, date }
  let latestPercent = null, latestDate = null, latestText = "";
  if (latestUpdate && typeof latestUpdate === "object") {
    latestPercent = latestUpdate.percentCompleted;
    latestDate = latestUpdate.date;
    latestText = latestUpdate.text;
  } else {
    latestText = latestUpdate;
  }

  const availableSlots = 10 - e2Documents.length;

  const hasRequiredDocument = !requireDocument || e2Documents.length > 0;

  const modalMarkup = (
    <div className="agile-update-overlay">
      <div className="agile-update-modal">
        <div className="agile-update-modal-header">
          <span className="agile-update-modal-title">Issue Updates</span>
          <button className="agile-update-modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="agile-update-modal-body">
          <div className="agile-update-label">Latest Update:</div>
          <div className="agile-update-latest">
            {latestText || <em>No updates yet.</em>}
            {latestPercent !== null && latestPercent !== undefined && (
              <div style={{ marginTop: 4, color: '#2563eb', fontWeight: 500 }}>
                Percent Completed: {latestPercent}%
                {latestDate && (
                  <span style={{ color: '#666', marginLeft: 8, fontWeight: 400, fontSize: '0.95em' }}>
                    ({new Date(latestDate).toLocaleString()})
                  </span>
                )}
              </div>
            )}
          </div>
          <textarea
            className="agile-update-input"
            value={newUpdate}
            onChange={e => {
              if (e.target.value.length <= 500) onChange(e.target.value);
            }}
            placeholder="Enter new update..."
            rows={4}
            maxLength={500}
            style={{ width: "100%", marginTop: 12 }}
          />
          <div style={{ textAlign: 'right', fontSize: '0.95em', color: newUpdate.length >= 500 ? '#dc2626' : '#666' }}>
            {newUpdate.length}/500 characters
          </div>
          <div style={{ marginTop: 16 }}>
            <label className="agile-update-label" htmlFor="percent-completed-input">Percent Completed:</label>
            <input
              id="percent-completed-input"
              type="number"
              min={0}
              max={100}
              value={percentCompleted}
              onChange={e => onPercentChange(Math.max(0, Math.min(100, Number(e.target.value))))}
              style={{ width: 80, marginLeft: 8 }}
              step={1}
              disabled={loading}
            />
            <span style={{ marginLeft: 4 }}>%</span>
          </div>

          {/* Documents Section */}
          <div style={{ marginTop: 24, borderTop: '1px solid #e5e7eb', paddingTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span className="agile-update-label" style={{ margin: 0 }}>Documents</span>
              {docLoading ? (
                <span style={{ fontSize: '0.85em', color: '#6b7280' }}>Loading…</span>
              ) : (
                <span style={{ fontSize: '0.85em', color: availableSlots > 0 ? '#059669' : '#dc2626', fontWeight: 500 }}>
                  {availableSlots} slot{availableSlots !== 1 ? 's' : ''} available ({e2Documents.length}/10)
                </span>
              )}
            </div>

            {/* Upload Button */}
            {!docLoading && availableSlots > 0 && (
              <div style={{ marginBottom: 10 }}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.png,.jpg,.jpeg,.gif"
                  multiple
                  onChange={handleDocumentUpload}
                  disabled={uploadingDocuments}
                  style={{ display: 'none' }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingDocuments}
                  style={{
                    padding: '6px 14px',
                    background: uploadingDocuments ? '#9ca3af' : '#4f46e5',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    cursor: uploadingDocuments ? 'not-allowed' : 'pointer',
                    fontSize: '0.9em',
                    fontWeight: 500,
                  }}
                >
                  {uploadingDocuments ? 'Uploading…' : '📎 Add New Document'}
                </button>
              </div>
            )}

            {/* Document List */}
            {docLoading ? (
              <p style={{ color: '#9ca3af', fontSize: '0.9em', margin: 0 }}>Loading documents…</p>
            ) : e2Documents.length === 0 ? (
              <p style={{ color: '#9ca3af', fontSize: '0.9em', margin: 0 }}>No documents attached yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {e2Documents.map((docItem, index) => (
                  <div key={index} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6,
                    padding: '6px 10px',
                  }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                      <a
                        href={docItem.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          color: '#4f46e5', fontSize: '0.9em', textDecoration: 'none',
                          fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}
                      >
                        📄 {docItem.name}
                      </a>
                      {docItem.uploadedAt && (
                        <span style={{ color: '#9ca3af', fontSize: '0.78em' }}>
                          {new Date(docItem.uploadedAt).toLocaleDateString()}{' '}
                          {new Date(docItem.uploadedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => deleteDocument(index)}
                      disabled={uploadingDocuments}
                      title="Delete this document"
                      style={{
                        background: 'none', border: 'none',
                        cursor: uploadingDocuments ? 'not-allowed' : 'pointer',
                        color: '#dc2626', fontSize: '1em', marginLeft: 8, flexShrink: 0,
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

            {requireDocument && !docLoading && e2Documents.length === 0 ? (
              <p style={{ color: '#dc2626', fontSize: '0.85em', margin: '10px 0 0' }}>
                A document is required before saving this percent update.
              </p>
            ) : null}
          </div>
        </div>
        <div className="agile-update-modal-actions">
          <button
            className="agile-update-save-btn"
            onClick={() => onSave(percentCompleted)}
            disabled={loading || !newUpdate.trim() || !hasRequiredDocument}
          >
            {loading ? "Saving..." : "Save"}
          </button>
          <button className="agile-update-cancel-btn" onClick={onClose} disabled={loading}>Close</button>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return modalMarkup;
  return createPortal(modalMarkup, document.body);
}
