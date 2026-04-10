import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { db } from "../firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { PROJECT_ISSUE_CONFIG_DOC_ID } from "../components/projectIssueConstants";

const TECHNICAL_DIRECTION_OPTIONS_FIELD = "technicalDirectionOptions";
const TECHNICAL_DIRECTION_FORMATS_FIELD = "technicalDirectionFormats";
const DEFAULT_TECHNICAL_DIRECTION_OPTIONS = [
  "Stop and Start",
  "Steer with current task",
  "Add to Queue"
];

const EditTechnicalDirectionOptions = () => {
  const { id } = useParams();
  const [options, setOptions] = useState([]);
  const [formats, setFormats] = useState({});
  const [newOption, setNewOption] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

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
        setFormats(typeof data[TECHNICAL_DIRECTION_FORMATS_FIELD] === "object" && data[TECHNICAL_DIRECTION_FORMATS_FIELD] ? data[TECHNICAL_DIRECTION_FORMATS_FIELD] : {});
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
    setFormats((prev) => ({
      ...prev,
      [value]: {
        backgroundColor: "#f3f4f6",
        fontColor: "#111",
        fontFamily: "inherit",
        fontSize: "16px",
        fontWeight: "normal"
      }
    }));
    setNewOption("");
  };

  const handleRemove = (idx) => {
    const removed = options[idx];
    setOptions(options.filter((_, i) => i !== idx));
    setFormats((prev) => {
      const next = { ...prev };
      delete next[removed];
      return next;
    });
  };

  const handleFormatChange = (opt, key, value) => {
    setFormats((prev) => ({ ...prev, [opt]: { ...prev[opt], [key]: value } }));
  };

  const handleSave = async () => {
    if (!id) return;
    setSaving(true);
    setError("");
    try {
      const configRef = doc(db, "churches", id, "settings", PROJECT_ISSUE_CONFIG_DOC_ID);
      await setDoc(configRef, {
        [TECHNICAL_DIRECTION_OPTIONS_FIELD]: options,
        [TECHNICAL_DIRECTION_FORMATS_FIELD]: formats,
      }, { merge: true });
    } catch (err) {
      setError("Failed to save options.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ maxWidth: 480, margin: "40px auto", background: "#fff", borderRadius: 8, boxShadow: "0 2px 8px #0001", padding: 32 }}>
      <h2 style={{ fontWeight: 600, fontSize: 22, marginBottom: 16 }}>Edit Technical Direction Options</h2>
      <Link to={"/organization/" + id + "/e2-agile-board"} style={{ color: "#2563eb", textDecoration: "underline", fontSize: 15 }}>← Back to Agile Board</Link>
      <div style={{ margin: "24px 0" }}>
        {loading ? (
          <div>Loading...</div>
        ) : (
          <>
            <ul style={{ padding: 0, listStyle: "none" }}>
              {options.map((opt, idx) => (
                <li key={opt} style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
                  <span style={{
                    flex: 1,
                    background: formats[opt]?.backgroundColor || "#f3f4f6",
                    color: formats[opt]?.fontColor || "#111",
                    fontFamily: formats[opt]?.fontFamily || "inherit",
                    fontSize: formats[opt]?.fontSize || "16px",
                    fontWeight: formats[opt]?.fontWeight || "normal",
                    padding: "4px 10px",
                    borderRadius: 4,
                    marginRight: 8,
                  }}>{opt}</span>
                  <select
                    value={formats[opt]?.fontFamily || "inherit"}
                    onChange={e => handleFormatChange(opt, "fontFamily", e.target.value)}
                    title="Font family"
                    style={{ marginRight: 4 }}
                  >
                    <option value="inherit">Default</option>
                    <option value="Arial">Arial</option>
                    <option value="Tahoma">Tahoma</option>
                    <option value="Verdana">Verdana</option>
                    <option value="Georgia">Georgia</option>
                    <option value="Times New Roman">Times New Roman</option>
                    <option value="Courier New">Courier New</option>
                  </select>
                  <input
                    type="number"
                    min="10"
                    max="48"
                    value={parseInt(formats[opt]?.fontSize, 10) || 16}
                    onChange={e => handleFormatChange(opt, "fontSize", e.target.value + "px")}
                    title="Font size"
                    style={{ width: 48, marginRight: 4 }}
                  />
                  <label style={{ marginRight: 4 }}>
                    <input
                      type="checkbox"
                      checked={formats[opt]?.fontWeight === "bold"}
                      onChange={e => handleFormatChange(opt, "fontWeight", e.target.checked ? "bold" : "normal")}
                    /> Bold
                  </label>
                  <input
                    type="color"
                    value={formats[opt]?.backgroundColor || "#f3f4f6"}
                    onChange={e => handleFormatChange(opt, "backgroundColor", e.target.value)}
                    title="Background color"
                    style={{ marginRight: 4, border: "none", background: "none", width: 28, height: 28 }}
                  />
                  <input
                    type="color"
                    value={formats[opt]?.fontColor || "#111"}
                    onChange={e => handleFormatChange(opt, "fontColor", e.target.value)}
                    title="Font color"
                    style={{ marginRight: 4, border: "none", background: "none", width: 28, height: 28 }}
                  />
                  <button onClick={() => handleRemove(idx)} style={{ marginLeft: 4, color: "#ef4444", border: "none", background: "none", cursor: "pointer" }}>Remove</button>
                </li>
              ))}
            </ul>
            <div style={{ display: "flex", marginTop: 16 }}>
              <input
                type="text"
                value={newOption}
                onChange={e => setNewOption(e.target.value)}
                placeholder="Add new option"
                style={{ flex: 1, padding: 8, borderRadius: 4, border: "1px solid #d1d5db" }}
                onKeyDown={e => { if (e.key === "Enter") handleAdd(); }}
                disabled={saving}
              />
              <button onClick={handleAdd} style={{ marginLeft: 8, padding: "8px 16px", borderRadius: 4, background: "#2563eb", color: "#fff", border: "none", cursor: "pointer" }} disabled={saving}>Add</button>
            </div>
            <button onClick={handleSave} style={{ marginTop: 24, width: "100%", padding: 12, borderRadius: 4, background: "#22c55e", color: "#fff", border: "none", fontWeight: 600, fontSize: 16, cursor: "pointer" }} disabled={saving}>Save Changes</button>
            {error && <div style={{ color: "#ef4444", marginTop: 12 }}>{error}</div>}
          </>
        )}
      </div>
    </div>
  );
};

export default EditTechnicalDirectionOptions;
