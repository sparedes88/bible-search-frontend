import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { db } from "../firebase";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { toast } from "react-toastify";
import { PROJECT_ISSUE_CONFIG_DOC_ID } from "../components/projectIssueConstants";
import commonStyles from "./commonStyles";
import "../components/E2DetailerManager.css";

const PROJECT_NAME_VALUES_FIELD = "projectNameValues";
const normalizeValue = (value) => String(value || "").trim();

const ProjectNameManagerPage = () => {
  const { id } = useParams();
  const [projectNames, setProjectNames] = useState([]);
  const [sortMode, setSortMode] = useState("custom");
  const [newProjectName, setNewProjectName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingIndex, setEditingIndex] = useState(-1);
  const [editingValue, setEditingValue] = useState("");

  const displayedProjectNames = useMemo(() => {
    if (sortMode === "custom") return projectNames;
    const sorted = [...projectNames].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    return sortMode === "za" ? sorted.reverse() : sorted;
  }, [projectNames, sortMode]);

  const getSourceIndex = (displayIndex, value) => {
    if (sortMode === "custom") return displayIndex;
    return projectNames.findIndex((item) => item === value);
  };

  const persistProjectNames = async (nextValues, successMessage) => {
    if (!id) return;

    setSaving(true);
    setProjectNames(nextValues);
    try {
      const configRef = doc(db, "churches", id, "settings", PROJECT_ISSUE_CONFIG_DOC_ID);
      await setDoc(
        configRef,
        {
          [PROJECT_NAME_VALUES_FIELD]: nextValues,
        },
        { merge: true }
      );
      if (successMessage) toast.success(successMessage);
    } catch (err) {
      toast.error("Failed to save Project Name values.");
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!id) return;
    const configRef = doc(db, "churches", id, "settings", PROJECT_ISSUE_CONFIG_DOC_ID);
    const unsubscribe = onSnapshot(configRef, (snapshot) => {
      const data = snapshot.data() || {};
      const values = Array.isArray(data[PROJECT_NAME_VALUES_FIELD]) ? data[PROJECT_NAME_VALUES_FIELD] : [];
      setProjectNames(values.map((value) => normalizeValue(value)).filter(Boolean));
      setLoading(false);
    });
    return () => unsubscribe();
  }, [id]);

  const moveProjectName = async (fromIndex, toIndex) => {
    if (sortMode !== "custom") return;
    if (toIndex < 0 || toIndex >= projectNames.length) return;
    const reordered = [...projectNames];
    const [removed] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, removed);
    await persistProjectNames(reordered, "Project Name order updated.");
  };

  const handleAddProjectName = async (e) => {
    e.preventDefault();
    const name = normalizeValue(newProjectName);
    if (!name) return;
    const exists = projectNames.some((item) => item.toLowerCase() === name.toLowerCase());
    if (exists) {
      toast.info("Project Name already exists.");
      return;
    }
    await persistProjectNames([...projectNames, name], "Project Name added.");
    setNewProjectName("");
  };

  const handleDeleteProjectName = async (sourceIndex) => {
    const value = projectNames[sourceIndex];
    if (!value) return;

    const confirmed = window.confirm(`Delete "${value}" from Project Name values?`);
    if (!confirmed) return;

    const nextValues = projectNames.filter((_, idx) => idx !== sourceIndex);
    await persistProjectNames(nextValues, "Project Name deleted.");
    if (editingIndex === sourceIndex) {
      setEditingIndex(-1);
      setEditingValue("");
    }
  };

  const startEdit = (sourceIndex) => {
    setEditingIndex(sourceIndex);
    setEditingValue(projectNames[sourceIndex] || "");
  };

  const cancelEdit = () => {
    setEditingIndex(-1);
    setEditingValue("");
  };

  const saveEdit = async () => {
    if (editingIndex < 0) return;

    const cleanValue = normalizeValue(editingValue);
    if (!cleanValue) {
      toast.info("Value cannot be empty.");
      return;
    }

    const duplicateAtDifferentIndex = projectNames.some(
      (value, idx) => idx !== editingIndex && value.toLowerCase() === cleanValue.toLowerCase()
    );
    if (duplicateAtDifferentIndex) {
      toast.info("Project Name already exists.");
      return;
    }

    const nextValues = projectNames.map((value, idx) => (idx === editingIndex ? cleanValue : value));
    await persistProjectNames(nextValues, "Project Name updated.");
    cancelEdit();
  };

  return (
    <div style={commonStyles.fullWidthContainer}>
      <Link to={`/organization/${id}/project-issue-dashboard/e2-detailers`} style={commonStyles.backButtonLink}>
        ← Back to E2 Detailers
      </Link>

      <div className="e2-detailer-page">
        <div className="e2-detailer-header">
          <h1 className="e2-detailer-title">Manage Project Name Values</h1>
          <p className="e2-detailer-subtitle">
            Add, edit, delete, and custom-sort project names used across issue dashboards and filters.
          </p>
        </div>

        <div className="e2-detailer-list-wrap">
          <div className="e2-detailer-list-head">
            <div className="e2-detailer-list-meta">
              <strong>Project Name Values</strong>
              <span>{loading ? "Loading..." : `${projectNames.length} value(s)`}</span>
            </div>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <span>Sort:</span>
              <select
                className="e2-detailer-btn"
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value)}
                disabled={saving}
              >
                <option value="custom">Custom</option>
                <option value="az">A-Z</option>
                <option value="za">Z-A</option>
              </select>
            </label>
          </div>

          <form onSubmit={handleAddProjectName} className="e2-detailer-add-row" style={{ padding: "0.85rem 1rem" }}>
            <input
              type="text"
              className="e2-detailer-input"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder="Add new Project Name"
              disabled={saving}
            />
            <button type="submit" className="e2-detailer-btn e2-detailer-btn-primary" disabled={saving}>
              Add Value
            </button>
          </form>

          {loading ? (
            <div className="e2-detailer-empty">Loading...</div>
          ) : projectNames.length === 0 ? (
            <div className="e2-detailer-empty">No Project Names found.</div>
          ) : (
            <ul className="e2-detailer-list">
              {displayedProjectNames.map((name, idx) => {
                const sourceIndex = getSourceIndex(idx, name);
                const isEditing = editingIndex === sourceIndex;

                return (
                  <li key={`${name}-${idx}`} className="e2-detailer-item">
                    {isEditing ? (
                      <input
                        type="text"
                        className="e2-detailer-input"
                        value={editingValue}
                        onChange={(e) => setEditingValue(e.target.value)}
                        disabled={saving}
                      />
                    ) : (
                      <span className="e2-detailer-value">{name}</span>
                    )}

                    <div className="e2-detailer-actions">
                      {isEditing ? (
                        <>
                          <button
                            type="button"
                            className="e2-detailer-btn e2-detailer-btn-primary"
                            onClick={saveEdit}
                            disabled={saving}
                          >
                            Save
                          </button>
                          <button type="button" className="e2-detailer-btn" onClick={cancelEdit} disabled={saving}>
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            aria-label="Move up"
                            className="e2-detailer-btn"
                            disabled={saving || sortMode !== "custom" || sourceIndex === 0}
                            onClick={() => moveProjectName(sourceIndex, sourceIndex - 1)}
                          >
                            Up
                          </button>
                          <button
                            type="button"
                            aria-label="Move down"
                            className="e2-detailer-btn"
                            disabled={saving || sortMode !== "custom" || sourceIndex === projectNames.length - 1}
                            onClick={() => moveProjectName(sourceIndex, sourceIndex + 1)}
                          >
                            Down
                          </button>
                          <button
                            type="button"
                            className="e2-detailer-btn"
                            onClick={() => startEdit(sourceIndex)}
                            disabled={saving}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="e2-detailer-btn e2-detailer-btn-danger"
                            onClick={() => handleDeleteProjectName(sourceIndex)}
                            disabled={saving}
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export default ProjectNameManagerPage;
