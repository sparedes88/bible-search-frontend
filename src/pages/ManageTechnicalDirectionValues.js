import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { db } from "../firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { PROJECT_ISSUE_CONFIG_DOC_ID } from "../components/projectIssueConstants";
import commonStyles from "./commonStyles";
import "./ManageTechnicalDirectionValues.css";

const TECHNICAL_DIRECTION_OPTIONS_FIELD = "technicalDirectionOptions";
const DEFAULT_TECHNICAL_DIRECTION_OPTIONS = [
  "Stop and Start",
  "Steer with current task",
  "Add to Queue"
];

const ManageTechnicalDirectionValues = () => {
  const { id } = useParams();
  const [options, setOptions] = useState([]);
  const [newOption, setNewOption] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [sortMode, setSortMode] = useState("az");

  useEffect(() => {
    if (!id) return;
    const fetchOptions = async () => {
      setLoading(true);
      setError("");
      try {
        const configRef = doc(db, "churches", id, "settings", PROJECT_ISSUE_CONFIG_DOC_ID);
        const snap = await getDoc(configRef);
        const data = snap.data() || {};
        const loaded = Array.isArray(data[TECHNICAL_DIRECTION_OPTIONS_FIELD])
          ? data[TECHNICAL_DIRECTION_OPTIONS_FIELD]
          : DEFAULT_TECHNICAL_DIRECTION_OPTIONS;
        setOptions(loaded);
      } catch (err) {
        setError("Failed to load options.");
      } finally {
        setLoading(false);
      }
    };
    fetchOptions();
  }, [id]);

  const handleAdd = () => {
    const value = newOption.trim();
    if (!value || options.includes(value)) return;
    setOptions([...options, value]);
    setNewOption("");
  };

  const handleRemove = (idx) => {
    setOptions(options.filter((_, i) => i !== idx));
  };

  const handleEdit = (idx, value) => {
    setOptions(options.map((opt, i) => (i === idx ? value : opt)));
  };

  const handleSave = async () => {
    if (!id) return;
    setSaving(true);
    setError("");
    try {
      const configRef = doc(db, "churches", id, "settings", PROJECT_ISSUE_CONFIG_DOC_ID);
      await setDoc(configRef, { [TECHNICAL_DIRECTION_OPTIONS_FIELD]: options }, { merge: true });
    } catch (err) {
      setError("Failed to save options.");
    }
    setSaving(false);
  };

  let sortedOptions = [...options];
  if (sortMode === "az") sortedOptions.sort((a, b) => a.localeCompare(b));

  // Move item up or down in custom mode
  const moveOption = (idx, dir) => {
    if (sortMode !== "custom") return;
    const newOptions = [...options];
    const swapIdx = dir === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= newOptions.length) return;
    [newOptions[idx], newOptions[swapIdx]] = [newOptions[swapIdx], newOptions[idx]];
    setOptions(newOptions);
  };

  return (
    <div style={commonStyles.fullWidthContainer}>
      <Link to={"/organization/" + id + "/project-issue-dashboard/e2-detailers"} style={commonStyles.backButtonLink}>
        ← Back to E2 Detailers
      </Link>

      <div className="tech-direction-page">
        <div className="tech-direction-header">
          <h1 className="tech-direction-title">Manage Technical Direction Values</h1>
          <p className="tech-direction-subtitle">
            Add, edit, and remove values for Technical Direction field.
          </p>
        </div>

        <div className="tech-direction-list-wrap">
          <div className="tech-direction-list-head">
            <div className="tech-direction-list-meta">
              <strong>Technical Direction Values</strong>
              <span>{loading ? "Loading..." : `${options.length} value(s)`}</span>
            </div>
            <div style={{ display: "flex", gap: "0.75rem" }}>
              <select 
                value={sortMode} 
                onChange={e => setSortMode(e.target.value)}
                className="tech-direction-btn"
                style={{ flex: "0 0 auto", minWidth: "150px" }}
                disabled={saving}
              >
                <option value="az">Sort A-Z</option>
                <option value="custom">Custom Order</option>
              </select>
            </div>
          </div>

          {loading ? (
            <div className="tech-direction-empty">Loading…</div>
          ) : error ? (
            <div className="tech-direction-empty" style={{ color: "red" }}>{error}</div>
          ) : (
            <>
              {!options.length ? <div className="tech-direction-empty">No values found.</div> : null}

              <ul className="tech-direction-list">
                {sortedOptions.map((opt, idx) => {
                  const origIdx = sortMode === "custom" ? options.indexOf(opt) : idx;
                  return (
                    <li key={idx} className="tech-direction-item">
                      <input
                        type="text"
                        value={opt}
                        onChange={e => handleEdit(origIdx, e.target.value)}
                        className="tech-direction-input"
                        disabled={saving}
                      />
                      <div className="tech-direction-actions">
                        {sortMode === "custom" && (
                          <>
                            <button
                              onClick={() => moveOption(origIdx, "up")}
                              disabled={saving || origIdx === 0}
                              className="tech-direction-btn"
                              title="Move up"
                            >
                              Up
                            </button>
                            <button
                              onClick={() => moveOption(origIdx, "down")}
                              disabled={saving || origIdx === options.length - 1}
                              className="tech-direction-btn"
                              title="Move down"
                            >
                              Down
                            </button>
                          </>
                        )}
                        <button 
                          onClick={() => handleRemove(origIdx)} 
                          disabled={saving}
                          className="tech-direction-btn tech-direction-btn-danger"
                        >
                          Delete
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>

              <div className="tech-direction-add-row" style={{ padding: "1rem" }}>
                <input
                  type="text"
                  value={newOption}
                  onChange={e => setNewOption(e.target.value)}
                  placeholder="Add new Technical Direction value"
                  className="tech-direction-input"
                  disabled={saving}
                />
                <button 
                  onClick={handleAdd} 
                  disabled={saving || !newOption.trim()}
                  className="tech-direction-btn tech-direction-btn-primary"
                >
                  Add Value
                </button>
              </div>

              <div style={{ padding: "0 1rem 1rem 1rem" }}>
                <button 
                  onClick={handleSave} 
                  disabled={saving}
                  className="tech-direction-btn tech-direction-btn-primary"
                  style={{ width: "100%" }}
                >
                  {saving ? "Saving…" : "Save Changes"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ManageTechnicalDirectionValues;
