import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { db } from "../firebase";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { E2_STATUS_UPDATE_AGILE_OPTIONS_FIELD, PROJECT_ISSUE_CONFIG_DOC_ID } from "../components/projectIssueConstants";

const EditE2StatusUpdateAgileOptions = () => {
  const { id } = useParams();
  const [options, setOptions] = useState([""]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newOption, setNewOption] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    const fetchOptions = async () => {
      setLoading(true);
      try {
        const configRef = doc(db, "churches", id, "settings", PROJECT_ISSUE_CONFIG_DOC_ID);
        const configSnap = await getDoc(configRef);
        const data = configSnap.data() || {};
        const arr = Array.isArray(data[E2_STATUS_UPDATE_AGILE_OPTIONS_FIELD]) ? data[E2_STATUS_UPDATE_AGILE_OPTIONS_FIELD] : [];
        setOptions(arr.length ? arr : [""]);
      } catch (err) {
        setError("Failed to load options.");
      } finally {
        setLoading(false);
      }
    };
    fetchOptions();
  }, [id]);

  const handleOptionChange = (idx, value) => {
    setOptions((prev) => prev.map((opt, i) => (i === idx ? value : opt)));
  };

  const handleAddOption = () => {
    if (!newOption.trim()) return;
    setOptions((prev) => [...prev, newOption.trim()]);
    setNewOption("");
  };

  const handleRemoveOption = (idx) => {
    setOptions((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      const configRef = doc(db, "churches", id, "settings", PROJECT_ISSUE_CONFIG_DOC_ID);
      await updateDoc(configRef, { [E2_STATUS_UPDATE_AGILE_OPTIONS_FIELD]: options.filter(Boolean) });
    } catch (err) {
      setError("Failed to save options.");
    } finally {
      setSaving(false);
    }
  };

  const moveOption = (idx, direction) => {
    setOptions((prev) => {
      const arr = [...prev];
      const newIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= arr.length) return arr;
      [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
      return arr;
    });
  };

  return (
    <div style={{ maxWidth: 500, margin: "40px auto", padding: 24, background: "#fff", borderRadius: 8, boxShadow: "0 2px 8px #eee" }}>
      <div style={{ marginBottom: 24 }}>
        <Link
          to={`/organization/${id}/e2-agile-board`}
          style={{
            background: "#4f46e5",
            color: "#fff",
            padding: "8px 18px",
            borderRadius: 6,
            textDecoration: "none",
            fontWeight: 600,
            fontSize: "1rem",
            letterSpacing: 0.5,
            display: "inline-block",
          }}
        >
          ← Back to Agile Board
        </Link>
      </div>
      <h2 style={{ marginBottom: 8 }}>Manage E2 Status Update Agile Dropdown</h2>
      <div style={{ color: '#374151', fontSize: '1rem', marginBottom: 18 }}>
        <p style={{ margin: 0 }}>
          <strong>Edit the possible values for the <span style={{ color: '#4f46e5' }}>E2 Status Update Agile</span> field.</strong><br />
          These options will appear in the Issue Records grid on the <span style={{ color: '#4f46e5' }}>Agile Board</span> page for every issue.
        </p>
      </div>
      {loading ? (
        <div>Loading...</div>
      ) : (
        <>
          {options.map((opt, idx) => (
            <div key={idx} style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
              <input
                type="text"
                value={opt}
                onChange={(e) => handleOptionChange(idx, e.target.value)}
                style={{ flex: 1, marginRight: 8, padding: 6 }}
                disabled={saving}
              />
              <button
                onClick={() => moveOption(idx, 'up')}
                disabled={saving || idx === 0}
                style={{ marginRight: 4 }}
                title="Move up"
              >↑</button>
              <button
                onClick={() => moveOption(idx, 'down')}
                disabled={saving || idx === options.length - 1}
                style={{ marginRight: 4 }}
                title="Move down"
              >↓</button>
              <button onClick={() => handleRemoveOption(idx)} disabled={saving || options.length === 1} style={{ color: "#b91c1c" }}>Remove</button>
            </div>
          ))}
          <div style={{ display: "flex", marginTop: 16 }}>
            <input
              type="text"
              value={newOption}
              onChange={(e) => setNewOption(e.target.value)}
              placeholder="Add new option"
              style={{ flex: 1, marginRight: 8, padding: 6 }}
              disabled={saving}
            />
            <button onClick={handleAddOption} disabled={saving || !newOption.trim()}>Add</button>
          </div>
          <button onClick={handleSave} disabled={saving} style={{ marginTop: 24, width: "100%", padding: 10, background: "#4f46e5", color: "#fff", border: "none", borderRadius: 4 }}>
            {saving ? "Saving..." : "Save Options"}
          </button>
          {error && <div style={{ color: "#b91c1c", marginTop: 12 }}>{error}</div>}
        </>
      )}
      <Link to="/">
        <button style={{ marginTop: 24, width: "100%", padding: 10, background: "#fff", color: "#b91c1c", border: "none", borderRadius: 4 }}>
          Cancel
        </button>
      </Link>
    </div>
  );
};

export default EditE2StatusUpdateAgileOptions;
