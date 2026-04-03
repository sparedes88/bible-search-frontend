import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { collection, doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { toast } from "react-toastify";
import commonStyles from "../pages/commonStyles";
import ChurchHeader from "./ChurchHeader";
import { db } from "../firebase";
import { E2_STATUS_UPDATE_FORMATS_FIELD, PROJECT_ISSUE_CONFIG_DOC_ID, STATUS_FORMATS_FIELD, TAG_ALIASES_FIELD } from "./projectIssueConstants";
import "./TagAliasManager.css";

const normalizeValue = (value) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value).trim();
};

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

const extractTagValues = (rawValue) => {
  if (rawValue === null || rawValue === undefined) return [];

  const rawItems = Array.isArray(rawValue) ? rawValue : [rawValue];
  const tags = [];

  rawItems.forEach((item) => {
    const normalized = normalizeValue(item);
    if (!normalized) return;

    // Keep the full field value as-is to preserve combined tags such as
    // "FF PH 1, Re-Opened" as one distinct value.
    tags.push(normalized);
  });

  const unique = [];
  const seen = new Set();

  tags.forEach((tag) => {
    const key = tag.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(tag);
  });

  return unique;
};

const defaultStatusDraft = {
  label: "",
  textColor: "#ffffff",
  backgroundColor: "#166534",
};

const TagAliasManager = () => {
  const { id } = useParams();
  const [loadingTags, setLoadingTags] = useState(true);
  const [loadingStatuses, setLoadingStatuses] = useState(true);
  const [loadingAliases, setLoadingAliases] = useState(true);
  const [distinctTags, setDistinctTags] = useState([]);
  const [distinctStatuses, setDistinctStatuses] = useState([]);
  const [distinctE2StatusUpdates, setDistinctE2StatusUpdates] = useState([]);
  const [tagAliases, setTagAliases] = useState({});
  const [statusFormats, setStatusFormats] = useState({});
  const [e2StatusUpdateFormats, setE2StatusUpdateFormats] = useState({});
  const [draftAliases, setDraftAliases] = useState({});
  const [draftStatusFormats, setDraftStatusFormats] = useState({});
  const [draftE2StatusUpdateFormats, setDraftE2StatusUpdateFormats] = useState({});
  const [savingTag, setSavingTag] = useState("");
  const [savingStatus, setSavingStatus] = useState("");
  const [savingE2StatusUpdate, setSavingE2StatusUpdate] = useState("");

  useEffect(() => {
    if (!id) return undefined;

    const projectsRef = collection(db, "churches", id, "bimProjects");
    const configRef = doc(db, "churches", id, "settings", PROJECT_ISSUE_CONFIG_DOC_ID);

    const unsubscribeProjects = onSnapshot(
      projectsRef,
      (snapshot) => {
        const uniqueByKey = new Map();
        const uniqueStatusesByKey = new Map();
        const snapshotE2ByKey = new Map();

        snapshot.forEach((projectDoc) => {
          const data = projectDoc.data() || {};
          const fields = Array.isArray(data.fields) ? data.fields : [];
          const rows = Array.isArray(data.rows) ? data.rows : [];

          const uniqueE2ByKey = new Map();
          rows.forEach((row) => {
            const rowData = row?.rowData || {};
            const tagsField = findFieldByAliases(fields, rowData, ["tags", "tag", "labels", "label"]);
            const statusField = findFieldByAliases(fields, rowData, ["status", "state", "task status"]);
            const e2StatusUpdateField = findFieldByAliases(fields, rowData, ["e2 status update", "e2statusupdate"]);

            if (tagsField) {
              const values = extractTagValues(rowData[tagsField]);
              values.forEach((value) => {
                const key = value.toLowerCase();
                if (!uniqueByKey.has(key)) {
                  uniqueByKey.set(key, value);
                }
              });
            }

            const statusValue = normalizeValue(statusField ? rowData[statusField] : "");
            const statusKey = statusValue.toLowerCase();
            if (statusValue && !uniqueStatusesByKey.has(statusKey)) {
              uniqueStatusesByKey.set(statusKey, statusValue);
            }

            const e2Value = normalizeValue(e2StatusUpdateField ? rowData[e2StatusUpdateField] : "");
            const e2Key = e2Value.toLowerCase();
            if (e2Value && !uniqueE2ByKey.has(e2Key)) {
              uniqueE2ByKey.set(e2Key, e2Value);
            }
          });

          uniqueE2ByKey.forEach((value, key) => {
            if (!snapshotE2ByKey.has(key)) snapshotE2ByKey.set(key, value);
          });
        });

        const nextTags = Array.from(uniqueByKey.values()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
        const nextStatuses = Array.from(uniqueStatusesByKey.values()).sort((a, b) =>
          a.localeCompare(b, undefined, { sensitivity: "base" })
        );
        const nextE2StatusUpdates = Array.from(snapshotE2ByKey.values()).sort((a, b) =>
          a.localeCompare(b, undefined, { sensitivity: "base" })
        );
        setDistinctTags(nextTags);
        setDistinctStatuses(nextStatuses);
        setDistinctE2StatusUpdates(nextE2StatusUpdates);
        setLoadingTags(false);
        setLoadingStatuses(false);
      },
      () => {
        setDistinctTags([]);
        setDistinctStatuses([]);
        setDistinctE2StatusUpdates([]);
        setLoadingTags(false);
        setLoadingStatuses(false);
      }
    );

    const unsubscribeConfig = onSnapshot(
      configRef,
      (snapshot) => {
        const data = snapshot.data() || {};
        const aliases = data[TAG_ALIASES_FIELD] && typeof data[TAG_ALIASES_FIELD] === "object"
          ? data[TAG_ALIASES_FIELD]
          : {};
        const formats = data[STATUS_FORMATS_FIELD] && typeof data[STATUS_FORMATS_FIELD] === "object"
          ? data[STATUS_FORMATS_FIELD]
          : {};
        const e2Formats = data[E2_STATUS_UPDATE_FORMATS_FIELD] && typeof data[E2_STATUS_UPDATE_FORMATS_FIELD] === "object"
          ? data[E2_STATUS_UPDATE_FORMATS_FIELD]
          : {};

        setTagAliases(aliases);
        setStatusFormats(formats);
        setE2StatusUpdateFormats(e2Formats);
        setDraftAliases((previous) => {
          const next = { ...previous };
          Object.entries(aliases).forEach(([tag, alias]) => {
            if (next[tag] === undefined) {
              next[tag] = normalizeValue(alias);
            }
          });
          return next;
        });
        setDraftStatusFormats((previous) => {
          const next = { ...previous };
          Object.entries(formats).forEach(([status, format]) => {
            if (next[status] !== undefined) return;
            next[status] = {
              label: normalizeValue(format?.label),
              textColor: normalizeValue(format?.textColor) || defaultStatusDraft.textColor,
              backgroundColor: normalizeValue(format?.backgroundColor) || defaultStatusDraft.backgroundColor,
            };
          });
          return next;
        });
        setDraftE2StatusUpdateFormats((previous) => {
          const next = { ...previous };
          Object.entries(e2Formats).forEach(([value, format]) => {
            if (next[value] !== undefined) return;
            next[value] = {
              textColor: normalizeValue(format?.textColor) || defaultStatusDraft.textColor,
              backgroundColor: normalizeValue(format?.backgroundColor) || defaultStatusDraft.backgroundColor,
            };
          });
          return next;
        });
        setLoadingAliases(false);
      },
      () => {
        setTagAliases({});
        setStatusFormats({});
        setE2StatusUpdateFormats({});
        setLoadingAliases(false);
      }
    );

    return () => {
      unsubscribeProjects();
      unsubscribeConfig();
    };
  }, [id]);

  const loading = loadingTags || loadingStatuses || loadingAliases;

  const rows = useMemo(
    () => distinctTags.map((tag) => ({ tag, alias: normalizeValue(tagAliases[tag]) })),
    [distinctTags, tagAliases]
  );

  const statusRows = useMemo(
    () => distinctStatuses.map((status) => ({ status, format: statusFormats[status] || {} })),
    [distinctStatuses, statusFormats]
  );

  const e2StatusUpdateRows = useMemo(
    () => distinctE2StatusUpdates.map((value) => ({ value, format: e2StatusUpdateFormats[value] || {} })),
    [distinctE2StatusUpdates, e2StatusUpdateFormats]
  );

  const persistAlias = async (tag, aliasValue) => {
    if (!id || !tag) return;

    const cleanAlias = normalizeValue(aliasValue);
    const currentAlias = normalizeValue(tagAliases[tag]);

    if (cleanAlias === currentAlias) {
      toast.info("No changes to save.");
      return;
    }

    const nextAliases = { ...tagAliases };
    if (cleanAlias) {
      nextAliases[tag] = cleanAlias;
    } else {
      delete nextAliases[tag];
    }

    setSavingTag(tag);
    try {
      await setDoc(
        doc(db, "churches", id, "settings", PROJECT_ISSUE_CONFIG_DOC_ID),
        {
          [TAG_ALIASES_FIELD]: nextAliases,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      setTagAliases(nextAliases);
      setDraftAliases((previous) => ({ ...previous, [tag]: cleanAlias }));
      toast.success("Alias saved.");
    } catch (error) {
      console.error("Error saving tag alias:", error);
      toast.error("Could not save alias.");
    } finally {
      setSavingTag("");
    }
  };

  const persistStatusFormat = async (statusValue, draftFormat) => {
    if (!id || !statusValue) return;

    const currentFormat = statusFormats[statusValue] || {};
    const nextFormat = {
      label: normalizeValue(draftFormat?.label),
      textColor: normalizeValue(draftFormat?.textColor) || defaultStatusDraft.textColor,
      backgroundColor: normalizeValue(draftFormat?.backgroundColor) || defaultStatusDraft.backgroundColor,
    };

    const unchanged =
      normalizeValue(currentFormat.label) === nextFormat.label &&
      normalizeValue(currentFormat.textColor || defaultStatusDraft.textColor).toLowerCase() ===
        nextFormat.textColor.toLowerCase() &&
      normalizeValue(currentFormat.backgroundColor || defaultStatusDraft.backgroundColor).toLowerCase() ===
        nextFormat.backgroundColor.toLowerCase();

    if (unchanged) {
      toast.info("No changes to save.");
      return;
    }

    const nextFormats = {
      ...statusFormats,
      [statusValue]: nextFormat,
    };

    setSavingStatus(statusValue);
    try {
      await setDoc(
        doc(db, "churches", id, "settings", PROJECT_ISSUE_CONFIG_DOC_ID),
        {
          [STATUS_FORMATS_FIELD]: nextFormats,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      setStatusFormats(nextFormats);
      setDraftStatusFormats((previous) => ({ ...previous, [statusValue]: nextFormat }));
      toast.success("Status format saved.");
    } catch (error) {
      console.error("Error saving status format:", error);
      toast.error("Could not save status format.");
    } finally {
      setSavingStatus("");
    }
  };

  const persistE2StatusUpdateFormat = async (updateValue, draftFormat) => {
    if (!id || !updateValue) return;

    const currentFormat = e2StatusUpdateFormats[updateValue] || {};
    const nextFormat = {
      textColor: normalizeValue(draftFormat?.textColor) || defaultStatusDraft.textColor,
      backgroundColor: normalizeValue(draftFormat?.backgroundColor) || defaultStatusDraft.backgroundColor,
    };

    const unchanged =
      normalizeValue(currentFormat.textColor || defaultStatusDraft.textColor).toLowerCase() ===
        nextFormat.textColor.toLowerCase() &&
      normalizeValue(currentFormat.backgroundColor || defaultStatusDraft.backgroundColor).toLowerCase() ===
        nextFormat.backgroundColor.toLowerCase();

    if (unchanged) {
      toast.info("No changes to save.");
      return;
    }

    const nextFormats = { ...e2StatusUpdateFormats, [updateValue]: nextFormat };

    setSavingE2StatusUpdate(updateValue);
    try {
      await setDoc(
        doc(db, "churches", id, "settings", PROJECT_ISSUE_CONFIG_DOC_ID),
        { [E2_STATUS_UPDATE_FORMATS_FIELD]: nextFormats, updatedAt: serverTimestamp() },
        { merge: true }
      );
      setE2StatusUpdateFormats(nextFormats);
      setDraftE2StatusUpdateFormats((previous) => ({ ...previous, [updateValue]: nextFormat }));
      toast.success("Format saved.");
    } catch (error) {
      console.error("Error saving E2 Status Update format:", error);
      toast.error("Could not save format.");
    } finally {
      setSavingE2StatusUpdate("");
    }
  };

  const clearE2StatusUpdateFormat = async (updateValue) => {
    if (!id || !updateValue) return;
    if (!e2StatusUpdateFormats[updateValue]) {
      toast.info("No saved format to clear.");
      return;
    }

    const nextFormats = { ...e2StatusUpdateFormats };
    delete nextFormats[updateValue];

    setSavingE2StatusUpdate(updateValue);
    try {
      await setDoc(
        doc(db, "churches", id, "settings", PROJECT_ISSUE_CONFIG_DOC_ID),
        { [E2_STATUS_UPDATE_FORMATS_FIELD]: nextFormats, updatedAt: serverTimestamp() },
        { merge: true }
      );
      setE2StatusUpdateFormats(nextFormats);
      setDraftE2StatusUpdateFormats((previous) => ({
        ...previous,
        [updateValue]: { ...defaultStatusDraft },
      }));
      toast.success("Format cleared.");
    } catch (error) {
      console.error("Error clearing E2 Status Update format:", error);
      toast.error("Could not clear format.");
    } finally {
      setSavingE2StatusUpdate("");
    }
  };

  const clearStatusFormat = async (statusValue) => {
    if (!id || !statusValue) return;
    if (!statusFormats[statusValue]) {
      toast.info("No saved format to clear.");
      return;
    }

    const nextFormats = { ...statusFormats };
    delete nextFormats[statusValue];

    setSavingStatus(statusValue);
    try {
      await setDoc(
        doc(db, "churches", id, "settings", PROJECT_ISSUE_CONFIG_DOC_ID),
        {
          [STATUS_FORMATS_FIELD]: nextFormats,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      setStatusFormats(nextFormats);
      setDraftStatusFormats((previous) => ({
        ...previous,
        [statusValue]: { ...defaultStatusDraft },
      }));
      toast.success("Status format cleared.");
    } catch (error) {
      console.error("Error clearing status format:", error);
      toast.error("Could not clear status format.");
    } finally {
      setSavingStatus("");
    }
  };

  return (
    <div style={commonStyles.fullWidthContainer}>
      <Link to={`/organization/${id}/project-issue-dashboard`} style={commonStyles.backButtonLink}>
        ← Back to Project Issue Dashboard
      </Link>

      <ChurchHeader id={id} applyShadow={false} allowEditBannerLogo={true} />

      <div className="tag-alias-page">
        <div className="tag-alias-header">
          <h1 className="tag-alias-title">Add Aliases</h1>
          <p className="tag-alias-subtitle">
            Manage alias names for Tags and custom formatting for Status values.
          </p>
        </div>

        <div className="tag-alias-card">
          <div className="tag-alias-meta">
            <strong>Tags Values</strong>
            <span>{loading ? "Loading..." : `${rows.length} value(s)`}</span>
          </div>

          {loading ? <div className="tag-alias-empty">Loading tags...</div> : null}
          {!loading && !rows.length ? <div className="tag-alias-empty">No tags found in BIM project rows.</div> : null}

          {!loading && rows.length ? (
            <div className="tag-alias-table-wrap">
              <table className="tag-alias-table">
                <thead>
                  <tr>
                    <th>Tags</th>
                    <th>Tags Alias</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ tag, alias }) => {
                    const draft = draftAliases[tag] ?? alias;
                    const isDirty = normalizeValue(draft) !== normalizeValue(alias);
                    const isSaving = savingTag === tag;

                    return (
                      <tr key={tag}>
                        <td>{tag}</td>
                        <td>
                          <input
                            type="text"
                            className="tag-alias-input"
                            placeholder="Type alias name"
                            value={draft}
                            onChange={(event) =>
                              setDraftAliases((previous) => ({
                                ...previous,
                                [tag]: event.target.value,
                              }))
                            }
                            disabled={isSaving}
                          />
                        </td>
                        <td>
                          <div className="tag-alias-actions">
                            <button
                              type="button"
                              className="tag-alias-btn tag-alias-btn-primary"
                              onClick={() => persistAlias(tag, draft)}
                              disabled={!isDirty || isSaving}
                            >
                              {isSaving ? "Saving..." : "Save"}
                            </button>
                            <button
                              type="button"
                              className="tag-alias-btn"
                              onClick={() => persistAlias(tag, "")}
                              disabled={!alias || isSaving}
                            >
                              Clear
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>

        <div className="tag-alias-card">
          <div className="tag-alias-meta">
            <strong>Status Display Formatting</strong>
            <span>{loading ? "Loading..." : `${statusRows.length} value(s)`}</span>
          </div>

          {loading ? <div className="tag-alias-empty">Loading statuses...</div> : null}
          {!loading && !statusRows.length ? (
            <div className="tag-alias-empty">No status values found in BIM project rows.</div>
          ) : null}

          {!loading && statusRows.length ? (
            <div className="tag-alias-table-wrap">
              <table className="tag-alias-table">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Display Text</th>
                    <th>Font Color</th>
                    <th>Background Color</th>
                    <th>Preview</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {statusRows.map(({ status, format }) => {
                    const draft = draftStatusFormats[status] || {
                      label: normalizeValue(format?.label),
                      textColor: normalizeValue(format?.textColor) || defaultStatusDraft.textColor,
                      backgroundColor: normalizeValue(format?.backgroundColor) || defaultStatusDraft.backgroundColor,
                    };
                    const savedFormat = {
                      label: normalizeValue(format?.label),
                      textColor: normalizeValue(format?.textColor) || defaultStatusDraft.textColor,
                      backgroundColor: normalizeValue(format?.backgroundColor) || defaultStatusDraft.backgroundColor,
                    };
                    const isDirty =
                      normalizeValue(draft.label) !== savedFormat.label ||
                      normalizeValue(draft.textColor).toLowerCase() !== savedFormat.textColor.toLowerCase() ||
                      normalizeValue(draft.backgroundColor).toLowerCase() !== savedFormat.backgroundColor.toLowerCase();
                    const isSaving = savingStatus === status;
                    const previewText = normalizeValue(draft.label) || status;
                    const hasSavedFormat = !!statusFormats[status];

                    return (
                      <tr key={status}>
                        <td>{status}</td>
                        <td>
                          <input
                            type="text"
                            className="tag-alias-input"
                            placeholder="Optional display text"
                            value={draft.label}
                            onChange={(event) =>
                              setDraftStatusFormats((previous) => ({
                                ...previous,
                                [status]: {
                                  ...draft,
                                  label: event.target.value,
                                },
                              }))
                            }
                            disabled={isSaving}
                          />
                        </td>
                        <td>
                          <input
                            type="color"
                            className="tag-alias-color-input"
                            value={draft.textColor}
                            onChange={(event) =>
                              setDraftStatusFormats((previous) => ({
                                ...previous,
                                [status]: {
                                  ...draft,
                                  textColor: event.target.value,
                                },
                              }))
                            }
                            disabled={isSaving}
                            aria-label={`Font color for ${status}`}
                          />
                        </td>
                        <td>
                          <input
                            type="color"
                            className="tag-alias-color-input"
                            value={draft.backgroundColor}
                            onChange={(event) =>
                              setDraftStatusFormats((previous) => ({
                                ...previous,
                                [status]: {
                                  ...draft,
                                  backgroundColor: event.target.value,
                                },
                              }))
                            }
                            disabled={isSaving}
                            aria-label={`Background color for ${status}`}
                          />
                        </td>
                        <td>
                          <span
                            className="tag-alias-preview-badge"
                            style={{ color: draft.textColor, backgroundColor: draft.backgroundColor }}
                          >
                            {previewText}
                          </span>
                        </td>
                        <td>
                          <div className="tag-alias-actions">
                            <button
                              type="button"
                              className="tag-alias-btn tag-alias-btn-primary"
                              onClick={() => persistStatusFormat(status, draft)}
                              disabled={!isDirty || isSaving}
                            >
                              {isSaving ? "Saving..." : "Save"}
                            </button>
                            <button
                              type="button"
                              className="tag-alias-btn"
                              onClick={() => clearStatusFormat(status)}
                              disabled={!hasSavedFormat || isSaving}
                            >
                              Clear
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
        <div className="tag-alias-card">
          <div className="tag-alias-meta">
            <strong>E2 Status Update Formatting</strong>
            <span>{loading ? "Loading..." : `${e2StatusUpdateRows.length} value(s)`}</span>
          </div>

          {loading ? <div className="tag-alias-empty">Loading E2 Status Update values...</div> : null}
          {!loading && !e2StatusUpdateRows.length ? (
            <div className="tag-alias-empty">No E2 Status Update values found in BIM project rows.</div>
          ) : null}

          {!loading && e2StatusUpdateRows.length ? (
            <div className="tag-alias-table-wrap">
              <table className="tag-alias-table">
                <thead>
                  <tr>
                    <th>E2 Status Update</th>
                    <th>Font Color</th>
                    <th>Background Color</th>
                    <th>Preview</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {e2StatusUpdateRows.map(({ value, format }) => {
                    const draft = draftE2StatusUpdateFormats[value] || {
                      textColor: normalizeValue(format?.textColor) || defaultStatusDraft.textColor,
                      backgroundColor: normalizeValue(format?.backgroundColor) || defaultStatusDraft.backgroundColor,
                    };
                    const savedFormat = {
                      textColor: normalizeValue(format?.textColor) || defaultStatusDraft.textColor,
                      backgroundColor: normalizeValue(format?.backgroundColor) || defaultStatusDraft.backgroundColor,
                    };
                    const isDirty =
                      normalizeValue(draft.textColor).toLowerCase() !== savedFormat.textColor.toLowerCase() ||
                      normalizeValue(draft.backgroundColor).toLowerCase() !== savedFormat.backgroundColor.toLowerCase();
                    const isSaving = savingE2StatusUpdate === value;
                    const hasSavedFormat = !!e2StatusUpdateFormats[value];

                    return (
                      <tr key={value}>
                        <td>{value}</td>
                        <td>
                          <input
                            type="color"
                            className="tag-alias-color-input"
                            value={draft.textColor}
                            onChange={(event) =>
                              setDraftE2StatusUpdateFormats((previous) => ({
                                ...previous,
                                [value]: { ...draft, textColor: event.target.value },
                              }))
                            }
                            disabled={isSaving}
                            aria-label={`Font color for ${value}`}
                          />
                        </td>
                        <td>
                          <input
                            type="color"
                            className="tag-alias-color-input"
                            value={draft.backgroundColor}
                            onChange={(event) =>
                              setDraftE2StatusUpdateFormats((previous) => ({
                                ...previous,
                                [value]: { ...draft, backgroundColor: event.target.value },
                              }))
                            }
                            disabled={isSaving}
                            aria-label={`Background color for ${value}`}
                          />
                        </td>
                        <td>
                          <span
                            className="tag-alias-preview-badge"
                            style={{ color: draft.textColor, backgroundColor: draft.backgroundColor }}
                          >
                            {value}
                          </span>
                        </td>
                        <td>
                          <div className="tag-alias-actions">
                            <button
                              type="button"
                              className="tag-alias-btn tag-alias-btn-primary"
                              onClick={() => persistE2StatusUpdateFormat(value, draft)}
                              disabled={!isDirty || isSaving}
                            >
                              {isSaving ? "Saving..." : "Save"}
                            </button>
                            <button
                              type="button"
                              className="tag-alias-btn"
                              onClick={() => clearE2StatusUpdateFormat(value)}
                              disabled={!hasSavedFormat || isSaving}
                            >
                              Clear
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default TagAliasManager;
