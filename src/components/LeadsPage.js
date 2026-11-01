import React, { useEffect, useMemo, useRef, useState } from "react";
import { addWeeks, format, isValid, parseISO } from "date-fns";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import {
  addDoc,
  arrayUnion,
  arrayRemove,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { toast } from "react-toastify";
import { db, storage } from "../firebase";
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { getChurchData } from "../api/church";
import ChurchHeader from "./ChurchHeader";
import LeadPhoneCheckIn from "./LeadPhoneCheckIn";
import commonStyles from "../pages/commonStyles";
import { EMPTY_LEAD_FORM, findDuplicateLead, formatLeadDisplayValue, getClassInstanceLabel, getDefaultLeadOptions, getLeadLocation, getUpcomingLeadCalls, LEAD_DETAIL_LISTS, LEAD_MODULE_TABS } from "../utils/leadOptions";
import { FaCheck, FaFilePdf, FaPhoneAlt, FaTrash } from "react-icons/fa";
import "./LeadsPage.css";
import LeadDetailFields from "./LeadDetailFields";

const formatPhoneNumber = (value) => {
  if (!value) return value;
  const phoneNumber = String(value).replace(/[^\d]/g, "");
  if (phoneNumber.length < 4) return phoneNumber;
  if (phoneNumber.length < 7) {
    return `(${phoneNumber.slice(0, 3)})${phoneNumber.slice(3)}`;
  }
  return `(${phoneNumber.slice(0, 3)})${phoneNumber.slice(3, 6)}-${phoneNumber.slice(6, 10)}`;
};

const normalizeLeadPhone = (value) => String(value || "").replace(/\D/g, "");

const LEAD_AUDIT_FIELDS = new Set(["id", "createdAt", "createdBy", "createdByName", "updatedAt", "updatedBy", "updatedByName"]);

const hasLeadData = (value) => {
  if (typeof value === "string") return Boolean(value.trim());
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.some(hasLeadData);
  if (value && typeof value === "object") return Object.values(value).some(hasLeadData);
  return false;
};

const getLeadDataCount = (lead) => Object.entries(lead)
  .filter(([field, value]) => !LEAD_AUDIT_FIELDS.has(field) && hasLeadData(value)).length;

const formatLeadSearchPhone = (value) => {
  const phone = normalizeLeadPhone(value);
  if (phone.length < 4) return phone;
  if (phone.length < 7) return `(${phone.slice(0, 3)})${phone.slice(3)}`;
  if (phone.length <= 10) return `(${phone.slice(0, 3)})${phone.slice(3, 6)}-${phone.slice(6)}`;
  return `+${phone}`;
};

const STATUS_COLORS = [
  "#0d6efd",
  "#6f42c1",
  "#fd7e14",
  "#20c997",
  "#198754",
  "#dc3545",
  "#0dcaf0",
  "#6c757d",
];
const LEADS_PER_PAGE = 10;
const MAX_LEAD_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const MAX_LEAD_PROFILE_IMAGE_SIZE = 5 * 1024 * 1024;
const ACCOUNTS_RECEIVABLE_PIN = "2197";

const getStatusColor = (status, statuses) => {
  const index = Math.max(0, statuses.indexOf(status));
  return STATUS_COLORS[index % STATUS_COLORS.length];
};

const getLeadStatusOptions = (statuses = []) => statuses.includes("New") ? statuses : ["New", ...statuses];
const getLeadInitials = (name) => String(name || "?").trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() || "").join("");

const FIREBASE_FUNCTIONS_BASE_URL = typeof window !== "undefined" && window.location.hostname === "localhost"
  ? "/firebase-api"
  : "https://us-central1-igletechv1.cloudfunctions.net";

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onloadend = () => resolve(reader.result);
  reader.onerror = reject;
  reader.readAsDataURL(blob);
});

const getAcademyLogoDataUrl = async (logoUrl) => {
  if (!logoUrl) return "";
  try {
    const response = await fetch(logoUrl, { mode: "cors" });
    if (!response.ok) throw new Error(`Logo fetch failed with status ${response.status}`);
    return await blobToDataUrl(await response.blob());
  } catch (directFetchError) {
    const proxyUrl = `${FIREBASE_FUNCTIONS_BASE_URL}/fetchRemoteImageAsDataUrl?url=${encodeURIComponent(logoUrl)}`;
    const proxyResponse = await fetch(proxyUrl);
    if (!proxyResponse.ok) throw directFetchError;
    const proxyPayload = await proxyResponse.json();
    return String(proxyPayload?.dataUrl || "");
  }
};

const formatPdfDate = (value) => {
  if (!value) return "Not set";
  const date = typeof value?.toDate === "function" ? value.toDate() : value instanceof Date ? value : new Date(value);
  return isValid(date) ? format(date, "MMM d, yyyy h:mm a") : String(value);
};

const formatFileSize = (size) => {
  if (!Number.isFinite(Number(size))) return "";
  if (Number(size) < 1024 * 1024) return `${Math.max(1, Math.round(Number(size) / 1024))} KB`;
  return `${(Number(size) / (1024 * 1024)).toFixed(1)} MB`;
};

const exportLeadProfilePdf = async ({ organizationId, lead, details, classes }) => {
  const [jspdfModule, autoTableModule, churchData] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
    getChurchData(organizationId),
  ]);
  const JsPdfConstructor = jspdfModule.jsPDF || jspdfModule.default?.jsPDF || jspdfModule.default;
  const autoTable = autoTableModule.default || autoTableModule;
  if (typeof JsPdfConstructor !== "function" || typeof autoTable !== "function") {
    throw new Error("PDF generation libraries did not load correctly.");
  }

  let logoDataUrl = "";
  try {
    logoDataUrl = await getAcademyLogoDataUrl(String(churchData?.logo || "").trim());
  } catch (logoError) {
    console.warn("Unable to load academy logo for lead profile PDF:", logoError);
  }
  let profileImageDataUrl = "";
  try {
    profileImageDataUrl = await getAcademyLogoDataUrl(String(lead.profileImage?.url || "").trim());
  } catch (profileImageError) {
    console.warn("Unable to load lead profile image for PDF:", profileImageError);
  }

  const pdf = new JsPdfConstructor({ orientation: "portrait", unit: "pt", format: "letter" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 42;
  const academyName = churchData?.churchName || churchData?.name || "Academy";
  let headerTextX = margin;

  pdf.setFillColor(23, 74, 54);
  pdf.rect(0, 0, pageWidth, 94, "F");
  if (logoDataUrl) {
    try {
      const logoImage = new Image();
      const logoDimensions = await new Promise((resolve, reject) => {
        logoImage.onload = () => resolve({ width: logoImage.naturalWidth, height: logoImage.naturalHeight });
        logoImage.onerror = reject;
        logoImage.src = logoDataUrl;
      });
      const scale = Math.min(58 / logoDimensions.width, 58 / logoDimensions.height);
      const logoWidth = logoDimensions.width * scale;
      const logoHeight = logoDimensions.height * scale;
      pdf.addImage(logoDataUrl, margin, 18 + (58 - logoHeight) / 2, logoWidth, logoHeight);
      headerTextX = margin + 72;
    } catch (logoError) {
      console.warn("Unable to draw academy logo in lead profile PDF:", logoError);
    }
  }
  if (profileImageDataUrl) {
    try {
      const profileImage = new Image();
      const profileDimensions = await new Promise((resolve, reject) => {
        profileImage.onload = () => resolve({ width: profileImage.naturalWidth, height: profileImage.naturalHeight });
        profileImage.onerror = reject;
        profileImage.src = profileImageDataUrl;
      });
      const scale = Math.min(48 / profileDimensions.width, 48 / profileDimensions.height);
      const imageWidth = profileDimensions.width * scale;
      const imageHeight = profileDimensions.height * scale;
      pdf.addImage(profileImageDataUrl, pageWidth - margin - imageWidth, 22 + (48 - imageHeight) / 2, imageWidth, imageHeight);
    } catch (profileImageError) {
      console.warn("Unable to draw lead profile image in PDF:", profileImageError);
    }
  }
  pdf.setTextColor(255, 255, 255);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(16);
  pdf.text(academyName, headerTextX, 36, { maxWidth: pageWidth - headerTextX - margin - (profileImageDataUrl ? 64 : 0) });
  pdf.setFontSize(10);
  pdf.text("LEAD PROFILE", headerTextX, 56);
  pdf.setFont("helvetica", "normal");
  pdf.text(`Generated ${formatPdfDate(new Date())}`, headerTextX, 74);
  pdf.setTextColor(31, 41, 55);

  const leadRows = [
    ["Profile ID", lead.id || "-"],
    ["Name", lead.name || "Unnamed lead"],
    ["Status", lead.status || "New"],
    ...details
      .filter(([label]) => !["class type", "program type"].includes(String(label).toLowerCase()))
      .map(([label, value]) => [label, formatLeadDisplayValue(value) || "Not provided"]),
    ["Class type", lead.classType || "-"],
    ["Program", lead.programType || "-"],
    ["Follow-up", lead.followUp ? "Yes" : "No"],
    ["Callback", lead.callbackTime || "-"],
    ["Callback completed", lead.callbackCompleted ? "Yes" : "No"],
    ["Created", formatPdfDate(lead.createdAt)],
    ["Created by", lead.createdByName || lead.createdBy || "-"],
  ];
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10);
  pdf.setTextColor(23, 74, 54);
  pdf.text("Lead information", margin, 112);
  autoTable(pdf, {
    startY: 120,
    head: [["Field", "Details"]],
    body: leadRows,
    theme: "grid",
    margin: { left: margin, right: margin, bottom: 34 },
    columnStyles: { 0: { cellWidth: 132 } },
    styles: { font: "helvetica", fontSize: 8, cellPadding: 3, overflow: "linebreak", minCellHeight: 14 },
    headStyles: { fillColor: [23, 74, 54], textColor: [255, 255, 255], fontStyle: "bold" },
    alternateRowStyles: { fillColor: [245, 248, 246] },
  });

  const classRows = classes.map((instance) => {
    const assignedProgram = (instance.programAssignments || []).find((assignment) => assignment.programType === lead.programType);
    const requiresCoupon = String(lead.programType || "").toLowerCase().includes("coupon");
    const configuredWeeks = Number(instance.totalWeeks);
    const weekNumbers = Number.isInteger(configuredWeeks) && configuredWeeks > 0
      ? Array.from({ length: configuredWeeks }, (_unused, index) => index + 1)
      : [...new Set(instance.attendance.map((entry) => entry.week).filter((week) => week > 0))].sort((first, second) => first - second);
    const attendanceByWeek = new Map(instance.attendance.map((entry) => [entry.week, entry]));
    const totalPaid = requiresCoupon
      ? weekNumbers.reduce((total, week) => {
        const record = attendanceByWeek.get(week) || {};
        return total + (record.couponReceived ? 35 : Math.min(35, Number(record.amountPaid || 0)));
      }, 0)
      : instance.payments.reduce((total, payment) => total + Number(payment.amount || 0), 0);
    const programPrice = requiresCoupon ? weekNumbers.length * 35 : Number(assignedProgram?.price || 0);
    const balanceDue = requiresCoupon
      ? weekNumbers.reduce((total, week) => {
        const record = attendanceByWeek.get(week) || {};
        return total + (record.couponReceived ? 0 : Math.max(0, 35 - Number(record.amountPaid || 0)));
      }, 0)
      : Math.max(0, programPrice - totalPaid);
    const startDate = parseISO(instance.startDate || "");
    const presentCount = weekNumbers.filter((week) => attendanceByWeek.get(week)?.present).length;
    const schedule = [
      instance.classType,
      isValid(startDate) ? format(startDate, "MMM d, yyyy") : "",
      instance.totalWeeks ? `${instance.totalWeeks} weeks` : "",
      instance.isCurrent ? "Current" : "Previous",
    ].filter(Boolean).join(" · ") || "-";
    const financialSummary = programPrice
      ? `Paid $${totalPaid.toFixed(2)} · Due $${balanceDue.toFixed(2)}`
      : `Paid $${totalPaid.toFixed(2)} · Price not set`;
    return [
      instance.name || "Class instance",
      schedule,
      `${presentCount}/${weekNumbers.length} present · ${financialSummary}`,
    ];
  });
  if (!classes.length) classRows.push(["No class enrollments", "-", "-"]);

  const classHeadingY = (pdf.lastAutoTable?.finalY || 120) + 14;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10);
  pdf.setTextColor(23, 74, 54);
  pdf.text("Class, attendance & payment summary", margin, classHeadingY);
  autoTable(pdf, {
    startY: classHeadingY + 8,
    head: [["Class", "Schedule", "Attendance / payment"]],
    body: classRows,
    theme: "grid",
    margin: { left: margin, right: margin, bottom: 34 },
    columnStyles: { 0: { cellWidth: 142 }, 1: { cellWidth: 170 }, 2: { cellWidth: pageWidth - (margin * 2) - 312 } },
    styles: { font: "helvetica", fontSize: 7, cellPadding: 3, overflow: "linebreak", minCellHeight: 14 },
    headStyles: { fillColor: [23, 74, 54], textColor: [255, 255, 255], fontStyle: "bold" },
    alternateRowStyles: { fillColor: [245, 248, 246] },
  });

  let cursorY = (pdf.lastAutoTable?.finalY || classHeadingY + 30) + 14;
  const addSection = (title, columns, rows) => {
    if (cursorY > pageHeight - 90) {
      pdf.addPage();
      cursorY = margin;
    }
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10);
    pdf.setTextColor(23, 74, 54);
    pdf.text(title, margin, cursorY, { maxWidth: pageWidth - margin * 2 });
    autoTable(pdf, {
      startY: cursorY + 8,
      head: [columns],
      body: rows.length ? rows : [columns.map((_column, index) => index === 0 ? "No records" : "-")],
      theme: "grid",
      margin: { left: margin, right: margin, bottom: 34 },
      styles: { font: "helvetica", fontSize: 8, cellPadding: 4, overflow: "linebreak" },
      headStyles: { fillColor: [23, 74, 54], textColor: [255, 255, 255], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [245, 248, 246] },
    });
    cursorY = (pdf.lastAutoTable?.finalY || cursorY + 40) + 14;
  };

  const profileFiles = [
    ...(lead.profileImage?.url ? [{ ...lead.profileImage, name: lead.profileImage.name || "Profile photo", type: lead.profileImage.type || "image" }] : []),
    ...(Array.isArray(lead.attachments) ? lead.attachments : []),
  ];
  addSection("Documents & images", ["File", "Type", "Size", "Uploaded", "Uploaded by", "URL"], profileFiles.map((file) => [
    file.name || "Attachment",
    file.type || "-",
    formatFileSize(file.size) || "-",
    formatPdfDate(file.uploadedAt),
    file.uploadedBy || "-",
    file.url || file.path || "-",
  ]));

  classes.forEach((instance) => {
    const assignedProgram = (instance.programAssignments || []).find((assignment) => assignment.programType === lead.programType);
    const requiresCoupon = String(lead.programType || "").toLowerCase().includes("coupon");
    const configuredWeeks = Number(instance.totalWeeks);
    const weekNumbers = Number.isInteger(configuredWeeks) && configuredWeeks > 0
      ? Array.from({ length: configuredWeeks }, (_unused, index) => index + 1)
      : [...new Set(instance.attendance.map((entry) => entry.week).filter((week) => week > 0))].sort((first, second) => first - second);
    const attendanceByWeek = new Map(instance.attendance.map((entry) => [entry.week, entry]));
    const totalPaid = requiresCoupon
      ? weekNumbers.reduce((total, week) => {
        const record = attendanceByWeek.get(week) || {};
        return total + (record.couponReceived ? 35 : Math.min(35, Number(record.amountPaid || 0)));
      }, 0)
      : instance.payments.reduce((total, payment) => total + Number(payment.amount || 0), 0);
    const programPrice = requiresCoupon ? weekNumbers.length * 35 : Number(assignedProgram?.price || 0);
    const balanceDue = requiresCoupon
      ? weekNumbers.reduce((total, week) => {
        const record = attendanceByWeek.get(week) || {};
        return total + (record.couponReceived ? 0 : Math.max(0, 35 - Number(record.amountPaid || 0)));
      }, 0)
      : Math.max(0, programPrice - totalPaid);
    addSection(`Payments · ${instance.name || "Class instance"}`, ["Program", "Price", "Paid", "Balance due"], [[
      lead.programType || "Program",
      programPrice ? `$${programPrice.toFixed(2)}` : "Not configured",
      `$${totalPaid.toFixed(2)}`,
      `$${balanceDue.toFixed(2)}`,
    ]]);
    addSection(`Payment history · ${instance.name || "Class instance"}`, ["Date", "Method", "Amount"], instance.payments.map((payment) => [
      payment.date || "-", payment.method || "-", `$${Number(payment.amount || 0).toFixed(2)}`,
    ]));

    const startDate = parseISO(instance.startDate || "");
    addSection(`Attendance · ${instance.name || "Class instance"}`, ["Week", "Date", "Status", "Coupon", "Paid / due"], weekNumbers.map((week) => {
      const record = attendanceByWeek.get(week) || {};
      const weekDate = isValid(startDate) ? format(addWeeks(startDate, week - 1), "MMM d, yyyy") : "Date not set";
      const paid = Number(record.amountPaid || 0);
      return [
        `Week ${week}`,
        weekDate,
        record.present ? "Present" : "Absent",
        record.couponReceived ? "Received" : requiresCoupon ? "Not received" : "-",
        requiresCoupon ? `$${paid.toFixed(2)} paid · $${Math.max(0, 35 - paid).toFixed(2)} due` : "-",
      ];
    }));
  });

  const pageCount = pdf.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    pdf.setPage(page);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(100, 116, 139);
    pdf.text(`${lead.name || "Lead profile"} · ${page} / ${pageCount}`, pageWidth - margin, pageHeight - 20, { align: "right" });
  }

  const safeName = String(lead.name || "lead").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "lead";
  pdf.save(`${safeName}-profile.pdf`);
};

const formatCallCountdown = (callAt, now) => {
  const totalMinutes = Math.max(0, Math.ceil((callAt.getTime() - now.getTime()) / 60000));
  if (totalMinutes === 0) return "Due now";
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const units = days > 0
    ? [[days, "day"], [hours, "hour"]]
    : hours > 0 ? [[hours, "hour"], [minutes, "minute"]] : [[minutes, "minute"]];
  return `In ${units.filter(([value]) => value > 0).map(([value, unit]) => `${value} ${unit}${value === 1 ? "" : "s"}`).join(" ")}`;
};

const CALL_ATTEMPT_COUNT = 3;
const isSamePayment = (candidate, payment) => payment.id
  ? candidate.id === payment.id
  : candidate.amount === payment.amount && candidate.date === payment.date && candidate.method === payment.method && candidate.classInstanceId === payment.classInstanceId;

const getLeadAssignedInstances = (lead, availableInstances = []) => {
  const savedInstances = Array.isArray(lead.classInstances) ? lead.classInstances : [];
  const savedById = new Map(savedInstances.filter((instance) => instance?.id).map((instance) => [instance.id, instance]));
  const hasInstanceIdList = Array.isArray(lead.classInstanceIds);
  const assignedIds = [...new Set([
    ...(hasInstanceIdList ? lead.classInstanceIds : []),
    ...savedInstances.map((instance) => instance.id),
    ...(!hasInstanceIdList ? [lead.classInstanceId] : []),
  ].filter(Boolean))];

  return assignedIds.map((instanceId) => availableInstances.find((instance) => instance.id === instanceId)
    || savedById.get(instanceId)
    || (lead.classInstance?.id === instanceId ? lead.classInstance : null)
    || { id: instanceId, name: `Archived class instance (${instanceId})` });
};

const getLeadClassAssignmentFields = (values, availableInstances) => {
  const assignedInstances = getLeadAssignedInstances({
    ...values,
    classInstanceIds: Array.isArray(values.classInstanceIds)
      ? values.classInstanceIds
      : values.classInstanceId ? [values.classInstanceId] : [],
  }, availableInstances);
  const snapshots = assignedInstances.map((instance) => ({
    id: instance.id,
    name: instance.name,
    classType: instance.classType || "",
    startDate: instance.startDate || "",
    totalWeeks: Number(instance.totalWeeks || 0),
  }));
  const primaryInstance = snapshots[0] || null;
  return {
    classInstanceIds: snapshots.map((instance) => instance.id),
    classInstances: snapshots,
    classInstanceId: primaryInstance?.id || "",
    classInstance: primaryInstance,
    classType: primaryInstance?.classType || values.classType || "",
  };
};

const getLeadClassHistory = (lead, classInstances, attendanceRecords, paymentRecords) => {
  const classes = new Map();
  getLeadAssignedInstances(lead, classInstances).forEach((assignedInstance) => {
    classes.set(assignedInstance.id, { ...assignedInstance, isCurrent: true, attendance: [], payments: [] });
  });

  attendanceRecords.forEach((record) => {
    const presence = record.attendance?.[lead.id];
    if (!presence) return;
    const parsedId = record.id?.match(/^classAttendance_(.*)_(\d+)$/);
    const instanceId = record.classInstanceId || parsedId?.[1];
    if (!instanceId) return;
    const instance = classInstances.find((entry) => entry.id === instanceId)
      || classes.get(instanceId)
      || (lead.classInstance?.id === instanceId ? lead.classInstance : null)
      || record.classInstance
      || (record.className ? { id: instanceId, name: record.className, classType: record.classType, startDate: record.startDate, totalWeeks: record.totalWeeks } : null)
      || { id: instanceId, name: `Archived class instance (${instanceId})` };
    const profileClass = classes.get(instanceId) || { ...instance, isCurrent: false, attendance: [], payments: [] };
    profileClass.attendance.push({
      week: Number(record.week || parsedId?.[2] || 0),
      present: Boolean(presence.present),
      couponReceived: Boolean(presence.couponReceived),
      amountPaid: Number(presence.amountPaid || 0),
    });
    classes.set(instanceId, profileClass);
  });

  paymentRecords.forEach((record) => {
    const payments = record.payments?.[lead.id];
    if (!Array.isArray(payments) || payments.length === 0) return;
    const parsedId = record.id?.replace(/^classPayments_/, '');
    const instanceId = record.classInstanceId || parsedId;
    if (!instanceId) return;
    const instance = classInstances.find((entry) => entry.id === instanceId)
      || classes.get(instanceId)
      || (lead.classInstance?.id === instanceId ? lead.classInstance : null)
      || record.classInstance
      || (record.className ? { id: instanceId, name: record.className, classType: record.classType } : null)
      || { id: instanceId, name: `Archived class instance (${instanceId})` };
    const profileClass = classes.get(instanceId) || { ...instance, isCurrent: false, attendance: [], payments: [] };
    profileClass.payments = [...profileClass.payments, ...payments];
    classes.set(instanceId, profileClass);
  });

  (lead.classPaymentHistory || []).forEach((payment) => {
    const instanceId = payment.classInstanceId;
    if (!instanceId) return;
    const instance = classInstances.find((entry) => entry.id === instanceId)
      || classes.get(instanceId)
      || (lead.classInstance?.id === instanceId ? lead.classInstance : null)
      || payment.classInstance
      || (payment.className ? { id: instanceId, name: payment.className, classType: payment.classType } : null)
      || { id: instanceId, name: `Archived class instance (${instanceId})` };
    const profileClass = classes.get(instanceId) || { ...instance, isCurrent: false, attendance: [], payments: [] };
    const existing = new Set(profileClass.payments.map((entry) => entry.id));
    if (!payment.id || !existing.has(payment.id)) profileClass.payments.push(payment);
    classes.set(instanceId, profileClass);
  });

  return [...classes.values()]
    .map((instance) => ({
      ...instance,
      attendance: instance.attendance.sort((first, second) => first.week - second.week),
      payments: [...instance.payments].sort((first, second) => String(second.date || '').localeCompare(String(first.date || ''))),
    }))
    .sort((first, second) => String(first.startDate || '').localeCompare(String(second.startDate || '')));
};

const ProgramPaymentSection = ({ lead, instance, program, canRecord, saving, onRecordPayment, onUpdatePayment, onDeletePayment }) => {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState("Cash");
  const [receiptNumber, setReceiptNumber] = useState("");
  const [paymentMethodFilter, setPaymentMethodFilter] = useState("all");
  const [editingPaymentKey, setEditingPaymentKey] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const fixedAmountByMethod = { "Lighthouse Church Coupon": 35, "Affiliate Church": 210 };
  const fixedAmount = fixedAmountByMethod[method];
  const totalPaid = instance.payments.reduce((total, payment) => total + Number(payment.amount || 0), 0);
  const programPrice = Number(program?.price || 0);
  const balanceDue = Math.max(0, programPrice - totalPaid);
  const currency = (value) => `$${Number(value).toFixed(2)}`;
  const paymentMethods = [...new Set(instance.payments.map((payment) => String(payment.method || "Other").trim() || "Other"))]
    .sort((first, second) => first.localeCompare(second));
  const visiblePayments = paymentMethodFilter === "all"
    ? instance.payments
    : instance.payments.filter((payment) => (String(payment.method || "Other").trim() || "Other") === paymentMethodFilter);
  const paymentMethodOptions = ["Cash", "Zelle", "Check", "Card", "Bank transfer", "Other", "Lighthouse Church Coupon", "Affiliate Church"];
  const maxAmountForEdit = (payment) => {
    const otherPaymentsTotal = instance.payments.reduce((total, entry) => {
      const isCurrentPayment = payment.id ? entry.id === payment.id : entry === payment;
      return isCurrentPayment ? total : total + Number(entry.amount || 0);
    }, 0);
    return Math.max(0, programPrice - otherPaymentsTotal);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0 || numericAmount > balanceDue || !date || !method) return;
    if (await onRecordPayment(lead, instance, { amount: numericAmount, date, method, receiptNumber })) {
      setAmount("");
      setMethod("Cash");
      setReceiptNumber("");
    }
  };

  const handleEditSubmit = async (event, payment) => {
    event.preventDefault();
    const numericAmount = Number(editForm?.amount);
    const maxAmount = maxAmountForEdit(payment);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0 || numericAmount > maxAmount || !editForm?.date || !editForm?.method) return;
    if (await onUpdatePayment(lead, instance, payment, { amount: numericAmount, date: editForm.date, method: editForm.method, receiptNumber: editForm.receiptNumber })) {
      setEditingPaymentKey(null);
      setEditForm(null);
    }
  };

  return (
    <div className="lead-profile-full-payment">
      <p className="small mb-2">Paid {currency(totalPaid)} of {currency(programPrice)}</p>
      <p className="lead-profile-balance">Balance due: {currency(balanceDue)}</p>
      {instance.payments.length > 0 ? (
        <>
        <div className="lead-profile-payment-filter">
          <label htmlFor={`payment-method-filter-${lead.id}-${instance.id}`}>Filter by method</label>
          <select id={`payment-method-filter-${lead.id}-${instance.id}`} aria-label={`Filter payments by method for ${instance.name || "class"}`} value={paymentMethodFilter} onChange={(event) => setPaymentMethodFilter(event.target.value)}>
            <option value="all">All methods</option>
            {paymentMethods.map((paymentMethod) => <option key={paymentMethod} value={paymentMethod}>{paymentMethod}</option>)}
          </select>
        </div>
        <ul className="lead-profile-payment-history" aria-label="Payment history">
          {visiblePayments.map((payment, index) => {
            const paymentKey = payment.id ? `id:${payment.id}` : `index:${index}`;
            const isEditing = editingPaymentKey === paymentKey;
            const editFixedAmount = fixedAmountByMethod[editForm?.method];
            return <li key={paymentKey}>
              {isEditing ? (
                <form className="lead-profile-payment-edit-form" onSubmit={(event) => handleEditSubmit(event, payment)}>
                  <label>
                    Amount
                    <input type="number" min="0.01" max={maxAmountForEdit(payment).toFixed(2)} step="0.01" value={editForm.amount} onChange={(event) => setEditForm((previous) => ({ ...previous, amount: event.target.value }))} required readOnly={editFixedAmount !== undefined} disabled={!canRecord || saving} />
                  </label>
                  <label>
                    Date
                    <input type="date" value={editForm.date} onChange={(event) => setEditForm((previous) => ({ ...previous, date: event.target.value }))} required disabled={!canRecord || saving} />
                  </label>
                  <label>
                    Receipt number
                    <input type="text" value={editForm.receiptNumber || ""} onChange={(event) => setEditForm((previous) => ({ ...previous, receiptNumber: event.target.value }))} maxLength={80} disabled={!canRecord || saving} />
                  </label>
                  <label>
                    Method
                    <select value={editForm.method} onChange={(event) => {
                      const nextMethod = event.target.value;
                      const nextFixedAmount = fixedAmountByMethod[nextMethod];
                      setEditForm((previous) => ({
                        ...previous,
                        method: nextMethod,
                        ...(nextFixedAmount !== undefined ? { amount: String(nextFixedAmount) } : fixedAmountByMethod[previous.method] !== undefined ? { amount: "" } : {}),
                      }));
                    }} disabled={!canRecord || saving}>
                      {!paymentMethodOptions.includes(editForm.method) && <option>{editForm.method}</option>}
                      {paymentMethodOptions.map((paymentMethod) => <option key={paymentMethod}>{paymentMethod}</option>)}
                    </select>
                  </label>
                  <div className="lead-profile-payment-edit-actions">
                    <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => { setEditingPaymentKey(null); setEditForm(null); }}>Cancel</button>
                    <button type="submit" className="btn btn-sm btn-primary" disabled={!canRecord || saving || !editForm.amount || Number(editForm.amount) > maxAmountForEdit(payment)}>{saving ? "Saving..." : "Save"}</button>
                  </div>
                </form>
              ) : (
                <div className="lead-profile-payment-row">
                  <span>{currency(payment.amount)} · {payment.date} · {payment.method}{payment.receiptNumber ? ` · Receipt #${payment.receiptNumber}` : ""}</span>
                  <div className="lead-profile-payment-actions">
                    <button type="button" className="btn btn-sm btn-outline-primary" aria-label={`Edit payment ${currency(payment.amount)} ${payment.date}`} disabled={!canRecord || saving} onClick={() => {
                      setEditingPaymentKey(paymentKey);
                      setEditForm({ amount: String(payment.amount || ""), date: payment.date || "", method: payment.method || "Cash", receiptNumber: payment.receiptNumber || "" });
                    }}>Edit payment</button>
                    <button type="button" className="btn btn-sm btn-outline-danger" aria-label={`Delete payment ${currency(payment.amount)} ${payment.date}`} disabled={!canRecord || saving} onClick={() => onDeletePayment(lead, instance, payment)}>Delete</button>
                  </div>
                </div>
              )}
            </li>;
          })}
        </ul>
        </>
      ) : <p className="small text-muted mb-2">No payments recorded.</p>}
      {balanceDue > 0 && (
        <form className="lead-profile-payment-form" onSubmit={handleSubmit}>
          <div>
            <label htmlFor={`payment-amount-${lead.id}-${instance.id}`}>Amount</label>
            <input id={`payment-amount-${lead.id}-${instance.id}`} type="number" min="0.01" max={balanceDue.toFixed(2)} step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} required readOnly={fixedAmount !== undefined} disabled={!canRecord || saving || (fixedAmount !== undefined && fixedAmount > balanceDue)} />
          </div>
          <div>
            <label htmlFor={`payment-date-${lead.id}-${instance.id}`}>Date</label>
            <input id={`payment-date-${lead.id}-${instance.id}`} type="date" value={date} onChange={(event) => setDate(event.target.value)} required disabled={!canRecord || saving} />
          </div>
          <div>
            <label htmlFor={`payment-receipt-${lead.id}-${instance.id}`}>Receipt number</label>
            <input id={`payment-receipt-${lead.id}-${instance.id}`} type="text" value={receiptNumber} onChange={(event) => setReceiptNumber(event.target.value)} maxLength={80} disabled={!canRecord || saving} />
          </div>
          <div>
            <label htmlFor={`payment-method-${lead.id}-${instance.id}`}>Method</label>
            <select id={`payment-method-${lead.id}-${instance.id}`} value={method} onChange={(event) => {
              const nextMethod = event.target.value;
              const nextFixedAmount = fixedAmountByMethod[nextMethod];
              setMethod(nextMethod);
              if (nextFixedAmount !== undefined) setAmount(String(nextFixedAmount));
              else if (fixedAmount !== undefined) setAmount("");
            }} disabled={!canRecord || saving}>
              <option>Cash</option><option>Zelle</option><option>Check</option><option>Card</option><option>Bank transfer</option><option>Other</option><option>Lighthouse Church Coupon</option><option>Affiliate Church</option>
            </select>
          </div>
          <button type="submit" className="btn btn-sm btn-success" disabled={!canRecord || saving || !amount || Number(amount) > balanceDue}>{saving ? "Saving..." : "Record Payment"}</button>
        </form>
      )}
    </div>
  );
};

const LeadProfile = ({ organizationId, lead, classInstances, attendanceRecords, paymentRecords, comments, commentDraft, formatTimestamp, onCommentDraftChange, onAddComment, onDeleteComment, onDeleteLead, onUploadAttachments, onDeleteAttachment, onUploadProfileImage, isEditing, editForm, options, saving, savingAttendanceKey, canEditAttendance, savingAttemptKey, savingFollowUp, onCallAttemptChange, onStatusChange, onSaveFollowUp, onEdit, onEditFormChange, onCreateOption, onSave, onCancelEdit, onPaymentChoice, onAttendanceChange, onRecordPayment, onUpdatePayment, onDeletePayment, onClose }) => {
  const profileRef = useRef(null);
  const [followUpEnabled, setFollowUpEnabled] = useState(Boolean(lead.followUp));
  const [callTime, setCallTime] = useState(lead.callbackTime || "");
  const [exportingPdf, setExportingPdf] = useState(false);
  const [uploadingAttachments, setUploadingAttachments] = useState(false);
  const [uploadingProfileImage, setUploadingProfileImage] = useState(false);
  const attachments = Array.isArray(lead.attachments) ? lead.attachments : [];
  const classes = getLeadClassHistory(lead, classInstances, attendanceRecords, paymentRecords);
  const selectedClassInstanceIds = editForm.classInstanceIds || (editForm.classInstanceId ? [editForm.classInstanceId] : []);
  const availableEditInstances = options.classInstances.filter((instance) => !editForm.classType || instance.classType === editForm.classType);
  const availableEditInstanceIds = new Set(availableEditInstances.map((instance) => instance.id));
  const editClassInstances = [
    ...availableEditInstances,
    ...(editForm.classInstances || []).filter((instance) => !availableEditInstanceIds.has(instance.id)),
  ];
  const details = [
    ['Phone', lead.phone], ['Email', lead.email],
    ...LEAD_DETAIL_LISTS.map((list) => [list.singular.replace(/\b[a-z]/g, (letter) => letter.toUpperCase()), lead[list.field]]),
  ];

  useEffect(() => {
    setFollowUpEnabled(Boolean(lead.followUp));
    setCallTime(lead.callbackTime || "");
  }, [lead.id, lead.followUp, lead.callbackTime]);

  useEffect(() => {
    profileRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, [lead.id]);

  const handleExportProfilePdf = async () => {
    setExportingPdf(true);
    try {
      await exportLeadProfilePdf({ organizationId, lead, details, classes });
    } catch (error) {
      console.error("Failed to export lead profile PDF:", error);
      toast.error("Failed to export lead profile PDF");
    } finally {
      setExportingPdf(false);
    }
  };

  const handleAttachmentSelection = async (event) => {
    const files = Array.from(event.currentTarget.files || []);
    event.currentTarget.value = "";
    if (!files.length) return;
    setUploadingAttachments(true);
    try {
      await onUploadAttachments(lead, files);
    } finally {
      setUploadingAttachments(false);
    }
  };

  const handleProfileImageSelection = async (event) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setUploadingProfileImage(true);
    try {
      await onUploadProfileImage(lead, file);
    } finally {
      setUploadingProfileImage(false);
    }
  };

  return (
    <section ref={profileRef} className="lead-profile-panel" aria-labelledby={`lead-profile-heading-${lead.id}`}>
      <header className="lead-profile-header">
        <div className="lead-profile-person-heading">
          <label className="lead-profile-photo-picker" htmlFor={`lead-profile-photo-${lead.id}`} aria-label={`Change profile photo for ${lead.name || "lead"}`}>
            {lead.profileImage?.url ? <img src={lead.profileImage.url} alt={`${lead.name || "Lead"} profile`} /> : <span aria-hidden="true">{getLeadInitials(lead.name)}</span>}
            <input id={`lead-profile-photo-${lead.id}`} type="file" accept="image/*" aria-label="Upload profile photo" onChange={handleProfileImageSelection} disabled={!canEditAttendance || uploadingProfileImage} />
          </label>
          <div>
            <span className="text-muted small">Lead profile</span>
            <h4 id={`lead-profile-heading-${lead.id}`}>{lead.name || 'Unnamed lead'}</h4>
            <label className="lead-profile-photo-action" htmlFor={`lead-profile-photo-${lead.id}`}>{uploadingProfileImage ? "Uploading photo..." : lead.profileImage?.url ? "Change photo" : "Upload photo"}</label>
          </div>
        </div>
        <div className="d-flex flex-wrap gap-2">
          <button type="button" className="btn btn-sm btn-outline-success" aria-label="Export lead profile as PDF" onClick={handleExportProfilePdf} disabled={exportingPdf}>
            <FaFilePdf aria-hidden="true" /> {exportingPdf ? "Preparing PDF..." : "Export PDF"}
          </button>
          {!isEditing && <button type="button" className="btn btn-sm btn-outline-primary" aria-label={`Edit lead ${lead.name || "Unnamed lead"}`} onClick={onEdit}>Edit</button>}
          <button type="button" className="btn btn-sm btn-outline-danger" aria-label={`Delete lead ${lead.name || "Unnamed lead"}`} onClick={onDeleteLead}>
            <FaTrash aria-hidden="true" /> Delete
          </button>
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onClose}>Close profile</button>
        </div>
      </header>
      <dl className="lead-profile-details">
        {details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || "Not provided"}</dd></div>)}
        <div><dt>Callback time</dt><dd>{lead.callbackTime || "Not set"}{lead.callbackCompleted ? ' (completed)' : ''}</dd></div>
      </dl>
      <div className="lead-profile-status-control">
        <label htmlFor={`lead-profile-status-${lead.id}`}>Status</label>
        <select id={`lead-profile-status-${lead.id}`} className="form-select form-select-sm" value={lead.status || options.statuses[0] || "New"} onChange={(event) => onStatusChange(lead.id, event.target.value)}>
          {lead.status && !getLeadStatusOptions(options.statuses).includes(lead.status) && <option value={lead.status}>{lead.status}</option>}
          {getLeadStatusOptions(options.statuses).map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
      </div>
      {isEditing && (
        <form className="lead-profile-edit-form" onSubmit={(event) => { event.preventDefault(); onSave(lead.id); }}>
          <h5 className="lead-profile-section-title">Edit lead</h5>
          <div className="row g-2 align-items-end">
            <div className="col-12">
              <label className="form-label" htmlFor={`edit-lead-${lead.id}-name`}>Name *</label>
              <input id={`edit-lead-${lead.id}-name`} type="text" className="form-control" value={editForm.name} onChange={onEditFormChange("name")} required />
            </div>
            <div className="col-sm-6">
              <label className="form-label" htmlFor={`edit-lead-${lead.id}-phone`}>Phone</label>
              <input id={`edit-lead-${lead.id}-phone`} type="tel" className="form-control" value={editForm.phone} onChange={onEditFormChange("phone")} />
            </div>
            <div className="col-sm-6">
              <label className="form-label" htmlFor={`edit-lead-${lead.id}-email`}>Email</label>
              <input id={`edit-lead-${lead.id}-email`} type="email" className="form-control" value={editForm.email} onChange={onEditFormChange("email")} />
            </div>
            <div className="col-sm-6">
              <label className="form-label" htmlFor={`edit-lead-${lead.id}-status`}>Status</label>
              <select id={`edit-lead-${lead.id}-status`} className="form-select" value={editForm.status || "New"} onChange={onEditFormChange("status")}>
                {getLeadStatusOptions(options.statuses).map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
            </div>
            <LeadDetailFields values={editForm} options={options} onChange={onEditFormChange} onCreateOption={onCreateOption} prefix={`edit-lead-${lead.id}`} hideClassInstance />
            <fieldset className="col-12 lead-class-instance-picker">
              <legend>Class instances</legend>
              <p className="small text-muted">Select every class instance this lead attends.</p>
              {editClassInstances.length === 0 ? <p className="small text-muted mb-0">No class instances available for this class type.</p> : (
                <div className="lead-class-instance-options">
                  {editClassInstances.map((instance) => {
                    const selected = selectedClassInstanceIds.includes(instance.id);
                    return (
                      <label key={instance.id}>
                        <input type="checkbox" value={instance.id} checked={selected} onChange={(event) => {
                          const nextIds = event.target.checked
                            ? [...new Set([...selectedClassInstanceIds, instance.id])]
                            : selectedClassInstanceIds.filter((instanceId) => instanceId !== instance.id);
                          onEditFormChange("classInstanceIds")({ target: { value: nextIds } });
                        }} />
                        <span>{getClassInstanceLabel(instance)}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </fieldset>
            <div className="col-12 d-flex flex-wrap gap-2 mt-3">
              <button type="button" className="btn btn-outline-secondary" onClick={onCancelEdit} disabled={saving}>Cancel</button>
              <button type="submit" className="btn btn-success" disabled={saving}>{saving ? "Saving..." : "Save"}</button>
            </div>
          </div>
        </form>
      )}
      <h5 className="lead-profile-section-title">Class instances</h5>
      {classes.length === 0 ? <p className="text-muted mb-0">No class instances or attendance records.</p> : (
        <div className="lead-profile-classes">
          {classes.map((instance) => {
            const configuredWeeks = Number(instance.totalWeeks);
            const weekNumbers = Number.isInteger(configuredWeeks) && configuredWeeks > 0
              ? Array.from({ length: configuredWeeks }, (_unused, index) => index + 1)
              : [...new Set(instance.attendance.map((entry) => entry.week).filter((week) => week > 0))].sort((first, second) => first - second);
            const startDate = parseISO(instance.startDate || "");
            const dateForWeek = (week) => isValid(startDate) ? format(addWeeks(startDate, week - 1), "MMM d, yyyy") : "Date not set";
            const attendanceByWeek = new Map(instance.attendance.map((entry) => [entry.week, entry]));
            const presentCount = weekNumbers.filter((week) => attendanceByWeek.get(week)?.present).length;
            const assignedProgram = (instance.programAssignments || []).find((assignment) => assignment.programType === lead.programType);
            const requiresCoupon = String(lead.programType || '').toLowerCase().includes('coupon');
            const couponBalanceDue = requiresCoupon ? weekNumbers.reduce((balance, week) => {
              const record = attendanceByWeek.get(week) || {};
              return balance + (record.couponReceived ? 0 : Math.max(0, 35 - Number(record.amountPaid || 0)));
            }, 0) : 0;
            return (
              <article className="lead-profile-class" key={instance.id}>
                <section className="lead-profile-enrollment" aria-label={`Enrollment for ${instance.name || 'class instance'}`}>
                  <h6>Enrollment</h6>
                  <div className="lead-profile-class-heading">
                    <strong>{instance.name || 'Class instance'}</strong>
                    {instance.isCurrent && <span className="badge text-bg-success">Current assignment</span>}
                  </div>
                  <div className="text-muted small">{[instance.classType, instance.startDate, instance.totalWeeks ? `${instance.totalWeeks} weeks` : ''].filter(Boolean).join(' · ') || instance.id}</div>
                </section>
                <section className="lead-profile-payments" aria-label={`Payments for ${instance.name || 'class instance'}`}>
                  <h6>Payments</h6>
                  {assignedProgram ? <div className="lead-profile-program-prices">{assignedProgram.programType}: ${Number(assignedProgram.price).toFixed(2)}</div> : <p className="small text-muted mb-0">No price configured for this lead's program.</p>}
                  {requiresCoupon && <p className="lead-profile-balance">Balance due: ${couponBalanceDue.toFixed(2)}</p>}
                  {assignedProgram && !requiresCoupon && <ProgramPaymentSection key={`${lead.id}:${instance.id}`} lead={lead} instance={instance} program={assignedProgram} canRecord={canEditAttendance} saving={savingAttendanceKey === `${instance.id}:payment`} onRecordPayment={onRecordPayment} onUpdatePayment={onUpdatePayment} onDeletePayment={onDeletePayment} />}
                  {requiresCoupon && <div className="lead-profile-coupon-receipts">
                    <p className="small fw-semibold mb-2">Coupons received</p>
                    {weekNumbers.length === 0 ? <p className="small text-muted mb-0">No class weeks configured.</p> : (
                      <ul className="lead-profile-weeks">
                        {weekNumbers.map((week) => {
                          const attendanceKey = `${instance.id}:${week}`;
                          const attendanceRecord = attendanceByWeek.get(week) || {};
                          const couponReceived = Boolean(attendanceRecord.couponReceived);
                          const amountPaid = Number(attendanceRecord.amountPaid || 0);
                          return <li key={week}>
                            <label className="lead-profile-attendance-week"><input type="checkbox" aria-label={`Coupon received: ${lead.name || 'Unnamed lead'}, ${instance.name || 'class instance'}, week ${week}`} checked={couponReceived} disabled={!canEditAttendance || savingAttendanceKey === attendanceKey || amountPaid >= 35} onChange={(event) => onPaymentChoice(lead, instance, week, event.target.checked)} /><span>Coupon received for week {week}</span></label>
                            {!couponReceived && <span className={`lead-profile-payment-status${amountPaid >= 35 ? ' settled' : ''}`}>{amountPaid >= 35 ? `Paid $35 for week ${week}` : `Owes $35 for week ${week}`}</span>}
                            {savingAttendanceKey === attendanceKey && <span className="small text-muted ms-4" role="status">Saving...</span>}
                          </li>;
                        })}
                      </ul>
                    )}
                  </div>}
                </section>
                <section className="lead-profile-attendance" aria-label={`Attendance report for ${instance.name || 'class instance'}`}>
                  <h6>Attendance report</h6>
                  {weekNumbers.length === 0 ? <p className="small text-muted mb-0">No class weeks configured for attendance.</p> : (
                    <>
                      <p className="small mb-2">Present {presentCount} of {weekNumbers.length} weeks</p>
                      <ul className="lead-profile-weeks">
                        {weekNumbers.map((week) => {
                          const attendanceKey = `${instance.id}:${week}`;
                          const present = Boolean(attendanceByWeek.get(week)?.present);
                          const attendanceRecord = attendanceByWeek.get(week) || {};
                          const couponReceived = Boolean(attendanceRecord.couponReceived);
                          return (
                            <li key={week}>
                              <label className="lead-profile-attendance-week">
                                <input type="checkbox" aria-label={`Present: ${lead.name || 'Unnamed lead'}, ${instance.name || 'class instance'}, week ${week}`} checked={present} disabled={!canEditAttendance || savingAttendanceKey === attendanceKey} onChange={(event) => onAttendanceChange(lead, instance, week, event.target.checked)} />
                                <span>Week {week} · {dateForWeek(week)}: {present ? 'Present' : 'Absent'}</span>
                                {savingAttendanceKey === attendanceKey && <span className="small text-muted" role="status">Saving...</span>}
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  )}
                </section>
              </article>
            );
          })}
        </div>
      )}
      <form className="lead-profile-follow-up" onSubmit={(event) => { event.preventDefault(); onSaveFollowUp(lead, { followUp: followUpEnabled, callbackTime: callTime }); }}>
        <h5 className="lead-profile-section-title">Follow-up</h5>
        <label className="lead-profile-follow-up-toggle">
          <input type="checkbox" aria-label={`Needs follow-up: ${lead.name || 'Unnamed lead'}`} checked={followUpEnabled} onChange={(event) => setFollowUpEnabled(event.target.checked)} disabled={!canEditAttendance || savingFollowUp} />
          <span>Needs follow-up</span>
        </label>
        <div className="lead-profile-call-time">
          <label htmlFor={`lead-profile-call-time-${lead.id}`}>Time to call</label>
          <input id={`lead-profile-call-time-${lead.id}`} type="time" value={callTime} onChange={(event) => setCallTime(event.target.value)} disabled={!canEditAttendance || savingFollowUp} />
        </div>
        <button type="submit" className="btn btn-sm btn-outline-primary" disabled={!canEditAttendance || savingFollowUp}>{savingFollowUp ? "Saving..." : "Save Follow-up"}</button>
      </form>
      {lead.status === "New" && (
        <section className="lead-profile-call-attempts" aria-label="Lead call attempts">
          <h5 className="lead-profile-section-title">Call attempts</h5>
          <p className="small text-muted">Record each call attempt. After all three, this lead is marked Dead Lead.</p>
          <ol>
            {Array.from({ length: CALL_ATTEMPT_COUNT }, (_unused, index) => {
              const attempt = lead.callAttempts?.[index];
              const attemptKey = `${lead.id}:${index}`;
              return (
                <li key={index}>
                  <label>
                    <input type="checkbox" aria-label={`Call attempt ${index + 1} of ${CALL_ATTEMPT_COUNT}`} checked={Boolean(attempt?.attemptedAt)} disabled={!canEditAttendance || savingAttemptKey === attemptKey} onChange={(event) => onCallAttemptChange(lead, index, event.target.checked)} />
                    <span>Attempt {index + 1}</span>
                  </label>
                  {attempt?.attemptedAt ? <time dateTime={attempt.attemptedAt}>{new Date(attempt.attemptedAt).toLocaleString()}</time> : <span className="text-muted small">Not attempted</span>}
                  {savingAttemptKey === attemptKey && <span className="text-muted small" role="status">Saving...</span>}
                </li>
              );
            })}
          </ol>
        </section>
      )}
      <section className="lead-profile-comments" aria-label={`Comments for ${lead.name || 'lead'}`}>
        <h5 className="lead-profile-section-title">Comments</h5>
        {comments.length === 0 ? <p className="small text-muted">No comments yet.</p> : (
          <ul className="lead-profile-comment-list">
            {comments.map((comment) => (
              <li key={comment.id}>
                <div className="lead-profile-comment-content">
                  <p>{comment.text}</p>
                  <span>{comment.createdByName || "Unknown"} · {formatTimestamp(comment.createdAt)}</span>
                </div>
                <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => onDeleteComment(lead.id, comment.id)}>Delete</button>
              </li>
            ))}
          </ul>
        )}
        <form className="lead-profile-comment-form" onSubmit={(event) => { event.preventDefault(); onAddComment(lead.id); }}>
          <input type="text" className="form-control" aria-label={`Comment for ${lead.name || 'lead'}`} value={commentDraft} onChange={(event) => onCommentDraftChange(lead.id, event.target.value)} placeholder="Write a comment..." />
          <button type="submit" className="btn btn-primary" disabled={!commentDraft.trim()}>Add Comment</button>
        </form>
      </section>
      <section className="lead-profile-attachments" aria-label={`Documents and images for ${lead.name || 'lead'}`}>
        <h5 className="lead-profile-section-title">Documents &amp; Images</h5>
        <label className="lead-profile-attachment-picker" htmlFor={`lead-attachments-${lead.id}`}>
          <span>Add documents or images</span>
          <input id={`lead-attachments-${lead.id}`} type="file" multiple onChange={handleAttachmentSelection} disabled={!canEditAttendance || uploadingAttachments} />
        </label>
        {uploadingAttachments && <p className="small text-muted" role="status">Uploading files...</p>}
        {attachments.length ? (
          <ul className="lead-profile-attachment-list">
            {attachments.map((attachment) => (
              <li key={attachment.id || attachment.path || attachment.url}>
                <div className="lead-profile-attachment-info">
                  {attachment.type?.startsWith("image/") && <img src={attachment.url} alt={attachment.name || "Lead attachment"} />}
                  <div>
                    <a href={attachment.url} target="_blank" rel="noreferrer">{attachment.name || "Download attachment"}</a>
                    <span>{[formatFileSize(attachment.size), formatPdfDate(attachment.uploadedAt)].filter(Boolean).join(" · ")}</span>
                  </div>
                </div>
                <button type="button" className="btn btn-sm btn-outline-danger" aria-label={`Delete attachment ${attachment.name || "file"}`} disabled={!canEditAttendance || uploadingAttachments} onClick={() => onDeleteAttachment(lead, attachment)}>Delete</button>
              </li>
            ))}
          </ul>
        ) : <p className="small text-muted mb-0">No documents or images attached.</p>}
      </section>
    </section>
  );
};

const LeadArReceiptNumberInput = ({ payment, disabled, onSave }) => {
  const [receiptNumber, setReceiptNumber] = useState(payment.receiptNumber || "");

  useEffect(() => {
    setReceiptNumber(payment.receiptNumber || "");
  }, [payment.receiptNumber]);

  const saveReceiptNumber = () => {
    const normalized = receiptNumber.trim();
    if (normalized !== (payment.receiptNumber || "")) onSave(payment, normalized);
  };

  return <input
    type="text"
    className="form-control form-control-sm lead-ar-receipt-number-input"
    aria-label={`Receipt number for ${payment.lead} ${payment.date}`}
    value={receiptNumber}
    maxLength={80}
    disabled={disabled}
    onChange={(event) => setReceiptNumber(event.target.value)}
    onBlur={saveReceiptNumber}
    onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
  />;
};

const LeadAccountsReceivableReport = ({ leads, classInstances, attendanceRecords, paymentRecords, view, onUpdatePayment, savingAttendanceKey }) => {
  const [asOfDate, setAsOfDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [startDate, setStartDate] = useState(() => {
    const today = new Date();
    return format(new Date(today.getFullYear(), today.getMonth(), 1), "yyyy-MM-dd");
  });
  const [paymentMethodFilter, setPaymentMethodFilter] = useState("all");
  const report = useMemo(() => {
    const payments = [];
    const balances = [];
    const enrollments = [];
    const attendance = [];
    const rosterTotalsByClass = new Map();
    const attendanceTotalsByClassType = new Map();
    let outstandingTotal = 0;
    const includePaymentDate = (date) => !date || (date >= startDate && date <= asOfDate);
    const includeThroughEndDate = (date) => !date || date <= asOfDate;
    const includeAttendanceDate = (date) => !date || date <= asOfDate;

    leads.forEach((lead) => {
      const history = getLeadClassHistory(lead, classInstances, attendanceRecords, paymentRecords);
      history.forEach((instance) => {
        const assignedProgram = (instance.programAssignments || []).find((assignment) => assignment.programType === lead.programType);
        const requiresCoupon = String(lead.programType || "").toLowerCase().includes("coupon");
        const configuredWeeks = Number(instance.totalWeeks);
        const weekNumbers = Number.isInteger(configuredWeeks) && configuredWeeks > 0
          ? Array.from({ length: configuredWeeks }, (_unused, index) => index + 1)
          : [...new Set(instance.attendance.map((entry) => entry.week).filter((week) => week > 0))].sort((first, second) => first - second);
        const attendanceByWeek = new Map(instance.attendance.map((entry) => [entry.week, entry]));
        const startDate = parseISO(instance.startDate || "");
        const dateForWeek = (week) => isValid(startDate) ? format(addWeeks(startDate, week - 1), "yyyy-MM-dd") : "";
        let totalPaid = 0;

        enrollments.push({
          classInstanceId: instance.id,
          lead: lead.name || "Unnamed lead",
          className: instance.name || "Class instance",
          program: lead.programType || "-",
          classType: instance.classType || "-",
          assignment: instance.isCurrent ? "Current" : "Previous",
        });
        const rosterTotal = rosterTotalsByClass.get(instance.id) || { classInstanceId: instance.id, className: instance.name || "Class instance", classType: instance.classType || "-", totalLeads: 0 };
        rosterTotal.totalLeads += 1;
        rosterTotalsByClass.set(instance.id, rosterTotal);
        const classType = instance.classType || "Not set";
        if (!attendanceTotalsByClassType.has(classType)) {
          attendanceTotalsByClassType.set(classType, { classType, totalRecords: 0, present: 0, absent: 0 });
        }

        instance.payments.forEach((payment) => {
          const amount = Number(payment.amount || 0);
          if (includeThroughEndDate(payment.date)) totalPaid += amount;
          if (includePaymentDate(payment.date)) {
            payments.push({
              leadId: lead.id,
              classInstanceId: instance.id,
              sourcePayment: payment,
              date: payment.date || "No date",
              receiptNumber: payment.receiptNumber || "",
              lead: lead.name || "Unnamed lead",
              className: instance.name || "Class instance",
              program: lead.programType || "-",
              method: payment.method || "Payment",
              amount,
            });
          }
        });

        if (requiresCoupon) {
          weekNumbers.forEach((week) => {
            const record = attendanceByWeek.get(week) || {};
            const classDate = dateForWeek(week);
            const amountPaid = Number(record.amountPaid || 0);
            if (amountPaid > 0) {
              if (includeThroughEndDate(classDate)) totalPaid += amountPaid;
              if (includePaymentDate(classDate)) payments.push({ leadId: lead.id, classInstanceId: instance.id, sourcePayment: null, date: classDate || "No date", lead: lead.name || "Unnamed lead", className: instance.name || "Class instance", program: lead.programType || "-", method: "Class payment", amount: amountPaid });
            }
            if (record.couponReceived) {
              if (includeThroughEndDate(classDate)) totalPaid += 35;
              if (includePaymentDate(classDate)) payments.push({ leadId: lead.id, classInstanceId: instance.id, sourcePayment: null, date: classDate || "No date", lead: lead.name || "Unnamed lead", className: instance.name || "Class instance", program: lead.programType || "-", method: "Church coupon", amount: 35 });
            }
          });
        }

        const programPrice = requiresCoupon ? weekNumbers.length * 35 : Number(assignedProgram?.price);
        const hasConfiguredPrice = requiresCoupon || (assignedProgram && Number.isFinite(programPrice));
        const balanceDue = hasConfiguredPrice ? Math.max(0, programPrice - totalPaid) : null;
        if (balanceDue !== null) outstandingTotal += balanceDue;
        balances.push({
          lead: lead.name || "Unnamed lead",
          className: instance.name || "Class instance",
          program: lead.programType || "-",
          price: hasConfiguredPrice ? programPrice : null,
          paid: totalPaid,
          balance: balanceDue,
        });

        instance.attendance.forEach((record) => {
          const classDate = dateForWeek(record.week);
          if (!includeAttendanceDate(classDate)) return;
          attendance.push({
            classInstanceId: instance.id,
            date: classDate || "Not set",
            classType,
            lead: lead.name || "Unnamed lead",
            program: lead.programType || "-",
            status: record.present ? "Present" : "Absent",
          });
          const attendanceTotal = attendanceTotalsByClassType.get(classType) || { classType, totalRecords: 0, present: 0, absent: 0 };
          attendanceTotal.totalRecords += 1;
          if (record.present) attendanceTotal.present += 1;
          else attendanceTotal.absent += 1;
          attendanceTotalsByClassType.set(classType, attendanceTotal);
        });
      });
    });

    payments.sort((first, second) => String(second.date).localeCompare(String(first.date)) || first.lead.localeCompare(second.lead));
    attendance.sort((first, second) => String(second.date).localeCompare(String(first.date)) || first.classType.localeCompare(second.classType));
    enrollments.sort((first, second) => first.className.localeCompare(second.className) || first.lead.localeCompare(second.lead));
    const methodTotals = new Map();
    payments.forEach((payment) => {
      const methodKey = String(payment.method || "Other").trim().toLowerCase();
      const method = methodKey.includes("coupon") ? "Church Coupons" : payment.method || "Other";
      const current = methodTotals.get(method) || { method, count: 0, amount: 0 };
      current.count += 1;
      current.amount += payment.amount;
      methodTotals.set(method, current);
    });
    const preferredMethodOrder = ["Cash", "Zelle", "Church Coupons"];
    const paymentMethodTotals = [...methodTotals.values()].sort((first, second) => {
      const firstOrder = preferredMethodOrder.indexOf(first.method);
      const secondOrder = preferredMethodOrder.indexOf(second.method);
      if (firstOrder !== secondOrder) return (firstOrder < 0 ? Infinity : firstOrder) - (secondOrder < 0 ? Infinity : secondOrder);
      return first.method.localeCompare(second.method);
    });
    const lockboxPayments = payments.filter((payment) => ["cash", "zelle"].includes(String(payment.method || "").trim().toLowerCase()));
    return {
      payments,
      paymentMethodTotals,
      lockboxTotal: lockboxPayments.reduce((total, payment) => total + Number(payment.amount || 0), 0),
      lockboxTransactionCount: lockboxPayments.length,
      balances,
      enrollments,
      rosterTotals: [...rosterTotalsByClass.values()].sort((first, second) => first.className.localeCompare(second.className)),
      attendance,
      attendanceTotals: [...attendanceTotalsByClassType.values()].sort((first, second) => first.classType.localeCompare(second.classType)),
      paidTotal: payments.reduce((total, payment) => total + payment.amount, 0),
      outstandingTotal,
    };
  }, [leads, classInstances, attendanceRecords, paymentRecords, asOfDate, startDate]);

  const attendanceGroups = report.attendanceTotals.map((classTotal) => ({
    ...classTotal,
    entries: report.attendance.filter((entry) => entry.classType === classTotal.classType),
  }));
  const money = (amount) => `$${Number(amount || 0).toFixed(2)}`;
  const paymentMethods = [...new Set(report.payments.map((payment) => String(payment.method || "Other").trim() || "Other"))]
    .sort((first, second) => first.localeCompare(second));
  const visiblePayments = paymentMethodFilter === "all"
    ? report.payments
    : report.payments.filter((payment) => (String(payment.method || "Other").trim() || "Other") === paymentMethodFilter);
  const visiblePaymentsSubtotal = visiblePayments.reduce((total, payment) => total + Number(payment.amount || 0), 0);
  const paymentMethodOptions = ["Cash", "Zelle", "Check", "Card", "Bank transfer", "Other", "Lighthouse Church Coupon", "Affiliate Church"];
  const changePaymentMethod = async (payment, method) => {
    if (!payment.sourcePayment || !onUpdatePayment) return;
    const lead = leads.find((entry) => entry.id === payment.leadId);
    if (!lead) return;
    const instance = getLeadClassHistory(lead, classInstances, attendanceRecords, paymentRecords)
      .find((entry) => entry.id === payment.classInstanceId);
    if (!instance) return;
    const fixedAmountByMethod = { "Lighthouse Church Coupon": 35, "Affiliate Church": 210 };
    const amount = fixedAmountByMethod[method] ?? Number(payment.sourcePayment.amount || 0);
    await onUpdatePayment(lead, instance, payment.sourcePayment, {
      amount,
      date: payment.sourcePayment.date || payment.date,
      method,
    });
  };
  const changePaymentDate = async (payment, date) => {
    if (!payment.sourcePayment || !onUpdatePayment || !date) return;
    const lead = leads.find((entry) => entry.id === payment.leadId);
    if (!lead) return;
    const instance = getLeadClassHistory(lead, classInstances, attendanceRecords, paymentRecords)
      .find((entry) => entry.id === payment.classInstanceId);
    if (!instance) return;
    await onUpdatePayment(lead, instance, payment.sourcePayment, {
      amount: Number(payment.sourcePayment.amount || 0),
      date,
      method: payment.sourcePayment.method || payment.method || "Other",
    });
  };
  const changePaymentReceiptNumber = async (payment, receiptNumber) => {
    if (!payment.sourcePayment || !onUpdatePayment) return;
    const lead = leads.find((entry) => entry.id === payment.leadId);
    if (!lead) return;
    const instance = getLeadClassHistory(lead, classInstances, attendanceRecords, paymentRecords)
      .find((entry) => entry.id === payment.classInstanceId);
    if (!instance) return;
    await onUpdatePayment(lead, instance, payment.sourcePayment, {
      amount: Number(payment.sourcePayment.amount || 0),
      date: payment.sourcePayment.date || payment.date,
      method: payment.sourcePayment.method || payment.method || "Other",
      receiptNumber,
    });
  };
  const displayDate = (dateValue) => {
    const parsedDate = parseISO(String(dateValue || ""));
    return isValid(parsedDate) ? format(parsedDate, "MMMM d, yyyy") : String(dateValue || "Not set");
  };
  const reportTitle = view === "accountsReceivable" ? "Accounts Receivable" : view === "classRoster" ? "Class Roster" : "Attendance";

  return (
    <section className="lead-ar-report" aria-label={view === "accountsReceivable" ? "Accounts receivable report" : `${reportTitle} report`}>
      <header className="lead-ar-report-header">
        <div>
          <h3>{reportTitle}</h3>
          <p>{view === "accountsReceivable" ? `Payments from ${displayDate(startDate)} through ${displayDate(asOfDate)}; balances as of the end date.` : view === "classRoster" ? "Leads assigned to each class instance." : `Class attendance through ${displayDate(asOfDate)}.`}</p>
        </div>
        {view === "accountsReceivable" ? <div className="lead-ar-date-range" aria-label="Accounts Receivable date range">
          <label htmlFor="lead-ar-start-date">Start date
            <input id="lead-ar-start-date" aria-label="Report start date" type="date" value={startDate} max={asOfDate} onChange={(event) => { setStartDate(event.target.value); if (event.target.value > asOfDate) setAsOfDate(event.target.value); }} />
          </label>
          <label htmlFor="lead-ar-end-date">End date
            <input id="lead-ar-end-date" aria-label="Report end date" type="date" value={asOfDate} min={startDate} onChange={(event) => setAsOfDate(event.target.value)} />
          </label>
          <span className="lead-ar-date-display">{displayDate(startDate)} - {displayDate(asOfDate)}</span>
        </div> : view === "attendance" && <label htmlFor="lead-ar-as-of-date">
          Through date
          <input id="lead-ar-as-of-date" aria-label="Report as of date" type="date" value={asOfDate} onChange={(event) => setAsOfDate(event.target.value)} />
          <span className="lead-ar-date-display">{displayDate(asOfDate)}</span>
        </label>}
      </header>

      {view === "accountsReceivable" && <div className="lead-ar-summary">
        <div><span>Received in range</span><strong>{money(report.paidTotal)}</strong></div>
        <div><span>Outstanding at end date</span><strong>{money(report.outstandingTotal)}</strong></div>
        <div><span>Payments listed</span><strong>{visiblePayments.length}</strong></div>
        <div><span>Class enrollments</span><strong>{report.enrollments.length}</strong></div>
      </div>}

      {view === "accountsReceivable" && <>
      <section className="lead-ar-report-section" aria-label="Payment totals by method">
        <h4>Totals by payment method</h4>
        <div className="table-responsive">
          <table className="table table-sm table-striped align-middle">
            <thead><tr><th>Payment method</th><th className="text-end">Transactions</th><th className="text-end">Total received</th></tr></thead>
            <tbody>{report.paymentMethodTotals.map((methodTotal) => (
              <tr key={methodTotal.method}><td>{methodTotal.method}</td><td className="text-end">{methodTotal.count}</td><td className="text-end fw-semibold">{money(methodTotal.amount)}</td></tr>
            ))}
            <tr className="lead-ar-lockbox-total"><th scope="row">Lockbox total (Cash + Zelle)</th><td className="text-end">{report.lockboxTransactionCount}</td><td className="text-end">{money(report.lockboxTotal)}</td></tr>
            </tbody>
          </table>
        </div>
        {report.paymentMethodTotals.length === 0 && <p className="small text-muted">No payments recorded through this date.</p>}
      </section>
      <section className="lead-ar-report-section" aria-label="Payment report">
        <h4>Payments through {displayDate(asOfDate)}</h4>
        <div className="lead-ar-payment-filter">
          <label htmlFor="lead-ar-payment-method">Filter by method</label>
          <select id="lead-ar-payment-method" aria-label="Filter Accounts Receivable payments by method" value={paymentMethodFilter} onChange={(event) => setPaymentMethodFilter(event.target.value)}>
            <option value="all">All methods</option>
            {paymentMethods.map((method) => <option key={method} value={method}>{method}</option>)}
          </select>
        </div>
        <div className="table-responsive">
          <table className="table table-sm table-striped align-middle">
            <thead><tr><th>Date</th><th>Receipt #</th><th>Lead</th><th>Class</th><th>Program</th><th>Method</th><th className="text-end">Amount</th></tr></thead>
            <tbody>{visiblePayments.map((payment, index) => (
              <tr key={`${payment.date}-${payment.lead}-${payment.className}-${payment.method}-${index}`}>
                <td>{payment.sourcePayment ? <input
                  type="date"
                  className="form-control form-control-sm lead-ar-payment-date-input"
                  aria-label={`Change payment date for ${payment.lead} ${displayDate(payment.date)}`}
                  value={/^\d{4}-\d{2}-\d{2}$/.test(payment.sourcePayment.date || "") ? payment.sourcePayment.date : ""}
                  disabled={savingAttendanceKey === `${payment.classInstanceId}:payment`}
                  onChange={(event) => changePaymentDate(payment, event.target.value)}
                /> : displayDate(payment.date)}</td><td>{payment.sourcePayment ? <LeadArReceiptNumberInput
                  payment={payment}
                  disabled={savingAttendanceKey === `${payment.classInstanceId}:payment`}
                  onSave={changePaymentReceiptNumber}
                /> : payment.receiptNumber || "-"}</td><td>{payment.lead}</td><td>{payment.className}</td><td>{payment.program}</td><td>{payment.sourcePayment ? (
                  <select
                    className="form-select form-select-sm lead-ar-payment-method-select"
                    aria-label={`Change payment method for ${payment.lead} ${displayDate(payment.date)}`}
                    value={payment.method}
                    disabled={savingAttendanceKey === `${payment.classInstanceId}:payment`}
                    onChange={(event) => changePaymentMethod(payment, event.target.value)}
                  >
                    {!paymentMethodOptions.includes(payment.method) && <option>{payment.method}</option>}
                    {paymentMethodOptions.map((method) => <option key={method}>{method}</option>)}
                  </select>
                ) : payment.method}</td><td className="text-end">{money(payment.amount)}</td>
              </tr>
            ))}
            {visiblePayments.length > 0 && <tr className="lead-ar-payment-subtotal">
              <th scope="row" colSpan={6}>Subtotal</th>
              <td className="text-end">{money(visiblePaymentsSubtotal)}</td>
            </tr>}
            </tbody>
          </table>
        </div>
        {visiblePayments.length === 0 && <p className="small text-muted">{report.payments.length ? "No payments match this method." : "No payments recorded through this date."}</p>}
      </section>
      </>}

      {view === "classRoster" && <>
      <section className="lead-ar-report-section" aria-label="Class roster totals">
        <h4>Totals per class</h4>
        <div className="table-responsive">
          <table className="table table-sm table-striped align-middle">
            <thead><tr><th>Class</th><th>Class type</th><th className="text-end">Total leads</th></tr></thead>
            <tbody>{report.rosterTotals.map((classTotal) => (
              <tr key={classTotal.classInstanceId}><td>{classTotal.className}</td><td>{classTotal.classType}</td><td className="text-end fw-semibold">{classTotal.totalLeads}</td></tr>
            ))}</tbody>
          </table>
        </div>
        {report.rosterTotals.length === 0 && <p className="small text-muted">No class enrollments found.</p>}
      </section>
      <section className="lead-ar-report-section" aria-label="Class roster">
        <h4>Class roster</h4>
        <div className="table-responsive">
          <table className="table table-sm table-striped align-middle">
            <thead><tr><th>Class</th><th>Class type</th><th>Lead</th><th>Program</th><th>Assignment</th></tr></thead>
            <tbody>{report.enrollments.map((enrollment, index) => (
              <tr key={`${enrollment.className}-${enrollment.lead}-${index}`}><td>{enrollment.className}</td><td>{enrollment.classType}</td><td>{enrollment.lead}</td><td>{enrollment.program}</td><td>{enrollment.assignment}</td></tr>
            ))}</tbody>
          </table>
        </div>
        {report.enrollments.length === 0 && <p className="small text-muted">No class enrollments found.</p>}
      </section>}
      </>}

      {view === "attendance" && <>
      <section className="lead-ar-report-section" aria-label="Class attendance report">
        <h4>Attendance by Class Type through {displayDate(asOfDate)}</h4>
        {attendanceGroups.length === 0 ? <p className="small text-muted">No classes or attendance records through this date.</p> : (
          <div className="lead-ar-attendance-groups">
            {attendanceGroups.map((group) => (
              <section className="lead-ar-attendance-group" key={group.classType} aria-label={`Attendance for ${group.classType}`}>
                <header>
                  <h5>{group.classType}</h5>
                  <div className="lead-ar-attendance-metrics" aria-label={`${group.present} present, ${group.absent} absent, ${group.totalRecords} total records`}>
                    <span><strong>{group.present}</strong> Present</span>
                    <span><strong>{group.absent}</strong> Absent</span>
                    <span><strong>{group.totalRecords}</strong> Total</span>
                  </div>
                </header>
                {group.entries.length ? (
                  <div className="table-responsive">
                    <table className="table table-sm align-middle lead-ar-attendance-table">
                      <caption className="visually-hidden">{group.classType} attendance through {displayDate(asOfDate)}</caption>
                      <thead><tr><th scope="col">Date</th><th scope="col">Lead</th><th scope="col">Program</th><th scope="col">Attendance</th></tr></thead>
                      <tbody>{group.entries.map((entry, index) => (
                        <tr key={`${entry.date}-${entry.lead}-${index}`}><td>{displayDate(entry.date)}</td><td>{entry.lead}</td><td>{entry.program}</td><td>{entry.status}</td></tr>
                      ))}</tbody>
                    </table>
                  </div>
                ) : <p className="small text-muted mb-0">No attendance records for this class type through the selected date.</p>}
              </section>
            ))}
          </div>
        )}
      </section>}
      </>}
    </section>
  );
};

const LeadStatusReport = ({ leads, statuses }) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [enabledStatuses, setEnabledStatuses] = useState(null);
  const availableStatuses = useMemo(() => [...new Set([...statuses, ...leads.map((lead) => lead.status || "New")])], [leads, statuses]);
  const groupedLeads = useMemo(() => {
    const search = searchQuery.trim().toLowerCase();
    return availableStatuses.filter((status) => enabledStatuses === null || enabledStatuses.includes(status)).map((status) => ({
      status,
      leads: leads.filter((lead) => {
        if ((lead.status || "New") !== status) return false;
        if (!search) return true;
        return [lead.name, lead.phone, lead.email]
          .some((value) => String(value || "").toLowerCase().includes(search));
      }),
    })).filter((group) => group.leads.length > 0);
  }, [availableStatuses, enabledStatuses, leads, searchQuery]);
  const filteredLeadCount = groupedLeads.reduce((total, group) => total + group.leads.length, 0);

  return (
    <section className="lead-status-report" aria-label="Leads grouped by status">
      <header className="lead-status-report-header">
        <h3>Leads by Status</h3>
        <span aria-label={`${filteredLeadCount} total leads`}>{filteredLeadCount} total leads</span>
      </header>
      <div className="lead-status-report-controls">
        <div className="lead-status-filter lead-status-filter-bar">
          <div className="lead-status-filter-header">
            <span>Status filters</span>
            <button type="button" className="btn btn-sm btn-link" onClick={() => setEnabledStatuses(null)}>All on</button>
          </div>
          <div className="lead-status-filter-options" role="group" aria-label="Filter status report by status">
            {availableStatuses.map((status) => (
              <label key={status}>
                <input type="checkbox" aria-label={`Include status ${status}`} checked={enabledStatuses === null || enabledStatuses.includes(status)} onChange={() => {
                  setEnabledStatuses((previous) => {
                    const next = new Set(previous === null ? availableStatuses : previous);
                    if (next.has(status)) next.delete(status);
                    else next.add(status);
                    const nextStatuses = availableStatuses.filter((option) => next.has(option));
                    return nextStatuses.length === availableStatuses.length ? null : nextStatuses;
                  });
                }} />
                <span>{status}</span>
              </label>
            ))}
          </div>
        </div>
        <input type="search" className="form-control" aria-label="Search leads by status" placeholder="Search by name, phone, or email..." value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} />
      </div>
      {groupedLeads.length === 0 ? <p className="small text-muted">No leads to report.</p> : (
        <div className="lead-status-groups">
          {groupedLeads.map(({ status, leads: statusLeads }) => (
            <section className="lead-status-group" key={status} aria-label={`Leads with status ${status}`}>
              <h4>
                <span>{status}</span>
                <span className="lead-status-count" aria-label={`${statusLeads.length} leads in ${status}`}>
                  {statusLeads.length} {statusLeads.length === 1 ? "lead" : "leads"}
                </span>
              </h4>
              <div className="table-responsive">
                <table className="table table-sm table-striped align-middle">
                  <thead><tr><th>Lead</th><th>Phone</th></tr></thead>
                  <tbody>{statusLeads.map((lead) => (
                    <tr key={lead.id}><td>{lead.name || "Unnamed lead"}</td><td>{lead.phone || "Not provided"}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  );
};

const LeadsPage = () => {
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const profileLeadId = searchParams.get('leadId');
  const { user } = useAuth();

  const [leads, setLeads] = useState([]);
  const [attendanceRecords, setAttendanceRecords] = useState([]);
  const [paymentRecords, setPaymentRecords] = useState([]);
  const [options, setOptions] = useState(getDefaultLeadOptions);
  const [publicCheckInToken, setPublicCheckInToken] = useState("");
  const [publicCheckInSlug, setPublicCheckInSlug] = useState("");
  const [publicCheckInSlugDraft, setPublicCheckInSlugDraft] = useState("");
  const [publicCheckInSaving, setPublicCheckInSaving] = useState(false);
  const statuses = options.statuses;
  const [enabledStatusFilters, setEnabledStatusFilters] = useState(null);
  const [sharedPhoneOnly, setSharedPhoneOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeView, setActiveView] = useState("leads");
  const [accountsReceivablePin, setAccountsReceivablePin] = useState("");
  const [accountsReceivableUnlocked, setAccountsReceivableUnlocked] = useState(false);
  const [accountsReceivablePinError, setAccountsReceivablePinError] = useState("");
  const [showAddLeadForm, setShowAddLeadForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [currentLeadPage, setCurrentLeadPage] = useState(1);
  const [form, setForm] = useState({ ...EMPTY_LEAD_FORM, status: "New", classInstanceIds: [], classInstances: [] });
  const [editingLeadId, setEditingLeadId] = useState(null);
  const [editForm, setEditForm] = useState(EMPTY_LEAD_FORM);
  const [commentsByLead, setCommentsByLead] = useState({});
  const [commentDrafts, setCommentDrafts] = useState({});
  const [callClock, setCallClock] = useState(() => new Date());
  const [updatingCallId, setUpdatingCallId] = useState(null);
  const [reschedulingCall, setReschedulingCall] = useState(null);
  const [savingAttendanceKey, setSavingAttendanceKey] = useState(null);
  const [savingAttemptKey, setSavingAttemptKey] = useState(null);
  const [savingFollowUpLeadId, setSavingFollowUpLeadId] = useState(null);

  useEffect(() => {
    const timer = setInterval(() => setCallClock(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  const routePrefix =
    typeof window !== "undefined" && window.location?.pathname?.includes("/church/")
      ? "/church"
      : "/organization";

  // Real-time leads listener
  useEffect(() => {
    if (!id) return undefined;
    setLoading(true);
    const leadsRef = collection(db, "churches", id, "leads");
    const leadsQuery = query(leadsRef, orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(
      leadsQuery,
      (snapshot) => {
        setLeads(snapshot.docs.map((leadDoc) => {
          const data = leadDoc.data();
          const detailValues = Object.fromEntries(LEAD_DETAIL_LISTS.map(({ field }) => [
            field,
            formatLeadDisplayValue(field === "cityState" ? getLeadLocation(data) : data[field]),
          ]));
          return { ...data, ...detailValues, id: leadDoc.id };
        }));
        setLoading(false);
      },
      (error) => {
        console.error("Error loading leads:", error);
        toast.error("Failed to load leads");
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, [id]);

  useEffect(() => {
    if (!id) return undefined;
    setOptions(getDefaultLeadOptions());
    setAttendanceRecords([]);
    setPaymentRecords([]);
    setPublicCheckInToken("");
    setPublicCheckInSlug("");
    setPublicCheckInSlugDraft("");
    const settingsRef = collection(db, "churches", id, "leadsSettings");
    const unsubscribe = onSnapshot(
      settingsRef,
      (snapshot) => {
        const nextOptions = getDefaultLeadOptions();
        const nextAttendanceRecords = [];
        const nextPaymentRecords = [];
        let nextPublicCheckInToken = "";
        let nextPublicCheckInSlug = "";
        snapshot.docs.forEach((setting) => {
          const settingData = setting.data() || {};
          const list = settingData.statusList;
          if (setting.id === "publicPhoneCheckIn" && settingData.enabled !== false) {
            nextPublicCheckInToken = settingData.token || "";
            nextPublicCheckInSlug = settingData.slug || "";
          }
          if (Object.prototype.hasOwnProperty.call(nextOptions, setting.id) && Array.isArray(list)) {
            nextOptions[setting.id] = setting.id === "classInstances" ? list : list.map(formatLeadDisplayValue);
          }
          if (setting.id.startsWith('classAttendance_') && settingData.attendance) {
            nextAttendanceRecords.push({ id: setting.id, ...settingData });
          }
          if (setting.id.startsWith('classPayments_') && settingData.payments) {
            nextPaymentRecords.push({ id: setting.id, ...settingData });
          }
        });
        setOptions(nextOptions);
        setAttendanceRecords(nextAttendanceRecords);
        setPaymentRecords(nextPaymentRecords);
        setPublicCheckInToken(nextPublicCheckInToken);
        setPublicCheckInSlug(nextPublicCheckInSlug);
        setPublicCheckInSlugDraft(nextPublicCheckInSlug);
      },
      (error) => {
        console.error("Error loading lead options:", error);
        toast.error("Failed to load lead options");
      }
    );
    return () => unsubscribe();
  }, [id]);

  // Load comments for the selected profile.
  useEffect(() => {
    if (!id || !profileLeadId) return undefined;
    const commentsRef = collection(db, "churches", id, "leads", profileLeadId, "comments");
    const commentsQuery = query(commentsRef, orderBy("createdAt", "asc"));
    const unsubscribe = onSnapshot(
      commentsQuery,
      (snapshot) => {
        setCommentsByLead((previous) => ({
          ...previous,
          [profileLeadId]: snapshot.docs.map((commentDoc) => ({
            id: commentDoc.id,
            ...commentDoc.data(),
          })),
        }));
      },
      (error) => {
        console.error("Error loading comments:", error);
        toast.error("Failed to load comments");
      }
    );
    return () => unsubscribe();
  }, [id, profileLeadId]);

  const handleFormChange = (field) => (event) => {
    const value = field === "phone" ? formatPhoneNumber(event.target.value) : event.target.value;
    if (field === "classInstanceIds") {
      const selectedIds = Array.isArray(event.target.value) ? event.target.value : [];
      const selectedInstances = selectedIds
        .map((instanceId) => options.classInstances.find((instance) => instance.id === instanceId))
        .filter(Boolean);
      setForm((previous) => ({
        ...previous,
        classInstanceIds: selectedInstances.map((instance) => instance.id),
        classInstances: selectedInstances,
        classInstanceId: selectedInstances[0]?.id || "",
        classInstance: selectedInstances[0] || null,
        classType: selectedInstances[0]?.classType || previous.classType,
      }));
      return;
    }
    setForm((previous) => {
      if (field !== "classType") return { ...previous, [field]: value };
      const matchingInstances = (previous.classInstances || []).filter((instance) => instance.classType === value);
      return {
        ...previous,
        classType: value,
        classInstanceIds: matchingInstances.map((instance) => instance.id),
        classInstances: matchingInstances,
        classInstanceId: matchingInstances[0]?.id || "",
        classInstance: matchingInstances[0] || null,
      };
    });
  };

  const handleCreateLeadOption = async (listId, rawValue) => {
    const value = formatLeadDisplayValue(rawValue).trim();
    if (!id || !value || !options[listId]) return;
    const existing = options[listId].find((option) => String(option).toLowerCase() === value.toLowerCase());
    if (existing) return existing;
    const nextOptions = [...options[listId], value];
    setOptions((previous) => ({ ...previous, [listId]: nextOptions }));
    try {
      await setDoc(doc(db, "churches", id, "leadsSettings", listId), { statusList: nextOptions }, { merge: true });
      toast.success("City & State option added");
    } catch (error) {
      toast.error("Couldn't add this City & State to shared options; it is still available for this lead.");
    }
    return value;
  };

  const handleOpenAddLeadForm = (name = "") => {
    setForm({ ...EMPTY_LEAD_FORM, name: name.trim(), status: "New", classInstanceIds: [], classInstances: [] });
    setShowAddLeadForm(true);
  };

  const handleAddLead = async (event) => {
    event.preventDefault();
    if (duplicatePhoneLead) {
      toast.error("A profile with this phone number already exists");
      return;
    }
    if (!id || !form.name.trim()) {
      toast.error("Lead name is required");
      return;
    }

    try {
      setSaving(true);
      const leadData = {
        name: form.name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        callbackTime: form.callbackTime,
        ...getLeadClassAssignmentFields(form, options.classInstances),
        ...Object.fromEntries(LEAD_DETAIL_LISTS.map((list) => [list.field, form[list.field]])),
        status: form.status || "New",
        createdAt: serverTimestamp(),
        createdBy: user?.uid || "",
        createdByName: user?.displayName || user?.email || "",
      };
      const leadRef = await addDoc(collection(db, "churches", id, "leads"), leadData);
      const createdLead = { ...leadData, id: leadRef.id, createdAt: new Date().toISOString() };
      setLeads((previous) => [createdLead, ...previous.filter((lead) => lead.id !== leadRef.id)]);
      setSearchParams({ leadId: leadRef.id });
      setShowAddLeadForm(false);
      setForm({ ...EMPTY_LEAD_FORM, status: "New", classInstanceIds: [], classInstances: [] });
      toast.success("Lead added");
    } catch (error) {
      console.error("Error adding lead:", error);
      toast.error("Failed to add lead");
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (leadId, nextStatus) => {
    if (!id) return;
    try {
      await updateDoc(doc(db, "churches", id, "leads", leadId), {
        status: nextStatus,
        updatedAt: serverTimestamp(),
      });
      setLeads((previous) => previous.map((lead) => lead.id === leadId ? { ...lead, status: nextStatus } : lead));
      toast.success("Status updated");
    } catch (error) {
      console.error("Error updating status:", error);
      toast.error("Failed to update status");
    }
  };

  const handleSaveFollowUp = async (lead, followUpDetails) => {
    if (!id || !user?.uid || savingFollowUpLeadId) return;
    const nextFields = {
      followUp: Boolean(followUpDetails.followUp),
      callbackTime: followUpDetails.callbackTime || "",
    };
    if (nextFields.callbackTime !== (lead.callbackTime || "")) {
      nextFields.callbackCompleted = false;
      nextFields.callbackCompletedAt = null;
    }
    if (nextFields.followUp && statuses.includes("Contacted")) nextFields.status = "Contacted";
    setSavingFollowUpLeadId(lead.id);
    try {
      await updateDoc(doc(db, "churches", id, "leads", lead.id), { ...nextFields, updatedAt: serverTimestamp() });
      setLeads((previous) => previous.map((entry) => entry.id === lead.id ? { ...entry, ...nextFields } : entry));
      toast.success("Follow-up saved");
    } catch (error) {
      toast.error("Failed to save follow-up");
    } finally {
      setSavingFollowUpLeadId(null);
    }
  };

  const handleCallAttemptChange = async (lead, attemptIndex, attempted) => {
    if (!id || !user?.uid || savingAttemptKey) return;
    const attemptKey = `${lead.id}:${attemptIndex}`;
    const attempts = Array.from({ length: CALL_ATTEMPT_COUNT }, (_unused, index) => lead.callAttempts?.[index] || null);
    attempts[attemptIndex] = attempted ? { attemptedAt: new Date().toISOString(), attemptedBy: user.uid } : null;
    const nextStatus = attempts.every(Boolean) ? "Dead Lead" : lead.status === "Dead Lead" ? "New" : lead.status || statuses[0] || "New";
    setSavingAttemptKey(attemptKey);
    try {
      await updateDoc(doc(db, "churches", id, "leads", lead.id), {
        callAttempts: attempts,
        status: nextStatus,
        updatedAt: serverTimestamp(),
      });
      setLeads((previous) => previous.map((entry) => entry.id === lead.id ? { ...entry, callAttempts: attempts, status: nextStatus } : entry));
    } catch (error) {
      toast.error("Failed to save call attempt");
    } finally {
      setSavingAttemptKey(null);
    }
  };

  const handleDeleteLead = async (leadId) => {
    if (!id) return;
    if (!window.confirm("Delete this lead and its comments?")) return;
    try {
      await deleteDoc(doc(db, "churches", id, "leads", leadId));
      if (profileLeadId === leadId) {
        const nextParams = new URLSearchParams(searchParams);
        nextParams.delete('leadId');
        setSearchParams(nextParams);
      }
      if (editingLeadId === leadId) setEditingLeadId(null);
      toast.success("Lead deleted");
    } catch (error) {
      console.error("Error deleting lead:", error);
      toast.error("Failed to delete lead");
    }
  };

  const handleStartEditLead = (lead) => {
    const assignedInstances = getLeadAssignedInstances(lead, options.classInstances);
    setEditingLeadId(lead.id);
    setEditForm({
      name: lead.name || "",
      phone: lead.phone || "",
      email: lead.email || "",
      status: lead.status || "New",
      callbackTime: lead.callbackTime || "",
      classInstanceIds: assignedInstances.map((instance) => instance.id),
      classInstances: assignedInstances,
      classInstanceId: assignedInstances[0]?.id || "",
      classInstance: assignedInstances[0] || null,
      ...Object.fromEntries(LEAD_DETAIL_LISTS.map((list) => [list.field, lead[list.field] || ""])),
    });
  };

  const handleCancelEditLead = () => {
    setEditingLeadId(null);
    setEditForm(EMPTY_LEAD_FORM);
  };

  const handleEditFormChange = (field) => (event) => {
    const value = field === "phone" ? formatPhoneNumber(event.target.value) : event.target.value;
    if (field === "classInstanceIds") {
      const selectedIds = Array.isArray(event.target.value) ? event.target.value : [];
      setEditForm((previous) => {
        const previousInstancesById = new Map((previous.classInstances || []).map((instance) => [instance.id, instance]));
        const selectedInstances = selectedIds
          .map((instanceId) => options.classInstances.find((instance) => instance.id === instanceId) || previousInstancesById.get(instanceId))
          .filter(Boolean);
        return {
          ...previous,
          classInstanceIds: selectedInstances.map((instance) => instance.id),
          classInstances: selectedInstances,
          classInstanceId: selectedInstances[0]?.id || "",
          classInstance: selectedInstances[0] || null,
          classType: selectedInstances[0]?.classType || previous.classType,
        };
      });
      return;
    }
    setEditForm((previous) => {
      if (field !== "classType") return { ...previous, [field]: value };
      const matchingInstances = (previous.classInstances || []).filter((instance) => instance.classType === value);
      return {
        ...previous,
        classType: value,
        classInstanceIds: matchingInstances.map((instance) => instance.id),
        classInstances: matchingInstances,
        classInstanceId: matchingInstances[0]?.id || "",
        classInstance: matchingInstances[0] || null,
      };
    });
  };

  const handleCallCompletion = async (leadId, completed, callbackTime) => {
    if (!id || updatingCallId) return false;
    try {
      setUpdatingCallId(leadId);
      await updateDoc(doc(db, "churches", id, "leads", leadId), {
        callbackCompleted: completed,
        callbackCompletedAt: completed ? serverTimestamp() : null,
        ...(callbackTime !== undefined ? { callbackTime } : {}),
        updatedAt: serverTimestamp(),
      });
      toast.success(completed ? "Call marked complete" : "Call scheduled again");
      return true;
    } catch (error) {
      console.error("Error updating call completion:", error);
      toast.error("Failed to update call completion");
      return false;
    } finally {
      setUpdatingCallId(null);
    }
  };

  const handleRescheduleCall = async (event) => {
    event.preventDefault();
    if (!reschedulingCall || !/^([01]\d|2[0-3]):[0-5]\d$/.test(reschedulingCall.time)) {
      toast.error("Choose a valid callback time");
      return;
    }
    if (await handleCallCompletion(reschedulingCall.leadId, false, reschedulingCall.time)) {
      setReschedulingCall(null);
    }
  };

  const handleSaveLead = async (leadId) => {
    if (!id) return;
    if (!editForm.name.trim()) {
      toast.error("Lead name is required");
      return;
    }
    try {
      setSaving(true);
      const savedFields = {
        name: editForm.name.trim(),
        phone: editForm.phone.trim(),
        email: editForm.email.trim(),
        status: editForm.status || "New",
        callbackTime: editForm.callbackTime,
        ...getLeadClassAssignmentFields(editForm, options.classInstances),
        ...(editForm.callbackTime !== leads.find((lead) => lead.id === leadId)?.callbackTime
          ? { callbackCompleted: false, callbackCompletedAt: null }
          : {}),
        ...Object.fromEntries(LEAD_DETAIL_LISTS.map((list) => [list.field, editForm[list.field]])),
      };
      await updateDoc(doc(db, "churches", id, "leads", leadId), { ...savedFields, updatedAt: serverTimestamp() });
      setLeads((previous) => previous.map((entry) => entry.id === leadId
        ? { ...entry, ...savedFields, updatedAt: new Date().toISOString() }
        : entry));
      toast.success("Lead updated");
      setEditingLeadId(null);
    } catch (error) {
      console.error("Error updating lead:", error);
      toast.error("Failed to update lead");
    } finally {
      setSaving(false);
    }
  };

  const handlePhoneCheckIn = async ({ lead, phone, name, email, classInstance, week }) => {
    if (!id || !user?.uid || !classInstance?.id) return false;
    let checkInLead = findDuplicateLead({ phone }, leads)?.lead || lead;
    let createdLead = false;
    try {
      if (!checkInLead) {
        const classAssignment = getLeadClassAssignmentFields({
          classType: classInstance.classType,
          classInstanceId: classInstance.id,
          classInstance,
          classInstanceIds: [classInstance.id],
          classInstances: [classInstance],
        }, options.classInstances);
        const leadData = {
          name: name.trim(),
          phone: phone.trim(),
          email: email.trim(),
          status: "New",
          ...classAssignment,
          ...Object.fromEntries(LEAD_DETAIL_LISTS.map((list) => [list.field, list.field === "classType" ? classInstance.classType : ""])),
          createdAt: serverTimestamp(),
          createdBy: user.uid,
          createdByName: user.displayName || user.email || "",
        };
        const leadRef = await addDoc(collection(db, "churches", id, "leads"), leadData);
        checkInLead = { ...leadData, id: leadRef.id, createdAt: new Date().toISOString() };
        setLeads((previous) => [checkInLead, ...previous.filter((entry) => entry.id !== checkInLead.id)]);
        createdLead = true;
      }

      const attendanceDocumentId = `classAttendance_${classInstance.id}_${week}`;
      const existingDocument = attendanceRecords.find((record) => record.id === attendanceDocumentId);
      const existingAttendance = existingDocument?.attendance?.[checkInLead.id] || {};
      if (existingAttendance.present) {
        toast.success(`${checkInLead.name || "Lead"} is already checked in`);
        return true;
      }
      const attendanceEntry = {
        ...existingAttendance,
        present: true,
        couponReceived: Boolean(existingAttendance.couponReceived),
        amountPaid: Number(existingAttendance.amountPaid || 0),
        programType: checkInLead.programType || existingAttendance.programType || "",
        name: checkInLead.name || "",
        phone: checkInLead.phone || phone,
        email: checkInLead.email || "",
        updatedBy: user.uid,
        updatedAt: new Date().toISOString(),
      };
      const classInstanceData = {
        id: classInstance.id,
        name: classInstance.name || "",
        classType: classInstance.classType || "",
        startDate: classInstance.startDate || "",
        totalWeeks: Number(classInstance.totalWeeks || 0),
      };
      await setDoc(doc(db, "churches", id, "leadsSettings", attendanceDocumentId), {
        classInstanceId: classInstance.id,
        className: classInstance.name || "",
        classType: classInstance.classType || "",
        classInstance: classInstanceData,
        week,
        attendance: {
          [checkInLead.id]: { ...attendanceEntry, updatedAt: serverTimestamp() },
        },
      }, { merge: true });
      setAttendanceRecords((previous) => [
        ...previous.filter((record) => record.id !== attendanceDocumentId),
        {
          ...(existingDocument || {}),
          id: attendanceDocumentId,
          classInstanceId: classInstance.id,
          className: classInstance.name || "",
          classType: classInstance.classType || "",
          classInstance: classInstanceData,
          week,
          attendance: { ...(existingDocument?.attendance || {}), [checkInLead.id]: attendanceEntry },
        },
      ]);
      toast.success(createdLead ? "Lead created and checked in" : "Lead checked in");
      return true;
    } catch (error) {
      console.error("Phone check-in failed:", error);
      toast.error(createdLead ? "Lead created, but check-in failed. Try again." : "Failed to check in lead");
      return false;
    }
  };

  const handleProfileAttendanceValueChange = async (lead, instance, week, field, value) => {
    if (!id || !user?.uid || savingAttendanceKey) return;
    const attendanceKey = `${instance.id}:${week}`;
    const previousRecord = instance.attendance.find((entry) => entry.week === week) || {};
    setSavingAttendanceKey(attendanceKey);
    try {
      await setDoc(doc(db, "churches", id, "leadsSettings", `classAttendance_${instance.id}_${week}`), {
        classInstanceId: instance.id,
        className: instance.name || "",
        classType: instance.classType || "",
        classInstance: { id: instance.id, name: instance.name || "", classType: instance.classType || "", startDate: instance.startDate || "", totalWeeks: Number(instance.totalWeeks || 0) },
        week,
        attendance: {
          [lead.id]: {
            present: Boolean(previousRecord.present),
            couponReceived: Boolean(previousRecord.couponReceived),
            amountPaid: Number(previousRecord.amountPaid || 0),
            programType: lead.programType || previousRecord.programType || "",
            [field]: value,
            name: lead.name || "",
            phone: lead.phone || "",
            email: lead.email || "",
            updatedBy: user.uid,
            updatedAt: serverTimestamp(),
          },
        },
      }, { merge: true });
    } catch (error) {
      toast.error("Failed to save attendance");
    } finally {
      setSavingAttendanceKey(null);
    }
  };

  const handleProfileAttendanceChange = (lead, instance, week, present) => handleProfileAttendanceValueChange(lead, instance, week, "present", present);
  const handleProfileCouponReceived = async (lead, instance, week, received) => {
    if (!id || !user?.uid || savingAttendanceKey) return;
    const attendanceKey = `${instance.id}:${week}`;
    const previousRecord = instance.attendance.find((entry) => entry.week === week) || {};
    setSavingAttendanceKey(attendanceKey);
    try {
      await setDoc(doc(db, "churches", id, "leadsSettings", `classAttendance_${instance.id}_${week}`), {
        classInstanceId: instance.id,
        className: instance.name || "",
        classType: instance.classType || "",
        classInstance: { id: instance.id, name: instance.name || "", classType: instance.classType || "", startDate: instance.startDate || "", totalWeeks: Number(instance.totalWeeks || 0) },
        week,
        attendance: {
          [lead.id]: {
            present: Boolean(previousRecord.present), couponReceived: received, amountPaid: 0,
            programType: lead.programType || previousRecord.programType || "",
            name: lead.name || "", phone: lead.phone || "", email: lead.email || "",
            updatedBy: user.uid, updatedAt: serverTimestamp(),
          },
        },
      }, { merge: true });
    } catch (error) {
      toast.error("Failed to save payment record");
    } finally {
      setSavingAttendanceKey(null);
    }
  };

  const handleRecordFullPayment = async (lead, instance, paymentDetails) => {
    if (!id || !user?.uid || !paymentDetails?.amount || !paymentDetails?.date || !paymentDetails?.method) return false;
    const program = (instance.programAssignments || []).find((assignment) => assignment.programType === lead.programType);
    const programPrice = Number(program?.price || 0);
    const existingRecord = paymentRecords.find((record) => record.classInstanceId === instance.id || record.id === `classPayments_${instance.id}`);
    const previousPaymentsById = new Map();
    [...(existingRecord?.payments?.[lead.id] || []), ...(lead.classPaymentHistory || []).filter((payment) => payment.classInstanceId === instance.id)].forEach((payment, index) => {
      previousPaymentsById.set(payment.id || `legacy-payment-${index}`, payment);
    });
    const previousPayments = [...previousPaymentsById.values()];
    const totalPaid = previousPayments.reduce((total, payment) => total + Number(payment.amount || 0), 0);
    const amount = Number(paymentDetails.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > Math.max(0, programPrice - totalPaid)) {
      toast.error("Payment amount exceeds the remaining balance");
      return false;
    }

    const paymentId = doc(collection(db, "churches", id, "leads")).id;
    const payment = {
      id: paymentId,
      classInstanceId: instance.id,
      amount,
      date: paymentDetails.date,
      method: paymentDetails.method,
      receiptNumber: String(paymentDetails.receiptNumber || "").trim(),
      recordedAt: new Date().toISOString(),
      recordedBy: user.uid,
    };
    setSavingAttendanceKey(`${instance.id}:payment`);
    try {
      await updateDoc(doc(db, "churches", id, "leads", lead.id), {
        classPaymentHistory: arrayUnion(payment),
        updatedAt: serverTimestamp(),
      });
      setLeads((previous) => previous.map((entry) => entry.id === lead.id
        ? { ...entry, classPaymentHistory: [...(entry.classPaymentHistory || []), payment] }
        : entry));
      toast.success("Payment recorded");
      return true;
    } catch (error) {
      toast.error("Failed to record payment");
      return false;
    } finally {
      setSavingAttendanceKey(null);
    }
  };

  const updatePaymentSources = async (lead, instance, payment, replacement) => {
    const leadPayments = lead.classPaymentHistory || [];
    const legacyRecord = paymentRecords.find((record) => record.classInstanceId === instance.id || record.id === `classPayments_${instance.id}`);
    const legacyPayments = legacyRecord?.payments?.[lead.id] || [];
    const hasLeadPayment = leadPayments.some((entry) => isSamePayment(entry, payment));
    const hasLegacyPayment = legacyPayments.some((entry) => isSamePayment(entry, payment));
    if (!hasLeadPayment && !hasLegacyPayment) return false;

    const nextLeadPayments = hasLeadPayment
      ? leadPayments.flatMap((entry) => isSamePayment(entry, payment) ? (replacement ? [replacement] : []) : [entry])
      : leadPayments;
    const nextLegacyPayments = hasLegacyPayment
      ? legacyPayments.flatMap((entry) => isSamePayment(entry, payment) ? (replacement ? [replacement] : []) : [entry])
      : legacyPayments;
    const batch = writeBatch(db);
    if (hasLeadPayment) {
      batch.update(doc(db, "churches", id, "leads", lead.id), {
        classPaymentHistory: nextLeadPayments,
        updatedAt: serverTimestamp(),
      });
    }
    if (hasLegacyPayment) {
      batch.update(doc(db, "churches", id, "leadsSettings", legacyRecord.id), {
        payments: { ...legacyRecord.payments, [lead.id]: nextLegacyPayments },
      });
    }
    await batch.commit();

    if (hasLeadPayment) {
      setLeads((previous) => previous.map((entry) => entry.id === lead.id
        ? { ...entry, classPaymentHistory: nextLeadPayments }
        : entry));
    }
    if (hasLegacyPayment) {
      setPaymentRecords((previous) => previous.map((record) => record.id === legacyRecord.id
        ? { ...record, payments: { ...record.payments, [lead.id]: nextLegacyPayments } }
        : record));
    }
    return true;
  };

  const handleUpdatePayment = async (lead, instance, payment, paymentDetails) => {
    if (!id || !user?.uid || !paymentDetails?.amount || !paymentDetails?.date || !paymentDetails?.method) return false;
    const program = (instance.programAssignments || []).find((assignment) => assignment.programType === lead.programType);
    const totalPaidExcludingPayment = instance.payments.reduce((total, entry) => total + (isSamePayment(entry, payment) ? 0 : Number(entry.amount || 0)), 0);
    const maxAmount = Math.max(0, Number(program?.price || 0) - totalPaidExcludingPayment);
    const amount = Number(paymentDetails.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > maxAmount) {
      toast.error("Payment amount exceeds the remaining balance");
      return false;
    }

    const replacement = { ...payment, amount, date: paymentDetails.date, method: paymentDetails.method, receiptNumber: String(paymentDetails.receiptNumber ?? payment.receiptNumber ?? "").trim(), updatedAt: new Date().toISOString(), updatedBy: user.uid };
    setSavingAttendanceKey(`${instance.id}:payment`);
    try {
      if (!await updatePaymentSources(lead, instance, payment, replacement)) return false;
      toast.success("Payment updated");
      return true;
    } catch (error) {
      toast.error("Failed to update payment");
      return false;
    } finally {
      setSavingAttendanceKey(null);
    }
  };

  const handleDeletePayment = async (lead, instance, payment) => {
    if (!id || !user?.uid || !window.confirm("Delete this payment?")) return false;
    setSavingAttendanceKey(`${instance.id}:payment`);
    try {
      if (!await updatePaymentSources(lead, instance, payment, null)) return false;
      toast.success("Payment deleted");
      return true;
    } catch (error) {
      toast.error("Failed to delete payment");
      return false;
    } finally {
      setSavingAttendanceKey(null);
    }
  };

  const handleUploadLeadAttachments = async (lead, files) => {
    if (!id || !user?.uid || !storage) return;
    let uploadedCount = 0;
    for (const file of files) {
      if (file.size >= MAX_LEAD_ATTACHMENT_SIZE) {
        toast.error(`${file.name} must be smaller than 10 MB`);
        continue;
      }

      const attachmentId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const filePath = `churches/${id}/leads/${lead.id}/attachments/${attachmentId}_${safeFileName}`;
      const fileRef = storageRef(storage, filePath);
      let fileUploaded = false;
      try {
        await uploadBytes(fileRef, file, { contentType: file.type || "application/octet-stream" });
        fileUploaded = true;
        const attachment = {
          id: attachmentId,
          name: file.name,
          url: await getDownloadURL(fileRef),
          path: filePath,
          type: file.type || "application/octet-stream",
          size: file.size,
          uploadedAt: new Date().toISOString(),
          uploadedBy: user.uid,
        };
        await updateDoc(doc(db, "churches", id, "leads", lead.id), {
          attachments: arrayUnion(attachment),
          updatedAt: serverTimestamp(),
        });
        setLeads((previous) => previous.map((entry) => entry.id === lead.id
          ? { ...entry, attachments: [...(entry.attachments || []), attachment] }
          : entry));
        uploadedCount += 1;
      } catch (error) {
        console.error(`Error uploading lead attachment ${file.name}:`, error);
        if (fileUploaded) await deleteObject(fileRef).catch(() => {});
        toast.error(`Failed to upload ${file.name}`);
      }
    }
    if (uploadedCount > 0) toast.success(`${uploadedCount} file${uploadedCount === 1 ? "" : "s"} uploaded`);
  };

  const handleUploadLeadProfileImage = async (lead, file) => {
    if (!id || !user?.uid || !storage) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Choose an image file");
      return;
    }
    if (file.size >= MAX_LEAD_PROFILE_IMAGE_SIZE) {
      toast.error("Profile images must be smaller than 5 MB");
      return;
    }

    const imageId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const imagePath = `churches/${id}/leads/${lead.id}/attachments/profile_${imageId}_${safeFileName}`;
    const imageRef = storageRef(storage, imagePath);
    let imageUploaded = false;
    try {
      await uploadBytes(imageRef, file, { contentType: file.type });
      imageUploaded = true;
      const profileImage = {
        name: file.name,
        url: await getDownloadURL(imageRef),
        path: imagePath,
        type: file.type,
        size: file.size,
        uploadedAt: new Date().toISOString(),
        uploadedBy: user.uid,
      };
      await updateDoc(doc(db, "churches", id, "leads", lead.id), { profileImage, updatedAt: serverTimestamp() });
      setLeads((previous) => previous.map((entry) => entry.id === lead.id ? { ...entry, profileImage } : entry));
      if (lead.profileImage?.path) {
        await deleteObject(storageRef(storage, lead.profileImage.path)).catch((error) => console.warn("Unable to remove previous lead profile image:", error));
      }
      toast.success("Profile photo updated");
    } catch (error) {
      console.error("Error uploading lead profile photo:", error);
      if (imageUploaded) await deleteObject(imageRef).catch(() => {});
      toast.error("Failed to update profile photo");
    }
  };

  const handleDeleteLeadAttachment = async (lead, attachment) => {
    if (!id || !user?.uid || !window.confirm(`Delete ${attachment.name || "this attachment"}?`)) return;
    try {
      await updateDoc(doc(db, "churches", id, "leads", lead.id), {
        attachments: arrayRemove(attachment),
        updatedAt: serverTimestamp(),
      });
      setLeads((previous) => previous.map((entry) => entry.id === lead.id
        ? { ...entry, attachments: (entry.attachments || []).filter((item) => item.id !== attachment.id) }
        : entry));
      if (attachment.path) await deleteObject(storageRef(storage, attachment.path)).catch((error) => console.warn("Unable to remove lead attachment from Storage:", error));
      toast.success("Attachment deleted");
    } catch (error) {
      console.error("Error deleting lead attachment:", error);
      toast.error("Failed to delete attachment");
    }
  };

  const handleCommentDraftChange = (leadId, value) => {
    setCommentDrafts((previous) => ({ ...previous, [leadId]: value }));
  };

  const handleAddComment = async (leadId) => {
    if (!id) return;
    const text = (commentDrafts[leadId] || "").trim();
    if (!text) return;
    try {
      await addDoc(collection(db, "churches", id, "leads", leadId, "comments"), {
        text,
        createdAt: serverTimestamp(),
        createdBy: user?.uid || "",
        createdByName: user?.displayName || user?.email || "Unknown",
      });
      setCommentDrafts((previous) => ({ ...previous, [leadId]: "" }));
    } catch (error) {
      console.error("Error adding comment:", error);
      toast.error("Failed to add comment");
    }
  };

  const handleDeleteComment = async (leadId, commentId) => {
    if (!id) return;
    try {
      await deleteDoc(doc(db, "churches", id, "leads", leadId, "comments", commentId));
      toast.success("Comment deleted");
    } catch (error) {
      console.error("Error deleting comment:", error);
      toast.error("Failed to delete comment");
    }
  };

  const openLeadProfile = (leadId, editLead = false) => {
    if (editLead) {
      const lead = leads.find((entry) => entry.id === leadId);
      if (lead) handleStartEditLead(lead);
    } else if (editingLeadId) {
      handleCancelEditLead();
    }
    setSearchParams({ leadId });
  };
  const closeLeadProfile = () => {
    handleCancelEditLead();
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('leadId');
    setSearchParams(nextParams);
  };

  // Follow-up color matches the "Contacted" status badge color (falls back to purple if absent)
  const followUpColor = statuses.includes("Contacted")
    ? getStatusColor("Contacted", statuses)
    : "#6f42c1";
  const availableLeadStatuses = [...new Set([
    ...getLeadStatusOptions(statuses),
    ...leads.map((lead) => lead.status || "New"),
  ])];

  const toggleLeadStatusFilter = (status) => {
    setCurrentLeadPage(1);
    setEnabledStatusFilters((previous) => {
      const next = new Set(previous === null ? availableLeadStatuses : previous);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      const nextStatuses = availableLeadStatuses.filter((option) => next.has(option));
      return nextStatuses.length === availableLeadStatuses.length ? null : nextStatuses;
    });
  };

  const sharedPhoneData = useMemo(() => {
    const leadIdsByPhone = new Map();
    leads.forEach((lead) => {
      const phone = normalizeLeadPhone(lead.phone);
      if (phone.length < 7) return;
      const phoneGroup = leadIdsByPhone.get(phone) || [];
      phoneGroup.push(lead);
      leadIdsByPhone.set(phone, phoneGroup);
    });
    const duplicatePhoneLeadIds = new Set();
    const moreDataLeadIds = new Set();
    [...leadIdsByPhone.values()].filter((group) => group.length > 1).forEach((group) => {
      group.forEach((lead) => duplicatePhoneLeadIds.add(lead.id));
      const rankedGroup = group.map((lead) => ({ lead, dataCount: getLeadDataCount(lead) }))
        .sort((left, right) => right.dataCount - left.dataCount);
      if (rankedGroup[0].dataCount > rankedGroup[1].dataCount) moreDataLeadIds.add(rankedGroup[0].lead.id);
    });
    return { duplicatePhoneLeadIds, moreDataLeadIds };
  }, [leads]);
  const { duplicatePhoneLeadIds, moreDataLeadIds } = sharedPhoneData;
  const duplicatePhoneLead = useMemo(() => {
    if (normalizeLeadPhone(form.phone).length < 7) return null;
    return findDuplicateLead({ phone: form.phone }, leads)?.lead || null;
  }, [form.phone, leads]);

  const filteredLeads = useMemo(() => {
    const search = searchQuery.trim().toLowerCase();
    const searchPhone = normalizeLeadPhone(search);
    const isPhoneSearch = Boolean(searchPhone) && /^[\d\s()+.-]+$/.test(search);
    return leads.filter((lead) => {
      const leadStatus = lead.status || "New";
      if (enabledStatusFilters !== null && !enabledStatusFilters.includes(leadStatus)) return false;
      if (sharedPhoneOnly && !duplicatePhoneLeadIds.has(lead.id)) return false;
      if (!search) return true;
      const textMatches = [lead.name, lead.phone, lead.email, lead.classInstance?.name, lead.classInstance?.startDate, ...LEAD_DETAIL_LISTS.map((list) => lead[list.field])]
        .map((value) => String(value || "").toLowerCase())
        .some((value) => value.includes(search));
      return textMatches || (isPhoneSearch && normalizeLeadPhone(lead.phone).includes(searchPhone));
    });
  }, [leads, searchQuery, enabledStatusFilters, sharedPhoneOnly, duplicatePhoneLeadIds]);

  const filteredLeadGroups = useMemo(() => {
    if (!sharedPhoneOnly) return [];
    const groupsByPhone = new Map();
    filteredLeads.forEach((lead) => {
      const phone = normalizeLeadPhone(lead.phone);
      const group = groupsByPhone.get(phone) || [];
      group.push(lead);
      groupsByPhone.set(phone, group);
    });
    return [...groupsByPhone.entries()]
      .sort(([phoneA], [phoneB]) => phoneA.localeCompare(phoneB))
      .map(([, group]) => group.sort((leadA, leadB) => (
        getLeadDataCount(leadB) - getLeadDataCount(leadA)
        || String(leadA.name || "").localeCompare(String(leadB.name || ""))
      )));
  }, [filteredLeads, sharedPhoneOnly]);

  const groupedLeadPages = useMemo(() => {
    if (!sharedPhoneOnly) return [];
    const pages = [];
    let currentPageGroups = [];
    let currentPageLeadCount = 0;
    filteredLeadGroups.forEach((group) => {
      if (currentPageLeadCount && currentPageLeadCount + group.length > LEADS_PER_PAGE) {
        pages.push(currentPageGroups);
        currentPageGroups = [];
        currentPageLeadCount = 0;
      }
      currentPageGroups.push(group);
      currentPageLeadCount += group.length;
    });
    if (currentPageGroups.length) pages.push(currentPageGroups);
    return pages;
  }, [filteredLeadGroups, sharedPhoneOnly]);

  useEffect(() => {
    setCurrentLeadPage(1);
  }, [id, searchQuery, enabledStatusFilters, sharedPhoneOnly]);

  const totalLeadPages = sharedPhoneOnly ? groupedLeadPages.length : Math.ceil(filteredLeads.length / LEADS_PER_PAGE);
  const activeLeadPage = Math.min(currentLeadPage, Math.max(1, totalLeadPages));
  const firstLeadIndex = sharedPhoneOnly
    ? groupedLeadPages.slice(0, activeLeadPage - 1).reduce((total, page) => total + page.reduce((count, group) => count + group.length, 0), 0)
    : (activeLeadPage - 1) * LEADS_PER_PAGE;
  const visibleLeads = sharedPhoneOnly
    ? (groupedLeadPages[activeLeadPage - 1] || []).flat()
    : filteredLeads.slice(firstLeadIndex, firstLeadIndex + LEADS_PER_PAGE);
  const firstVisibleLead = filteredLeads.length ? firstLeadIndex + 1 : 0;
  const lastVisibleLead = Math.min(firstLeadIndex + visibleLeads.length, filteredLeads.length);

  const selectedProfileLead = leads.find((lead) => lead.id === profileLeadId);
  const buildPublicCheckInUrl = (token, slug = publicCheckInSlug) => {
    if (typeof window === "undefined") return "";
    const encodedId = encodeURIComponent(id);
    const encodedToken = encodeURIComponent(token);
    const path = slug
      ? `/check-in/${encodedId}/${encodeURIComponent(slug)}/${encodedToken}`
      : `/public-lead-check-in/${encodedId}/${encodedToken}`;
    return `${window.location.origin}${path}`;
  };
  const publicCheckInUrl = publicCheckInToken && typeof window !== "undefined"
    ? buildPublicCheckInUrl(publicCheckInToken)
    : "";

  const handlePublicCheckInLink = async (rotate = false) => {
    if (!id || publicCheckInSaving) return;
    setPublicCheckInSaving(true);
    try {
      let token = publicCheckInToken;
      if (!token || rotate) {
        const bytes = new Uint8Array(32);
        window.crypto.getRandomValues(bytes);
        token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
        await setDoc(doc(db, "churches", id, "leadsSettings", "publicPhoneCheckIn"), {
          token,
          enabled: true,
          updatedAt: serverTimestamp(),
        }, { merge: true });
        setPublicCheckInToken(token);
      }
      const link = buildPublicCheckInUrl(token);
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
        toast.success(rotate ? "Public check-in link regenerated and copied" : "Public check-in link copied");
      } else {
        toast.success("Public check-in link is ready to copy below");
      }
    } catch (error) {
      console.error("Unable to create public check-in link:", error);
      toast.error("Only organization admins can create or rotate the public check-in link");
    } finally {
      setPublicCheckInSaving(false);
    }
  };

  const handleSavePublicCheckInSlug = async () => {
    if (!id || !publicCheckInToken || publicCheckInSaving) return;
    const slug = publicCheckInSlugDraft.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
    if (publicCheckInSlugDraft.trim() && (slug.length < 3 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))) {
      toast.error("Use at least 3 letters or numbers for the custom link");
      return;
    }
    setPublicCheckInSaving(true);
    try {
      await setDoc(doc(db, "churches", id, "leadsSettings", "publicPhoneCheckIn"), {
        slug,
        enabled: true,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      setPublicCheckInSlug(slug);
      setPublicCheckInSlugDraft(slug);
      toast.success(slug ? "Custom check-in link saved" : "Custom link removed");
    } catch (error) {
      console.error("Unable to save public check-in link:", error);
      toast.error("Only organization admins can update the public check-in link");
    } finally {
      setPublicCheckInSaving(false);
    }
  };

  const handleAccountsReceivablePinSubmit = (event) => {
    event.preventDefault();
    if (accountsReceivablePin === ACCOUNTS_RECEIVABLE_PIN) {
      setAccountsReceivableUnlocked(true);
      setAccountsReceivablePinError("");
      setAccountsReceivablePin("");
      return;
    }
    setAccountsReceivablePinError("Incorrect PIN. Try again.");
    setAccountsReceivablePin("");
  };
  const availableAddClassInstances = options.classInstances.filter((instance) => !form.classType || instance.classType === form.classType);

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return "";
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString();
  };

  const upcomingCalls = getUpcomingLeadCalls(leads, callClock);
  const nextUpcomingCall = upcomingCalls[0];
  const nextCallCountdown = nextUpcomingCall ? formatCallCountdown(nextUpcomingCall.callAt, callClock) : "";
  const nextCallSummary = nextUpcomingCall
    ? `${nextUpcomingCall.lead.name || "Unnamed lead"} · ${nextUpcomingCall.callAt.toDateString() === callClock.toDateString() ? "Today" : nextUpcomingCall.callAt.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} at ${nextUpcomingCall.callAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · ${nextUpcomingCall.lead.phone || "No phone number"}`
    : "";

  return (
    <div style={{ ...commonStyles.fullWidthContainer, position: "relative" }}>
      {nextUpcomingCall && <div className="leads-call-ticker-container">
        <div className="leads-call-ticker" role="status" aria-live="polite" aria-label="Next upcoming call">
          <span className="leads-call-ticker-label">Next call</span>
          <span className="leads-call-ticker-countdown">{nextCallCountdown}</span>
          <span className="visually-hidden">{nextCallCountdown}. {nextCallSummary}</span>
          <div className="leads-call-ticker-window" aria-hidden="true">
            <div className="leads-call-ticker-track"><span>{nextCallSummary}</span><span>{nextCallSummary}</span></div>
          </div>
        </div>
      </div>}
      <Link to={`${routePrefix}/${id}/mi-organizacion`} style={commonStyles.backButtonLink}>
        ← Back to Mi Organizacion
      </Link>

      <ChurchHeader id={id} applyShadow={false} compact />

      <div style={{ width: "100%", maxWidth: "1440px", margin: "0 auto", textAlign: "left" }}>
      <div className="d-flex flex-wrap justify-content-between align-items-center my-3 gap-2">
        <h2 className="mb-0">Leads</h2>
        <details className="leads-options-menu">
          <summary className="btn btn-outline-secondary">
            Manage Lead Options
            <span className="leads-options-caret" aria-hidden="true" />
          </summary>
          <nav className="leads-options-menu-items" aria-label="Manage lead options">
            {LEAD_MODULE_TABS.map((tab) => (
              <Link key={tab.id} to={`${routePrefix}/${id}/leads/${tab.path}`}>
                {tab.label}
              </Link>
            ))}
          </nav>
        </details>
      </div>

      <div className="leads-primary-tabs" role="tablist" aria-label="Leads reports">
        <button type="button" role="tab" aria-selected={activeView === "leads"} className={activeView === "leads" ? "active" : ""} onClick={() => setActiveView("leads")}>Leads</button>
        <button type="button" role="tab" aria-selected={activeView === "byStatus"} className={activeView === "byStatus" ? "active" : ""} onClick={() => setActiveView("byStatus")}>By Status</button>
        <button type="button" role="tab" aria-selected={activeView === "accountsReceivable"} className={activeView === "accountsReceivable" ? "active" : ""} onClick={() => setActiveView("accountsReceivable")}>Accounts Receivable</button>
        <button type="button" role="tab" aria-selected={activeView === "classRoster"} className={activeView === "classRoster" ? "active" : ""} onClick={() => setActiveView("classRoster")}>Class Roster</button>
        <button type="button" role="tab" aria-selected={activeView === "attendance"} className={activeView === "attendance" ? "active" : ""} onClick={() => setActiveView("attendance")}>Attendance</button>
        <button type="button" role="tab" aria-selected={activeView === "phoneCheckIn"} className={activeView === "phoneCheckIn" ? "active" : ""} onClick={() => setActiveView("phoneCheckIn")}>Phone Check-in</button>
      </div>
      {activeView === "phoneCheckIn" && <section className="public-checkin-link-bar" aria-label="Public check-in link">
        <div>
          <strong>Shareable public check-in</strong>
          <p className="small text-muted mb-0">Anyone with this private link can check in. Regenerate it to revoke the old link.</p>
        </div>
        {publicCheckInUrl && <input className="form-control" aria-label="Public check-in URL" value={publicCheckInUrl} readOnly onFocus={(event) => event.target.select()} />}
        {publicCheckInToken && <div className="public-checkin-slug-control">
          <label htmlFor="public-checkin-custom-slug" className="form-label">Custom link name</label>
          <div className="input-group input-group-sm">
            <input id="public-checkin-custom-slug" className="form-control" value={publicCheckInSlugDraft} onChange={(event) => setPublicCheckInSlugDraft(event.target.value)} placeholder="electrical-class-check-in" maxLength={60} />
            <button type="button" className="btn btn-outline-secondary" onClick={handleSavePublicCheckInSlug} disabled={publicCheckInSaving}>{publicCheckInSaving ? "Saving..." : "Save"}</button>
          </div>
        </div>}
        <div className="d-flex flex-wrap gap-2">
          <button type="button" className="btn btn-outline-primary" onClick={() => handlePublicCheckInLink()} disabled={publicCheckInSaving}>
            {publicCheckInSaving ? "Preparing link..." : publicCheckInToken ? "Copy public link" : "Generate public link"}
          </button>
          {publicCheckInToken && <button type="button" className="btn btn-outline-danger" onClick={() => handlePublicCheckInLink(true)} disabled={publicCheckInSaving}>Regenerate link</button>}
        </div>
      </section>}
      {activeView === "leads" && <div className="lead-status-filter lead-status-filter-bar">
        <div className="lead-status-filter-header">
          <span>Status filters</span>
          <button type="button" className="btn btn-sm btn-link" onClick={() => { setEnabledStatusFilters(null); setCurrentLeadPage(1); }}>All on</button>
        </div>
        <div className="lead-status-filter-options" role="group" aria-label="Filter leads by status">
          {availableLeadStatuses.map((status) => (
            <label key={status}>
              <input type="checkbox" aria-label={`Show leads with status ${status}`} checked={enabledStatusFilters === null || enabledStatusFilters.includes(status)} onChange={() => toggleLeadStatusFilter(status)} />
              <span>{status}</span>
            </label>
          ))}
        </div>
      </div>}

      {activeView === "accountsReceivable" && !accountsReceivableUnlocked ? (
          <section className="lead-ar-pin-gate" aria-label="Accounts Receivable PIN">
            <h3>Accounts Receivable</h3>
            <form onSubmit={handleAccountsReceivablePinSubmit}>
              <label htmlFor="accounts-receivable-pin">Enter PIN</label>
              <input id="accounts-receivable-pin" type="password" inputMode="numeric" pattern="[0-9]*" maxLength={4} value={accountsReceivablePin} onChange={(event) => setAccountsReceivablePin(event.target.value)} aria-invalid={Boolean(accountsReceivablePinError)} aria-describedby={accountsReceivablePinError ? "accounts-receivable-pin-error" : undefined} required />
              {accountsReceivablePinError && <p id="accounts-receivable-pin-error" role="alert">{accountsReceivablePinError}</p>}
              <button type="submit" className="btn btn-primary">Unlock report</button>
            </form>
          </section>
      ) : activeView === "byStatus" ? (
        <LeadStatusReport leads={leads} statuses={statuses} />
      ) : activeView === "phoneCheckIn" ? (
        <LeadPhoneCheckIn
          leads={leads}
          classTypes={options.classTypes}
          classInstances={options.classInstances}
          attendanceRecords={attendanceRecords}
          onCheckIn={handlePhoneCheckIn}
          disabled={!user?.uid}
        />
      ) : activeView !== "leads" ? (
        <LeadAccountsReceivableReport view={activeView} leads={leads} classInstances={options.classInstances} attendanceRecords={attendanceRecords} paymentRecords={paymentRecords} onUpdatePayment={handleUpdatePayment} savingAttendanceKey={savingAttendanceKey} />
      ) : (
      <div className={`leads-workspace${selectedProfileLead ? " has-selected-profile" : ""}`}>
      <div className="leads-main">
      {showAddLeadForm && <div className="card mb-4">
        <div className="card-body">
          <form onSubmit={handleAddLead} className="leads-add-form row g-3 align-items-end">
            <div className="col-12">
              <label className="form-label" htmlFor="add-lead-name">Name *</label>
              <input
                id="add-lead-name"
                type="text"
                className="form-control"
                value={form.name}
                onChange={handleFormChange("name")}
                placeholder="Lead name"
                autoComplete="name"
                autoFocus
                disabled={Boolean(duplicatePhoneLead)}
                required
              />
            </div>
            <div className="col-sm-6">
              <label className="form-label" htmlFor="add-lead-phone">Phone</label>
              <input
                id="add-lead-phone"
                type="tel"
                className="form-control"
                value={form.phone}
                onChange={handleFormChange("phone")}
                placeholder="(555)123-4567"
                autoComplete="tel"
                aria-invalid={Boolean(duplicatePhoneLead)}
                aria-describedby={duplicatePhoneLead ? "add-lead-phone-duplicate" : undefined}
              />
            </div>
            {duplicatePhoneLead && <div className="col-12">
              <div id="add-lead-phone-duplicate" className="alert alert-warning mb-0" role="alert">
                <strong>This lead was already created.</strong>
                <div>{duplicatePhoneLead.name || "Unnamed lead"} · {duplicatePhoneLead.phone}</div>
                {duplicatePhoneLead.email && <div>{duplicatePhoneLead.email}</div>}
                <button type="button" className="btn btn-sm btn-outline-secondary mt-2" onClick={() => {
                  setShowAddLeadForm(false);
                  setForm({ ...EMPTY_LEAD_FORM, status: "New", classInstanceIds: [], classInstances: [] });
                  openLeadProfile(duplicatePhoneLead.id);
                }}>View existing profile</button>
              </div>
            </div>}
            <fieldset className="col-12 row g-3 align-items-end border-0 p-0 m-0" disabled={Boolean(duplicatePhoneLead)}>
            <div className="col-sm-6">
              <label className="form-label" htmlFor="add-lead-email">Email</label>
              <input
                id="add-lead-email"
                type="email"
                className="form-control"
                value={form.email}
                onChange={handleFormChange("email")}
                placeholder="email@example.com"
                autoComplete="email"
              />
            </div>
            <div className="col-sm-6 col-md-3">
              <label className="form-label" htmlFor="add-lead-status">Status</label>
              <select id="add-lead-status" className="form-select" value={form.status || "New"} onChange={handleFormChange("status")}>
                {getLeadStatusOptions(statuses).map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
            </div>
            <LeadDetailFields values={form} options={options} onChange={handleFormChange} onCreateOption={handleCreateLeadOption} prefix="add-lead" hideClassInstance />
            <fieldset className="col-12 lead-class-instance-picker">
              <legend>Class instances</legend>
              <p className="small text-muted">Select every class instance this lead attends.</p>
              {availableAddClassInstances.length === 0 ? <p className="small text-muted mb-0">No class instances are available for this class type.</p> : (
                <div className="lead-class-instance-options">
                  {availableAddClassInstances.map((instance) => {
                    const selected = (form.classInstanceIds || []).includes(instance.id);
                    return (
                      <label key={instance.id}>
                        <input type="checkbox" value={instance.id} checked={selected} onChange={(event) => {
                          const currentIds = form.classInstanceIds || [];
                          const nextIds = event.target.checked
                            ? [...new Set([...currentIds, instance.id])]
                            : currentIds.filter((instanceId) => instanceId !== instance.id);
                          handleFormChange("classInstanceIds")({ target: { value: nextIds } });
                        }} />
                        <span>{getClassInstanceLabel(instance)}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </fieldset>
            </fieldset>
            <div className="col-12 d-flex justify-content-end gap-2">
              <button type="button" className="btn btn-outline-secondary" onClick={() => {
                setShowAddLeadForm(false);
                setForm(EMPTY_LEAD_FORM);
              }}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving || Boolean(duplicatePhoneLead)}>
                {saving ? "Adding..." : "Add Lead"}
              </button>
            </div>
          </form>
        </div>
      </div>}

      <div className="row g-2 mb-3">
        <div className="col-12">
          <input
            type="text"
            className="form-control"
            value={searchQuery}
            onChange={(event) => {
              const value = event.target.value;
              const isPhoneSearch = /^[\d\s()+.-]+$/.test(value) && Boolean(normalizeLeadPhone(value));
              setCurrentLeadPage(1);
              setSearchQuery(isPhoneSearch ? formatLeadSearchPhone(value) : value);
            }}
            placeholder="Search leads..."
            aria-label="Search leads"
          />
          <div className="form-check mt-2">
            <input
              id="leads-shared-phone-only"
              type="checkbox"
              className="form-check-input"
              checked={sharedPhoneOnly}
              onChange={(event) => setSharedPhoneOnly(event.target.checked)}
            />
            <label className="form-check-label" htmlFor="leads-shared-phone-only">Only show leads with a shared phone number</label>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-5">
          <div className="spinner-border" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
        </div>
      ) : filteredLeads.length === 0 ? (
        <div className="alert alert-info leads-no-results">
          <span>No leads found.</span>
          {searchQuery.trim() && <button type="button" className="btn btn-sm btn-outline-primary leads-no-results-add" onClick={() => handleOpenAddLeadForm(searchQuery)}>
            Add "{searchQuery.trim()}" as a lead
          </button>}
        </div>
      ) : (
        <div className="list-group">
          {visibleLeads.map((lead) => {
            const statusColor = getStatusColor(lead.status, statuses);
            const assignedClass = options.classInstances.find((instance) => instance.id === lead.classInstanceId && instance.classType === lead.classType) || lead.classInstance;
            return (
              <div key={lead.id} className="list-group-item">
                <div className="d-flex flex-wrap justify-content-between align-items-center gap-2">
                  <div>
                    <div className="lead-list-person">
                      {lead.profileImage?.url ? <img className="lead-list-avatar" src={lead.profileImage.url} alt={`${lead.name || "Lead"} profile`} /> : <span className="lead-list-avatar lead-list-avatar-fallback" aria-hidden="true">{getLeadInitials(lead.name)}</span>}
                      <div className="fw-bold">
                        {lead.followUp && <span className="me-1" style={{ color: followUpColor }} title="Marked for follow-up">★</span>}
                        {lead.name}
                        {duplicatePhoneLeadIds.has(lead.id) && <span className="badge text-bg-warning ms-2" title="This phone number is also used by another profile">Shared phone</span>}
                        {moreDataLeadIds.has(lead.id) && <span className="badge text-bg-success ms-2 lead-list-more-data" title="This profile has more completed information than the other profiles with this phone number">More data</span>}
                      </div>
                    </div>
                    <div className="text-muted small">
                      {lead.phone && <a className="me-3" href={`tel:${lead.phone.replace(/[^\d+]/g, "")}`} aria-label={`Call ${lead.name || "lead"} at ${lead.phone}`}>📞 {lead.phone}</a>}
                      {lead.email && <span>✉️ {lead.email}</span>}
                    </div>
                    <div className="text-muted small" style={{ overflowWrap: "anywhere" }}>
                      {LEAD_DETAIL_LISTS.filter((list) => lead[list.field]).map((list) => (
                        <span className="me-3" key={list.field}>
                          {list.singular.charAt(0).toUpperCase() + list.singular.slice(1)}: {lead[list.field]}
                        </span>
                      ))}
                      {assignedClass && <div>Class: {getClassInstanceLabel(assignedClass)}</div>}
                      <div className="lead-list-created-by">Created by: {lead.createdByName || lead.createdBy || "Unknown"}</div>
                      <button type="button" className="btn btn-sm btn-link p-0" onClick={() => openLeadProfile(lead.id)}>View Profile</button>
                    </div>
                  </div>
                  <div className="ms-md-auto" style={{ maxWidth: "100%" }}>
                    {lead.callbackTime && (
                      <div className="text-md-end fw-semibold mb-2" aria-label="Best callback time">
                        {lead.callbackCompleted ? "Call completed" : "Call back at"} {new Date(`2000-01-01T${lead.callbackTime}`).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                        {lead.callbackCompleted && (
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-secondary ms-2"
                            disabled={Boolean(updatingCallId)}
                            onClick={() => setReschedulingCall({ leadId: lead.id, time: lead.callbackTime })}
                          >
                            Schedule Again
                          </button>
                        )}
                        {lead.callbackCompleted && reschedulingCall?.leadId === lead.id && (
                          <form onSubmit={handleRescheduleCall} className="d-flex flex-wrap align-items-end justify-content-md-end gap-2 mt-2">
                            <div>
                              <label className="form-label" htmlFor={`reschedule-call-${lead.id}`}>New callback time</label>
                              <input
                                id={`reschedule-call-${lead.id}`}
                                type="time"
                                className="form-control"
                                value={reschedulingCall.time}
                                onChange={(event) => setReschedulingCall({ leadId: lead.id, time: event.target.value })}
                                disabled={Boolean(updatingCallId)}
                                required
                              />
                            </div>
                            <button type="submit" className="btn btn-sm btn-success" disabled={Boolean(updatingCallId)}>
                              {updatingCallId === lead.id ? "Saving..." : "Reschedule Call"}
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-secondary"
                              onClick={() => setReschedulingCall(null)}
                              disabled={Boolean(updatingCallId)}
                            >
                              Cancel Reschedule
                            </button>
                          </form>
                        )}
                      </div>
                    )}
                  <div className="d-flex flex-wrap align-items-center justify-content-md-end gap-2">
                    <span
                      className="badge"
                      style={{ backgroundColor: statusColor }}
                    >
                      {lead.status || "No status"}
                    </span>
                    <select
                      className="form-select form-select-sm"
                      style={{ width: "auto" }}
                      value={lead.status || ""}
                      onChange={(event) => handleStatusChange(lead.id, event.target.value)}
                    >
                      {statuses.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </div>
                  </div>
                </div>

              </div>
            );
          })}
        </div>
      )}
      {!loading && totalLeadPages > 1 && (
        <nav className="leads-pagination" aria-label="Leads pagination">
          <span className="small text-muted">Showing {firstVisibleLead}-{lastVisibleLead} of {filteredLeads.length} leads</span>
          <div className="d-flex align-items-center gap-2">
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setCurrentLeadPage((page) => Math.max(1, page - 1))} disabled={activeLeadPage <= 1} aria-label="Previous lead page">Previous</button>
            <span className="small" aria-live="polite">Page {activeLeadPage} of {totalLeadPages}</span>
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setCurrentLeadPage((page) => Math.min(totalLeadPages, page + 1))} disabled={activeLeadPage >= totalLeadPages} aria-label="Next lead page">Next</button>
          </div>
        </nav>
      )}
      </div>
      {selectedProfileLead && (
        <aside className="leads-profile-column" aria-label={`${selectedProfileLead.name || "Lead"} profile`}>
          <LeadProfile
            organizationId={id}
            lead={selectedProfileLead}
            classInstances={options.classInstances}
            attendanceRecords={attendanceRecords}
            paymentRecords={paymentRecords}
            comments={commentsByLead[selectedProfileLead.id] || []}
            commentDraft={commentDrafts[selectedProfileLead.id] || ""}
            formatTimestamp={formatTimestamp}
            onCommentDraftChange={handleCommentDraftChange}
            onAddComment={handleAddComment}
            onDeleteComment={handleDeleteComment}
            onDeleteLead={() => handleDeleteLead(selectedProfileLead.id)}
            onUploadAttachments={handleUploadLeadAttachments}
            onDeleteAttachment={handleDeleteLeadAttachment}
            onUploadProfileImage={handleUploadLeadProfileImage}
            isEditing={editingLeadId === selectedProfileLead.id}
            editForm={editForm}
            options={options}
            saving={saving}
            savingAttendanceKey={savingAttendanceKey}
            savingAttemptKey={savingAttemptKey}
            savingFollowUp={savingFollowUpLeadId === selectedProfileLead.id}
            canEditAttendance={Boolean(user?.uid)}
            onCallAttemptChange={handleCallAttemptChange}
            onStatusChange={handleStatusChange}
            onSaveFollowUp={handleSaveFollowUp}
            onEdit={() => handleStartEditLead(selectedProfileLead)}
            onEditFormChange={handleEditFormChange}
            onCreateOption={handleCreateLeadOption}
            onSave={handleSaveLead}
            onPaymentChoice={handleProfileCouponReceived}
            onAttendanceChange={handleProfileAttendanceChange}
            onRecordPayment={handleRecordFullPayment}
            onUpdatePayment={handleUpdatePayment}
            onDeletePayment={handleDeletePayment}
            onCancelEdit={handleCancelEditLead}
            onClose={closeLeadProfile}
          />
        </aside>
      )}
      {!selectedProfileLead && <aside className="leads-calls-sidebar" aria-labelledby="upcoming-calls-heading">
        <h3 id="upcoming-calls-heading" className="h5 mb-3">Upcoming Calls</h3>
        {loading ? (
          <p className="text-muted">Loading calls...</p>
        ) : upcomingCalls.length === 0 ? (
          <p className="text-muted">No upcoming calls.</p>
        ) : (
          <ol className="leads-call-list">
            {upcomingCalls.map(({ lead, callAt }, index) => (
              <li key={lead.id} className={`leads-call-item ${index === 0 ? "leads-call-next" : ""}`}>
                <div className="d-flex justify-content-between align-items-center gap-2 mb-2">
                  <span className="small text-muted">{index === 0 ? "Next Call" : "Call Back"}</span>
                  <span className="small">{callAt.toDateString() === callClock.toDateString() ? "Today" : "Tomorrow"}</span>
                </div>
                <time className="d-block fw-bold mb-1" dateTime={callAt.toISOString()}>
                  {callAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                </time>
                <div className="fw-semibold mb-1">{lead.name}</div>
                {lead.phone ? (
                  <a className="leads-call-phone" href={`tel:${lead.phone.replace(/[^\d+]/g, "")}`}>
                    <FaPhoneAlt aria-hidden="true" /> {lead.phone}
                  </a>
                ) : (
                  <span className="text-muted small">No phone number</span>
                )}
                <button
                  type="button"
                  className="btn btn-sm btn-outline-success d-flex align-items-center gap-2 mt-3"
                  disabled={Boolean(updatingCallId)}
                  onClick={() => handleCallCompletion(lead.id, true)}
                  aria-label={`Mark call to ${lead.name} complete`}
                >
                  <FaCheck aria-hidden="true" />
                  {updatingCallId === lead.id ? "Saving..." : "Mark Complete"}
                </button>
              </li>
            ))}
          </ol>
        )}
      </aside>}
      </div>
      )}
      </div>
    </div>
  );
};

export default LeadsPage;
