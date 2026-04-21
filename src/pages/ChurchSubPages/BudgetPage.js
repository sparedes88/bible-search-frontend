import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
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
  invoiceNumber: '',
  workWeek: '',
  weekOneDate: '',
  notes: '',
  lineItems: [createEmptyLineItem()],
});

const sortByName = (items, key = 'name') =>
  [...items].sort((a, b) => String(a?.[key] || '').localeCompare(String(b?.[key] || '')));

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

const BudgetPage = () => {
  const { id } = useParams();
  const { user, loading: authLoading } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = getResolvedBudgetTab(searchParams.get('tab'));
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
      const lineItemText = Array.isArray(invoice.lineItems)
        ? invoice.lineItems.map((item) => item?.description || '').join(' ')
        : '';
      return [
        projectName,
        companyName,
        String(invoice.workWeek || ''),
        String(invoice.invoiceNumber || ''),
        invoice.notes || '',
        lineItemText,
      ]
        .join(' ')
        .toLowerCase()
        .includes(normalizedSearch);
    });
  }, [invoices, projectById, companyById, searchTerm]);

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
        const lineItemText = Array.isArray(invoice.lineItems)
          ? invoice.lineItems.map((item) => item?.description || '').join(' ')
          : '';

        return {
          ...invoice,
          projectContracts,
          linkedContractIds: resolvedContractIds,
          contractNames: displayContractNames,
          projectName: projectById[invoice.projectId]?.name || 'Unknown',
          companyName: companyById[invoice.companyId]?.name || 'Unknown',
          searchableText: [
            projectById[invoice.projectId]?.name || '',
            companyById[invoice.companyId]?.name || '',
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
    contractById,
    contractsByProjectId,
    invoiceLinkedContractIds,
    invoiceLogSearchTerm,
    invoiceLogCompanyId,
    invoiceLogProjectId,
    invoiceLogContractId,
  ]);

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

  const loadBudgetData = async () => {
    if (!id) return;

    setIsLoading(true);
    try {
      const [companiesSnap, projectsSnap, contractsSnap, invoicesSnap, preferencesSnap] = await Promise.all([
        getDocs(companiesRef),
        getDocs(projectsRef),
        getDocs(contractsRef),
        getDocs(invoicesRef),
        getDoc(doc(db, 'churches', id, 'settings', 'budgetDashboardPreferences')),
      ]);

      const loadedCompanies = companiesSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
      const loadedProjects = projectsSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
      const loadedContracts = contractsSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
      const loadedInvoices = invoicesSnap.docs.map((item) => ({ id: item.id, ...item.data() }));

      setCompanies(sortByName(loadedCompanies, 'name'));
      setProjects(sortByName(loadedProjects, 'name'));
      setContracts(sortByName(loadedContracts, 'title'));
      setInvoices(loadedInvoices);

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
      setSearchParams(nextParams, { replace: true });
    }
  }, [activeTab, searchParams, setSearchParams]);

  const setBudgetTab = (tabId) => {
    setActiveTab(getResolvedBudgetTab(tabId));
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

    if (!selectedContract) {
      toast.error('Select a contract for this invoice.');
      return;
    }

    if (selectedContract.projectId !== projectId) {
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
                </div>

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
          <section className="budget-card budget-card--full">
            <h2>Weekly Invoice Log</h2>
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