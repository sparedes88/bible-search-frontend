import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { db } from "../firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { PROJECT_ISSUE_CONFIG_DOC_ID } from "../components/projectIssueConstants";

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
    <div style={{ padding: 32, maxWidth: 600, margin: "0 auto" }}>
      <h2>Manage Technical Direction Values</h2>
      <Link to={"/organization/" + id + "/project-issue-dashboard/e2-detailers"} style={{ color: "#0ea5e9" }}>
        ← Back to E2 Detailers
      </Link>
      <div style={{ margin: "24px 0" }}>
        <label style={{ fontWeight: 500, marginRight: 8 }}>Sort:</label>
        <select value={sortMode} onChange={e => setSortMode(e.target.value)}>
          <option value="az">A-Z</option>
          <option value="custom">Custom (manual order)</option>
        </select>
      </div>
      {loading ? (
        <div>Loading…</div>
      ) : error ? (
        <div style={{ color: "red" }}>{error}</div>
      ) : (
        <>
          <ul style={{ listStyle: "none", padding: 0 }}>
            {sortedOptions.map((opt, idx) => {
              // Find the index in the original options array for custom sorting
              const origIdx = sortMode === "custom" ? options.indexOf(opt) : idx;
              return (
                <li key={idx} style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
                  <input
                    type="text"
                    value={opt}
                    onChange={e => handleEdit(origIdx, e.target.value)}
                    style={{ flex: 1, marginRight: 8 }}
                    disabled={saving}
                  />
                  {sortMode === "custom" && (
                    <>
                      <button
                        onClick={() => moveOption(origIdx, "up")}
                        disabled={saving || origIdx === 0}
                        style={{ marginRight: 2 }}
                        title="Move up"
                      >
                        ▲
                      </button>
                      <button
                        onClick={() => moveOption(origIdx, "down")}
                        disabled={saving || origIdx === options.length - 1}
                        style={{ marginRight: 6 }}
                        title="Move down"
                      >
                        ▼
                      </button>
                    </>
                  )}
                  <button onClick={() => handleRemove(origIdx)} disabled={saving} style={{ marginRight: 4 }}>
                    Delete
                  </button>
                </li>
              );
            })}
          </ul>
          <div style={{ margin: "16px 0" }}>
            <input
              type="text"
              value={newOption}
              onChange={e => setNewOption(e.target.value)}
              placeholder="Add new value"
              style={{ marginRight: 8 }}
              disabled={saving}
            />
            <button onClick={handleAdd} disabled={saving || !newOption.trim()}>Add</button>
          </div>
          <button onClick={handleSave} disabled={saving} style={{ marginTop: 16, background: "#0ea5e9", color: "#fff", padding: "8px 24px", border: "none", borderRadius: 4 }}>
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </>
      )}
    </div>
  );
};

export default ManageTechnicalDirectionValues;
