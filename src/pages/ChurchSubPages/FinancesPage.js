import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom';
import { auth, db, storage } from '../../firebase';
import { collection, addDoc, getDocs, getDoc, setDoc, deleteDoc, doc, updateDoc, query, orderBy, where } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getChurchData } from '../../api/church';
import commonStyles from '../../pages/commonStyles';
import { toast } from 'react-toastify';
import { FaPlus, FaSearch, FaFilter, FaComment, FaFilePdf, FaArrowUp, FaArrowDown, FaBalanceScale, FaClock, FaCheckCircle, FaInfoCircle } from 'react-icons/fa';
import Modal from '../../components/Modal';
import ChurchHeader from '../../components/ChurchHeader';
import jsPDF from 'jspdf';

const formatDate = (timestamp) => {
  if (!timestamp) return '';
  
  // Handle Firestore Timestamp
  if (timestamp?.toDate) {
    return timestamp.toDate().toLocaleString();
  }
  
  // Handle regular Date object or string
  return new Date(timestamp).toLocaleString();
};

const formatDateInputValue = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const normalizeDateOnlyValue = (value) => {
  if (!value) return '';

  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  if (value?.toDate) {
    return formatDateInputValue(value.toDate());
  }

  return formatDateInputValue(value);
};

const formatDateOnlyForDisplay = (value) => {
  const normalized = normalizeDateOnlyValue(value);
  if (!normalized) return '';

  const [year, month, day] = normalized.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString();
};

const getComparableTimestamp = (value) => {
  if (!value) return 0;

  if (value?.toDate) {
    return value.toDate().getTime();
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

const compareFinancesNewestFirst = (leftFinance, rightFinance) => {
  const dateCompare = String(rightFinance?.date || '').localeCompare(String(leftFinance?.date || ''));
  if (dateCompare !== 0) return dateCompare;

  const createdAtCompare = getComparableTimestamp(rightFinance?.createdAt) - getComparableTimestamp(leftFinance?.createdAt);
  if (createdAtCompare !== 0) return createdAtCompare;

  return String(rightFinance?.id || '').localeCompare(String(leftFinance?.id || ''));
};

const FINANCE_SETTINGS_DOC_ID = 'financeOptions';
const defaultTransactionTypes = [
  { value: 'expense', flow: 'expense' },
  { value: 'income', flow: 'income' },
];

const normalizeOptionValues = (values = []) => {
  return Array.from(
    new Set(
      values
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean)
    )
  ).sort();
};

const normalizeTransactionTypeDefinitions = (definitions = []) => {
  const normalizedMap = new Map();

  definitions.forEach((definition) => {
    const value = String(definition?.value || definition || '').trim().toLowerCase();
    if (!value) return;

    const flow = String(definition?.flow || '').trim().toLowerCase() === 'income' ? 'income' : 'expense';
    normalizedMap.set(value, { value, flow });
  });

  return Array.from(normalizedMap.values()).sort((left, right) => left.value.localeCompare(right.value));
};

const normalizeCategoryValue = (value) => String(value || '').trim().toLowerCase();

const createReimbursementEntryId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const getRawFundTypeValue = (finance) => {
  const fallbackValue = 'cash';
  const rawValue = finance?.fundType || finance?.typeOfFunds || fallbackValue;
  return String(rawValue).trim().toLowerCase() || fallbackValue;
};

const buildEmptyReimbursementEntry = (fundType = 'cash') => ({
  id: createReimbursementEntryId(),
  reimbursementType: 'partial',
  amount: '',
  date: formatDateInputValue(),
  approvedBy: '',
  receivedBy: '',
  checkNumber: '',
  fundType: String(fundType || 'cash').trim().toLowerCase() || 'cash',
});

const normalizeReimbursementEntriesForForm = (entries = [], fallbackFundType = 'cash') => {
  if (!Array.isArray(entries)) return [];

  return entries.map((entry) => ({
    id: String(entry?.id || createReimbursementEntryId()),
    reimbursementType: entry?.reimbursementType === 'total' ? 'total' : 'partial',
    amount: entry?.amount === 0 ? '0' : String(entry?.amount ?? ''),
    date: normalizeDateOnlyValue(entry?.date) || formatDateInputValue(),
    approvedBy: String(entry?.approvedBy || ''),
    receivedBy: String(entry?.receivedBy || ''),
    checkNumber: String(entry?.checkNumber || ''),
    fundType: String(entry?.fundType || fallbackFundType || 'cash').trim().toLowerCase() || 'cash',
  }));
};

const normalizeReimbursementEntriesForSave = (entries = [], fallbackFundType = 'cash') => {
  if (!Array.isArray(entries)) return [];

  return entries
    .map((entry) => ({
      id: String(entry?.id || createReimbursementEntryId()),
      reimbursementType: entry?.reimbursementType === 'total' ? 'total' : 'partial',
      amount: Number(entry?.amount || 0),
      date: normalizeDateOnlyValue(entry?.date),
      approvedBy: String(entry?.approvedBy || '').trim(),
      receivedBy: String(entry?.receivedBy || '').trim(),
      checkNumber: String(entry?.checkNumber || '').trim(),
      fundType: String(entry?.fundType || fallbackFundType || 'cash').trim().toLowerCase() || 'cash',
    }))
    .filter((entry) => entry.amount > 0);
};

const getStoredReimbursementEntries = (finance) => normalizeReimbursementEntriesForSave(
  finance?.reimbursementEntries || [],
  getRawFundTypeValue(finance)
);

const calculateReimbursedAmount = (finance, getTransactionFlow) => {
  if (getTransactionFlow(finance) !== 'expense') return 0;

  const totalAmount = Number(finance?.amount || 0);
  const reimbursementEntries = getStoredReimbursementEntries(finance);
  const loggedAmount = reimbursementEntries.reduce(
    (sum, entry) => sum + Number(entry?.amount || 0),
    0
  );

  if (loggedAmount > 0) {
    return Math.min(totalAmount, loggedAmount);
  }

  return finance?.reimbursed ? totalAmount : 0;
};

const calculatePendingReimbursementAmount = (finance, getTransactionFlow) => {
  if (getTransactionFlow(finance) !== 'expense') return 0;
  return Math.max(Number(finance?.amount || 0) - calculateReimbursedAmount(finance, getTransactionFlow), 0);
};

const getOverallReimbursementStatus = (finance, getTransactionFlow) => {
  if (getTransactionFlow(finance) !== 'expense') return 'n/a';

  const reimbursedAmount = calculateReimbursedAmount(finance, getTransactionFlow);
  const pendingAmount = calculatePendingReimbursementAmount(finance, getTransactionFlow);

  if (reimbursedAmount <= 0) return 'needs-reimbursement';
  if (pendingAmount > 0.009) return 'partially-reimbursed';
  return 'fully-reimbursed';
};

const formatCurrency = (value) => `$${Number(value || 0).toFixed(2)}`;

const getBase64Image = async (imgUrl) => {
  if (!imgUrl) return null;

  try {
    const response = await fetch(imgUrl);
    const blob = await response.blob();

    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error('Error converting image to base64:', error);
    return null;
  }
};

const getChurchBrandingDisplayName = (branding) => (
  branding?.nombre
  || branding?.name
  || branding?.churchName
  || branding?.organizationName
  || branding?.orgName
  || 'Church'
);

const getChurchBrandingLogo = (branding) => (
  branding?.logo
  || branding?.Logo
  || branding?.logoUrl
  || branding?.logoURL
  || branding?.churchLogo
  || null
);

const calculateDraftReimbursementAmount = (entries = []) => {
  if (!Array.isArray(entries)) return 0;
  return entries.reduce((sum, entry) => sum + Number(entry?.amount || 0), 0);
};

const calculateDraftRemainingReimbursementAmount = (entryAmount, entries = [], excludeEntryId = null) => {
  const totalAmount = Number(entryAmount || 0);
  const reimbursedDraftAmount = (Array.isArray(entries) ? entries : []).reduce((sum, entry) => {
    if (excludeEntryId && entry?.id === excludeEntryId) return sum;
    return sum + Number(entry?.amount || 0);
  }, 0);

  return Math.max(totalAmount - reimbursedDraftAmount, 0);
};

const areReimbursementEntriesEqual = (leftEntries = [], rightEntries = []) => {
  const normalizeForCompare = (entries) => JSON.stringify(
    [...(Array.isArray(entries) ? entries : [])]
      .map((entry) => ({
        reimbursementType: entry?.reimbursementType === 'total' ? 'total' : 'partial',
        amount: Number(entry?.amount || 0),
        date: normalizeDateOnlyValue(entry?.date),
        approvedBy: String(entry?.approvedBy || '').trim(),
        receivedBy: String(entry?.receivedBy || '').trim(),
        fundType: String(entry?.fundType || '').trim().toLowerCase(),
        checkNumber: String(entry?.checkNumber || '').trim(),
      }))
      .sort((left, right) => String(left.date || '').localeCompare(String(right.date || '')) || left.amount - right.amount)
  );

  return normalizeForCompare(leftEntries) === normalizeForCompare(rightEntries);
};

const calculateTotalsByType = (finances, getTransactionFlow) => {
  return finances.reduce((acc, finance) => {
    const flow = getTransactionFlow(finance);
    acc[flow] = (acc[flow] || 0) + Number(finance.amount);
    return acc;
  }, { income: 0, expense: 0 });
};

const calculateTotalsByCategory = (finances, getTransactionFlow) => {
  return finances.reduce((acc, finance) => {
    const category = finance.category || 'Uncategorized';
    if (!acc[category]) {
      acc[category] = { income: 0, expense: 0 };
    }
    acc[category][getTransactionFlow(finance)] += Number(finance.amount || 0);
    return acc;
  }, {});
};

const getMonthLabelFromDateOnly = (value) => {
  const normalized = normalizeDateOnlyValue(value);
  if (!normalized) return 'Unknown Month';

  const [year, month] = normalized.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
};

const calculateMonthlySummaries = (finances, getTransactionFlow) => {
  const monthlyMap = finances.reduce((accumulator, finance) => {
    const monthKey = String(normalizeDateOnlyValue(finance?.date) || '').slice(0, 7);
    if (!monthKey) return accumulator;

    if (!accumulator[monthKey]) {
      accumulator[monthKey] = {
        monthKey,
        monthLabel: getMonthLabelFromDateOnly(finance?.date),
        income: 0,
        expense: 0,
        needsReimbursement: 0,
        reimbursed: 0,
        entries: 0,
      };
    }

    const amount = Number(finance?.amount || 0);
    accumulator[monthKey].entries += 1;

    if (getTransactionFlow(finance) === 'income') {
      accumulator[monthKey].income += amount;
    } else {
      const reimbursedAmount = calculateReimbursedAmount(finance, getTransactionFlow);
      const pendingAmount = Math.max(amount - reimbursedAmount, 0);

      accumulator[monthKey].expense += amount;
      accumulator[monthKey].reimbursed += reimbursedAmount;
      accumulator[monthKey].needsReimbursement += pendingAmount;
    }

    return accumulator;
  }, {});

  return Object.values(monthlyMap)
    .map((monthSummary) => ({
      ...monthSummary,
      netBalance: monthSummary.income - monthSummary.reimbursed,
      netBalanceWithPending: monthSummary.income - monthSummary.reimbursed - monthSummary.needsReimbursement,
    }))
    .sort((leftMonth, rightMonth) => rightMonth.monthKey.localeCompare(leftMonth.monthKey));
};

const getReimbursementStatus = (finance, getTransactionFlow) => {
  const status = getOverallReimbursementStatus(finance, getTransactionFlow);

  if (status === 'fully-reimbursed') return 'Fully Reimbursed';
  if (status === 'partially-reimbursed') return 'Partially Reimbursed';
  if (status === 'needs-reimbursement') return 'Needs Reimbursement';
  return 'N/A';
};

const hashPin = async (pinValue) => {
  const pin = String(pinValue || '').trim();
  if (!pin) return '';

  if (typeof window !== 'undefined' && window.crypto?.subtle) {
    const encoded = new TextEncoder().encode(pin);
    const digest = await window.crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  return pin;
};

const normalizePhone = (value) => String(value || '').replace(/\D/g, '');

const formatPhoneInput = (value) => {
  const digits = normalizePhone(value).slice(0, 11);
  const hasLeadingOne = digits.length > 0 && digits[0] === '1';
  const workingDigits = hasLeadingOne ? digits.slice(1, 11) : digits.slice(0, 10);

  const area = workingDigits.slice(0, 3);
  const prefix = workingDigits.slice(3, 6);
  const line = workingDigits.slice(6, 10);

  let formatted = '';
  if (area) {
    formatted = `(${area}`;
    if (area.length === 3) formatted += ')';
  }
  if (prefix) {
    formatted += `${formatted ? ' ' : ''}${prefix}`;
  }
  if (line) {
    formatted += `-${line}`;
  }

  return hasLeadingOne ? `1 ${formatted}`.trim() : formatted;
};

const FinancesPage = () => {
  const { id, entryId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const defaultFundTypes = ['cash', 'check'];
  const [finances, setFinances] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newEntry, setNewEntry] = useState({
    title: '',
    description: '',
    amount: '',
    category: '',
    type: 'expense',
    reimbursed: false,
    reimbursementEntries: [],
    fundType: 'cash',
    personId: '',
    date: formatDateInputValue()
  });
  const [editingId, setEditingId] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState({
    type: 'all',
    category: 'all',
    startDate: '',
    endDate: ''
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [comments, setComments] = useState({});
  const [showCommentModal, setShowCommentModal] = useState(false);
  const [selectedFinanceId, setSelectedFinanceId] = useState(null);
  const [newComment, setNewComment] = useState('');
  const [editingCommentId, setEditingCommentId] = useState(null);
  const [editingCommentText, setEditingCommentText] = useState('');
  const itemsPerPage = 10;
  const [categories, setCategories] = useState([]);
  const [newCategory, setNewCategory] = useState('');
  const [managingCategory, setManagingCategory] = useState(false);
  const [fundTypes, setFundTypes] = useState(defaultFundTypes);
  const [newFundType, setNewFundType] = useState('');
  const [transactionTypes, setTransactionTypes] = useState(defaultTransactionTypes);
  const [newTransactionType, setNewTransactionType] = useState('');
  const [newTransactionTypeFlow, setNewTransactionTypeFlow] = useState('expense');
  const [activeMainTab, setActiveMainTab] = useState('entries');
  const [managingFundType, setManagingFundType] = useState(false);
  const [managingTransactionType, setManagingTransactionType] = useState(false);
  const [people, setPeople] = useState([]);
  const [churchBranding, setChurchBranding] = useState(null);
  const [newPerson, setNewPerson] = useState({
    firstName: '',
    lastName: '',
    phone: '',
    pin: '',
  });
  const [showNewPersonInput, setShowNewPersonInput] = useState(false);
  const [attachmentFiles, setAttachmentFiles] = useState([]);
  const [summaryView, setSummaryView] = useState('overall');
  const entryFormRef = useRef(null);
  const isAddEntryRoute = location.pathname.endsWith('/finances/new');
  const isEditEntryRoute = location.pathname.includes('/finances/edit/');
  const isViewEntryRoute = location.pathname.includes('/finances/view/');
  const isEntryFormRoute = isAddEntryRoute || isEditEntryRoute;
  const isFinanceDetailRoute = isEntryFormRoute || isViewEntryRoute;
  const defaultExpenseTransactionType = transactionTypes.find((definition) => definition.flow === 'expense')?.value
    || transactionTypes[0]?.value
    || 'expense';

  const resetEntryFormState = () => {
    setEditingId(null);
    setShowNewPersonInput(false);
    setAttachmentFiles([]);
    setNewPerson({ firstName: '', lastName: '', phone: '', pin: '' });
    setNewEntry({
      title: '',
      description: '',
      amount: '',
      category: '',
      type: 'expense',
      reimbursed: false,
      reimbursementEntries: [],
      fundType: 'cash',
      personId: '',
      attachments: [],
      date: formatDateInputValue(),
    });
  };

  useEffect(() => {
    fetchFinances();
    fetchCategories();
    fetchPeople();
  }, [id]);

  useEffect(() => {
    const fetchChurchBranding = async () => {
      try {
        const churchData = await getChurchData(id);
        setChurchBranding(churchData || null);
      } catch (error) {
        console.error('Error loading church branding:', error);
      }
    };

    if (id) {
      fetchChurchBranding();
    }
  }, [id]);

  useEffect(() => {
    if (showModal && entryFormRef.current) {
      entryFormRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [showModal]);

  useEffect(() => {
    if (transactionTypes.some((definition) => definition.value === newEntry.type)) return;

    setNewEntry((prev) => ({
      ...prev,
      type: defaultExpenseTransactionType,
      reimbursed: getTransactionTypeFlow(defaultExpenseTransactionType) === 'expense' ? prev.reimbursed : false,
      reimbursementEntries: getTransactionTypeFlow(defaultExpenseTransactionType) === 'expense'
        ? prev.reimbursementEntries
        : [],
    }));
  }, [transactionTypes]);

  useEffect(() => {
    if (!isEntryFormRoute) {
      setShowModal(false);
    }

    if (isViewEntryRoute) {
      return;
    }

    if (isAddEntryRoute) {
      resetEntryFormState();
      setShowModal(true);
      return;
    }

    if (isEditEntryRoute && entryId && finances.length > 0) {
      const financeToEdit = finances.find((finance) => finance.id === entryId);
      if (!financeToEdit) {
        toast.error('Entry not found');
        navigate(`/organization/${id}/finances`);
        return;
      }
      handleEdit(financeToEdit);
    }
  }, [isEntryFormRoute, isAddEntryRoute, isEditEntryRoute, isViewEntryRoute, entryId, finances, id, navigate]);

  const closeEntryForm = () => {
    if (isEntryFormRoute) {
      navigate(`/organization/${id}/finances`);
      return;
    }
    setShowModal(false);
  };

  const getNormalizedFundType = (finance) => {
    return getRawFundTypeValue(finance);
  };

  const getNormalizedTransactionType = (finance) => {
    const fallbackValue = 'expense';
    const rawValue = finance?.type || fallbackValue;
    return String(rawValue).trim().toLowerCase() || fallbackValue;
  };

  const getTransactionTypeFlow = (financeOrType) => {
    const typeValue = typeof financeOrType === 'string'
      ? String(financeOrType || '').trim().toLowerCase() || 'expense'
      : getNormalizedTransactionType(financeOrType);

    return transactionTypes.find((definition) => definition.value === typeValue)?.flow
      || (typeValue === 'income' ? 'income' : 'expense');
  };

  const getTransactionTypeLabel = (value) => {
    const normalizedValue = String(value || '').trim().toLowerCase();
    return transactionTypes.find((definition) => definition.value === normalizedValue)?.value || normalizedValue;
  };

  const getPersonDisplayName = (person) => {
    if (!person) return 'Unknown person';
    const firstName = String(person.firstName || '').trim();
    const lastName = String(person.lastName || '').trim();
    return `${firstName} ${lastName}`.trim() || 'Unknown person';
  };

  const getFinancePersonName = (finance) => {
    if (finance?.personName) return finance.personName;
    const matchedPerson = people.find((person) => person.id === finance?.personId);
    return getPersonDisplayName(matchedPerson);
  };

  const getFinanceSettingsRef = () => doc(db, `churches/${id}/settings`, FINANCE_SETTINGS_DOC_ID);

  const persistFinanceSettings = async (nextCategories, nextFundTypes, nextTransactionTypes = transactionTypes) => {
    await setDoc(
      getFinanceSettingsRef(),
      {
        categories: normalizeOptionValues(nextCategories),
        fundTypes: normalizeOptionValues(nextFundTypes),
        transactionTypes: normalizeTransactionTypeDefinitions(nextTransactionTypes),
      },
      { merge: true }
    );
  };

  const personEntryCounts = finances.reduce((accumulator, finance) => {
    if (!finance?.personId) return accumulator;
    accumulator[finance.personId] = (accumulator[finance.personId] || 0) + 1;
    return accumulator;
  }, {});

  const fetchFinances = async () => {
    try {
      const q = query(collection(db, `churches/${id}/finances`), orderBy('date', 'desc'));
      const querySnapshot = await getDocs(q);
      const financesData = querySnapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          category: normalizeCategoryValue(data.category),
          type: getNormalizedTransactionType(data),
          reimbursementEntries: getStoredReimbursementEntries(data),
          reimbursementLog: Array.isArray(data.reimbursementLog) ? data.reimbursementLog : [],
          date: normalizeDateOnlyValue(data.date),
        };
      });
      setFinances(financesData);
      financesData.forEach(finance => fetchComments(finance.id));
    } catch (error) {
      console.error('Error fetching finances:', error);
      toast.error('Failed to load finances');
    } finally {
      setLoading(false);
    }
  };

  const fetchCategories = async () => {
    try {
      const [querySnapshot, settingsSnapshot] = await Promise.all([
        getDocs(collection(db, `churches/${id}/finances`)),
        getDoc(getFinanceSettingsRef()),
      ]);
      const settingsData = settingsSnapshot.exists() ? settingsSnapshot.data() || {} : {};
      const uniqueCategories = new Set(normalizeOptionValues(settingsData.categories || []));
      const uniqueFundTypes = new Set([
        ...defaultFundTypes,
        ...normalizeOptionValues(settingsData.fundTypes || []),
      ]);
      const mergedTransactionTypes = normalizeTransactionTypeDefinitions([
        ...defaultTransactionTypes,
        ...(settingsData.transactionTypes || []),
        ...querySnapshot.docs.map((item) => {
          const itemData = item.data();
          const typeValue = String(itemData.type || '').trim().toLowerCase();
          return {
            value: typeValue,
            flow: typeValue === 'income' ? 'income' : 'expense',
          };
        }),
      ]);
      querySnapshot.docs.forEach(doc => {
        const category = normalizeCategoryValue(doc.data().category);
        if (category) uniqueCategories.add(category);
        uniqueFundTypes.add(getNormalizedFundType(doc.data()));
      });
      setCategories(normalizeOptionValues(Array.from(uniqueCategories)));
      setFundTypes(normalizeOptionValues(Array.from(uniqueFundTypes)));
      setTransactionTypes(mergedTransactionTypes);
    } catch (error) {
      console.error('Error fetching categories:', error);
    }
  };

  const fetchComments = async (financeId) => {
    try {
      const commentsQuery = query(collection(db, `churches/${id}/finances/${financeId}/comments`), orderBy('createdAt', 'desc'));
      const commentsSnapshot = await getDocs(commentsQuery);
      const commentsData = commentsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setComments(prev => ({
        ...prev,
        [financeId]: commentsData
      }));
    } catch (error) {
      console.error('Error fetching comments:', error);
    }
  };

  const fetchPeople = async () => {
    try {
      const peopleSnapshot = await getDocs(collection(db, `churches/${id}/financePeople`));
      const peopleData = peopleSnapshot.docs
        .map((item) => ({
          id: item.id,
          ...item.data(),
        }))
        .sort((a, b) => getPersonDisplayName(a).localeCompare(getPersonDisplayName(b)));
      setPeople(peopleData);
    } catch (error) {
      console.error('Error loading people:', error);
      toast.error('Failed to load people');
    }
  };

  const uploadAttachmentFiles = async (financeId, files) => {
    if (!files?.length || !storage) return [];

    const uploadedAttachments = [];
    for (const file of files) {
      const safeFileName = `${Date.now()}_${file.name}`;
      const storagePath = `churches/${id}/finances/${financeId}/attachments/${safeFileName}`;
      const attachmentRef = ref(storage, storagePath);
      await uploadBytes(attachmentRef, file);
      const url = await getDownloadURL(attachmentRef);

      uploadedAttachments.push({
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: Number(file.size || 0),
        path: storagePath,
        url,
        uploadedAt: new Date().toISOString(),
      });
    }

    return uploadedAttachments;
  };

  const getCurrentFinanceActor = () => ({
    uid: auth.currentUser?.uid || 'unknown',
    displayName: auth.currentUser?.displayName || auth.currentUser?.email || 'Unknown user',
  });

  const buildReimbursementLogEntry = (action, financeData, options = {}) => {
    const reimbursementEntries = getStoredReimbursementEntries(financeData);
    const reimbursedAmount = calculateReimbursedAmount(financeData, () => 'expense');
    const pendingAmount = Math.max(Number(financeData?.amount || 0) - reimbursedAmount, 0);
    const statusLabel = getReimbursementStatus(financeData, () => 'expense');
    const authorizedBy = String(options.authorizedBy || '').trim();

    return {
      id: createReimbursementEntryId(),
      action,
      message: action === 'created'
        ? `Entry created with reimbursement status: ${statusLabel}`
        : action === 'reverted'
          ? `Reimbursement reverted${authorizedBy ? ` by authorization of ${authorizedBy}` : ''}`
          : `Reimbursement updated: ${statusLabel}`,
      status: getOverallReimbursementStatus(financeData, () => 'expense'),
      reimbursedAmount,
      pendingAmount,
      reimbursementEntries,
      authorizedBy,
      changedBy: getCurrentFinanceActor(),
      createdAt: new Date().toISOString(),
    };
  };

  const handleAddReimbursementEntry = () => {
    setNewEntry((prev) => ({
      ...prev,
      reimbursed: true,
      reimbursementEntries: [
        ...(Array.isArray(prev.reimbursementEntries) ? prev.reimbursementEntries : []),
        buildEmptyReimbursementEntry(prev.fundType),
      ],
    }));
  };

  const handleUpdateReimbursementEntry = (entryId, field, value) => {
    setNewEntry((prev) => ({
      ...prev,
      reimbursementEntries: (Array.isArray(prev.reimbursementEntries) ? prev.reimbursementEntries : []).map((entry) => (
        entry.id === entryId
          ? {
              ...entry,
              ...(field === 'reimbursementType' && value === 'total'
                ? { amount: String(prev.amount || '') }
                : {}),
              [field]: field === 'fundType' ? String(value || '').trim().toLowerCase() : value,
            }
          : entry
      )),
    }));
  };

  const handleRemoveReimbursementEntry = (entryId) => {
    setNewEntry((prev) => {
      const nextEntries = (Array.isArray(prev.reimbursementEntries) ? prev.reimbursementEntries : [])
        .filter((entry) => entry.id !== entryId);

      return {
        ...prev,
        reimbursed: nextEntries.length > 0,
        reimbursementEntries: nextEntries,
      };
    });
  };

  const handleDeleteReimbursementLog = async (financeId, logId) => {
    if (!financeId || !logId) return;
    if (!window.confirm('Delete this reimbursement log entry?')) return;

    try {
      const finance = finances.find((entry) => entry.id === financeId);
      if (!finance) {
        toast.error('Finance entry not found');
        return;
      }

      const nextLog = (Array.isArray(finance.reimbursementLog) ? finance.reimbursementLog : [])
        .filter((entry) => entry.id !== logId);

      await updateDoc(doc(db, `churches/${id}/finances`, financeId), {
        reimbursementLog: nextLog,
        updatedAt: new Date(),
      });

      await fetchFinances();
      toast.success('Reimbursement log deleted');
    } catch (error) {
      console.error('Error deleting reimbursement log:', error);
      toast.error('Failed to delete reimbursement log');
    }
  };

  const handleRevertReimbursement = async (financeId) => {
    if (!financeId) return;
    if (!window.confirm('Revert this reimbursement? This will clear the current reimbursement details so you can reimburse again.')) return;

    const authorizedByInput = window.prompt('Authorized by who?', auth.currentUser?.displayName || auth.currentUser?.email || '');
    if (authorizedByInput === null) return;

    const authorizedBy = String(authorizedByInput || '').trim();
    if (!authorizedBy) {
      toast.error('Authorized by is required to revert reimbursement');
      return;
    }

    try {
      const finance = finances.find((entry) => entry.id === financeId);
      if (!finance) {
        toast.error('Finance entry not found');
        return;
      }

      const nextLog = [
        ...(Array.isArray(finance.reimbursementLog) ? finance.reimbursementLog : []),
        buildReimbursementLogEntry('reverted', {
          ...finance,
          reimbursed: false,
          reimbursementEntries: [],
        }, { authorizedBy }),
      ];

      await updateDoc(doc(db, `churches/${id}/finances`, financeId), {
        reimbursed: false,
        reimbursementEntries: [],
        reimbursementLog: nextLog,
        updatedAt: new Date(),
      });

      await fetchFinances();
      toast.success('Reimbursement reverted');
    } catch (error) {
      console.error('Error reverting reimbursement:', error);
      toast.error('Failed to revert reimbursement');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const existingFinance = editingId
        ? finances.find((finance) => finance.id === editingId)
        : null;
      let selectedPerson = people.find((person) => person.id === newEntry.personId);

      if (newEntry.personId === 'new') {
        const firstName = String(newPerson.firstName || '').trim();
        const lastName = String(newPerson.lastName || '').trim();
        const phone = String(newPerson.phone || '').trim();
        const pin = String(newPerson.pin || '').trim();

        if (!firstName || !lastName || !phone || !pin) {
          toast.error('Please complete first name, last name, phone, and PIN for the new person');
          return;
        }

        if (pin.length < 4) {
          toast.error('PIN must be at least 4 digits');
          return;
        }

        const pinHash = await hashPin(pin);
        const personPayload = {
          firstName,
          lastName,
          phone,
          pinHash,
          createdAt: new Date(),
        };

        const newPersonDoc = await addDoc(collection(db, `churches/${id}/financePeople`), personPayload);
        selectedPerson = { id: newPersonDoc.id, ...personPayload };
        setPeople((prev) => [...prev, selectedPerson].sort((a, b) => getPersonDisplayName(a).localeCompare(getPersonDisplayName(b))));
      }

      if (!selectedPerson) {
        toast.error('Please select a person for this entry');
        return;
      }

      const normalizedFundType = getNormalizedFundType(newEntry);
      const normalizedTransactionType = getNormalizedTransactionType(newEntry);
      const normalizedCategory = normalizeCategoryValue(newEntry.category);
      const transactionFlow = getTransactionTypeFlow(normalizedTransactionType);
      const existingAttachments = Array.isArray(newEntry.attachments) ? newEntry.attachments : [];
      const normalizedReimbursementEntries = transactionFlow === 'expense' && newEntry.reimbursed
        ? normalizeReimbursementEntriesForSave(newEntry.reimbursementEntries, normalizedFundType)
        : [];
      const existingReimbursementEntries = getStoredReimbursementEntries(existingFinance);
      const reimbursementWasModifiedWithoutRevert = Boolean(
        editingId
        && existingReimbursementEntries.length > 0
        && normalizedReimbursementEntries.length > 0
        && !areReimbursementEntriesEqual(existingReimbursementEntries, normalizedReimbursementEntries)
      );

      if (reimbursementWasModifiedWithoutRevert) {
        toast.error('This entry is already reimbursed. Revert the reimbursement before adding or changing reimbursement details.');
        return;
      }

      if (transactionFlow === 'expense' && newEntry.reimbursed) {
        if (normalizedReimbursementEntries.length === 0) {
          toast.error('Add at least one reimbursement detail for this expense');
          return;
        }

        const hasIncompleteEntry = normalizedReimbursementEntries.some(
          (entry) => (
            entry.amount <= 0
            || !entry.date
            || !entry.approvedBy
            || !entry.receivedBy
            || !entry.fundType
            || (entry.fundType === 'check' && !entry.checkNumber)
          )
        );

        if (hasIncompleteEntry) {
          toast.error('Each reimbursement detail needs a date, approver, recipient, fund type, and check number when the fund type is check');
          return;
        }

        const totalReimbursed = normalizedReimbursementEntries.reduce(
          (sum, entry) => sum + Number(entry.amount || 0),
          0
        );

        if (totalReimbursed - Number(newEntry.amount || 0) > 0.009) {
          toast.error('Reimbursement details cannot exceed the expense amount');
          return;
        }
      }

      const financeData = {
        ...newEntry,
        date: normalizeDateOnlyValue(newEntry.date),
        amount: Number(newEntry.amount),
        category: normalizedCategory,
        type: normalizedTransactionType,
        reimbursed: transactionFlow === 'expense' ? normalizedReimbursementEntries.length > 0 : false,
        reimbursementEntries: normalizedReimbursementEntries,
        reimbursementLog: transactionFlow === 'expense'
          ? [
              ...(Array.isArray(existingFinance?.reimbursementLog) ? existingFinance.reimbursementLog : []),
              buildReimbursementLogEntry(editingId ? 'updated' : 'created', {
                ...newEntry,
                amount: Number(newEntry.amount),
                type: normalizedTransactionType,
                reimbursed: normalizedReimbursementEntries.length > 0,
                reimbursementEntries: normalizedReimbursementEntries,
                fundType: normalizedFundType,
              }),
            ]
          : [],
        fundType: normalizedFundType,
        personId: selectedPerson.id,
        personName: getPersonDisplayName(selectedPerson),
        personPhone: selectedPerson.phone || '',
        attachments: existingAttachments,
        createdAt: existingFinance?.createdAt || new Date(),
        updatedAt: new Date(),
      };

      if (editingId) {
        await updateDoc(doc(db, `churches/${id}/finances`, editingId), financeData);

        if (attachmentFiles.length > 0) {
          const uploadedAttachments = await uploadAttachmentFiles(editingId, attachmentFiles);
          await updateDoc(doc(db, `churches/${id}/finances`, editingId), {
            attachments: [...existingAttachments, ...uploadedAttachments],
          });
        }

        toast.success('Entry updated successfully');
      } else {
        const addedDocRef = await addDoc(collection(db, `churches/${id}/finances`), financeData);

        if (attachmentFiles.length > 0) {
          const uploadedAttachments = await uploadAttachmentFiles(addedDocRef.id, attachmentFiles);
          await updateDoc(doc(db, `churches/${id}/finances`, addedDocRef.id), {
            attachments: [...existingAttachments, ...uploadedAttachments],
          });
        }

        toast.success('Entry added successfully');
      }

      setNewEntry({
        title: '',
        description: '',
        amount: '',
        category: '',
        type: 'expense',
        reimbursed: false,
        reimbursementEntries: [],
        fundType: 'cash',
        personId: '',
        attachments: [],
        date: formatDateInputValue()
      });
      setNewPerson({ firstName: '', lastName: '', phone: '', pin: '' });
      setShowNewPersonInput(false);
      setAttachmentFiles([]);
      setEditingId(null);
      fetchFinances();
      if (isEntryFormRoute) {
        navigate(`/organization/${id}/finances`);
      } else {
        setShowModal(false);
      }
    } catch (error) {
      console.error('Error saving finance:', error);
      toast.error('Failed to save entry');
    }
  };

  const handleAddNewCategory = async () => {
    const cleanedCategory = newCategory.trim().toLowerCase();
    if (!cleanedCategory) return;
    if (categories.includes(cleanedCategory)) {
      toast.error('That category already exists');
      return;
    }

    try {
      setManagingCategory(true);
      const nextCategories = [...categories, cleanedCategory].sort();
      await persistFinanceSettings(nextCategories, fundTypes, transactionTypes);
      setCategories(nextCategories);
      setNewCategory('');
      toast.success('Category added successfully');
    } catch (error) {
      console.error('Error adding category:', error);
      toast.error('Failed to add category');
    } finally {
      setManagingCategory(false);
    }
  };

  const handleRenameCategory = async (currentCategory) => {
    if (!currentCategory) {
      toast.error('Select a category first');
      return;
    }

    const requestedCategory = window.prompt('Rename category', currentCategory);
    if (requestedCategory === null) return;

    const cleanedCategory = requestedCategory.trim().toLowerCase();
    if (!cleanedCategory) {
      toast.error('Category cannot be empty');
      return;
    }

    if (cleanedCategory === currentCategory) return;
    if (categories.includes(cleanedCategory)) {
      toast.error('That category already exists');
      return;
    }

    const matchingEntries = finances.filter(
      (finance) => String(finance?.category || '').trim().toLowerCase() === currentCategory
    );

    try {
      setManagingCategory(true);
      await Promise.all(
        matchingEntries.map((finance) =>
          updateDoc(doc(db, `churches/${id}/finances`, finance.id), {
            category: cleanedCategory,
          })
        )
      );
      const nextCategories = categories
        .map((category) => (category === currentCategory ? cleanedCategory : category))
        .filter((category, index, array) => array.indexOf(category) === index)
        .sort();
      await persistFinanceSettings(nextCategories, fundTypes, transactionTypes);
      setCategories(nextCategories);
      if (newEntry.category === currentCategory) {
        setNewEntry((prev) => ({ ...prev, category: cleanedCategory }));
      }
      await fetchFinances();
      await fetchCategories();
      toast.success('Category renamed successfully');
    } catch (error) {
      console.error('Error renaming category:', error);
      toast.error('Failed to rename category');
    } finally {
      setManagingCategory(false);
    }
  };

  const handleDeleteCategory = async (currentCategory) => {
    if (!currentCategory) {
      toast.error('Select a category first');
      return;
    }

    const replacementOptions = categories.filter((category) => category !== currentCategory);
    if (replacementOptions.length === 0) {
      toast.error('You need at least one remaining category');
      return;
    }

    const replacementPrompt = window.prompt(
      `Delete "${currentCategory}" and replace existing entries with which category? Available: ${replacementOptions.join(', ')}`,
      replacementOptions[0]
    );
    if (replacementPrompt === null) return;

    const replacementCategory = replacementPrompt.trim().toLowerCase();
    if (!replacementCategory || !replacementOptions.includes(replacementCategory)) {
      toast.error('Choose a valid replacement category');
      return;
    }

    const confirmed = window.confirm(
      `Delete "${currentCategory}" and move its existing entries to "${replacementCategory}"?`
    );
    if (!confirmed) return;

    const matchingEntries = finances.filter(
      (finance) => String(finance?.category || '').trim().toLowerCase() === currentCategory
    );

    try {
      setManagingCategory(true);
      await Promise.all(
        matchingEntries.map((finance) =>
          updateDoc(doc(db, `churches/${id}/finances`, finance.id), {
            category: replacementCategory,
          })
        )
      );
      const nextCategories = categories.filter((category) => category !== currentCategory);
      await persistFinanceSettings(nextCategories, fundTypes, transactionTypes);
      setCategories(nextCategories);
      if (newEntry.category === currentCategory) {
        setNewEntry((prev) => ({ ...prev, category: replacementCategory }));
      }
      await fetchFinances();
      await fetchCategories();
      toast.success('Category deleted successfully');
    } catch (error) {
      console.error('Error deleting category:', error);
      toast.error('Failed to delete category');
    } finally {
      setManagingCategory(false);
    }
  };

  const handleAddNewFundType = async () => {
    const cleanedFundType = newFundType.trim().toLowerCase();
    if (!cleanedFundType) return;
    if (fundTypes.includes(cleanedFundType)) {
      toast.error('That type of funds already exists');
      return;
    }

    try {
      setManagingFundType(true);
      const nextFundTypes = [...fundTypes, cleanedFundType].sort();
      await persistFinanceSettings(categories, nextFundTypes, transactionTypes);
      setFundTypes(nextFundTypes);
      setNewFundType('');
      toast.success('Type of funds added successfully');
    } catch (error) {
      console.error('Error adding fund type:', error);
      toast.error('Failed to add type of funds');
    } finally {
      setManagingFundType(false);
    }
  };

  const handleRenameFundType = async (selectedFundType = getNormalizedFundType(newEntry)) => {
    const currentFundType = String(selectedFundType || '').trim().toLowerCase();
    if (!currentFundType) {
      toast.error('Select a type of funds first');
      return;
    }

    const requestedFundType = window.prompt('Rename type of funds', currentFundType);
    if (requestedFundType === null) return;

    const cleanedFundType = requestedFundType.trim().toLowerCase();
    if (!cleanedFundType) {
      toast.error('Type of funds cannot be empty');
      return;
    }

    if (cleanedFundType === currentFundType) {
      return;
    }

    if (fundTypes.includes(cleanedFundType)) {
      toast.error('That type of funds already exists');
      return;
    }

    const matchingEntries = finances.filter(
      (finance) => getNormalizedFundType(finance) === currentFundType
    );

    try {
      setManagingFundType(true);

      await Promise.all(
        matchingEntries.map((finance) =>
          updateDoc(doc(db, `churches/${id}/finances`, finance.id), {
            fundType: cleanedFundType,
            typeOfFunds: cleanedFundType,
            reimbursementEntries: getStoredReimbursementEntries(finance).map((entry) => ({
              ...entry,
              fundType: entry.fundType === currentFundType ? cleanedFundType : entry.fundType,
            })),
          })
        )
      );

      const nextFundTypes = fundTypes
        .map((fundType) => (fundType === currentFundType ? cleanedFundType : fundType))
        .filter((fundType, index, array) => array.indexOf(fundType) === index)
        .sort();
      await persistFinanceSettings(categories, nextFundTypes, transactionTypes);
      setFundTypes(nextFundTypes);
      setNewEntry((prev) => ({ ...prev, fundType: cleanedFundType }));
      await fetchFinances();
      await fetchCategories();
      toast.success('Type of funds renamed successfully');
    } catch (error) {
      console.error('Error renaming fund type:', error);
      toast.error('Failed to rename type of funds');
    } finally {
      setManagingFundType(false);
    }
  };

  const handleDeleteFundType = async (selectedFundType = getNormalizedFundType(newEntry)) => {
    const currentFundType = String(selectedFundType || '').trim().toLowerCase();
    if (!currentFundType) {
      toast.error('Select a type of funds first');
      return;
    }

    const replacementOptions = fundTypes.filter((fundType) => fundType !== currentFundType);
    if (replacementOptions.length === 0) {
      toast.error('You need at least one remaining type of funds');
      return;
    }

    const replacementPrompt = window.prompt(
      `Delete "${currentFundType}" and replace existing entries with which type? Available: ${replacementOptions.join(', ')}`,
      replacementOptions[0]
    );
    if (replacementPrompt === null) return;

    const replacementFundType = replacementPrompt.trim().toLowerCase();
    if (!replacementFundType || !replacementOptions.includes(replacementFundType)) {
      toast.error('Choose a valid replacement type of funds');
      return;
    }

    const confirmed = window.confirm(
      `Delete "${currentFundType}" and move its existing entries to "${replacementFundType}"?`
    );
    if (!confirmed) return;

    const matchingEntries = finances.filter(
      (finance) => getNormalizedFundType(finance) === currentFundType
    );

    try {
      setManagingFundType(true);

      await Promise.all(
        matchingEntries.map((finance) =>
          updateDoc(doc(db, `churches/${id}/finances`, finance.id), {
            fundType: replacementFundType,
            typeOfFunds: replacementFundType,
            reimbursementEntries: getStoredReimbursementEntries(finance).map((entry) => ({
              ...entry,
              fundType: entry.fundType === currentFundType ? replacementFundType : entry.fundType,
            })),
          })
        )
      );

      const nextFundTypes = fundTypes.filter((fundType) => fundType !== currentFundType);
      await persistFinanceSettings(categories, nextFundTypes, transactionTypes);
      setFundTypes(nextFundTypes);
      setNewEntry((prev) => ({ ...prev, fundType: replacementFundType }));
      await fetchFinances();
      await fetchCategories();
      toast.success('Type of funds deleted successfully');
    } catch (error) {
      console.error('Error deleting fund type:', error);
      toast.error('Failed to delete type of funds');
    } finally {
      setManagingFundType(false);
    }
  };

  const handleAddNewTransactionType = async () => {
    const cleanedTransactionType = newTransactionType.trim().toLowerCase();
    if (!cleanedTransactionType) return;
    if (transactionTypes.some((definition) => definition.value === cleanedTransactionType)) {
      toast.error('That transaction type already exists');
      return;
    }

    try {
      setManagingTransactionType(true);
      const nextTransactionTypes = normalizeTransactionTypeDefinitions([
        ...transactionTypes,
        { value: cleanedTransactionType, flow: newTransactionTypeFlow },
      ]);
      await persistFinanceSettings(categories, fundTypes, nextTransactionTypes);
      setTransactionTypes(nextTransactionTypes);
      setNewTransactionType('');
      setNewTransactionTypeFlow('expense');
      toast.success('Transaction type added successfully');
    } catch (error) {
      console.error('Error adding transaction type:', error);
      toast.error('Failed to add transaction type');
    } finally {
      setManagingTransactionType(false);
    }
  };

  const handleEditTransactionType = async (currentTypeDefinition) => {
    if (!currentTypeDefinition?.value) {
      toast.error('Select a transaction type first');
      return;
    }

    const requestedType = window.prompt('Edit transaction type name', currentTypeDefinition.value);
    if (requestedType === null) return;

    const cleanedTransactionType = requestedType.trim().toLowerCase();
    if (!cleanedTransactionType) {
      toast.error('Transaction type cannot be empty');
      return;
    }

    const requestedFlow = window.prompt('Set transaction behavior: income or expense', currentTypeDefinition.flow);
    if (requestedFlow === null) return;

    const cleanedFlow = requestedFlow.trim().toLowerCase() === 'income' ? 'income' : 'expense';
    if (
      cleanedTransactionType !== currentTypeDefinition.value
      && transactionTypes.some((definition) => definition.value === cleanedTransactionType)
    ) {
      toast.error('That transaction type already exists');
      return;
    }

    const matchingEntries = finances.filter(
      (finance) => getNormalizedTransactionType(finance) === currentTypeDefinition.value
    );

    try {
      setManagingTransactionType(true);
      if (cleanedTransactionType !== currentTypeDefinition.value) {
        await Promise.all(
          matchingEntries.map((finance) =>
            updateDoc(doc(db, `churches/${id}/finances`, finance.id), {
              type: cleanedTransactionType,
            })
          )
        );
      }

      const nextTransactionTypes = normalizeTransactionTypeDefinitions(
        transactionTypes.map((definition) => (
          definition.value === currentTypeDefinition.value
            ? { value: cleanedTransactionType, flow: cleanedFlow }
            : definition
        ))
      );
      await persistFinanceSettings(categories, fundTypes, nextTransactionTypes);
      setTransactionTypes(nextTransactionTypes);
      setNewEntry((prev) => ({
        ...prev,
        type: prev.type === currentTypeDefinition.value ? cleanedTransactionType : prev.type,
        reimbursed: cleanedFlow === 'expense' ? prev.reimbursed : false,
        reimbursementEntries: cleanedFlow === 'expense' ? prev.reimbursementEntries : [],
      }));
      await fetchFinances();
      await fetchCategories();
      toast.success('Transaction type updated successfully');
    } catch (error) {
      console.error('Error updating transaction type:', error);
      toast.error('Failed to update transaction type');
    } finally {
      setManagingTransactionType(false);
    }
  };

  const handleDeleteTransactionType = async (currentTypeDefinition) => {
    if (!currentTypeDefinition?.value) {
      toast.error('Select a transaction type first');
      return;
    }

    const replacementOptions = transactionTypes.filter(
      (definition) => definition.value !== currentTypeDefinition.value && definition.flow === currentTypeDefinition.flow
    );
    if (replacementOptions.length === 0) {
      toast.error(`You need at least one remaining ${currentTypeDefinition.flow} type before deleting this one`);
      return;
    }

    const replacementPrompt = window.prompt(
      `Delete "${currentTypeDefinition.value}" and replace existing entries with which ${currentTypeDefinition.flow} type? Available: ${replacementOptions.map((definition) => definition.value).join(', ')}`,
      replacementOptions[0].value
    );
    if (replacementPrompt === null) return;

    const replacementType = replacementPrompt.trim().toLowerCase();
    if (!replacementOptions.some((definition) => definition.value === replacementType)) {
      toast.error('Choose a valid replacement transaction type');
      return;
    }

    const confirmed = window.confirm(
      `Delete "${currentTypeDefinition.value}" and move its existing entries to "${replacementType}"?`
    );
    if (!confirmed) return;

    const matchingEntries = finances.filter(
      (finance) => getNormalizedTransactionType(finance) === currentTypeDefinition.value
    );

    try {
      setManagingTransactionType(true);
      await Promise.all(
        matchingEntries.map((finance) =>
          updateDoc(doc(db, `churches/${id}/finances`, finance.id), {
            type: replacementType,
          })
        )
      );

      const nextTransactionTypes = transactionTypes.filter(
        (definition) => definition.value !== currentTypeDefinition.value
      );
      await persistFinanceSettings(categories, fundTypes, nextTransactionTypes);
      setTransactionTypes(nextTransactionTypes);
      setNewEntry((prev) => ({
        ...prev,
        type: prev.type === currentTypeDefinition.value ? replacementType : prev.type,
        reimbursed: getTransactionTypeFlow(replacementType) === 'expense' ? prev.reimbursed : false,
        reimbursementEntries: getTransactionTypeFlow(replacementType) === 'expense' ? prev.reimbursementEntries : [],
      }));
      await fetchFinances();
      await fetchCategories();
      toast.success('Transaction type deleted successfully');
    } catch (error) {
      console.error('Error deleting transaction type:', error);
      toast.error('Failed to delete transaction type');
    } finally {
      setManagingTransactionType(false);
    }
  };

  const handleDelete = async (financeId) => {
    if (!window.confirm('Are you sure you want to delete this entry?')) return;
    
    try {
      await deleteDoc(doc(db, `churches/${id}/finances`, financeId));
      toast.success('Entry deleted successfully');
      fetchFinances();
    } catch (error) {
      console.error('Error deleting finance:', error);
      toast.error('Failed to delete entry');
    }
  };

  const handleEdit = (finance) => {
    setNewEntry({
      title: finance.title,
      description: finance.description,
      amount: finance.amount.toString(),
      category: normalizeCategoryValue(finance.category),
      type: getNormalizedTransactionType(finance),
      reimbursed: getTransactionTypeFlow(finance) === 'expense' ? !!finance.reimbursed : false,
      reimbursementEntries: normalizeReimbursementEntriesForForm(finance.reimbursementEntries, getNormalizedFundType(finance)),
      fundType: getNormalizedFundType(finance),
      personId: finance.personId || '',
      attachments: Array.isArray(finance.attachments) ? finance.attachments : [],
      date: normalizeDateOnlyValue(finance.date)
    });
    setShowNewPersonInput(false);
    setNewPerson({ firstName: '', lastName: '', phone: '', pin: '' });
    setAttachmentFiles([]);
    setEditingId(finance.id);
    setShowModal(true);
  };

  const handleStartAddEntry = () => {
    navigate(`/organization/${id}/finances/new`);
  };

  const handleStartEditEntry = (financeId) => {
    navigate(`/organization/${id}/finances/edit/${financeId}`);
  };

  const handleStartViewEntry = (financeId) => {
    navigate(`/organization/${id}/finances/view/${financeId}`);
  };

  const exportReceiptToPDF = async (finance) => {
    if (!finance) return;

    try {
      const resolvedBranding = churchBranding || (id ? await getChurchData(id) : null);
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();
      let yPosition = 18;
      const churchName = getChurchBrandingDisplayName(resolvedBranding);
      const churchLogo = getChurchBrandingLogo(resolvedBranding);
      const reimbursements = getStoredReimbursementEntries(finance);

      if (churchLogo) {
        const base64Logo = await getBase64Image(churchLogo);
        if (base64Logo) {
          doc.addImage(base64Logo, 'PNG', 15, yPosition, 28, 28);
        }
      }

      doc.setFontSize(18);
      doc.setTextColor(31, 41, 55);
      doc.text(churchName, churchLogo ? 50 : 15, yPosition + 10);
      doc.setFontSize(11);
      doc.setTextColor(100, 116, 139);
      doc.text('Finance Reimbursement Receipt', churchLogo ? 50 : 15, yPosition + 18);
      doc.text(`Generated ${new Date().toLocaleString()}`, churchLogo ? 50 : 15, yPosition + 24);

      yPosition += 42;

      doc.setDrawColor(226, 232, 240);
      doc.line(15, yPosition, pageWidth - 15, yPosition);
      yPosition += 10;

      const detailRows = [
        ['Entry Title', finance.title || '-'],
        ['Person', getFinancePersonName(finance)],
        ['Date', formatDateOnlyForDisplay(finance.date) || '-'],
        ['Category', finance.category || '-'],
        ['Type', getTransactionTypeLabel(finance.type)],
        ['Funds', getNormalizedFundType(finance)],
        ['Entry Amount', formatCurrency(finance.amount)],
        ['Reimbursement Status', getReimbursementStatus(finance, getTransactionTypeFlow)],
        ['Reimbursed', formatCurrency(calculateReimbursedAmount(finance, getTransactionTypeFlow))],
        ['Pending', formatCurrency(calculatePendingReimbursementAmount(finance, getTransactionTypeFlow))],
      ];

      doc.setFontSize(11);
      detailRows.forEach(([label, value]) => {
        doc.setTextColor(71, 85, 105);
        doc.text(`${label}:`, 15, yPosition);
        doc.setTextColor(17, 24, 39);
        doc.text(String(value), 68, yPosition);
        yPosition += 8;
      });

      if (finance.description) {
        yPosition += 2;
        doc.setTextColor(71, 85, 105);
        doc.text('Description:', 15, yPosition);
        yPosition += 7;
        doc.setTextColor(17, 24, 39);
        const descriptionLines = doc.splitTextToSize(finance.description, pageWidth - 30);
        doc.text(descriptionLines, 15, yPosition);
        yPosition += (descriptionLines.length * 6) + 4;
      }

      yPosition += 4;
      doc.setTextColor(31, 41, 55);
      doc.setFontSize(13);
      doc.text('Reimbursement Details', 15, yPosition);
      yPosition += 10;

      if (reimbursements.length === 0) {
        doc.setFontSize(11);
        doc.setTextColor(100, 116, 139);
        doc.text('No reimbursement details recorded for this entry.', 15, yPosition);
        yPosition += 8;
      } else {
        reimbursements.forEach((entry, index) => {
          if (yPosition > 245) {
            doc.addPage();
            yPosition = 20;
          }

          doc.setFillColor(248, 250, 252);
          doc.roundedRect(15, yPosition - 5, pageWidth - 30, 34, 3, 3, 'F');
          doc.setFontSize(11);
          doc.setTextColor(17, 24, 39);
          doc.text(`Reimbursement ${index + 1} (${entry.reimbursementType === 'total' ? 'Total' : 'Partial'})`, 20, yPosition + 2);
          doc.text(`Amount: ${formatCurrency(entry.amount)}`, 20, yPosition + 10);
          doc.text(`Date: ${formatDateOnlyForDisplay(entry.date) || '-'}`, 85, yPosition + 10);
          doc.text(`Approved By: ${entry.approvedBy || '-'}`, 20, yPosition + 18);
          doc.text(`Received By: ${entry.receivedBy || '-'}`, 85, yPosition + 18);
          doc.text(`Fund Type: ${entry.fundType || '-'}`, 20, yPosition + 26);
          if (entry.fundType === 'check') {
            doc.text(`Check #: ${entry.checkNumber || '-'}`, 85, yPosition + 26);
          }
          yPosition += 38;
        });
      }

      if (yPosition > 230) {
        doc.addPage();
        yPosition = 20;
      }

      yPosition += 4;
      doc.setTextColor(31, 41, 55);
      doc.setFontSize(13);
      doc.text('Receipt Confirmation', 15, yPosition);
      yPosition += 12;
      doc.setFontSize(11);
      doc.setTextColor(71, 85, 105);
      doc.text('Authorized Signature: ________________________________', 15, yPosition);
      yPosition += 12;
      doc.text('Recipient Signature: _________________________________', 15, yPosition);

      doc.save(`finance-receipt-${finance.title || finance.id}.pdf`);
    } catch (error) {
      console.error('Error exporting receipt PDF:', error);
      toast.error('Failed to export receipt PDF');
    }
  };

  const handleRemoveExistingAttachment = (indexToRemove) => {
    setNewEntry((prev) => {
      const currentAttachments = Array.isArray(prev.attachments) ? prev.attachments : [];
      return {
        ...prev,
        attachments: currentAttachments.filter((_, index) => index !== indexToRemove),
      };
    });
  };

  const handleAddComment = async () => {
    if (!newComment.trim()) return;
    
    try {
      const commentRef = await addDoc(collection(db, `churches/${id}/finances/${selectedFinanceId}/comments`), {
        content: newComment,
        createdAt: new Date(),
      });
      
      setComments({
        ...comments,
        [selectedFinanceId]: [...(comments[selectedFinanceId] || []), {
          id: commentRef.id,
          content: newComment,
          createdAt: new Date()
        }]
      });
      
      setNewComment('');
      setShowCommentModal(false);
    } catch (error) {
      toast.error('Failed to add comment');
    }
  };

  const handleDeleteComment = async (financeId, commentId) => {
    if (!window.confirm('Are you sure you want to delete this comment?')) return;
    
    try {
      await deleteDoc(doc(db, `churches/${id}/finances/${financeId}/comments`, commentId));
      setComments(prev => ({
        ...prev,
        [financeId]: prev[financeId].filter(comment => comment.id !== commentId)
      }));
      toast.success('Comment deleted');
    } catch (error) {
      console.error('Error deleting comment:', error);
      toast.error('Failed to delete comment');
    }
  };

  const handleEditComment = async (financeId, commentId, newContent) => {
    try {
      await updateDoc(doc(db, `churches/${id}/finances/${financeId}/comments`, commentId), {
        content: newContent,
        updatedAt: new Date()
      });
      
      setComments(prev => ({
        ...prev,
        [financeId]: prev[financeId].map(comment => 
          comment.id === commentId 
            ? { ...comment, content: newContent, updatedAt: new Date() }
            : comment
        )
      }));
      
      setEditingCommentId(null);
      setEditingCommentText('');
      toast.success('Comment updated');
    } catch (error) {
      console.error('Error updating comment:', error);
      toast.error('Failed to update comment');
    }
  };

  const exportToPDF = async () => {
    try {
      const toastId = toast.loading('Preparing PDF...', { autoClose: false });
      const doc = new jsPDF();
      
      // Add title and header with branded color
      doc.setFillColor(79, 70, 229);
      doc.rect(0, 0, doc.internal.pageSize.width, 40, 'F');
      doc.setTextColor(255);
      doc.setFontSize(24);
      doc.text('Financial Management Report', 15, 25);
      
      // Header info
      doc.setFontSize(11);
      doc.setTextColor(200, 200, 200);
      doc.text(`Generated: ${new Date().toLocaleDateString()}`, 15, 35);
      doc.text(`Total Entries: ${filteredFinances.length}`, doc.internal.pageSize.width - 60, 35);
      
      let yOffset = 50;

      // Add filter information if filters are active
      if (filters.type !== 'all' || filters.category !== 'all' || filters.startDate || filters.endDate || searchTerm) {
        doc.setFillColor(243, 244, 246);
        doc.rect(15, yOffset, doc.internal.pageSize.width - 30, 25, 'F');
        doc.setTextColor(75, 85, 99);
        doc.setFontSize(10);
        doc.text('Applied Filters:', 20, yOffset + 7);
        
        let filterText = [];
        if (filters.type !== 'all') filterText.push(`Type: ${filters.type}`);
        if (filters.category !== 'all') filterText.push(`Category: ${filters.category}`);
        if (filters.startDate) filterText.push(`From: ${filters.startDate}`);
        if (filters.endDate) filterText.push(`To: ${filters.endDate}`);
        if (searchTerm) filterText.push(`Search: "${searchTerm}"`);
        
        doc.text(filterText.join(' | '), 20, yOffset + 17);
        yOffset += 35;
      }

      // Add summary section
      doc.setFontSize(14);
      doc.setTextColor(31, 41, 55);
      doc.text('Financial Summary', 15, yOffset);
      yOffset += 15;

      // Summary boxes
      const summaryBoxWidth = (doc.internal.pageSize.width - 55) / 4;
      const summaryBoxHeight = 40;
      
      // Income box
      doc.setFillColor(209, 250, 229);
      doc.rect(15, yOffset, summaryBoxWidth, summaryBoxHeight, 'F');
      doc.setTextColor(...[4, 120, 87]);
      doc.setFontSize(12);
      doc.text('Total Income', 20, yOffset + 15);
      doc.setFontSize(14);
      doc.text(`$${totals.income.toFixed(2)}`, 20, yOffset + 30);

      // Expenses box
      doc.setFillColor(254, 226, 226);
      doc.rect(25 + summaryBoxWidth, yOffset, summaryBoxWidth, summaryBoxHeight, 'F');
      doc.setTextColor(...[220, 38, 38]);
      doc.setFontSize(12);
      doc.text('Total Expenses', 30 + summaryBoxWidth, yOffset + 15);
      doc.setFontSize(14);
      doc.text(`$${totals.expense.toFixed(2)}`, 30 + summaryBoxWidth, yOffset + 30);

      // Net Balance box
      const fillColor = netBalance >= 0 ? [209, 250, 229] : [254, 226, 226];
      const textColor = netBalance >= 0 ? [4, 120, 87] : [220, 38, 38];
      doc.setFillColor(...fillColor);
      doc.rect(35 + (summaryBoxWidth * 2), yOffset, summaryBoxWidth, summaryBoxHeight, 'F');
      doc.setTextColor(...textColor);
      doc.setFontSize(11);
      doc.text('Net Balance', 40 + (summaryBoxWidth * 2), yOffset + 15);
      doc.setFontSize(13);
      doc.text(`$${netBalance.toFixed(2)}`, 40 + (summaryBoxWidth * 2), yOffset + 30);

      // Net Balance with Pending Reimbursements
      const pendingNetFillColor = netBalanceWithPendingReimbursements >= 0 ? [209, 250, 229] : [254, 226, 226];
      const pendingNetTextColor = netBalanceWithPendingReimbursements >= 0 ? [4, 120, 87] : [220, 38, 38];
      doc.setFillColor(...pendingNetFillColor);
      doc.rect(45 + (summaryBoxWidth * 3), yOffset, summaryBoxWidth, summaryBoxHeight, 'F');
      doc.setTextColor(...pendingNetTextColor);
      doc.setFontSize(9);
      doc.text('Net (with pending)', 50 + (summaryBoxWidth * 3), yOffset + 15);
      doc.setFontSize(13);
      doc.text(`$${netBalanceWithPendingReimbursements.toFixed(2)}`, 50 + (summaryBoxWidth * 3), yOffset + 30);

      yOffset += summaryBoxHeight + 20;

      // Category breakdown section
      doc.setFontSize(14);
      doc.setTextColor(31, 41, 55);
      doc.text('Category Breakdown', 15, yOffset);
      yOffset += 15;

      // Table header
      const columns = ['Category', 'Income', 'Expenses', 'Net'];
      const columnWidths = [80, 40, 40, 40];
      
      doc.setFillColor(243, 244, 246);
      doc.rect(15, yOffset, doc.internal.pageSize.width - 30, 10, 'F');
      doc.setFontSize(10);
      doc.setTextColor(75, 85, 99);
      
      let xOffset = 20;
      columns.forEach((col, index) => {
        doc.text(col, xOffset, yOffset + 7);
        xOffset += columnWidths[index];
      });
      yOffset += 15;

      // Category details
      Object.entries(categoryTotals).forEach(([category, amounts]) => {
        if (yOffset > doc.internal.pageSize.height - 30) {
          doc.addPage();
          yOffset = 20;
        }

        const net = amounts.income - amounts.expense;
        xOffset = 20;
        
        doc.setTextColor(31, 41, 55);
        doc.text(category, xOffset, yOffset);
        
        xOffset += columnWidths[0];
        doc.setTextColor(...[4, 120, 87]);
        doc.text(`$${amounts.income.toFixed(2)}`, xOffset, yOffset);
        
        xOffset += columnWidths[1];
        doc.setTextColor(...[220, 38, 38]);
        doc.text(`$${amounts.expense.toFixed(2)}`, xOffset, yOffset);
        
        xOffset += columnWidths[2];
        const netTextColor = net >= 0 ? [4, 120, 87] : [220, 38, 38];
        doc.setTextColor(...netTextColor);
        doc.text(`$${net.toFixed(2)}`, xOffset, yOffset);

        yOffset += 10;
      });

      yOffset += 20;

      // Detailed transactions section
      doc.addPage();
      yOffset = 20;
      
      doc.setFontSize(14);
      doc.setTextColor(31, 41, 55);
      doc.text('Detailed Transactions', 15, yOffset);
      yOffset += 15;

      // Process each transaction
      for (const finance of filteredFinances) {
        if (yOffset > doc.internal.pageSize.height - 60) {
          doc.addPage();
          yOffset = 20;
        }

        // Transaction box
        doc.setFillColor(249, 250, 251);
        doc.rect(15, yOffset, doc.internal.pageSize.width - 30, 40, 'F');
        
        // Title and amount
        doc.setFontSize(12);
        doc.setTextColor(31, 41, 55);
        doc.text(finance.title, 20, yOffset + 15);
        
        doc.setFontSize(12);
        const amountColor = getTransactionTypeFlow(finance) === 'income' ? [4, 120, 87] : [220, 38, 38];
        doc.setTextColor(...amountColor);
        const amountText = `${getTransactionTypeFlow(finance) === 'income' ? '+' : '-'} $${finance.amount}`;
        doc.text(amountText, doc.internal.pageSize.width - 35, yOffset + 15, { align: 'right' });

        // Details
        doc.setFontSize(10);
        doc.setTextColor(107, 114, 128);
        const details = [
          `Category: ${finance.category}`,
          `Date: ${formatDateOnlyForDisplay(finance.date)}`,
          `Type: ${getTransactionTypeLabel(finance.type)}`,
          `Reimbursed: ${getReimbursementStatus(finance, getTransactionTypeFlow)}`,
          `Funds: ${getNormalizedFundType(finance)}`,
          `Person: ${getFinancePersonName(finance)}`
        ].join(' | ');
        doc.text(details, 20, yOffset + 30);

        yOffset += 50;

        // Description if exists
        if (finance.description) {
          const descriptionLines = doc.splitTextToSize(finance.description, doc.internal.pageSize.width - 45);
          doc.setTextColor(75, 85, 99);
          doc.text(descriptionLines, 20, yOffset);
          yOffset += (descriptionLines.length * 7) + 10;
        }
      }

      // Add page numbers
      const pageCount = doc.internal.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(10);
        doc.setTextColor(156, 163, 175);
        doc.text(`Page ${i} of ${pageCount}`, doc.internal.pageSize.width / 2, doc.internal.pageSize.height - 10, { align: 'center' });
      }

      // Save the PDF
      let filename = 'financial-management-report';
      if (filters.type !== 'all' || filters.category !== 'all' || filters.startDate || filters.endDate) {
        filename += '-filtered';
      }
      filename += '.pdf';
      
      doc.save(filename);
      
      toast.update(toastId, {
        render: 'PDF generated successfully!',
        type: 'success',
        isLoading: false,
        autoClose: 3000,
      });
    } catch (error) {
      console.error('Error generating PDF:', error);
      toast.error('Failed to generate PDF. Please try again.');
    }
  };

  const filteredFinances = finances.filter(finance => {
    const matchesSearch = 
      finance.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      finance.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      finance.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
      getFinancePersonName(finance).toLowerCase().includes(searchTerm.toLowerCase());

    const matchesType = filters.type === 'all' || finance.type === filters.type;
    const matchesCategory = filters.category === 'all' || finance.category === filters.category;
    const matchesDate = (!filters.startDate || finance.date >= filters.startDate) &&
                       (!filters.endDate || finance.date <= filters.endDate);

    return matchesSearch && matchesType && matchesCategory && matchesDate;
  }).sort(compareFinancesNewestFirst);

  const paginatedFinances = filteredFinances.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const totalPages = Math.ceil(filteredFinances.length / itemsPerPage);
  const selectedFinanceForView = isViewEntryRoute
    ? finances.find((finance) => finance.id === entryId) || null
    : null;
  const editingFinance = editingId
    ? finances.find((finance) => finance.id === editingId) || null
    : null;
  const isExpenseEntry = getTransactionTypeFlow(newEntry.type) === 'expense';
  const isLockedReimbursedEntry = Boolean(
    isEditEntryRoute
    && editingFinance
    && getTransactionTypeFlow(editingFinance) === 'expense'
    && getStoredReimbursementEntries(editingFinance).length > 0
  );
  const draftRemainingReimbursementAmount = calculateDraftRemainingReimbursementAmount(
    newEntry.amount,
    newEntry.reimbursementEntries
  );

  const totals = calculateTotalsByType(filteredFinances, getTransactionTypeFlow);
  const categoryTotals = calculateTotalsByCategory(filteredFinances, getTransactionTypeFlow);
  const reimbursementTotals = filteredFinances.reduce(
    (acc, finance) => {
      if (getTransactionTypeFlow(finance) !== 'expense') return acc;

      acc.reimbursed += calculateReimbursedAmount(finance, getTransactionTypeFlow);
      acc.needsReimbursement += calculatePendingReimbursementAmount(finance, getTransactionTypeFlow);

      return acc;
    },
    { needsReimbursement: 0, reimbursed: 0 }
  );
  const netBalance = totals.income - reimbursementTotals.reimbursed;
  const netBalanceWithPendingReimbursements = netBalance - reimbursementTotals.needsReimbursement;
  const monthlySummaries = calculateMonthlySummaries(filteredFinances, getTransactionTypeFlow);
  const summaryCards = [
    {
      key: 'income',
      label: 'Total Income',
      value: formatCurrency(totals.income),
      color: '#059669',
      icon: FaArrowUp,
      description: 'The total income from all filtered entries marked as income.',
    },
    {
      key: 'expense',
      label: 'Total Expenses',
      value: formatCurrency(totals.expense),
      color: '#DC2626',
      icon: FaArrowDown,
      description: 'The total amount of all filtered expense entries before reimbursements are deducted.',
    },
    {
      key: 'net-balance',
      label: 'Net Balance',
      value: formatCurrency(netBalance),
      color: netBalance >= 0 ? '#059669' : '#DC2626',
      icon: FaBalanceScale,
      description: 'Income minus reimbursed expenses only. Pending reimbursements are not subtracted here.',
    },
    {
      key: 'net-pending',
      label: 'Net Balance (With Pending Reimbursements)',
      value: formatCurrency(netBalanceWithPendingReimbursements),
      color: netBalanceWithPendingReimbursements >= 0 ? '#059669' : '#DC2626',
      icon: FaBalanceScale,
      description: 'Income minus reimbursed expenses and minus any reimbursement amounts that are still pending.',
    },
    {
      key: 'needs-reimbursement',
      label: 'Needs Reimbursement',
      value: formatCurrency(reimbursementTotals.needsReimbursement),
      color: '#B45309',
      icon: FaClock,
      description: 'The remaining reimbursement balance still owed across the filtered expense entries.',
    },
    {
      key: 'is-reimbursed',
      label: 'Is Reimbursed',
      value: formatCurrency(reimbursementTotals.reimbursed),
      color: '#0F766E',
      icon: FaCheckCircle,
      description: 'The reimbursement amounts already recorded across the filtered expense entries.',
    },
  ];

  return (
    <div className="finances-container-wrapper">
      <ChurchHeader id={id} applyShadow={false} />
      <div style={{...commonStyles.fullWidthContainer, width: '100%', maxWidth: '100%'}} className="finances-container">
        <Link to={`/organization/${id}/mi-organizacion`} style={commonStyles.backButtonLink}>
          ← Back to Mi Organización
        </Link>
        <h2 style={commonStyles.title}>Financial Management</h2>

        {!isFinanceDetailRoute && (
        <div style={styles.mainTabRow}>
          <button
            type="button"
            onClick={() => setActiveMainTab('entries')}
            style={{
              ...styles.mainTabButton,
              ...(activeMainTab === 'entries' ? styles.mainTabButtonActive : {}),
            }}
          >
            Entries
          </button>
          <button
            type="button"
            onClick={() => setActiveMainTab('settings')}
            style={{
              ...styles.mainTabButton,
              ...(activeMainTab === 'settings' ? styles.mainTabButtonActive : {}),
            }}
          >
            Settings
          </button>
        </div>
        )}

        {!isFinanceDetailRoute && activeMainTab === 'entries' && (
        <div style={styles.summarySection} className="finances-summary-section">
          <div style={styles.summaryHeaderRow}>
            <div>
              <h3 style={styles.summaryTitle}>Financial Summary</h3>
              <p style={styles.summarySubtitle}>
                All values below update from the current search and filters.
              </p>
            </div>
            <div style={styles.summaryToggleGroup}>
              <button
                type="button"
                onClick={() => setSummaryView('overall')}
                style={{
                  ...styles.summaryToggleButton,
                  ...(summaryView === 'overall' ? styles.summaryToggleButtonActive : {}),
                }}
              >
                Overall Totals
              </button>
              <button
                type="button"
                onClick={() => setSummaryView('monthly')}
                style={{
                  ...styles.summaryToggleButton,
                  ...(summaryView === 'monthly' ? styles.summaryToggleButtonActive : {}),
                }}
              >
                Totals Per Month
              </button>
            </div>
          </div>

          {summaryView === 'overall' ? (
          <div style={styles.totalsByType} className="finances-totals-by-type">
            {summaryCards.map((card) => {
              const IconComponent = card.icon;

              return (
                <div key={card.key} style={styles.totalItem} className="finances-total-item">
                  <div style={{ ...styles.summaryIconWrap, color: card.color }}>
                    <IconComponent />
                  </div>
                  <div style={styles.summaryLabelRow}>
                    <span>{card.label}</span>
                    <span style={styles.summaryTooltipIcon} title={card.description} aria-label={card.description}>
                      <FaInfoCircle />
                    </span>
                  </div>
                  <span style={{ ...styles.totalAmount, color: card.color }}>
                    {card.value}
                  </span>
                </div>
              );
            })}
          </div>
          ) : (
          <div style={styles.monthlySummaryGrid}>
            {monthlySummaries.length === 0 ? (
              <div style={styles.monthlySummaryEmptyState}>
                No monthly totals available for the current filters.
              </div>
            ) : (
              monthlySummaries.map((monthSummary) => (
                <div key={monthSummary.monthKey} style={styles.monthlySummaryCard}>
                  <div style={styles.monthlySummaryHeadingRow}>
                    <h4 style={styles.monthlySummaryHeading}>{monthSummary.monthLabel}</h4>
                    <span style={styles.monthlySummaryMeta}>{monthSummary.entries} entries</span>
                  </div>
                  <div style={styles.monthlySummaryAmounts}>
                    <div style={styles.monthlySummaryAmountRow}>
                      <span>Income</span>
                      <strong style={{ color: '#059669' }}>${monthSummary.income.toFixed(2)}</strong>
                    </div>
                    <div style={styles.monthlySummaryAmountRow}>
                      <span>Expenses</span>
                      <strong style={{ color: '#DC2626' }}>${monthSummary.expense.toFixed(2)}</strong>
                    </div>
                    <div style={styles.monthlySummaryAmountRow}>
                      <span>Net Balance</span>
                      <strong style={{ color: monthSummary.netBalance >= 0 ? '#059669' : '#DC2626' }}>
                        ${monthSummary.netBalance.toFixed(2)}
                      </strong>
                    </div>
                    <div style={styles.monthlySummaryAmountRow}>
                      <span>Net With Pending</span>
                      <strong style={{ color: monthSummary.netBalanceWithPending >= 0 ? '#059669' : '#DC2626' }}>
                        ${monthSummary.netBalanceWithPending.toFixed(2)}
                      </strong>
                    </div>
                    <div style={styles.monthlySummaryAmountRow}>
                      <span>Needs Reimbursement</span>
                      <strong style={{ color: '#B45309' }}>${monthSummary.needsReimbursement.toFixed(2)}</strong>
                    </div>
                    <div style={styles.monthlySummaryAmountRow}>
                      <span>Is Reimbursed</span>
                      <strong style={{ color: '#0F766E' }}>${monthSummary.reimbursed.toFixed(2)}</strong>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
          )}
        </div>
        )}

        {!isFinanceDetailRoute && activeMainTab === 'entries' && (
        <div style={styles.toolbar} className="finances-toolbar">
          <div style={styles.searchContainer} className="finances-search-container">
            <FaSearch style={styles.searchIcon} />
            <input
              type="text"
              placeholder="Search finances..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={styles.searchInput}
            />
          </div>
        
        <div style={styles.filters} className="finances-filters">
          <select
            value={filters.type}
            onChange={(e) => setFilters({...filters, type: e.target.value})}
            style={styles.filterSelect}
            className="finances-filter-select"
          >
            <option value="all">All Types</option>
            {transactionTypes.map((transactionType) => (
              <option key={transactionType.value} value={transactionType.value}>
                {transactionType.value}
              </option>
            ))}
          </select>

          <select
            value={filters.category}
            onChange={(e) => setFilters({...filters, category: e.target.value})}
            style={styles.filterSelect}
            className="finances-filter-select"
          >
            <option value="all">All Categories</option>
            {categories.map(category => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>

          <input
            type="date"
            value={filters.startDate}
            onChange={(e) => setFilters({...filters, startDate: e.target.value})}
            style={styles.filterDate}
            className="finances-filter-date"
          />
          <input
            type="date"
            value={filters.endDate}
            onChange={(e) => setFilters({...filters, endDate: e.target.value})}
            style={styles.filterDate}
            className="finances-filter-date"
          />
        </div>

        <div style={{ display: "flex", gap: "1rem" }} className="finances-actions">
          <Link
            to={`/organization/${id}/finances/person-lookup`}
            style={styles.addButton}
            className="finances-add-button"
          >
            Person Giving Lookup
          </Link>
          <button 
            onClick={exportToPDF}
            style={{
              ...styles.addButton,
              backgroundColor: "#2563eb"
            }}
            className="finances-add-button"
          >
            <FaFilePdf /> Export to PDF
          </button>
          <button onClick={handleStartAddEntry} style={styles.addButton} className="finances-add-button">
            <FaPlus /> Add New Entry
          </button>
        </div>
        </div>
        )}

        {!isEntryFormRoute && activeMainTab === 'settings' && (
        <div style={styles.summarySection} className="finances-settings-section">
          <div style={styles.settingsGrid}>
            <div style={styles.settingsCard}>
              <h3 style={styles.summaryTitle}>Categories</h3>
              <p style={styles.summarySubtitle}>Manage finance categories here instead of inside the entry form.</p>
              <div style={styles.settingsAddRow}>
                <input
                  type="text"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  placeholder="Add new category"
                  style={styles.input}
                />
                <button
                  type="button"
                  onClick={handleAddNewCategory}
                  disabled={managingCategory}
                  style={styles.addCategoryButton}
                >
                  {managingCategory ? 'Working...' : 'Add Category'}
                </button>
              </div>
              <div style={styles.settingsList}>
                {categories.map((category) => (
                  <div key={category} style={styles.settingsListItem}>
                    <span style={styles.settingsItemLabel}>{category}</span>
                    <div style={styles.settingsItemActions}>
                      <button
                        type="button"
                        onClick={() => handleRenameCategory(category)}
                        disabled={managingCategory}
                        style={styles.addCategoryButton}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteCategory(category)}
                        disabled={managingCategory}
                        style={styles.commentDeleteButton}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={styles.settingsCard}>
              <h3 style={styles.summaryTitle}>Transaction Types</h3>
              <p style={styles.summarySubtitle}>Manage the entry labels that behave as income or expense.</p>
              <div style={styles.settingsAddRow}>
                <input
                  type="text"
                  value={newTransactionType}
                  onChange={(e) => setNewTransactionType(e.target.value)}
                  placeholder="Add new transaction type"
                  style={styles.input}
                />
                <select
                  value={newTransactionTypeFlow}
                  onChange={(e) => setNewTransactionTypeFlow(e.target.value)}
                  style={styles.input}
                >
                  <option value="expense">Behaves like expense</option>
                  <option value="income">Behaves like income</option>
                </select>
                <button
                  type="button"
                  onClick={handleAddNewTransactionType}
                  disabled={managingTransactionType}
                  style={styles.addCategoryButton}
                >
                  {managingTransactionType ? 'Working...' : 'Add Type'}
                </button>
              </div>
              <div style={styles.settingsList}>
                {transactionTypes.map((transactionType) => (
                  <div key={transactionType.value} style={styles.settingsListItem}>
                    <span style={styles.settingsItemLabel}>
                      {transactionType.value} ({transactionType.flow})
                    </span>
                    <div style={styles.settingsItemActions}>
                      <button
                        type="button"
                        onClick={() => handleEditTransactionType(transactionType)}
                        disabled={managingTransactionType}
                        style={styles.addCategoryButton}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteTransactionType(transactionType)}
                        disabled={managingTransactionType}
                        style={styles.commentDeleteButton}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={styles.settingsCard}>
              <h3 style={styles.summaryTitle}>Types of Funds</h3>
              <p style={styles.summarySubtitle}>Manage fund types here instead of inside the entry form.</p>
              <div style={styles.settingsAddRow}>
                <input
                  type="text"
                  value={newFundType}
                  onChange={(e) => setNewFundType(e.target.value)}
                  placeholder="Add new type of funds"
                  style={styles.input}
                />
                <button
                  type="button"
                  onClick={handleAddNewFundType}
                  disabled={managingFundType}
                  style={styles.addCategoryButton}
                >
                  {managingFundType ? 'Working...' : 'Add Type'}
                </button>
              </div>
              <div style={styles.settingsList}>
                {fundTypes.map((fundType) => (
                  <div key={fundType} style={styles.settingsListItem}>
                    <span style={styles.settingsItemLabel}>{fundType}</span>
                    <div style={styles.settingsItemActions}>
                      <button
                        type="button"
                        onClick={() => handleRenameFundType(fundType)}
                        disabled={managingFundType}
                        style={styles.addCategoryButton}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteFundType(fundType)}
                        disabled={managingFundType}
                        style={styles.commentDeleteButton}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        )}

        {isEntryFormRoute && (
        <div ref={entryFormRef} style={styles.summarySection} className="finances-entry-form-section">
          <div style={styles.entryFormHeader}>
            <h3 style={styles.modalTitle}>{editingId ? 'Edit Entry' : 'Add New Entry'}</h3>
            <button
              type="button"
              onClick={closeEntryForm}
              style={styles.closeInlineButton}
            >
              Close
            </button>
          </div>
          <form onSubmit={handleSubmit} style={styles.form} className="finances-modal-form">
            <div style={styles.formGroup}>
              <label style={styles.label}>Title *</label>
              <input
                type="text"
                value={newEntry.title}
                onChange={e => setNewEntry({...newEntry, title: e.target.value})}
                required
                style={styles.input}
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Description</label>
              <input
                type="text"
                value={newEntry.description}
                onChange={e => setNewEntry({...newEntry, description: e.target.value})}
                style={styles.input}
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Amount *</label>
              <input
                type="number"
                value={newEntry.amount}
                onChange={e => setNewEntry({...newEntry, amount: e.target.value})}
                required
                style={styles.input}
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Category *</label>
              <select
                value={newEntry.category}
                onChange={(e) => setNewEntry({...newEntry, category: e.target.value})}
                required
                style={styles.input}
              >
                <option value="">Select a category</option>
                {categories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Type *</label>
              <select
                value={newEntry.type}
                onChange={e => {
                  const nextType = e.target.value;
                  const nextTypeFlow = getTransactionTypeFlow(nextType);
                  setNewEntry({
                    ...newEntry,
                    type: nextType,
                    reimbursed: nextTypeFlow === 'expense' ? newEntry.reimbursed : false,
                    reimbursementEntries: nextTypeFlow === 'expense' ? newEntry.reimbursementEntries : [],
                  });
                }}
                style={styles.input}
              >
                {transactionTypes.map((transactionType) => (
                  <option key={transactionType.value} value={transactionType.value}>
                    {transactionType.value}
                  </option>
                ))}
              </select>
            </div>

            {isExpenseEntry ? (
              <>
                {isLockedReimbursedEntry ? (
                  <div style={styles.lockedReimbursementNotice}>
                    <strong>This entry is already reimbursed.</strong>
                    <span style={styles.checkboxHint}>
                      Reimbursements are locked to prevent duplicate reimbursement. Revert the reimbursement first if you need to reimburse again.
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRevertReimbursement(editingFinance.id)}
                      style={styles.deleteButton}
                    >
                      Revert Reimbursement
                    </button>
                  </div>
                ) : (
                  <>
                    <div style={styles.formGroup}>
                      <label style={styles.checkboxLabel}>
                        <input
                          type="checkbox"
                          checked={!!newEntry.reimbursed}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setNewEntry((prev) => ({
                              ...prev,
                              reimbursed: checked,
                              reimbursementEntries: checked
                                ? ((Array.isArray(prev.reimbursementEntries) && prev.reimbursementEntries.length > 0)
                                  ? prev.reimbursementEntries
                                  : [buildEmptyReimbursementEntry(prev.fundType)])
                                : [],
                            }));
                          }}
                          style={styles.checkboxInput}
                        />
                        <span>{newEntry.reimbursed ? 'Item is reimbursed' : 'Item needs reimbursement'}</span>
                      </label>
                      <span style={styles.checkboxHint}>
                        {newEntry.reimbursed
                          ? 'Add partial or total reimbursement records below. You can add more than one.'
                          : 'Leave this unchecked when the expense has not been reimbursed yet.'}
                      </span>
                    </div>

                    {newEntry.reimbursed && (
                  <div style={styles.formGroup}>
                    <div style={styles.reimbursementSectionHeader}>
                      <div>
                        <label style={styles.label}>Reimbursement Details</label>
                        <div style={styles.reimbursementBalanceHint}>
                          Remaining balance: {formatCurrency(draftRemainingReimbursementAmount)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleAddReimbursementEntry}
                        style={styles.addCategoryButton}
                      >
                        Add Reimbursement
                      </button>
                    </div>
                    <div style={styles.reimbursementEntryList}>
                      {(Array.isArray(newEntry.reimbursementEntries) ? newEntry.reimbursementEntries : []).map((reimbursementEntry, index) => (
                        <div key={reimbursementEntry.id} style={styles.reimbursementEntryCard}>
                          <div style={styles.reimbursementEntryHeader}>
                            <strong>Reimbursement {index + 1}</strong>
                            <button
                              type="button"
                              onClick={() => handleRemoveReimbursementEntry(reimbursementEntry.id)}
                              style={styles.commentDeleteButton}
                            >
                              Remove
                            </button>
                          </div>
                          <div style={styles.reimbursementFieldGrid}>
                            <div style={styles.formGroupCompact}>
                              <label style={styles.label}>Partial or Total *</label>
                              <select
                                value={reimbursementEntry.reimbursementType}
                                onChange={(e) => handleUpdateReimbursementEntry(reimbursementEntry.id, 'reimbursementType', e.target.value)}
                                style={styles.input}
                              >
                                <option value="partial">Partial</option>
                                <option value="total">Total</option>
                              </select>
                            </div>
                            <div style={styles.formGroupCompact}>
                              <label style={styles.label}>Date *</label>
                              <input
                                type="date"
                                value={reimbursementEntry.date || ''}
                                onChange={(e) => handleUpdateReimbursementEntry(reimbursementEntry.id, 'date', e.target.value)}
                                style={styles.input}
                              />
                            </div>
                            <div style={styles.formGroupCompact}>
                              <label style={styles.label}>Amount *</label>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={reimbursementEntry.amount}
                                onChange={(e) => handleUpdateReimbursementEntry(reimbursementEntry.id, 'amount', e.target.value)}
                                style={styles.input}
                              />
                              {reimbursementEntry.reimbursementType === 'partial' && (
                                <span style={styles.reimbursementBalanceHint}>
                                  Balance left after this partial: {formatCurrency(
                                    calculateDraftRemainingReimbursementAmount(
                                      newEntry.amount,
                                      newEntry.reimbursementEntries,
                                      reimbursementEntry.id
                                    ) - Number(reimbursementEntry.amount || 0)
                                  )}
                                </span>
                              )}
                            </div>
                            <div style={styles.formGroupCompact}>
                              <label style={styles.label}>Approved By *</label>
                              <input
                                type="text"
                                value={reimbursementEntry.approvedBy || ''}
                                onChange={(e) => handleUpdateReimbursementEntry(reimbursementEntry.id, 'approvedBy', e.target.value)}
                                style={styles.input}
                              />
                            </div>
                            <div style={styles.formGroupCompact}>
                              <label style={styles.label}>Received By *</label>
                              <input
                                type="text"
                                value={reimbursementEntry.receivedBy || ''}
                                onChange={(e) => handleUpdateReimbursementEntry(reimbursementEntry.id, 'receivedBy', e.target.value)}
                                style={styles.input}
                              />
                            </div>
                            <div style={styles.formGroupCompact}>
                              <label style={styles.label}>Fund Type *</label>
                              <select
                                value={reimbursementEntry.fundType || 'cash'}
                                onChange={(e) => handleUpdateReimbursementEntry(reimbursementEntry.id, 'fundType', e.target.value)}
                                style={styles.input}
                              >
                                {fundTypes.map((fundType) => (
                                  <option key={fundType} value={fundType}>
                                    {fundType}
                                  </option>
                                ))}
                              </select>
                            </div>
                            {reimbursementEntry.fundType === 'check' && (
                              <div style={styles.formGroupCompact}>
                                <label style={styles.label}>Check Number *</label>
                                <input
                                  type="text"
                                  value={reimbursementEntry.checkNumber || ''}
                                  onChange={(e) => handleUpdateReimbursementEntry(reimbursementEntry.id, 'checkNumber', e.target.value)}
                                  style={styles.input}
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                    )}
                  </>
                )}
              </>
            ) : (
              <div style={styles.formGroup}>
                <span style={styles.checkboxHint}>Reimbursement options are only available for expense entries.</span>
              </div>
            )}

            <div style={styles.formGroup}>
              <label style={styles.label}>Person *</label>
              {showNewPersonInput ? (
                <div style={styles.newCategoryContainer}>
                  <input
                    type="text"
                    value={newPerson.firstName}
                    onChange={(e) => setNewPerson((prev) => ({ ...prev, firstName: e.target.value }))}
                    placeholder="First name"
                    style={styles.input}
                  />
                  <input
                    type="text"
                    value={newPerson.lastName}
                    onChange={(e) => setNewPerson((prev) => ({ ...prev, lastName: e.target.value }))}
                    placeholder="Last name"
                    style={styles.input}
                  />
                  <input
                    type="tel"
                    value={newPerson.phone}
                    onChange={(e) => setNewPerson((prev) => ({ ...prev, phone: formatPhoneInput(e.target.value) }))}
                    placeholder="(787) 555-1234"
                    style={styles.input}
                    maxLength={15}
                  />
                  <input
                    type="password"
                    inputMode="numeric"
                    value={newPerson.pin}
                    onChange={(e) => setNewPerson((prev) => ({ ...prev, pin: e.target.value }))}
                    placeholder="Create PIN"
                    style={styles.input}
                  />
                  <div style={styles.newCategoryButtons}>
                    <button
                      type="button"
                      onClick={() => {
                        setShowNewPersonInput(false);
                        setNewEntry((prev) => ({ ...prev, personId: '' }));
                      }}
                      style={styles.cancelCategoryButton}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <select
                  value={newEntry.personId}
                  onChange={(e) => {
                    if (e.target.value === 'new') {
                      setShowNewPersonInput(true);
                      setNewEntry((prev) => ({ ...prev, personId: 'new' }));
                    } else {
                      setNewEntry({ ...newEntry, personId: e.target.value });
                    }
                  }}
                  required
                  style={styles.input}
                >
                  <option value="">Select person</option>
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {getPersonDisplayName(person)} ({personEntryCounts[person.id] || 0} entries)
                    </option>
                  ))}
                  <option value="new">+ Add New Person</option>
                </select>
              )}
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Type of Funds *</label>
              <select
                value={newEntry.fundType || 'cash'}
                onChange={(e) => setNewEntry({ ...newEntry, fundType: e.target.value })}
                required
                style={styles.input}
              >
                {fundTypes.map((fundType) => (
                  <option key={fundType} value={fundType}>
                    {fundType}
                  </option>
                ))}
              </select>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Date *</label>
              <input
                type="date"
                value={newEntry.date}
                onChange={e => setNewEntry({...newEntry, date: e.target.value})}
                required
                style={styles.input}
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Attachments (Any file type)</label>
              <input
                type="file"
                multiple
                onChange={(e) => setAttachmentFiles(Array.from(e.target.files || []))}
                style={styles.input}
              />
              {attachmentFiles.length > 0 && (
                <div style={styles.pendingAttachmentList}>
                  {attachmentFiles.map((file, index) => (
                    <span key={`${file.name}-${index}`} style={styles.pendingAttachmentItem}>
                      {file.name}
                    </span>
                  ))}
                </div>
              )}
              {Array.isArray(newEntry.attachments) && newEntry.attachments.length > 0 && (
                <div style={styles.existingAttachmentList}>
                  {newEntry.attachments.map((attachment, index) => (
                    <div key={`existing-attachment-${index}`} style={styles.existingAttachmentItem}>
                      <a href={attachment.url} target="_blank" rel="noreferrer" style={styles.attachmentLink}>
                        {attachment.name || `Attachment ${index + 1}`}
                      </a>
                      <button
                        type="button"
                        onClick={() => handleRemoveExistingAttachment(index)}
                        style={styles.commentDeleteButton}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={styles.formActionRow}>
              <button type="submit" style={styles.button}>
                {editingId ? 'Update Entry' : 'Add Entry'}
              </button>
              <button
                type="button"
                style={styles.cancelCategoryButton}
                onClick={closeEntryForm}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
        )}

        {isViewEntryRoute && (
        <div style={styles.summarySection} className="finances-entry-view-page">
          {!selectedFinanceForView ? (
            <div style={styles.entryViewEmptyState}>
              <h3 style={styles.modalTitle}>Entry not found</h3>
              <p style={styles.summarySubtitle}>This finance entry could not be found.</p>
              <button
                type="button"
                onClick={() => navigate(`/organization/${id}/finances`)}
                style={styles.button}
              >
                Back to Finances
              </button>
            </div>
          ) : (
            <div style={styles.entryViewModal}>
              <div style={styles.entryViewHeader}>
                <div>
                  <h3 style={styles.modalTitle}>{selectedFinanceForView.title}</h3>
                  <p style={styles.summarySubtitle}>
                    {getTransactionTypeLabel(selectedFinanceForView.type)} entry for {getFinancePersonName(selectedFinanceForView)}
                  </p>
                </div>
                <div style={styles.entryViewActionRow}>
                  <button
                    type="button"
                    onClick={() => exportReceiptToPDF(selectedFinanceForView)}
                    style={styles.button}
                  >
                    <FaFilePdf style={{ marginRight: '0.5rem' }} /> Export Receipt
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate(`/organization/${id}/finances`)}
                    style={styles.closeInlineButton}
                  >
                    Back to Finances
                  </button>
                </div>
              </div>

              <div style={styles.entryViewGrid}>
                <div style={styles.entryViewCard}>
                  <h4 style={styles.entryViewSectionTitle}>Entry Details</h4>
                  <div style={styles.entryViewMetaList}>
                    <div style={styles.entryViewMetaRow}><span>Date</span><strong>{formatDateOnlyForDisplay(selectedFinanceForView.date)}</strong></div>
                    <div style={styles.entryViewMetaRow}><span>Category</span><strong>{selectedFinanceForView.category || '-'}</strong></div>
                    <div style={styles.entryViewMetaRow}><span>Funds</span><strong>{getNormalizedFundType(selectedFinanceForView)}</strong></div>
                    <div style={styles.entryViewMetaRow}><span>Amount</span><strong>{formatCurrency(selectedFinanceForView.amount)}</strong></div>
                    <div style={styles.entryViewMetaRow}><span>Status</span><strong>{getReimbursementStatus(selectedFinanceForView, getTransactionTypeFlow)}</strong></div>
                    <div style={styles.entryViewMetaRow}><span>Reimbursed</span><strong>{formatCurrency(calculateReimbursedAmount(selectedFinanceForView, getTransactionTypeFlow))}</strong></div>
                    <div style={styles.entryViewMetaRow}><span>Pending</span><strong>{formatCurrency(calculatePendingReimbursementAmount(selectedFinanceForView, getTransactionTypeFlow))}</strong></div>
                  </div>
                  {selectedFinanceForView.description && (
                    <div style={styles.entryViewDescription}>
                      <strong>Description</strong>
                      <p>{selectedFinanceForView.description}</p>
                    </div>
                  )}
                </div>

                <div style={styles.entryViewCard}>
                  <h4 style={styles.entryViewSectionTitle}>Current Reimbursement Details</h4>
                  {getTransactionTypeFlow(selectedFinanceForView) === 'expense' && getStoredReimbursementEntries(selectedFinanceForView).length > 0 && (
                    <div style={styles.entryViewActionRow}>
                      <button
                        type="button"
                        onClick={() => handleRevertReimbursement(selectedFinanceForView.id)}
                        style={styles.deleteButton}
                      >
                        Revert Reimbursement
                      </button>
                    </div>
                  )}
                  {getTransactionTypeFlow(selectedFinanceForView) !== 'expense' ? (
                    <p style={styles.checkboxHint}>This entry is not an expense, so reimbursement details do not apply.</p>
                  ) : getStoredReimbursementEntries(selectedFinanceForView).length === 0 ? (
                    <p style={styles.checkboxHint}>No reimbursement details have been recorded yet.</p>
                  ) : (
                    <div style={styles.reimbursementLogList}>
                      {getStoredReimbursementEntries(selectedFinanceForView).map((entry) => (
                        <div key={entry.id} style={styles.reimbursementLogItem}>
                          <div style={styles.reimbursementLogItemHeader}>
                            <strong>{entry.reimbursementType === 'total' ? 'Total' : 'Partial'} reimbursement</strong>
                            <span>{formatCurrency(entry.amount)}</span>
                          </div>
                          <div style={styles.reimbursementLogDetails}>
                            <span>Date: {formatDateOnlyForDisplay(entry.date)}</span>
                            <span>Approved by: {entry.approvedBy || '-'}</span>
                            <span>Received by: {entry.receivedBy || '-'}</span>
                            <span>Fund type: {entry.fundType || '-'}</span>
                            {entry.fundType === 'check' && <span>Check #: {entry.checkNumber || '-'}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div style={styles.entryViewCard}>
                <h4 style={styles.entryViewSectionTitle}>Reimbursement Log</h4>
                {Array.isArray(selectedFinanceForView.reimbursementLog) && selectedFinanceForView.reimbursementLog.length > 0 ? (
                  <div style={styles.reimbursementLogList}>
                    {[...selectedFinanceForView.reimbursementLog]
                      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
                      .map((logEntry) => (
                        <div key={logEntry.id || `${logEntry.createdAt}-${logEntry.action}`} style={styles.reimbursementLogItem}>
                          <div style={styles.reimbursementLogItemHeader}>
                            <strong>{logEntry.message || 'Reimbursement updated'}</strong>
                            <div style={styles.entryViewActionRow}>
                              <span>{formatDate(logEntry.createdAt)}</span>
                              <button
                                type="button"
                                onClick={() => handleDeleteReimbursementLog(selectedFinanceForView.id, logEntry.id)}
                                style={styles.commentDeleteButton}
                              >
                                Delete Log
                              </button>
                            </div>
                          </div>
                          <div style={styles.reimbursementLogDetails}>
                            <span>Changed by: {logEntry.changedBy?.displayName || 'Unknown user'}</span>
                            {logEntry.authorizedBy && <span>Authorized by: {logEntry.authorizedBy}</span>}
                            <span>Reimbursed: {formatCurrency(logEntry.reimbursedAmount)}</span>
                            <span>Pending: {formatCurrency(logEntry.pendingAmount)}</span>
                          </div>
                          {Array.isArray(logEntry.reimbursementEntries) && logEntry.reimbursementEntries.length > 0 && (
                            <div style={styles.reimbursementLogNestedList}>
                              {logEntry.reimbursementEntries.map((entry) => (
                                <div key={entry.id} style={styles.reimbursementLogNestedItem}>
                                  <span>{entry.reimbursementType === 'total' ? 'Total' : 'Partial'} reimbursement</span>
                                  <span>{formatDateOnlyForDisplay(entry.date)}</span>
                                  <span>{formatCurrency(entry.amount)}</span>
                                  <span>{entry.approvedBy || '-'}</span>
                                  <span>{entry.receivedBy || '-'}</span>
                                  <span>{entry.fundType || '-'}</span>
                                  {entry.fundType === 'check' && <span>{entry.checkNumber || '-'}</span>}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                  </div>
                ) : (
                  <p style={styles.checkboxHint}>No reimbursement log entries yet.</p>
                )}
              </div>
            </div>
          )}
        </div>
        )}

        {!isFinanceDetailRoute && (
        <div style={styles.summarySection}>
        <h3 style={styles.summaryTitle}>Financial Entries ({filteredFinances.length})</h3>
        <div style={styles.logTableWrapper}>
          {loading ? (
            <p>Loading...</p>
          ) : paginatedFinances.length === 0 ? (
            <p>No financial entries yet</p>
          ) : (
            <table style={styles.logTable} className="finances-log-table">
              <thead>
                <tr>
                  <th style={styles.logTh}>Date</th>
                  <th style={styles.logTh}>Title</th>
                  <th style={styles.logTh}>Description</th>
                  <th style={styles.logTh}>Category</th>
                  <th style={styles.logTh}>Person</th>
                  <th style={styles.logTh}>Type</th>
                  <th style={styles.logTh}>Reimbursed</th>
                  <th style={styles.logTh}>Funds</th>
                  <th style={styles.logTh}>Amount</th>
                  <th style={styles.logTh}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedFinances.map((entry) => (
                  <tr key={`entry-${entry.id}`} className="finances-log-row">
                    <td style={styles.logTd}>{formatDateOnlyForDisplay(entry.date)}</td>
                    <td style={styles.logTd}>{entry.title}</td>
                    <td style={styles.logTd}>{entry.description || '-'}</td>
                    <td style={styles.logTd}>{entry.category || '-'}</td>
                    <td style={styles.logTd}>{getFinancePersonName(entry)}</td>
                    <td style={styles.logTd}>{getTransactionTypeLabel(entry.type)}</td>
                    <td style={styles.logTd}>{getReimbursementStatus(entry, getTransactionTypeFlow)}</td>
                    <td style={styles.logTd}>{getNormalizedFundType(entry)}</td>
                    <td
                      style={{
                        ...styles.logTd,
                        color: getTransactionTypeFlow(entry) === 'income' ? '#059669' : '#DC2626',
                        fontWeight: '600',
                      }}
                    >
                      {getTransactionTypeFlow(entry) === 'income' ? '+' : '-'} ${Number(entry.amount || 0).toFixed(2)}
                    </td>
                    <td style={styles.logTd}>
                      <div style={styles.logActionRow}>
                        <button
                          type="button"
                          onClick={() => handleStartViewEntry(entry.id)}
                          style={styles.viewButton}
                        >
                          View
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedFinanceId(entry.id);
                            setShowCommentModal(true);
                          }}
                          style={styles.commentButton}
                        >
                          <FaComment />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleStartEditEntry(entry.id)}
                          style={styles.editButton}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(entry.id)}
                          style={styles.deleteButton}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        </div>
        )}

        {!isFinanceDetailRoute && (
        <div style={styles.pagination} className="finances-pagination">
        {[...Array(totalPages)].map((_, index) => (
          <button
            key={index}
            onClick={() => setCurrentPage(index + 1)}
            style={{
              ...styles.pageButton,
              backgroundColor: currentPage === index + 1 ? '#4F46E5' : 'white',
              color: currentPage === index + 1 ? 'white' : '#4F46E5'
            }}
          >
            {index + 1}
          </button>
        ))}
        </div>
        )}

        

        {showCommentModal && (
        <Modal onClose={() => setShowCommentModal(false)} className="finances-comment-modal">
          <div style={styles.commentModal}>
            <h3>Add Comment</h3>
            <textarea
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder="Write your comment..."
              style={styles.commentInput}
            />
            <button onClick={handleAddComment} style={styles.addCommentButton}>
              Add Comment
            </button>
          </div>
        </Modal>
        )}
      </div>
    </div>
  );
};

const styles = {
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    marginBottom: '20px',
    maxWidth: '500px',
  },
  input: {
    padding: '8px',
    borderRadius: '4px',
    border: '1px solid #ddd',
  },
  button: {
    padding: '10px',
    backgroundColor: '#4F46E5',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  entry: {
    padding: '15px',
    backgroundColor: 'white',
    borderRadius: '8px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  },
  entryHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '10px',
  },
  actions: {
    display: 'flex',
    gap: '10px',
  },
  editButton: {
    padding: '5px 10px',
    backgroundColor: '#059669',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  viewButton: {
    padding: '5px 10px',
    backgroundColor: '#2563EB',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  deleteButton: {
    padding: '5px 10px',
    backgroundColor: '#DC2626',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  commentButton: {
    padding: '5px 10px',
    backgroundColor: '#4F46E5',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  description: {
    color: '#6B7280',
    marginBottom: '10px',
  },
  entryContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  mainInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '5px',
  },
  metadata: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  amount: {
    fontWeight: 'bold',
    fontSize: '1.1em',
  },
  category: {
    backgroundColor: '#F3F4F6',
    padding: '4px 8px',
    borderRadius: '4px',
    fontSize: '0.9em',
  },
  date: {
    color: '#6B7280',
    fontSize: '0.9em',
  },
  createdAt: {
    color: '#6B7280',
    fontSize: '0.9em',
  },
  fundType: {
    color: '#1F2937',
    fontSize: '0.9em',
    fontWeight: '500',
  },
  personTag: {
    color: '#1F2937',
    fontSize: '0.9em',
    fontWeight: '500',
  },
  reimbursedTag: {
    color: '#0F766E',
    fontSize: '0.9em',
    fontWeight: '600',
  },
  attachmentList: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.5rem',
    marginTop: '0.5rem',
  },
  attachmentLink: {
    color: '#1D4ED8',
    textDecoration: 'underline',
    fontSize: '0.9rem',
  },
  comments: {
    marginTop: '10px',
    padding: '10px',
    backgroundColor: '#F9FAFB',
    borderRadius: '4px',
  },
  comment: {
    marginBottom: '10px',
    padding: '10px',
    backgroundColor: 'white',
    borderRadius: '4px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  },
  toolbar: {
    display: 'flex',
    gap: '1rem',
    marginBottom: '2rem',
    flexWrap: 'wrap',
  },
  searchContainer: {
    position: 'relative',
    flex: 1,
  },
  searchIcon: {
    position: 'absolute',
    left: '10px',
    top: '50%',
    transform: 'translateY(-50%)',
    color: '#6B7280',
  },
  searchInput: {
    width: '100%',
    padding: '8px 8px 8px 35px',
    borderRadius: '4px',
    border: '1px solid #ddd',
  },
  filters: {
    display: 'flex',
    gap: '0.5rem',
    flexWrap: 'wrap',
  },
  filterSelect: {
    padding: '8px',
    borderRadius: '4px',
    border: '1px solid #ddd',
  },
  filterDate: {
    padding: '8px',
    borderRadius: '4px',
    border: '1px solid #ddd',
  },
  addButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '8px 16px',
    backgroundColor: '#4F46E5',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  pagination: {
    display: 'flex',
    justifyContent: 'center',
    gap: '0.5rem',
    marginTop: '2rem',
  },
  pageButton: {
    padding: '8px 12px',
    border: '1px solid #4F46E5',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  commentModal: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  commentInput: {
    padding: '8px',
    borderRadius: '4px',
    border: '1px solid #ddd',
    width: '100%',
    minHeight: '100px',
  },
  addCommentButton: {
    padding: '10px',
    backgroundColor: '#4F46E5',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  commentContent: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '1rem',
  },
  commentActions: {
    display: 'flex',
    gap: '0.5rem',
  },
  commentEditButton: {
    padding: '4px 8px',
    backgroundColor: '#059669',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '0.8rem',
  },
  commentDeleteButton: {
    padding: '4px 8px',
    backgroundColor: '#DC2626',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '0.8rem',
  },
  commentEditForm: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  commentEditInput: {
    padding: '8px',
    borderRadius: '4px',
    border: '1px solid #ddd',
    width: '100%',
  },
  commentEditButtons: {
    display: 'flex',
    gap: '0.5rem',
  },
  commentSaveButton: {
    padding: '4px 8px',
    backgroundColor: '#059669',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  commentCancelButton: {
    padding: '4px 8px',
    backgroundColor: '#6B7280',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  commentDate: {
    display: 'block',
    marginTop: '4px',
    color: '#6B7280',
    fontSize: '0.8rem',
  },
  modalTitle: {
    fontSize: '1.5rem',
    fontWeight: '600',
    marginBottom: '1.5rem',
    color: '#1F2937',
  },
  entryFormHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '1rem',
  },
  closeInlineButton: {
    padding: '6px 10px',
    backgroundColor: '#F3F4F6',
    color: '#374151',
    border: '1px solid #D1D5DB',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: '500',
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
    marginBottom: '1rem',
  },
  formActionRow: {
    display: 'flex',
    gap: '0.75rem',
    alignItems: 'center',
  },
  formGroupCompact: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  label: {
    fontSize: '0.875rem',
    fontWeight: '500',
    color: '#374151',
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    fontSize: '0.875rem',
    fontWeight: '500',
    color: '#374151',
    cursor: 'pointer',
  },
  checkboxInput: {
    width: '16px',
    height: '16px',
  },
  checkboxHint: {
    fontSize: '0.8rem',
    color: '#6B7280',
  },
  reimbursementSectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '1rem',
  },
  lockedReimbursementNotice: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
    padding: '1rem',
    borderRadius: '10px',
    border: '1px solid #FECACA',
    backgroundColor: '#FEF2F2',
    color: '#991B1B',
  },
  reimbursementEntryList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
  },
  reimbursementEntryCard: {
    padding: '1rem',
    border: '1px solid #E5E7EB',
    borderRadius: '10px',
    backgroundColor: '#F9FAFB',
  },
  reimbursementEntryHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '1rem',
    marginBottom: '1rem',
  },
  reimbursementBalanceHint: {
    fontSize: '0.8rem',
    color: '#6B7280',
    marginTop: '0.25rem',
  },
  reimbursementFieldGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: '0.75rem',
  },
  newCategoryContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  newCategoryButtons: {
    display: 'flex',
    gap: '0.5rem',
  },
  addCategoryButton: {
    padding: '4px 8px',
    backgroundColor: '#059669',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '0.875rem',
  },
  cancelCategoryButton: {
    padding: '4px 8px',
    backgroundColor: '#6B7280',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '0.875rem',
  },
  summarySection: {
    marginTop: '2rem',
    padding: '1.5rem',
    backgroundColor: 'white',
    borderRadius: '8px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  },
  summaryTitle: {
    fontSize: '1.25rem',
    fontWeight: '600',
    marginBottom: '0.35rem',
    color: '#1F2937',
  },
  summarySubtitle: {
    margin: 0,
    color: '#6B7280',
    fontSize: '0.95rem',
  },
  summaryHeaderRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '1rem',
    marginBottom: '1rem',
    flexWrap: 'wrap',
  },
  mainTabRow: {
    display: 'flex',
    gap: '0.75rem',
    flexWrap: 'wrap',
    marginBottom: '1rem',
  },
  mainTabButton: {
    padding: '0.7rem 1.1rem',
    borderRadius: '999px',
    border: '1px solid #C7D2FE',
    backgroundColor: '#EEF2FF',
    color: '#4338CA',
    cursor: 'pointer',
    fontWeight: '600',
  },
  mainTabButtonActive: {
    backgroundColor: '#4F46E5',
    color: '#FFFFFF',
    borderColor: '#4F46E5',
  },
  summaryToggleGroup: {
    display: 'flex',
    gap: '0.5rem',
    flexWrap: 'wrap',
  },
  summaryToggleButton: {
    padding: '0.65rem 1rem',
    borderRadius: '999px',
    border: '1px solid #C7D2FE',
    backgroundColor: '#EEF2FF',
    color: '#4338CA',
    cursor: 'pointer',
    fontWeight: '600',
  },
  summaryToggleButtonActive: {
    backgroundColor: '#4F46E5',
    color: '#FFFFFF',
    borderColor: '#4F46E5',
  },
  totalsByType: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: '1rem',
    marginBottom: '2rem',
  },
  totalItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
    padding: '1rem',
    borderRadius: '12px',
    backgroundColor: '#F8FAFC',
    border: '1px solid #E2E8F0',
  },
  totalAmount: {
    fontSize: '1.5rem',
    fontWeight: '600',
  },
  summaryIconWrap: {
    width: '44px',
    height: '44px',
    borderRadius: '999px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    border: '1px solid currentColor',
    fontSize: '1.1rem',
    marginBottom: '0.25rem',
  },
  summaryLabelRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.5rem',
    color: '#334155',
    fontWeight: '600',
  },
  summaryTooltipIcon: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#64748B',
    cursor: 'help',
    fontSize: '0.95rem',
  },
  managementHint: {
    marginTop: '0.5rem',
    color: '#6B7280',
    fontSize: '0.85rem',
  },
  fundTypeManagementRow: {
    display: 'flex',
    gap: '0.5rem',
    flexWrap: 'wrap',
    marginTop: '0.75rem',
    padding: '0.75rem',
    backgroundColor: '#F8FAFC',
    border: '1px solid #E5E7EB',
    borderRadius: '8px',
  },
  monthlySummaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
    gap: '1rem',
  },
  monthlySummaryCard: {
    padding: '1rem',
    backgroundColor: '#F9FAFB',
    borderRadius: '10px',
    border: '1px solid #E5E7EB',
  },
  monthlySummaryHeadingRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '0.75rem',
    marginBottom: '0.9rem',
    flexWrap: 'wrap',
  },
  monthlySummaryHeading: {
    margin: 0,
    fontSize: '1rem',
    fontWeight: '700',
    color: '#1F2937',
  },
  monthlySummaryMeta: {
    fontSize: '0.8rem',
    fontWeight: '600',
    color: '#6B7280',
  },
  monthlySummaryAmounts: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.55rem',
  },
  monthlySummaryAmountRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '1rem',
    alignItems: 'center',
    color: '#374151',
    fontSize: '0.95rem',
  },
  monthlySummaryEmptyState: {
    padding: '1rem',
    borderRadius: '8px',
    backgroundColor: '#F9FAFB',
    border: '1px dashed #CBD5E1',
    color: '#6B7280',
  },
  settingsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
    gap: '1rem',
  },
  settingsCard: {
    padding: '1rem',
    backgroundColor: '#F9FAFB',
    borderRadius: '10px',
    border: '1px solid #E5E7EB',
  },
  settingsAddRow: {
    display: 'flex',
    gap: '0.75rem',
    alignItems: 'center',
    marginTop: '1rem',
    marginBottom: '1rem',
    flexWrap: 'wrap',
  },
  settingsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
  },
  settingsListItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.75rem',
    flexWrap: 'wrap',
    padding: '0.75rem',
    backgroundColor: '#FFFFFF',
    border: '1px solid #E5E7EB',
    borderRadius: '8px',
  },
  settingsItemLabel: {
    color: '#1F2937',
    fontWeight: '600',
  },
  settingsItemActions: {
    display: 'flex',
    gap: '0.5rem',
    flexWrap: 'wrap',
  },
  subtotalsTitle: {
    fontSize: '1.1rem',
    fontWeight: '600',
    marginBottom: '1rem',
    color: '#374151',
  },
  categoryTotals: {
    display: 'grid',
    gap: '1rem',
    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
  },
  categoryTotal: {
    padding: '1rem',
    backgroundColor: '#F9FAFB',
    borderRadius: '6px',
    border: '1px solid #E5E7EB',
  },
  categoryName: {
    fontSize: '1rem',
    fontWeight: '500',
    marginBottom: '0.5rem',
    color: '#374151',
  },
  categoryAmounts: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
    fontSize: '0.9rem',
  },
  logHeaderRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '1rem',
    flexWrap: 'wrap',
  },
  toggleLogButton: {
    padding: '8px 12px',
    border: '1px solid #4F46E5',
    borderRadius: '6px',
    backgroundColor: 'white',
    color: '#4F46E5',
    cursor: 'pointer',
    fontWeight: '500',
  },
  logTableWrapper: {
    marginTop: '0.75rem',
    overflowX: 'auto',
    border: '1px solid #E5E7EB',
    borderRadius: '8px',
  },
  logTable: {
    width: '100%',
    borderCollapse: 'collapse',
    minWidth: '680px',
    backgroundColor: 'white',
  },
  logTh: {
    textAlign: 'left',
    padding: '10px',
    borderBottom: '1px solid #E5E7EB',
    backgroundColor: '#F9FAFB',
    color: '#374151',
    fontSize: '0.85rem',
    fontWeight: '600',
  },
  logTd: {
    padding: '10px',
    borderBottom: '1px solid #F3F4F6',
    color: '#1F2937',
    fontSize: '0.9rem',
  },
  logActionRow: {
    display: 'flex',
    gap: '0.5rem',
    alignItems: 'center',
  },
  pendingAttachmentList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
    marginTop: '0.5rem',
  },
  pendingAttachmentItem: {
    fontSize: '0.85rem',
    color: '#374151',
  },
  existingAttachmentList: {
    marginTop: '0.75rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  existingAttachmentItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '0.75rem',
  },
  entryViewModal: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
    minWidth: 'min(900px, 100%)',
  },
  entryViewHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '1rem',
  },
  entryViewActionRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    flexWrap: 'wrap',
  },
  entryViewGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
    gap: '1rem',
  },
  entryViewCard: {
    padding: '1rem',
    borderRadius: '10px',
    backgroundColor: '#F8FAFC',
    border: '1px solid #E2E8F0',
  },
  entryViewSectionTitle: {
    margin: '0 0 0.75rem',
    fontSize: '1rem',
    fontWeight: '600',
    color: '#1F2937',
  },
  entryViewMetaList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
  },
  entryViewMetaRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '1rem',
    color: '#475569',
  },
  entryViewDescription: {
    marginTop: '1rem',
    color: '#475569',
  },
  entryViewEmptyState: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
    alignItems: 'flex-start',
  },
  reimbursementLogList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
  },
  reimbursementLogItem: {
    padding: '0.85rem',
    borderRadius: '8px',
    backgroundColor: 'white',
    border: '1px solid #E5E7EB',
  },
  reimbursementLogItemHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '1rem',
    marginBottom: '0.5rem',
    color: '#111827',
  },
  reimbursementLogDetails: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.75rem',
    color: '#475569',
    fontSize: '0.9rem',
  },
  reimbursementLogNestedList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
    marginTop: '0.75rem',
  },
  reimbursementLogNestedItem: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
    gap: '0.5rem',
    padding: '0.75rem',
    borderRadius: '6px',
    backgroundColor: '#F8FAFC',
    color: '#475569',
    fontSize: '0.9rem',
  },
};

// Responsive styles
const responsiveStyles = `
  .finances-log-table {
    width: 100%;
  }

  .finances-log-row:nth-child(odd) {
    background-color: #FFFFFF;
  }

  .finances-log-row:nth-child(even) {
    background-color: #F8FAFC;
  }

  .finances-log-row:hover {
    background-color: #EEF2FF;
  }

  .finances-log-row td {
    border-bottom: 1px solid #E5E7EB;
  }

  @media (max-width: 1024px) {
    .finances-container {
      padding: 15px;
    }
    
    .finances-toolbar {
      flex-direction: column;
      gap: 1rem;
    }
    
    .finances-filters {
      flex-wrap: wrap;
      justify-content: center;
    }
    
    .finances-summary-grid {
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 1rem;
    }
  }

  @media (max-width: 768px) {
    .finances-container {
      padding: 10px;
    }
    
    .finances-toolbar {
      gap: 0.75rem;
    }
    
    .finances-search-container {
      order: 1;
      width: 100%;
    }
    
    .finances-filters {
      order: 2;
      width: 100%;
      justify-content: space-between;
    }
    
    .finances-actions {
      order: 3;
      width: 100%;
      justify-content: center;
      flex-wrap: wrap;
    }
    
    .finances-entry {
      padding: 1rem;
    }
    
    .finances-entry-header {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.75rem;
    }
    
    .finances-entry-actions {
      align-self: flex-end;
    }
    
    .finances-entry-content {
      flex-direction: column;
      gap: 0.75rem;
    }
    
    .finances-metadata {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.5rem;
    }
    
    .finances-summary-section {
      padding: 1rem;
    }
    
    .finances-totals-by-type {
      flex-direction: column;
      gap: 1rem;
    }
    
    .finances-total-item {
      justify-content: space-between;
      padding: 0.75rem;
    }
    
    .finances-category-totals {
      display: grid;
      grid-template-columns: 1fr;
      gap: 1rem;
    }
    
    .finances-pagination {
      flex-wrap: wrap;
      gap: 0.5rem;
    }
  }

  @media (max-width: 640px) {
    .finances-container {
      padding: 8px;
    }
    
    .finances-title {
      font-size: 1.5rem;
    }
    
    .finances-toolbar {
      gap: 0.5rem;
    }
    
    .finances-filters {
      flex-direction: column;
      align-items: stretch;
    }
    
    .finances-filter-select,
    .finances-filter-date {
      width: 100%;
    }
    
    .finances-actions {
      flex-direction: column;
      align-items: stretch;
    }
    
    .finances-add-button {
      justify-content: center;
    }
    
    .finances-entry {
      margin-bottom: 1rem;
    }
    
    .finances-summary-grid {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 480px) {
    .finances-container {
      padding: 5px;
    }
    
    .finances-title {
      font-size: 1.25rem;
    }
    
    .finances-entry-header h3 {
      font-size: 1.125rem;
    }
    
    .finances-amount {
      font-size: 1rem;
    }
    
    .finances-comment-modal {
      margin: 1rem;
      width: calc(100vw - 2rem);
    }
    
    .finances-modal-form {
      max-width: 100%;
    }
  }
`;

// Inject responsive styles
if (typeof document !== 'undefined') {
  const styleSheet = document.createElement('style');
  styleSheet.textContent = responsiveStyles;
  document.head.appendChild(styleSheet);
}

export default FinancesPage;
