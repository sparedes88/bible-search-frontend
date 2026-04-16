import React, { useState } from "react";

export default function AgileUpdateModal({ isOpen, onClose, onSave, latestUpdate, onChange, newUpdate, loading, percentCompleted, onPercentChange }) {
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
  return (
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
        </div>
        <div className="agile-update-modal-actions">
          <button className="agile-update-save-btn" onClick={() => onSave(percentCompleted)} disabled={loading || !newUpdate.trim()}>
            {loading ? "Saving..." : "Save"}
          </button>
          <button className="agile-update-cancel-btn" onClick={onClose} disabled={loading}>Close</button>
        </div>
      </div>
    </div>
  );
}
