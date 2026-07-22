import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { toast } from "react-toastify";
import ChurchHeader from "./ChurchHeader";
import commonStyles from "../pages/commonStyles";
import { db } from "../firebase";

const cardStyle = {
  background: "#FFFFFF",
  border: "1px solid #E2E8F0",
  borderRadius: "14px",
  padding: "16px",
};

const normalizeValue = (value) => String(value || "").trim();

const normalizeStringArray = (values) => {
  if (!Array.isArray(values)) return [];
  return values.map((entry) => normalizeValue(entry)).filter(Boolean);
};

const normalizeSheetLogIdentifierArray = (value) => {
  if (Array.isArray(value)) {
    return normalizeStringArray(value);
  }

  const normalized = normalizeValue(value);
  if (!normalized) return [];

  return normalizeStringArray(
    normalized
      .split(/[\n,;|]+/)
      .map((entry) => normalizeValue(entry))
      .filter(Boolean)
  );
};

const toMillis = (value) => {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") return value.toMillis();
  const asDate = value?.toDate?.() || new Date(value);
  if (!asDate || Number.isNaN(asDate.getTime())) return 0;
  return asDate.getTime();
};

const formatDateTime = (value) => {
  const asDate = value?.toDate?.() || (value ? new Date(value) : null);
  if (!asDate || Number.isNaN(asDate.getTime())) return "-";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(asDate);
};

const formatDateOnly = (value) => {
  const normalized = normalizeValue(value);
  if (!normalized) return "-";
  const asDate = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(asDate.getTime())) return normalized;

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(asDate);
};

const WorkProgressTaskDetailPage = () => {
  const { id, taskId } = useParams();
  const [loading, setLoading] = useState(true);
  const [task, setTask] = useState(null);
  const [parentTask, setParentTask] = useState(null);
  const [childTasks, setChildTasks] = useState([]);
  const [linkedSheetLog, setLinkedSheetLog] = useState(null);
  const [copying, setCopying] = useState(false);

  const routePrefix =
    typeof window !== "undefined" && window.location?.pathname?.includes("/church/")
      ? "/church"
      : "/organization";

  useEffect(() => {
    let active = true;

    const loadTaskDetail = async () => {
      if (!id || !taskId) {
        if (active) {
          setTask(null);
          setParentTask(null);
          setChildTasks([]);
          setLoading(false);
        }
        return;
      }

      setLoading(true);

      try {
        const taskRef = doc(db, "churches", id, "commitments", taskId);
        const taskSnapshot = await getDoc(taskRef);

        if (!taskSnapshot.exists()) {
          if (!active) return;
          setTask(null);
          setParentTask(null);
          setChildTasks([]);
          setLoading(false);
          return;
        }

        const loadedTask = { id: taskSnapshot.id, ...taskSnapshot.data() };

        let loadedSheetLog = null;
        const linkedSheetLogId = normalizeValue(loadedTask.sheetLogId);
        if (linkedSheetLogId) {
          const sheetLogSnapshot = await getDoc(doc(db, "churches", id, "workProgressSheetLogs", linkedSheetLogId));
          if (sheetLogSnapshot.exists()) {
            loadedSheetLog = { id: sheetLogSnapshot.id, ...sheetLogSnapshot.data() };
          }
        }

        const parentTaskId = normalizeValue(loadedTask.parentTaskId);
        let loadedParentTask = null;

        if (parentTaskId) {
          const parentSnapshot = await getDoc(doc(db, "churches", id, "commitments", parentTaskId));
          if (parentSnapshot.exists()) {
            loadedParentTask = { id: parentSnapshot.id, ...parentSnapshot.data() };
          }
        }

        const childSnapshot = await getDocs(
          query(collection(db, "churches", id, "commitments"), where("parentTaskId", "==", taskId))
        );

        const loadedChildren = childSnapshot.docs
          .map((entry) => ({ id: entry.id, ...entry.data() }))
          .sort((leftTask, rightTask) => {
            const leftOrder = Number(leftTask.taskOrder) || 0;
            const rightOrder = Number(rightTask.taskOrder) || 0;
            if (leftOrder !== rightOrder) return leftOrder - rightOrder;
            return toMillis(leftTask.createdAt) - toMillis(rightTask.createdAt);
          });

        if (!active) return;
        setTask(loadedTask);
        setParentTask(loadedParentTask);
        setChildTasks(loadedChildren);
        setLinkedSheetLog(loadedSheetLog);
      } catch (error) {
        console.error("Failed to load Work Progress task detail:", error);
        if (active) {
          toast.error("Could not load task detail.");
          setTask(null);
          setParentTask(null);
          setChildTasks([]);
          setLinkedSheetLog(null);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    loadTaskDetail();

    return () => {
      active = false;
    };
  }, [id, taskId]);

  const linkedSheetLogIdentifiers = useMemo(() => {
    if (!task) return [];

    const sheetLogSource = linkedSheetLog || task;
    return normalizeSheetLogIdentifierArray(
      Array.isArray(sheetLogSource?.identifiers) && sheetLogSource.identifiers.length > 0
        ? sheetLogSource.identifiers
        : sheetLogSource?.identifier
    );
  }, [linkedSheetLog, task]);

  const directLink = useMemo(() => {
    if (typeof window === "undefined" || !id || !taskId) return "";
    return `${window.location.origin}${routePrefix}/${id}/work-progress/task/${taskId}`;
  }, [id, routePrefix, taskId]);

  const sortedLogEntries = useMemo(() => {
    const entries = Array.isArray(task?.changeLog) ? task.changeLog : [];

    return entries
      .filter((entry) => entry && typeof entry === "object")
      .map((entry, index) => ({
        id: normalizeValue(entry.id) || `${toMillis(entry.changedAtIso)}-${index}`,
        message: normalizeValue(entry.message),
        changedByName: normalizeValue(entry.changedByName),
        changedAtIso: entry.changedAtIso,
        attachment: entry.attachment && typeof entry.attachment === "object"
          ? {
              name: normalizeValue(entry.attachment.name),
              url: normalizeValue(entry.attachment.url),
            }
          : null,
      }))
      .sort((leftEntry, rightEntry) => toMillis(rightEntry.changedAtIso) - toMillis(leftEntry.changedAtIso));
  }, [task]);

  const handleCopyDirectLink = async () => {
    if (!directLink || !navigator?.clipboard?.writeText) {
      toast.info("Copy is not available in this browser.");
      return;
    }

    setCopying(true);

    try {
      await navigator.clipboard.writeText(directLink);
      toast.success("Direct link copied.");
    } catch (error) {
      console.error("Failed to copy direct link:", error);
      toast.error("Could not copy direct link.");
    } finally {
      setCopying(false);
    }
  };

  return (
    <div style={{ width: "100%", padding: "1rem" }}>
      <ChurchHeader id={id} />

      <div style={{ width: "100%", maxWidth: "1100px", margin: "0 auto" }}>
        <Link
          to={`${routePrefix}/${id}/work-progress`}
          style={{ ...commonStyles.backButtonLink, display: "inline-block", marginBottom: "14px" }}
        >
          Back to Work Progress
        </Link>

        <h1 style={{ ...commonStyles.title, textAlign: "left", marginBottom: "8px" }}>Task Detail</h1>

        {loading ? (
          <div style={{ color: "#64748B", textAlign: "left" }}>Loading task detail...</div>
        ) : !task ? (
          <div style={{ ...cardStyle, color: "#64748B", textAlign: "left" }}>
            Task not found. It may have been deleted.
          </div>
        ) : (
          <div style={{ display: "grid", gap: "14px" }}>
            <div style={{ ...cardStyle, background: "linear-gradient(135deg, #F8FAFC 0%, #EEF2FF 100%)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px", flexWrap: "wrap" }}>
                <div>
                  <div style={{ color: "#475569", fontSize: "0.78rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    {normalizeValue(task.projectName) || "Untitled Project"}
                  </div>
                  <div style={{ color: "#0F172A", fontSize: "1.5rem", fontWeight: 900, lineHeight: 1.1, marginTop: "4px" }}>
                    {normalizeValue(task.title) || "Untitled Task"}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleCopyDirectLink}
                  disabled={copying || !directLink}
                  style={{
                    border: "none",
                    borderRadius: "10px",
                    padding: "8px 12px",
                    cursor: copying || !directLink ? "not-allowed" : "pointer",
                    color: "#FFFFFF",
                    fontWeight: 700,
                    background: copying ? "#94A3B8" : "linear-gradient(135deg, #1D4ED8 0%, #60A5FA 100%)",
                  }}
                >
                  {copying ? "Copying..." : "Copy Direct Link"}
                </button>
              </div>

              {directLink ? (
                <div style={{ marginTop: "8px", color: "#334155", fontSize: "0.86rem", wordBreak: "break-all" }}>
                  {directLink}
                </div>
              ) : null}
            </div>

            <div style={cardStyle}>
              <div style={{ color: "#0F172A", fontWeight: 800, marginBottom: "10px" }}>Task Data</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "10px" }}>
                <div><strong>ID:</strong> {task.id}</div>
                <div><strong>Status:</strong> {normalizeValue(task.status) || "open"}</div>
                <div><strong>Priority:</strong> {normalizeValue(task.priority) || "-"}</div>
                <div><strong>Direction:</strong> {normalizeValue(task.direction) || "-"}</div>
                <div><strong>Progress:</strong> {Number(task.progressPercent) || 0}%</div>
                <div><strong>Due Date:</strong> {formatDateOnly(task.dueDate)}</div>
                <div><strong>Category:</strong> {normalizeValue(task.categoryName) || "Uncategorized"}</div>
                <div><strong>Category ID:</strong> {normalizeValue(task.categoryId) || "-"}</div>
                <div><strong>Parent Task:</strong> {parentTask ? normalizeValue(parentTask.title) : normalizeValue(task.parentTaskId) || "-"}</div>
                <div><strong>Created By:</strong> {normalizeValue(task.createdByName) || "-"}</div>
                <div><strong>Created At:</strong> {formatDateTime(task.createdAt)}</div>
                <div><strong>Updated At:</strong> {formatDateTime(task.updatedAt)}</div>
              </div>

              {normalizeValue(task.sheetLogId) ? (
                <div style={{ marginTop: "14px", padding: "12px", borderRadius: "12px", background: "rgba(79, 70, 229, 0.08)", border: "1px solid rgba(99, 102, 241, 0.18)" }}>
                  <div style={{ color: "#312E81", fontWeight: 800, marginBottom: "6px" }}>
                    Associated Sheet Log
                  </div>
                  <div style={{ display: "grid", gap: "4px", color: "#4338CA", fontSize: "0.84rem" }}>
                    <div><strong>Name:</strong> {normalizeValue(linkedSheetLog?.sheetName) || normalizeValue(task.sheetLogSheetName) || normalizeValue(task.sheetLogId)}</div>
                    <div><strong>Type:</strong> {normalizeValue(linkedSheetLog?.type) || normalizeValue(task.sheetLogType) || "-"}</div>
                    <div><strong>Revision:</strong> {normalizeValue(linkedSheetLog?.revisionNumber) || normalizeValue(task.sheetLogRevisionNumber) || "-"}</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center" }}>
                      <strong>Identifiers:</strong>
                      {linkedSheetLogIdentifiers.length > 0 ? linkedSheetLogIdentifiers.map((identifierValue, index) => (
                        <span
                          key={`${task.id}-detail-linked-sheet-log-identifier-${index}`}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            padding: "3px 8px",
                            borderRadius: "999px",
                            background: "rgba(255, 255, 255, 0.86)",
                            border: "1px solid rgba(99, 102, 241, 0.22)",
                            color: "#312E81",
                            fontWeight: 800,
                          }}
                        >
                          {identifierValue}
                        </span>
                      )) : <span>-</span>}
                    </div>
                  </div>
                </div>
              ) : null}

              <div style={{ marginTop: "12px" }}>
                <div style={{ color: "#334155", fontWeight: 700, marginBottom: "4px" }}>Description</div>
                <div style={{ color: "#475569", whiteSpace: "pre-wrap" }}>{normalizeValue(task.description) || "-"}</div>
              </div>

              <div style={{ marginTop: "12px" }}>
                <div style={{ color: "#334155", fontWeight: 700, marginBottom: "4px" }}>Notes</div>
                <div style={{ color: "#475569", whiteSpace: "pre-wrap" }}>{normalizeValue(task.notes) || "-"}</div>
              </div>
            </div>

            <div style={cardStyle}>
              <div style={{ color: "#0F172A", fontWeight: 800, marginBottom: "10px" }}>
                Subtasks ({childTasks.length})
              </div>

              {childTasks.length === 0 ? (
                <div style={{ color: "#64748B" }}>No subtasks.</div>
              ) : (
                <div style={{ display: "grid", gap: "8px" }}>
                  {childTasks.map((childTask) => (
                    <Link
                      key={childTask.id}
                      to={`${routePrefix}/${id}/work-progress/task/${childTask.id}`}
                      style={{
                        textDecoration: "none",
                        border: "1px solid #E2E8F0",
                        borderRadius: "10px",
                        padding: "10px",
                        color: "#0F172A",
                        background: "#F8FAFC",
                      }}
                    >
                      <div style={{ fontWeight: 700 }}>{normalizeValue(childTask.title) || "Untitled Task"}</div>
                      <div style={{ color: "#64748B", fontSize: "0.82rem", marginTop: "2px" }}>
                        {normalizeValue(childTask.status) || "open"} - {Number(childTask.progressPercent) || 0}%
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            <div style={cardStyle}>
              <div style={{ color: "#0F172A", fontWeight: 800, marginBottom: "10px" }}>
                Change Log ({sortedLogEntries.length})
              </div>

              {sortedLogEntries.length === 0 ? (
                <div style={{ color: "#64748B" }}>No log entries.</div>
              ) : (
                <div style={{ display: "grid", gap: "8px" }}>
                  {sortedLogEntries.map((entry) => (
                    <div key={entry.id} style={{ border: "1px solid #E2E8F0", borderRadius: "10px", padding: "10px", background: "#F8FAFC" }}>
                      <div style={{ color: "#0F172A", fontWeight: 700 }}>
                        {entry.message || "(no message)"}
                      </div>
                      <div style={{ color: "#64748B", fontSize: "0.8rem", marginTop: "2px" }}>
                        {formatDateTime(entry.changedAtIso)}
                        {entry.changedByName ? ` - ${entry.changedByName}` : ""}
                      </div>
                      {entry.attachment?.url ? (
                        <a
                          href={entry.attachment.url}
                          target="_blank"
                          rel="noreferrer"
                          style={{ display: "inline-block", marginTop: "6px", color: "#1D4ED8", fontWeight: 700, fontSize: "0.82rem" }}
                        >
                          Attachment: {entry.attachment.name || "Open file"}
                        </a>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={cardStyle}>
              <div style={{ color: "#0F172A", fontWeight: 800, marginBottom: "8px" }}>Raw JSON</div>
              <pre style={{ margin: 0, fontSize: "0.78rem", color: "#334155", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {JSON.stringify(task, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default WorkProgressTaskDetailPage;
