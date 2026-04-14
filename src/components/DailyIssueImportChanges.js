import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { collection, onSnapshot } from "firebase/firestore";
import commonStyles from "../pages/commonStyles";
import ChurchHeader from "./ChurchHeader";
import { db } from "../firebase";

const DAILY_ISSUES_TARGET_PROJECT_ID = "stanford-ff-rad";
const DAILY_ISSUES_IMPORT_HISTORY_COLLECTION = "importHistory";

const normalizeValue = (value) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value).trim();
};

const toDateValue = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === "function") {
    const converted = value.toDate();
    return converted instanceof Date && !Number.isNaN(converted.getTime()) ? converted : null;
  }

  const parsed = new Date(value);
  return parsed instanceof Date && !Number.isNaN(parsed.getTime()) ? parsed : null;
};

const formatDateTime = (value) => {
  const dateValue = toDateValue(value);
  if (!dateValue) return "-";
  return dateValue.toLocaleString();
};

const DailyIssueImportChanges = () => {
  const { id } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [historyRows, setHistoryRows] = useState([]);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      setError("Organization ID is missing.");
      return () => {};
    }

    const historyRef = collection(
      db,
      "churches",
      id,
      "bimProjects",
      DAILY_ISSUES_TARGET_PROJECT_ID,
      DAILY_ISSUES_IMPORT_HISTORY_COLLECTION
    );

    const unsubscribe = onSnapshot(
      historyRef,
      (snapshot) => {
        const nextRows = snapshot.docs
          .map((docSnapshot) => {
            const data = docSnapshot.data() || {};
            return {
              id: docSnapshot.id,
              ...data,
            };
          })
          .sort((a, b) => {
            const aTime = toDateValue(a.createdAt)?.getTime() || 0;
            const bTime = toDateValue(b.createdAt)?.getTime() || 0;
            return bTime - aTime;
          });

        setHistoryRows(nextRows);
        setLoading(false);
      },
      (snapshotError) => {
        console.error("Failed to load import history:", snapshotError);
        setError("Could not load import change history.");
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [id]);

  const latestImport = historyRows[0] || null;

  const latestStatusTransitions = useMemo(() => {
    if (!latestImport) return [];
    const transitions = Array.isArray(latestImport.statusTransitions) ? latestImport.statusTransitions : [];

    return transitions
      .map((transition) => ({
        from: normalizeValue(transition?.from) || "-",
        to: normalizeValue(transition?.to) || "-",
        count: Number(transition?.count) || 0,
      }))
      .filter((transition) => transition.count > 0)
      .sort((a, b) => b.count - a.count || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  }, [latestImport]);

  return (
    <div style={{ ...commonStyles.pageContainer, width: "100%" }}>
      <Link to={`/organization/${id}/project-issue-dashboard`} style={commonStyles.backButtonLink}>
        ← Back to Project Issue Dashboard
      </Link>

      <ChurchHeader id={id} applyShadow={false} allowEditBannerLogo={true} />

      <div style={{ marginTop: "-30px" }}>
        <h1 style={commonStyles.title}>Daily Issues Import Changes</h1>
        <p style={{ color: "#4b5563", marginTop: "8px", marginBottom: "18px" }}>
          Track what changed on each Daily Issues import.
        </p>

        {loading ? <div style={{ color: "#6b7280" }}>Loading import history...</div> : null}
        {!loading && error ? <div style={{ color: "#b91c1c" }}>{error}</div> : null}

        {!loading && !error && !latestImport ? (
          <div style={{ color: "#6b7280" }}>
            No import history yet. Run an upload from Project Issue Dashboard and the report will appear here.
          </div>
        ) : null}

        {!loading && !error && latestImport ? (
          <>
            <section
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: "10px",
                background: "#fff",
                padding: "14px",
                marginBottom: "14px",
              }}
            >
              <h2 style={{ margin: 0, fontSize: "18px", color: "#111827" }}>Latest Import Summary</h2>
              <div style={{ color: "#6b7280", marginTop: "6px", marginBottom: "10px", fontSize: "13px" }}>
                {formatDateTime(latestImport.createdAt)} · File: {normalizeValue(latestImport.fileName) || "-"} · Sheet: {normalizeValue(latestImport.sheetName) || "-"}
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
                  gap: "10px",
                }}
              >
                <div style={{ border: "1px solid #e5e7eb", borderRadius: "8px", padding: "10px", background: "#f8fafc" }}>
                  <div style={{ fontSize: "12px", color: "#6b7280" }}>New Issues</div>
                  <div style={{ fontSize: "24px", fontWeight: 700, color: "#111827" }}>{Number(latestImport.insertedRowsCount) || 0}</div>
                </div>
                <div style={{ border: "1px solid #e5e7eb", borderRadius: "8px", padding: "10px", background: "#f8fafc" }}>
                  <div style={{ fontSize: "12px", color: "#6b7280" }}>Updated Issues</div>
                  <div style={{ fontSize: "24px", fontWeight: 700, color: "#111827" }}>{Number(latestImport.updatedRowsCount) || 0}</div>
                </div>
                <div style={{ border: "1px solid #e5e7eb", borderRadius: "8px", padding: "10px", background: "#f8fafc" }}>
                  <div style={{ fontSize: "12px", color: "#6b7280" }}>Status Moves</div>
                  <div style={{ fontSize: "24px", fontWeight: 700, color: "#111827" }}>{Number(latestImport.statusMovedTotal) || 0}</div>
                </div>
                <div style={{ border: "1px solid #e5e7eb", borderRadius: "8px", padding: "10px", background: "#f8fafc" }}>
                  <div style={{ fontSize: "12px", color: "#6b7280" }}>Changed Cells</div>
                  <div style={{ fontSize: "24px", fontWeight: 700, color: "#111827" }}>{Number(latestImport.changedCells) || 0}</div>
                </div>
              </div>
            </section>

            <section
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: "10px",
                background: "#fff",
                padding: "14px",
                marginBottom: "14px",
              }}
            >
              <h2 style={{ margin: 0, fontSize: "18px", color: "#111827", marginBottom: "10px" }}>Latest Status Transition Breakdown</h2>

              {latestStatusTransitions.length === 0 ? (
                <div style={{ color: "#6b7280" }}>No status transitions in the latest import.</div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", minWidth: "540px", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                        <th style={{ textAlign: "left", padding: "8px", fontSize: "12px", color: "#6b7280" }}>From Status</th>
                        <th style={{ textAlign: "left", padding: "8px", fontSize: "12px", color: "#6b7280" }}>To Status</th>
                        <th style={{ textAlign: "right", padding: "8px", fontSize: "12px", color: "#6b7280" }}>Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {latestStatusTransitions.map((transition) => (
                        <tr key={`${transition.from}-${transition.to}`} style={{ borderBottom: "1px solid #f1f5f9" }}>
                          <td style={{ padding: "8px", color: "#111827" }}>{transition.from}</td>
                          <td style={{ padding: "8px", color: "#111827" }}>{transition.to}</td>
                          <td style={{ padding: "8px", color: "#111827", textAlign: "right", fontWeight: 700 }}>{transition.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: "10px",
                background: "#fff",
                padding: "14px",
              }}
            >
              <h2 style={{ margin: 0, fontSize: "18px", color: "#111827", marginBottom: "10px" }}>Import History</h2>

              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", minWidth: "860px", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                      <th style={{ textAlign: "left", padding: "8px", fontSize: "12px", color: "#6b7280" }}>Imported At</th>
                      <th style={{ textAlign: "left", padding: "8px", fontSize: "12px", color: "#6b7280" }}>File</th>
                      <th style={{ textAlign: "left", padding: "8px", fontSize: "12px", color: "#6b7280" }}>Sheet</th>
                      <th style={{ textAlign: "right", padding: "8px", fontSize: "12px", color: "#6b7280" }}>New</th>
                      <th style={{ textAlign: "right", padding: "8px", fontSize: "12px", color: "#6b7280" }}>Updated</th>
                      <th style={{ textAlign: "right", padding: "8px", fontSize: "12px", color: "#6b7280" }}>Status Moves</th>
                      <th style={{ textAlign: "right", padding: "8px", fontSize: "12px", color: "#6b7280" }}>Changed Cells</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyRows.map((item) => (
                      <tr key={item.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "8px", color: "#111827" }}>{formatDateTime(item.createdAt)}</td>
                        <td style={{ padding: "8px", color: "#111827" }}>{normalizeValue(item.fileName) || "-"}</td>
                        <td style={{ padding: "8px", color: "#111827" }}>{normalizeValue(item.sheetName) || "-"}</td>
                        <td style={{ padding: "8px", color: "#111827", textAlign: "right" }}>{Number(item.insertedRowsCount) || 0}</td>
                        <td style={{ padding: "8px", color: "#111827", textAlign: "right" }}>{Number(item.updatedRowsCount) || 0}</td>
                        <td style={{ padding: "8px", color: "#111827", textAlign: "right", fontWeight: 700 }}>{Number(item.statusMovedTotal) || 0}</td>
                        <td style={{ padding: "8px", color: "#111827", textAlign: "right" }}>{Number(item.changedCells) || 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
};

export default DailyIssueImportChanges;
