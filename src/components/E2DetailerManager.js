import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { collection, doc, getDocs, onSnapshot, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { toast } from "react-toastify";
import commonStyles from "../pages/commonStyles";
import { db } from "../firebase";
import {
  DEFAULT_E2_DETAILER_OPTIONS,
  DEFAULT_E2_STATUS_UPDATE,
  DEFAULT_E2_STATUS_UPDATE_OPTIONS,
  DEFAULT_E2_STATUS_UPDATE_AGILE_OPTIONS,
  DEFAULT_E2_AGILE_STATUS_OPTIONS,
  E2_DETAILER_OPTIONS_FIELD,
  E2_STATUS_UPDATE_OPTIONS_FIELD,
  E2_STATUS_UPDATE_AGILE_OPTIONS_FIELD,
  E2_AGILE_STATUS_OPTIONS_FIELD,
  PROJECT_ISSUE_CONFIG_DOC_ID,
} from "./projectIssueConstants";
import "./E2DetailerManager.css";

const normalizeOption = (value) => String(value || "").trim();

const normalizeFieldKey = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");

const findFieldByAliases = (fields = [], rowData = {}, aliases = []) => {
  const candidates = Array.from(new Set([...(fields || []), ...Object.keys(rowData || {})]));
  if (!candidates.length) return null;

  for (const alias of aliases) {
    const key = normalizeFieldKey(alias);
    const exact = candidates.find((candidate) => normalizeFieldKey(candidate) === key);
    if (exact) return exact;
  }

  for (const alias of aliases) {
    const key = normalizeFieldKey(alias);
    const contains = candidates.find((candidate) => normalizeFieldKey(candidate).includes(key));
    if (contains) return contains;
  }

  return null;
};

const parseSupportTeamValues = (value) => {
  const rawValues = Array.isArray(value) ? value : String(value || "").split(",");
  return rawValues
    .map((item) => normalizeOption(item))
    .filter(Boolean)
    .filter((item, index, array) => array.findIndex((candidate) => candidate.toLowerCase() === item.toLowerCase()) === index);
};

const formatSupportTeamValues = (value) => parseSupportTeamValues(value).join(", ");

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
  const [agileStatusOptions, setAgileStatusOptions] = useState(DEFAULT_E2_STATUS_UPDATE_AGILE_OPTIONS);
  const [loading, setLoading] = useState(true);
  const [newValue, setNewValue] = useState("");
  const [newStatusValue, setNewStatusValue] = useState("");
  const [newAgileStatusValue, setNewAgileStatusValue] = useState("");
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

        const configuredAgileStatus = Array.isArray(data[E2_AGILE_STATUS_OPTIONS_FIELD])
          ? data[E2_AGILE_STATUS_OPTIONS_FIELD]
          : [];
        setAgileStatusOptions(configuredAgileStatus.length ? configuredAgileStatus : DEFAULT_E2_AGILE_STATUS_OPTIONS);

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
        setAgileStatusOptions(DEFAULT_E2_STATUS_UPDATE_AGILE_OPTIONS);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [id]);

  const propagateLeadDetailerRename = async (oldValue, newValue) => {
    const oldNormalized = normalizeOption(oldValue);
    const newNormalized = normalizeOption(newValue);

    if (!id || !oldNormalized || !newNormalized || oldNormalized.toLowerCase() === newNormalized.toLowerCase()) {
      return;
    }

    const projectsRef = collection(db, "churches", id, "bimProjects");
    const projectSnapshots = await getDocs(projectsRef);
    let updatedProjectCount = 0;

    for (const projectSnapshot of projectSnapshots.docs) {
      const projectData = projectSnapshot.data() || {};
      const rows = Array.isArray(projectData.rows) ? projectData.rows : [];
      const fields = Array.isArray(projectData.fields) ? projectData.fields : [];
      if (!rows.length) continue;

      let projectChanged = false;
      const nextRows = rows.map((row) => {
        const rowData = row?.rowData || {};
        const detailerField = findFieldByAliases(fields, rowData, [
          "e2 lead detailer",
          "e2leaddetailer",
          "e2 detailer",
          "e2detailer",
        ]);
        const supportField = findFieldByAliases(fields, rowData, [
          "e2 detailer support team",
          "e2 detailer support",
          "e2 support team",
          "support team",
        ]);

        const nextRowData = { ...rowData };
        let rowChanged = false;

        if (detailerField) {
          const currentDetailer = normalizeOption(rowData[detailerField]);
          if (currentDetailer.toLowerCase() === oldNormalized.toLowerCase()) {
            nextRowData[detailerField] = newNormalized;
            rowChanged = true;
          }
        }

        if (supportField) {
          const supportValues = parseSupportTeamValues(rowData[supportField]);
          const renamedSupportValues = supportValues.map((value) =>
            value.toLowerCase() === oldNormalized.toLowerCase() ? newNormalized : value
          );
          const previousSupport = formatSupportTeamValues(supportValues);
          const nextSupport = formatSupportTeamValues(renamedSupportValues);
          if (previousSupport !== nextSupport) {
            nextRowData[supportField] = nextSupport;
            rowChanged = true;
          }
        }

        if (rowChanged) {
          projectChanged = true;
          return { ...row, rowData: nextRowData };
        }

        return row;
      });

      if (projectChanged) {
        await updateDoc(doc(db, "churches", id, "bimProjects", projectSnapshot.id), {
          rows: nextRows,
          updatedAt: serverTimestamp(),
        });
        updatedProjectCount += 1;
      }
    }

    if (updatedProjectCount > 0) {
      toast.success(`Updated E2 Lead Detailer values in ${updatedProjectCount} project(s).`);
    }
  };

  const propagateLeadDetailerDeletion = async (deletedValue) => {
    const deletedNormalized = normalizeOption(deletedValue);
    if (!id || !deletedNormalized) return;

    const projectsRef = collection(db, "churches", id, "bimProjects");
    const projectSnapshots = await getDocs(projectsRef);
    let updatedProjectCount = 0;

    for (const projectSnapshot of projectSnapshots.docs) {
      const projectData = projectSnapshot.data() || {};
      const rows = Array.isArray(projectData.rows) ? projectData.rows : [];
      const fields = Array.isArray(projectData.fields) ? projectData.fields : [];
      if (!rows.length) continue;

      let projectChanged = false;
      const nextRows = rows.map((row) => {
        const rowData = row?.rowData || {};
        const detailerField = findFieldByAliases(fields, rowData, [
          "e2 lead detailer",
          "e2leaddetailer",
          "e2 detailer",
          "e2detailer",
        ]);
        const supportField = findFieldByAliases(fields, rowData, [
          "e2 detailer support team",
          "e2 detailer support",
          "e2 support team",
          "support team",
        ]);

        const nextRowData = { ...rowData };
        let rowChanged = false;

        if (detailerField) {
          const currentDetailer = normalizeOption(rowData[detailerField]);
          if (currentDetailer.toLowerCase() === deletedNormalized.toLowerCase()) {
            nextRowData[detailerField] = "";
            rowChanged = true;
          }
        }

        if (supportField) {
          const supportValues = parseSupportTeamValues(rowData[supportField]);
          const filteredSupportValues = supportValues.filter(
            (value) => value.toLowerCase() !== deletedNormalized.toLowerCase()
          );
          const previousSupport = formatSupportTeamValues(supportValues);
          const nextSupport = formatSupportTeamValues(filteredSupportValues);
          if (previousSupport !== nextSupport) {
            nextRowData[supportField] = nextSupport;
            rowChanged = true;
          }
        }

        if (rowChanged) {
          projectChanged = true;
          return { ...row, rowData: nextRowData };
        }

        return row;
      });

      if (projectChanged) {
        await updateDoc(doc(db, "churches", id, "bimProjects", projectSnapshot.id), {
          rows: nextRows,
          updatedAt: serverTimestamp(),
        });
        updatedProjectCount += 1;
      }
    }

    if (updatedProjectCount > 0) {
      toast.success(`Removed deleted E2 Lead Detailer values from ${updatedProjectCount} project(s).`);
    }
  };

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

  const handleAgileStatusAdd = async () => {
    const clean = normalizeOption(newAgileStatusValue);
    if (!clean) {
      toast.info("Type a value first.");
      return;
    }
    const exists = agileStatusOptions.some((option) => option.toLowerCase() === clean.toLowerCase());
    if (exists) {
      toast.info("That value already exists.");
      return;
    }
    await persistOptions(E2_STATUS_UPDATE_AGILE_OPTIONS_FIELD, [...agileStatusOptions, clean]);
    setNewAgileStatusValue("");
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

    const previousValue = source[editingIndex] || "";
    const next = source.map((option, index) => (index === editingIndex ? clean : option));
    await persistOptions(fieldName, next);

    if (editingType === "detailer") {
      try {
        await propagateLeadDetailerRename(previousValue, clean);
      } catch (error) {
        console.error("Error propagating E2 Lead Detailer rename:", error);
        toast.warn("E2 Lead Detailer values were saved, but some project rows could not be updated.");
      }
    }

    cancelEdit();
    toast.success("Value updated.");
  };

  const handleDelete = async (type, index) => {
    const source = type === "status" ? statusOptions : options;
    const fieldName = type === "status" ? E2_STATUS_UPDATE_OPTIONS_FIELD : E2_DETAILER_OPTIONS_FIELD;
    const value = source[index];
    if (!value) return;

    const confirmed = window.confirm(`Delete \"${value}\" from E2 Lead Detailer options?`);
    if (!confirmed) return;

    const next = source.filter((_, currentIndex) => currentIndex !== index);
    await persistOptions(fieldName, next);

    if (type === "detailer") {
      try {
        await propagateLeadDetailerDeletion(value);
      } catch (error) {
        console.error("Error propagating E2 Lead Detailer deletion:", error);
        toast.warn("E2 Lead Detailer value was deleted, but some project rows could not be updated.");
      }
    }

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
      <Link to="/live-issue-tracker" style={commonStyles.backButtonLink}>
        ← Back to Live Issue Tracker
      </Link>

      <div className="e2-detailer-page">

        <div className="e2-detailer-header">
          <h1 className="e2-detailer-title">Manage E2 fields</h1>
          <p className="e2-detailer-subtitle">
            Add, edit, and remove values for E2 Lead Detailer and E2 Status Update fields.
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
            <Link
              to={`/organization/${id}/project-issue-dashboard/manage-technical-direction-values`}
              className="e2-detailer-btn e2-detailer-btn-secondary"
              style={{ display: 'inline-block' }}
            >
              Manage Technical Direction Values
            </Link>
            <Link
              to={`/organization/${id}/project-issue-dashboard/manage-assignees`}
              className="e2-detailer-btn e2-detailer-btn-secondary"
              style={{ display: 'inline-block' }}
            >
              Manage Assignees
            </Link>
          </div>
        </div>

        <div className="e2-detailer-sections">
          <div className="e2-detailer-list-wrap">
            <div className="e2-detailer-list-head">
              <div className="e2-detailer-list-meta">
                <strong>E2 Lead Detailer Values</strong>
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
                placeholder="Type a new E2 Lead Detailer value"
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
