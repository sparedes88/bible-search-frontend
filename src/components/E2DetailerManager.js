import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { toast } from "react-toastify";
import commonStyles from "../pages/commonStyles";
import ChurchHeader from "./ChurchHeader";
import { db } from "../firebase";
import {
  DEFAULT_E2_DETAILER_OPTIONS,
  DEFAULT_E2_STATUS_UPDATE,
  DEFAULT_E2_STATUS_UPDATE_OPTIONS,
  E2_DETAILER_OPTIONS_FIELD,
  E2_STATUS_UPDATE_OPTIONS_FIELD,
  PROJECT_ISSUE_CONFIG_DOC_ID,
} from "./projectIssueConstants";
import "./E2DetailerManager.css";

const normalizeOption = (value) => String(value || "").trim();

const uniqueOptions = (values = []) => {
  const seen = new Set();
  const output = [];

  values.forEach((value) => {
    const clean = normalizeOption(value);
    if (!clean) return;

    const key = clean.toLowerCase();
    if (seen.has(key)) return;

    seen.add(key);
    output.push(clean);
  });

  return output;
};

const withDefaultStatusOption = (values = []) => {
  const normalized = uniqueOptions(values);
  const hasDefault = normalized.some((value) => value.toLowerCase() === DEFAULT_E2_STATUS_UPDATE.toLowerCase());
  return hasDefault ? normalized : [DEFAULT_E2_STATUS_UPDATE, ...normalized];
};

const E2DetailerManager = () => {
  const { id } = useParams();
  const [options, setOptions] = useState(DEFAULT_E2_DETAILER_OPTIONS);
  const [statusOptions, setStatusOptions] = useState(DEFAULT_E2_STATUS_UPDATE_OPTIONS);
  const [loading, setLoading] = useState(true);
  const [newValue, setNewValue] = useState("");
  const [newStatusValue, setNewStatusValue] = useState("");
  const [editingIndex, setEditingIndex] = useState(-1);
  const [editingType, setEditingType] = useState("");
  const [editingValue, setEditingValue] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return undefined;

    const configRef = doc(db, "churches", id, "settings", PROJECT_ISSUE_CONFIG_DOC_ID);

    const unsubscribe = onSnapshot(
      configRef,
      (snapshot) => {
        const data = snapshot.data() || {};
        const configured = Array.isArray(data[E2_DETAILER_OPTIONS_FIELD])
          ? data[E2_DETAILER_OPTIONS_FIELD]
          : [];
        const configuredStatus = Array.isArray(data[E2_STATUS_UPDATE_OPTIONS_FIELD])
          ? data[E2_STATUS_UPDATE_OPTIONS_FIELD]
          : [];

        const nextOptions = uniqueOptions(configured.length ? configured : DEFAULT_E2_DETAILER_OPTIONS);
        const nextStatusOptions = withDefaultStatusOption(
          configuredStatus.length ? configuredStatus : DEFAULT_E2_STATUS_UPDATE_OPTIONS
        );
        setOptions(nextOptions);
        setStatusOptions(nextStatusOptions);
        setLoading(false);
      },
      () => {
        setOptions(DEFAULT_E2_DETAILER_OPTIONS);
        setStatusOptions(withDefaultStatusOption(DEFAULT_E2_STATUS_UPDATE_OPTIONS));
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [id]);

  const persistOptions = async (fieldName, nextOptions) => {
    if (!id) return;

    const normalized =
      fieldName === E2_STATUS_UPDATE_OPTIONS_FIELD ? withDefaultStatusOption(nextOptions) : uniqueOptions(nextOptions);
    setSaving(true);
    try {
      await setDoc(
        doc(db, "churches", id, "settings", PROJECT_ISSUE_CONFIG_DOC_ID),
        {
          [fieldName]: normalized,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      if (fieldName === E2_DETAILER_OPTIONS_FIELD) {
        setOptions(normalized);
      } else {
        setStatusOptions(normalized);
      }
    } catch (error) {
      console.error("Error saving E2 options:", error);
      toast.error("Could not save values.");
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = async () => {
    const clean = normalizeOption(newValue);
    if (!clean) {
      toast.info("Type a value first.");
      return;
    }

    const exists = options.some((option) => option.toLowerCase() === clean.toLowerCase());
    if (exists) {
      toast.info("That value already exists.");
      return;
    }

    await persistOptions(E2_DETAILER_OPTIONS_FIELD, [...options, clean]);
    setNewValue("");
    toast.success("Value added.");
  };

  const handleStatusAdd = async () => {
    const clean = normalizeOption(newStatusValue);
    if (!clean) {
      toast.info("Type a value first.");
      return;
    }

    const exists = statusOptions.some((option) => option.toLowerCase() === clean.toLowerCase());
    if (exists) {
      toast.info("That value already exists.");
      return;
    }

    await persistOptions(E2_STATUS_UPDATE_OPTIONS_FIELD, [...statusOptions, clean]);
    setNewStatusValue("");
    toast.success("Value added.");
  };

  const startEdit = (type, index) => {
    const source = type === "status" ? statusOptions : options;
    setEditingType(type);
    setEditingIndex(index);
    setEditingValue(source[index] || "");
  };

  const cancelEdit = () => {
    setEditingType("");
    setEditingIndex(-1);
    setEditingValue("");
  };

  const saveEdit = async () => {
    if (editingIndex < 0) return;

    const source = editingType === "status" ? statusOptions : options;
    const fieldName = editingType === "status" ? E2_STATUS_UPDATE_OPTIONS_FIELD : E2_DETAILER_OPTIONS_FIELD;

    const clean = normalizeOption(editingValue);
    if (!clean) {
      toast.info("Value cannot be empty.");
      return;
    }

    const duplicateAtDifferentIndex = source.some(
      (option, index) => index !== editingIndex && option.toLowerCase() === clean.toLowerCase()
    );

    if (duplicateAtDifferentIndex) {
      toast.info("That value already exists.");
      return;
    }

    const next = source.map((option, index) => (index === editingIndex ? clean : option));
    await persistOptions(fieldName, next);
    cancelEdit();
    toast.success("Value updated.");
  };

  const handleDelete = async (type, index) => {
    const source = type === "status" ? statusOptions : options;
    const fieldName = type === "status" ? E2_STATUS_UPDATE_OPTIONS_FIELD : E2_DETAILER_OPTIONS_FIELD;
    const value = source[index];
    if (!value) return;

    const confirmed = window.confirm(`Delete \"${value}\" from E2 Detailer options?`);
    if (!confirmed) return;

    const next = source.filter((_, currentIndex) => currentIndex !== index);
    await persistOptions(fieldName, next);
    if (editingIndex === index && editingType === type) {
      cancelEdit();
    }
    toast.success("Value deleted.");
  };

  const handleSortAlphabetically = async (type) => {
    const source = type === "status" ? statusOptions : options;
    const fieldName = type === "status" ? E2_STATUS_UPDATE_OPTIONS_FIELD : E2_DETAILER_OPTIONS_FIELD;

    const sorted = [...source].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    const changed = sorted.some((value, index) => value !== source[index]);

    if (!changed) {
      toast.info("Values are already sorted A-Z.");
      return;
    }

    await persistOptions(fieldName, sorted);
    if (editingType === type) {
      cancelEdit();
    }
    toast.success("Values sorted A-Z.");
  };

  const handleMoveOption = async (type, index, direction) => {
    const source = type === "status" ? statusOptions : options;
    const fieldName = type === "status" ? E2_STATUS_UPDATE_OPTIONS_FIELD : E2_DETAILER_OPTIONS_FIELD;
    const targetIndex = direction === "up" ? index - 1 : index + 1;

    if (targetIndex < 0 || targetIndex >= source.length) return;

    const reordered = [...source];
    const [movedValue] = reordered.splice(index, 1);
    reordered.splice(targetIndex, 0, movedValue);

    await persistOptions(fieldName, reordered);

    if (editingType === type) {
      cancelEdit();
    }
  };

  return (
    <div style={commonStyles.fullWidthContainer}>
      <Link to={`/organization/${id}/project-issue-dashboard`} style={commonStyles.backButtonLink}>
        ← Back to Project Issue Dashboard
      </Link>

      <ChurchHeader id={id} applyShadow={false} allowEditBannerLogo={true} />

      <div className="e2-detailer-page">
        <div className="e2-detailer-header">
          <h1 className="e2-detailer-title">Manage E2 fields</h1>
          <p className="e2-detailer-subtitle">
            Add, edit, and remove values for E2 Detailer and E2 Status Update fields.
          </p>
        </div>

        <div className="e2-detailer-sections">
          <div className="e2-detailer-list-wrap">
            <div className="e2-detailer-list-head">
              <div className="e2-detailer-list-meta">
                <strong>E2 Detailer Values</strong>
                <span>{loading ? "Loading..." : `${options.length} value(s)`}</span>
              </div>
              <button
                type="button"
                className="e2-detailer-btn"
                onClick={() => handleSortAlphabetically("detailer")}
                disabled={saving || loading || options.length < 2}
              >
                Sort A-Z
              </button>
            </div>

            <div className="e2-detailer-add-row">
              <input
                type="text"
                className="e2-detailer-input"
                placeholder="Type a new E2 Detailer value"
                value={newValue}
                onChange={(event) => setNewValue(event.target.value)}
                disabled={saving}
              />
              <button
                type="button"
                className="e2-detailer-btn e2-detailer-btn-primary"
                onClick={handleAdd}
                disabled={saving}
              >
                Add Value
              </button>
            </div>

            {!loading && !options.length ? <div className="e2-detailer-empty">No values found.</div> : null}

            <ul className="e2-detailer-list">
              {options.map((value, index) => (
                <li key={`${value}-${index}`} className="e2-detailer-item">
                  {editingType === "detailer" && editingIndex === index ? (
                    <input
                      type="text"
                      className="e2-detailer-input"
                      value={editingValue}
                      onChange={(event) => setEditingValue(event.target.value)}
                      disabled={saving}
                    />
                  ) : (
                    <span className="e2-detailer-value">{value}</span>
                  )}

                  <div className="e2-detailer-actions">
                    {editingType === "detailer" && editingIndex === index ? (
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
                          className="e2-detailer-btn"
                          onClick={() => handleMoveOption("detailer", index, "up")}
                          disabled={saving || index === 0}
                        >
                          Up
                        </button>
                        <button
                          type="button"
                          className="e2-detailer-btn"
                          onClick={() => handleMoveOption("detailer", index, "down")}
                          disabled={saving || index === options.length - 1}
                        >
                          Down
                        </button>
                        <button
                          type="button"
                          className="e2-detailer-btn"
                          onClick={() => startEdit("detailer", index)}
                          disabled={saving}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="e2-detailer-btn e2-detailer-btn-danger"
                          onClick={() => handleDelete("detailer", index)}
                          disabled={saving}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="e2-detailer-list-wrap">
            <div className="e2-detailer-list-head">
              <div className="e2-detailer-list-meta">
                <strong>E2 Status Update Values</strong>
                <span>{loading ? "Loading..." : `${statusOptions.length} value(s)`}</span>
              </div>
              <button
                type="button"
                className="e2-detailer-btn"
                onClick={() => handleSortAlphabetically("status")}
                disabled={saving || loading || statusOptions.length < 2}
              >
                Sort A-Z
              </button>
            </div>

            <div className="e2-detailer-add-row">
              <input
                type="text"
                className="e2-detailer-input"
                placeholder="Type a new E2 Status Update value"
                value={newStatusValue}
                onChange={(event) => setNewStatusValue(event.target.value)}
                disabled={saving}
              />
              <button
                type="button"
                className="e2-detailer-btn e2-detailer-btn-primary"
                onClick={handleStatusAdd}
                disabled={saving}
              >
                Add Value
              </button>
            </div>

            {!loading && !statusOptions.length ? <div className="e2-detailer-empty">No values found.</div> : null}

            <ul className="e2-detailer-list">
              {statusOptions.map((value, index) => (
                <li key={`${value}-${index}`} className="e2-detailer-item">
                  {editingType === "status" && editingIndex === index ? (
                    <input
                      type="text"
                      className="e2-detailer-input"
                      value={editingValue}
                      onChange={(event) => setEditingValue(event.target.value)}
                      disabled={saving}
                    />
                  ) : (
                    <span className="e2-detailer-value">{value}</span>
                  )}

                  <div className="e2-detailer-actions">
                    {editingType === "status" && editingIndex === index ? (
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
                          className="e2-detailer-btn"
                          onClick={() => handleMoveOption("status", index, "up")}
                          disabled={saving || index === 0}
                        >
                          Up
                        </button>
                        <button
                          type="button"
                          className="e2-detailer-btn"
                          onClick={() => handleMoveOption("status", index, "down")}
                          disabled={saving || index === statusOptions.length - 1}
                        >
                          Down
                        </button>
                        <button
                          type="button"
                          className="e2-detailer-btn"
                          onClick={() => startEdit("status", index)}
                          disabled={saving}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="e2-detailer-btn e2-detailer-btn-danger"
                          onClick={() => handleDelete("status", index)}
                          disabled={saving}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default E2DetailerManager;
