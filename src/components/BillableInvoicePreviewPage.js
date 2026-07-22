import React, { useMemo, useRef } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import * as XLSX from "xlsx";
import * as html2pdfLib from "html2pdf.js";
import commonStyles from "../pages/commonStyles";

const tableHeaderCellStyle = {
  textAlign: "left",
  padding: "10px 8px",
  borderBottom: "1px solid #E5E7EB",
  background: "#F8FAFC",
  color: "#475569",
  fontSize: "0.76rem",
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
};

const tableBodyCellStyle = {
  padding: "10px 8px",
  borderBottom: "1px solid #F1F5F9",
  verticalAlign: "top",
  fontSize: "0.9rem",
  color: "#111827",
};

const numericBodyCellStyle = {
  ...tableBodyCellStyle,
  textAlign: "right",
  whiteSpace: "nowrap",
  fontVariantNumeric: "tabular-nums",
};

const cardStyle = {
  background: "#FFFFFF",
  border: "1px solid #E5E7EB",
  borderRadius: "12px",
  padding: "16px",
};

const formatCurrency = (value) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return "$0.00";

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numericValue);
};

const formatMonthDayYear = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "-";

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!isoMatch) return raw;

  const [, yearText, monthText, dayText] = isoMatch;
  const parsed = new Date(Number(yearText), Number(monthText) - 1, Number(dayText));
  if (Number.isNaN(parsed.getTime())) return raw;

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
};

const DEFAULT_OVERTIME_THRESHOLD_HOURS = 40;
const DEFAULT_OVERTIME_MULTIPLIER = 1.5;

const getIssueDetailsText = (entry = {}) => {
  const explicitDescription = String(entry.description || entry.title || "").trim();
  if (explicitDescription) return explicitDescription;

  const taskIdentity = String(entry.taskIdentity || "").trim();
  if (taskIdentity) return taskIdentity;

  const projectDocId = String(entry.projectDocId || "").trim();
  const issueId = String(entry.issueId || "").trim();
  if (projectDocId || issueId) {
    return `PLI ${projectDocId || "-"} | Issue ${issueId || "-"}`;
  }

  return "";
};

const getIssueTitleText = (entry = {}) => {
  return String(entry.title || "").trim();
};

const BillableInvoicePreviewPage = () => {
  const { id } = useParams();
  const location = useLocation();
  const pdfContentRef = useRef(null);

  const draftKey = useMemo(() => {
    const params = new URLSearchParams(location.search || "");
    return String(params.get("draft") || "").trim();
  }, [location.search]);

  const draftPayload = useMemo(() => {
    if (!draftKey) return null;

    try {
      const raw = sessionStorage.getItem(draftKey);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (error) {
      console.error("Failed to parse billable invoice preview payload:", error);
      return null;
    }
  }, [draftKey]);

  const handleDownloadXlsx = () => {
    if (!draftPayload) return;

    const users = Array.isArray(draftPayload.users) ? draftPayload.users : [];
      const overtimeThresholdHours = Number(draftPayload.overtimePolicy?.thresholdHours || DEFAULT_OVERTIME_THRESHOLD_HOURS);
      const overtimeMultiplier = Number(draftPayload.overtimePolicy?.overtimeMultiplier || DEFAULT_OVERTIME_MULTIPLIER);
      const overtimePolicyLabel = String(draftPayload.overtimePolicy?.label || `OT after ${overtimeThresholdHours}h/user/week @ ${overtimeMultiplier.toFixed(2)}x rate`);

    const worksheetRows = [
      ["Billable Invoice"],
      ["Project", draftPayload.projectName || "Unknown Project"],
      ["Invoice #", draftPayload.invoiceNumber || "-"],
      ["Week", `Week ${draftPayload.weekNumber || "-"}`],
      ["Start of Week", formatMonthDayYear(draftPayload.mondayDate)],
      ["End of Week", formatMonthDayYear(draftPayload.weekEndDate)],
      ["Due Date", formatMonthDayYear(draftPayload.dueDate)],
      ["Payment Terms", draftPayload.paymentTermsLabel || "-"],
      ["Overtime Policy", overtimePolicyLabel],
      [],
      [
        "Person",
        "Line Item",
        "Hours",
        "Rate",
        "Line Cost",
        "Issues Worked",
        "Notes",
      ],
      ...users.flatMap((userEntry) => {
        const name = userEntry.name || "Unknown User";
        const regularHours = Number(userEntry.regularHours || 0);
        const overtimeHours = Number(userEntry.overtimeHours || 0);
        const regularRate = Number(userEntry.regularRate || 0);
        const overtimeRate = Number(userEntry.overtimeRate || 0);
        const regularCost = regularHours * regularRate;
        const overtimeCost = overtimeHours * overtimeRate;

        return [
          [
            name,
            `Regular (<= ${overtimeThresholdHours}h)`,
            regularHours,
            regularRate,
            regularCost,
            String(userEntry.issueSummary || ""),
            String(userEntry.notesSummary || ""),
          ],
          [
            name,
            `Overtime (> ${overtimeThresholdHours}h)`,
            overtimeHours,
            overtimeRate,
            overtimeCost,
            "",
            "",
          ],
          [
            name,
            "Person Total",
            Number(userEntry.totalHours || 0),
            "",
            Number(userEntry.lineTotal || 0),
            "",
            "",
          ],
        ];
      }),
      [],
      ["Totals", "Regular", Number(draftPayload.totals?.totalRegularHours || 0), "", "", "", ""],
      ["Totals", "Overtime", Number(draftPayload.totals?.totalOvertimeHours || 0), "", "", "", ""],
      ["Totals", "All Hours", Number(draftPayload.totals?.totalHours || 0), "", "", "", ""],
      ["Totals", "Amount", "", "", Number(draftPayload.totals?.totalAmount || 0), "", ""],
    ];

    const worksheet = XLSX.utils.aoa_to_sheet(worksheetRows);
    worksheet["!cols"] = [
      { wch: 28 },
      { wch: 24 },
      { wch: 12 },
      { wch: 12 },
      { wch: 14 },
      { wch: 56 },
      { wch: 56 },
    ];

    const issueAndNoteRows = [
      ["Invoice Issues and Notes"],
      ["Project", draftPayload.projectName || "Unknown Project"],
      ["Invoice #", draftPayload.invoiceNumber || "-"],
      ["Week", `Week ${draftPayload.weekNumber || "-"}`],
      ["Start of Week", formatMonthDayYear(draftPayload.mondayDate)],
      ["End of Week", formatMonthDayYear(draftPayload.weekEndDate)],
      [],
      ["Person", "Issue/Card", "Project", "Issue ID", "Issue Title", "Issue Details", "Note"],
    ];

    users.forEach((userEntry) => {
      const cards = Array.isArray(userEntry.cards) ? userEntry.cards : [];
      const notes = Array.isArray(userEntry.notes) ? userEntry.notes : [];

      if (cards.length === 0 && notes.length === 0) {
        issueAndNoteRows.push([userEntry.name || "Unknown User", "", "", "", "", "", ""]);
        return;
      }

      cards.forEach((card) => {
        issueAndNoteRows.push([
          userEntry.name || "Unknown User",
          String(card.label || "Unspecified Card"),
          String(card.projectName || "Unknown Project"),
          String(card.issueId || ""),
          getIssueTitleText(card),
          getIssueDetailsText(card),
          "",
        ]);
      });

      notes.forEach((note) => {
        issueAndNoteRows.push([
          userEntry.name || "Unknown User",
          String(note.cardLabel || ""),
          String(note.projectName || ""),
          String(note.issueId || ""),
          getIssueTitleText(note),
          getIssueDetailsText(note),
          String(note.text || ""),
        ]);
      });

      issueAndNoteRows.push(["", "", "", "", "", "", ""]);
    });

    const issueAndNotesWorksheet = XLSX.utils.aoa_to_sheet(issueAndNoteRows);
    issueAndNotesWorksheet["!cols"] = [
      { wch: 24 },
      { wch: 34 },
      { wch: 24 },
      { wch: 14 },
      { wch: 30 },
      { wch: 40 },
      { wch: 64 },
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Billable Invoice");
    XLSX.utils.book_append_sheet(workbook, issueAndNotesWorksheet, "Issues & Notes");

    const fileName = String(draftPayload.fileName || "billable-invoice.xlsx").trim() || "billable-invoice.xlsx";
    XLSX.writeFile(workbook, fileName);
  };

  const handleDownloadPdf = async () => {
    if (!draftPayload || !pdfContentRef.current) return;

    const html2pdf = typeof html2pdfLib === "function"
      ? html2pdfLib
      : (typeof html2pdfLib?.default === "function" ? html2pdfLib.default : null);

    if (!html2pdf) {
      console.error("html2pdf export function is unavailable.");
      return;
    }

    const baseName = String(draftPayload.fileName || "billable-invoice")
      .replace(/\.xlsx$/i, "")
      .trim() || "billable-invoice";
    const fileName = `${baseName}.pdf`;

    const options = {
      margin: [10, 10, 10, 10],
      filename: fileName,
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        logging: false,
      },
      jsPDF: {
        unit: "mm",
        format: "a4",
        orientation: "portrait",
      },
      pagebreak: { mode: ["avoid-all", "css", "legacy"] },
    };

    await html2pdf().set(options).from(pdfContentRef.current).save();
  };

  if (!draftPayload) {
    return (
      <div style={commonStyles.fullWidthContainer}>
        <h1 style={commonStyles.title}>Billable Invoice Preview</h1>
        <div style={{ ...cardStyle, marginTop: "12px" }}>
          <div style={{ color: "#B91C1C", fontWeight: 700, marginBottom: "8px" }}>Invoice preview data is missing.</div>
          <p style={{ marginTop: 0, color: "#475569" }}>
            Go back to Invoices and click Billable Invoice again to generate this page.
          </p>
          <Link to={`/organization/${id}/invoices?invoiceTab=table`} style={{ color: "#1D4ED8", fontWeight: 700 }}>Return to Invoices</Link>
        </div>
      </div>
    );
  }

  const users = Array.isArray(draftPayload.users) ? draftPayload.users : [];
  const overtimeThresholdHours = Number(draftPayload.overtimePolicy?.thresholdHours || DEFAULT_OVERTIME_THRESHOLD_HOURS);
  const overtimeMultiplier = Number(draftPayload.overtimePolicy?.overtimeMultiplier || DEFAULT_OVERTIME_MULTIPLIER);
  const overtimePolicyLabel = String(draftPayload.overtimePolicy?.label || `OT after ${overtimeThresholdHours}h/user/week @ ${overtimeMultiplier.toFixed(2)}x rate`);

  const pageContainerStyle = {
    ...commonStyles.fullWidthContainer,
    width: "100%",
    maxWidth: "none",
    boxSizing: "border-box",
    margin: 0,
    paddingLeft: "24px",
    paddingRight: "24px",
    textAlign: "left",
    alignSelf: "stretch",
  };

  return (
    <div style={pageContainerStyle}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
        <div>
          <h1 style={commonStyles.title}>Billable Invoice Preview</h1>
          <div style={{ color: "#64748B", fontSize: "0.9rem" }}>
            Review invoice before sending or exporting.
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={handleDownloadPdf}
            style={{ border: "none", borderRadius: "8px", padding: "10px 14px", background: "#0F766E", color: "#FFFFFF", fontWeight: 700, cursor: "pointer" }}
          >
            Export PDF
          </button>
          <button
            type="button"
            onClick={handleDownloadXlsx}
            style={{ border: "none", borderRadius: "8px", padding: "10px 14px", background: "#1D4ED8", color: "#FFFFFF", fontWeight: 700, cursor: "pointer" }}
          >
            Download XLSX
          </button>
          <Link
            to={`/organization/${id}/invoices?invoiceTab=table`}
            style={{ borderRadius: "8px", padding: "10px 14px", background: "#E2E8F0", color: "#0F172A", fontWeight: 700, textDecoration: "none" }}
          >
            Back to Invoices
          </Link>
        </div>
      </div>

      <div ref={pdfContentRef} style={{ marginTop: "12px" }}>
      <div style={{ ...cardStyle }}>
        <div style={{ display: "grid", gap: "8px", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          <div><strong>Project:</strong> {draftPayload.projectName || "Unknown Project"}</div>
          <div><strong>Invoice #:</strong> {draftPayload.invoiceNumber || "-"}</div>
          <div><strong>Week:</strong> Week {draftPayload.weekNumber || "-"}</div>
          <div><strong>Start of Week:</strong> {formatMonthDayYear(draftPayload.mondayDate)}</div>
          <div><strong>End of Week:</strong> {formatMonthDayYear(draftPayload.weekEndDate)}</div>
          <div><strong>Due Date:</strong> {formatMonthDayYear(draftPayload.dueDate)}</div>
          <div><strong>Terms:</strong> {draftPayload.paymentTermsLabel || "-"}</div>
          <div><strong>Overtime Policy:</strong> {overtimePolicyLabel}</div>
        </div>
      </div>

      <div style={{ ...cardStyle, marginTop: "12px", width: "100%", boxSizing: "border-box" }}>
        <h2 style={{ marginTop: 0 }}>Billable Summary by Person</h2>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", justifyItems: "stretch", alignItems: "stretch", gap: "12px", width: "100%" }}>
          {users.map((userEntry, index) => {
            const personName = userEntry.name || "Unknown User";
            const regularHours = Number(userEntry.regularHours || 0);
            const overtimeHours = Number(userEntry.overtimeHours || 0);
            const regularRate = Number(userEntry.regularRate || 0);
            const overtimeRate = Number(userEntry.overtimeRate || 0);
            const regularCost = regularHours * regularRate;
            const overtimeCost = overtimeHours * overtimeRate;

            return (
              <div
                key={`${personName}-${index}`}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  border: "1px solid #CBD5E1",
                  borderRadius: "10px",
                  overflow: "hidden",
                  background: "#FFFFFF",
                }}
              >
                <div style={{ padding: "10px 12px", background: "#F8FAFC", borderBottom: "1px solid #E2E8F0", fontWeight: 800, color: "#0F172A" }}>
                  {personName}
                </div>
                <div style={{ width: "100%", boxSizing: "border-box" }}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0, 2.4fr) minmax(0, 1fr) minmax(0, 1.2fr) minmax(0, 1.4fr)",
                      width: "100%",
                      background: "#F8FAFC",
                      borderBottom: "1px solid #E5E7EB",
                    }}
                  >
                    <div style={tableHeaderCellStyle}>Line Item</div>
                    <div style={{ ...tableHeaderCellStyle, textAlign: "right" }}>Hours</div>
                    <div style={{ ...tableHeaderCellStyle, textAlign: "right" }}>Rate</div>
                    <div style={{ ...tableHeaderCellStyle, textAlign: "right" }}>Line Cost</div>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0, 2.4fr) minmax(0, 1fr) minmax(0, 1.2fr) minmax(0, 1.4fr)",
                      width: "100%",
                    }}
                  >
                    <div style={tableBodyCellStyle}>Regular (&lt;= {overtimeThresholdHours}h)</div>
                    <div style={numericBodyCellStyle}>{regularHours.toFixed(2)}</div>
                    <div style={numericBodyCellStyle}>{formatCurrency(regularRate)}</div>
                    <div style={{ ...numericBodyCellStyle, fontWeight: 700 }}>{formatCurrency(regularCost)}</div>

                    <div style={tableBodyCellStyle}>Overtime (&gt; {overtimeThresholdHours}h)</div>
                    <div style={numericBodyCellStyle}>{overtimeHours.toFixed(2)}</div>
                    <div style={numericBodyCellStyle}>{formatCurrency(overtimeRate)}</div>
                    <div style={{ ...numericBodyCellStyle, fontWeight: 700 }}>{formatCurrency(overtimeCost)}</div>

                    <div style={{ ...tableBodyCellStyle, fontWeight: 700, background: "#F8FAFC" }}>Person Total</div>
                    <div style={{ ...numericBodyCellStyle, fontWeight: 700, background: "#F8FAFC" }}>{Number(userEntry.totalHours || 0).toFixed(2)}</div>
                    <div style={{ ...numericBodyCellStyle, background: "#F8FAFC" }}></div>
                    <div style={{ ...numericBodyCellStyle, fontWeight: 800, background: "#F8FAFC" }}>{formatCurrency(userEntry.lineTotal || 0)}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: "12px", display: "grid", gap: "8px", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
          <div><strong>Total Regular Hours:</strong> {Number(draftPayload.totals?.totalRegularHours || 0).toFixed(2)}</div>
          <div><strong>Total Overtime Hours:</strong> {Number(draftPayload.totals?.totalOvertimeHours || 0).toFixed(2)}</div>
          <div><strong>Total Hours:</strong> {Number(draftPayload.totals?.totalHours || 0).toFixed(2)}</div>
          <div><strong>Total Amount:</strong> {formatCurrency(draftPayload.totals?.totalAmount || 0)}</div>
        </div>
      </div>

      <div style={{ ...cardStyle, marginTop: "12px", width: "100%", boxSizing: "border-box" }}>
        <h2 style={{ marginTop: 0 }}>Issues and Notes Included in This Invoice</h2>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", justifyItems: "stretch", alignItems: "stretch", gap: "12px", width: "100%" }}>
          {users.length === 0 ? (
            <div style={{ ...cardStyle, borderColor: "#CBD5E1", marginTop: 0 }}>No user rows available.</div>
          ) : users.map((userEntry, userIndex) => {
            const cards = Array.isArray(userEntry.cards) ? userEntry.cards : [];
            const notes = Array.isArray(userEntry.notes) ? userEntry.notes : [];
            const rows = [
              ...cards.map((card) => ({
                issueCard: card.label || "Unspecified Card",
                projectName: card.projectName || "Unknown Project",
                issueId: card.issueId || "",
                issueTitle: getIssueTitleText(card),
                issueDetails: getIssueDetailsText(card),
                noteText: "",
              })),
              ...notes.map((note) => ({
                issueCard: note.cardLabel || "",
                projectName: note.projectName || "",
                issueId: note.issueId || "",
                issueTitle: getIssueTitleText(note),
                issueDetails: getIssueDetailsText(note),
                noteText: note.text || "",
              })),
            ];

            return (
              <div
                key={`issues-notes-${userIndex}-${userEntry.name || "unknown"}`}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  border: "1px solid #CBD5E1",
                  borderRadius: "10px",
                  overflow: "hidden",
                  background: "#FFFFFF",
                }}
              >
                <div style={{ padding: "10px 12px", background: "#F8FAFC", borderBottom: "1px solid #E2E8F0", fontWeight: 800, color: "#0F172A" }}>
                  {userEntry.name || "Unknown User"}
                </div>
                <div style={{ width: "100%", boxSizing: "border-box" }}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 0.7fr) minmax(0, 1fr) minmax(0, 1.4fr) minmax(0, 1.8fr)",
                      width: "100%",
                      background: "#F8FAFC",
                      borderBottom: "1px solid #E5E7EB",
                    }}
                  >
                    <div style={tableHeaderCellStyle}>Issue/Card</div>
                    <div style={tableHeaderCellStyle}>Project</div>
                    <div style={tableHeaderCellStyle}>Issue ID</div>
                    <div style={tableHeaderCellStyle}>Issue Title</div>
                    <div style={tableHeaderCellStyle}>Issue Details</div>
                    <div style={tableHeaderCellStyle}>Note</div>
                  </div>

                  {rows.length === 0 ? (
                    <div style={{ ...tableBodyCellStyle, borderBottom: "none" }}>
                      No issues or notes found for this user in this invoice row.
                    </div>
                  ) : (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 0.7fr) minmax(0, 1fr) minmax(0, 1.4fr) minmax(0, 1.8fr)",
                        width: "100%",
                      }}
                    >
                      {rows.map((row, rowIndex) => (
                        <React.Fragment key={`user-${userIndex}-row-${rowIndex}`}>
                          <div style={tableBodyCellStyle}>{row.issueCard}</div>
                          <div style={tableBodyCellStyle}>{row.projectName}</div>
                          <div style={tableBodyCellStyle}>{row.issueId}</div>
                          <div style={tableBodyCellStyle}>{row.issueTitle}</div>
                          <div style={tableBodyCellStyle}>{row.issueDetails}</div>
                          <div style={tableBodyCellStyle}>{row.noteText}</div>
                        </React.Fragment>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      </div>
    </div>
  );
};

export default BillableInvoicePreviewPage;
