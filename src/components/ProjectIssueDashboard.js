import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { collection, onSnapshot } from "firebase/firestore";
import commonStyles from "../pages/commonStyles";
import ChurchHeader from "./ChurchHeader";
import { db } from "../firebase";
import "./ProjectIssueDashboard.css";

const normalizeValue = (value) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value instanceof Date) return value.toISOString();
  if (typeof value?.toDate === "function") {
    return value.toDate().toISOString();
  }
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

const getCardPreview = (rowData = {}, fields = []) => {
  const titleField = findFieldByAliases(fields, rowData, ["title", "task title", "name"]);
  const statusField = findFieldByAliases(fields, rowData, ["status", "state", "task status"]);
  const priorityField = findFieldByAliases(fields, rowData, ["priority"]);
  const zoneField = findFieldByAliases(fields, rowData, ["zone", "area", "section", "location zone"]);
  const assigneeField = findFieldByAliases(fields, rowData, ["assignee", "assigned to", "owner", "responsible"]);
  const deadlineField = findFieldByAliases(fields, rowData, ["deadline", "due date", "due", "target date"]);
  const idField = findFieldByAliases(fields, rowData, ["id", "task id", "card id", "row id"]);

  return {
    title: normalizeValue(titleField ? rowData?.[titleField] : ""),
    status: normalizeValue(statusField ? rowData?.[statusField] : ""),
    priority: normalizeValue(priorityField ? rowData?.[priorityField] : ""),
    zone: normalizeValue(zoneField ? rowData?.[zoneField] : ""),
    assignee: normalizeValue(assigneeField ? rowData?.[assigneeField] : ""),
    deadline: normalizeValue(deadlineField ? rowData?.[deadlineField] : ""),
    id: normalizeValue(idField ? rowData?.[idField] : ""),
  };
};

const getCardMetaKey = (row = {}, preview = {}) => {
  const normalizedId = normalizeValue(preview?.id);
  if (normalizedId) return `id:${normalizedId}`;
  return `row:${row?.rowNumber || "unknown"}`;
};

const getZoneCategory = (zoneValue) => {
  const zone = normalizeValue(zoneValue).toLowerCase();
  if (zone.includes("ff phase 1")) return "Fluoroscopy";
  if (zone.includes("rad phase 1")) return "Radiology";
  return "Other";
};

const ProjectIssueDashboard = () => {
  const { id } = useParams();
  const [activeTab, setActiveTab] = useState("All");
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedZoneCategories, setSelectedZoneCategories] = useState([]);
  const [zoneFilterOpen, setZoneFilterOpen] = useState(false);
  const [zoneFilterSearch, setZoneFilterSearch] = useState("");
  const [globalSearch, setGlobalSearch] = useState("");
  const zoneFilterRef = useRef(null);

  useEffect(() => {
    if (!id) return undefined;

    setLoading(true);
    const projectsRef = collection(db, "churches", id, "bimProjects");

    const unsubscribe = onSnapshot(
      projectsRef,
      (snapshot) => {
        const nextIssues = [];

        snapshot.forEach((projectDoc) => {
          const projectData = projectDoc.data() || {};
          const projectName = normalizeValue(projectData.name) || projectDoc.id;
          const fields = Array.isArray(projectData.fields) ? projectData.fields : [];
          const rows = Array.isArray(projectData.rows) ? projectData.rows : [];
          const internalCardMeta = projectData.internalCardMeta || {};

          rows.forEach((row, rowIndex) => {
            const rowData = row?.rowData || {};
            const preview = getCardPreview(rowData, fields);
            const cardKey = getCardMetaKey(row, preview);
            const internalMeta = internalCardMeta?.[cardKey] || {};

            nextIssues.push({
              key: `${projectDoc.id}-${row?.rowNumber || rowIndex}`,
              id: preview.id || String(row?.rowNumber || rowIndex + 1),
              title: preview.title || "Untitled issue",
              owner: normalizeValue(preview.assignee) || normalizeValue(internalMeta.internalAssignee) || "Unassigned",
              priority: preview.priority || "-",
              zone: preview.zone || "-",
              zoneCategory: getZoneCategory(preview.zone || ""),
              status: preview.status || "Open",
              dueDate: preview.deadline || "-",
              project: projectName,
            });
          });
        });

        setIssues(nextIssues);
        setLoading(false);
      },
      () => {
        setIssues([]);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [id]);

  const tabs = useMemo(() => {
    const dynamicStatuses = Array.from(new Set(issues.map((issue) => normalizeValue(issue.status)).filter(Boolean)));
    return ["All", ...dynamicStatuses];
  }, [issues]);

  const visibleIssues = useMemo(() => {
    const normalizedSearch = normalizeValue(globalSearch).toLowerCase();

    return issues.filter((issue) => {
      if (activeTab !== "All" && issue.status !== activeTab) {
        return false;
      }

      if (selectedZoneCategories.length && !selectedZoneCategories.includes(issue.zoneCategory)) {
        return false;
      }

      if (!normalizedSearch) return true;

      const haystack = [
        issue.project,
        issue.id,
        issue.title,
        issue.owner,
        issue.priority,
        issue.zone,
        issue.zoneCategory,
        issue.status,
        issue.dueDate,
      ]
        .map((value) => normalizeValue(value).toLowerCase())
        .join(" ");

      return haystack.includes(normalizedSearch);
    });
  }, [activeTab, globalSearch, issues, selectedZoneCategories]);

  const zoneCategoryOptions = useMemo(
    () => Array.from(new Set(issues.map((issue) => issue.zoneCategory))).sort((a, b) => a.localeCompare(b)),
    [issues]
  );

  const visibleZoneCategoryOptions = useMemo(() => {
    const search = normalizeValue(zoneFilterSearch).toLowerCase();
    if (!search) return zoneCategoryOptions;
    return zoneCategoryOptions.filter((option) => option.toLowerCase().includes(search));
  }, [zoneCategoryOptions, zoneFilterSearch]);

  useEffect(() => {
    if (!tabs.includes(activeTab)) {
      setActiveTab("All");
    }
  }, [activeTab, tabs]);

  useEffect(() => {
    const onClickOutside = (event) => {
      if (!zoneFilterRef.current) return;
      if (!zoneFilterRef.current.contains(event.target)) {
        setZoneFilterOpen(false);
      }
    };

    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const toggleZoneCategory = (category) => {
    setSelectedZoneCategories((previous) => {
      if (previous.includes(category)) {
        return previous.filter((item) => item !== category);
      }
      return [...previous, category];
    });
  };

  return (
    <div style={commonStyles.fullWidthContainer}>
      <Link to={`/organization/${id}/mi-organizacion`} style={commonStyles.backButtonLink}>
        ← Back to My Organization
      </Link>

      <ChurchHeader id={id} applyShadow={false} allowEditBannerLogo={true} />

      <div className="project-issue-wrap">
        <div className="project-issue-head">
          <h1 className="project-issue-title">Project Issue Dashboard</h1>
          <p className="project-issue-subtitle">
            Tracking live issues from BIM projects.
          </p>
        </div>

        <div className="project-issue-tabs" role="tablist" aria-label="Issue status tabs">
          {tabs.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              className={`project-issue-tab ${activeTab === tab ? "is-active" : ""}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="project-issue-filters">
          <div className="project-issue-filter" ref={zoneFilterRef}>
            <button
              type="button"
              className="project-issue-filter-trigger"
              onClick={() => setZoneFilterOpen((previous) => !previous)}
            >
              {selectedZoneCategories.length
                ? `Zone Category (${selectedZoneCategories.length})`
                : "Filter Zone Category"}
            </button>

            {zoneFilterOpen ? (
              <div className="project-issue-filter-panel">
                <input
                  type="text"
                  className="project-issue-filter-search"
                  placeholder="Search categories"
                  value={zoneFilterSearch}
                  onChange={(event) => setZoneFilterSearch(event.target.value)}
                />
                <div className="project-issue-filter-options">
                  {visibleZoneCategoryOptions.map((option) => (
                    <label key={option} className="project-issue-filter-option">
                      <input
                        type="checkbox"
                        className="project-issue-filter-checkbox"
                        checked={selectedZoneCategories.includes(option)}
                        onChange={() => toggleZoneCategory(option)}
                      />
                      <span>{option}</span>
                    </label>
                  ))}
                  {!visibleZoneCategoryOptions.length ? (
                    <div className="project-issue-filter-empty">No matches</div>
                  ) : null}
                </div>
                <div className="project-issue-filter-actions">
                  <button
                    type="button"
                    className="project-issue-filter-clear"
                    onClick={() => setSelectedZoneCategories([])}
                  >
                    Clear
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <input
            type="text"
            className="project-issue-global-search"
            placeholder="Search any text, letter, ID, owner, zone..."
            value={globalSearch}
            onChange={(event) => setGlobalSearch(event.target.value)}
          />
        </div>

        <div className="project-issue-table-shell">
          <table className="project-issue-table">
            <thead>
              <tr>
                <th>Project</th>
                <th>Issue ID</th>
                <th>Title</th>
                <th>Owner</th>
                <th>Priority</th>
                <th>Zone</th>
                <th>Zone Category</th>
                <th>Status</th>
                <th>Due Date</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="project-issue-empty">
                    Loading BIM issues...
                  </td>
                </tr>
              ) : null}
              {visibleIssues.map((issue) => (
                <tr key={issue.key}>
                  <td data-label="Project">{issue.project}</td>
                  <td data-label="Issue ID">{issue.id}</td>
                  <td data-label="Title">{issue.title}</td>
                  <td data-label="Owner">{issue.owner}</td>
                  <td data-label="Priority">{issue.priority}</td>
                  <td data-label="Zone">{issue.zone}</td>
                  <td data-label="Zone Category">{issue.zoneCategory}</td>
                  <td data-label="Status">
                    <span className={`issue-status issue-status-${issue.status.toLowerCase().replace(/\s+/g, "-")}`}>
                      {issue.status}
                    </span>
                  </td>
                  <td data-label="Due Date">{issue.dueDate}</td>
                </tr>
              ))}
              {!loading && !visibleIssues.length ? (
                <tr>
                  <td colSpan={9} className="project-issue-empty">
                    No issues in this tab.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ProjectIssueDashboard;
