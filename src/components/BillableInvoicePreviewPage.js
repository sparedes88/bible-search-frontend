import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import * as XLSX from "xlsx";
import * as html2pdfLib from "html2pdf.js";
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";
import { toast } from "react-toastify";
import commonStyles from "../pages/commonStyles";
import { getChurchData } from "../api/church";
import { db } from "../firebase";
import { useAuth } from "../contexts/AuthContext";

const SECTION_DEFS = [
  { key: "companyHeader", label: "Company Header & Client" },
  { key: "invoiceInfo", label: "Invoice Details" },
  { key: "summary", label: "Billable Summary by Person" },
  { key: "workSummary", label: "Work Summary per User" },
  { key: "issuesNotes", label: "Issues and Notes" },
];

const DEFAULT_SECTION_VISIBILITY = SECTION_DEFS.reduce((acc, section) => {
  acc[section.key] = section.key !== "issuesNotes" && section.key !== "workSummary";
  return acc;
}, {});

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
  border: "1px solid #E2E8F0",
  borderRadius: "0px",
  padding: "16px",
};

const sectionHeadingStyle = {
  marginTop: 0,
  marginBottom: "14px",
  fontSize: "1.05rem",
  fontWeight: 700,
  color: "#0F172A",
  letterSpacing: "0.01em",
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

// Formats decimal hours as H:MM (60-minute clock format) instead of a decimal fraction.
const formatHoursClock = (value) => {
  const totalMinutes = Math.round((Number(value) || 0) * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}`;
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

const formatWorkDateRange = (firstUsedAt, lastUsedAt) => {
  const firstDate = Number(firstUsedAt) > 0 ? new Date(Number(firstUsedAt)) : null;
  const lastDate = Number(lastUsedAt) > 0 ? new Date(Number(lastUsedAt)) : null;
  if (!firstDate || Number.isNaN(firstDate.getTime())) return "-";

  const formatDate = (date) => new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
  const firstLabel = formatDate(firstDate);
  const lastLabel = lastDate && !Number.isNaN(lastDate.getTime()) ? formatDate(lastDate) : firstLabel;
  return firstLabel === lastLabel ? firstLabel : `${firstLabel} - ${lastLabel}`;
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

const FIREBASE_FUNCTIONS_BASE_URL =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "/firebase-api"
    : "https://us-central1-igletechv1.cloudfunctions.net";

const blobToDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

// Some user docs only have "name" (first name) + "lastName", no separate "firstName" field.
const resolveMemberDisplayName = (data = {}) => {
  const firstNameValue = String(data.firstName || data.name || "").trim();
  const lastNameValue = String(data.lastName || "").trim();
  const nameAlreadyIncludesLastName = lastNameValue && firstNameValue.toLowerCase().includes(lastNameValue.toLowerCase());
  const firstAndLastName = nameAlreadyIncludesLastName
    ? firstNameValue
    : [firstNameValue, lastNameValue].filter(Boolean).join(" ");

  return String(firstAndLastName || data.displayName || data.email || "").trim();
};

// Collapses name variants that are just a first-name-only version of a fuller name
// (e.g. "Salomon" vs "Salomon Paredes") down to the fuller name, so the same person
// never shows twice in a selection list.
const mergeNameVariants = (names) => {
  const uniqueNames = Array.from(new Set(names.filter(Boolean).map((name) => name.trim())));
  const longestByFirstWord = new Map();

  uniqueNames.forEach((name) => {
    const firstWord = name.split(/\s+/)[0].toLowerCase();
    const current = longestByFirstWord.get(firstWord);
    if (!current || name.length > current.length) longestByFirstWord.set(firstWord, name);
  });

  const merged = new Set();
  uniqueNames.forEach((name) => {
    const isSingleWord = !name.includes(" ");
    const firstWord = name.split(/\s+/)[0].toLowerCase();
    const longestMatch = longestByFirstWord.get(firstWord);
    merged.add(isSingleWord && longestMatch && longestMatch !== name ? longestMatch : name);
  });

  return Array.from(merged).sort((left, right) => left.localeCompare(right));
};

const BillableInvoicePreviewPage = () => {
  const { id } = useParams();
  const location = useLocation();
  const { user } = useAuth();
  const pdfContentRef = useRef(null);
  const [companyBranding, setCompanyBranding] = useState({ name: "", logo: "" });
  const [logoDataUrl, setLogoDataUrl] = useState("");
  const [logoStatus, setLogoStatus] = useState("idle"); // idle | loading | ready | unavailable
  const [sectionVisibility, setSectionVisibility] = useState(DEFAULT_SECTION_VISIBILITY);

  useEffect(() => {
    let isMounted = true;

    const loadCompanyBranding = async () => {
      if (!id) return;
      const churchData = await getChurchData(id);
      if (!isMounted || !churchData) return;

      setCompanyBranding({
        name: churchData.name || churchData.churchName || "",
        logo: churchData.logo || "",
      });
    };

    loadCompanyBranding();

    return () => {
      isMounted = false;
    };
  }, [id]);

  // Loads every org member (any role, including global admins) so the "Add Person Time" form
  // can suggest people even if they haven't logged hours on this invoice yet.
  const [organizationMembers, setOrganizationMembers] = useState([]);

  useEffect(() => {
    if (!id) {
      setOrganizationMembers([]);
      return () => {};
    }

    const usersRef = collection(db, "users");
    const numericId = Number(id);
    const organizationIds = [id, Number.isFinite(numericId) ? numericId : null].filter(
      (value, index, values) => value !== null && values.indexOf(value) === index
    );
    const userQueries = organizationIds.flatMap((organizationId) => [
      query(usersRef, where("churchId", "==", organizationId)),
      query(usersRef, where("churchID", "==", organizationId)),
      query(usersRef, where("organizationId", "==", organizationId)),
    ]);
    const userQueryDocs = userQueries.map(() => []);

    const buildMembersFromSnapshots = () => {
      const mergedDocs = userQueryDocs.flat();
      const nextMembersById = new Map();

      mergedDocs.forEach((snapshotDoc) => {
        const data = snapshotDoc.data() || {};
        const fullName = resolveMemberDisplayName(data) || snapshotDoc.id;
        if (!fullName) return;
        nextMembersById.set(snapshotDoc.id, {
          id: snapshotDoc.id,
          label: fullName,
          email: String(data.email || "").trim(),
        });
      });

      setOrganizationMembers(
        Array.from(nextMembersById.values()).sort((left, right) => left.label.localeCompare(right.label))
      );
    };
    const unsubscribers = userQueries.map((userQuery, queryIndex) => onSnapshot(userQuery, (snapshot) => {
      userQueryDocs[queryIndex] = snapshot.docs;
      buildMembersFromSnapshots();
    }));

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [id]);

  // Loads all BIM project TD cards so the "Add Person Time" form can offer a TD/Issue ID dropdown
  // instead of free text, same source used by Pay Everyone's edit-time card picker.
  const [cardOptions, setCardOptions] = useState([]);
  const [cardOptionsLoading, setCardOptionsLoading] = useState(false);

  useEffect(() => {
    if (!id) {
      setCardOptions([]);
      return () => {};
    }

    let isCancelled = false;

    const findColumnByAliases = (rowData, aliases) => {
      const normalizedAliases = aliases.map((alias) => alias.toLowerCase().replace(/[^a-z0-9]+/g, ""));
      return Object.keys(rowData || {}).find((key) =>
        normalizedAliases.includes(key.toLowerCase().replace(/[^a-z0-9]+/g, ""))
      );
    };

    const loadCardOptions = async () => {
      setCardOptionsLoading(true);
      try {
        const projectsSnapshot = await getDocs(collection(db, "churches", id, "bimProjects"));
        const nextOptions = [];

        for (const projectDoc of projectsSnapshot.docs) {
          const projectData = projectDoc.data() || {};
          const issuesSnapshot = await getDocs(collection(db, "churches", id, "bimProjects", projectDoc.id, "issues"));

          issuesSnapshot.docs.forEach((issueDoc, rowIndex) => {
            const rowData = issueDoc.data() || {};
            const issueIdColumn = findColumnByAliases(rowData, ["issue id", "id", "task id", "card id", "row id"]);
            const titleColumn = findColumnByAliases(rowData, ["title", "issue title", "task title", "name"]);
            const projectNameColumn = findColumnByAliases(rowData, ["project name", "project", "projectname"]);

            const issueId = String((issueIdColumn ? rowData[issueIdColumn] : "") || rowIndex + 1).trim();
            const projectName = String(
              (projectNameColumn ? rowData[projectNameColumn] : "")
              || projectData.projectName
              || projectData.name
              || ""
            ).trim();
            const issueLabel = String((titleColumn ? rowData[titleColumn] : "") || "").trim();

            nextOptions.push({ issueId, projectName, issueLabel });
          });
        }

        // A card id can repeat across projects, so keep issue id + project name unique together.
        const uniqueOptions = [];
        const seenKeys = new Set();
        nextOptions.forEach((option) => {
          const uniqueKey = `${option.issueId.toLowerCase()}||${option.projectName.toLowerCase()}`;
          if (seenKeys.has(uniqueKey) || !option.issueId) return;
          seenKeys.add(uniqueKey);
          uniqueOptions.push({ ...option, value: uniqueKey });
        });

        uniqueOptions.sort((left, right) =>
          left.projectName.localeCompare(right.projectName) || left.issueId.localeCompare(right.issueId, undefined, { numeric: true })
        );

        if (!isCancelled) setCardOptions(uniqueOptions);
      } catch (error) {
        console.error("Error loading TD card options:", error);
        if (!isCancelled) setCardOptions([]);
      } finally {
        if (!isCancelled) setCardOptionsLoading(false);
      }
    };

    loadCardOptions();

    return () => {
      isCancelled = true;
    };
  }, [id]);

  // Inlines the logo as a data URL so html2canvas can always render it, regardless of CORS on the remote asset.
  // Tries a direct browser fetch first (works for hosts that already send permissive CORS headers,
  // e.g. Firebase Storage), then falls back to a server-side proxy Cloud Function for hosts that don't
  // (e.g. the e2api image server), since server-to-server requests aren't subject to browser CORS rules.
  useEffect(() => {
    let isMounted = true;
    const logoUrl = companyBranding.logo;

    const convertLogoToDataUrl = async () => {
      if (!logoUrl) {
        if (isMounted) {
          setLogoDataUrl("");
          setLogoStatus("unavailable");
        }
        return;
      }

      if (isMounted) setLogoStatus("loading");

      try {
        const response = await fetch(logoUrl, { mode: "cors" });
        if (!response.ok) throw new Error(`Logo fetch failed with status ${response.status}`);
        const blob = await response.blob();
        const dataUrl = await blobToDataUrl(blob);
        if (isMounted) {
          setLogoDataUrl(dataUrl);
          setLogoStatus("ready");
        }
        return;
      } catch (directFetchError) {
        console.warn("Direct logo fetch blocked (likely CORS), falling back to server proxy:", directFetchError);
      }

      try {
        const proxyUrl = `${FIREBASE_FUNCTIONS_BASE_URL}/fetchRemoteImageAsDataUrl?url=${encodeURIComponent(logoUrl)}`;
        const proxyResponse = await fetch(proxyUrl);
        if (!proxyResponse.ok) throw new Error(`Logo proxy failed with status ${proxyResponse.status}`);
        const proxyPayload = await proxyResponse.json();
        if (!proxyPayload?.dataUrl) throw new Error("Logo proxy returned no data");

        if (isMounted) {
          setLogoDataUrl(proxyPayload.dataUrl);
          setLogoStatus("ready");
        }
      } catch (proxyError) {
        console.warn("Could not inline invoice logo via proxy, PDF export will show a placeholder box:", proxyError);
        if (isMounted) {
          setLogoDataUrl("");
          setLogoStatus("unavailable");
        }
      }
    };

    convertLogoToDataUrl();

    return () => {
      isMounted = false;
    };
  }, [companyBranding.logo]);

  const toggleSectionVisibility = (sectionKey) => {
    setSectionVisibility((previous) => ({
      ...previous,
      [sectionKey]: !previous[sectionKey],
    }));
  };

  const [noteRowOverrides, setNoteRowOverrides] = useState({});
  const [editingNoteRowKey, setEditingNoteRowKey] = useState(null);

  const getNoteRowKey = (userIndex, rowIndex) => `${userIndex}:${rowIndex}`;

  const toggleNoteRowHidden = (rowKey) => {
    setNoteRowOverrides((previous) => ({
      ...previous,
      [rowKey]: { ...previous[rowKey], hidden: !previous[rowKey]?.hidden },
    }));
    setEditingNoteRowKey((previous) => (previous === rowKey ? null : previous));
  };

  const updateNoteRowText = (rowKey, noteText) => {
    setNoteRowOverrides((previous) => ({
      ...previous,
      [rowKey]: { ...previous[rowKey], noteText },
    }));
  };

  // Resolves a note's displayed/exported text after applying any hide or edit override for that row.
  const getEffectiveNoteText = (userIndex, rowIndex, originalText) => {
    const override = noteRowOverrides[getNoteRowKey(userIndex, rowIndex)];
    if (!override) return originalText;
    if (override.hidden) return "";
    return typeof override.noteText === "string" ? override.noteText : originalText;
  };

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

  const invoiceDocRef = useMemo(() => {
    if (!id || !draftPayload?.projectId || !draftPayload?.invoiceId) return null;
    return doc(db, "churches", id, "invoiceProjects", draftPayload.projectId, "invoices", draftPayload.invoiceId);
  }, [id, draftPayload?.projectId, draftPayload?.invoiceId]);

  const projectDocRef = useMemo(() => {
    if (!id || !draftPayload?.projectId) return null;
    return doc(db, "churches", id, "invoiceProjects", draftPayload.projectId);
  }, [id, draftPayload?.projectId]);

  const [billTo, setBillTo] = useState(null);
  const [billToClients, setBillToClients] = useState([]);
  const [isEditingBillTo, setIsEditingBillTo] = useState(false);
  const [billToDraftMode, setBillToDraftMode] = useState("new");
  const [billToDraftClientId, setBillToDraftClientId] = useState("");
  const [billToDraftFullName, setBillToDraftFullName] = useState("");
  const [billToDraftAddress, setBillToDraftAddress] = useState("");
  const [isSavingBillTo, setIsSavingBillTo] = useState(false);

  // Loads the Bill To saved on this project so it persists across every invoice for that project.
  useEffect(() => {
    let isMounted = true;

    const loadProjectBillTo = async () => {
      if (!projectDocRef) return;
      try {
        const projectSnap = await getDoc(projectDocRef);
        const savedBillTo = projectSnap.data()?.billTo;
        if (isMounted && savedBillTo && typeof savedBillTo === "object") {
          setBillTo(savedBillTo);
        }
      } catch (error) {
        console.error("Failed to load saved Bill To for this project:", error);
      }
    };

    loadProjectBillTo();

    return () => {
      isMounted = false;
    };
  }, [projectDocRef]);

  // Loads reusable Bill To contacts already created for other projects in this organization.
  useEffect(() => {
    let isMounted = true;

    const loadBillToClients = async () => {
      if (!id) return;
      try {
        const clientsSnapshot = await getDocs(collection(db, "churches", id, "billToClients"));
        const nextClients = clientsSnapshot.docs.map((clientDoc) => ({ id: clientDoc.id, ...clientDoc.data() }));
        if (isMounted) setBillToClients(nextClients);
      } catch (error) {
        console.error("Failed to load Bill To contacts:", error);
      }
    };

    loadBillToClients();

    return () => {
      isMounted = false;
    };
  }, [id]);

  const openBillToEditor = () => {
    setBillToDraftMode(billToClients.length > 0 ? "existing" : "new");
    setBillToDraftClientId(billTo?.clientId || "");
    setBillToDraftFullName(billTo?.fullName || "");
    setBillToDraftAddress(billTo?.address || "");
    setIsEditingBillTo(true);
  };

  const handleSelectExistingBillToClient = (clientId) => {
    setBillToDraftClientId(clientId);
    const matchedClient = billToClients.find((client) => client.id === clientId);
    if (matchedClient) {
      setBillToDraftFullName(matchedClient.fullName || "");
      setBillToDraftAddress(matchedClient.address || "");
    }
  };

  const handleSaveBillTo = async () => {
    if (!projectDocRef) {
      toast.error("This invoice preview cannot be saved to Firebase (missing project reference). Regenerate it from Invoices.");
      return;
    }

    const fullName = billToDraftFullName.trim();
    if (!fullName) {
      toast.error("Full Name is required.");
      return;
    }

    const address = billToDraftAddress.trim();

    setIsSavingBillTo(true);
    try {
      let clientId = billToDraftMode === "existing" ? billToDraftClientId : "";

      if (billToDraftMode === "new" || !clientId) {
        const created = await addDoc(collection(db, "churches", id, "billToClients"), {
          fullName,
          address,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        clientId = created.id;
        setBillToClients((previous) => [...previous, { id: clientId, fullName, address }]);
      } else {
        await updateDoc(doc(db, "churches", id, "billToClients", clientId), {
          fullName,
          address,
          updatedAt: serverTimestamp(),
        });
        setBillToClients((previous) =>
          previous.map((client) => (client.id === clientId ? { ...client, fullName, address } : client))
        );
      }

      const nextBillTo = { clientId, fullName, address };
      await updateDoc(projectDocRef, {
        billTo: nextBillTo,
        billToUpdatedAt: serverTimestamp(),
      });

      setBillTo(nextBillTo);
      setIsEditingBillTo(false);
      toast.success("Bill To saved for this project.");
    } catch (error) {
      console.error("Failed to save Bill To:", error);
      toast.error("Failed to save Bill To.");
    } finally {
      setIsSavingBillTo(false);
    }
  };

  const [companyInfo, setCompanyInfo] = useState(null);
  const [isEditingCompanyInfo, setIsEditingCompanyInfo] = useState(false);
  const [companyInfoDraftFullName, setCompanyInfoDraftFullName] = useState("");
  const [companyInfoDraftAddress, setCompanyInfoDraftAddress] = useState("");
  const [isSavingCompanyInfo, setIsSavingCompanyInfo] = useState(false);

  const companyInfoDocRef = useMemo(() => {
    if (!id) return null;
    return doc(db, "churches", id, "invoiceSettings", "companyInfo");
  }, [id]);

  // Loads the org's saved invoice company info (full name + address) shown below the logo.
  useEffect(() => {
    let isMounted = true;

    const loadCompanyInfo = async () => {
      if (!companyInfoDocRef) return;
      try {
        const companyInfoSnap = await getDoc(companyInfoDocRef);
        const savedCompanyInfo = companyInfoSnap.data();
        if (isMounted && savedCompanyInfo) {
          setCompanyInfo({ fullName: savedCompanyInfo.fullName || "", address: savedCompanyInfo.address || "" });
        }
      } catch (error) {
        console.error("Failed to load saved company info:", error);
      }
    };

    loadCompanyInfo();

    return () => {
      isMounted = false;
    };
  }, [companyInfoDocRef]);

  const openCompanyInfoEditor = () => {
    setCompanyInfoDraftFullName(companyInfo?.fullName || companyBranding.name || "");
    setCompanyInfoDraftAddress(companyInfo?.address || "");
    setIsEditingCompanyInfo(true);
  };

  const handleSaveCompanyInfo = async () => {
    if (!companyInfoDocRef) {
      toast.error("This invoice preview cannot be saved to Firebase (missing organization reference).");
      return;
    }

    const fullName = companyInfoDraftFullName.trim();
    if (!fullName) {
      toast.error("Full Name is required.");
      return;
    }

    const address = companyInfoDraftAddress.trim();

    setIsSavingCompanyInfo(true);
    try {
      await setDoc(companyInfoDocRef, {
        fullName,
        address,
        updatedAt: serverTimestamp(),
      }, { merge: true });

      setCompanyInfo({ fullName, address });
      setIsEditingCompanyInfo(false);
      toast.success("Company information saved.");
    } catch (error) {
      console.error("Failed to save company info:", error);
      toast.error("Failed to save company information.");
    } finally {
      setIsSavingCompanyInfo(false);
    }
  };

  const [isSavingNoteOverrides, setIsSavingNoteOverrides] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [documentType, setDocumentType] = useState("invoice");
  const [showDocumentTotals, setShowDocumentTotals] = useState(true);
  const [documentInfoVisibility, setDocumentInfoVisibility] = useState({
    week: true,
    period: true,
    dueDate: true,
    terms: true,
    dateOfWork: false,
    overtimePolicy: true,
  });
  const [isSavingDocumentSettings, setIsSavingDocumentSettings] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const loadSavedNoteOverrides = async () => {
      if (!invoiceDocRef) return;

      try {
        const invoiceSnap = await getDoc(invoiceDocRef);
        const savedOverrides = invoiceSnap.data()?.billableNoteOverrides;
        if (isMounted && savedOverrides && typeof savedOverrides === "object") {
          setNoteRowOverrides(savedOverrides);
        }
      } catch (error) {
        console.error("Failed to load saved note overrides:", error);
      }
    };

    loadSavedNoteOverrides();

    return () => {
      isMounted = false;
    };
  }, [invoiceDocRef]);

  useEffect(() => {
    let isMounted = true;

    const loadDocumentSettings = async () => {
      if (!invoiceDocRef) return;

      try {
        const invoiceSnap = await getDoc(invoiceDocRef);
        const settings = invoiceSnap.data()?.billableDocumentSettings || {};
        if (!isMounted) return;
        setDocumentType(["invoice", "work_order", "change_order"].includes(settings.documentType)
          ? settings.documentType
          : "invoice");
        setShowDocumentTotals(settings.showTotals !== false);
        setDocumentInfoVisibility((previous) => ({ ...previous, ...(settings.infoVisibility || {}) }));
      } catch (error) {
        console.error("Failed to load billable document settings:", error);
      }
    };

    loadDocumentSettings();

    return () => {
      isMounted = false;
    };
  }, [invoiceDocRef]);

  const handleDocumentSettingsChange = async (nextDocumentType, nextShowTotals, nextInfoVisibility = documentInfoVisibility) => {
    setDocumentType(nextDocumentType);
    setShowDocumentTotals(nextShowTotals);
    setDocumentInfoVisibility(nextInfoVisibility);
    if (!invoiceDocRef) return;

    setIsSavingDocumentSettings(true);
    try {
      await updateDoc(invoiceDocRef, {
        billableDocumentSettings: {
          documentType: nextDocumentType,
          showTotals: nextShowTotals,
          infoVisibility: nextInfoVisibility,
        },
        billableDocumentSettingsUpdatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error("Failed to save billable document settings:", error);
      toast.error("Failed to save document settings.");
    } finally {
      setIsSavingDocumentSettings(false);
    }
  };

  const handleSaveNoteOverrides = async () => {
    if (!invoiceDocRef) {
      toast.error("This invoice preview cannot be saved to Firebase (missing invoice reference). Regenerate it from Invoices.");
      return;
    }

    setIsSavingNoteOverrides(true);
    try {
      await updateDoc(invoiceDocRef, {
        billableNoteOverrides: noteRowOverrides,
        billableNoteOverridesUpdatedAt: serverTimestamp(),
      });
      toast.success("Note changes saved.");
    } catch (error) {
      console.error("Failed to save note overrides:", error);
      toast.error("Failed to save note changes.");
    } finally {
      setIsSavingNoteOverrides(false);
    }
  };

  const [manualTimeEntries, setManualTimeEntries] = useState([]);
  const [isAddingManualEntry, setIsAddingManualEntry] = useState(false);
  const [manualCardMode, setManualCardMode] = useState(false);
  const [manualProjectMode, setManualProjectMode] = useState(false);
  const [editingManualEntryId, setEditingManualEntryId] = useState("");
  const [manualEntryDraft, setManualEntryDraft] = useState({
    personName: "",
    projectName: "",
    issueId: "",
    cardValue: "",
    cardTitle: "",
    date: "",
    startTime: "",
    endTime: "",
  });
  const [isSavingManualEntry, setIsSavingManualEntry] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const loadSavedManualTimeEntries = async () => {
      if (!invoiceDocRef) return;

      try {
        const invoiceSnap = await getDoc(invoiceDocRef);
        const savedEntries = invoiceSnap.data()?.billableManualTimeEntries;
        if (isMounted && Array.isArray(savedEntries)) {
          setManualTimeEntries(savedEntries);
        }
      } catch (error) {
        console.error("Failed to load saved manual time entries:", error);
      }
    };

    loadSavedManualTimeEntries();

    return () => {
      isMounted = false;
    };
  }, [invoiceDocRef]);

  const persistManualTimeEntries = async (nextEntries) => {
    setManualTimeEntries(nextEntries);
    if (!invoiceDocRef) return;

    setIsSavingManualEntry(true);
    try {
      await updateDoc(invoiceDocRef, {
        billableManualTimeEntries: nextEntries,
        billableManualTimeEntriesUpdatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error("Failed to save manual time entries:", error);
      toast.error("Failed to save the added time entry.");
    } finally {
      setIsSavingManualEntry(false);
    }
  };

  const getManualEntryHours = (entry) => {
    if (!entry?.date || !entry?.startTime || !entry?.endTime) return 0;
    const startMs = new Date(`${entry.date}T${entry.startTime}`).getTime();
    const endMs = new Date(`${entry.date}T${entry.endTime}`).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 0;
    return (endMs - startMs) / (1000 * 60 * 60);
  };

  // Resolves the actual org member behind a typed/selected name so the real Time Rotate log
  // we create carries a userId/email, matching Pay Everyone's identity resolution.
  const resolveIdentityForPersonName = (personName) => {
    const normalized = String(personName || "").trim().toLowerCase();
    if (!normalized) return { userId: "", userEmail: "" };

    const currentUserLabel = resolveMemberDisplayName(user || {}).toLowerCase();
    if (currentUserLabel && currentUserLabel === normalized) {
      return { userId: user?.uid || "", userEmail: user?.email || "" };
    }

    const matchedMember = organizationMembers.find((member) => member.label.toLowerCase() === normalized);
    if (matchedMember) return { userId: matchedMember.id, userEmail: matchedMember.email };

    return { userId: "", userEmail: "" };
  };

  const openAddManualEntryForm = () => {
    setEditingManualEntryId("");
    setManualEntryDraft({
      personName: "",
      projectName: draftPayload?.projectName || "",
      issueId: "",
      cardValue: "",
      cardTitle: "",
      date: "",
      startTime: "",
      endTime: "",
    });
    setManualCardMode(false);
    setManualProjectMode(false);
    setIsAddingManualEntry(true);
  };

  const openEditManualEntryForm = (entry) => {
    const matchingCard = cardOptions.find((option) =>
      option.issueId.toLowerCase() === String(entry.issueId || "").trim().toLowerCase()
      && option.projectName.toLowerCase() === String(entry.projectName || "").trim().toLowerCase()
    );

    setEditingManualEntryId(entry.id);
    setManualEntryDraft({
      personName: entry.personName || "",
      projectName: entry.projectName || "",
      issueId: entry.issueId || "",
      cardValue: matchingCard?.value || "",
      cardTitle: entry.cardTitle || "",
      date: entry.date || "",
      startTime: entry.startTime || "",
      endTime: entry.endTime || "",
    });
    setManualCardMode(Boolean(entry.issueId) && !matchingCard);
    setManualProjectMode(false);
    setIsAddingManualEntry(true);
  };

  const handleAddManualTimeEntry = async () => {
    const personName = String(manualEntryDraft.personName || "").trim();
    const hours = getManualEntryHours(manualEntryDraft);

    if (!personName) {
      toast.error("Select a person.");
      return;
    }

    if (!personNameOptions.some((option) => option.toLowerCase() === personName.toLowerCase())) {
      toast.error("Select a person from the list so their hours match the correct user.");
      return;
    }

    if (hours <= 0) {
      toast.error("Enter a valid date with an end time after the start time.");
      return;
    }

    const entryFields = {
      personName,
      projectName: String(manualEntryDraft.projectName || "").trim(),
      issueId: String(manualEntryDraft.issueId || "").trim(),
      cardTitle: String(manualEntryDraft.cardTitle || "").trim(),
      date: manualEntryDraft.date,
      startTime: manualEntryDraft.startTime,
      endTime: manualEntryDraft.endTime,
      // Tracks when this entry's real Time Rotate log was (re)written, so we can tell whether a
      // regenerated invoice draft already includes these hours and avoid double-counting them.
      syncedAt: Date.now(),
    };

    const startedAt = new Date(`${entryFields.date}T${entryFields.startTime}`).getTime();
    const endedAt = new Date(`${entryFields.date}T${entryFields.endTime}`).getTime();
    const identity = resolveIdentityForPersonName(personName);
    // Use whatever raw name this person's real Time Rotate logs already use most (if any),
    // so the new entry shows up as the same person there instead of a differently-named one.
    const registeredByName = preferredRegisteredByByCanonicalName[personName.toLowerCase()] || personName;
    const timeRotateLogPayload = {
      issueId: entryFields.issueId,
      issueLabel: entryFields.cardTitle,
      issueTitle: entryFields.cardTitle,
      projectName: entryFields.projectName,
      userId: identity.userId,
      userEmail: identity.userEmail,
      registeredBy: registeredByName,
      startedAt,
      endedAt,
      durationMs: endedAt - startedAt,
      logType: "manual",
      requiresSaveConfirmation: false,
      createdViaBillableInvoice: true,
    };

    const existingEntry = editingManualEntryId
      ? manualTimeEntries.find((entry) => entry.id === editingManualEntryId)
      : null;

    try {
      if (existingEntry?.timeRotateLogId) {
        await updateDoc(doc(db, "churches", id, "timeRotateLogs", existingEntry.timeRotateLogId), timeRotateLogPayload);
        entryFields.timeRotateLogId = existingEntry.timeRotateLogId;
      } else {
        const createdLogRef = await addDoc(collection(db, "churches", id, "timeRotateLogs"), timeRotateLogPayload);
        entryFields.timeRotateLogId = createdLogRef.id;
      }
    } catch (error) {
      console.error("Failed to register manual time entry in Time Rotate:", error);
      toast.error("Saved to the invoice, but failed to register this time in Pay Everyone.");
    }

    if (editingManualEntryId) {
      await persistManualTimeEntries(
        manualTimeEntries.map((entry) => (entry.id === editingManualEntryId ? { ...entry, ...entryFields } : entry))
      );
      setEditingManualEntryId("");
      setIsAddingManualEntry(false);
      toast.success(`Updated ${hours.toFixed(2)} hrs for ${personName}.`);
      return;
    }

    const nextEntry = {
      id: `manual-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      ...entryFields,
    };

    await persistManualTimeEntries([...manualTimeEntries, nextEntry]);
    setIsAddingManualEntry(false);
    toast.success(`Added ${hours.toFixed(2)} hrs for ${personName}.`);
  };

  const handleRemoveManualTimeEntry = async (entryId) => {
    const entryToRemove = manualTimeEntries.find((entry) => entry.id === entryId);
    if (entryToRemove?.timeRotateLogId) {
      try {
        await deleteDoc(doc(db, "churches", id, "timeRotateLogs", entryToRemove.timeRotateLogId));
      } catch (error) {
        console.error("Failed to remove the linked Time Rotate log:", error);
      }
    }

    await persistManualTimeEntries(manualTimeEntries.filter((entry) => entry.id !== entryId));
    if (editingManualEntryId === entryId) {
      setEditingManualEntryId("");
      setIsAddingManualEntry(false);
    }
  };

  // Merges manually added time on top of the invoice's original per-person hours, re-splitting
  // regular/overtime using the same weekly threshold and rate so totals stay consistent.
  const effectiveUsers = useMemo(() => {
    if (!draftPayload) return [];

    const overtimeThresholdHoursValue = Number(draftPayload.overtimePolicy?.thresholdHours || DEFAULT_OVERTIME_THRESHOLD_HOURS);
    const overtimeMultiplierValue = Number(draftPayload.overtimePolicy?.overtimeMultiplier || DEFAULT_OVERTIME_MULTIPLIER);
    const baseRate = Number(draftPayload.overtimePolicy?.baseRate) || 0;

    const usersByKey = new Map();
    const baseUsers = Array.isArray(draftPayload.users) ? draftPayload.users : [];

    // Safety net for invoices generated before names were consistently resolved: if one person's
    // name is just the first word of another person's full name (e.g. "Salomon" vs "Salomon
    // Paredes"), treat them as the same person and merge their hours under the fuller name.
    const canonicalNameByShortName = new Map();
    const sortedByNameLength = [...baseUsers].sort((left, right) =>
      String(right.name || "").trim().length - String(left.name || "").trim().length
    );
    sortedByNameLength.forEach((userEntry) => {
      const fullName = String(userEntry.name || "").trim();
      if (!fullName) return;
      const firstWord = fullName.split(/\s+/)[0].toLowerCase();
      if (firstWord && !canonicalNameByShortName.has(firstWord)) {
        canonicalNameByShortName.set(firstWord, fullName);
      }
    });

    baseUsers.forEach((userEntry) => {
      const fullName = String(userEntry.name || "").trim();
      const normalizedFullName = fullName.toLowerCase();
      const isSingleWordName = fullName && !fullName.includes(" ");
      const canonicalName = isSingleWordName ? canonicalNameByShortName.get(normalizedFullName) : null;
      const resolvedName = (canonicalName && canonicalName.toLowerCase() !== normalizedFullName) ? canonicalName : fullName;
      const key = resolvedName.toLowerCase();
      if (!key) return;

      const existing = usersByKey.get(key);
      if (!existing) {
        usersByKey.set(key, {
          ...userEntry,
          name: resolvedName,
          cards: Array.isArray(userEntry.cards) ? [...userEntry.cards] : [],
          notes: Array.isArray(userEntry.notes) ? [...userEntry.notes] : [],
          baseTotalHours: Number(userEntry.totalHours || 0),
          baseRegularHours: Number(userEntry.regularHours || 0),
          baseOvertimeHours: Number(userEntry.overtimeHours || 0),
          manualHours: 0,
        });
        return;
      }

      // Merge a short-name duplicate into the already-registered full-name entry.
      existing.cards.push(...(Array.isArray(userEntry.cards) ? userEntry.cards : []));
      existing.notes.push(...(Array.isArray(userEntry.notes) ? userEntry.notes : []));
      existing.baseTotalHours += Number(userEntry.totalHours || 0);
      existing.baseRegularHours += Number(userEntry.regularHours || 0);
      existing.baseOvertimeHours += Number(userEntry.overtimeHours || 0);
    });

    const draftGeneratedAt = Number(draftPayload.generatedAt || 0);

    manualTimeEntries.forEach((entry) => {
      const hours = getManualEntryHours(entry);
      if (hours <= 0) return;

      // Once an entry's real Time Rotate log was written before this draft was generated, its
      // hours and card are already included in baseUsers via the normal aggregation — adding
      // them again here would double-count. Entries synced before this fix have no syncedAt
      // recorded, so treat that as "long ago" rather than skip the check entirely.
      const alreadyReflectedInDraft = Boolean(entry.timeRotateLogId)
        && draftGeneratedAt > 0
        && Number(entry.syncedAt || 1) <= draftGeneratedAt;
      if (alreadyReflectedInDraft) return;

      const key = String(entry.personName || "").trim().toLowerCase();
      if (!key) return;

      if (!usersByKey.has(key)) {
        usersByKey.set(key, {
          name: entry.personName.trim(),
          cards: [],
          notes: [],
          baseTotalHours: 0,
          baseRegularHours: 0,
          baseOvertimeHours: 0,
          manualHours: 0,
        });
      }

      const userEntry = usersByKey.get(key);
      userEntry.manualHours += hours;
      userEntry.cards.push({
        label: entry.issueId || entry.cardTitle || "Manual Entry",
        projectName: entry.projectName || draftPayload.projectName || "",
        issueId: entry.issueId || "",
        title: entry.cardTitle || "",
        description: entry.cardTitle || "",
        taskIdentity: `manual-${entry.id}`,
        hoursUsed: `${hours.toFixed(2)} hrs`,
      });
    });

    return Array.from(usersByKey.values())
      .map((userEntry) => {
        const totalHours = Number((userEntry.baseTotalHours + userEntry.manualHours).toFixed(2));
        // Preserve the regular/overtime split already computed in InvoiceManager, which accounts
        // for a person's OTHER project hours that week consuming part of their 40h regular quota.
        // Recomputing min(total,40)/max(0,total-40) here in isolation would wrongly reclassify
        // overtime hours as regular whenever this invoice isn't their only project that week.
        const baseRegularHours = Number(userEntry.baseRegularHours || 0);
        const baseOvertimeHours = Number(userEntry.baseOvertimeHours || 0);
        const regularHours = Math.min(baseRegularHours, totalHours);
        const overtimeHours = Math.max(0, totalHours - regularHours);
        const regularCost = regularHours * baseRate;
        const overtimeCost = overtimeHours * baseRate * overtimeMultiplierValue;

        return {
          ...userEntry,
          totalHours,
          regularHours: Number(regularHours.toFixed(2)),
          overtimeHours: Number(overtimeHours.toFixed(2)),
          regularRate: baseRate,
          overtimeRate: Number((baseRate * overtimeMultiplierValue).toFixed(2)),
          lineTotal: Number((regularCost + overtimeCost).toFixed(2)),
        };
      })
      .sort((left, right) => right.lineTotal - left.lineTotal);
  }, [draftPayload, manualTimeEntries]);

  // Keeps new time entries consistent with each person's established naming convention in
  // Time Rotate (e.g. most of Salomon's real logs say "Salomon", not "Salomon Paredes") by
  // picking the raw name variant used on the most hours for that person, instead of the
  // longer display name shown in the summary.
  const preferredRegisteredByByCanonicalName = useMemo(() => {
    const baseUsers = Array.isArray(draftPayload?.users) ? draftPayload.users : [];

    const canonicalNameByShortName = new Map();
    const sortedByNameLength = [...baseUsers].sort((left, right) =>
      String(right.name || "").trim().length - String(left.name || "").trim().length
    );
    sortedByNameLength.forEach((userEntry) => {
      const fullName = String(userEntry.name || "").trim();
      if (!fullName) return;
      const firstWord = fullName.split(/\s+/)[0].toLowerCase();
      if (firstWord && !canonicalNameByShortName.has(firstWord)) {
        canonicalNameByShortName.set(firstWord, fullName);
      }
    });

    const bestVariantByCanonicalKey = new Map();
    baseUsers.forEach((userEntry) => {
      const fullName = String(userEntry.name || "").trim();
      if (!fullName) return;
      const normalizedFullName = fullName.toLowerCase();
      const isSingleWordName = !fullName.includes(" ");
      const canonicalName = isSingleWordName ? canonicalNameByShortName.get(normalizedFullName) : null;
      const resolvedName = (canonicalName && canonicalName.toLowerCase() !== normalizedFullName) ? canonicalName : fullName;
      const canonicalKey = resolvedName.toLowerCase();

      const hours = Number(userEntry.totalHours || 0);
      const current = bestVariantByCanonicalKey.get(canonicalKey);
      if (!current || hours > current.hours) {
        bestVariantByCanonicalKey.set(canonicalKey, { name: fullName, hours });
      }
    });

    const lookup = {};
    bestVariantByCanonicalKey.forEach((entry, canonicalKey) => {
      lookup[canonicalKey] = entry.name;
    });
    return lookup;
  }, [draftPayload]);

  const effectiveTotals = useMemo(() => {
    const totals = effectiveUsers.reduce((accumulator, userEntry) => ({
      totalRegularHours: accumulator.totalRegularHours + Number(userEntry.regularHours || 0),
      totalOvertimeHours: accumulator.totalOvertimeHours + Number(userEntry.overtimeHours || 0),
      totalHours: accumulator.totalHours + Number(userEntry.totalHours || 0),
      totalAmount: accumulator.totalAmount + Number(userEntry.lineTotal || 0),
    }), { totalRegularHours: 0, totalOvertimeHours: 0, totalHours: 0, totalAmount: 0 });

    return {
      totalRegularHours: Number(totals.totalRegularHours.toFixed(2)),
      totalOvertimeHours: Number(totals.totalOvertimeHours.toFixed(2)),
      totalHours: Number(totals.totalHours.toFixed(2)),
      totalAmount: Number(totals.totalAmount.toFixed(2)),
    };
  }, [effectiveUsers]);

  const projectNameOptions = useMemo(() => {
    const uniqueProjectNames = new Map();
    cardOptions.forEach((option) => {
      const projectName = String(option.projectName || "").trim();
      if (!projectName) return;
      const key = projectName.toLowerCase();
      if (!uniqueProjectNames.has(key)) uniqueProjectNames.set(key, projectName);
    });
    if (draftPayload?.projectName) {
      const key = String(draftPayload.projectName).trim().toLowerCase();
      if (key && !uniqueProjectNames.has(key)) uniqueProjectNames.set(key, draftPayload.projectName);
    }
    return Array.from(uniqueProjectNames.values()).sort((left, right) => left.localeCompare(right));
  }, [cardOptions, draftPayload?.projectName]);

  // Restricting to this exact list (instead of free text) prevents typos/near-duplicate names
  // (e.g. "Salomon" vs "Salomon Paredes") from registering as a different person.
  const personNameOptions = useMemo(() => {
    return mergeNameVariants([
      ...organizationMembers.map((member) => member.label),
      ...effectiveUsers.map((userEntry) => userEntry.name),
      resolveMemberDisplayName(user || {}),
    ]);
  }, [organizationMembers, effectiveUsers, user]);

  const filteredCardOptions = useMemo(() => {
    const selectedProjectName = String(manualEntryDraft.projectName || "").trim().toLowerCase();
    if (!selectedProjectName) return cardOptions;
    return cardOptions.filter((option) => option.projectName.toLowerCase() === selectedProjectName);
  }, [cardOptions, manualEntryDraft.projectName]);

  const handleDownloadXlsx = () => {
    if (!draftPayload) return;

    const users = effectiveUsers;
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
      ...users.flatMap((userEntry, userIndex) => {
        const name = userEntry.name || "Unknown User";
        const regularHours = Number(userEntry.regularHours || 0);
        const overtimeHours = Number(userEntry.overtimeHours || 0);
        const regularRate = Number(userEntry.regularRate || 0);
        const overtimeRate = Number(userEntry.overtimeRate || 0);
        const regularCost = regularHours * regularRate;
        const overtimeCost = overtimeHours * overtimeRate;
        const cardCount = Array.isArray(userEntry.cards) ? userEntry.cards.length : 0;
        const notesSummary = (Array.isArray(userEntry.notes) ? userEntry.notes : [])
          .map((note, noteIndex) => getEffectiveNoteText(userIndex, cardCount + noteIndex, note.text || ""))
          .filter(Boolean)
          .join(" | ");

        return [
          [
            name,
            `Regular (<= ${overtimeThresholdHours}h)`,
            regularHours,
            regularRate,
            regularCost,
            String(userEntry.issueSummary || ""),
            notesSummary,
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
      ["Totals", "Regular", Number(effectiveTotals.totalRegularHours || 0), "", "", "", ""],
      ["Totals", "Overtime", Number(effectiveTotals.totalOvertimeHours || 0), "", "", "", ""],
      ["Totals", "All Hours", Number(effectiveTotals.totalHours || 0), "", "", "", ""],
      ["Totals", "Amount", "", "", Number(effectiveTotals.totalAmount || 0), "", ""],
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

    users.forEach((userEntry, userIndex) => {
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

      notes.forEach((note, noteIndex) => {
        issueAndNoteRows.push([
          userEntry.name || "Unknown User",
          String(note.cardLabel || ""),
          String(note.projectName || ""),
          String(note.issueId || ""),
          getIssueTitleText(note),
          getIssueDetailsText(note),
          getEffectiveNoteText(userIndex, cards.length + noteIndex, note.text || ""),
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

    setIsGeneratingPdf(true);
    try {
      // html2canvas can't render a live <textarea> value, so close any open note edit before capturing.
      if (editingNoteRowKey !== null) {
        setEditingNoteRowKey(null);
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }

      const containerElement = pdfContentRef.current;
      const images = Array.from(containerElement.querySelectorAll("img"));
      await Promise.all(
        images.map((imageElement) => {
          if (imageElement.complete) return Promise.resolve();
          return new Promise((resolve) => {
            imageElement.addEventListener("load", resolve, { once: true });
            imageElement.addEventListener("error", resolve, { once: true });
          });
        })
      );

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
          allowTaint: true,
          logging: false,
        },
        jsPDF: {
          unit: "mm",
          format: "a4",
          orientation: "portrait",
        },
        // "avoid-all" treats every nested block as unsplittable, which can cascade whole
        // sections onto the next page over a small height change. "css" only breaks where
        // we explicitly mark break-inside/break-before below, so pages fill up naturally.
        pagebreak: { mode: ["css", "legacy"] },
      };

      await html2pdf().set(options).from(containerElement).save();
    } catch (error) {
      console.error("Failed to export invoice PDF:", error);
      toast.error("Failed to export PDF.");
    } finally {
      setIsGeneratingPdf(false);
    }
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

  const users = effectiveUsers;
  const overtimeThresholdHours = Number(draftPayload.overtimePolicy?.thresholdHours || DEFAULT_OVERTIME_THRESHOLD_HOURS);
  const overtimeMultiplier = Number(draftPayload.overtimePolicy?.overtimeMultiplier || DEFAULT_OVERTIME_MULTIPLIER);
  const overtimePolicyLabel = String(draftPayload.overtimePolicy?.label || `OT after ${overtimeThresholdHours}h/user/week @ ${overtimeMultiplier.toFixed(2)}x rate`);
  const documentTypeLabel = documentType === "work_order"
    ? "Work Order"
    : documentType === "change_order"
      ? "Change Order"
      : "Invoice";
  const documentReferenceLabel = documentType === "work_order"
    ? "Work Order #"
    : documentType === "change_order"
      ? "Change Order #"
      : "Invoice #";
  const summaryGridColumns = showDocumentTotals
    ? "minmax(0, 2.8fr) minmax(0, 1fr) minmax(0, 1.2fr) minmax(0, 1.4fr)"
    : "minmax(0, 3fr) minmax(0, 1fr)";
  const workTimestampRange = users
    .flatMap((userEntry) => Array.isArray(userEntry.cards) ? userEntry.cards : [])
    .reduce((range, card) => {
      const firstUsedAt = Number(card.firstUsedAt) || 0;
      const lastUsedAt = Number(card.lastUsedAt) || firstUsedAt;
      if (firstUsedAt > 0 && (!range.firstUsedAt || firstUsedAt < range.firstUsedAt)) range.firstUsedAt = firstUsedAt;
      if (lastUsedAt > range.lastUsedAt) range.lastUsedAt = lastUsedAt;
      return range;
    }, { firstUsedAt: 0, lastUsedAt: 0 });

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
            onClick={handleSaveNoteOverrides}
            disabled={isSavingNoteOverrides || !invoiceDocRef}
            title={invoiceDocRef ? "Save hidden/edited notes to Firebase" : "Regenerate this preview from Invoices to enable saving"}
            style={{ border: "none", borderRadius: "8px", padding: "10px 14px", background: invoiceDocRef ? "#7C3AED" : "#94A3B8", color: "#FFFFFF", fontWeight: 700, cursor: invoiceDocRef ? "pointer" : "not-allowed" }}
          >
            {isSavingNoteOverrides ? "Saving..." : "Save Note Changes"}
          </button>
          <button
            type="button"
            onClick={handleDownloadPdf}
            disabled={isGeneratingPdf}
            style={{ border: "none", borderRadius: "8px", padding: "10px 14px", background: "#0F766E", color: "#FFFFFF", fontWeight: 700, cursor: isGeneratingPdf ? "not-allowed" : "pointer", opacity: isGeneratingPdf ? 0.7 : 1 }}
          >
            {isGeneratingPdf ? "Generating PDF..." : "Export PDF"}
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

      <div style={{ ...cardStyle, marginTop: "12px", display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
        <strong style={{ color: "#0F172A" }}>Show/Hide Sections:</strong>
        {SECTION_DEFS.map((section) => (
          <label key={section.key} style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", color: "#334155", fontSize: "0.9rem" }}>
            <input
              type="checkbox"
              checked={Boolean(sectionVisibility[section.key])}
              onChange={() => toggleSectionVisibility(section.key)}
            />
            {section.label}
          </label>
        ))}
      </div>

      <div data-html2canvas-ignore="true" style={{ ...cardStyle, marginTop: "12px", display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap" }}>
        <strong style={{ color: "#0F172A" }}>Document Type:</strong>
        {[{ value: "invoice", label: "Invoice" }, { value: "work_order", label: "Work Order" }, { value: "change_order", label: "Change Order" }].map((option) => (
          <label key={option.value} style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", color: "#334155", fontSize: "0.9rem" }}>
            <input
              type="checkbox"
              checked={documentType === option.value}
              disabled={isSavingDocumentSettings}
              onChange={() => handleDocumentSettingsChange(option.value, showDocumentTotals)}
            />
            {option.label}
          </label>
        ))}
        <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", color: "#334155", fontSize: "0.9rem" }}>
          <input
            type="checkbox"
            checked={showDocumentTotals}
            disabled={isSavingDocumentSettings}
            onChange={(event) => handleDocumentSettingsChange(documentType, event.target.checked)}
          />
          Show Totals
        </label>
        {[
          { key: "week", label: "Show Week" },
          { key: "period", label: "Show Period" },
          { key: "dateOfWork", label: "Show Date of Work" },
          { key: "dueDate", label: "Show Due Date" },
          { key: "terms", label: "Show Terms" },
          { key: "overtimePolicy", label: "Show OT Policy" },
        ].map((option) => (
          <label key={option.key} style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", color: "#334155", fontSize: "0.9rem" }}>
            <input
              type="checkbox"
              checked={Boolean(documentInfoVisibility[option.key])}
              disabled={isSavingDocumentSettings}
              onChange={(event) => handleDocumentSettingsChange(documentType, showDocumentTotals, {
                ...documentInfoVisibility,
                [option.key]: event.target.checked,
              })}
            />
            {option.label}
          </label>
        ))}
      </div>

      <div style={{ ...cardStyle, marginTop: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
          <strong style={{ color: "#0F172A" }}>Add Person Time</strong>
          {!isAddingManualEntry && (
            <button
              type="button"
              onClick={openAddManualEntryForm}
              style={{ border: "none", borderRadius: "8px", padding: "8px 14px", background: "#0F766E", color: "#FFFFFF", fontWeight: 700, cursor: "pointer" }}
            >
              + Add Time Entry
            </button>
          )}
        </div>

        {manualTimeEntries.length > 0 && (
          <div style={{ marginTop: "12px", display: "grid", gap: "8px" }}>
            {manualTimeEntries.map((entry) => {
              const hours = getManualEntryHours(entry);
              return (
                <div key={entry.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", padding: "8px 12px", border: "1px solid #E2E8F0", borderRadius: "6px", flexWrap: "wrap" }}>
                  <div style={{ fontSize: "0.85rem", color: "#334155" }}>
                    <strong>{entry.personName}</strong>
                    {" — "}
                    {entry.projectName || "No project"}
                    {entry.issueId ? ` (${entry.issueId})` : ""}
                    {" — "}
                    {formatMonthDayYear(entry.date)}, {entry.startTime}–{entry.endTime} ({hours.toFixed(2)} hrs)
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      type="button"
                      onClick={() => openEditManualEntryForm(entry)}
                      disabled={isSavingManualEntry}
                      style={{ border: "1px solid #0F766E", borderRadius: "6px", padding: "4px 10px", background: "#FFFFFF", color: "#0F766E", fontWeight: 700, cursor: isSavingManualEntry ? "not-allowed" : "pointer" }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveManualTimeEntry(entry.id)}
                      disabled={isSavingManualEntry}
                      style={{ border: "1px solid #DC2626", borderRadius: "6px", padding: "4px 10px", background: "#FFFFFF", color: "#DC2626", fontWeight: 700, cursor: isSavingManualEntry ? "not-allowed" : "pointer" }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {isAddingManualEntry && (
          <div style={{ marginTop: "12px", padding: "12px", border: "1px solid #CBD5E1", borderRadius: "8px", background: "#F8FAFC", display: "grid", gap: "10px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "10px" }}>
              <label style={{ display: "grid", gap: "4px", fontSize: "0.8rem", color: "#334155" }}>
                Person
                <select
                  value={manualEntryDraft.personName}
                  onChange={(event) => setManualEntryDraft((previous) => ({ ...previous, personName: event.target.value }))}
                  style={{ padding: "8px", borderRadius: "6px", border: "1px solid #CBD5E1", fontSize: "0.9rem" }}
                >
                  <option value="">Select a person</option>
                  {personNameOptions.map((personName) => (
                    <option key={personName} value={personName}>{personName}</option>
                  ))}
                </select>
              </label>
              <label style={{ display: "grid", gap: "4px", fontSize: "0.8rem", color: "#334155" }}>
                Project
                {!manualProjectMode ? (
                  <select
                    value={projectNameOptions.includes(manualEntryDraft.projectName) ? manualEntryDraft.projectName : ""}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (value === "__manual__") {
                        setManualProjectMode(true);
                        setManualEntryDraft((previous) => ({ ...previous, projectName: "" }));
                        return;
                      }
                      setManualEntryDraft((previous) => ({
                        ...previous,
                        projectName: value,
                        ...(manualCardMode ? {} : { cardValue: "", issueId: "" }),
                      }));
                    }}
                    style={{ padding: "8px", borderRadius: "6px", border: "1px solid #CBD5E1", fontSize: "0.9rem" }}
                  >
                    <option value="">Select a project</option>
                    {projectNameOptions.map((projectName) => (
                      <option key={projectName} value={projectName}>{projectName}</option>
                    ))}
                    <option value="__manual__">Type manually / Not listed</option>
                  </select>
                ) : (
                  <div style={{ display: "flex", gap: "6px" }}>
                    <input
                      type="text"
                      value={manualEntryDraft.projectName}
                      onChange={(event) => setManualEntryDraft((previous) => ({
                        ...previous,
                        projectName: event.target.value,
                        ...(manualCardMode ? {} : { cardValue: "", issueId: "" }),
                      }))}
                      placeholder="Project name"
                      style={{ flex: 1, padding: "8px", borderRadius: "6px", border: "1px solid #CBD5E1", fontSize: "0.9rem" }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setManualProjectMode(false);
                        setManualEntryDraft((previous) => ({ ...previous, projectName: "" }));
                      }}
                      style={{ border: "1px solid #CBD5E1", borderRadius: "6px", padding: "0 10px", background: "#FFFFFF", color: "#334155", fontSize: "0.78rem", cursor: "pointer" }}
                    >
                      Use dropdown
                    </button>
                  </div>
                )}
              </label>
              <label style={{ display: "grid", gap: "4px", fontSize: "0.8rem", color: "#334155" }}>
                TD / Issue ID
                {!manualCardMode ? (
                  <select
                    value={manualEntryDraft.cardValue}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (value === "__manual__") {
                        setManualCardMode(true);
                        setManualEntryDraft((previous) => ({ ...previous, cardValue: "" }));
                        return;
                      }
                      const selectedCard = filteredCardOptions.find((option) => option.value === value);
                      setManualEntryDraft((previous) => ({
                        ...previous,
                        cardValue: value,
                        issueId: selectedCard?.issueId || "",
                        projectName: selectedCard?.projectName || previous.projectName,
                        cardTitle: selectedCard?.issueLabel || previous.cardTitle,
                      }));
                    }}
                    style={{ padding: "8px", borderRadius: "6px", border: "1px solid #CBD5E1", fontSize: "0.9rem" }}
                  >
                    <option value="">
                      {cardOptionsLoading
                        ? "Loading TD cards..."
                        : manualEntryDraft.projectName
                          ? "Select a TD card"
                          : "Select a project first"}
                    </option>
                    {filteredCardOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {`${option.issueId} — ${option.projectName}${option.issueLabel ? ` (${option.issueLabel})` : ""}`}
                      </option>
                    ))}
                    <option value="__manual__">Type manually / Not listed</option>
                  </select>
                ) : (
                  <div style={{ display: "flex", gap: "6px" }}>
                    <input
                      type="text"
                      value={manualEntryDraft.issueId}
                      onChange={(event) => setManualEntryDraft((previous) => ({ ...previous, issueId: event.target.value }))}
                      placeholder="Card/Issue ID"
                      style={{ flex: 1, padding: "8px", borderRadius: "6px", border: "1px solid #CBD5E1", fontSize: "0.9rem" }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setManualCardMode(false);
                        setManualEntryDraft((previous) => ({ ...previous, issueId: "", cardValue: "" }));
                      }}
                      style={{ border: "1px solid #CBD5E1", borderRadius: "6px", padding: "0 10px", background: "#FFFFFF", color: "#334155", fontSize: "0.78rem", cursor: "pointer" }}
                    >
                      Use dropdown
                    </button>
                  </div>
                )}
              </label>
              <label style={{ display: "grid", gap: "4px", fontSize: "0.8rem", color: "#334155" }}>
                Card Title / Description
                <input
                  type="text"
                  value={manualEntryDraft.cardTitle}
                  onChange={(event) => setManualEntryDraft((previous) => ({ ...previous, cardTitle: event.target.value }))}
                  placeholder="What was worked on"
                  style={{ padding: "8px", borderRadius: "6px", border: "1px solid #CBD5E1", fontSize: "0.9rem" }}
                />
              </label>
              <label style={{ display: "grid", gap: "4px", fontSize: "0.8rem", color: "#334155" }}>
                Date
                <input
                  type="date"
                  value={manualEntryDraft.date}
                  onChange={(event) => setManualEntryDraft((previous) => ({ ...previous, date: event.target.value }))}
                  style={{ padding: "8px", borderRadius: "6px", border: "1px solid #CBD5E1", fontSize: "0.9rem" }}
                />
              </label>
              <label style={{ display: "grid", gap: "4px", fontSize: "0.8rem", color: "#334155" }}>
                Start Time
                <input
                  type="time"
                  value={manualEntryDraft.startTime}
                  onChange={(event) => setManualEntryDraft((previous) => ({ ...previous, startTime: event.target.value }))}
                  style={{ padding: "8px", borderRadius: "6px", border: "1px solid #CBD5E1", fontSize: "0.9rem" }}
                />
              </label>
              <label style={{ display: "grid", gap: "4px", fontSize: "0.8rem", color: "#334155" }}>
                End Time
                <input
                  type="time"
                  value={manualEntryDraft.endTime}
                  onChange={(event) => setManualEntryDraft((previous) => ({ ...previous, endTime: event.target.value }))}
                  style={{ padding: "8px", borderRadius: "6px", border: "1px solid #CBD5E1", fontSize: "0.9rem" }}
                />
              </label>
              <div style={{ display: "grid", gap: "4px", fontSize: "0.8rem", color: "#334155" }}>
                Total Hours
                <div style={{ padding: "8px", fontWeight: 700, color: "#0F172A" }}>
                  {getManualEntryHours(manualEntryDraft).toFixed(2)} hrs
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                type="button"
                onClick={handleAddManualTimeEntry}
                disabled={isSavingManualEntry}
                style={{ border: "none", borderRadius: "6px", padding: "8px 14px", background: "#0F766E", color: "#FFFFFF", fontWeight: 700, cursor: isSavingManualEntry ? "not-allowed" : "pointer", opacity: isSavingManualEntry ? 0.7 : 1 }}
              >
                {isSavingManualEntry ? "Saving..." : editingManualEntryId ? "Save Changes" : "Add Entry"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsAddingManualEntry(false);
                  setEditingManualEntryId("");
                }}
                style={{ border: "1px solid #CBD5E1", borderRadius: "6px", padding: "8px 14px", background: "#FFFFFF", color: "#334155", fontWeight: 700, cursor: "pointer" }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <div
        ref={pdfContentRef}
        style={{
          marginTop: "12px",
          fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
          color: "#1F2937",
          lineHeight: 1.5,
        }}
      >
      {sectionVisibility.companyHeader && (
        <div style={{ ...cardStyle, padding: "20px 24px", borderTop: "3px solid #0F172A" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "20px", flexWrap: "wrap" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                <div
                  style={{
                    height: "52px",
                    width: logoStatus === "ready" ? "auto" : "160px",
                    minWidth: logoStatus === "ready" ? "0" : "160px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: logoStatus === "ready" ? "flex-start" : "center",
                    border: logoStatus === "ready" ? "none" : "1px dashed #CBD5E1",
                    background: logoStatus === "ready" ? "transparent" : "#F8FAFC",
                    boxSizing: "border-box",
                  }}
                >
                  {logoStatus === "ready" ? (
                    <img
                      src={logoDataUrl}
                      alt={`${companyBranding.name || "Company"} logo`}
                      style={{ height: "52px", width: "auto", objectFit: "contain" }}
                    />
                  ) : logoStatus === "loading" ? (
                    <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#94A3B8", letterSpacing: "0.04em" }}>
                      Loading logo…
                    </span>
                  ) : (
                    <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#94A3B8", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                      Logo
                    </span>
                  )}
                </div>
              </div>

              <div>
                <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
                  <div>
                    <div style={{ fontSize: "0.95rem", fontWeight: 700, color: "#0F172A" }}>
                      {companyInfo?.fullName || ""}
                    </div>
                    {companyInfo?.address ? (
                      <div style={{ fontSize: "0.85rem", color: "#334155", marginTop: "2px", whiteSpace: "pre-line" }}>
                        {companyInfo.address}
                      </div>
                    ) : null}
                  </div>
                  {!isEditingCompanyInfo ? (
                    <button
                      type="button"
                      data-html2canvas-ignore="true"
                      onClick={openCompanyInfoEditor}
                      style={{ border: "1px solid #CBD5E1", borderRadius: "6px", padding: "4px 10px", background: "#F1F5F9", color: "#334155", fontSize: "0.78rem", fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}
                    >
                      Edit Company Info
                    </button>
                  ) : null}
                </div>

                {isEditingCompanyInfo ? (
                  <div data-html2canvas-ignore="true" style={{ marginTop: "10px", padding: "12px", border: "1px solid #CBD5E1", borderRadius: "8px", background: "#F8FAFC", display: "grid", gap: "8px", maxWidth: "420px" }}>
                    <label style={{ display: "grid", gap: "4px", fontSize: "0.8rem", color: "#334155" }}>
                      Full Name
                      <input
                        type="text"
                        value={companyInfoDraftFullName}
                        onChange={(event) => setCompanyInfoDraftFullName(event.target.value)}
                        placeholder="Company full name"
                        style={{ padding: "8px", borderRadius: "6px", border: "1px solid #CBD5E1", fontSize: "0.9rem" }}
                      />
                    </label>
                    <label style={{ display: "grid", gap: "4px", fontSize: "0.8rem", color: "#334155" }}>
                      Address
                      <textarea
                        value={companyInfoDraftAddress}
                        onChange={(event) => setCompanyInfoDraftAddress(event.target.value)}
                        placeholder="Street, City, State, ZIP"
                        rows={3}
                        style={{ padding: "8px", borderRadius: "6px", border: "1px solid #CBD5E1", fontSize: "0.9rem", fontFamily: "inherit" }}
                      />
                    </label>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button
                        type="button"
                        onClick={handleSaveCompanyInfo}
                        disabled={isSavingCompanyInfo}
                        style={{ border: "none", borderRadius: "6px", padding: "8px 14px", background: "#0F766E", color: "#FFFFFF", fontWeight: 700, cursor: isSavingCompanyInfo ? "not-allowed" : "pointer", opacity: isSavingCompanyInfo ? 0.7 : 1 }}
                      >
                        {isSavingCompanyInfo ? "Saving..." : "Save Company Info"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsEditingCompanyInfo(false)}
                        style={{ border: "1px solid #CBD5E1", borderRadius: "6px", padding: "8px 14px", background: "#FFFFFF", color: "#334155", fontWeight: 700, cursor: "pointer" }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: "1.6rem", fontWeight: 800, color: "#0F172A", letterSpacing: "0.08em" }}>{documentTypeLabel.toUpperCase()}</div>
              <div style={{ fontSize: "0.9rem", color: "#64748B", marginTop: "4px" }}>
                {`${documentReferenceLabel}${draftPayload.invoiceNumber || "-"}`}
              </div>
            </div>
          </div>
          <div style={{ marginTop: "18px", paddingTop: "14px", borderTop: "1px solid #E2E8F0" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#94A3B8" }}>
                  Bill To
                </div>
                <div style={{ fontSize: "1.05rem", fontWeight: 700, color: "#0F172A", marginTop: "2px" }}>
                  {billTo?.fullName || draftPayload.projectName || "Unknown Client"}
                </div>
                {billTo?.address ? (
                  <div style={{ fontSize: "0.85rem", color: "#334155", marginTop: "2px", whiteSpace: "pre-line" }}>
                    {billTo.address}
                  </div>
                ) : null}
              </div>
              {!isEditingBillTo ? (
                <button
                  type="button"
                  data-html2canvas-ignore="true"
                  onClick={openBillToEditor}
                  style={{ border: "1px solid #CBD5E1", borderRadius: "6px", padding: "4px 10px", background: "#F1F5F9", color: "#334155", fontSize: "0.78rem", fontWeight: 700, cursor: "pointer" }}
                >
                  Edit Bill To
                </button>
              ) : null}
            </div>

            {isEditingBillTo ? (
              <div data-html2canvas-ignore="true" style={{ marginTop: "12px", padding: "12px", border: "1px solid #CBD5E1", borderRadius: "8px", background: "#F8FAFC", display: "grid", gap: "8px", maxWidth: "480px" }}>
                {billToClients.length > 0 ? (
                  <div style={{ display: "flex", gap: "14px", flexWrap: "wrap" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.85rem", color: "#334155" }}>
                      <input
                        type="radio"
                        checked={billToDraftMode === "existing"}
                        onChange={() => setBillToDraftMode("existing")}
                      />
                      Select existing
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.85rem", color: "#334155" }}>
                      <input
                        type="radio"
                        checked={billToDraftMode === "new"}
                        onChange={() => setBillToDraftMode("new")}
                      />
                      Create new
                    </label>
                  </div>
                ) : null}

                {billToDraftMode === "existing" && billToClients.length > 0 ? (
                  <select
                    value={billToDraftClientId}
                    onChange={(event) => handleSelectExistingBillToClient(event.target.value)}
                    style={{ padding: "8px", borderRadius: "6px", border: "1px solid #CBD5E1", fontSize: "0.9rem" }}
                  >
                    <option value="">Select a Bill To contact...</option>
                    {billToClients.map((client) => (
                      <option key={client.id} value={client.id}>{client.fullName}</option>
                    ))}
                  </select>
                ) : null}

                <label style={{ display: "grid", gap: "4px", fontSize: "0.8rem", color: "#334155" }}>
                  Full Name
                  <input
                    type="text"
                    value={billToDraftFullName}
                    onChange={(event) => setBillToDraftFullName(event.target.value)}
                    placeholder="Client full name"
                    style={{ padding: "8px", borderRadius: "6px", border: "1px solid #CBD5E1", fontSize: "0.9rem" }}
                  />
                </label>
                <label style={{ display: "grid", gap: "4px", fontSize: "0.8rem", color: "#334155" }}>
                  Address
                  <textarea
                    value={billToDraftAddress}
                    onChange={(event) => setBillToDraftAddress(event.target.value)}
                    placeholder="Street, City, State, ZIP"
                    rows={3}
                    style={{ padding: "8px", borderRadius: "6px", border: "1px solid #CBD5E1", fontSize: "0.9rem", fontFamily: "inherit" }}
                  />
                </label>

                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    type="button"
                    onClick={handleSaveBillTo}
                    disabled={isSavingBillTo}
                    style={{ border: "none", borderRadius: "6px", padding: "8px 14px", background: "#0F766E", color: "#FFFFFF", fontWeight: 700, cursor: isSavingBillTo ? "not-allowed" : "pointer", opacity: isSavingBillTo ? 0.7 : 1 }}
                  >
                    {isSavingBillTo ? "Saving..." : "Save Bill To"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsEditingBillTo(false)}
                    style={{ border: "1px solid #CBD5E1", borderRadius: "6px", padding: "8px 14px", background: "#FFFFFF", color: "#334155", fontWeight: 700, cursor: "pointer" }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {sectionVisibility.invoiceInfo && (
      <div style={{ ...cardStyle, marginTop: sectionVisibility.companyHeader ? "12px" : 0, padding: "16px 24px" }}>
        <div style={{ display: "grid", gap: "16px", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
          {[
            documentInfoVisibility.week && ["Week", `Week ${draftPayload.weekNumber || "-"}`],
            documentInfoVisibility.period && ["Period", `${formatMonthDayYear(draftPayload.mondayDate)} – ${formatMonthDayYear(draftPayload.weekEndDate)}`],
            documentInfoVisibility.dateOfWork && ["Date of Work", formatWorkDateRange(workTimestampRange.firstUsedAt, workTimestampRange.lastUsedAt)],
            documentInfoVisibility.dueDate && ["Due Date", formatMonthDayYear(draftPayload.dueDate)],
            documentInfoVisibility.terms && ["Terms", draftPayload.paymentTermsLabel || "-"],
          ].filter(Boolean).map(([label, value]) => (
            <div key={label}>
              <div style={{ fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#94A3B8" }}>
                {label}
              </div>
              <div style={{ fontSize: "0.95rem", fontWeight: 700, color: "#0F172A", marginTop: "2px" }}>
                {value}
              </div>
            </div>
          ))}
        </div>
        {documentInfoVisibility.overtimePolicy ? (
          <div style={{ marginTop: "12px", fontSize: "0.78rem", color: "#64748B" }}>{overtimePolicyLabel}</div>
        ) : null}
      </div>
      )}

      {sectionVisibility.summary && (
      <div style={{ ...cardStyle, marginTop: "12px", width: "100%", boxSizing: "border-box" }}>
        <h2 style={sectionHeadingStyle}>Billable Summary by Person</h2>
        <div style={{ marginBottom: "12px", fontSize: "0.82rem", color: "#334155", lineHeight: 1.4 }}>
          {`BIM Coordinator / Detailer services: weekly BIM Services, including drafting, coordination, and BIM assistance for project "${draftPayload.projectName || "Unknown Project"}". Drafting services include Revit, Revizto, Navisworks and Electrical BIM Coordination.`}
        </div>

        <div style={{ width: "100%", boxSizing: "border-box", border: "1px solid #CBD5E1", overflow: "hidden" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: summaryGridColumns,
              width: "100%",
              background: "#F8FAFC",
              borderBottom: "1px solid #E5E7EB",
            }}
          >
            <div style={tableHeaderCellStyle}>Description</div>
            <div style={{ ...tableHeaderCellStyle, textAlign: "right" }}>Hours</div>
            {showDocumentTotals ? <div style={{ ...tableHeaderCellStyle, textAlign: "right" }}>Rate</div> : null}
            {showDocumentTotals ? <div style={{ ...tableHeaderCellStyle, textAlign: "right" }}>Amount</div> : null}
          </div>

          {users.map((userEntry, index) => {
            const drafterLabel = `Drafter #${index + 1}`;
            const rowBackground = index % 2 === 0 ? "#F1F5F9" : "#FFFFFF";
            const regularHours = Number(userEntry.regularHours || 0);
            const overtimeHours = Number(userEntry.overtimeHours || 0);
            const regularRate = Number(userEntry.regularRate || 0);
            const overtimeRate = Number(userEntry.overtimeRate || 0);
            const regularCost = regularHours * regularRate;
            const overtimeCost = overtimeHours * overtimeRate;
            const cards = Array.isArray(userEntry.cards) ? userEntry.cards : [];
            const cardSummaries = cards
              .map((card) => {
                const cardId = String(card.label || card.issueId || "").trim();
                const cardTitle = getIssueTitleText(card);
                return cardTitle ? `${cardId || "TD"}: ${cardTitle}` : cardId;
              })
              .filter(Boolean);

            return (
              <React.Fragment key={`${userEntry.name || "Unknown User"}-${index}`}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: summaryGridColumns,
                    width: "100%",
                    background: rowBackground,
                    breakInside: "avoid",
                    pageBreakInside: "avoid",
                  }}
                >
                  <div style={tableBodyCellStyle}>
                    <div>{`BIM Coordinator Services — ${drafterLabel} (Regular, <= ${overtimeThresholdHours}h)`}</div>
                    {cardSummaries.length > 0 ? (
                      <div style={{ marginTop: "4px", fontSize: "0.78rem", color: "#64748B" }}>
                        {cardSummaries.map((summary, summaryIndex) => (
                          <div key={`${index}-card-${summaryIndex}`}>{summary}</div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div style={numericBodyCellStyle}>{formatHoursClock(regularHours)}</div>
                  {showDocumentTotals ? <div style={numericBodyCellStyle}>{formatCurrency(regularRate)}</div> : null}
                  {showDocumentTotals ? <div style={{ ...numericBodyCellStyle, fontWeight: 700 }}>{formatCurrency(regularCost)}</div> : null}
                </div>
                {overtimeHours > 0 ? (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: summaryGridColumns,
                      width: "100%",
                      background: rowBackground,
                      breakInside: "avoid",
                      pageBreakInside: "avoid",
                    }}
                  >
                    <div style={tableBodyCellStyle}>
                      {`BIM Coordinator Services — ${drafterLabel} (Overtime, > ${overtimeThresholdHours}h)`}
                    </div>
                    <div style={numericBodyCellStyle}>{formatHoursClock(overtimeHours)}</div>
                    {showDocumentTotals ? <div style={numericBodyCellStyle}>{formatCurrency(overtimeRate)}</div> : null}
                    {showDocumentTotals ? <div style={{ ...numericBodyCellStyle, fontWeight: 700 }}>{formatCurrency(overtimeCost)}</div> : null}
                  </div>
                ) : null}
              </React.Fragment>
            );
          })}

          {showDocumentTotals ? <div
            style={{
              display: "grid",
              gridTemplateColumns: summaryGridColumns,
              width: "100%",
              borderTop: "1px solid #CBD5E1",
            }}
          >
            <div style={{ ...tableBodyCellStyle, fontWeight: 700, background: "#F8FAFC" }}>Subtotal (Regular + Overtime Hours)</div>
            <div style={{ ...numericBodyCellStyle, fontWeight: 700, background: "#F8FAFC" }}>{formatHoursClock(effectiveTotals.totalHours || 0)}</div>
            <div style={{ ...numericBodyCellStyle, background: "#F8FAFC" }}></div>
            <div style={{ ...numericBodyCellStyle, fontWeight: 700, background: "#F8FAFC" }}>{formatCurrency(effectiveTotals.totalAmount || 0)}</div>
          </div> : null}
          {showDocumentTotals ? <div
            style={{
              display: "grid",
              gridTemplateColumns: summaryGridColumns,
              width: "100%",
              background: "#0F172A",
              color: "#FFFFFF",
            }}
          >
            <div style={{ padding: "12px 14px", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", fontSize: "0.9rem" }}>Total Due</div>
            <div style={{ padding: "12px 14px" }}></div>
            <div style={{ padding: "12px 14px" }}></div>
            <div style={{ padding: "12px 14px", textAlign: "right", fontWeight: 800, fontSize: "1.15rem", fontVariantNumeric: "tabular-nums" }}>
              {formatCurrency(effectiveTotals.totalAmount || 0)}
            </div>
          </div> : null}
        </div>
      </div>
      )}

      {sectionVisibility.workSummary && (
      <div
        data-html2canvas-ignore="true"
        style={{
          ...cardStyle,
          marginTop: "12px",
          width: "100%",
          boxSizing: "border-box",
        }}
      >
        <h2 style={sectionHeadingStyle}>Work Summary per User</h2>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", justifyItems: "stretch", alignItems: "stretch", gap: "12px", width: "100%" }}>
          {users.length === 0 ? (
            <div style={{ ...cardStyle, borderColor: "#CBD5E1", marginTop: 0 }}>No user rows available.</div>
          ) : users.map((userEntry, userIndex) => {
            const cards = Array.isArray(userEntry.cards) ? userEntry.cards : [];

            return (
              <div
                key={`work-summary-${userIndex}-${userEntry.name || "unknown"}`}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  border: "1px solid #CBD5E1",
                  borderRadius: "0px",
                  overflow: "hidden",
                  background: "#FFFFFF",
                  breakInside: "avoid",
                  pageBreakInside: "avoid",
                }}
              >
                <div style={{ padding: "10px 12px", background: "#F8FAFC", borderBottom: "1px solid #E2E8F0", fontWeight: 800, color: "#0F172A" }}>
                  {`Drafter #${userIndex + 1} — ${userEntry.name || "Unknown User"}`}
                </div>
                <div style={{ width: "100%", boxSizing: "border-box" }}>
                  {cards.length === 0 ? (
                    <div style={{ ...tableBodyCellStyle, borderBottom: "none" }}>
                      No TD Cards were logged for this user in this invoice row.
                    </div>
                  ) : (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(0, 1fr) minmax(0, 2.6fr)",
                        width: "100%",
                        background: "#F8FAFC",
                        borderBottom: "1px solid #E5E7EB",
                      }}
                    >
                      <div style={tableHeaderCellStyle}>TD Card</div>
                      <div style={tableHeaderCellStyle}>Details</div>
                    </div>
                  )}

                  {cards.length > 0 ? (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(0, 1fr) minmax(0, 2.6fr)",
                        width: "100%",
                      }}
                    >
                      {cards.map((card, cardIndex) => (
                        <React.Fragment key={`work-summary-${userIndex}-card-${cardIndex}`}>
                          <div style={tableBodyCellStyle}>{card.issueId || card.label || "-"}</div>
                          <div style={tableBodyCellStyle}>{getIssueDetailsText(card) || "-"}</div>
                        </React.Fragment>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      )}

      {sectionVisibility.issuesNotes && (
      <div data-html2canvas-ignore="true" style={{ ...cardStyle, marginTop: "12px", width: "100%", boxSizing: "border-box" }}>
        <h2 style={sectionHeadingStyle}>Issues and Notes Included in This Invoice</h2>
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
                  borderRadius: "0px",
                  overflow: "hidden",
                  background: "#FFFFFF",
                  breakInside: "avoid",
                  pageBreakInside: "avoid",
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
                          {(() => {
                            const rowKey = getNoteRowKey(userIndex, rowIndex);
                            const isHidden = Boolean(noteRowOverrides[rowKey]?.hidden);
                            const isEditing = editingNoteRowKey === rowKey;
                            const effectiveNoteText = getEffectiveNoteText(userIndex, rowIndex, row.noteText);

                            return (
                              <div style={tableBodyCellStyle}>
                                {isHidden ? (
                                  <span style={{ fontStyle: "italic", color: "#94A3B8" }}>Hidden</span>
                                ) : isEditing ? (
                                  <textarea
                                    value={effectiveNoteText}
                                    onChange={(event) => updateNoteRowText(rowKey, event.target.value)}
                                    rows={3}
                                    style={{ width: "100%", boxSizing: "border-box", fontSize: "0.9rem", fontFamily: "inherit", padding: "6px", border: "1px solid #CBD5E1", borderRadius: "6px" }}
                                  />
                                ) : (
                                  <span>{effectiveNoteText || "-"}</span>
                                )}
                                <div data-html2canvas-ignore="true" style={{ display: "flex", gap: "6px", marginTop: "6px" }}>
                                  <button
                                    type="button"
                                    onClick={() => toggleNoteRowHidden(rowKey)}
                                    style={{ border: "1px solid #CBD5E1", borderRadius: "6px", padding: "2px 8px", background: isHidden ? "#0F766E" : "#F1F5F9", color: isHidden ? "#FFFFFF" : "#334155", fontSize: "0.72rem", cursor: "pointer" }}
                                  >
                                    {isHidden ? "Show" : "Hide"}
                                  </button>
                                  {!isHidden && (
                                    <button
                                      type="button"
                                      onClick={() => setEditingNoteRowKey(isEditing ? null : rowKey)}
                                      style={{ border: "1px solid #CBD5E1", borderRadius: "6px", padding: "2px 8px", background: isEditing ? "#1D4ED8" : "#F1F5F9", color: isEditing ? "#FFFFFF" : "#334155", fontSize: "0.72rem", cursor: "pointer" }}
                                    >
                                      {isEditing ? "Done" : "Edit"}
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })()}
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
      )}

      <div style={{ marginTop: "20px", paddingTop: "14px", borderTop: "1px solid #E2E8F0", textAlign: "center", color: "#94A3B8", fontSize: "0.8rem" }}>
        Thank you for your business.
      </div>

      </div>
    </div>
  );
};

export default BillableInvoicePreviewPage;
