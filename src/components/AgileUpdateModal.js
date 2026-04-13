import React, { useState } from "react";

export default function AgileUpdateModal({ isOpen, onClose, onSave, latestUpdate, onChange, newUpdate, loading }) {
  if (!isOpen) return null;
  return (
    <div className="agile-update-overlay">
      <div className="agile-update-modal">
        <div className="agile-update-modal-header">
          <span className="agile-update-modal-title">Issue Updates</span>
          <button className="agile-update-modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="agile-update-modal-body">
          <div className="agile-update-label">Latest Update:</div>
          <div className="agile-update-latest">{latestUpdate || <em>No updates yet.</em>}</div>
          <textarea
            className="agile-update-input"
            value={newUpdate}
            onChange={e => onChange(e.target.value)}
            placeholder="Enter new update..."
            rows={4}
            style={{ width: "100%", marginTop: 12 }}
          />
        </div>
        <div className="agile-update-modal-actions">
          <button className="agile-update-save-btn" onClick={onSave} disabled={loading || !newUpdate.trim()}>
            {loading ? "Saving..." : "Save"}
          </button>
          <button className="agile-update-cancel-btn" onClick={onClose} disabled={loading}>Close</button>
        </div>
      </div>
    </div>
  );
}
