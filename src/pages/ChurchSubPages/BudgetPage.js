import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { toast } from 'react-toastify';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import NotAuthorized from '../../components/NotAuthorized';
import commonStyles from '../commonStyles';
import {
  MODULE_SETTINGS_SUBCOLLECTION,
  MODULE_VISIBILITY_DOC_ID,
  MODULE_VISIBILITY_FIELD,
  isModuleVisibleForRole,
  normalizeModuleVisibilityRole,
} from '../../utils/organizationModules';
import { getChurchData } from '../../api/church';
import './BudgetPage.css';

const emptyCompanyForm = { name: '', contactName: '', contactEmail: '' };
const emptyProjectForm = { name: '', companyId: '', description: '' };
const emptyContractForm = { title: '', total: '', companyId: '', projectId: '', notes: '' };

const createEmptyLineItem = () => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  description: '',
  rate: '',
  quantity: '',
  includeInContract: true,
});

const parseCurrencyNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const computeLineItemTotal = (lineItem) => {
  return parseCurrencyNumber(lineItem?.rate) * parseCurrencyNumber(lineItem?.quantity);
};

const resolveDashboardSelection = ({ companies, projects, preferredCompanyId, preferredProjectId }) => {
  if (!companies.length && !projects.length) {
    return { companyId: '', projectId: '' };
  }

  let companyId = companies.some((company) => company.id === preferredCompanyId)
    ? preferredCompanyId
    : (companies[0]?.id || '');

  const projectsForCompany = projects.filter((project) => project.companyId === companyId);

  let projectId = projectsForCompany.some((project) => project.id === preferredProjectId)
    ? preferredProjectId
    : (projectsForCompany[0]?.id || '');

  if (!projectId && projects.length > 0) {
    const fallbackProject = projects[0];
    projectId = fallbackProject.id;
    companyId = fallbackProject.companyId || companyId;
  }

  return { companyId, projectId };
};

const budgetTabs = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'companies', label: 'Client Companies' },
  { id: 'projects', label: 'Projects' },
  { id: 'contracts', label: 'Contracts' },
  { id: 'remaining', label: 'Remaining Budget' },
  { id: 'invoice-create', label: 'Create Invoice' },
  { id: 'invoice-log', label: 'Invoice Log' },
];

const DEFAULT_BUDGET_TAB = 'dashboard';

const getResolvedBudgetTab = (tabValue) => {
  if (!tabValue) return DEFAULT_BUDGET_TAB;
  return budgetTabs.some((tab) => tab.id === tabValue) ? tabValue : DEFAULT_BUDGET_TAB;
};

const createEmptyInvoiceForm = () => ({
  companyId: '',
  projectId: '',
  contractId: '',
  categoryId: '',
  invoiceNumber: '',
  workWeek: '',
  weekOneDate: '',
  notes: '',
  lineItems: [createEmptyLineItem()],
});

const sortByName = (items, key = 'name') =>
  [...items].sort((a, b) => String(a?.[key] || '').localeCompare(String(b?.[key] || '')));

const normalizeNameKey = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

const normalizeInvoiceCategoryName = (value) => String(value || '').trim().replace(/\s+/g, ' ');

const normalizePdfText = (value) => {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u2012\u2013\u2014\u2015]/g, '-')
    .replace(/\u2022/g, '|')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2190\u2192]/g, '->')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '');
};

const extractSessionDateLabel = (line) => {
  const safeLine = normalizePdfText(line);
  const match = safeLine.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}\b/i);
  return match ? match[0] : 'Undated';
};

const parseSessionMinutesFromLine = (line) => {
  const safeLine = normalizePdfText(line);
  let match = safeLine.match(/\((\d+)\s*hr(?:s)?\s*(\d+)\s*min\)/i);
  if (match) {
    return Number(match[1] || 0) * 60 + Number(match[2] || 0);
  }
  match = safeLine.match(/\((\d+)\s*hr(?:s)?\)/i);
  if (match) {
    return Number(match[1] || 0) * 60;
  }
  match = safeLine.match(/\((\d+)\s*min\)/i);
  if (match) {
    return Number(match[1] || 0);
  }
  return 0;
};

const parseWorkOrderSessionRow = (line, shouldRoundHours = true, sourceLineIndex = -1) => {
  const safeLine = normalizePdfText(line);
  const dateLabel = extractSessionDateLabel(safeLine);
  const minutes = parseSessionMinutesFromLine(safeLine);
  const hours = shouldRoundHours
    ? ttMsToHrs(minutes * 60000)
    : Number((minutes / 60).toFixed(2));
  const employeeMatch = safeLine.match(/\)\s*-\s*(.+)$/);

  return {
    date: dateLabel,
    hours,
    minutes,
    sourceLineIndex,
    employee: employeeMatch ? String(employeeMatch[1] || '').trim() : '—',
    notes: [],
    noteLineIndices: [],
  };
};

const formatWorkOrderHours = (value) => {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return '0';
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
};

const formatWorkOrderHeaderDate = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '-';
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(parsed);
};

const toWorkOrderDayKey = (dayLabel) => {
  const parsed = new Date(String(dayLabel || ''));
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  }
  const normalized = String(dayLabel || 'UNDATED').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return normalized || 'UNDATED';
};

const buildWorkOrderDayId = (dayLabel, lineItemId, lineItemIndex, dayIndex) => {
  const dayKey = toWorkOrderDayKey(dayLabel);
  const lineKey = String(lineItemId || `line-${lineItemIndex + 1}`)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(-6)
    || `L${lineItemIndex + 1}`;
  return `WO-${dayKey}-${lineKey}-${String(dayIndex + 1).padStart(2, '0')}`;
};

const stripWorkOrderCardPrefix = (line) => {
  const safeLine = normalizePdfText(line);
  return safeLine.replace(/^(\s*)Card\s+/i, '$1').trimEnd();
};

const buildWorkOrderLogDescription = (workOrderPage) => {
  const lines = Array.isArray(workOrderPage?.descriptionLines) ? workOrderPage.descriptionLines : [];
  const prefaceLines = lines
    .map((line) => normalizePdfText(line).trim())
    .filter((line) => line && !/^Session:/i.test(line) && !/^\s*Note:/i.test(line) && !/^Day:/i.test(line));

  const cardSummaries = [];
  prefaceLines.forEach((line) => {
    if (/^Card\s+/i.test(line)) {
      cardSummaries.push(stripWorkOrderCardPrefix(line));
      return;
    }
    if (!/^Time Tracker Hours/i.test(line) && !/^Date range:/i.test(line) && !/^Total:/i.test(line) && !/^Duration:/i.test(line)) {
      cardSummaries.push(line);
    }
  });

  const dayHours = `${formatWorkOrderHours(Number(workOrderPage?.totalHours || 0))} hrs`;

  if (cardSummaries.length > 0) return `${cardSummaries.join('; ')} | ${dayHours}`;
  const fallback = prefaceLines.find((line) => !/^Date range:/i.test(line) && !/^Total:/i.test(line));
  return fallback ? `${fallback} | ${dayHours}` : dayHours;
};

const buildDailyWorkOrderPages = (lineItems) => {
  const pages = [];

  (lineItems || []).forEach((lineItem, lineItemIndex) => {
    const shouldRoundHours = lineItem?.roundHours !== false;
    const sourceLines = String(lineItem?.description || '').split('\n');
    const prefaceLines = [];
    const dayBuckets = new Map();
    let hasSessionLines = false;
    let currentDayLabel = '';

    sourceLines.forEach((rawLine, sourceLineIndex) => {
      const line = String(rawLine || '');
      const trimmed = line.trim();
      const normalized = normalizePdfText(line);

      if (/^Session:/i.test(trimmed)) {
        hasSessionLines = true;
        const dayLabel = extractSessionDateLabel(line);
        if (!dayBuckets.has(dayLabel)) {
          dayBuckets.set(dayLabel, { lines: [], minutes: 0, sessions: [] });
        }
        const bucket = dayBuckets.get(dayLabel);
        bucket.lines.push(normalized);
        bucket.minutes += parseSessionMinutesFromLine(line);
        bucket.sessions.push({
          ...parseWorkOrderSessionRow(line, shouldRoundHours, sourceLineIndex),
          lineItemIndex,
          lineItemId: String(lineItem?.id || ''),
        });
        currentDayLabel = dayLabel;
        return;
      }

      if (/^\s*Note:/i.test(line)) {
        if (currentDayLabel && dayBuckets.has(currentDayLabel)) {
          const bucket = dayBuckets.get(currentDayLabel);
          bucket.lines.push(normalized);
          if (bucket.sessions.length > 0) {
            const currentSession = bucket.sessions[bucket.sessions.length - 1];
            currentSession.notes.push(normalized.replace(/^\s*Note:\s*/i, '').trim());
            currentSession.noteLineIndices.push(sourceLineIndex);
          }
        } else {
          prefaceLines.push(normalized);
        }
        return;
      }

      if (!hasSessionLines) {
        prefaceLines.push(normalized);
      } else if (currentDayLabel && dayBuckets.has(currentDayLabel)) {
        dayBuckets.get(currentDayLabel).lines.push(normalized);
      } else {
        prefaceLines.push(normalized);
      }
    });

    const rate = Number(lineItem?.rate || 0);
    const quantity = Number(lineItem?.quantity || 0);
    const lineTotal = Number.isFinite(rate * quantity) ? rate * quantity : 0;

    if (!hasSessionLines || dayBuckets.size === 0) {
      const fallbackDayLabel = 'Work Day';
      pages.push({
        id: lineItem?.id || `line-${lineItemIndex}`,
        dayLabel: fallbackDayLabel,
        workOrderDayId: buildWorkOrderDayId(fallbackDayLabel, lineItem?.id, lineItemIndex, 0),
        descriptionLines: sourceLines.map((line) => stripWorkOrderCardPrefix(line)),
        sessionRows: [],
        pageTotal: lineTotal,
        totalHours: quantity,
      });
      return;
    }

    const sortedDays = Array.from(dayBuckets.entries()).sort((left, right) => {
      const leftDate = new Date(left[0]);
      const rightDate = new Date(right[0]);
      const leftTime = Number.isNaN(leftDate.getTime()) ? Number.MAX_SAFE_INTEGER : leftDate.getTime();
      const rightTime = Number.isNaN(rightDate.getTime()) ? Number.MAX_SAFE_INTEGER : rightDate.getTime();
      return leftTime - rightTime;
    });

    const dayRows = sortedDays
      .map(([dayLabel, bucket], dayIndex) => {
        const sessionRows = (Array.isArray(bucket.sessions) ? bucket.sessions : []).filter((session) => {
          const hasHours = Number(session?.hours || 0) > 0;
          const hasNotes = Array.isArray(session?.notes) && session.notes.some((note) => String(note || '').trim());
          return hasHours || hasNotes;
        });

        if (sessionRows.length === 0) {
          return null;
        }

        const dayMinutes = sessionRows.reduce((sum, session) => sum + Number(session?.minutes || 0), 0);
        return { dayLabel, bucket, dayIndex, sessionRows, dayMinutes };
      })
      .filter(Boolean);

    if (dayRows.length === 0) {
      return;
    }

    const totalMinutes = dayRows.reduce((sum, row) => sum + Number(row.dayMinutes || 0), 0);

    dayRows.forEach(({ dayLabel, bucket, dayIndex, sessionRows }) => {
      let pageTotal = 0;
      if (lineTotal > 0) {
        if (totalMinutes > 0 && bucket.minutes > 0) {
          pageTotal = lineTotal * (sessionRows.reduce((sum, session) => sum + Number(session?.minutes || 0), 0) / totalMinutes);
        } else if (dayRows.length === 1) {
          pageTotal = lineTotal;
        }
      } else if (rate > 0 && sessionRows.length > 0) {
        const visibleMinutes = sessionRows.reduce((sum, session) => sum + Number(session?.minutes || 0), 0);
        pageTotal = rate * (visibleMinutes / 60);
      }

      const mergedLines = [];
      prefaceLines.forEach((line) => {
        if (String(line || '').trim()) mergedLines.push(stripWorkOrderCardPrefix(line));
      });
      if (mergedLines.length > 0) {
        mergedLines.push('');
      }
      mergedLines.push(`Day: ${dayLabel}`);
      bucket.lines.forEach((line) => mergedLines.push(stripWorkOrderCardPrefix(line)));

      pages.push({
        id: `${lineItem?.id || `line-${lineItemIndex}`}-${dayIndex}`,
        dayLabel,
        workOrderDayId: buildWorkOrderDayId(dayLabel, lineItem?.id, lineItemIndex, dayIndex),
        descriptionLines: mergedLines,
        sessionRows,
        pageTotal,
        totalHours: sessionRows.reduce((sum, session) => sum + Number(session.hours || 0), 0),
      });
    });
  });

  return pages;
};

const toYyyyMmDd = (value) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const addDaysToIsoDate = (isoDate, daysToAdd) => {
  const sourceDate = new Date(isoDate);
  if (Number.isNaN(sourceDate.getTime())) return '';
  sourceDate.setDate(sourceDate.getDate() + daysToAdd);
  return toYyyyMmDd(sourceDate);
};

const getInvoiceTimelineKey = (projectId, contractId) => `${projectId || ''}__${contractId || 'no_contract'}`;
const invoiceIdForProjectWeek = (projectId, weekNumber, contractId) =>
  `${getInvoiceTimelineKey(projectId, contractId)}__week_${weekNumber}`;

const getRoleNameFromRoleDoc = (roleData = {}) =>
  String(
    roleData?.name
    || roleData?.roleName
    || roleData?.title
    || roleData?.displayName
    || ''
  ).trim();

// ─── Time Tracker pull helpers ─────────────────────────────────────────────
const ttNormVal = (v) => (v === null || v === undefined ? '' : String(v).trim());
const ttNormComp = (v) => ttNormVal(v).toLowerCase();
const ttNormKey = (v) => ttNormVal(v).toLowerCase().replace(/[^a-z0-9]+/g, '');

const ttToMs = (value) => {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return n;
  if (typeof value?.toMillis === 'function') {
    const ms = Number(value.toMillis());
    return Number.isFinite(ms) && ms > 0 ? ms : 0;
  }
  if (typeof value?.seconds === 'number') {
    const nanos = typeof value?.nanoseconds === 'number' ? value.nanoseconds : 0;
    const ms = value.seconds * 1000 + Math.floor(nanos / 1000000);
    return Number.isFinite(ms) && ms > 0 ? ms : 0;
  }
  return 0;
};

const ttToStartOfDay = (dateStr) => {
  if (!ttNormVal(dateStr)) return NaN;
  return Date.parse(`${ttNormVal(dateStr)}T00:00:00`);
};

const ttToEndOfDay = (dateStr) => {
  if (!ttNormVal(dateStr)) return NaN;
  return Date.parse(`${ttNormVal(dateStr)}T23:59:59.999`);
};

const ttFmtDate = (value) => {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const ttStartOfDay = (value = new Date()) => {
  const d = value instanceof Date ? new Date(value) : new Date(value);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
};

const ttAddDays = (value, days) => {
  const d = ttStartOfDay(value);
  d.setDate(d.getDate() + days);
  return d;
};

const ttDateRangeForPreset = (preset) => {
  const today = ttStartOfDay(new Date());
  switch (preset) {
    case 'today': return { startDate: ttFmtDate(today), endDate: ttFmtDate(today) };
    case 'yesterday': { const y = ttAddDays(today, -1); return { startDate: ttFmtDate(y), endDate: ttFmtDate(y) }; }
    case 'thisWeek': { const ws = ttAddDays(today, -today.getDay()); return { startDate: ttFmtDate(ws), endDate: ttFmtDate(today) }; }
    case 'last7Days': return { startDate: ttFmtDate(ttAddDays(today, -6)), endDate: ttFmtDate(today) };
    case 'thisMonth': return { startDate: ttFmtDate(new Date(today.getFullYear(), today.getMonth(), 1)), endDate: ttFmtDate(today) };
    case 'lastMonth': {
      const pms = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const pme = new Date(today.getFullYear(), today.getMonth(), 0);
      return { startDate: ttFmtDate(pms), endDate: ttFmtDate(pme) };
    }
    default: return { startDate: '', endDate: '' };
  }
};

const ttFindField = (rowData = {}, aliases = []) => {
  const keys = Object.keys(rowData || {});
  const normAliases = aliases.map((a) => ttNormKey(a));
  for (const key of keys) { if (normAliases.includes(ttNormKey(key))) return key; }
  for (const alias of normAliases) { const m = keys.find((k) => ttNormKey(k).startsWith(alias)); if (m) return m; }
  for (const alias of normAliases) { const m = keys.find((k) => ttNormKey(k).includes(alias)); if (m) return m; }
  return null;
};

const TT_STAGE_ALIASES = ['data stage', 'datastage'];
const TT_ID_ALIASES = ['issue id', 'id', 'task id', 'card id', 'row id'];
const TT_TITLE_ALIASES = ['title', 'issue title', 'task title', 'name'];
const TT_PROJECT_ALIASES = ['project name', 'project', 'projectname'];

const ttParseNotes = (value) => {
  if (!Array.isArray(value)) return [];
  return value.map((n) => ({ text: ttNormVal(n?.text), timestamp: ttToMs(n?.timestamp) })).filter((n) => n.text);
};

const ttGetEntryTs = (entry) => {
  const direct = ttToMs(entry?.endedAt) || ttToMs(entry?.startedAt) || ttToMs(entry?.completionAt);
  if (direct) return direct;
  if (!Array.isArray(entry?.notes) || !entry.notes.length) return 0;
  return entry.notes.reduce((max, n) => { const ts = ttToMs(n?.timestamp); return ts > max ? ts : max; }, 0);
};

const ttFmtDuration = (ms) => {
  const totalMinutes = Math.max(0, Math.floor((Number(ms) || 0) / 60000));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h > 0 && m > 0) return `${h} hr ${m} min`;
  if (h > 0) return `${h} hr`;
  return `${m} min`;
};

const ttMsToHrs = (ms) => {
  const totalMinutes = Math.round((Number(ms) || 0) / 60000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return m >= 30 ? h + 1 : h;
};

const ttFmtDateTime = (ms) => {
  if (!ms) return '—';
  const d = new Date(Number(ms));
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  }).format(d);
};

const ttFmtTimeOnly = (ms) => {
  if (!ms) return '—';
  const d = new Date(Number(ms));
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(d);
};

const ttFmtDateOnly = (ms) => {
  if (!ms) return '—';
  const d = new Date(Number(ms));
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(d);
};

const TT_PRESETS = [
  { value: 'allTime', label: 'All Time' },
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'thisWeek', label: 'This Week' },
  { value: 'last7Days', label: 'Last 7 Days' },
  { value: 'thisMonth', label: 'This Month' },
  { value: 'lastMonth', label: 'Last Month' },
  { value: 'custom', label: 'Custom' },
];
// ─────────────────────────────────────────────────────────────────────────────

const BudgetPage = () => {
  const { id, invoiceId: routeInvoiceId } = useParams();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = routeInvoiceId ? 'invoice-log' : getResolvedBudgetTab(searchParams.get('tab'));
  const [isLoading, setIsLoading] = useState(true);
  const [moduleAccessLoading, setModuleAccessLoading] = useState(true);
  const [hasBudgetModuleAccess, setHasBudgetModuleAccess] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState(urlTab);
  const [dashboardCompanyId, setDashboardCompanyId] = useState('');
  const [dashboardProjectId, setDashboardProjectId] = useState('');
  const [dashboardContractId, setDashboardContractId] = useState('');
  const [showDashboardPreferences, setShowDashboardPreferences] = useState(false);
  const [defaultPreferenceCompanyId, setDefaultPreferenceCompanyId] = useState('');
  const [defaultPreferenceProjectId, setDefaultPreferenceProjectId] = useState('');
    const [contractActionKey, setContractActionKey] = useState('');
  const [outScopeContractTargetByItem, setOutScopeContractTargetByItem] = useState({});

  const normalizeLineItemForMoveHistory = (lineItem) => ({
    id: lineItem.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    description: String(lineItem.description || ''),
    rate: parseCurrencyNumber(lineItem.rate),
    quantity: parseCurrencyNumber(lineItem.quantity),
    includeInContract: lineItem.includeInContract !== false,
  });
  const [isSavingDashboardPreferences, setIsSavingDashboardPreferences] = useState(false);
  const [lineItemActionKey, setLineItemActionKey] = useState('');
  const [invoiceLogSearchTerm, setInvoiceLogSearchTerm] = useState('');
  const [invoiceLogCompanyId, setInvoiceLogCompanyId] = useState('');
  const [invoiceLogProjectId, setInvoiceLogProjectId] = useState('');
  const [invoiceLogContractId, setInvoiceLogContractId] = useState('');
  const [invoiceCategories, setInvoiceCategories] = useState([]);
  const [invoiceCategoryName, setInvoiceCategoryName] = useState('');
  const [editingInvoiceCategoryId, setEditingInvoiceCategoryId] = useState(null);
  const [invoiceCategoryActionKey, setInvoiceCategoryActionKey] = useState('');
  const [orgName, setOrgName] = useState('');
  const [orgLogoUrl, setOrgLogoUrl] = useState('');
  const [isDownloadingInvoicePdf, setIsDownloadingInvoicePdf] = useState(false);
  const [isDownloadingWorkOrdersPdf, setIsDownloadingWorkOrdersPdf] = useState(false);
  const [workOrderNoteDrafts, setWorkOrderNoteDrafts] = useState({});
  const [workOrderSavingNoteKey, setWorkOrderSavingNoteKey] = useState('');
  const [workOrderHoveredNoteKey, setWorkOrderHoveredNoteKey] = useState('');
  const [workOrderEditingNoteKey, setWorkOrderEditingNoteKey] = useState('');
  const invoicePdfRef = useRef(null);

  const [companies, setCompanies] = useState([]);
  const [projects, setProjects] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [invoices, setInvoices] = useState([]);

  const [companyForm, setCompanyForm] = useState(emptyCompanyForm);
  const [editingCompanyId, setEditingCompanyId] = useState(null);

  const [projectForm, setProjectForm] = useState(emptyProjectForm);
  const [editingProjectId, setEditingProjectId] = useState(null);

  const [contractForm, setContractForm] = useState(emptyContractForm);
  const [editingContractId, setEditingContractId] = useState(null);

  const [invoiceForm, setInvoiceForm] = useState(createEmptyInvoiceForm);
  const [editingInvoiceId, setEditingInvoiceId] = useState(null);

  const companiesRef = useMemo(() => collection(db, 'churches', id, 'budgetCompanies'), [id]);
  const projectsRef = useMemo(() => collection(db, 'churches', id, 'budgetProjects'), [id]);
  const contractsRef = useMemo(() => collection(db, 'churches', id, 'budgetContracts'), [id]);
  const invoicesRef = useMemo(() => collection(db, 'churches', id, 'budgetInvoices'), [id]);
  const invoiceCategoriesRef = useMemo(() => collection(db, 'churches', id, 'budgetInvoiceCategories'), [id]);

  const companyById = useMemo(() => {
    return companies.reduce((acc, company) => {
      acc[company.id] = company;
      return acc;
    }, {});
  }, [companies]);

  const projectById = useMemo(() => {
    return projects.reduce((acc, project) => {
      acc[project.id] = project;
      return acc;
    }, {});
  }, [projects]);

  const contractsByProjectId = useMemo(() => {
    return contracts.reduce((accumulator, contract) => {
      const projectId = contract.projectId;
      if (!projectId) return accumulator;
      if (!accumulator[projectId]) {
        accumulator[projectId] = [];
      }
      accumulator[projectId].push(contract);
      return accumulator;
    }, {});
  }, [contracts]);

  const contractById = useMemo(() => {
    return contracts.reduce((accumulator, contract) => {
      accumulator[contract.id] = contract;
      return accumulator;
    }, {});
  }, [contracts]);

  const invoiceCategoryById = useMemo(() => {
    return invoiceCategories.reduce((accumulator, category) => {
      accumulator[category.id] = category;
      return accumulator;
    }, {});
  }, [invoiceCategories]);

  const invoiceLinkedContractIds = useMemo(() => {
    return contracts.reduce((accumulator, contract) => {
      const movedItems = Array.isArray(contract.movedLineItems) ? contract.movedLineItems : [];
      movedItems.forEach((entry) => {
        if (entry?.revertedAt) return;
        const sourceInvoiceId = String(entry?.sourceInvoiceId || '').trim();
        if (!sourceInvoiceId) return;
        if (!accumulator[sourceInvoiceId]) {
          accumulator[sourceInvoiceId] = [];
        }
        if (!accumulator[sourceInvoiceId].includes(contract.id)) {
          accumulator[sourceInvoiceId].push(contract.id);
        }
      });
      return accumulator;
    }, {});
  }, [contracts]);

  const projectOptionsForSelectedCompany = useMemo(() => {
    if (!contractForm.companyId) return projects;
    return projects.filter((project) => project.companyId === contractForm.companyId);
  }, [projects, contractForm.companyId]);

  const invoiceProjectOptions = useMemo(() => {
    if (!invoiceForm.companyId) return [];
    return sortByName(
      projects.filter((project) => project.companyId === invoiceForm.companyId),
      'name'
    );
  }, [projects, invoiceForm.companyId]);

  const invoiceContractOptions = useMemo(() => {
    if (!invoiceForm.projectId) return [];
    return sortByName(
      contracts.filter((contract) => contract.projectId === invoiceForm.projectId),
      'title'
    );
  }, [contracts, invoiceForm.projectId]);

  const projectBudgetTotals = useMemo(() => {
    return contracts.reduce((acc, contract) => {
      const projectId = contract.projectId;
      if (!projectId) return acc;
      acc[projectId] = (acc[projectId] || 0) + Number(contract.total || 0);
      return acc;
    }, {});
  }, [contracts]);

  const projectInvoiceTotals = useMemo(() => {
    return invoices.reduce((acc, invoice) => {
      const projectId = invoice.projectId;
      if (!projectId) return acc;
      acc[projectId] = (acc[projectId] || 0) + Number(invoice.contractAmount ?? invoice.amount ?? 0);
      return acc;
    }, {});
  }, [invoices]);

  const projectBudgetRows = useMemo(() => {
    return projects
      .map((project) => {
        const budgetTotal = Number(projectBudgetTotals[project.id] || 0);
        const invoicedTotal = Number(projectInvoiceTotals[project.id] || 0);
        return {
          projectId: project.id,
          projectName: project.name,
          companyName: companyById[project.companyId]?.name || 'Unassigned',
          budgetTotal,
          invoicedTotal,
          remainingTotal: budgetTotal - invoicedTotal,
        };
      })
      .sort((left, right) => left.projectName.localeCompare(right.projectName));
  }, [projects, projectBudgetTotals, projectInvoiceTotals, companyById]);

  const filteredContracts = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    if (!normalizedSearch) return contracts;

    return contracts.filter((contract) => {
      const companyName = companyById[contract.companyId]?.name || '';
      const projectName = projectById[contract.projectId]?.name || '';

      return [contract.title, companyName, projectName, contract.notes]
        .join(' ')
        .toLowerCase()
        .includes(normalizedSearch);
    });
  }, [contracts, companyById, projectById, searchTerm]);

  const filteredInvoices = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    const sortedInvoices = [...invoices].sort((left, right) => {
      const leftProject = projectById[left.projectId]?.name || '';
      const rightProject = projectById[right.projectId]?.name || '';
      const projectCompare = leftProject.localeCompare(rightProject);
      if (projectCompare !== 0) return projectCompare;
      return Number(left.workWeek || 0) - Number(right.workWeek || 0);
    });

    if (!normalizedSearch) return sortedInvoices;

    return sortedInvoices.filter((invoice) => {
      const projectName = projectById[invoice.projectId]?.name || '';
      const companyName = companyById[invoice.companyId]?.name || '';
      const categoryName = invoiceCategoryById[String(invoice.categoryId || '').trim()]?.name || 'Invoice';
      const lineItemText = Array.isArray(invoice.lineItems)
        ? invoice.lineItems.map((item) => item?.description || '').join(' ')
        : '';
      return [
        projectName,
        companyName,
        categoryName,
        String(invoice.workWeek || ''),
        String(invoice.invoiceNumber || ''),
        invoice.notes || '',
        lineItemText,
      ]
        .join(' ')
        .toLowerCase()
        .includes(normalizedSearch);
    });
  }, [invoices, projectById, companyById, invoiceCategoryById, searchTerm]);

  const invoiceLogProjectOptions = useMemo(() => {
    if (!invoiceLogCompanyId) return sortByName(projects, 'name');
    return sortByName(
      projects.filter((project) => project.companyId === invoiceLogCompanyId),
      'name'
    );
  }, [projects, invoiceLogCompanyId]);

  const invoiceLogContractOptions = useMemo(() => {
    if (invoiceLogProjectId) {
      return sortByName(
        contracts.filter((contract) => contract.projectId === invoiceLogProjectId),
        'title'
      );
    }

    if (invoiceLogCompanyId) {
      const companyProjectIds = new Set(
        projects.filter((project) => project.companyId === invoiceLogCompanyId).map((project) => project.id)
      );
      return sortByName(
        contracts.filter((contract) => companyProjectIds.has(contract.projectId)),
        'title'
      );
    }

    return sortByName(contracts, 'title');
  }, [contracts, projects, invoiceLogProjectId, invoiceLogCompanyId]);

  const invoiceLogRows = useMemo(() => {
    const normalizedSearch = invoiceLogSearchTerm.trim().toLowerCase();

    const rows = [...invoices]
      .sort((left, right) => {
        const leftProject = projectById[left.projectId]?.name || '';
        const rightProject = projectById[right.projectId]?.name || '';
        const projectCompare = leftProject.localeCompare(rightProject);
        if (projectCompare !== 0) return projectCompare;
        return Number(left.workWeek || 0) - Number(right.workWeek || 0);
      })
      .map((invoice) => {
        const projectContracts = contractsByProjectId[invoice.projectId] || [];
        const projectContractNames = projectContracts.map((contract) => contract.title || 'Untitled Contract');
        const directContractId = String(invoice.contractId || '').trim();
        const linkedContractIds = invoiceLinkedContractIds[invoice.id] || [];
        const resolvedContractIds = Array.from(new Set([directContractId, ...linkedContractIds].filter(Boolean)));
        const resolvedContractNames = resolvedContractIds
          .map((contractId) => contractById[contractId]?.title || 'Untitled Contract')
          .filter(Boolean);
        const displayContractNames = resolvedContractNames.length > 0 ? resolvedContractNames : projectContractNames;
        const categoryId = String(invoice.categoryId || '').trim();
        const categoryName = invoiceCategoryById[categoryId]?.name || 'Invoice';
        const lineItemText = Array.isArray(invoice.lineItems)
          ? invoice.lineItems.map((item) => item?.description || '').join(' ')
          : '';

        return {
          ...invoice,
          categoryId,
          categoryName,
          projectContracts,
          linkedContractIds: resolvedContractIds,
          contractNames: displayContractNames,
          projectName: projectById[invoice.projectId]?.name || 'Unknown',
          companyName: companyById[invoice.companyId]?.name || 'Unknown',
          searchableText: [
            projectById[invoice.projectId]?.name || '',
            companyById[invoice.companyId]?.name || '',
            categoryName,
            displayContractNames.join(' '),
            String(invoice.workWeek || ''),
            String(invoice.invoiceNumber || ''),
            invoice.notes || '',
            lineItemText,
          ]
            .join(' ')
            .toLowerCase(),
        };
      });

    return rows.filter((invoice) => {
      if (invoiceLogCompanyId && invoice.companyId !== invoiceLogCompanyId) {
        return false;
      }

      if (invoiceLogProjectId && invoice.projectId !== invoiceLogProjectId) {
        return false;
      }

      if (invoiceLogContractId) {
        if (!invoice.linkedContractIds.includes(invoiceLogContractId)) {
          return false;
        }
      }

      if (normalizedSearch && !invoice.searchableText.includes(normalizedSearch)) {
        return false;
      }

      return true;
    });
  }, [
    invoices,
    projectById,
    companyById,
    invoiceCategoryById,
    contractById,
    contractsByProjectId,
    invoiceLinkedContractIds,
    invoiceLogSearchTerm,
    invoiceLogCompanyId,
    invoiceLogProjectId,
    invoiceLogContractId,
  ]);

  const viewingInvoiceId = activeTab === 'invoice-log'
    ? String(routeInvoiceId || searchParams.get('invoiceId') || '').trim()
    : '';

  const viewingInvoiceRecord = useMemo(
    () => invoiceLogRows.find((invoice) => invoice.id === viewingInvoiceId) || null,
    [invoiceLogRows, viewingInvoiceId]
  );

  const invoiceLogViewMode = viewingInvoiceId
    ? String(searchParams.get('view') || 'invoice').trim().toLowerCase()
    : 'invoice';
  const isWorkOrdersViewMode = invoiceLogViewMode === 'work-orders';

  const openInvoiceLogView = (invoiceId) => {
    navigate(`/organization/${id}/budget/invoices/${encodeURIComponent(String(invoiceId || ''))}`);
  };

  const openInvoiceLogWorkOrdersView = (invoiceId) => {
    const encodedId = encodeURIComponent(String(invoiceId || ''));
    navigate(`/organization/${id}/budget/invoices/${encodedId}?view=work-orders`);
  };

  const closeInvoiceLogView = () => {
    navigate(`/organization/${id}/budget?tab=invoice-log`);
  };

  const getWorkOrderNoteKey = (sessionRow, noteIndex) => {
    return [
      String(sessionRow?.lineItemId || ''),
      String(sessionRow?.lineItemIndex ?? ''),
      String(sessionRow?.sourceLineIndex ?? ''),
      String(noteIndex),
    ].join('__');
  };

  const handleSaveWorkOrderSessionNote = async (sessionRow, noteIndex, originalNote) => {
    if (!viewingInvoiceRecord?.id) {
      toast.error('No invoice is selected.');
      return;
    }

    const noteKey = getWorkOrderNoteKey(sessionRow, noteIndex);
    const hasDraft = Object.prototype.hasOwnProperty.call(workOrderNoteDrafts, noteKey);
    const draftValue = hasDraft ? workOrderNoteDrafts[noteKey] : originalNote;
    const nextNoteText = String(draftValue || '').trim();
    const currentNoteText = String(originalNote || '').trim();

    if (nextNoteText === currentNoteText) {
      return;
    }

    const targetLineIndex = Array.isArray(sessionRow?.noteLineIndices)
      ? Number(sessionRow.noteLineIndices[noteIndex])
      : -1;
    const hasExistingNoteLine = Number.isInteger(targetLineIndex) && targetLineIndex >= 0;

    try {
      setWorkOrderSavingNoteKey(noteKey);

      const currentLineItems = Array.isArray(viewingInvoiceRecord.lineItems)
        ? [...viewingInvoiceRecord.lineItems]
        : [];
      if (currentLineItems.length === 0) {
        toast.error('No invoice line items were found to update.');
        return;
      }

      let targetLineItemIndex = -1;
      if (sessionRow?.lineItemId) {
        targetLineItemIndex = currentLineItems.findIndex(
          (lineItem) => String(lineItem?.id || '') === String(sessionRow.lineItemId || ''),
        );
      }
      if (targetLineItemIndex < 0) {
        targetLineItemIndex = Number(sessionRow?.lineItemIndex ?? -1);
      }
      if (!Number.isInteger(targetLineItemIndex) || targetLineItemIndex < 0 || targetLineItemIndex >= currentLineItems.length) {
        toast.error('Could not locate the invoice line item for that note.');
        return;
      }

      const targetLineItem = { ...currentLineItems[targetLineItemIndex] };
      const descriptionLines = String(targetLineItem.description || '').split('\n');
      if (hasExistingNoteLine) {
        if (targetLineIndex >= descriptionLines.length) {
          toast.error('Could not locate the note in the invoice description.');
          return;
        }

        const existingLine = String(descriptionLines[targetLineIndex] || '');
        const noteIndentMatch = existingLine.match(/^(\s*)Note:\s*/i);
        const noteIndent = noteIndentMatch ? noteIndentMatch[1] : '';
        descriptionLines[targetLineIndex] = `${noteIndent}Note: ${nextNoteText}`;
      } else {
        const sessionLineIndex = Number(sessionRow?.sourceLineIndex ?? -1);
        if (!Number.isInteger(sessionLineIndex) || sessionLineIndex < 0 || sessionLineIndex >= descriptionLines.length) {
          toast.error('Could not locate where to add this note in the invoice description.');
          return;
        }
        const sessionLine = String(descriptionLines[sessionLineIndex] || '');
        const sessionIndentMatch = sessionLine.match(/^(\s*)Session:/i);
        const noteIndent = `${sessionIndentMatch ? sessionIndentMatch[1] : ''}  `;
        descriptionLines.splice(sessionLineIndex + 1, 0, `${noteIndent}Note: ${nextNoteText}`);
      }
      targetLineItem.description = descriptionLines.join('\n');
      currentLineItems[targetLineItemIndex] = targetLineItem;

      await updateDoc(doc(db, 'churches', id, 'budgetInvoices', viewingInvoiceRecord.id), {
        lineItems: currentLineItems,
        updatedAt: serverTimestamp(),
      });

      setWorkOrderNoteDrafts((current) => {
        const next = { ...current };
        delete next[noteKey];
        return next;
      });
      setWorkOrderEditingNoteKey('');

      await loadBudgetData();
      toast.success('Work order note updated.');
    } catch (error) {
      console.error('Failed updating work order note:', error);
      toast.error('Could not update this note right now.');
    } finally {
      setWorkOrderSavingNoteKey('');
    }
  };

  const downloadInvoicePdf = async () => {
    if (!viewingInvoiceRecord || !invoicePdfRef.current || isDownloadingInvoicePdf) {
      return;
    }

    const logoImgEl = invoicePdfRef.current.querySelector('[data-invoice-logo="true"]');
    const originalLogoSrc = logoImgEl ? (logoImgEl.getAttribute('src') || '') : '';
    let swappedLogo = false;

    try {
      setIsDownloadingInvoicePdf(true);

      // Fetch the logo as a data URL and swap it into the real DOM element
      // before html2canvas runs so it captures an already-loaded image, not
      // a cross-origin URL that html2canvas cannot read.
      if (orgLogoUrl && logoImgEl) {
        // Try multiple strategies to get the logo as a data URL that
        // html2canvas can read without cross-origin taint restrictions.
        const tryFetchLogoAsDataUrl = async (url) => {
          // Strategy 1: plain fetch (works for Firebase Storage which has CORS configured)
          try {
            const response = await fetch(url, { mode: 'cors' });
            if (response.ok) {
              const blob = await response.blob();
              return await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : '');
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(blob);
              });
            }
          } catch (_) { /* fall through */ }

          // Strategy 2: load a fresh <img> with crossOrigin=anonymous then draw to canvas
          // Works when the server sends Access-Control-Allow-Origin headers
          try {
            const dataUrl = await new Promise((resolve, reject) => {
              const img = new Image();
              img.crossOrigin = 'anonymous';
              img.onload = () => {
                try {
                  const c = document.createElement('canvas');
                  c.width = img.naturalWidth || 1;
                  c.height = img.naturalHeight || 1;
                  const ctx = c.getContext('2d');
                  if (!ctx) { reject(new Error('No canvas ctx')); return; }
                  ctx.drawImage(img, 0, 0);
                  resolve(c.toDataURL('image/png'));
                } catch (e) { reject(e); }
              };
              img.onerror = () => reject(new Error('Image load failed'));
              // Bust cache so the browser re-requests with CORS headers
              img.src = url.includes('?') ? `${url}&_cors=1` : `${url}?_cors=1`;
            });
            if (dataUrl) return dataUrl;
          } catch (_) { /* fall through */ }

          return '';
        };

        try {
          const logoDataUrl = await tryFetchLogoAsDataUrl(orgLogoUrl);
          if (logoDataUrl) {
            logoImgEl.setAttribute('src', logoDataUrl);
            swappedLogo = true;
            // Give the browser one frame to render the swapped src
            await new Promise((resolve) => window.requestAnimationFrame(resolve));
          }
        } catch (logoError) {
          console.warn('Could not pre-embed invoice logo for PDF; logo may appear blank.', logoError);
        }
      }

      const canvas = await html2canvas(invoicePdfRef.current, {
        scale: 2,
        useCORS: true,
        allowTaint: false,
        backgroundColor: '#ffffff',
        logging: false,
        imageTimeout: 0,
      });

      const imageData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 24;
      const contentWidth = pageWidth - margin * 2;
      const imageHeight = (canvas.height * contentWidth) / canvas.width;
      let remainingHeight = imageHeight;
      let offsetY = margin;

      pdf.addImage(imageData, 'PNG', margin, offsetY, contentWidth, imageHeight, undefined, 'FAST');
      remainingHeight -= pageHeight - margin * 2;

      while (remainingHeight > 0) {
        pdf.addPage();
        offsetY = margin - (imageHeight - remainingHeight);
        pdf.addImage(imageData, 'PNG', margin, offsetY, contentWidth, imageHeight, undefined, 'FAST');
        remainingHeight -= pageHeight - margin * 2;
      }

      const safeInvoiceNumber = String(viewingInvoiceRecord.invoiceNumber || viewingInvoiceRecord.id || 'invoice')
        .replace(/[^a-z0-9-_]+/gi, '-')
        .replace(/^-+|-+$/g, '') || 'invoice';

      const pdfBlob = pdf.output('blob');
      const pdfBlobUrl = URL.createObjectURL(pdfBlob);
      window.open(pdfBlobUrl, '_blank', 'noopener,noreferrer');
      // Revoke after a delay so the new tab has time to load the PDF
      window.setTimeout(() => URL.revokeObjectURL(pdfBlobUrl), 30000);
    } catch (error) {
      console.error('Failed to download invoice PDF', error);
      toast.error('Unable to download invoice PDF right now.');
    } finally {
      // Always restore the logo src so the on-screen view still shows the logo
      if (swappedLogo && logoImgEl && originalLogoSrc) {
        logoImgEl.setAttribute('src', originalLogoSrc);
      }
      setIsDownloadingInvoicePdf(false);
    }
  };

  const downloadWorkOrdersPdf = async (invoiceToRender) => {
    const invoice = invoiceToRender || viewingInvoiceRecord;
    if (!invoice || isDownloadingWorkOrdersPdf) return;

    setIsDownloadingWorkOrdersPdf(true);

    try {
      // Fetch logo as data URL using same two-strategy approach as downloadInvoicePdf
      let logoDataUrl = '';
      if (orgLogoUrl) {
        const tryFetchLogoDataUrl = async (url) => {
          try {
            const res = await fetch(url, { mode: 'cors' });
            if (res.ok) {
              const blob = await res.blob();
              return await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : '');
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(blob);
              });
            }
          } catch (_) { /* fall through */ }
          try {
            return await new Promise((resolve, reject) => {
              const img = new Image();
              img.crossOrigin = 'anonymous';
              img.onload = () => {
                try {
                  const c = document.createElement('canvas');
                  c.width = img.naturalWidth || 1;
                  c.height = img.naturalHeight || 1;
                  const ctx = c.getContext('2d');
                  if (!ctx) { reject(new Error('No canvas ctx')); return; }
                  ctx.drawImage(img, 0, 0);
                  resolve(c.toDataURL('image/png'));
                } catch (e) { reject(e); }
              };
              img.onerror = () => reject(new Error('Image load failed'));
              img.src = url.includes('?') ? `${url}&_cors=1` : `${url}?_cors=1`;
            });
          } catch (_) { /* no logo */ }
          return '';
        };
        try { logoDataUrl = await tryFetchLogoDataUrl(orgLogoUrl); } catch (_) { /* no logo */ }
      }

      const lineItems =
        Array.isArray(invoice.lineItems) && invoice.lineItems.length > 0
          ? invoice.lineItems
          : [{ description: String(invoice.notes || ''), rate: String(invoice.amount ?? 0), quantity: '1' }];
      const workOrderPages = buildDailyWorkOrderPages(lineItems);

      const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = 48;
      const contentW = pageW - margin * 2;
      const logoSize = 90;

      const totalWorkOrderDocumentPages = workOrderPages.length + 1;
      const workOrderLogEntries = workOrderPages.map((workOrderPage, index) => ({
        workOrderDayId: workOrderPage.workOrderDayId || `WO-UNDATED-${String(index + 1).padStart(2, '0')}`,
        dayLabel: workOrderPage.dayLabel || 'Work Day',
        description: buildWorkOrderLogDescription(workOrderPage),
        totalHours: Number(workOrderPage.totalHours || 0),
        pageNumber: index + 2,
      }));

      // First page: Work Order Log summary
      {
        let y = margin;
        if (logoDataUrl) {
          try {
            const logLogoSize = 84;
            const centeredX = (pageW - logLogoSize) / 2;
            pdf.addImage(logoDataUrl, 'PNG', centeredX, y, logLogoSize, logLogoSize, undefined, 'FAST');
            y += logLogoSize + 10;
          } catch (_) { /* logo failed to embed */ }
        }
        pdf.setFontSize(24);
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(185, 28, 28);
        pdf.text('WORK ORDER LOG', margin, y + 12);

        pdf.setFontSize(10);
        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(107, 114, 128);
        pdf.text(`#${invoice.invoiceNumber || 'Draft'}`, margin, y + 30);
        pdf.text(
          normalizePdfText(`Week ${invoice.workWeek || '-'} | ${formatWorkOrderHeaderDate(invoice.weekStartDate)} to ${formatWorkOrderHeaderDate(invoice.weekEndDate)}`),
          margin,
          y + 44,
        );
        y += 64;

        pdf.setDrawColor(209, 213, 219);
        pdf.setLineWidth(0.75);
        pdf.rect(margin, y, contentW, 22);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(9);
        pdf.setTextColor(75, 85, 99);
        const idColX = margin;
        const dayColX = margin + Math.round(contentW * 0.24);
        const descColX = margin + Math.round(contentW * 0.40);
        const hoursColX = margin + Math.round(contentW * 0.82);
        const pageColX = margin + Math.round(contentW * 0.92);
        const descColW = Math.round(contentW * 0.42);

        pdf.text('Work Order ID', idColX + 6, y + 14);
        pdf.text('Day', dayColX + 6, y + 14);
        pdf.text('Description', descColX + 6, y + 14);
        pdf.text('Hours', hoursColX + 6, y + 14);
        pdf.text('Page', pageColX + 6, y + 14);
        y += 22;

        workOrderLogEntries.forEach((entry) => {
          const descriptionLines = pdf.splitTextToSize(normalizePdfText(entry.description || '—'), Math.max(80, descColW - 10));
          const rowHeight = Math.max(18, descriptionLines.length * 10 + 6);
          if (y + rowHeight > pageH - margin - 20) {
            pdf.addPage();
            y = margin;
          }
          pdf.setDrawColor(229, 231, 235);
          pdf.setLineWidth(0.5);
          pdf.line(margin, y + rowHeight, pageW - margin, y + rowHeight);
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(9);
          pdf.setTextColor(17, 24, 39);
          pdf.text(normalizePdfText(entry.workOrderDayId), idColX + 6, y + 12);
          pdf.text(normalizePdfText(entry.dayLabel), dayColX + 6, y + 12);
          pdf.text(descriptionLines, descColX + 6, y + 12);
          pdf.text(`${formatWorkOrderHours(entry.totalHours)} hrs`, hoursColX + 6, y + 12);
          pdf.text(String(entry.pageNumber), pageColX + 6, y + 12);
          y += rowHeight;
        });

        const sigY = pageH - margin - 48;
        pdf.setFontSize(9);
        pdf.setTextColor(107, 114, 128);
        pdf.text(`Page 1 of ${totalWorkOrderDocumentPages}`, pageW - margin, sigY + 14, { align: 'right' });
      }

      workOrderPages.forEach((workOrderPage, pageIndex) => {
        pdf.addPage();
        const workOrderPageNumber = pageIndex + 2;
        let y = margin;

        // Logo (top-left)
        if (logoDataUrl) {
          try {
            pdf.addImage(logoDataUrl, 'PNG', margin, y, logoSize, logoSize, undefined, 'FAST');
          } catch (_) { /* logo failed to embed */ }
        }

        // Category label / "WORK ORDER" heading (top-right, red)
        pdf.setFontSize(26);
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(185, 28, 28);
        pdf.text('WORK ORDER', pageW - margin, y + 26, { align: 'right' });

        // Invoice # and week range (below heading, muted)
        pdf.setFontSize(10);
        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(107, 114, 128);
        pdf.text(`#${invoice.invoiceNumber || 'Draft'}`, pageW - margin, y + 44, { align: 'right' });
        pdf.text(
          normalizePdfText(`Week ${invoice.workWeek || '-'} | ${formatWorkOrderHeaderDate(invoice.weekStartDate)} to ${formatWorkOrderHeaderDate(invoice.weekEndDate)}`),
          pageW - margin,
          y + 58,
          { align: 'right' },
        );
        pdf.text(normalizePdfText(`Day ${workOrderPage.dayLabel || 'Work Day'}`), pageW - margin, y + 72, { align: 'right' });
        pdf.text(normalizePdfText(`ID ${workOrderPage.workOrderDayId || 'WO-UNDATED'}`), pageW - margin, y + 86, { align: 'right' });
        pdf.text(`Page ${workOrderPageNumber} of ${totalWorkOrderDocumentPages}`, pageW - margin, y + 100, { align: 'right' });

        // Org name below logo (or at top if no logo)
        const orgNameY = logoDataUrl ? y + logoSize + 12 : y + 16;
        pdf.setFontSize(12);
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(17, 24, 39);
        if (orgName) pdf.text(orgName, margin, orgNameY);
        y = Math.max(orgNameY + 18, y + logoSize + 28);

        // Separator
        pdf.setDrawColor(17, 24, 39);
        pdf.setLineWidth(1.5);
        pdf.line(margin, y, pageW - margin, y);
        y += 20;

        // Intro lines + session table
        const descLines = workOrderPage.descriptionLines || [];
        const prefaceLines = descLines.filter((line) => {
          const trimmed = normalizePdfText(line).trim();
          return trimmed
            && !/^Session:/i.test(trimmed)
            && !/^\s*Note:/i.test(trimmed)
            && !/^Day:/i.test(trimmed)
            && !/^Time Tracker Hours/i.test(trimmed)
            && !/^Date range:/i.test(trimmed)
            && !/^Total:/i.test(trimmed)
            && !/^Duration:/i.test(trimmed);
        });
        for (const rawLine of prefaceLines) {
          const text = normalizePdfText(rawLine).trimEnd();
          if (!text) continue;
          pdf.setFontSize(10);
          pdf.setFont('helvetica', 'normal');
          pdf.setTextColor(17, 24, 39);
          const wrapped = pdf.splitTextToSize(text, contentW);
          pdf.text(wrapped, margin, y);
          y += wrapped.length * 13 + 2;
        }

        const sessionRows = Array.isArray(workOrderPage.sessionRows) ? workOrderPage.sessionRows : [];
        if (sessionRows.length > 0) {
          y += 8;
          const dateColX = margin;
          const hoursColX = margin + Math.round(contentW * 0.5);
          const employeeColX = margin + Math.round(contentW * 0.68);

          pdf.setDrawColor(209, 213, 219);
          pdf.setLineWidth(0.75);
          pdf.rect(margin, y, contentW, 20);
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(9);
          pdf.setTextColor(75, 85, 99);
          pdf.text('Date', dateColX + 6, y + 13);
          pdf.text('Total Hours', hoursColX + 6, y + 13);
          pdf.text('Employee', employeeColX + 6, y + 13);
          y += 20;

          sessionRows.forEach((row) => {
            if (y + 18 > pageH - 150) {
              pdf.addPage();
              y = margin;
            }
            pdf.setDrawColor(229, 231, 235);
            pdf.setLineWidth(0.5);
            pdf.line(margin, y + 18, pageW - margin, y + 18);

            pdf.setFont('helvetica', 'normal');
            pdf.setFontSize(9);
            pdf.setTextColor(17, 24, 39);
            pdf.text(normalizePdfText(row.date || workOrderPage.dayLabel || '—'), dateColX + 6, y + 12);
            pdf.text(String(Number(row.hours || 0).toFixed(2)), hoursColX + 6, y + 12);
            pdf.text(normalizePdfText(row.employee || '—'), employeeColX + 6, y + 12);
            y += 18;

            if (Array.isArray(row.notes) && row.notes.length > 0) {
              row.notes.forEach((note) => {
                const safeNote = normalizePdfText(note || '').trim();
                if (!safeNote) return;
                const noteWrapped = pdf.splitTextToSize(`- ${safeNote}`, contentW - 16);
                pdf.setFont('helvetica', 'italic');
                pdf.setFontSize(8);
                pdf.setTextColor(107, 114, 128);
                pdf.text(noteWrapped, margin + 10, y + 10);
                y += noteWrapped.length * 10;
              });
            }
          });
        }

        // Total hours worked
        const totalHoursWorked = Number(workOrderPage.totalHours || 0);
        y += 14;
        pdf.setDrawColor(229, 231, 235);
        pdf.setLineWidth(0.5);
        pdf.line(margin, y, pageW - margin, y);
        y += 16;
        pdf.setFontSize(11);
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(17, 24, 39);
        pdf.text('Total Hours Worked:', margin, y);
        pdf.text(
          `${formatWorkOrderHours(totalHoursWorked)} hrs`,
          pageW - margin,
          y,
          { align: 'right' },
        );

        // Invoice-level notes (first page only)
        if (pageIndex === 0 && invoice.notes) {
          y += 24;
          if (y < pageH - 140) {
            pdf.setFontSize(8);
            pdf.setFont('helvetica', 'bold');
            pdf.setTextColor(156, 163, 175);
            pdf.text('NOTES', margin, y);
            y += 13;
            pdf.setFont('helvetica', 'normal');
            pdf.setTextColor(55, 65, 81);
            const noteWrapped = pdf.splitTextToSize(normalizePdfText(invoice.notes), contentW);
            if (y + noteWrapped.length * 12 < pageH - 120) {
              pdf.text(noteWrapped, margin, y);
            }
          }
        }

        // Signature lines (fixed to bottom of each page)
        const sigY = pageH - margin - 48;
        pdf.setDrawColor(17, 24, 39);
        pdf.setLineWidth(0.5);
        pdf.line(margin, sigY, margin + 200, sigY);
        pdf.line(pageW - margin - 200, sigY, pageW - margin, sigY);
        pdf.setFontSize(9);
        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(107, 114, 128);
        pdf.text('Client Signature / Date', margin, sigY + 14);
        pdf.text('Contractor Signature / Date', pageW - margin, sigY + 14, { align: 'right' });
      });

      const pdfBlob = pdf.output('blob');
      const pdfBlobUrl = URL.createObjectURL(pdfBlob);
      window.open(pdfBlobUrl, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(pdfBlobUrl), 30000);
    } catch (error) {
      console.error('Failed to generate work orders PDF', error);
      toast.error('Unable to generate work orders PDF right now.');
    } finally {
      setIsDownloadingWorkOrdersPdf(false);
    }
  };

  const masterInvoiceIdByTimeline = useMemo(() => {
    const invoicesByTimeline = invoices.reduce((accumulator, invoice) => {
      const projectId = invoice.projectId;
      const contractId = invoice.contractId || '';
      const week = Number(invoice.workWeek || 0);
      if (!projectId || !Number.isFinite(week) || week < 1) return accumulator;

      const timelineKey = getInvoiceTimelineKey(projectId, contractId);

      if (!accumulator[timelineKey]) {
        accumulator[timelineKey] = [];
      }

      accumulator[timelineKey].push({
        id: invoice.id,
        workWeek: week,
        isMaster: invoice.isMaster === true,
      });

      return accumulator;
    }, {});

    return Object.entries(invoicesByTimeline).reduce((accumulator, [timelineKey, projectInvoices]) => {
      const sortedInvoices = [...projectInvoices].sort((left, right) => left.workWeek - right.workWeek);
      const explicitMaster = sortedInvoices.find((invoice) => invoice.isMaster);
      const resolvedMaster = explicitMaster || sortedInvoices[0];

      if (resolvedMaster) {
        accumulator[timelineKey] = {
          id: resolvedMaster.id,
          workWeek: resolvedMaster.workWeek,
          explicit: Boolean(explicitMaster),
        };
      }

      return accumulator;
    }, {});
  }, [invoices]);

  const editingInvoiceRecord = useMemo(() => {
    if (!editingInvoiceId) return null;
    return invoices.find((invoice) => invoice.id === editingInvoiceId) || null;
  }, [editingInvoiceId, invoices]);

  const isEditingExistingInvoice = Boolean(editingInvoiceRecord);

  const isEditingMasterInvoice = useMemo(() => {
    if (!isEditingExistingInvoice) return true;
    const currentProjectId = invoiceForm.projectId || editingInvoiceRecord?.projectId;
    const currentContractId = invoiceForm.contractId || editingInvoiceRecord?.contractId || '';
    const timelineKey = getInvoiceTimelineKey(currentProjectId, currentContractId);
    const masterId = masterInvoiceIdByTimeline[timelineKey]?.id;
    return masterId === editingInvoiceId;
  }, [
    isEditingExistingInvoice,
    invoiceForm.projectId,
    invoiceForm.contractId,
    editingInvoiceRecord,
    masterInvoiceIdByTimeline,
    editingInvoiceId,
  ]);

  const selectedInvoiceWeekStart = useMemo(() => {
    const weekNumber = Number(invoiceForm.workWeek);
    if (!invoiceForm.weekOneDate || !Number.isInteger(weekNumber) || weekNumber < 1) {
      return '';
    }
    return invoiceForm.weekOneDate;
  }, [invoiceForm.weekOneDate, invoiceForm.workWeek]);

  const selectedInvoiceWeekEnd = useMemo(() => {
    if (!selectedInvoiceWeekStart) return '';
    return addDaysToIsoDate(selectedInvoiceWeekStart, 6);
  }, [selectedInvoiceWeekStart]);

  const resolvedWeekOneStart = useMemo(() => {
    const weekNumber = Number(invoiceForm.workWeek);
    if (!selectedInvoiceWeekStart || !Number.isInteger(weekNumber) || weekNumber < 1) {
      return '';
    }
    return addDaysToIsoDate(selectedInvoiceWeekStart, -1 * (weekNumber - 1) * 7);
  }, [selectedInvoiceWeekStart, invoiceForm.workWeek]);

  const resolvedWeekOneEnd = useMemo(() => {
    if (!resolvedWeekOneStart) return '';
    return addDaysToIsoDate(resolvedWeekOneStart, 6);
  }, [resolvedWeekOneStart]);

  const invoiceLineItemsWithTotals = useMemo(() => {
    return (invoiceForm.lineItems || []).map((lineItem) => ({
      ...lineItem,
      lineTotal: computeLineItemTotal(lineItem),
    }));
  }, [invoiceForm.lineItems]);

  const invoiceContractTotal = useMemo(() => {
    return invoiceLineItemsWithTotals.reduce((sum, lineItem) => {
      if (lineItem.includeInContract === false) return sum;
      return sum + lineItem.lineTotal;
    }, 0);
  }, [invoiceLineItemsWithTotals]);

  const invoiceNonContractTotal = useMemo(() => {
    return invoiceLineItemsWithTotals.reduce((sum, lineItem) => {
      if (lineItem.includeInContract === false) {
        return sum + lineItem.lineTotal;
      }
      return sum;
    }, 0);
  }, [invoiceLineItemsWithTotals]);

  const invoiceGrandTotal = useMemo(() => {
    return invoiceLineItemsWithTotals.reduce((sum, lineItem) => sum + lineItem.lineTotal, 0);
  }, [invoiceLineItemsWithTotals]);

  const lineItemDescriptionSuggestions = useMemo(() => {
    if (!invoiceForm.projectId) return [];

    const suggestionsByDescription = new Map();
    const projectInvoices = invoices
      .filter((invoice) => invoice.projectId === invoiceForm.projectId)
      .sort((left, right) => Number(right.workWeek || 0) - Number(left.workWeek || 0));

    projectInvoices.forEach((invoice) => {
      (invoice.lineItems || []).forEach((lineItem) => {
        const description = String(lineItem?.description || '').trim();
        if (!description) return;

        const normalized = description.toLowerCase();
        if (suggestionsByDescription.has(normalized)) return;

        suggestionsByDescription.set(normalized, {
          description,
          rate: String(lineItem?.rate ?? ''),
          quantity: String(lineItem?.quantity ?? ''),
        });
      });
    });

    return Array.from(suggestionsByDescription.values()).sort((left, right) =>
      left.description.localeCompare(right.description)
    );
  }, [invoices, invoiceForm.projectId]);

  const lineItemSuggestionLookup = useMemo(() => {
    return lineItemDescriptionSuggestions.reduce((accumulator, suggestion) => {
      accumulator[suggestion.description.toLowerCase()] = suggestion;
      return accumulator;
    }, {});
  }, [lineItemDescriptionSuggestions]);

  const dashboardProjectOptions = useMemo(() => {
    if (!dashboardCompanyId) return [];
    return projects.filter((project) => project.companyId === dashboardCompanyId);
  }, [projects, dashboardCompanyId]);

  const defaultPreferenceProjectOptions = useMemo(() => {
    if (!defaultPreferenceCompanyId) return [];
    return projects.filter((project) => project.companyId === defaultPreferenceCompanyId);
  }, [projects, defaultPreferenceCompanyId]);

  const dashboardContracts = useMemo(() => {
    if (!dashboardProjectId) return [];
    return contracts.filter((contract) => contract.projectId === dashboardProjectId);
  }, [contracts, dashboardProjectId]);

  const selectedDashboardContract = useMemo(() => {
    if (!dashboardContractId) return null;
    return dashboardContracts.find((contract) => contract.id === dashboardContractId) || null;
  }, [dashboardContracts, dashboardContractId]);

  const selectedDashboardContractMovedItems = useMemo(() => {
    if (!selectedDashboardContract || !Array.isArray(selectedDashboardContract.movedLineItems)) return [];
    return selectedDashboardContract.movedLineItems.filter((entry) => !entry?.revertedAt);
  }, [selectedDashboardContract]);

  const selectedDashboardContractMovedTotal = useMemo(() => {
    return selectedDashboardContractMovedItems.reduce((sum, entry) => sum + Number(entry?.amount || 0), 0);
  }, [selectedDashboardContractMovedItems]);

  const selectedDashboardContractHasLinkedItems = useMemo(() => {
    return selectedDashboardContractMovedItems.length > 0;
  }, [selectedDashboardContractMovedItems]);

  const projectMovedAllocationByContract = useMemo(() => {
    return dashboardContracts.reduce((accumulator, contract) => {
      const movedItems = Array.isArray(contract.movedLineItems) ? contract.movedLineItems : [];
      const openMovedItems = movedItems.filter((entry) => !entry?.revertedAt);
      accumulator[contract.id] = openMovedItems.reduce((sum, entry) => sum + Number(entry?.amount || 0), 0);
      return accumulator;
    }, {});
  }, [dashboardContracts]);

  const dashboardInvoices = useMemo(() => {
    if (!dashboardProjectId) return [];
    return invoices
      .filter((invoice) => invoice.projectId === dashboardProjectId)
      .sort((left, right) => Number(left.workWeek || 0) - Number(right.workWeek || 0));
  }, [invoices, dashboardProjectId]);

  const dashboardBudgetTotal = useMemo(
    () => dashboardContracts.reduce((sum, contract) => sum + Number(contract.total || 0), 0),
    [dashboardContracts]
  );

  const dashboardConsumedTotal = useMemo(
    () => dashboardInvoices.reduce((sum, invoice) => sum + Number(invoice.contractAmount ?? invoice.amount ?? 0), 0),
    [dashboardInvoices]
  );

  const dashboardOutOfScopeTotal = useMemo(
    () => dashboardInvoices.reduce((sum, invoice) => sum + Number(invoice.nonContractAmount || 0), 0),
    [dashboardInvoices]
  );

  const selectedDashboardContractEstimatedConsumed = useMemo(() => {
    if (!selectedDashboardContract) {
      return dashboardConsumedTotal;
    }

    if (selectedDashboardContractHasLinkedItems) {
      return selectedDashboardContractMovedTotal;
    }

    const allocatedToOtherContracts = Object.entries(projectMovedAllocationByContract).reduce(
      (sum, [contractId, amount]) => {
        if (contractId === selectedDashboardContract.id) return sum;
        return sum + Number(amount || 0);
      },
      0
    );

    return Math.max(dashboardConsumedTotal - allocatedToOtherContracts, 0);
  }, [
    selectedDashboardContract,
    selectedDashboardContractHasLinkedItems,
    selectedDashboardContractMovedTotal,
    projectMovedAllocationByContract,
    dashboardConsumedTotal,
  ]);

  const dashboardRemainingTotal = useMemo(
    () => dashboardBudgetTotal - dashboardConsumedTotal,
    [dashboardBudgetTotal, dashboardConsumedTotal]
  );

  const dashboardConsumedPercent = useMemo(() => {
    if (dashboardBudgetTotal <= 0) return 0;
    return Math.min((dashboardConsumedTotal / dashboardBudgetTotal) * 100, 100);
  }, [dashboardConsumedTotal, dashboardBudgetTotal]);

  const dashboardOutOfScopeLineItems = useMemo(() => {
    const rows = [];
    dashboardInvoices.forEach((invoice) => {
      (invoice.lineItems || []).forEach((lineItem, lineItemIndex) => {
        if (lineItem?.includeInContract !== false) return;
        const amount = Number(lineItem.rate || 0) * Number(lineItem.quantity || 0);
        if (amount <= 0) return;
        rows.push({
          invoiceId: invoice.id,
          projectId: invoice.projectId,
          companyId: invoice.companyId,
          invoiceNumber: invoice.invoiceNumber || '-',
          workWeek: invoice.workWeek || '-',
          lineItemId: lineItem.id || '',
          lineItemIndex,
          description: lineItem.description || 'Out of scope item',
          amount,
        });
      });
    });
    return rows;
  }, [dashboardInvoices]);

  const dashboardDisplayBudgetTotal = useMemo(() => {
    if (selectedDashboardContract) {
      return Number(selectedDashboardContract.total || 0);
    }
    return dashboardBudgetTotal;
  }, [selectedDashboardContract, dashboardBudgetTotal]);

  const dashboardDisplayConsumedTotal = useMemo(() => {
    if (selectedDashboardContract) {
      return selectedDashboardContractEstimatedConsumed;
    }
    return dashboardConsumedTotal;
  }, [
    selectedDashboardContract,
    selectedDashboardContractEstimatedConsumed,
    dashboardConsumedTotal,
  ]);

  const dashboardDisplayOutOfScopeTotal = useMemo(() => {
    if (selectedDashboardContract && selectedDashboardContractHasLinkedItems) {
      return 0;
    }
    return dashboardOutOfScopeTotal;
  }, [selectedDashboardContract, selectedDashboardContractHasLinkedItems, dashboardOutOfScopeTotal]);

  const dashboardDisplayRemainingTotal = useMemo(() => {
    return dashboardDisplayBudgetTotal - dashboardDisplayConsumedTotal;
  }, [dashboardDisplayBudgetTotal, dashboardDisplayConsumedTotal]);

  const dashboardDisplayConsumedPercent = useMemo(() => {
    if (dashboardDisplayBudgetTotal <= 0) return 0;
    return Math.min((dashboardDisplayConsumedTotal / dashboardDisplayBudgetTotal) * 100, 100);
  }, [dashboardDisplayConsumedTotal, dashboardDisplayBudgetTotal]);

  const dashboardDisplayOutOfScopePercent = useMemo(() => {
    if (dashboardDisplayBudgetTotal <= 0) return 0;
    return Math.min((dashboardDisplayOutOfScopeTotal / dashboardDisplayBudgetTotal) * 100, 100);
  }, [dashboardDisplayOutOfScopeTotal, dashboardDisplayBudgetTotal]);

  const dashboardDisplayLineItems = useMemo(() => {
    if (selectedDashboardContract && selectedDashboardContractHasLinkedItems) {
      return selectedDashboardContractMovedItems.map((entry, index) => ({
        invoiceId: String(entry.sourceInvoiceId || selectedDashboardContract.id || `selected-contract-${index}`),
        projectId: entry.sourceProjectId || selectedDashboardContract.projectId || '',
        companyId: entry.sourceCompanyId || selectedDashboardContract.companyId || '',
        invoiceNumber: entry.sourceInvoiceNumber || '-',
        workWeek: entry.sourceWeek || '-',
        lineItemId: String(entry.sourceLineItemId || entry.id || index),
        lineItemIndex: index,
        description: entry?.lineItem?.description || 'Moved line item',
        amount: Number(entry.amount || 0),
        isContractLinked: true,
      }));
    }

    return dashboardOutOfScopeLineItems.map((item) => ({
      ...item,
      isContractLinked: false,
    }));
  }, [
    selectedDashboardContract,
    selectedDashboardContractHasLinkedItems,
    selectedDashboardContractMovedItems,
    dashboardOutOfScopeLineItems,
  ]);

  // ─── Time Tracker pull state ──────────────────────────────────────────────
  const [ttShowPull, setTtShowPull] = useState(false);
  const [ttRoundHours, setTtRoundHours] = useState(true);
  const [ttDatePreset, setTtDatePreset] = useState('thisWeek');
  const [ttStartDate, setTtStartDate] = useState(() => ttDateRangeForPreset('thisWeek').startDate);
  const [ttEndDate, setTtEndDate] = useState(() => ttDateRangeForPreset('thisWeek').endDate);
  const [ttUser, setTtUser] = useState('');
  const [ttProject, setTtProject] = useState('');
  const [ttCard, setTtCard] = useState('');
  const [ttSearch, setTtSearch] = useState('');
  const [ttTimeLogs, setTtTimeLogs] = useState([]);
  const [ttActiveTimers, setTtActiveTimers] = useState([]);
  const [ttProductionCards, setTtProductionCards] = useState([]);
  const [ttOrgUsers, setTtOrgUsers] = useState([]);
  const [ttLoading, setTtLoading] = useState(false);
  const [ttFetched, setTtFetched] = useState(false);
  const [ttError, setTtError] = useState('');
  const ttHrs = (ms) => ttRoundHours ? ttMsToHrs(ms) : Math.round((Number(ms) || 0) / 36000) / 100;
  // ─────────────────────────────────────────────────────────────────────────

  // ─── Time Tracker derived data ────────────────────────────────────────────
  const ttAllEntries = useMemo(() => [...ttTimeLogs, ...ttActiveTimers], [ttTimeLogs, ttActiveTimers]);

  const ttCardMap = useMemo(() => {
    const map = {};
    ttProductionCards.forEach((c) => { const k = ttNormVal(c.issueId); if (k) map[k] = c; });
    return map;
  }, [ttProductionCards]);

  const ttMatchUser = (entry, orgUsers) => {
    const byId = orgUsers.find((u) => ttNormComp(u.userId) === ttNormComp(entry?.userId));
    if (byId) return byId;
    const byEmail = orgUsers.find((u) => u.email && ttNormComp(u.email) === ttNormComp(entry?.userEmail));
    if (byEmail) return byEmail;
    const rb = ttNormComp(entry?.registeredBy);
    if (!rb) return null;
    return orgUsers.find((u) => Array.isArray(u.aliases) && u.aliases.some((a) => ttNormComp(a) === rb)) || null;
  };

  const ttAllUsers = useMemo(() => {
    const map = new Map();
    ttOrgUsers.forEach((u) => { if (ttNormVal(u.userId)) map.set(ttNormVal(u.userId), u); });
    ttAllEntries.forEach((entry) => {
      const matched = ttMatchUser(entry, ttOrgUsers);
      if (matched) return;
      const k = ttNormVal(entry.userId) || ttNormVal(entry.userEmail) || ttNormVal(entry.registeredBy);
      if (!k || map.has(k)) return;
      map.set(k, {
        userId: k,
        label: ttNormVal(entry.registeredBy) || ttNormVal(entry.userEmail) || ttNormVal(entry.userId) || 'Unknown',
        email: ttNormVal(entry.userEmail),
        aliases: [ttNormVal(entry.userId), ttNormVal(entry.userEmail), ttNormVal(entry.registeredBy)].filter(Boolean),
      });
    });
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [ttAllEntries, ttOrgUsers]);

  const ttProjectOptions = useMemo(() => {
    const seen = new Set();
    return [
      ...ttProductionCards.map((c) => ttNormVal(c.projectName)),
      ...ttAllEntries.map((e) => ttNormVal(e.projectName)),
    ].filter((name) => { if (!name || seen.has(name)) return false; seen.add(name); return true; }).sort();
  }, [ttProductionCards, ttAllEntries]);

  const ttCardOptions = useMemo(() => {
    const map = new Map();
    ttProductionCards.forEach((c) => { const k = ttNormVal(c.issueId); if (k && !map.has(k)) map.set(k, { issueId: k, title: c.title }); });
    ttAllEntries.forEach((e) => { const k = ttNormVal(e.issueId); if (k && !map.has(k)) map.set(k, { issueId: k, title: '' }); });
    return Array.from(map.values()).sort((a, b) => a.issueId.localeCompare(b.issueId));
  }, [ttProductionCards, ttAllEntries]);

  const ttFilteredEntries = useMemo(() => {
    const normSearch = ttNormVal(ttSearch).toLowerCase();
    const startTs = ttToStartOfDay(ttStartDate);
    const endTs = ttToEndOfDay(ttEndDate);

    return ttAllEntries
      .filter((e) => Number(e.durationMs) > 0 && Boolean(ttNormVal(e.issueId)))
      .filter((e) => {
        const ts = ttGetEntryTs(e);
        if (!ts) return false;
        if (!Number.isNaN(startTs) && ts < startTs) return false;
        if (!Number.isNaN(endTs) && ts > endTs) return false;
        return true;
      })
      .filter((e) => {
        if (!ttUser) return true;
        const selComp = ttNormComp(ttUser);
        const matched = ttMatchUser(e, ttOrgUsers);
        const selEntry = ttAllUsers.find((u) => ttNormComp(u.userId) === selComp) || null;
        const entryAliases = [e.userId, e.userEmail, e.registeredBy, matched?.userId, matched?.email, matched?.label,
          ...(Array.isArray(matched?.aliases) ? matched.aliases : [])].map((v) => ttNormComp(v)).filter(Boolean);
        if (selEntry) {
          const selAliases = [selEntry.userId, selEntry.email, selEntry.label,
            ...(Array.isArray(selEntry.aliases) ? selEntry.aliases : [])].map((v) => ttNormComp(v)).filter(Boolean);
          return entryAliases.some((a) => selAliases.includes(a));
        }
        return entryAliases.includes(selComp);
      })
      .filter((e) => {
        if (!ttProject) return true;
        const card = ttCardMap[ttNormVal(e.issueId)] || {};
        return ttNormVal(card.projectName || e.projectName) === ttProject;
      })
      .filter((e) => !ttCard || ttNormVal(e.issueId) === ttCard)
      .filter((e) => {
        if (!normSearch) return true;
        const card = ttCardMap[ttNormVal(e.issueId)] || {};
        const matched = ttMatchUser(e, ttOrgUsers);
        return [e.issueId, card.title, card.projectName, e.projectName, matched?.label, e.registeredBy]
          .map((v) => ttNormVal(v).toLowerCase()).join(' ').includes(normSearch);
      });
  }, [ttAllEntries, ttOrgUsers, ttAllUsers, ttCardMap, ttSearch, ttCard, ttProject, ttUser, ttStartDate, ttEndDate]);

  const ttCardRollup = useMemo(() => {
    const map = {};
    ttFilteredEntries.forEach((e) => {
      const issueId = ttNormVal(e.issueId);
      const card = ttCardMap[issueId] || {};
      const matched = ttMatchUser(e, ttOrgUsers);
      const userLabel = ttNormVal(matched?.label) || ttNormVal(e.registeredBy) || 'Unknown';
      const startTs = e.startedAt || 0;
      const endTs = e.endedAt || e.completionAt || (startTs > 0 ? startTs + Math.max(0, Number(e.durationMs) || 0) : 0);

      if (!map[issueId]) {
        map[issueId] = {
          issueId,
          title: ttNormVal(card.title),
          projectName: ttNormVal(card.projectName || e.projectName),
          totalDurationMs: 0,
          totalEntries: 0,
          users: {},
          firstAt: 0,
          lastAt: 0,
          sessions: [],
          allNotes: [],
        };
      }
      const bucket = map[issueId];
      bucket.totalDurationMs += Number(e.durationMs) || 0;
      bucket.totalEntries += 1;
      bucket.users[userLabel] = (bucket.users[userLabel] || 0) + (Number(e.durationMs) || 0);

      if (startTs > 0 && (bucket.firstAt === 0 || startTs < bucket.firstAt)) bucket.firstAt = startTs;
      if (endTs > 0 && endTs > bucket.lastAt) bucket.lastAt = endTs;

      bucket.sessions.push({
        startTs,
        endTs,
        durationMs: Math.max(0, Number(e.durationMs) || 0),
        userLabel,
        notes: Array.isArray(e.notes) ? e.notes.map((n) => ttNormVal(n?.text)).filter(Boolean) : [],
      });

      if (Array.isArray(e.notes)) {
        e.notes.forEach((n) => {
          const txt = ttNormVal(n?.text);
          if (txt) bucket.allNotes.push(txt);
        });
      }
    });

    return Object.values(map)
      .map((row) => ({
        ...row,
        sessions: [...row.sessions].sort((a, b) => (a.startTs || 0) - (b.startTs || 0)),
      }))
      .sort((a, b) => b.totalDurationMs - a.totalDurationMs);
  }, [ttFilteredEntries, ttCardMap, ttOrgUsers]);

  const ttTotalDurationMs = useMemo(
    () => ttFilteredEntries.reduce((sum, e) => sum + (Number(e.durationMs) || 0), 0),
    [ttFilteredEntries]
  );

  const ttTotalMeta = useMemo(() => {
    let firstAt = 0;
    let lastAt = 0;
    const allNotes = [];
    ttFilteredEntries.forEach((e) => {
      const startTs = e.startedAt || 0;
      const endTs = e.endedAt || e.completionAt || (startTs > 0 ? startTs + Math.max(0, Number(e.durationMs) || 0) : 0);
      if (startTs > 0 && (firstAt === 0 || startTs < firstAt)) firstAt = startTs;
      if (endTs > 0 && endTs > lastAt) lastAt = endTs;
      if (Array.isArray(e.notes)) {
        e.notes.forEach((n) => { const txt = ttNormVal(n?.text); if (txt) allNotes.push(txt); });
      }
    });
    return { firstAt, lastAt, allNotes };
  }, [ttFilteredEntries]);
  // ─────────────────────────────────────────────────────────────────────────

  const loadBudgetData = async () => {
    if (!id) return;

    setIsLoading(true);
    try {
      const [companiesSnap, projectsSnap, contractsSnap, invoicesSnap, invoiceCategoriesSnap, preferencesSnap] = await Promise.all([
        getDocs(companiesRef),
        getDocs(projectsRef),
        getDocs(contractsRef),
        getDocs(invoicesRef),
        getDocs(invoiceCategoriesRef),
        getDoc(doc(db, 'churches', id, 'settings', 'budgetDashboardPreferences')),
      ]);

      const loadedCompanies = companiesSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
      const loadedProjects = projectsSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
      const loadedContracts = contractsSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
      const loadedInvoices = invoicesSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
      const loadedInvoiceCategories = invoiceCategoriesSnap.docs.map((item) => ({ id: item.id, ...item.data() }));

      setCompanies(sortByName(loadedCompanies, 'name'));
      setProjects(sortByName(loadedProjects, 'name'));
      setContracts(sortByName(loadedContracts, 'title'));
      setInvoices(loadedInvoices);
      setInvoiceCategories(sortByName(loadedInvoiceCategories, 'name'));

      const storedPreferences = preferencesSnap.exists() ? preferencesSnap.data() : {};
      const preferredCompanyId = String(storedPreferences.defaultDashboardCompanyId || '');
      const preferredProjectId = String(storedPreferences.defaultDashboardProjectId || '');

      const resolvedSelection = resolveDashboardSelection({
        companies: sortByName(loadedCompanies, 'name'),
        projects: sortByName(loadedProjects, 'name'),
        preferredCompanyId,
        preferredProjectId,
      });

      setDashboardCompanyId(resolvedSelection.companyId);
      setDashboardProjectId(resolvedSelection.projectId);
      setDefaultPreferenceCompanyId(resolvedSelection.companyId);
      setDefaultPreferenceProjectId(resolvedSelection.projectId);
    } catch (error) {
      console.error('Failed loading budget data:', error);
      toast.error('Failed to load budget data.');
    } finally {
      setIsLoading(false);
    }
  };

  // ─── Time Tracker data fetch ──────────────────────────────────────────────
  const fetchTTData = async () => {
    if (!id) return;
    setTtLoading(true);
    setTtError('');
    try {
      const [logsSnap, activeSnap, bimSnap, usersSnap] = await Promise.all([
        getDocs(collection(db, 'churches', id, 'timeRotateLogs')),
        getDocs(collection(db, 'churches', id, 'timeRotateActiveTimers')),
        getDocs(collection(db, 'churches', id, 'bimProjects')),
        getDocs(query(collection(db, 'users'), where('churchId', '==', id))),
      ]);

      const logs = logsSnap.docs.map((d) => {
        const data = d.data() || {};
        return {
          id: d.id,
          logType: ttNormVal(data.logType) || 'timer',
          issueId: ttNormVal(data.issueId),
          projectName: ttNormVal(data.projectName),
          registeredBy: ttNormVal(data.registeredBy),
          userId: ttNormVal(data.userId),
          userEmail: ttNormVal(data.userEmail),
          startedAt: ttToMs(data.startedAt),
          endedAt: ttToMs(data.endedAt),
          completionAt: ttToMs(data.completionAt),
          durationMs: Number(data.durationMs) || 0,
          notes: ttParseNotes(data.notes),
        };
      });

      const activeTimers = activeSnap.docs.map((d) => {
        const data = d.data() || {};
        return {
          id: d.id,
          logType: 'active',
          issueId: ttNormVal(data.issueId),
          projectName: ttNormVal(data.projectName),
          registeredBy: ttNormVal(data.registeredBy),
          userId: ttNormVal(data.userId),
          userEmail: ttNormVal(data.userEmail),
          startedAt: ttToMs(data.startedAt),
          endedAt: 0,
          completionAt: 0,
          durationMs: Math.max(0, Date.now() - ttToMs(data.startedAt)),
          notes: ttParseNotes(data.notes),
        };
      }).filter((e) => e.startedAt > 0);

      const cards = [];
      bimSnap.docs.forEach((projectDoc) => {
        const projectData = projectDoc.data() || {};
        const rows = Array.isArray(projectData.rows) ? projectData.rows : [];
        rows.forEach((row, rowIndex) => {
          const rowData = row?.rowData || {};
          const dataStageField = ttFindField(rowData, TT_STAGE_ALIASES) || 'Data Stage';
          if (ttNormVal(rowData[dataStageField]).toLowerCase() !== 'production') return;
          const issueIdField = ttFindField(rowData, TT_ID_ALIASES);
          const titleField = ttFindField(rowData, TT_TITLE_ALIASES);
          const projField = ttFindField(rowData, TT_PROJECT_ALIASES);
          const issueId = ttNormVal(issueIdField ? rowData[issueIdField] : '') || String(row?.rowNumber || rowIndex + 1);
          cards.push({
            issueId,
            title: ttNormVal(titleField ? rowData[titleField] : ''),
            projectName: ttNormVal(projField ? rowData[projField] : ''),
          });
        });
      });

      const seen = new Set();
      const dedupedCards = cards.filter((c) => {
        const k = ttNormVal(c.issueId);
        if (!k || seen.has(k)) return false;
        seen.add(k);
        return true;
      });

      const orgUsers = usersSnap.docs.map((d) => {
        const data = d.data() || {};
        const firstName = ttNormVal(data.firstName || data.name);
        const lastName = ttNormVal(data.lastName);
        const fullName = ttNormVal([firstName, lastName].filter(Boolean).join(' '));
        const displayName = ttNormVal(data.displayName);
        const email = ttNormVal(data.email);
        const label = fullName || displayName || email || `User ${d.id}`;
        return {
          userId: d.id,
          label,
          email,
          aliases: Array.from(new Set([d.id, fullName, displayName, email, ttNormVal(data.name)].filter(Boolean))),
        };
      }).sort((a, b) => a.label.localeCompare(b.label));

      setTtTimeLogs(logs);
      setTtActiveTimers(activeTimers);
      setTtProductionCards(dedupedCards);
      setTtOrgUsers(orgUsers);
      setTtFetched(true);
    } catch (err) {
      console.error('Failed to fetch time tracker data:', err);
      setTtError('Failed to load time tracker data.');
    } finally {
      setTtLoading(false);
    }
  };
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const resolveBudgetModuleAccess = async () => {
      if (authLoading) {
        return;
      }

      if (!id || !user) {
        setHasBudgetModuleAccess(false);
        setModuleAccessLoading(false);
        return;
      }

      setModuleAccessLoading(true);

      try {
        const [visibilitySnap, churchSnap] = await Promise.all([
          getDoc(doc(db, 'churches', id, MODULE_SETTINGS_SUBCOLLECTION, MODULE_VISIBILITY_DOC_ID)),
          getDoc(doc(db, 'churches', id)),
        ]);

        const storedVisibilitySettings = visibilitySnap.exists()
          ? visibilitySnap.data()?.settings
          : churchSnap.data()?.[MODULE_VISIBILITY_FIELD] || {};

          if (churchSnap.exists()) {
            const cd = churchSnap.data();
            setOrgName(cd.name || cd.churchName || cd.organizationName || '');
          }

        const rawUserRole = String(user?.customRole || user?.role || '').trim();
        let resolvedRoleKey = normalizeModuleVisibilityRole(rawUserRole);

        if (resolvedRoleKey === 'admin') {
          resolvedRoleKey = 'global_admin';
        }

        if (
          resolvedRoleKey !== 'global_admin'
          && resolvedRoleKey !== 'member'
          && resolvedRoleKey !== 'admin'
          && rawUserRole
        ) {
          const [rolesByChurchIdSnapshot, rolesByChurchIDSnapshot, rolesByOrganizationIdSnapshot] = await Promise.all([
            getDocs(query(collection(db, 'roles'), where('churchId', '==', id))),
            getDocs(query(collection(db, 'roles'), where('churchID', '==', id))),
            getDocs(query(collection(db, 'roles'), where('organizationId', '==', id))),
          ]);

          const roleCandidatesMap = new Map();
          [
            ...rolesByChurchIdSnapshot.docs,
            ...rolesByChurchIDSnapshot.docs,
            ...rolesByOrganizationIdSnapshot.docs,
          ].forEach((roleDoc) => {
            const roleData = roleDoc.data() || {};
            const roleChurchId = String(roleData?.churchId || roleData?.churchID || roleData?.organizationId || '');
            if (String(roleChurchId) !== String(id)) {
              return;
            }

            roleCandidatesMap.set(roleDoc.id, {
              id: roleDoc.id,
              name: getRoleNameFromRoleDoc(roleData),
            });
          });

          const roleCandidates = Array.from(roleCandidatesMap.values());
          const normalizedRawRole = rawUserRole.toLowerCase();

          const matchById = roleCandidates.find((roleItem) => String(roleItem.id).toLowerCase() === normalizedRawRole);
          const matchByName = roleCandidates.find((roleItem) => String(roleItem.name || '').toLowerCase() === normalizedRawRole);
          const matchedRole = matchById || matchByName;

          if (matchedRole?.id) {
            resolvedRoleKey = matchedRole.id;
          }
        }

        const canAccessBudget = isModuleVisibleForRole('budget', resolvedRoleKey, storedVisibilitySettings || {});
        setHasBudgetModuleAccess(canAccessBudget === true);
      } catch (error) {
        console.error('Failed checking budget module access:', error);
        setHasBudgetModuleAccess(false);
      } finally {
        setModuleAccessLoading(false);
      }
    };

    resolveBudgetModuleAccess();
  }, [authLoading, id, user]);

  useEffect(() => {
    if (moduleAccessLoading || !hasBudgetModuleAccess) {
      return;
    }

    loadBudgetData();
  }, [id, moduleAccessLoading, hasBudgetModuleAccess]);

  useEffect(() => {
    if (activeTab !== urlTab) {
      setActiveTab(urlTab);
    }
  }, [urlTab]);

  useEffect(() => {
    const nextParams = new URLSearchParams(searchParams);
    if (nextParams.get('tab') !== activeTab) {
      nextParams.set('tab', activeTab);
    }
    if (activeTab !== 'invoice-log') {
      nextParams.delete('invoiceId');
    }
    if (nextParams.toString() !== searchParams.toString()) {
      setSearchParams(nextParams, { replace: true });
    }
  }, [activeTab, searchParams, setSearchParams]);

  useEffect(() => {
    if (activeTab !== 'invoice-create') return;
    if (editingInvoiceId) return;

    const source = String(searchParams.get('source') || '').trim().toLowerCase();
    if (source !== 'invoice-manager') return;
    if (!Array.isArray(projects) || projects.length === 0) return;

    const requestedProjectId = String(searchParams.get('projectId') || '').trim();
    const requestedProjectName = normalizeNameKey(searchParams.get('projectName'));

    let matchedProject = requestedProjectId
      ? projects.find((project) => String(project?.id || '') === requestedProjectId)
      : null;

    if (!matchedProject && requestedProjectName) {
      matchedProject = projects.find((project) => normalizeNameKey(project?.name) === requestedProjectName)
        || projects.find((project) => normalizeNameKey(project?.name).includes(requestedProjectName));
    }

    if (!matchedProject) return;

    const matchedProjectId = String(matchedProject.id || '').trim();
    const matchedCompanyId = String(matchedProject.companyId || '').trim();
    const defaultProjectContractId = String((contractsByProjectId[matchedProjectId] || [])[0]?.id || '').trim();

    setInvoiceForm((current) => ({
      ...current,
      companyId: matchedCompanyId || current.companyId,
      projectId: matchedProjectId || current.projectId,
      contractId: defaultProjectContractId || current.contractId,
    }));

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('source');
    nextParams.delete('projectId');
    nextParams.delete('projectName');
    if (nextParams.toString() !== searchParams.toString()) {
      setSearchParams(nextParams, { replace: true });
    }
  }, [activeTab, contractsByProjectId, editingInvoiceId, projects, searchParams, setSearchParams]);

  useEffect(() => {
    if (moduleAccessLoading || !hasBudgetModuleAccess) {
      return undefined;
    }

    let isCancelled = false;

    const loadChurchBranding = async () => {
      const churchData = await getChurchData(id);
      if (isCancelled || !churchData) return;
      setOrgName(churchData.name || churchData.churchName || '');
      setOrgLogoUrl(churchData.logo || '');
    };

    loadChurchBranding();

    return () => {
      isCancelled = true;
    };
  }, [id, moduleAccessLoading, hasBudgetModuleAccess]);

  const setBudgetTab = (tabId) => {
    const resolvedTab = getResolvedBudgetTab(tabId);
    if (routeInvoiceId) {
      navigate(`/organization/${id}/budget?tab=${resolvedTab}`);
      return;
    }
    setActiveTab(resolvedTab);
  };

  const resetCompanyForm = () => {
    setCompanyForm(emptyCompanyForm);
    setEditingCompanyId(null);
  };

  const resetProjectForm = () => {
    setProjectForm(emptyProjectForm);
    setEditingProjectId(null);
  };

  const resetContractForm = () => {
    setContractForm(emptyContractForm);
    setEditingContractId(null);
  };

  const resetInvoiceForm = () => {
    setInvoiceForm(createEmptyInvoiceForm());
    setEditingInvoiceId(null);
  };

  const resetInvoiceCategoryForm = () => {
    setInvoiceCategoryName('');
    setEditingInvoiceCategoryId(null);
  };

  const handleSaveCompany = async (event) => {
    event.preventDefault();
    const name = companyForm.name.trim();

    if (!name) {
      toast.error('Company name is required.');
      return;
    }

    try {
      const payload = {
        name,
        contactName: companyForm.contactName.trim(),
        contactEmail: companyForm.contactEmail.trim(),
        updatedAt: serverTimestamp(),
      };

      if (editingCompanyId) {
        await updateDoc(doc(db, 'churches', id, 'budgetCompanies', editingCompanyId), payload);
        toast.success('Company updated.');
      } else {
        await addDoc(companiesRef, {
          ...payload,
          createdAt: serverTimestamp(),
        });
        toast.success('Company created.');
      }

      resetCompanyForm();
      await loadBudgetData();
    } catch (error) {
      console.error('Failed saving company:', error);
      toast.error('Could not save company.');
    }
  };

  const handleSaveProject = async (event) => {
    event.preventDefault();
    const name = projectForm.name.trim();

    if (!name) {
      toast.error('Project name is required.');
      return;
    }

    if (!projectForm.companyId) {
      toast.error('Select a company for this project.');
      return;
    }

    try {
      const payload = {
        name,
        companyId: projectForm.companyId,
        description: projectForm.description.trim(),
        updatedAt: serverTimestamp(),
      };

      if (editingProjectId) {
        await updateDoc(doc(db, 'churches', id, 'budgetProjects', editingProjectId), payload);
        toast.success('Project updated.');
      } else {
        await addDoc(projectsRef, {
          ...payload,
          createdAt: serverTimestamp(),
        });
        toast.success('Project created.');
      }

      resetProjectForm();
      await loadBudgetData();
    } catch (error) {
      console.error('Failed saving project:', error);
      toast.error('Could not save project.');
    }
  };

  const handleSaveContract = async (event) => {
    event.preventDefault();
    const title = contractForm.title.trim();
    const total = Number(contractForm.total);

    if (!title) {
      toast.error('Contract name is required.');
      return;
    }

    if (!Number.isFinite(total) || total < 0) {
      toast.error('Contract total must be a valid number.');
      return;
    }

    if (!contractForm.companyId) {
      toast.error('Select a client company.');
      return;
    }

    if (!contractForm.projectId) {
      toast.error('Select a client project.');
      return;
    }

    try {
      const payload = {
        title,
        total,
        companyId: contractForm.companyId,
        projectId: contractForm.projectId,
        notes: contractForm.notes.trim(),
        updatedAt: serverTimestamp(),
      };

      if (editingContractId) {
        await updateDoc(doc(db, 'churches', id, 'budgetContracts', editingContractId), payload);
        toast.success('Contract updated.');
      } else {
        await addDoc(contractsRef, {
          ...payload,
          createdAt: serverTimestamp(),
        });
        toast.success('Contract created.');
      }

      resetContractForm();
      await loadBudgetData();
    } catch (error) {
      console.error('Failed saving contract:', error);
      toast.error('Could not save contract.');
    }
  };

  const handleSaveInvoice = async (event) => {
    event.preventDefault();

    const workWeek = Number(invoiceForm.workWeek);
    const companyId = invoiceForm.companyId;
    const projectId = invoiceForm.projectId;
    const contractId = invoiceForm.contractId;
    const categoryId = String(invoiceForm.categoryId || '').trim();
    const invoiceNumber = invoiceForm.invoiceNumber.trim();
    const selectedProject = projectById[projectId];
    const selectedContract = contracts.find((contract) => contract.id === contractId) || null;
    const normalizedLineItems = (invoiceLineItemsWithTotals || [])
      .map((lineItem) => ({
        id: lineItem.id,
        description: String(lineItem.description || '').trim(),
        rate: parseCurrencyNumber(lineItem.rate),
        quantity: parseCurrencyNumber(lineItem.quantity),
        includeInContract: lineItem.includeInContract !== false,
      }))
      .filter((lineItem) => lineItem.description || lineItem.rate > 0 || lineItem.quantity > 0);

    if (!companyId) {
      toast.error('Select a client company for this invoice.');
      return;
    }

    if (!selectedProject) {
      toast.error('Select a valid project for this invoice.');
      return;
    }

    if (selectedProject.companyId !== companyId) {
      toast.error('Selected project does not belong to the selected company.');
      return;
    }

    if (selectedContract && selectedContract.projectId !== projectId) {
      toast.error('Selected contract does not belong to the selected project.');
      return;
    }

    if (!Number.isInteger(workWeek) || workWeek < 1) {
      toast.error('Work week must be an integer greater than 0.');
      return;
    }

    if (!invoiceForm.weekOneDate) {
      toast.error('Week 1 start date is required to generate weekly dates.');
      return;
    }

    if (!resolvedWeekOneStart || !resolvedWeekOneEnd || !selectedInvoiceWeekEnd) {
      toast.error('Week start and end dates could not be calculated from the selected week.');
      return;
    }

    if (normalizedLineItems.length === 0) {
      toast.error('Add at least one line item for this invoice.');
      return;
    }

    try {
      if (isEditingExistingInvoice && !isEditingMasterInvoice && editingInvoiceRecord) {
        await setDoc(
          doc(db, 'churches', id, 'budgetInvoices', editingInvoiceRecord.id),
          {
            projectId: editingInvoiceRecord.projectId,
            companyId: editingInvoiceRecord.companyId,
            contractId: editingInvoiceRecord.contractId || contractId,
            categoryId,
            workWeek: editingInvoiceRecord.workWeek,
            weekStartDate: editingInvoiceRecord.weekStartDate,
            weekEndDate: editingInvoiceRecord.weekEndDate,
            invoiceNumber,
            amount: invoiceGrandTotal,
            contractAmount: invoiceContractTotal,
            nonContractAmount: invoiceNonContractTotal,
            lineItems: normalizedLineItems,
            isMaster: false,
            status: invoiceGrandTotal > 0 ? 'submitted' : 'placeholder',
            notes: invoiceForm.notes.trim(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );

        toast.success('Invoice updated. Timeline fields remain locked for non-master invoices.');
        resetInvoiceForm();
        await loadBudgetData();
        return;
      }

      const timelineKey = getInvoiceTimelineKey(projectId, contractId);
      const targetInvoiceId = invoiceIdForProjectWeek(projectId, workWeek, contractId);
      const existingMasterId = masterInvoiceIdByTimeline[timelineKey]?.id || null;
      let resolvedMasterInvoiceId = existingMasterId;

      if (!resolvedMasterInvoiceId) {
        resolvedMasterInvoiceId = targetInvoiceId;
      }

      if (editingInvoiceId && existingMasterId === editingInvoiceId) {
        resolvedMasterInvoiceId = targetInvoiceId;
      }

      const existingProjectWeeks = invoices
        .filter((invoice) => getInvoiceTimelineKey(invoice.projectId, invoice.contractId || '') === timelineKey)
        .map((invoice) => Number(invoice.workWeek || 0))
        .filter((week) => Number.isFinite(week) && week > 0);
      const maxWeek = Math.max(workWeek, ...existingProjectWeeks, 0);

      const existingInvoicesById = invoices.reduce((accumulator, invoice) => {
        accumulator[invoice.id] = invoice;
        return accumulator;
      }, {});

      for (let week = 1; week <= maxWeek; week += 1) {
        const invoiceId = invoiceIdForProjectWeek(projectId, week, contractId);
        const weekStartDate = addDaysToIsoDate(resolvedWeekOneStart, (week - 1) * 7);
        const weekEndDate = addDaysToIsoDate(weekStartDate, 6);
        const isTargetWeek = week === workWeek;
        const existingInvoice = existingInvoicesById[invoiceId];

        if (!isTargetWeek && !existingInvoice && week > workWeek) {
          continue;
        }

        if (!existingInvoice && !isTargetWeek) {
          await setDoc(doc(db, 'churches', id, 'budgetInvoices', invoiceId), {
            projectId,
            companyId,
            contractId,
            categoryId: '',
            workWeek: week,
            invoiceNumber: '',
            amount: 0,
            contractAmount: 0,
            nonContractAmount: 0,
            lineItems: [],
            isMaster: false,
            status: 'placeholder',
            weekStartDate,
            weekEndDate,
            notes: '',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }

        if (isTargetWeek) {
          await setDoc(
            doc(db, 'churches', id, 'budgetInvoices', invoiceId),
            {
              projectId,
              companyId,
              contractId,
              categoryId,
              workWeek: week,
              invoiceNumber,
              amount: invoiceGrandTotal,
              contractAmount: invoiceContractTotal,
              nonContractAmount: invoiceNonContractTotal,
              lineItems: normalizedLineItems,
              isMaster: invoiceId === resolvedMasterInvoiceId,
              status: invoiceGrandTotal > 0 ? 'submitted' : 'placeholder',
              weekStartDate,
              weekEndDate,
              notes: invoiceForm.notes.trim(),
              updatedAt: serverTimestamp(),
              ...(existingInvoice ? {} : { createdAt: serverTimestamp() }),
            },
            { merge: true }
          );
        } else {
          await setDoc(
            doc(db, 'churches', id, 'budgetInvoices', invoiceId),
            {
              isMaster: invoiceId === resolvedMasterInvoiceId,
              companyId,
              contractId,
              weekStartDate,
              weekEndDate,
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        }
      }

      if (editingInvoiceId && editingInvoiceId !== targetInvoiceId) {
        await deleteDoc(doc(db, 'churches', id, 'budgetInvoices', editingInvoiceId));
      }

      toast.success(`Invoice saved for work week ${workWeek}. Missing prior weeks were generated.`);
      resetInvoiceForm();
      await loadBudgetData();
    } catch (error) {
      console.error('Failed saving invoice:', error);
      toast.error('Could not save invoice.');
    }
  };

  const handleSaveInvoiceCategory = async (event) => {
    event.preventDefault();

    const name = normalizeInvoiceCategoryName(invoiceCategoryName);
    if (!name) {
      toast.error('Category name is required.');
      return;
    }

    const duplicateCategory = invoiceCategories.find(
      (category) => category.id !== editingInvoiceCategoryId && normalizeInvoiceCategoryName(category.name).toLowerCase() === name.toLowerCase()
    );

    if (duplicateCategory) {
      toast.error('That category already exists.');
      return;
    }

    const actionKey = editingInvoiceCategoryId ? `edit-${editingInvoiceCategoryId}` : 'create';
    setInvoiceCategoryActionKey(actionKey);

    try {
      const payload = {
        name,
        updatedAt: serverTimestamp(),
      };

      if (editingInvoiceCategoryId) {
        await updateDoc(doc(db, 'churches', id, 'budgetInvoiceCategories', editingInvoiceCategoryId), payload);
        toast.success('Category updated.');
      } else {
        await addDoc(invoiceCategoriesRef, {
          ...payload,
          createdAt: serverTimestamp(),
        });
        toast.success('Category created.');
      }

      resetInvoiceCategoryForm();
      await loadBudgetData();
    } catch (error) {
      console.error('Failed saving invoice category:', error);
      toast.error('Could not save invoice category.');
    } finally {
      setInvoiceCategoryActionKey('');
    }
  };

  const handleDeleteInvoiceCategory = async (category) => {
    if (!category?.id) return;

    const categoryName = normalizeInvoiceCategoryName(category.name) || 'this category';
    if (!window.confirm(`Delete "${categoryName}"? Invoices using it will fall back to Invoice.`)) {
      return;
    }

    const actionKey = `delete-${category.id}`;
    setInvoiceCategoryActionKey(actionKey);

    try {
      const affectedInvoices = invoices.filter((invoice) => String(invoice.categoryId || '').trim() === category.id);
      if (affectedInvoices.length > 0) {
        await Promise.all(
          affectedInvoices.map((invoice) =>
            updateDoc(doc(db, 'churches', id, 'budgetInvoices', invoice.id), {
              categoryId: '',
              updatedAt: serverTimestamp(),
            })
          )
        );
      }

      await deleteDoc(doc(db, 'churches', id, 'budgetInvoiceCategories', category.id));

      if (editingInvoiceCategoryId === category.id) {
        resetInvoiceCategoryForm();
      }

      if (String(invoiceForm.categoryId || '').trim() === category.id) {
        setInvoiceForm((current) => ({ ...current, categoryId: '' }));
      }

      toast.success('Category deleted.');
      await loadBudgetData();
    } catch (error) {
      console.error('Failed deleting invoice category:', error);
      toast.error('Could not delete invoice category.');
    } finally {
      setInvoiceCategoryActionKey('');
    }
  };

  const handleUpdateInvoiceCategory = async (invoiceId, nextCategoryId) => {
    const normalizedCategoryId = String(nextCategoryId || '').trim();

    setInvoices((current) =>
      current.map((invoice) =>
        invoice.id === invoiceId
          ? { ...invoice, categoryId: normalizedCategoryId }
          : invoice
      )
    );

    try {
      await updateDoc(doc(db, 'churches', id, 'budgetInvoices', invoiceId), {
        categoryId: normalizedCategoryId,
        updatedAt: serverTimestamp(),
      });
      toast.success('Invoice category updated.');
    } catch (error) {
      console.error('Failed updating invoice category:', error);
      toast.error('Could not update invoice category.');
      await loadBudgetData();
    }
  };

  const handleDelete = async (kind, itemId) => {
    if (!window.confirm('Are you sure you want to delete this item?')) {
      return;
    }

    const config = {
      company: { collectionName: 'budgetCompanies', successMessage: 'Company deleted.' },
      project: { collectionName: 'budgetProjects', successMessage: 'Project deleted.' },
      contract: { collectionName: 'budgetContracts', successMessage: 'Contract deleted.' },
      invoice: { collectionName: 'budgetInvoices', successMessage: 'Invoice deleted.' },
    }[kind];

    if (!config) return;

    try {
      await deleteDoc(doc(db, 'churches', id, config.collectionName, itemId));
      toast.success(config.successMessage);
      await loadBudgetData();
    } catch (error) {
      console.error(`Failed deleting ${kind}:`, error);
      toast.error(`Could not delete ${kind}.`);
    }
  };

  const onCompanyChange = (field, value) => {
    setCompanyForm((current) => ({ ...current, [field]: value }));
  };

  const onProjectChange = (field, value) => {
    setProjectForm((current) => ({ ...current, [field]: value }));
  };

  const onContractChange = (field, value) => {
    setContractForm((current) => ({
      ...current,
      [field]: value,
      ...(field === 'companyId' ? { projectId: '' } : {}),
    }));
  };

  const onInvoiceChange = (field, value) => {
    setInvoiceForm((current) => ({
      ...current,
      ...(field === 'companyId'
        ? {
            companyId: value,
            projectId: '',
            contractId: '',
          }
        : field === 'projectId'
          ? {
              projectId: value,
              contractId: '',
            }
          : {
              [field]: value,
            }),
    }));
  };

  const onDashboardCompanyChange = (value) => {
    setDashboardCompanyId(value);
    const firstProjectForCompany = projects.find((project) => project.companyId === value)?.id || '';
    setDashboardProjectId(firstProjectForCompany);
    setDashboardContractId('');
  };

  const onDashboardProjectChange = (value) => {
    setDashboardProjectId(value);
    setDashboardContractId('');
  };

  const onDefaultPreferenceCompanyChange = (value) => {
    setDefaultPreferenceCompanyId(value);
    const firstProjectForCompany = projects.find((project) => project.companyId === value)?.id || '';
    setDefaultPreferenceProjectId(firstProjectForCompany);
  };

  useEffect(() => {
    if (!dashboardContractId) return;
    const contractStillExists = dashboardContracts.some((contract) => contract.id === dashboardContractId);
    if (!contractStillExists) {
      setDashboardContractId('');
    }
  }, [dashboardContractId, dashboardContracts]);

  const handleSaveDashboardPreferences = async () => {
    if (!id) return;

    setIsSavingDashboardPreferences(true);
    try {
      const resolvedSelection = resolveDashboardSelection({
        companies,
        projects,
        preferredCompanyId: defaultPreferenceCompanyId,
        preferredProjectId: defaultPreferenceProjectId,
      });

      await setDoc(
        doc(db, 'churches', id, 'settings', 'budgetDashboardPreferences'),
        {
          defaultDashboardCompanyId: resolvedSelection.companyId,
          defaultDashboardProjectId: resolvedSelection.projectId,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      setDefaultPreferenceCompanyId(resolvedSelection.companyId);
      setDefaultPreferenceProjectId(resolvedSelection.projectId);
      setDashboardCompanyId(resolvedSelection.companyId);
      setDashboardProjectId(resolvedSelection.projectId);
      toast.success('Dashboard defaults saved.');
    } catch (error) {
      console.error('Failed to save dashboard preferences:', error);
      toast.error('Could not save dashboard defaults.');
    } finally {
      setIsSavingDashboardPreferences(false);
    }
  };

  const getOutOfScopeActionKey = (item, actionName) => {
    const lineItemToken = item.lineItemId || String(item.lineItemIndex);
    return `${item.invoiceId}-${lineItemToken}-${actionName}`;
  };

  const getOutOfScopeLineItemKey = (item) => {
    const lineItemToken = item.lineItemId || String(item.lineItemIndex);
    return `${item.invoiceId}-${lineItemToken}`;
  };

  const getProjectContractsForOutOfScopeItem = (item) => {
    return contracts
      .filter((contract) => contract.projectId === item.projectId)
      .sort((left, right) => String(left.title || '').localeCompare(String(right.title || '')));
  };

  const buildInvoiceTotalsFromLineItems = (lineItems) => {
    return (lineItems || []).reduce(
      (accumulator, lineItem) => {
        const lineTotal = computeLineItemTotal(lineItem);
        if (lineItem?.includeInContract === false) {
          accumulator.nonContract += lineTotal;
        } else {
          accumulator.contract += lineTotal;
        }
        accumulator.total += lineTotal;
        return accumulator;
      },
      { contract: 0, nonContract: 0, total: 0 }
    );
  };

  const getOpenMovedLineItemsForContract = (contract) => {
    const movedItems = Array.isArray(contract?.movedLineItems) ? contract.movedLineItems : [];
    return movedItems.filter((entry) => !entry?.revertedAt);
  };

  const moveOutOfScopeLineItemIntoContract = async (item) => {
    const sourceInvoice = invoices.find((invoice) => invoice.id === item.invoiceId);
    if (!sourceInvoice) {
      toast.error('Could not find the source invoice for this line item.');
      return null;
    }

    const sourceLineItems = Array.isArray(sourceInvoice.lineItems) ? sourceInvoice.lineItems : [];
    let movedLineItem = null;

    const nextLineItems = sourceLineItems.filter((lineItem, index) => {
      const matchesById = item.lineItemId && lineItem.id === item.lineItemId;
      const matchesByIndex = !item.lineItemId && index === item.lineItemIndex;
      const isTargetLineItem = matchesById || matchesByIndex;

      if (!isTargetLineItem || lineItem?.includeInContract !== false) {
        return true;
      }

      movedLineItem = normalizeLineItemForMoveHistory({
        ...lineItem,
        includeInContract: true,
      });

      return false;
    });

    if (!movedLineItem) {
      toast.info('This line item is already in contract scope or could not be moved.');
      return null;
    }

    const totals = buildInvoiceTotalsFromLineItems(nextLineItems);

    await updateDoc(doc(db, 'churches', id, 'budgetInvoices', sourceInvoice.id), {
      lineItems: nextLineItems,
      contractAmount: totals.contract,
      nonContractAmount: totals.nonContract,
      amount: totals.total,
      updatedAt: serverTimestamp(),
    });

    return movedLineItem;
  };

  const appendMoveHistoryToContract = async ({
    contractId,
    currentMovedLineItems = [],
    movedLineItem,
    sourceInvoice,
    sourceItem,
    moveType,
  }) => {
    const movementEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      moveType,
      sourceInvoiceId: sourceInvoice.id,
      sourceInvoiceNumber: sourceInvoice.invoiceNumber || sourceItem.invoiceNumber || '-',
      sourceWeek: sourceInvoice.workWeek || sourceItem.workWeek || '-',
      sourceProjectId: sourceInvoice.projectId || sourceItem.projectId || '',
      sourceCompanyId: sourceInvoice.companyId || sourceItem.companyId || '',
      sourceLineItemId: sourceItem.lineItemId || movedLineItem.id,
      movedAt: new Date().toISOString(),
      lineItem: {
        ...normalizeLineItemForMoveHistory(movedLineItem),
        includeInContract: false,
      },
      amount: computeLineItemTotal(movedLineItem),
    };

    const updatedMovedLineItems = [...(currentMovedLineItems || []), movementEntry];

    await updateDoc(doc(db, 'churches', id, 'budgetContracts', contractId), {
      movedLineItems: updatedMovedLineItems,
      updatedAt: serverTimestamp(),
    });

    return movementEntry;
  };

  const handleRevertMovedLineItemFromContract = async (contract) => {
    if (!id) return;

    const actionKey = `${contract.id}-revert`;
    setContractActionKey(actionKey);

    try {
      const movedItems = getOpenMovedLineItemsForContract(contract);
      if (movedItems.length === 0) {
        toast.info('No moved line items are available to revert for this contract.');
        return;
      }

      const promptText = [
        'Select a moved line item to revert to its source invoice:',
        ...movedItems.map((entry, index) => {
          const amount = Number(entry.amount || 0).toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          });
          const description = entry?.lineItem?.description || 'Out of scope item';
          return `${index + 1}. Wk ${entry.sourceWeek} | Inv ${entry.sourceInvoiceNumber} | ${description} ($${amount})`;
        }),
      ].join('\n');

      const rawChoice = window.prompt(promptText, '1');
      if (rawChoice === null) {
        return;
      }

      const selectedIndex = Number(rawChoice) - 1;
      if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= movedItems.length) {
        toast.error('Invalid line item selection to revert.');
        return;
      }

      const selectedEntry = movedItems[selectedIndex];
      const sourceInvoiceId = String(selectedEntry.sourceInvoiceId || '');
      if (!sourceInvoiceId) {
        toast.error('Selected movement does not have a valid source invoice.');
        return;
      }

      const sourceInvoice = invoices.find((invoice) => invoice.id === sourceInvoiceId);
      if (!sourceInvoice) {
        toast.error('Source invoice no longer exists. Could not revert line item.');
        return;
      }

      const restoredLineItem = {
        ...normalizeLineItemForMoveHistory(selectedEntry.lineItem || {}),
        includeInContract: false,
      };

      const sourceLineItems = Array.isArray(sourceInvoice.lineItems) ? sourceInvoice.lineItems : [];
      const nextLineItems = [...sourceLineItems, restoredLineItem];
      const nextTotals = buildInvoiceTotalsFromLineItems(nextLineItems);

      await updateDoc(doc(db, 'churches', id, 'budgetInvoices', sourceInvoice.id), {
        lineItems: nextLineItems,
        contractAmount: nextTotals.contract,
        nonContractAmount: nextTotals.nonContract,
        amount: nextTotals.total,
        updatedAt: serverTimestamp(),
      });

      const amountToRevert = Number(selectedEntry.amount || 0);
      const nextContractTotal = Math.max(Number(contract.total || 0) - amountToRevert, 0);
      const updatedMoveHistory = (contract.movedLineItems || []).map((entry) => {
        if (entry.id !== selectedEntry.id) return entry;
        return {
          ...entry,
          revertedAt: new Date().toISOString(),
        };
      });

      await updateDoc(doc(db, 'churches', id, 'budgetContracts', contract.id), {
        total: nextContractTotal,
        movedLineItems: updatedMoveHistory,
        updatedAt: serverTimestamp(),
      });

      toast.success('Line item reverted to its source invoice and removed from contract total.');
      await loadBudgetData();
    } catch (error) {
      console.error('Failed reverting moved line item from contract:', error);
      toast.error('Could not revert moved line item from this contract.');
    } finally {
      setContractActionKey('');
    }
  };

  const handleCreateChangeOrderFromLineItem = async (item) => {
    if (!id) return;

    const actionKey = getOutOfScopeActionKey(item, 'change-order');
    setLineItemActionKey(actionKey);

    try {
      const sourceInvoice = invoices.find((invoice) => invoice.id === item.invoiceId);
      if (!sourceInvoice) {
        toast.error('Could not find the source invoice for this line item.');
        return;
      }

      const movedLineItem = await moveOutOfScopeLineItemIntoContract(item);
      if (!movedLineItem) {
        return;
      }

      const projectContracts = contracts.filter((contract) => contract.projectId === item.projectId);
      const existingChangeOrderCount = projectContracts.filter((contract) =>
        String(contract.title || '').toLowerCase().includes('change order')
      ).length;

      const title = `Change Order ${String(existingChangeOrderCount + 1).padStart(2, '0')} (Wk ${item.workWeek})`;
      const notes = `Auto-created from out-of-scope line item on invoice ${item.invoiceNumber} (week ${item.workWeek}). Item: ${movedLineItem.description || item.description}`;

      const createdContractRef = await addDoc(contractsRef, {
        title,
        total: computeLineItemTotal(movedLineItem),
        companyId: item.companyId || projectById[item.projectId]?.companyId || '',
        projectId: item.projectId || '',
        notes,
        movedLineItems: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await appendMoveHistoryToContract({
        contractId: createdContractRef.id,
        currentMovedLineItems: [],
        movedLineItem,
        sourceInvoice,
        sourceItem: item,
        moveType: 'change-order',
      });

      toast.success('Change order created and line item moved into contract scope.');
      await loadBudgetData();
    } catch (error) {
      console.error('Failed creating change order from out-of-scope line item:', error);
      toast.error('Could not create change order from this line item.');
    } finally {
      setLineItemActionKey('');
    }
  };

  const handleMoveLineItemToSeparateContract = async (item, selectedContractId) => {
    if (!id) return;

    const actionKey = getOutOfScopeActionKey(item, 'separate-contract');
    setLineItemActionKey(actionKey);

    try {
      const sourceInvoice = invoices.find((invoice) => invoice.id === item.invoiceId);
      if (!sourceInvoice) {
        toast.error('Could not find the source invoice for this line item.');
        return;
      }

      const projectContracts = getProjectContractsForOutOfScopeItem(item);

      let selectedContract = null;

      if (selectedContractId && selectedContractId !== '__new__') {
        selectedContract = projectContracts.find((contract) => contract.id === selectedContractId) || null;
        if (!selectedContract) {
          toast.error('The selected contract is no longer available. Please choose again.');
          return;
        }
      }

      if (!selectedContract) {
        const defaultTitle = `Separate Contract - ${String(item.description || 'Out of scope').slice(0, 35)}`;
        const newTitle = window.prompt('Name for the new separate contract:', defaultTitle);
        if (newTitle === null) {
          return;
        }

        const normalizedTitle = String(newTitle || '').trim();
        if (!normalizedTitle) {
          toast.error('Contract name is required to create a new separate contract.');
          return;
        }

        const newContractRef = await addDoc(contractsRef, {
          title: normalizedTitle,
          total: 0,
          companyId: item.companyId || projectById[item.projectId]?.companyId || '',
          projectId: item.projectId || '',
          notes: `Created from out-of-scope line item on invoice ${item.invoiceNumber} (week ${item.workWeek}).`,
          movedLineItems: [],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        selectedContract = {
          id: newContractRef.id,
          title: normalizedTitle,
          total: 0,
          movedLineItems: [],
        };
      }

      const movedLineItem = await moveOutOfScopeLineItemIntoContract(item);
      if (!movedLineItem) {
        return;
      }

      const movedAmount = computeLineItemTotal(movedLineItem);

      await updateDoc(doc(db, 'churches', id, 'budgetContracts', selectedContract.id), {
        total: Number(selectedContract.total || 0) + movedAmount,
        updatedAt: serverTimestamp(),
      });

      await appendMoveHistoryToContract({
        contractId: selectedContract.id,
        currentMovedLineItems: selectedContract.movedLineItems || [],
        movedLineItem,
        sourceInvoice,
        sourceItem: item,
        moveType: 'separate-contract',
      });

      toast.success(
        `Line item moved to ${selectedContract.title || 'the selected contract'} and removed from the source invoice.`
      );
      setOutScopeContractTargetByItem((current) => ({
        ...current,
        [getOutOfScopeLineItemKey(item)]: '',
      }));
      await loadBudgetData();
    } catch (error) {
      console.error('Failed moving out-of-scope line item to contract:', error);
      toast.error('Could not move this line item to a separate contract.');
    } finally {
      setLineItemActionKey('');
    }
  };

  const addInvoiceLineItem = () => {
    setInvoiceForm((current) => ({
      ...current,
      lineItems: [...(current.lineItems || []), createEmptyLineItem()],
    }));
  };

  const updateInvoiceLineItem = (lineItemId, field, value) => {
    setInvoiceForm((current) => ({
      ...current,
      lineItems: (current.lineItems || []).map((lineItem) => {
        if (lineItem.id !== lineItemId) return lineItem;
        return {
          ...lineItem,
          [field]: value,
        };
      }),
    }));
  };

  const applyDescriptionSuggestionToLineItem = (lineItemId, descriptionValue) => {
    updateInvoiceLineItem(lineItemId, 'description', descriptionValue);

    const suggestion = lineItemSuggestionLookup[String(descriptionValue || '').trim().toLowerCase()];
    if (!suggestion) return;

    setInvoiceForm((current) => ({
      ...current,
      lineItems: (current.lineItems || []).map((lineItem) => {
        if (lineItem.id !== lineItemId) return lineItem;
        return {
          ...lineItem,
          description: suggestion.description,
          rate: suggestion.rate,
          quantity: suggestion.quantity,
        };
      }),
    }));
  };

  const getLineItemDescriptionMatches = (rawValue, options = {}) => {
    const { showWhenEmpty = false } = options;
    const query = String(rawValue || '').trim().toLowerCase();
    if (lineItemDescriptionSuggestions.length === 0) return [];

    if (!query) {
      return showWhenEmpty ? lineItemDescriptionSuggestions.slice(0, 6) : [];
    }

    return lineItemDescriptionSuggestions
      .filter((suggestion) => suggestion.description.toLowerCase().includes(query))
      .slice(0, 6);
  };

  const removeInvoiceLineItem = (lineItemId) => {
    setInvoiceForm((current) => ({
      ...current,
      lineItems: (current.lineItems || []).filter((lineItem) => lineItem.id !== lineItemId),
    }));
  };

  if (authLoading || moduleAccessLoading) {
    return (
      <div style={{ ...commonStyles.fullWidthContainer, textAlign: 'left' }} className="budget-page">
        <p>Checking access...</p>
      </div>
    );
  }

  if (!hasBudgetModuleAccess) {
    return (
      <NotAuthorized
        message="Access Denied: You don't have permission to access the Budget module."
        showLogin={false}
      />
    );
  }

  return (
    <div style={{ ...commonStyles.fullWidthContainer, textAlign: 'left' }} className="budget-page">
      <div className="budget-page__topbar">
        <Link to={`/organization/${id}/mi-organizacion`} style={commonStyles.backButtonLink}>
          {'<- Back to Organization'}
        </Link>
        <input
          type="search"
          className="budget-page__search"
          placeholder="Search contracts, companies, or projects"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
        />
      </div>

      <div className="budget-page__header">
        <h1 style={commonStyles.title}>Budget Management</h1>
        <p className="budget-page__subtitle">
          Manage client companies, projects, contract totals, and weekly invoices in one place.
        </p>
      </div>

      <div className="budget-tabs" role="tablist" aria-label="Budget sections">
        {budgetTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`budget-tab ${activeTab === tab.id ? 'budget-tab--active' : ''}`}
            onClick={() => setBudgetTab(tab.id)}
            role="tab"
            aria-selected={activeTab === tab.id}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p>Loading budget module...</p>
      ) : (
        <div className="budget-grid">
          {activeTab === 'dashboard' && (
          <section className="budget-card budget-card--full">
            <div className="budget-dashboard__title-row">
              <h2>Budget Dashboard</h2>
              <button
                type="button"
                className="budget-dashboard__preferences-toggle"
                onClick={() => setShowDashboardPreferences((current) => !current)}
                aria-label="Toggle dashboard preferences"
                title="Dashboard Preferences"
              >
                ⚙
              </button>
            </div>

            <div className="budget-dashboard__filters">
              <div className="budget-form__field">
                <label htmlFor="dashboard-company">Company</label>
                <div className="budget-dashboard__select-wrap">
                  <select
                    id="dashboard-company"
                    className="budget-dashboard__select"
                    value={dashboardCompanyId}
                    onChange={(event) => onDashboardCompanyChange(event.target.value)}
                  >
                    <option value="">Select company</option>
                    {companies.map((company) => (
                      <option key={company.id} value={company.id}>
                        {company.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="budget-form__field">
                <label htmlFor="dashboard-project">Project</label>
                <div className="budget-dashboard__select-wrap">
                  <select
                    id="dashboard-project"
                    className="budget-dashboard__select"
                    value={dashboardProjectId}
                    onChange={(event) => onDashboardProjectChange(event.target.value)}
                    disabled={!dashboardCompanyId}
                  >
                    <option value="">Select project</option>
                    {dashboardProjectOptions.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="budget-form__field">
                <label htmlFor="dashboard-contract">Contract</label>
                <div className="budget-dashboard__select-wrap">
                  <select
                    id="dashboard-contract"
                    className="budget-dashboard__select"
                    value={dashboardContractId}
                    onChange={(event) => setDashboardContractId(event.target.value)}
                    disabled={!dashboardProjectId}
                  >
                    <option value="">All contracts</option>
                    {dashboardContracts.map((contract) => (
                      <option key={contract.id} value={contract.id}>
                        {contract.title || 'Untitled Contract'}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {showDashboardPreferences && (
            <div className="budget-dashboard__preferences">
              <h3>Dashboard Preferences</h3>
              <p>Choose which company and project should be selected by default when this page loads.</p>
              <div className="budget-dashboard__filters">
                <div className="budget-form__field">
                  <label htmlFor="dashboard-default-company">Default Company</label>
                  <div className="budget-dashboard__select-wrap">
                    <select
                      id="dashboard-default-company"
                      className="budget-dashboard__select"
                      value={defaultPreferenceCompanyId}
                      onChange={(event) => onDefaultPreferenceCompanyChange(event.target.value)}
                    >
                      <option value="">Select company</option>
                      {companies.map((company) => (
                        <option key={company.id} value={company.id}>
                          {company.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="budget-form__field">
                  <label htmlFor="dashboard-default-project">Default Project</label>
                  <div className="budget-dashboard__select-wrap">
                    <select
                      id="dashboard-default-project"
                      className="budget-dashboard__select"
                      value={defaultPreferenceProjectId}
                      onChange={(event) => setDefaultPreferenceProjectId(event.target.value)}
                      disabled={!defaultPreferenceCompanyId}
                    >
                      <option value="">Select project</option>
                      {defaultPreferenceProjectOptions.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="budget-form__actions">
                <button
                  type="button"
                  className="budget-btn budget-btn--primary"
                  onClick={handleSaveDashboardPreferences}
                  disabled={isSavingDashboardPreferences}
                >
                  {isSavingDashboardPreferences ? 'Saving...' : 'Save Defaults'}
                </button>
              </div>
            </div>
            )}

            {!dashboardCompanyId || !dashboardProjectId ? (
              <div className="budget-form__hint">
                To start dashboard analysis, select a company first and then select a project.
              </div>
            ) : (
              <>
                {selectedDashboardContract && (
                  <div className="budget-form__hint">
                    {selectedDashboardContractHasLinkedItems
                      ? <>Viewing contract scope for <strong>{selectedDashboardContract.title || 'Untitled Contract'}</strong>.</>
                      : <>Viewing <strong>{selectedDashboardContract.title || 'Untitled Contract'}</strong> using estimated consumed values (project consumed minus amounts moved to other contracts).</>}
                  </div>
                )}
                <div className="budget-dashboard__cards">
                  <article className="budget-dashboard__card">
                    <h3>Contract Budget</h3>
                    <p>
                      ${dashboardDisplayBudgetTotal.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </p>
                  </article>
                  <article className="budget-dashboard__card">
                    <h3>{selectedDashboardContract && selectedDashboardContractHasLinkedItems ? 'Moved Into Contract' : 'Consumed In Contract'}</h3>
                    <p>
                      ${dashboardDisplayConsumedTotal.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </p>
                  </article>
                  <article className="budget-dashboard__card">
                    <h3>Remaining Contract Budget</h3>
                    <p className={dashboardDisplayRemainingTotal < 0 ? 'budget-value--negative' : 'budget-value--positive'}>
                      ${dashboardDisplayRemainingTotal.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </p>
                  </article>
                  <article className="budget-dashboard__card">
                    <h3>{selectedDashboardContract && selectedDashboardContractHasLinkedItems ? 'Unassigned Out Of Scope' : 'Out Of Scope Work'}</h3>
                    <p>
                      ${dashboardDisplayOutOfScopeTotal.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </p>
                  </article>
                  {selectedDashboardContract && (
                    <article className="budget-dashboard__card">
                      <h3>Selected Contract</h3>
                      <p>{selectedDashboardContract.title || 'Untitled Contract'}</p>
                      <p className="budget-dashboard__meta">
                        Total: ${Number(selectedDashboardContract.total || 0).toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </p>
                      <p className="budget-dashboard__meta">
                        Moved Items: {selectedDashboardContractMovedItems.length} (${selectedDashboardContractMovedTotal.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })})
                      </p>
                    </article>
                  )}
                </div>

                <div className="budget-dashboard__graph">
                  <div className="budget-dashboard__graph-row">
                    <span>{selectedDashboardContract && selectedDashboardContractHasLinkedItems ? 'Selected Contract Progress' : 'Contract Budget Consumed'}</span>
                    <span>{dashboardDisplayConsumedPercent.toFixed(1)}%</span>
                  </div>
                  <div className="budget-dashboard__bar-track">
                    <div
                      className="budget-dashboard__bar-fill budget-dashboard__bar-fill--consumed"
                      style={{ width: `${dashboardDisplayConsumedPercent}%` }}
                    />
                  </div>
                  <div className="budget-dashboard__graph-row budget-dashboard__graph-row--minor">
                    <span>
                      Consumed: ${dashboardDisplayConsumedTotal.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </span>
                    <span>
                      Remaining: ${dashboardDisplayRemainingTotal.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                </div>

                <div className="budget-dashboard__graph">
                  <div className="budget-dashboard__graph-row">
                    <span>{selectedDashboardContract && selectedDashboardContractHasLinkedItems ? 'Unassigned Impact (Selected Contract)' : 'Out Of Scope Impact (vs Contract Budget)'}</span>
                    <span>
                      {dashboardDisplayBudgetTotal > 0
                        ? `${dashboardDisplayOutOfScopePercent.toFixed(1)}%`
                        : '0.0%'}
                    </span>
                  </div>
                  <div className="budget-dashboard__bar-track">
                    <div
                      className="budget-dashboard__bar-fill budget-dashboard__bar-fill--outscope"
                      style={{
                        width: `${dashboardDisplayOutOfScopePercent}%`,
                      }}
                    />
                  </div>
                </div>

                <h3>{selectedDashboardContract && selectedDashboardContractHasLinkedItems ? 'Selected Contract Line Items' : 'Out Of Scope Line Items'}</h3>
                <div className="budget-table-wrap">
                  <table className="budget-table">
                    <thead>
                      <tr>
                        <th>Invoice #</th>
                        <th>Week</th>
                        <th>Description</th>
                        <th>Amount</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dashboardDisplayLineItems.map((item) => (
                        <tr key={`${item.invoiceId}-${item.lineItemId || item.lineItemIndex}`}>
                          <td>{item.invoiceNumber}</td>
                          <td>{item.workWeek}</td>
                          <td>{item.description}</td>
                          <td>
                            ${item.amount.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </td>
                          <td>
                            {item.isContractLinked ? (
                              <span className="budget-table__empty">Already linked</span>
                            ) : (
                              <div className="budget-dashboard__outscope-actions">
                                <div className="budget-dashboard__outscope-contract-select-wrap">
                                  <select
                                    className="budget-dashboard__select"
                                    value={outScopeContractTargetByItem[getOutOfScopeLineItemKey(item)] || dashboardContractId || ''}
                                    onChange={(event) =>
                                      setOutScopeContractTargetByItem((current) => ({
                                        ...current,
                                        [getOutOfScopeLineItemKey(item)]: event.target.value,
                                      }))
                                    }
                                  >
                                    <option value="">Select contract</option>
                                    {getProjectContractsForOutOfScopeItem(item).map((contract) => (
                                      <option key={contract.id} value={contract.id}>
                                        {contract.title || 'Untitled Contract'}
                                      </option>
                                    ))}
                                    <option value="__new__">+ Create New Separate Contract</option>
                                  </select>
                                </div>
                                <button
                                  type="button"
                                  className="budget-btn budget-btn--primary"
                                  disabled={lineItemActionKey === getOutOfScopeActionKey(item, 'change-order')}
                                  onClick={() => handleCreateChangeOrderFromLineItem(item)}
                                >
                                  {lineItemActionKey === getOutOfScopeActionKey(item, 'change-order')
                                    ? 'Creating...'
                                    : 'Create Change Order'}
                                </button>
                                <button
                                  type="button"
                                  className="budget-btn"
                                  disabled={lineItemActionKey === getOutOfScopeActionKey(item, 'separate-contract')}
                                  onClick={() =>
                                    handleMoveLineItemToSeparateContract(
                                      item,
                                      outScopeContractTargetByItem[getOutOfScopeLineItemKey(item)] || dashboardContractId || '__new__'
                                    )
                                  }
                                >
                                  {lineItemActionKey === getOutOfScopeActionKey(item, 'separate-contract')
                                    ? 'Moving...'
                                    : 'Move To Separate Contract'}
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                      {dashboardDisplayLineItems.length === 0 && (
                        <tr>
                          <td colSpan={5} className="budget-table__empty">
                            {selectedDashboardContract && selectedDashboardContractHasLinkedItems
                              ? 'No moved line items found for the selected contract yet.'
                              : 'No out-of-scope line items marked for this project yet.'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
          )}

          {activeTab === 'companies' && (
          <section className="budget-card budget-card--full">
            <h2>Client Companies</h2>
            <form onSubmit={handleSaveCompany} className="budget-form">
              <input
                type="text"
                placeholder="Company name"
                value={companyForm.name}
                onChange={(event) => onCompanyChange('name', event.target.value)}
              />
              <input
                type="text"
                placeholder="Contact name"
                value={companyForm.contactName}
                onChange={(event) => onCompanyChange('contactName', event.target.value)}
              />
              <input
                type="email"
                placeholder="Contact email"
                value={companyForm.contactEmail}
                onChange={(event) => onCompanyChange('contactEmail', event.target.value)}
              />
              <div className="budget-form__actions">
                <button type="submit" className="budget-btn budget-btn--primary">
                  {editingCompanyId ? 'Update Company' : 'Add Company'}
                </button>
                {editingCompanyId && (
                  <button type="button" className="budget-btn" onClick={resetCompanyForm}>
                    Cancel
                  </button>
                )}
              </div>
            </form>

            <div className="budget-list">
              {companies.map((company) => (
                <article key={company.id} className="budget-list__item">
                  <div>
                    <strong>{company.name}</strong>
                    <p>{company.contactName || 'No contact name'}</p>
                    <p>{company.contactEmail || 'No contact email'}</p>
                  </div>
                  <div className="budget-list__actions">
                    <button
                      className="budget-btn"
                      onClick={() => {
                        setEditingCompanyId(company.id);
                        setCompanyForm({
                          name: company.name || '',
                          contactName: company.contactName || '',
                          contactEmail: company.contactEmail || '',
                        });
                      }}
                    >
                      Edit
                    </button>
                    <button className="budget-btn budget-btn--danger" onClick={() => handleDelete('company', company.id)}>
                      Delete
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
          )}

          {activeTab === 'projects' && (
          <section className="budget-card budget-card--full">
            <h2>Projects</h2>
            <form onSubmit={handleSaveProject} className="budget-form">
              <input
                type="text"
                placeholder="Project name"
                value={projectForm.name}
                onChange={(event) => onProjectChange('name', event.target.value)}
              />
              <select
                value={projectForm.companyId}
                onChange={(event) => onProjectChange('companyId', event.target.value)}
              >
                <option value="">Select company</option>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
              <textarea
                placeholder="Project description"
                rows={3}
                value={projectForm.description}
                onChange={(event) => onProjectChange('description', event.target.value)}
              />
              <div className="budget-form__actions">
                <button type="submit" className="budget-btn budget-btn--primary">
                  {editingProjectId ? 'Update Project' : 'Add Project'}
                </button>
                {editingProjectId && (
                  <button type="button" className="budget-btn" onClick={resetProjectForm}>
                    Cancel
                  </button>
                )}
              </div>
            </form>

            <div className="budget-list">
              {projects.map((project) => (
                <article key={project.id} className="budget-list__item">
                  <div>
                    <strong>{project.name}</strong>
                    <p>Company: {companyById[project.companyId]?.name || 'Unassigned'}</p>
                    <p>{project.description || 'No description'}</p>
                  </div>
                  <div className="budget-list__actions">
                    <button
                      className="budget-btn"
                      onClick={() => {
                        setEditingProjectId(project.id);
                        setProjectForm({
                          name: project.name || '',
                          companyId: project.companyId || '',
                          description: project.description || '',
                        });
                      }}
                    >
                      Edit
                    </button>
                    <button className="budget-btn budget-btn--danger" onClick={() => handleDelete('project', project.id)}>
                      Delete
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
          )}

          {activeTab === 'contracts' && (
          <section className="budget-card budget-card--full">
            <h2>Contracts</h2>
            <div className="budget-form__hint">
              Total invoices: {invoices.length}
            </div>
            <form onSubmit={handleSaveContract} className="budget-form budget-form--contracts">
              <input
                type="text"
                placeholder="Contract title"
                value={contractForm.title}
                onChange={(event) => onContractChange('title', event.target.value)}
              />
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="Contract total"
                value={contractForm.total}
                onChange={(event) => onContractChange('total', event.target.value)}
              />
              <select
                value={contractForm.companyId}
                onChange={(event) => onContractChange('companyId', event.target.value)}
              >
                <option value="">Select client company</option>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
              <select
                value={contractForm.projectId}
                onChange={(event) => onContractChange('projectId', event.target.value)}
                disabled={!contractForm.companyId}
              >
                <option value="">Select project</option>
                {projectOptionsForSelectedCompany.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
              <textarea
                placeholder="Contract notes"
                rows={3}
                value={contractForm.notes}
                onChange={(event) => onContractChange('notes', event.target.value)}
              />

              <div className="budget-form__actions">
                <button type="submit" className="budget-btn budget-btn--primary">
                  {editingContractId ? 'Update Contract' : 'Add Contract'}
                </button>
                {editingContractId && (
                  <button type="button" className="budget-btn" onClick={resetContractForm}>
                    Cancel
                  </button>
                )}
              </div>
            </form>

            <div className="budget-table-wrap">
              <table className="budget-table">
                <thead>
                  <tr>
                    <th>Contract</th>
                    <th>Client Company</th>
                    <th>Project</th>
                    <th>Total</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredContracts.map((contract) => (
                    <tr key={contract.id}>
                      <td>{contract.title}</td>
                      <td>{companyById[contract.companyId]?.name || 'Unknown'}</td>
                      <td>{projectById[contract.projectId]?.name || 'Unknown'}</td>
                      <td>${Number(contract.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td>
                        <div className="budget-list__actions">
                          <button
                            className="budget-btn"
                            onClick={() => {
                              setEditingContractId(contract.id);
                              setContractForm({
                                title: contract.title || '',
                                total: String(contract.total ?? ''),
                                companyId: contract.companyId || '',
                                projectId: contract.projectId || '',
                                notes: contract.notes || '',
                              });
                            }}
                          >
                            Edit
                          </button>
                          {getOpenMovedLineItemsForContract(contract).length > 0 && (
                            <button
                              className="budget-btn"
                              disabled={contractActionKey === `${contract.id}-revert`}
                              onClick={() => handleRevertMovedLineItemFromContract(contract)}
                            >
                              {contractActionKey === `${contract.id}-revert` ? 'Reverting...' : 'Revert Moved Item'}
                            </button>
                          )}
                          <button
                            className="budget-btn budget-btn--danger"
                            onClick={() => handleDelete('contract', contract.id)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredContracts.length === 0 && (
                    <tr>
                      <td colSpan={5} className="budget-table__empty">
                        No contracts found for the current search.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
          )}

          {activeTab === 'remaining' && (
          <section className="budget-card budget-card--full">
            <h2>Project Budget Remaining</h2>
            <div className="budget-table-wrap">
              <table className="budget-table">
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Company</th>
                    <th>Budget Total</th>
                    <th>Invoiced Total</th>
                    <th>Remaining</th>
                  </tr>
                </thead>
                <tbody>
                  {projectBudgetRows.map((row) => (
                    <tr key={row.projectId}>
                      <td>{row.projectName}</td>
                      <td>{row.companyName}</td>
                      <td>
                        ${row.budgetTotal.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                      <td>
                        ${row.invoicedTotal.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                      <td className={row.remainingTotal < 0 ? 'budget-value--negative' : 'budget-value--positive'}>
                        ${row.remainingTotal.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                    </tr>
                  ))}
                  {projectBudgetRows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="budget-table__empty">
                        Create projects and contracts to calculate remaining budget.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
          )}

          {activeTab === 'invoice-create' && (
          <section className="budget-card budget-card--full">
            <h2>Create / Edit Weekly Invoice</h2>
            <div className="budget-form__hint">
              This screen controls the master invoice timeline for the selected project. Saving here recalculates and updates week dates for all project invoices.
            </div>
            <form onSubmit={handleSaveInvoice} className="budget-form budget-form--invoice">
              <div className="budget-form__field">
                <label htmlFor="invoice-company">Client Company</label>
                <select
                  id="invoice-company"
                  value={invoiceForm.companyId}
                  onChange={(event) => onInvoiceChange('companyId', event.target.value)}
                  disabled={isEditingExistingInvoice && !isEditingMasterInvoice}
                >
                  <option value="">Select company</option>
                  {sortByName(companies, 'name').map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="budget-form__field">
                <label htmlFor="invoice-project">Project</label>
                <select
                  id="invoice-project"
                  value={invoiceForm.projectId}
                  onChange={(event) => onInvoiceChange('projectId', event.target.value)}
                  disabled={!invoiceForm.companyId || (isEditingExistingInvoice && !isEditingMasterInvoice)}
                >
                  <option value="">Select project</option>
                  {invoiceProjectOptions.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="budget-form__field">
                <label htmlFor="invoice-contract">Contract</label>
                <select
                  id="invoice-contract"
                  value={invoiceForm.contractId}
                  onChange={(event) => onInvoiceChange('contractId', event.target.value)}
                  disabled={!invoiceForm.projectId || (isEditingExistingInvoice && !isEditingMasterInvoice)}
                >
                  <option value="">Select contract</option>
                  {invoiceContractOptions.map((contract) => (
                    <option key={contract.id} value={contract.id}>
                      {contract.title || 'Untitled Contract'}
                    </option>
                  ))}
                </select>
              </div>

              <div className="budget-form__field">
                <label htmlFor="invoice-category">Category</label>
                <select
                  id="invoice-category"
                  value={invoiceForm.categoryId}
                  onChange={(event) => onInvoiceChange('categoryId', event.target.value)}
                >
                  <option value="">Invoice</option>
                  {invoiceCategories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="budget-form__field">
                <label htmlFor="invoice-week-number">Work Week #</label>
                <input
                  id="invoice-week-number"
                  type="number"
                  min="1"
                  step="1"
                  placeholder="Example: 10"
                  value={invoiceForm.workWeek}
                  onChange={(event) => onInvoiceChange('workWeek', event.target.value)}
                  disabled={isEditingExistingInvoice && !isEditingMasterInvoice}
                />
              </div>

              <div className="budget-form__field">
                <label htmlFor="invoice-number">Invoice #</label>
                <input
                  id="invoice-number"
                  type="text"
                  placeholder="Example: INV-0010"
                  value={invoiceForm.invoiceNumber}
                  onChange={(event) => onInvoiceChange('invoiceNumber', event.target.value)}
                />
              </div>

              <div className="budget-form__field">
                <label htmlFor="invoice-week-one-date">Selected Week Start Date</label>
                <input
                  id="invoice-week-one-date"
                  type="date"
                  value={invoiceForm.weekOneDate}
                  onChange={(event) => onInvoiceChange('weekOneDate', event.target.value)}
                  disabled={isEditingExistingInvoice && !isEditingMasterInvoice}
                />
              </div>

              <div className="budget-form__field">
                <label htmlFor="invoice-week-start">Calculated Week 1 Start</label>
                <input
                  id="invoice-week-start"
                  type="date"
                  value={resolvedWeekOneStart}
                  readOnly
                  disabled
                  aria-label="Calculated week 1 start"
                />
              </div>

              <div className="budget-form__field">
                <label htmlFor="invoice-week-end">Calculated Week 1 End</label>
                <input
                  id="invoice-week-end"
                  type="date"
                  value={resolvedWeekOneEnd}
                  readOnly
                  disabled
                  aria-label="Calculated week 1 end"
                />
              </div>

              <div className="budget-form__field">
                <label htmlFor="invoice-notes">Notes</label>
                <textarea
                  id="invoice-notes"
                  placeholder="Optional notes for this invoice"
                  rows={3}
                  value={invoiceForm.notes}
                  onChange={(event) => onInvoiceChange('notes', event.target.value)}
                />
              </div>

              <div className="budget-line-items">
                <div className="budget-line-items__header">
                  <h3>Line Items</h3>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginLeft: 'auto' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', color: '#374151', cursor: 'pointer', userSelect: 'none' }}>
                      <input
                        type="checkbox"
                        checked={ttRoundHours}
                        onChange={(e) => setTtRoundHours(e.target.checked)}
                        style={{ width: 15, height: 15, cursor: 'pointer' }}
                      />
                      Round hours
                    </label>
                    <button
                      type="button"
                      className="budget-btn"
                      onClick={() => {
                        setTtShowPull((prev) => !prev);
                        if (!ttFetched && !ttShowPull) fetchTTData();
                      }}
                    >
                      {ttShowPull ? 'Hide Time Tracker' : 'Pull from Time Tracker'}
                    </button>
                  </div>
                </div>

                {ttShowPull && (
                  <div className="budget-tt-pull" style={{ border: '1px solid #CBD5E1', borderRadius: 8, padding: 16, marginBottom: 16, backgroundColor: '#F8FAFC' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                      <strong style={{ fontSize: '0.95rem' }}>Time Tracker — Pull Hours as Line Item</strong>
                      <button
                        type="button"
                        className="budget-btn budget-btn--primary"
                        style={{ minWidth: 110 }}
                        disabled={ttLoading}
                        onClick={() => fetchTTData()}
                      >
                        {ttLoading ? 'Loading…' : ttFetched ? 'Refresh' : 'Load Data'}
                      </button>
                    </div>

                    {/* Filters */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
                      <div className="budget-form__field" style={{ minWidth: 160 }}>
                        <label>Date Range</label>
                        <select
                          value={ttDatePreset}
                          onChange={(ev) => {
                            const preset = ev.target.value;
                            setTtDatePreset(preset);
                            if (preset !== 'custom') {
                              const range = ttDateRangeForPreset(preset);
                              setTtStartDate(range.startDate);
                              setTtEndDate(range.endDate);
                            }
                          }}
                        >
                          {TT_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                        </select>
                      </div>
                      <div className="budget-form__field" style={{ minWidth: 150 }}>
                        <label>Start Date</label>
                        <input
                          type="date"
                          value={ttStartDate}
                          onChange={(ev) => { setTtStartDate(ev.target.value); setTtDatePreset('custom'); }}
                        />
                      </div>
                      <div className="budget-form__field" style={{ minWidth: 150 }}>
                        <label>End Date</label>
                        <input
                          type="date"
                          value={ttEndDate}
                          onChange={(ev) => { setTtEndDate(ev.target.value); setTtDatePreset('custom'); }}
                        />
                      </div>
                      <div className="budget-form__field" style={{ minWidth: 180 }}>
                        <label>Employee</label>
                        <select value={ttUser} onChange={(ev) => setTtUser(ev.target.value)}>
                          <option value="">All employees</option>
                          {ttAllUsers.map((u) => <option key={u.userId} value={u.userId}>{u.label}</option>)}
                        </select>
                      </div>
                      <div className="budget-form__field" style={{ minWidth: 180 }}>
                        <label>Project</label>
                        <select value={ttProject} onChange={(ev) => { setTtProject(ev.target.value); setTtCard(''); }}>
                          <option value="">All projects</option>
                          {ttProjectOptions.map((p) => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </div>
                      <div className="budget-form__field" style={{ minWidth: 200 }}>
                        <label>Card</label>
                        <select value={ttCard} onChange={(ev) => setTtCard(ev.target.value)}>
                          <option value="">All cards</option>
                          {ttCardOptions.map((c) => (
                            <option key={c.issueId} value={c.issueId}>
                              {c.issueId}{c.title ? ` — ${c.title}` : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="budget-form__field" style={{ minWidth: 200 }}>
                        <label>Search</label>
                        <input
                          type="search"
                          placeholder="Card, title, employee…"
                          value={ttSearch}
                          onChange={(ev) => setTtSearch(ev.target.value)}
                        />
                      </div>
                    </div>

                    {ttError && <div style={{ color: '#EF4444', marginBottom: 10 }}>{ttError}</div>}

                    {ttFetched && !ttLoading && (
                      <>
                        {/* Summary row */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12, padding: '8px 12px', backgroundColor: '#EFF6FF', borderRadius: 6, border: '1px solid #BFDBFE' }}>
                          <span style={{ fontWeight: 700 }}>
                            Total: {ttFmtDuration(ttTotalDurationMs)} ({ttHrs(ttTotalDurationMs)} hrs)
                          </span>
                          <span style={{ color: '#6B7280', fontSize: '0.88rem' }}>
                            {ttFilteredEntries.length} entries across {ttCardRollup.length} card{ttCardRollup.length !== 1 ? 's' : ''}
                            {ttTotalMeta.firstAt > 0 && (
                              <> &nbsp;·&nbsp; {ttFmtDateOnly(ttTotalMeta.firstAt)} – {ttFmtDateOnly(ttTotalMeta.lastAt)}</>
                            )}
                          </span>
                          <button
                            type="button"
                            className="budget-btn budget-btn--primary"
                            style={{ marginLeft: 'auto' }}
                            disabled={ttTotalDurationMs === 0}
                            onClick={() => {
                              const hrs = ttHrs(ttTotalDurationMs);
                              const filterParts = [
                                ttStartDate && ttEndDate ? `${ttStartDate} – ${ttEndDate}` : ttStartDate || ttEndDate || 'All Time',
                                ttUser ? ttAllUsers.find((u) => u.userId === ttUser)?.label : null,
                                ttProject || null,
                                ttCard ? `Card ${ttCard}` : null,
                                ttSearch || null,
                              ].filter(Boolean).join(' | ');
                              const dateRange = ttTotalMeta.firstAt
                                ? `${ttFmtDateOnly(ttTotalMeta.firstAt)} – ${ttFmtDateOnly(ttTotalMeta.lastAt)}`
                                : (filterParts || 'All Time');
                              const lines = [
                                `Time Tracker Hours${filterParts ? ` (${filterParts})` : ''}`,
                                `Date range: ${dateRange}`,
                                `Total: ${ttFmtDuration(ttTotalDurationMs)} (${hrs} hrs) across ${ttFilteredEntries.length} session${ttFilteredEntries.length !== 1 ? 's' : ''}`,
                              ];
                              ttCardRollup.forEach((row) => {
                                const cardDateRange = row.firstAt
                                  ? `${ttFmtDateOnly(row.firstAt)} – ${ttFmtDateOnly(row.lastAt)}`
                                  : '';
                                lines.push(
                                  `\nCard ${row.issueId}${row.title ? ` — ${row.title}` : ''}${row.projectName ? ` (${row.projectName})` : ''}`,
                                  `  Duration: ${ttFmtDuration(row.totalDurationMs)} (${ttHrs(row.totalDurationMs)} hrs)${cardDateRange ? ` | ${cardDateRange}` : ''}`,
                                );
                                row.sessions.forEach((s) => {
                                  lines.push(
                                    `  Session: ${s.startTs ? ttFmtDateTime(s.startTs) : '—'} (${ttFmtDuration(s.durationMs)}) — ${s.userLabel}`,
                                  );
                                  s.notes.forEach((note) => lines.push(`    Note: ${note}`));
                                });
                              });
                              addInvoiceLineItem();
                              setInvoiceForm((current) => {
                                const lineItems = [...(current.lineItems || [])];
                                const last = lineItems[lineItems.length - 1];
                                if (last) {
                                  lineItems[lineItems.length - 1] = {
                                    ...last,
                                    description: lines.join('\n'),
                                    quantity: String(hrs),
                                    rate: '',
                                    roundHours: ttRoundHours,
                                  };
                                }
                                return { ...current, lineItems };
                              });
                            }}
                          >
                            Add Total as Line Item
                          </button>
                        </div>

                        {/* Per-card breakdown */}
                        {ttCardRollup.length > 0 && (
                          <div className="budget-table-wrap" style={{ maxHeight: 340, overflowY: 'auto' }}>
                            <table className="budget-table" style={{ fontSize: '0.88rem' }}>
                              <thead>
                                <tr>
                                  <th>Card</th>
                                  <th>Title</th>
                                  <th>Project</th>
                                  <th>Sessions</th>
                                  <th>First Session</th>
                                  <th>Last Session</th>
                                  <th>Duration</th>
                                  <th>Hours</th>
                                  <th>Notes Preview</th>
                                  <th></th>
                                </tr>
                              </thead>
                              <tbody>
                                {ttCardRollup.map((row) => (
                                  <tr key={row.issueId}>
                                    <td>{row.issueId}</td>
                                    <td>{row.title || '—'}</td>
                                    <td>{row.projectName || '—'}</td>
                                    <td>{row.totalEntries}</td>
                                    <td style={{ whiteSpace: 'nowrap', fontSize: '0.82rem' }}>{row.firstAt ? ttFmtDateOnly(row.firstAt) : '—'}</td>
                                    <td style={{ whiteSpace: 'nowrap', fontSize: '0.82rem' }}>{row.lastAt ? ttFmtDateOnly(row.lastAt) : '—'}</td>
                                    <td style={{ whiteSpace: 'nowrap' }}>{ttFmtDuration(row.totalDurationMs)}</td>
                                    <td>{ttHrs(row.totalDurationMs)}</td>
                                    <td style={{ maxWidth: 220, fontSize: '0.8rem', color: '#6B7280' }}>
                                      {row.allNotes.length > 0
                                        ? row.allNotes.slice(0, 2).join(' · ').slice(0, 120) + (row.allNotes.length > 2 || (row.allNotes.slice(0, 2).join(' · ').length > 120) ? '…' : '')
                                        : '—'}
                                    </td>
                                    <td>
                                      <button
                                        type="button"
                                        className="budget-btn"
                                        style={{ fontSize: '0.8rem', padding: '3px 8px', whiteSpace: 'nowrap' }}
                                        onClick={() => {
                                          const hrs = ttHrs(row.totalDurationMs);
                                          const cardDateRange = row.firstAt
                                            ? `${ttFmtDateOnly(row.firstAt)} – ${ttFmtDateOnly(row.lastAt)}`
                                            : '';
                                          const lines = [
                                            `Card ${row.issueId}${row.title ? ` — ${row.title}` : ''}${row.projectName ? ` (${row.projectName})` : ''}`,
                                            `Duration: ${ttFmtDuration(row.totalDurationMs)} (${ttHrs(row.totalDurationMs)} hrs)${cardDateRange ? ` | ${cardDateRange}` : ''}`,
                                          ];
                                          row.sessions.forEach((s) => {
                                            lines.push(
                                              `Session: ${s.startTs ? ttFmtDateTime(s.startTs) : '—'} (${ttFmtDuration(s.durationMs)}) — ${s.userLabel}`,
                                            );
                                            s.notes.forEach((note) => lines.push(`  Note: ${note}`));
                                          });
                                          addInvoiceLineItem();
                                          setInvoiceForm((current) => {
                                            const lineItems = [...(current.lineItems || [])];
                                            const last = lineItems[lineItems.length - 1];
                                            if (last) {
                                              lineItems[lineItems.length - 1] = {
                                                ...last,
                                                description: lines.join('\n'),
                                                quantity: String(hrs),
                                                rate: '',
                                                roundHours: ttRoundHours,
                                              };
                                            }
                                            return { ...current, lineItems };
                                          });
                                        }}
                                      >
                                        Add as Line Item
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}

                        {ttCardRollup.length === 0 && (
                          <div className="budget-table__empty">No matching time tracker entries for the selected filters.</div>
                        )}
                      </>
                    )}

                    {!ttFetched && !ttLoading && (
                      <div className="budget-form__hint">Click "Load Data" to fetch time tracker hours.</div>
                    )}
                    {ttLoading && <div className="budget-form__hint">Loading time tracker data…</div>}
                  </div>
                )}

                {lineItemDescriptionSuggestions.length > 0 && (
                  <div className="budget-form__hint">
                    Description suggestions are available from previous line items in this project.
                  </div>
                )}

                {invoiceLineItemsWithTotals.length === 0 ? (
                  <div className="budget-table__empty">No line items yet. Add one to build the invoice total.</div>
                ) : (
                  <div className="budget-table-wrap">
                    <table className="budget-table budget-table--line-items">
                      <thead>
                        <tr>
                          <th>Description</th>
                          <th>Rate</th>
                          <th>Quantity</th>
                          <th>Line Total</th>
                          <th>Exclude From Contract</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {invoiceLineItemsWithTotals.map((lineItem, lineItemIndex) => (
                          <tr key={lineItem.id}>
                            <td>
                              <div className="budget-line-items__description-cell">
                                <textarea
                                  rows={3}
                                  autoFocus={lineItemIndex === 0}
                                  className="budget-line-items__description-input budget-line-items__description-textarea"
                                  value={lineItem.description}
                                  onChange={(event) => applyDescriptionSuggestionToLineItem(lineItem.id, event.target.value)}
                                  placeholder="Line item description"
                                />
                                {getLineItemDescriptionMatches(lineItem.description, { showWhenEmpty: lineItemIndex === 0 }).length > 0 && (
                                  <div
                                    className={`budget-line-items__suggestions ${lineItemIndex === 0 ? 'budget-line-items__suggestions--pinned' : ''}`}
                                    role="listbox"
                                    aria-label="Description suggestions"
                                  >
                                    {lineItemIndex === 0 && (
                                      <div className="budget-line-items__suggestions-label">Suggestions</div>
                                    )}
                                    {getLineItemDescriptionMatches(lineItem.description, { showWhenEmpty: lineItemIndex === 0 }).map((suggestion) => (
                                      <button
                                        key={`${lineItem.id}-${suggestion.description}`}
                                        type="button"
                                        className="budget-line-items__suggestion-item"
                                        onClick={() => applyDescriptionSuggestionToLineItem(lineItem.id, suggestion.description)}
                                      >
                                        <span className="budget-line-items__suggestion-title">{suggestion.description}</span>
                                        <span className="budget-line-items__suggestion-meta">
                                          Rate {suggestion.rate || '-'} | Qty {suggestion.quantity || '-'}
                                        </span>
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </td>
                            <td>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={lineItem.rate}
                                onChange={(event) => updateInvoiceLineItem(lineItem.id, 'rate', event.target.value)}
                                placeholder="Rate"
                              />
                            </td>
                            <td>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={lineItem.quantity}
                                onChange={(event) => updateInvoiceLineItem(lineItem.id, 'quantity', event.target.value)}
                                placeholder="Quantity"
                              />
                            </td>
                            <td>
                              ${lineItem.lineTotal.toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </td>
                            <td>
                              <label className="budget-line-items__checkbox">
                                <input
                                  type="checkbox"
                                  checked={lineItem.includeInContract === false}
                                  onChange={(event) =>
                                    updateInvoiceLineItem(lineItem.id, 'includeInContract', !event.target.checked)
                                  }
                                />
                                Outside contract scope
                              </label>
                            </td>
                            <td>
                              <button
                                type="button"
                                className="budget-btn budget-btn--danger"
                                onClick={() => removeInvoiceLineItem(lineItem.id)}
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="budget-line-items__add-row">
                  <button type="button" className="budget-btn" onClick={addInvoiceLineItem}>
                    Add Line Item
                  </button>
                </div>

                <div className="budget-line-items__totals">
                  <div>
                    <strong>Contract Scope Total:</strong>{' '}
                    ${invoiceContractTotal.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </div>
                  <div>
                    <strong>Outside Contract Total:</strong>{' '}
                    ${invoiceNonContractTotal.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </div>
                  <div>
                    <strong>Invoice Total:</strong>{' '}
                    ${invoiceGrandTotal.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </div>
                </div>
              </div>
              <div className="budget-form__hint">
                Entering week 10 will auto-create any missing weeks 1 through 9 and backdate Week 1 automatically.
              </div>
              {!isEditingMasterInvoice && isEditingExistingInvoice && (
                <div className="budget-form__hint">
                  This invoice is not the project master. Work week number and week date anchor are locked to protect the shared timeline.
                </div>
              )}
              <div className="budget-form__hint">
                The date you enter is the selected week start date. Week 1 is calculated backward from the selected week number.
              </div>

              <div className="budget-form__actions">
                <button type="submit" className="budget-btn budget-btn--primary">
                  {editingInvoiceId ? 'Update Weekly Invoice' : 'Add Weekly Invoice'}
                </button>
                {editingInvoiceId && (
                  <button type="button" className="budget-btn" onClick={resetInvoiceForm}>
                    Cancel
                  </button>
                )}
              </div>
            </form>
          </section>
          )}

          {activeTab === 'invoice-log' && (
          viewingInvoiceId ? (
          <section className="budget-card budget-card--full budget-invoice-view">
            <style>{`
              @media print {
                .budget-page__topbar,
                .budget-page__header,
                .budget-tabs,
                .budget-meta,
                .budget-grid > :not(.budget-invoice-view) {
                  display: none !important;
                }

                .budget-invoice-view,
                .budget-invoice-view * {
                  visibility: visible !important;
                }

                .budget-invoice-view {
                  box-shadow: none !important;
                  border: none !important;
                  padding: 0 !important;
                  background: #fff !important;
                }

                .budget-invoice-view__actions {
                  display: none !important;
                }
              }
            `}</style>
            <div className="budget-invoice-view__actions" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 24 }}>
              <button type="button" className="budget-btn" onClick={closeInvoiceLogView}>
                Back to Invoice Log
              </button>
              {isWorkOrdersViewMode ? (
                <>
                  <button
                    type="button"
                    className="budget-btn"
                    onClick={() => navigate(`/organization/${id}/budget/invoices/${encodeURIComponent(String(viewingInvoiceId || ''))}`)}
                  >
                    Back to Invoice View
                  </button>
                  <button
                    type="button"
                    className="budget-btn budget-btn--primary"
                    onClick={() => downloadWorkOrdersPdf()}
                    disabled={!viewingInvoiceRecord || isDownloadingWorkOrdersPdf}
                  >
                    {isDownloadingWorkOrdersPdf ? 'Generating Work Orders PDF...' : 'Open Work Orders PDF'}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="budget-btn budget-btn--primary"
                    onClick={downloadInvoicePdf}
                    disabled={!viewingInvoiceRecord || isDownloadingInvoicePdf}
                  >
                    {isDownloadingInvoicePdf ? 'Downloading PDF...' : 'Download PDF'}
                  </button>
                  <button
                    type="button"
                    className="budget-btn"
                    onClick={() => openInvoiceLogWorkOrdersView(viewingInvoiceRecord?.id)}
                    disabled={!viewingInvoiceRecord}
                  >
                    Work Orders Preview
                  </button>
                </>
              )}
            </div>

            {!viewingInvoiceRecord ? (
              <div className="budget-table__empty">Invoice not found for the current log selection.</div>
            ) : (() => {
              const company = companyById[viewingInvoiceRecord.companyId] || {};
              const project = projectById[viewingInvoiceRecord.projectId] || {};
              const invoiceCategoryLabel = invoiceCategoryById[String(viewingInvoiceRecord.categoryId || '').trim()]?.name || 'Invoice';
              const invoiceCategoryColor = '#B91C1C';
              const lineItems = Array.isArray(viewingInvoiceRecord.lineItems) && viewingInvoiceRecord.lineItems.length > 0
                ? viewingInvoiceRecord.lineItems
                : [{ description: '', rate: String(viewingInvoiceRecord.amount ?? 0), quantity: '1', includeInContract: true }];
              const contractTotal = lineItems
                .filter((lineItem) => lineItem.includeInContract !== false)
                .reduce((sum, lineItem) => sum + Number(lineItem.rate || 0) * Number(lineItem.quantity || 0), 0);
              const outsideTotal = lineItems
                .filter((lineItem) => lineItem.includeInContract === false)
                .reduce((sum, lineItem) => sum + Number(lineItem.rate || 0) * Number(lineItem.quantity || 0), 0);
              const grandTotal = contractTotal + outsideTotal;
              const formatCurrency = (value) => Number(value || 0).toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              });

              if (isWorkOrdersViewMode) {
                const workOrderPages = buildDailyWorkOrderPages(lineItems);
                const totalWorkOrderDocumentPages = workOrderPages.length + 1;
                const workOrderLogEntries = workOrderPages.map((workOrderPage, index) => ({
                  workOrderDayId: workOrderPage.workOrderDayId || `WO-UNDATED-${String(index + 1).padStart(2, '0')}`,
                  dayLabel: workOrderPage.dayLabel || 'Work Day',
                  description: buildWorkOrderLogDescription(workOrderPage),
                  totalHours: Number(workOrderPage.totalHours || 0),
                  pageNumber: index + 2,
                }));
                return (
                  <div style={{ display: 'grid', gap: 20 }}>
                    <div
                      style={{
                        background: '#fff',
                        maxWidth: 920,
                        minHeight: '1000px',
                        margin: '0 auto',
                        borderRadius: 10,
                        padding: '44px 52px',
                        color: '#111827',
                        boxShadow: '0 10px 30px rgba(15, 23, 42, 0.08)',
                        border: '1px solid #E5E7EB',
                        display: 'flex',
                        flexDirection: 'column',
                      }}
                    >
                      {orgLogoUrl ? (
                        <div style={{ textAlign: 'center', marginBottom: 14 }}>
                          <img
                            src={orgLogoUrl}
                            alt="Organization logo"
                            style={{ width: 98, height: 98, objectFit: 'contain', borderRadius: 10, background: '#fff' }}
                            onError={(event) => {
                              event.currentTarget.style.display = 'none';
                            }}
                          />
                        </div>
                      ) : null}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20, marginBottom: 20 }}>
                        <div style={{ fontSize: '2rem', fontWeight: 700, letterSpacing: '-0.04em', color: '#B91C1C' }}>WORK ORDER LOG</div>
                        <div style={{ textAlign: 'right', color: '#6B7280' }}>
                          <div>#{viewingInvoiceRecord.invoiceNumber || 'Draft'}</div>
                          <div style={{ marginTop: 4 }}>Week {viewingInvoiceRecord.workWeek || '-'}</div>
                          <div style={{ marginTop: 4 }}>{formatWorkOrderHeaderDate(viewingInvoiceRecord.weekStartDate)} to {formatWorkOrderHeaderDate(viewingInvoiceRecord.weekEndDate)}</div>
                          <div style={{ marginTop: 4 }}>Page 1 of {totalWorkOrderDocumentPages}</div>
                        </div>
                      </div>

                      <div style={{ border: '1px solid #D1D5DB', borderRadius: 8, overflow: 'hidden' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '2.3fr 1.8fr 3fr 1fr 0.8fr', background: '#F9FAFB', borderBottom: '1px solid #E5E7EB', fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#6B7280' }}>
                          <div style={{ padding: '10px 12px' }}>Work Order ID</div>
                          <div style={{ padding: '10px 12px' }}>Day</div>
                          <div style={{ padding: '10px 12px' }}>Description</div>
                          <div style={{ padding: '10px 12px' }}>Hours</div>
                          <div style={{ padding: '10px 12px' }}>Page</div>
                        </div>
                        {workOrderLogEntries.map((entry, entryIndex) => (
                          <div key={`work-order-log-${entry.workOrderDayId}-${entryIndex}`} style={{ display: 'grid', gridTemplateColumns: '2.3fr 1.8fr 3fr 1fr 0.8fr', borderTop: entryIndex === 0 ? 'none' : '1px solid #F3F4F6', fontSize: '0.92rem', color: '#111827' }}>
                            <div style={{ padding: '10px 12px' }}>{entry.workOrderDayId}</div>
                            <div style={{ padding: '10px 12px' }}>{entry.dayLabel}</div>
                            <div style={{ padding: '10px 12px', whiteSpace: 'pre-wrap' }}>{entry.description}</div>
                            <div style={{ padding: '10px 12px' }}>{formatWorkOrderHours(entry.totalHours)} hrs</div>
                            <div style={{ padding: '10px 12px' }}>{entry.pageNumber}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {workOrderPages.map((workOrderPage, index) => {
                      const workOrderPageNumber = index + 2;
                      const totalHoursWorked = Number(workOrderPage.totalHours || 0);
                      const descriptionLines = workOrderPage.descriptionLines;
                      const sessionRows = Array.isArray(workOrderPage.sessionRows) ? workOrderPage.sessionRows : [];
                      const prefaceLines = (descriptionLines || []).filter((line) => {
                        const trimmed = String(line || '').trim();
                        return trimmed
                          && !/^Session:/i.test(trimmed)
                          && !/^\s*Note:/i.test(trimmed)
                          && !/^Day:/i.test(trimmed)
                          && !/^Time Tracker Hours/i.test(trimmed)
                          && !/^Date range:/i.test(trimmed)
                          && !/^Total:/i.test(trimmed)
                          && !/^Duration:/i.test(trimmed);
                      });
                      return (
                        <div
                          key={workOrderPage.id || `work-order-page-${index}`}
                          style={{
                            background: '#fff',
                            maxWidth: 920,
                            minHeight: '1000px',
                            margin: '0 auto',
                            borderRadius: 10,
                            padding: '44px 52px',
                            color: '#111827',
                            boxShadow: '0 10px 30px rgba(15, 23, 42, 0.08)',
                            border: '1px solid #E5E7EB',
                            display: 'flex',
                            flexDirection: 'column',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20, marginBottom: 20 }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
                              {orgLogoUrl ? (
                                <img
                                  src={orgLogoUrl}
                                  alt="Organization logo"
                                  style={{ width: 132, height: 132, objectFit: 'contain', borderRadius: 10, background: '#fff' }}
                                  onError={(event) => {
                                    event.currentTarget.style.display = 'none';
                                  }}
                                />
                              ) : null}
                              <div style={{ fontSize: '1.12rem', fontWeight: 700 }}>{orgName || 'Organization'}</div>
                            </div>

                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontSize: '2rem', fontWeight: 700, letterSpacing: '-0.04em', color: '#B91C1C' }}>WORK ORDER</div>
                              <div style={{ color: '#374151', marginTop: 6 }}>#{viewingInvoiceRecord.invoiceNumber || 'Draft'}</div>
                              <div style={{ color: '#6B7280', marginTop: 4 }}>Week {viewingInvoiceRecord.workWeek || '-'}</div>
                              <div style={{ color: '#6B7280', marginTop: 2 }}>{formatWorkOrderHeaderDate(viewingInvoiceRecord.weekStartDate)} to {formatWorkOrderHeaderDate(viewingInvoiceRecord.weekEndDate)}</div>
                              <div style={{ color: '#6B7280', marginTop: 2 }}>Day {workOrderPage.dayLabel || 'Work Day'}</div>
                              <div style={{ color: '#6B7280', marginTop: 2 }}>ID {workOrderPage.workOrderDayId || 'WO-UNDATED'}</div>
                              <div style={{ color: '#6B7280', marginTop: 8 }}>Page {workOrderPageNumber} of {totalWorkOrderDocumentPages}</div>
                            </div>
                          </div>

                          <div style={{ borderTop: '2px solid #111827', paddingTop: 14 }}>
                            {prefaceLines.map((line, lineIndex) => (
                              <div
                                key={`${workOrderPage.id || index}-preface-${lineIndex}`}
                                style={lineIndex === 0
                                  ? { fontWeight: 700, fontSize: '1rem', whiteSpace: 'pre-wrap' }
                                  : { color: '#4B5563', fontSize: '0.92rem', marginTop: 4, whiteSpace: 'pre-wrap' }}
                              >
                                {line || '\u00a0'}
                              </div>
                            ))}

                            {sessionRows.length > 0 && (
                              <div style={{ marginTop: prefaceLines.length > 0 ? 14 : 0, border: '1px solid #D1D5DB', borderRadius: 8, overflow: 'hidden' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 2fr', background: '#F9FAFB', borderBottom: '1px solid #E5E7EB', fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#6B7280' }}>
                                  <div style={{ padding: '10px 12px' }}>Date</div>
                                  <div style={{ padding: '10px 12px' }}>Total Hours</div>
                                  <div style={{ padding: '10px 12px' }}>Employee</div>
                                </div>
                                {sessionRows.map((sessionRow, rowIndex) => (
                                  <div key={`${workOrderPage.id || index}-session-${rowIndex}`} style={{ borderTop: rowIndex === 0 ? 'none' : '1px solid #F3F4F6' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 2fr', fontSize: '0.92rem', color: '#111827' }}>
                                      <div style={{ padding: '10px 12px' }}>{sessionRow.date || workOrderPage.dayLabel || '—'}</div>
                                      <div style={{ padding: '10px 12px' }}>{Number(sessionRow.hours || 0).toFixed(2)}</div>
                                      <div style={{ padding: '10px 12px' }}>{sessionRow.employee || '—'}</div>
                                    </div>
                                    {(Array.isArray(sessionRow.notes) && sessionRow.notes.length > 0) || Number(sessionRow.hours || 0) > 0 ? (
                                      <div style={{ padding: '0 12px 10px 12px', color: '#6B7280', fontSize: '0.86rem' }}>
                                        {(Array.isArray(sessionRow.notes) && sessionRow.notes.length > 0 ? sessionRow.notes : ['']).map((note, noteIndex) => {
                                          const noteKey = getWorkOrderNoteKey(sessionRow, noteIndex);
                                          const noteDraft = Object.prototype.hasOwnProperty.call(workOrderNoteDrafts, noteKey)
                                            ? workOrderNoteDrafts[noteKey]
                                            : note;
                                          const isSavingThisNote = workOrderSavingNoteKey === noteKey;
                                          const hasChanged = String(noteDraft || '').trim() !== String(note || '').trim();
                                          const isEditingThisNote = workOrderEditingNoteKey === noteKey;
                                          const showEditIcon = isEditingThisNote || workOrderHoveredNoteKey === noteKey;
                                          const hasExistingNoteText = String(note || '').trim().length > 0;

                                          return (
                                            <div
                                              key={`${workOrderPage.id || index}-session-${rowIndex}-note-${noteIndex}`}
                                              style={{ marginTop: 6, paddingLeft: 2 }}
                                              onMouseEnter={() => setWorkOrderHoveredNoteKey(noteKey)}
                                              onMouseLeave={() => setWorkOrderHoveredNoteKey((current) => (current === noteKey ? '' : current))}
                                            >
                                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                                                {hasExistingNoteText ? (
                                                  <div style={{ color: '#4B5563', whiteSpace: 'pre-wrap', display: 'grid', gridTemplateColumns: '10px 1fr', columnGap: 8, alignItems: 'start' }}>
                                                    <span
                                                      aria-hidden="true"
                                                      style={{ width: 6, height: 6, borderRadius: '50%', background: '#9CA3AF', marginTop: 7, justifySelf: 'center' }}
                                                    />
                                                    <span style={{ lineHeight: 1.45 }}>{note}</span>
                                                  </div>
                                                ) : <div style={{ color: '#9CA3AF', fontStyle: 'italic' }}>No note</div>}
                                                <button
                                                  type="button"
                                                  className="budget-btn"
                                                  title={hasExistingNoteText ? 'Edit note' : 'Add note'}
                                                  aria-label={hasExistingNoteText ? 'Edit note' : 'Add note'}
                                                  style={{ fontSize: '0.75rem', padding: '2px 8px', minWidth: 'unset', opacity: showEditIcon ? 1 : 0, pointerEvents: showEditIcon ? 'auto' : 'none', transition: 'opacity 120ms ease' }}
                                                  onClick={() => {
                                                    setWorkOrderEditingNoteKey(noteKey);
                                                    setWorkOrderNoteDrafts((current) => {
                                                      if (Object.prototype.hasOwnProperty.call(current, noteKey)) return current;
                                                      return { ...current, [noteKey]: note };
                                                    });
                                                  }}
                                                >
                                                  {hasExistingNoteText ? 'Edit' : 'Add'}
                                                </button>
                                              </div>

                                              {isEditingThisNote && (
                                                <>
                                                  <textarea
                                                    value={noteDraft}
                                                    onChange={(event) => {
                                                      const value = event.target.value;
                                                      setWorkOrderNoteDrafts((current) => ({ ...current, [noteKey]: value }));
                                                    }}
                                                    rows={2}
                                                    style={{ width: '100%', marginTop: 8, border: '1px solid #D1D5DB', borderRadius: 6, padding: '8px 10px', resize: 'vertical', fontFamily: 'inherit', fontSize: '0.86rem', color: '#374151', background: '#fff' }}
                                                  />
                                                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
                                                    <button
                                                      type="button"
                                                      className="budget-btn"
                                                      style={{ fontSize: '0.78rem', padding: '4px 10px' }}
                                                      onClick={() => {
                                                        setWorkOrderEditingNoteKey('');
                                                        setWorkOrderNoteDrafts((current) => {
                                                          const next = { ...current };
                                                          delete next[noteKey];
                                                          return next;
                                                        });
                                                      }}
                                                    >
                                                      Cancel
                                                    </button>
                                                    <button
                                                      type="button"
                                                      className="budget-btn"
                                                      style={{ fontSize: '0.78rem', padding: '4px 10px' }}
                                                      disabled={!hasChanged || isSavingThisNote}
                                                      onClick={() => handleSaveWorkOrderSessionNote(sessionRow, noteIndex, note)}
                                                    >
                                                      {isSavingThisNote ? 'Saving...' : 'Save Note'}
                                                    </button>
                                                  </div>
                                                </>
                                              )}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    ) : null}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          {viewingInvoiceRecord.notes && (
                            <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid #E5E7EB' }}>
                              <div style={{ fontSize: '0.74rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.11em', color: '#9CA3AF', marginBottom: 8 }}>
                                Notes
                              </div>
                              <div style={{ whiteSpace: 'pre-wrap', color: '#374151' }}>{viewingInvoiceRecord.notes}</div>
                            </div>
                          )}

                          <div style={{ marginTop: 28, paddingTop: 14, borderTop: '1px solid #D1D5DB', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ color: '#374151' }}>Total Hours Worked</span>
                            <strong style={{ fontSize: '1.08rem' }}>{formatWorkOrderHours(totalHoursWorked)} hrs</strong>
                          </div>

                          <div style={{ marginTop: 'auto', paddingTop: 40, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28 }}>
                            <div>
                              <div style={{ borderTop: '1px solid #111827', marginBottom: 8 }} />
                              <div style={{ fontSize: '0.86rem', color: '#4B5563' }}>Client Signature / Date</div>
                            </div>
                            <div>
                              <div style={{ borderTop: '1px solid #111827', marginBottom: 8 }} />
                              <div style={{ fontSize: '0.86rem', color: '#4B5563' }}>Contractor Signature / Date</div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              }

              return (
                <div ref={invoicePdfRef} style={{ background: '#fff', maxWidth: 920, margin: '0 auto', borderRadius: 10, padding: '48px 56px', color: '#111827', boxShadow: '0 10px 30px rgba(15, 23, 42, 0.08)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 24, marginBottom: 36 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'flex-start' }}>
                      {orgLogoUrl ? (
                        <img
                          data-invoice-logo="true"
                          src={orgLogoUrl}
                          alt="Organization logo"
                          style={{ width: 280, height: 280, objectFit: 'contain', borderRadius: 16, background: '#fff' }}
                          onError={(event) => {
                            event.currentTarget.style.display = 'none';
                          }}
                        />
                      ) : null}
                      <div>
                        <div style={{ fontSize: '1.8rem', fontWeight: 700, letterSpacing: '-0.03em' }}>{orgName || 'Organization'}</div>
                        <div style={{ color: invoiceCategoryColor, fontSize: '0.92rem', fontWeight: 700, marginTop: 4 }}>Weekly {invoiceCategoryLabel.toLowerCase()} record</div>
                      </div>
                    </div>

                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '2rem', fontWeight: 700, letterSpacing: '-0.04em', color: invoiceCategoryColor }}>{invoiceCategoryLabel.toUpperCase()}</div>
                      <div style={{ color: '#374151', marginTop: 6 }}>#{viewingInvoiceRecord.invoiceNumber || 'Draft'}</div>
                      <div style={{ color: '#6B7280', marginTop: 4 }}>Week {viewingInvoiceRecord.workWeek || '-'}</div>
                      <div style={{ color: '#6B7280', marginTop: 2 }}>{viewingInvoiceRecord.weekStartDate || '-'} to {viewingInvoiceRecord.weekEndDate || '-'}</div>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28, marginBottom: 32 }}>
                    <div>
                      <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#9CA3AF', marginBottom: 8 }}>Bill To</div>
                      <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>{company.name || viewingInvoiceRecord.companyName || '—'}</div>
                      {company.contactName && <div style={{ color: '#4B5563', marginTop: 4 }}>{company.contactName}</div>}
                      {company.contactEmail && <div style={{ color: '#4B5563', marginTop: 2 }}>{company.contactEmail}</div>}
                    </div>
                    <div>
                      <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#9CA3AF', marginBottom: 8 }}>Project</div>
                      <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>{project.name || viewingInvoiceRecord.projectName || '—'}</div>
                      <div style={{ color: '#4B5563', marginTop: 4 }}>
                        {viewingInvoiceRecord.contractNames.length > 0
                          ? viewingInvoiceRecord.contractNames.join(', ')
                          : 'No contracts'}
                      </div>
                      <div style={{ color: '#4B5563', marginTop: 4, textTransform: 'capitalize' }}>Status: {viewingInvoiceRecord.status || 'submitted'}</div>
                    </div>
                  </div>

                  <div style={{ borderTop: '2px solid #111827', borderBottom: '1px solid #E5E7EB' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3.3fr) 56px 88px 96px', gap: 8, padding: '12px 0', fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#6B7280' }}>
                      <div>Description</div>
                      <div style={{ textAlign: 'center' }}>Qty</div>
                      <div style={{ textAlign: 'right' }}>Rate</div>
                      <div style={{ textAlign: 'right' }}>Amount</div>
                    </div>

                    {lineItems.map((lineItem, index) => {
                      const lineTotal = Number(lineItem.rate || 0) * Number(lineItem.quantity || 0);
                      const descriptionLines = String(lineItem.description || '').split('\n');
                      return (
                        <div key={lineItem.id || index} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3.3fr) 56px 88px 96px', gap: 8, padding: '16px 0', borderTop: index === 0 ? '1px solid #E5E7EB' : '1px solid #F3F4F6', alignItems: 'start' }}>
                          <div>
                            {descriptionLines.map((line, lineIndex) => {
                              const trimmedLine = String(line || '').trim();
                              const isSessionLine = /^Session:/i.test(trimmedLine);
                              const isNoteLine = /^Note:/i.test(trimmedLine);
                              const lineStyle = lineIndex === 0
                                ? { fontWeight: 600, whiteSpace: 'pre-wrap' }
                                : isSessionLine
                                  ? { color: '#111827', fontSize: '0.92rem', fontWeight: 700, marginTop: 10, whiteSpace: 'pre-wrap' }
                                  : isNoteLine
                                    ? { color: '#6B7280', fontSize: '0.88rem', marginTop: 2, paddingLeft: 12, whiteSpace: 'pre-wrap' }
                                    : { color: '#6B7280', fontSize: '0.9rem', marginTop: 2, whiteSpace: 'pre-wrap' };

                              return (
                                <div key={`${lineItem.id || index}-${lineIndex}`} style={lineStyle}>
                                  {line || '\u00a0'}
                                </div>
                              );
                            })}
                          </div>
                          <div style={{ textAlign: 'center' }}>{lineItem.quantity || '—'}</div>
                          <div style={{ textAlign: 'right' }}>{lineItem.rate ? `$${formatCurrency(lineItem.rate)}` : '—'}</div>
                          <div style={{ textAlign: 'right', fontWeight: 600 }}>${formatCurrency(lineTotal)}</div>
                        </div>
                      );
                    })}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 28 }}>
                    <div style={{ width: '100%', maxWidth: 320 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', color: '#4B5563' }}>
                        <span>Contract Scope</span>
                        <strong>${formatCurrency(contractTotal)}</strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', color: '#4B5563' }}>
                        <span>Outside Contract</span>
                        <strong>${formatCurrency(outsideTotal)}</strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0 0', marginTop: 10, borderTop: '2px solid #111827', fontSize: '1.15rem' }}>
                        <span style={{ fontWeight: 700 }}>Total Due</span>
                        <span style={{ fontWeight: 700 }}>${formatCurrency(grandTotal)}</span>
                      </div>
                    </div>
                  </div>

                  {viewingInvoiceRecord.notes && (
                    <div style={{ marginTop: 36, paddingTop: 20, borderTop: '1px solid #E5E7EB' }}>
                      <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#9CA3AF', marginBottom: 10 }}>Notes</div>
                      <div style={{ whiteSpace: 'pre-wrap', color: '#374151' }}>{viewingInvoiceRecord.notes}</div>
                    </div>
                  )}
                </div>
              );
            })()}
          </section>
          ) : (
          <section className="budget-card budget-card--full">
            <h2>Weekly Invoice Log</h2>
            <div style={{ marginBottom: 20, padding: 16, border: '1px solid #E5E7EB', borderRadius: 12, background: '#F8FAFC' }}>
              <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#111827', marginBottom: 12 }}>Invoice Categories</div>
              <form onSubmit={handleSaveInvoiceCategory} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'end', marginBottom: 14 }}>
                <div className="budget-form__field" style={{ flex: '1 1 260px', marginBottom: 0 }}>
                  <label htmlFor="invoice-category-name">Category Name</label>
                  <input
                    id="invoice-category-name"
                    type="text"
                    value={invoiceCategoryName}
                    onChange={(event) => setInvoiceCategoryName(event.target.value)}
                    placeholder="Example: Estimate, Proposal, Change Order"
                  />
                </div>
                <button type="submit" className="budget-btn budget-btn--primary" disabled={Boolean(invoiceCategoryActionKey)}>
                  {editingInvoiceCategoryId ? 'Update Category' : 'Add Category'}
                </button>
                {editingInvoiceCategoryId && (
                  <button type="button" className="budget-btn" onClick={resetInvoiceCategoryForm} disabled={Boolean(invoiceCategoryActionKey)}>
                    Cancel
                  </button>
                )}
              </form>

              {invoiceCategories.length > 0 ? (
                <div className="budget-table-wrap" style={{ marginTop: 8 }}>
                  <table className="budget-table">
                    <thead>
                      <tr>
                        <th>Category</th>
                        <th>Used By</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoiceCategories.map((category) => {
                        const usageCount = invoices.filter((invoice) => String(invoice.categoryId || '').trim() === category.id).length;
                        return (
                          <tr key={category.id}>
                            <td>{category.name}</td>
                            <td>{usageCount} invoice{usageCount === 1 ? '' : 's'}</td>
                            <td>
                              <div className="budget-list__actions">
                                <button
                                  type="button"
                                  className="budget-btn"
                                  disabled={Boolean(invoiceCategoryActionKey)}
                                  onClick={() => {
                                    setEditingInvoiceCategoryId(category.id);
                                    setInvoiceCategoryName(category.name || '');
                                  }}
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  className="budget-btn budget-btn--danger"
                                  disabled={Boolean(invoiceCategoryActionKey)}
                                  onClick={() => handleDeleteInvoiceCategory(category)}
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="budget-form__hint">No custom categories yet. Add one above to replace the default Invoice label.</div>
              )}
            </div>
            <div className="budget-invoice-log__filters">
              <div className="budget-form__field">
                <label htmlFor="invoice-log-company-filter">Company</label>
                <div className="budget-dashboard__select-wrap">
                  <select
                    id="invoice-log-company-filter"
                    className="budget-dashboard__select"
                    value={invoiceLogCompanyId}
                    onChange={(event) => {
                      setInvoiceLogCompanyId(event.target.value);
                      setInvoiceLogProjectId('');
                      setInvoiceLogContractId('');
                    }}
                  >
                    <option value="">All Companies</option>
                    {sortByName(companies, 'name').map((company) => (
                      <option key={company.id} value={company.id}>
                        {company.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="budget-form__field">
                <label htmlFor="invoice-log-project-filter">Project</label>
                <div className="budget-dashboard__select-wrap">
                  <select
                    id="invoice-log-project-filter"
                    className="budget-dashboard__select"
                    value={invoiceLogProjectId}
                    onChange={(event) => {
                      setInvoiceLogProjectId(event.target.value);
                      setInvoiceLogContractId('');
                    }}
                  >
                    <option value="">All Projects</option>
                    {invoiceLogProjectOptions.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="budget-form__field">
                <label htmlFor="invoice-log-contract-filter">Contract</label>
                <div className="budget-dashboard__select-wrap">
                  <select
                    id="invoice-log-contract-filter"
                    className="budget-dashboard__select"
                    value={invoiceLogContractId}
                    onChange={(event) => setInvoiceLogContractId(event.target.value)}
                  >
                    <option value="">All Contracts</option>
                    {invoiceLogContractOptions.map((contract) => (
                      <option key={contract.id} value={contract.id}>
                        {contract.title || 'Untitled Contract'}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="budget-form__field">
                <label htmlFor="invoice-log-search">Search</label>
                <input
                  id="invoice-log-search"
                  type="search"
                  className="budget-invoice-log__search"
                  placeholder="Search invoices, contracts, companies, projects"
                  value={invoiceLogSearchTerm}
                  onChange={(event) => setInvoiceLogSearchTerm(event.target.value)}
                />
              </div>
            </div>

            <div className="budget-table-wrap">
              <table className="budget-table budget-table--wide">
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Company</th>
                    <th>Category</th>
                    <th>Contracts</th>
                    <th>Master</th>
                    <th>Invoice #</th>
                    <th>Week</th>
                    <th>Week Start</th>
                    <th>Week End</th>
                    <th>Contract Scope</th>
                    <th>Outside Contract</th>
                    <th>Invoice Total</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {invoiceLogRows.map((invoice) => (
                    <tr key={invoice.id}>
                      {(() => {
                        const masterInvoice = masterInvoiceIdByTimeline[
                          getInvoiceTimelineKey(invoice.projectId, invoice.contractId || '')
                        ];
                        const isMasterInvoice = masterInvoice?.id === invoice.id;
                        return (
                          <>
                            <td>{invoice.projectName}</td>
                            <td>{invoice.companyName}</td>
                            <td>
                              <select
                                value={invoice.categoryId || ''}
                                onChange={(event) => handleUpdateInvoiceCategory(invoice.id, event.target.value)}
                              >
                                <option value="">Invoice</option>
                                {invoiceCategories.map((category) => (
                                  <option key={category.id} value={category.id}>
                                    {category.name}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td>
                              {invoice.contractNames.length > 0
                                ? invoice.contractNames.join(', ')
                                : 'No contracts'}
                            </td>
                            <td>
                              <span
                                className={`budget-master-badge ${isMasterInvoice ? 'budget-master-badge--master' : 'budget-master-badge--standard'}`}
                                title={isMasterInvoice ? 'This invoice controls the project timeline' : 'Standard invoice'}
                              >
                                {isMasterInvoice ? '★ Master' : 'Standard'}
                              </span>
                            </td>
                            <td>{invoice.invoiceNumber || '-'}</td>
                            <td>{invoice.workWeek || '-'}</td>
                            <td>{invoice.weekStartDate || '-'}</td>
                            <td>{invoice.weekEndDate || '-'}</td>
                            <td>
                              ${Number(invoice.contractAmount ?? invoice.amount ?? 0).toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </td>
                            <td>
                              ${Number(invoice.nonContractAmount || 0).toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </td>
                            <td>
                              ${Number(invoice.amount || 0).toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </td>
                            <td>{invoice.status || 'submitted'}</td>
                            <td>
                              <div className="budget-list__actions">
                                <button
                                  className="budget-btn"
                                  onClick={() => {
                                    setEditingInvoiceId(invoice.id);
                                    setInvoiceForm({
                                      companyId: invoice.companyId || projectById[invoice.projectId]?.companyId || '',
                                      projectId: invoice.projectId || '',
                                      contractId: invoice.contractId || '',
                                      categoryId: invoice.categoryId || '',
                                      invoiceNumber: invoice.invoiceNumber || '',
                                      workWeek: String(invoice.workWeek ?? ''),
                                      weekOneDate: invoice.weekStartDate || '',
                                      notes: invoice.notes || '',
                                      lineItems:
                                        Array.isArray(invoice.lineItems) && invoice.lineItems.length > 0
                                          ? invoice.lineItems.map((lineItem) => ({
                                              id: lineItem.id || createEmptyLineItem().id,
                                              description: lineItem.description || '',
                                              rate: String(lineItem.rate ?? ''),
                                              quantity: String(lineItem.quantity ?? ''),
                                              includeInContract: lineItem.includeInContract !== false,
                                            }))
                                          : [
                                              {
                                                ...createEmptyLineItem(),
                                                description: '',
                                                rate: String(invoice.amount ?? 0),
                                                quantity: '1',
                                                includeInContract: true,
                                              },
                                            ],
                                    });
                                    setBudgetTab('invoice-create');
                                  }}
                                >
                                  Edit
                                </button>
                                <button
                                  className="budget-btn budget-btn--danger"
                                  onClick={() => handleDelete('invoice', invoice.id)}
                                >
                                  Delete
                                </button>
                                <button
                                  className="budget-btn"
                                  onClick={() => openInvoiceLogView(invoice.id)}
                                >
                                  View
                                </button>
                                <button
                                  className="budget-btn"
                                  onClick={() => openInvoiceLogWorkOrdersView(invoice.id)}
                                  disabled={isDownloadingWorkOrdersPdf}
                                >
                                  Work Orders
                                </button>
                              </div>
                            </td>
                          </>
                        );
                      })()}
                    </tr>
                  ))}
                  {invoiceLogRows.length === 0 && (
                    <tr>
                      <td colSpan={13} className="budget-table__empty">
                        {invoiceLogContractId
                          ? 'No invoices are linked to the selected contract yet.'
                          : 'No invoices found for the selected filters.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
          )
          )}
        </div>
      )}

      <div className="budget-meta">
        <span>{companies.length} companies</span>
        <span>{projects.length} projects</span>
        <span>{contracts.length} contracts</span>
        <span>{invoices.length} invoices</span>
      </div>

      </div>
  );
};

export default BudgetPage;