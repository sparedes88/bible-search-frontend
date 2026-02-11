import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { addDoc, collection, deleteDoc, deleteField, doc, documentId, getDoc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, startAfter, updateDoc, writeBatch } from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';
import { db, storage } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import './DonorUploader.css';

const ExcelRowDetail = () => {
  const { id, rowId } = useParams();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [rowData, setRowData] = useState(null);
  const [metaHeaders, setMetaHeaders] = useState([]);
  const [columnTypes, setColumnTypes] = useState({});
  const [formData, setFormData] = useState({});
  const [comments, setComments] = useState([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [newCommentText, setNewCommentText] = useState('');
  const [newCommentFiles, setNewCommentFiles] = useState([]);
  const [newCommentFilePreviews, setNewCommentFilePreviews] = useState([]);
  const [addingComment, setAddingComment] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({});
  const [activeTab, setActiveTab] = useState('data'); // 'data', 'settings', 'comments'
  const [editingCommentId, setEditingCommentId] = useState(null);
  const [editingCommentText, setEditingCommentText] = useState('');
  const [deletingCommentId, setDeletingCommentId] = useState(null);
  const [deletingAttachmentKey, setDeletingAttachmentKey] = useState(null);
  const [rowOptions, setRowOptions] = useState([]);
  const [loadingRowOptions, setLoadingRowOptions] = useState(false);
  const [labelColumn, setLabelColumn] = useState('');
  const [defaultLabelColumn, setDefaultLabelColumn] = useState('');
  const [savingDefaultLabelColumn, setSavingDefaultLabelColumn] = useState(false);
  const [newColumnName, setNewColumnName] = useState('');
  const [addingColumn, setAddingColumn] = useState(false);
  const [selectedColumn, setSelectedColumn] = useState('');
  const [renameColumnName, setRenameColumnName] = useState('');
  const [renamingColumn, setRenamingColumn] = useState(false);
  const [deletingColumn, setDeletingColumn] = useState(false);
  const [columnBatchStatus, setColumnBatchStatus] = useState(null);
  const [allRows, setAllRows] = useState([]);
  const [dropdownSearches, setDropdownSearches] = useState({});
  const [openDropdowns, setOpenDropdowns] = useState({});
  const [labelColumnSearch, setLabelColumnSearch] = useState('');
  const [openLabelDropdown, setOpenLabelDropdown] = useState(false);
  const [switchRowSearch, setSwitchRowSearch] = useState('');
  const [openSwitchRowDropdown, setOpenSwitchRowDropdown] = useState(false);
  const [bannerUrl, setBannerUrl] = useState('');
  const [columnOrder, setColumnOrder] = useState([]);
  const [expandOrganizeColumns, setExpandOrganizeColumns] = useState(false);
  const [expandCreateRow, setExpandCreateRow] = useState(false);
  const [expandDeleteRow, setExpandDeleteRow] = useState(false);
  const [expandAddColumn, setExpandAddColumn] = useState(false);
  const [expandManageColumns, setExpandManageColumns] = useState(false);
  const [expandConfigureTypes, setExpandConfigureTypes] = useState(false);
  const [expandDefaultLabel, setExpandDefaultLabel] = useState(false);
  const [newRowLabel, setNewRowLabel] = useState('');
  const [creatingNewRow, setCreatingNewRow] = useState(false);
  const [selectedRowDelete, setSelectedRowDelete] = useState('');
  const [deletingRow, setDeletingRow] = useState(false);
  const fileInputRef = useRef(null);
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const collectionName = 'brands';

  const getColumnTypeConfig = (header) => {
    const v = columnTypes && header ? columnTypes[header] : null;
    if (!v) return { type: 'auto', dropdown: false, showDuplicates: false };
    if (typeof v === 'string') {
      return { type: v === 'dropdown' ? 'text' : v, dropdown: v === 'dropdown', showDuplicates: false };
    }
    return { 
      type: v.type === 'dropdown' ? 'text' : (v.type || 'auto'), 
      dropdown: !!v.dropdown || v.type === 'dropdown',
      showDuplicates: !!v.showDuplicates
    };
  };

  const getPrimaryType = (header) => {
    const v = columnTypes && header ? columnTypes[header] : null;
    if (!v) return 'text';
    if (typeof v === 'string') return v;
    return v.type || 'text';
  };

  const formatValue = (val) => {
    if (val === null || val === undefined) return '';
    if (typeof val === 'object') {
      if (val.toDate && typeof val.toDate === 'function') {
        try { return val.toDate().toLocaleString(); } catch (e) { return ''; }
      }
      try { return JSON.stringify(val); } catch (e) { return String(val); }
    }
    return String(val);
  };

  const formatCommentDate = (val) => {
    if (!val) return '';
    if (val.toDate && typeof val.toDate === 'function') {
      try { return val.toDate().toLocaleString(); } catch (e) { return ''; }
    }
    if (val.seconds !== undefined) {
      try { return new Date(val.seconds * 1000).toLocaleString(); } catch (e) { return ''; }
    }
    try { return new Date(val).toLocaleString(); } catch (e) { return String(val); }
  };

  const formatFileSize = (size) => {
    if (!size && size !== 0) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let idx = 0;
    let value = size;
    while (value >= 1024 && idx < units.length - 1) {
      value /= 1024;
      idx += 1;
    }
    return `${value.toFixed(value >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
  };

  const isImageAttachment = (attachment) => {
    if (!attachment) return false;
    if (attachment.contentType && attachment.contentType.startsWith('image/')) return true;
    const name = (attachment.name || '').toLowerCase();
    return name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.gif') || name.endsWith('.webp');
  };

  const sanitizeFileName = (name) => {
    return String(name || 'file')
      .replace(/[\\/]/g, '_')
      .replace(/\s+/g, '_')
      .replace(/[^\w._-]/g, '_');
  };

  const toISODate = (val) => {
    if (!val) return '';
    let d = null;
    if (val instanceof Date) d = val;
    else if (typeof val === 'object' && val.toDate) {
      try { d = val.toDate(); } catch (e) { }
    } else if (typeof val === 'number') {
      d = new Date(val);
    } else if (typeof val === 'string') {
      const parsed = Date.parse(val);
      if (!isNaN(parsed)) d = new Date(parsed);
    }
    if (!d) return '';
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  const formatForInput = (header, val) => {
    const primary = getPrimaryType(header);
    if (primary === 'date') return toISODate(val);
    if (primary === 'number') return val === null || val === undefined ? '' : String(val);
    return formatValue(val);
  };

  const normalizeColumnName = (value) => (value || '').trim().replace(/\s+/g, ' ');

  const allowedAttachmentExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'doc', 'docx', 'xls', 'xlsx'];
  const allowedAttachmentMimeTypes = [
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ];
  const attachmentAccept = allowedAttachmentExtensions.map((ext) => `.${ext}`).join(',');

  const isAllowedAttachment = (file) => {
    if (!file) return false;
    const ext = String(file.name || '').split('.').pop().toLowerCase();
    if (ext && allowedAttachmentExtensions.includes(ext)) return true;
    if (file.type && allowedAttachmentMimeTypes.includes(file.type)) return true;
    return false;
  };

  const handleFileSelection = (event) => {
    const nextFiles = Array.from(event.target.files || []);
    if (nextFiles.length === 0) {
      setNewCommentFiles([]);
      setError(null);
      return;
    }

    const accepted = nextFiles.filter(isAllowedAttachment);
    const rejected = nextFiles.filter((file) => !isAllowedAttachment(file));
    setNewCommentFiles(accepted);
    if (rejected.length > 0) {
      setError(`Some files were rejected. Allowed: ${allowedAttachmentExtensions.join(', ')}`);
    } else {
      setError(null);
    }
  };

  const processRowsInBatches = async (rowUpdater, onProgress) => {
    const collRef = collection(db, `churches/${id}/${collectionName}`);
    let lastDoc = null;
    let processed = 0;

    while (true) {
      const batchQuery = lastDoc
        ? query(collRef, orderBy(documentId()), startAfter(lastDoc), limit(400))
        : query(collRef, orderBy(documentId()), limit(400));
      const snap = await getDocs(batchQuery);
      if (!snap || snap.empty) break;

      const batch = writeBatch(db);
      snap.docs.forEach((docSnap) => {
        const updatePayload = rowUpdater(docSnap);
        if (updatePayload && Object.keys(updatePayload).length > 0) {
          batch.update(docSnap.ref, updatePayload);
        }
      });
      await batch.commit();

      processed += snap.docs.length;
      if (onProgress) onProgress(processed);

      lastDoc = snap.docs[snap.docs.length - 1];
      if (!lastDoc) break;
    }
  };

  const buildRowLabel = (data, fallbackId, preferredColumn) => {
    if (!data) return `Row ${fallbackId}`;
    if (preferredColumn && data[preferredColumn] !== undefined && data[preferredColumn] !== null) {
      const directValue = String(data[preferredColumn]).trim();
      if (directValue !== '') return directValue;
    }
    const preferredKeys = ['name', 'title', 'brand', 'company', 'organization', 'org', 'church', 'project'];
    const entries = Object.entries(data);
    for (const key of preferredKeys) {
      const hit = entries.find(([k]) => String(k).toLowerCase().replace(/\s+/g, '') === key);
      if (hit && hit[1] !== undefined && hit[1] !== null && String(hit[1]).trim() !== '') {
        return String(hit[1]).trim();
      }
    }
    const firstValue = entries.find(([, v]) => v !== undefined && v !== null && String(v).trim() !== '');
    if (firstValue) return String(firstValue[1]).trim();
    return `Row ${fallbackId}`;
  };

  const isEditableField = (header) => {
    const primary = getPrimaryType(header);
    if (primary === 'date' || primary === 'number') return true;
    const val = rowData ? rowData[header] : null;
    if (val === null || val === undefined) return true;
    if (typeof val === 'object') return false;
    return true;
  };

  const headers = useMemo(() => {
    const fromMeta = Array.isArray(metaHeaders) ? metaHeaders : [];
    const fromRow = rowData ? Object.keys(rowData) : [];
    const merged = [];
    fromMeta.forEach((h) => { if (!merged.includes(h)) merged.push(h); });
    fromRow.forEach((h) => { if (!merged.includes(h)) merged.push(h); });
    return merged;
  }, [metaHeaders, rowData]);

  // Compute ordered headers based on columnOrder
  const orderedHeaders = useMemo(() => {
    if (columnOrder.length === 0) return headers;
    // Return headers in the order specified by columnOrder, plus any new headers not in columnOrder
    const ordered = columnOrder.filter(col => headers.includes(col));
    const missing = headers.filter(col => !ordered.includes(col));
    return [...ordered, ...missing];
  }, [headers, columnOrder]);

  useEffect(() => {
    const load = async () => {
      if (!id || !rowId) return;
      setLoading(true);
      setError(null);
      try {
        const metaRef = doc(db, 'churches', String(id), 'collectionMetadata', collectionName);
        const metaSnap = await getDoc(metaRef);
        if (metaSnap && metaSnap.exists()) {
          const meta = metaSnap.data() || {};
          setMetaHeaders(meta.headers || []);
          setColumnTypes(meta.types || {});
          setDefaultLabelColumn(meta.defaultLabelColumn || '');
          setColumnOrder(meta.columnOrder || meta.headers || []);
        } else {
          setMetaHeaders([]);
          setColumnTypes({});
          setDefaultLabelColumn('');
          setColumnOrder([]);
        }

        const rowRef = doc(db, `churches/${id}/${collectionName}`, rowId);
        const rowSnap = await getDoc(rowRef);
        if (!rowSnap || !rowSnap.exists()) {
          setRowData(null);
          setError('Row not found.');
          return;
        }

        const data = rowSnap.data() || {};
        setRowData(data);

        // Load all rows for dropdown options
        const q = query(collection(db, `churches/${id}/${collectionName}`));
        const allRowsSnap = await getDocs(q);
        const loadedRows = allRowsSnap.docs.map(d => ({ ...d.data(), id: d.id }));
        setAllRows(loadedRows);

        // Fetch banner URL from Firebase Storage
        try {
          const bannerRef = ref(storage, `churches/church_${id}/banner`);
          const url = await getDownloadURL(bannerRef);
          setBannerUrl(url);
        } catch (bannerErr) {
          console.warn(`Banner not found for church ${id}:`, bannerErr.message);
          setBannerUrl(''); // No banner available
        }
      } catch (err) {
        console.error('Failed to load row detail', err);
        setError('Failed to load row.');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [id, rowId]);

  useEffect(() => {
    if (!newCommentFiles || newCommentFiles.length === 0) {
      setNewCommentFilePreviews([]);
      return;
    }

    const previews = newCommentFiles.map((file) => ({
      file,
      url: URL.createObjectURL(file),
    }));
    setNewCommentFilePreviews(previews);

    return () => {
      previews.forEach((preview) => URL.revokeObjectURL(preview.url));
    };
  }, [newCommentFiles]);

  useEffect(() => {
    const loadRowOptions = async () => {
      if (!id) return;
      setLoadingRowOptions(true);
      try {
        const collRef = collection(db, `churches/${id}/${collectionName}`);
        const snap = await getDocs(query(collRef, limit(300)));
        const options = (snap.docs || []).map(d => ({
          id: d.id,
          label: buildRowLabel(d.data(), d.id, labelColumn)
        }));
        options.sort((a, b) => a.label.localeCompare(b.label));
        setRowOptions(options);
      } catch (err) {
        console.error('Failed to load row options', err);
        setRowOptions([]);
      } finally {
        setLoadingRowOptions(false);
      }
    };

    loadRowOptions();
  }, [id, labelColumn]);

  useEffect(() => {
    const loadComments = async () => {
      if (!id || !rowId) return;
      setCommentsLoading(true);
      try {
        const collRef = collection(db, `churches/${id}/${collectionName}/${rowId}/comments`);
        const snap = await getDocs(collRef);
        const list = (snap.docs || []).map(d => ({ id: d.id, ...d.data() }));
        list.sort((a, b) => {
          const ta = a.createdAt && a.createdAt.seconds ? a.createdAt.seconds : 0;
          const tb = b.createdAt && b.createdAt.seconds ? b.createdAt.seconds : 0;
          return tb - ta;
        });
        setComments(list);
      } catch (err) {
        console.error('Failed to load comments', err);
        setComments([]);
      } finally {
        setCommentsLoading(false);
      }
    };

    loadComments();
  }, [id, rowId]);

  useEffect(() => {
    if (!headers.length || !rowData) return;
    setFormData(headers.reduce((acc, h) => {
      const val = formatForInput(h, rowData[h]);
      // Convert to array for dropdown fields
      if (getColumnTypeConfig(h).dropdown && val) {
        acc[h] = Array.isArray(val) ? val : [val].filter(Boolean);
      } else {
        acc[h] = val;
      }
      return acc;
    }, {}));
  }, [headers, rowData, columnTypes]);

  useEffect(() => {
    if (!headers.length) return;
    if (!selectedColumn || !headers.includes(selectedColumn)) {
      setSelectedColumn(headers[0]);
      setRenameColumnName('');
    }
  }, [headers, selectedColumn]);

  useEffect(() => {
    if (!id) return;
    const storageKey = `excelRowLabelColumn:${id}:${collectionName}`;
    const stored = localStorage.getItem(storageKey);
    if (stored && headers.includes(stored)) {
      setLabelColumn(stored);
      return;
    }
    // Fall back to organization default
    if (defaultLabelColumn && headers.includes(defaultLabelColumn)) {
      setLabelColumn(defaultLabelColumn);
      return;
    }
    if (headers.length > 0) {
      setLabelColumn(headers[0]);
      localStorage.setItem(storageKey, headers[0]);
    }
  }, [headers, id, collectionName, defaultLabelColumn]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      // Close all dropdowns when clicking outside
      const dropdownMenus = document.querySelectorAll('[data-dropdown-menu], [data-label-dropdown], [data-switch-row-dropdown]');
      let clickedInside = false;
      dropdownMenus.forEach(menu => {
        if (menu.contains(e.target)) {
          clickedInside = true;
        }
      });
      if (!clickedInside) {
        setOpenDropdowns({});
        setOpenLabelDropdown(false);
        setOpenSwitchRowDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const saveColumnType = async (header, nextType, nextDropdown, nextShowDuplicates) => {
    if (!id || !header) return;
    const normalizedType = nextType || 'auto';
    const normalizedDropdown = !!nextDropdown;
    const normalizedShowDuplicates = !!nextShowDuplicates;
    try {
      const nextTypes = { ...(columnTypes || {}) };
      if (normalizedType === 'auto' && !normalizedDropdown) {
        delete nextTypes[header];
      } else {
        nextTypes[header] = { type: normalizedType, dropdown: normalizedDropdown, showDuplicates: normalizedShowDuplicates };
      }
      setColumnTypes(nextTypes);
      const metaRef = doc(db, 'churches', String(id), 'collectionMetadata', collectionName);
      await setDoc(metaRef, { types: nextTypes }, { merge: true });
    } catch (err) {
      console.error('Failed to update column type', err);
      setError('Failed to update column type.');
      try {
        const metaRef = doc(db, 'churches', String(id), 'collectionMetadata', collectionName);
        const metaSnap = await getDoc(metaRef);
        if (metaSnap && metaSnap.exists()) {
          const meta = metaSnap.data() || {};
          setColumnTypes(meta.types || {});
        }
      } catch (metaErr) {
        console.error('Failed to reload metadata', metaErr);
      }
    }
  };

  const saveDefaultLabelColumn = async (newDefault) => {
    if (!id) return;
    setSavingDefaultLabelColumn(true);
    try {
      setDefaultLabelColumn(newDefault);
      const metaRef = doc(db, 'churches', String(id), 'collectionMetadata', collectionName);
      await setDoc(metaRef, { defaultLabelColumn: newDefault }, { merge: true });
      setSuccess('Default label column updated for all users.');
    } catch (err) {
      console.error('Failed to save default label column', err);
      setError('Failed to save default label column.');
      try {
        const metaRef = doc(db, 'churches', String(id), 'collectionMetadata', collectionName);
        const metaSnap = await getDoc(metaRef);
        if (metaSnap && metaSnap.exists()) {
          const meta = metaSnap.data() || {};
          setDefaultLabelColumn(meta.defaultLabelColumn || '');
        }
      } catch (metaErr) {
        console.error('Failed to reload metadata', metaErr);
      }
    } finally {
      setSavingDefaultLabelColumn(false);
    }
  };

  const saveRow = async () => {
    if (!id || !rowId) return;
    setSaving(true);
    setError(null);
    try {
      const payload = headers.reduce((acc, h) => {
        if (!isEditableField(h)) {
          acc[h] = rowData ? rowData[h] : null;
          return acc;
        }

        const primary = getPrimaryType(h);
        const value = formData[h];
        if (primary === 'date') {
          acc[h] = value ? new Date(value) : null;
        } else if (primary === 'number') {
          acc[h] = value === '' || value === null || value === undefined ? null : (isNaN(parseFloat(value)) ? value : parseFloat(value));
        } else {
          acc[h] = value;
        }
        return acc;
      }, {});

      payload.updatedAt = serverTimestamp();
      const rowRef = doc(db, `churches/${id}/${collectionName}`, rowId);
      await updateDoc(rowRef, payload);
      setRowData(prev => ({ ...(prev || {}), ...payload }));
    } catch (err) {
      console.error('Failed to save row', err);
      setError('Failed to save row.');
    } finally {
      setSaving(false);
    }
  };

  const addComment = async () => {
    const text = (newCommentText || '').trim();
    if ((!text && (!newCommentFiles || newCommentFiles.length === 0)) || !id || !rowId) return;
    setAddingComment(true);
    setError(null);
    setSuccess(null);
    setUploadProgress({});
    try {
      const createdBy = (user && (user.email || user.uid)) || 'anonymous';
      const createdAt = serverTimestamp();
      const collRef = collection(db, `churches/${id}/${collectionName}/${rowId}/comments`);
      const docRef = doc(collRef);
      const basePayload = { text, createdBy, createdAt, attachments: [] };
      await setDoc(docRef, basePayload);

      let attachments = [];
      if (newCommentFiles && newCommentFiles.length > 0) {
        if (!storage) {
          throw new Error('Firebase storage is not available.');
        }

        for (const file of newCommentFiles) {
          const fileKey = `${file.name}-${file.size}-${file.lastModified}`;
          const safeName = sanitizeFileName(file.name);
          const storagePath = `churches/${id}/${collectionName}/${rowId}/comments/${docRef.id}/${Date.now()}_${safeName}`;
          const fileRef = ref(storage, storagePath);

          setUploadProgress(prev => ({
            ...prev,
            [fileKey]: {
              name: file.name,
              progress: 0,
              status: 'uploading',
            },
          }));

          const url = await new Promise((resolve, reject) => {
            const uploadTask = uploadBytesResumable(fileRef, file);
            uploadTask.on(
              'state_changed',
              (snapshot) => {
                const pct = snapshot.totalBytes > 0
                  ? Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)
                  : 0;
                setUploadProgress(prev => ({
                  ...prev,
                  [fileKey]: {
                    ...(prev[fileKey] || { name: file.name }),
                    progress: pct,
                    status: 'uploading',
                  },
                }));
              },
              (err) => {
                setUploadProgress(prev => ({
                  ...prev,
                  [fileKey]: {
                    ...(prev[fileKey] || { name: file.name }),
                    progress: 0,
                    status: 'error',
                  },
                }));
                reject(err);
              },
              async () => {
                try {
                  const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
                  setUploadProgress(prev => ({
                    ...prev,
                    [fileKey]: {
                      ...(prev[fileKey] || { name: file.name }),
                      progress: 100,
                      status: 'done',
                    },
                  }));
                  resolve(downloadUrl);
                } catch (err) {
                  reject(err);
                }
              }
            );
          });

          attachments.push({
            name: file.name,
            url,
            path: storagePath,
            contentType: file.type || 'application/octet-stream',
            size: file.size || 0,
          });
        }

        await updateDoc(docRef, { attachments });
      }

      setComments(prev => [{ id: docRef.id, text, createdBy, createdAt: new Date(), attachments }, ...(prev || [])]);
      setNewCommentText('');
      setNewCommentFiles([]);
      setUploadProgress({});
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      setSuccess('Comment added successfully!');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error('Failed to add comment', err);
      setError(`Failed to add comment${err && err.message ? `: ${err.message}` : '.'}`);
    } finally {
      setAddingComment(false);
    }
  };

  const deleteAttachment = async (commentId, attachmentIndex) => {
    if (!id || !rowId || !commentId) return;
    const targetComment = comments.find((comment) => comment.id === commentId);
    if (!targetComment || !targetComment.attachments || !targetComment.attachments[attachmentIndex]) return;
    const ok = window.confirm('Remove this attachment?');
    if (!ok) return;

    const attachment = targetComment.attachments[attachmentIndex];
    const key = `${commentId}-${attachmentIndex}`;
    setDeletingAttachmentKey(key);
    try {
      const nextAttachments = targetComment.attachments.filter((_, idx) => idx !== attachmentIndex);
      const commentRef = doc(db, `churches/${id}/${collectionName}/${rowId}/comments`, commentId);
      await updateDoc(commentRef, { attachments: nextAttachments });

      if (attachment.path && storage) {
        try {
          await deleteObject(ref(storage, attachment.path));
        } catch (err) {
          console.warn('Failed to delete attachment from storage', err);
        }
      }

      setComments(prev => prev.map(c => (c.id === commentId ? { ...c, attachments: nextAttachments } : c)));
      setSuccess('Attachment removed successfully!');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error('Failed to remove attachment', err);
      setError('Failed to remove attachment.');
    } finally {
      setDeletingAttachmentKey(null);
    }
  };

  const updateComment = async (commentId) => {
    const text = (editingCommentText || '').trim();
    if (!text || !id || !rowId || !commentId) return;
    try {
      const ref = doc(db, `churches/${id}/${collectionName}/${rowId}/comments`, commentId);
      await updateDoc(ref, { text, updatedAt: serverTimestamp() });
      setComments(prev => prev.map(c => c.id === commentId ? { ...c, text } : c));
      setEditingCommentId(null);
      setEditingCommentText('');
      setSuccess('Comment updated successfully!');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error('Failed to update comment', err);
      setError('Failed to update comment.');
    }
  };

  const deleteComment = async (commentId) => {
    if (!id || !rowId || !commentId) return;
    const ok = window.confirm('Delete this comment? This action cannot be undone.');
    if (!ok) return;
    setDeletingCommentId(commentId);
    setError(null);
    setSuccess(null);
    try {
      const ref = doc(db, `churches/${id}/${collectionName}/${rowId}/comments`, commentId);
      await deleteDoc(ref);
      setComments(prev => prev.filter(c => c.id !== commentId));
      setSuccess('Comment deleted successfully!');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error('Failed to delete comment', err);
      setError('Failed to delete comment.');
    } finally {
      setDeletingCommentId(null);
    }
  };

  const addColumn = async () => {
    if (!id) return;
    const trimmed = (newColumnName || '').trim().replace(/\s+/g, ' ');
    if (!trimmed) {
      setError('Column name is required.');
      return;
    }
    const exists = headers.some(h => h.toLowerCase() === trimmed.toLowerCase());
    if (exists) {
      setError('Column name already exists.');
      return;
    }

    setAddingColumn(true);
    setError(null);
    setSuccess(null);
    try {
      const nextHeaders = [...headers, trimmed];
      const nextColumnOrder = [...columnOrder, trimmed];
      const metaRef = doc(db, 'churches', String(id), 'collectionMetadata', collectionName);
      await setDoc(metaRef, { headers: nextHeaders, columnOrder: nextColumnOrder }, { merge: true });
      setMetaHeaders(nextHeaders);
      setColumnOrder(nextColumnOrder);
      setFormData(prev => ({ ...prev, [trimmed]: '' }));
      setRowData(prev => ({ ...(prev || {}), [trimmed]: '' }));

      const rowRef = doc(db, `churches/${id}/${collectionName}`, rowId);
      await updateDoc(rowRef, { [trimmed]: '' });

      if (!labelColumn) {
        setLabelColumn(trimmed);
        const storageKey = `excelRowLabelColumn:${id}:${collectionName}`;
        localStorage.setItem(storageKey, trimmed);
      }
      setNewColumnName('');
      setSuccess('Column added successfully!');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error('Failed to add column', err);
      setError('Failed to add column.');
    } finally {
      setAddingColumn(false);
    }
  };

  const moveColumn = async (header, direction) => {
    if (!id || !header) return;
    const currentIndex = columnOrder.indexOf(header);
    if (currentIndex === -1) return;
    
    let newIndex = currentIndex;
    if (direction === 'up' && currentIndex > 0) {
      newIndex = currentIndex - 1;
    } else if (direction === 'down' && currentIndex < columnOrder.length - 1) {
      newIndex = currentIndex + 1;
    } else {
      return; // Can't move
    }

    const nextOrder = [...columnOrder];
    [nextOrder[currentIndex], nextOrder[newIndex]] = [nextOrder[newIndex], nextOrder[currentIndex]];

    try {
      setColumnOrder(nextOrder);
      const metaRef = doc(db, 'churches', String(id), 'collectionMetadata', collectionName);
      await setDoc(metaRef, { columnOrder: nextOrder }, { merge: true });
      setSuccess('Column order updated!');
      setTimeout(() => setSuccess(null), 2000);
    } catch (err) {
      console.error('Failed to update column order', err);
      setError('Failed to update column order.');
      setColumnOrder(columnOrder); // Revert
    }
  };

  const createNewRow = async () => {
    if (!id) return;
    const label = (newRowLabel || '').trim();
    if (!label) {
      setError('Please enter a label for the new row.');
      return;
    }

    setCreatingNewRow(true);
    setError(null);
    try {
      // Create new row with label in the label column if it exists
      const newRowData = {};
      if (labelColumn) {
        newRowData[labelColumn] = label;
      }
      
      // Add all other columns with empty/default values
      headers.forEach(header => {
        if (header !== labelColumn && !newRowData[header]) {
          newRowData[header] = '';
        }
      });

      // Create new document in Firestore
      const brandRef = collection(db, `churches/${id}/${collectionName}`);
      const docRef = await addDoc(brandRef, {
        ...newRowData,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // Navigate to the new row's detail page
      navigate(`/organization/${id}/time-tracker/brands/${docRef.id}`);
      setNewRowLabel('');
      setSuccess('Row created successfully!');
      setTimeout(() => setSuccess(null), 2000);
    } catch (err) {
      console.error('Failed to create new row', err);
      setError('Failed to create new row.');
    } finally {
      setCreatingNewRow(false);
    }
  };

  const deleteSelectedRow = async () => {
    if (!id || !selectedRowDelete) return;

    // Find the row label for display
    const rowToDelete = allRows.find(r => r.id === selectedRowDelete);
    const rowLabel = rowToDelete 
      ? (labelColumn && rowToDelete[labelColumn]) || selectedRowDelete 
      : selectedRowDelete;

    const confirmed = window.confirm(
      `Are you sure you want to delete the row "${rowLabel}"? This action cannot be undone.`
    );
    if (!confirmed) return;

    setDeletingRow(true);
    setError(null);
    try {
      // Delete the row document
      const rowRef = doc(db, `churches/${id}/${collectionName}`, selectedRowDelete);
      await deleteDoc(rowRef);

      // If we're currently viewing this row, navigate back to list
      if (rowId === selectedRowDelete) {
        navigate(`/organization/${id}/time-tracker?tab=brands`);
      }

      setSuccess('Row deleted successfully!');
      setSelectedRowDelete('');
      setAllRows(prev => prev.filter(r => r.id !== selectedRowDelete));
      setTimeout(() => setSuccess(null), 2000);
    } catch (err) {
      console.error('Failed to delete row', err);
      setError('Failed to delete row.');
    } finally {
      setDeletingRow(false);
    }
  };

  const renameColumn = async () => {
    if (!id || !rowId || !selectedColumn) return;
    const nextName = normalizeColumnName(renameColumnName);
    if (!nextName) {
      setError('New column name is required.');
      return;
    }
    if (nextName.toLowerCase() === selectedColumn.toLowerCase()) {
      setError('New column name must be different.');
      return;
    }
    const exists = headers.some(h => h.toLowerCase() === nextName.toLowerCase());
    if (exists) {
      setError('Column name already exists.');
      return;
    }

    const ok = window.confirm(`Rename column "${selectedColumn}" to "${nextName}" for all rows?`);
    if (!ok) return;

    setRenamingColumn(true);
    setError(null);
    setSuccess(null);
    setColumnBatchStatus({ action: `Renaming "${selectedColumn}"`, processed: 0 });
    try {
      const nextHeaders = headers.map(h => (h === selectedColumn ? nextName : h));
      const nextTypes = { ...(columnTypes || {}) };
      if (nextTypes[selectedColumn]) {
        nextTypes[nextName] = nextTypes[selectedColumn];
        delete nextTypes[selectedColumn];
      }

      const metaRef = doc(db, 'churches', String(id), 'collectionMetadata', collectionName);
      await setDoc(metaRef, { headers: nextHeaders, types: nextTypes }, { merge: true });
      setMetaHeaders(nextHeaders);
      setColumnTypes(nextTypes);

      await processRowsInBatches((docSnap) => {
        const data = docSnap.data() || {};
        const updatePayload = { [selectedColumn]: deleteField() };
        if (data[selectedColumn] !== undefined) {
          updatePayload[nextName] = data[selectedColumn];
        }
        return updatePayload;
      }, (processed) => {
        setColumnBatchStatus(prev => ({ ...(prev || {}), processed }));
      });

      setFormData(prev => {
        const next = { ...(prev || {}) };
        next[nextName] = prev ? prev[selectedColumn] : '';
        delete next[selectedColumn];
        return next;
      });
      setRowData(prev => {
        const next = { ...(prev || {}) };
        next[nextName] = prev ? prev[selectedColumn] : '';
        delete next[selectedColumn];
        return next;
      });

      if (labelColumn === selectedColumn) {
        setLabelColumn(nextName);
        const storageKey = `excelRowLabelColumn:${id}:${collectionName}`;
        localStorage.setItem(storageKey, nextName);
      }

      setSelectedColumn(nextName);
      setRenameColumnName('');
      setSuccess('Column renamed successfully!');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error('Failed to rename column', err);
      setError('Failed to rename column.');
    } finally {
      setRenamingColumn(false);
      setColumnBatchStatus(null);
    }
  };

  const deleteColumn = async () => {
    if (!id || !rowId || !selectedColumn) return;
    const ok = window.confirm(`Delete column "${selectedColumn}" from all rows? This cannot be undone.`);
    if (!ok) return;

    setDeletingColumn(true);
    setError(null);
    setSuccess(null);
    setColumnBatchStatus({ action: `Deleting "${selectedColumn}"`, processed: 0 });
    try {
      const nextHeaders = headers.filter(h => h !== selectedColumn);
      const nextTypes = { ...(columnTypes || {}) };
      if (nextTypes[selectedColumn]) delete nextTypes[selectedColumn];

      const metaRef = doc(db, 'churches', String(id), 'collectionMetadata', collectionName);
      await setDoc(metaRef, { headers: nextHeaders, types: nextTypes }, { merge: true });
      setMetaHeaders(nextHeaders);
      setColumnTypes(nextTypes);

      await processRowsInBatches(() => ({ [selectedColumn]: deleteField() }), (processed) => {
        setColumnBatchStatus(prev => ({ ...(prev || {}), processed }));
      });

      setFormData(prev => {
        const next = { ...(prev || {}) };
        delete next[selectedColumn];
        return next;
      });
      setRowData(prev => {
        const next = { ...(prev || {}) };
        delete next[selectedColumn];
        return next;
      });

      if (labelColumn === selectedColumn) {
        const nextLabel = nextHeaders[0] || '';
        setLabelColumn(nextLabel);
        const storageKey = `excelRowLabelColumn:${id}:${collectionName}`;
        if (nextLabel) localStorage.setItem(storageKey, nextLabel);
        else localStorage.removeItem(storageKey);
      }

      setSelectedColumn(nextHeaders[0] || '');
      setRenameColumnName('');
      setSuccess('Column deleted successfully!');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error('Failed to delete column', err);
      setError('Failed to delete column.');
    } finally {
      setDeletingColumn(false);
      setColumnBatchStatus(null);
    }
  };

  return (
    <div style={{ background: '#f9fafb', minHeight: '100vh' }}>
      {/* Header with Banner */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e5e7eb' }}>
        {bannerUrl && (
          <img 
            src={bannerUrl}
            alt="Church Banner"
            style={{
              width: '100%',
              height: 'auto',
              maxHeight: 180,
              objectFit: 'cover',
              display: 'block'
            }}
          />
        )}
        {/* Top Right Logout Button */}
        <div style={{ padding: '12px 20px', background: '#fff', borderBottom: '1px solid #f3f4f6', display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={async () => {
              try {
                await logout();
                // Redirect to login with returnUrl to come back to this page after login
                const currentUrl = window.location.pathname + window.location.search;
                navigate(`/organization/${id}/login?returnUrl=${encodeURIComponent(currentUrl)}`);
              } catch (err) {
                setError('Failed to logout');
              }
            }}
            style={{
              padding: '8px 16px',
              borderRadius: 6,
              border: '1px solid #e5e7eb',
              background: '#f3f4f6',
              color: '#374151',
              cursor: 'pointer',
              fontWeight: 500,
              fontSize: 13,
              transition: 'all 0.2s'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = '#e5e7eb';
              e.currentTarget.style.borderColor = '#d1d5db';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = '#f3f4f6';
              e.currentTarget.style.borderColor = '#e5e7eb';
            }}
          >
            🚪 Logout
          </button>
        </div>
        <div style={{ padding: 20, background: '#fff' }}>
          <div style={{ maxWidth: 1200, margin: '0 auto' }}>
            <p style={{ margin: '0 0 8px 0', color: '#6b7280', fontSize: 13 }}>Collection: {collectionName} • Row ID: {rowId}</p>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
              <div>
                <h1 style={{ margin: '0 0 4px 0', fontSize: 28, fontWeight: 700 }}>BIM Tracker - Row Details</h1>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: '#6b7280' }}>Label column</span>
              <div data-label-dropdown style={{ position: 'relative', minWidth: 180 }}>
                <button
                  type="button"
                  onClick={() => setOpenLabelDropdown(!openLabelDropdown)}
                  disabled={headers.length === 0}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: 6,
                    border: '1px solid #e5e7eb',
                    background: '#fff',
                    fontSize: 13,
                    fontFamily: 'inherit',
                    cursor: headers.length === 0 ? 'not-allowed' : 'pointer',
                    opacity: headers.length === 0 ? 0.5 : 1,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span>{labelColumn || 'Select column'}</span>
                  <span style={{ fontSize: 12 }}>{openLabelDropdown ? '▲' : '▼'}</span>
                </button>
                {openLabelDropdown && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      position: 'absolute',
                      top: 'calc(100% + 4px)',
                      left: 0,
                      right: 0,
                      background: '#fff',
                      border: '1px solid #e5e7eb',
                      borderRadius: 6,
                      maxHeight: 250,
                      overflowY: 'auto',
                      zIndex: 20,
                      boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                    }}
                  >
                    <div style={{ padding: 8 }}>
                      <input
                        type="text"
                        value={labelColumnSearch}
                        onChange={(e) => setLabelColumnSearch(e.target.value)}
                        placeholder="Search columns..."
                        autoFocus
                        style={{
                          width: '100%',
                          padding: '8px 10px',
                          borderRadius: 4,
                          border: '1px solid #e5e7eb',
                          fontSize: 13,
                          fontFamily: 'inherit',
                          boxSizing: 'border-box',
                          marginBottom: 8,
                        }}
                      />
                    </div>
                    {headers
                      .filter(h => !labelColumnSearch || h.toLowerCase().includes(labelColumnSearch.toLowerCase()))
                      .map((h) => (
                        <div
                          key={h}
                          onClick={() => {
                            setLabelColumn(h);
                            setOpenLabelDropdown(false);
                            setLabelColumnSearch('');
                            if (id) {
                              const storageKey = `excelRowLabelColumn:${id}:${collectionName}`;
                              localStorage.setItem(storageKey, h);
                            }
                          }}
                          style={{
                            padding: '10px 12px',
                            borderBottom: '1px solid #f3f4f6',
                            cursor: 'pointer',
                            fontSize: 13,
                            backgroundColor: labelColumn === h ? '#eff6ff' : '#fff',
                            fontWeight: labelColumn === h ? 600 : 400,
                            color: labelColumn === h ? '#0284c7' : '#1f2937',
                            transition: 'background-color 0.15s',
                          }}
                          onMouseOver={(e) => {
                            if (labelColumn !== h) e.currentTarget.style.backgroundColor = '#f9fafb';
                          }}
                          onMouseOut={(e) => {
                            if (labelColumn !== h) e.currentTarget.style.backgroundColor = '#fff';
                          }}
                        >
                          {h}
                        </div>
                      ))}
                    {headers.filter(h => !labelColumnSearch || h.toLowerCase().includes(labelColumnSearch.toLowerCase())).length === 0 && (
                      <div style={{ padding: '10px 12px', color: '#9ca3af', fontSize: 13, textAlign: 'center' }}>
                        No matches found
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: '#6b7280' }}>Switch row</span>
              <div data-switch-row-dropdown style={{ position: 'relative', minWidth: 220 }}>
                <button
                  type="button"
                  onClick={() => setOpenSwitchRowDropdown(!openSwitchRowDropdown)}
                  disabled={loadingRowOptions || rowOptions.length === 0}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: 6,
                    border: '1px solid #e5e7eb',
                    background: '#fff',
                    fontSize: 13,
                    fontFamily: 'inherit',
                    cursor: (loadingRowOptions || rowOptions.length === 0) ? 'not-allowed' : 'pointer',
                    opacity: (loadingRowOptions || rowOptions.length === 0) ? 0.5 : 1,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span>
                    {loadingRowOptions 
                      ? 'Loading rows...' 
                      : (rowOptions.length === 0 
                        ? 'No rows available' 
                        : (rowOptions.find(opt => opt.id === rowId)?.label || 'Select row')
                      )
                    }
                  </span>
                  <span style={{ fontSize: 12 }}>{openSwitchRowDropdown ? '▲' : '▼'}</span>
                </button>
                {openSwitchRowDropdown && !loadingRowOptions && rowOptions.length > 0 && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      position: 'absolute',
                      top: 'calc(100% + 4px)',
                      left: 0,
                      right: 0,
                      background: '#fff',
                      border: '1px solid #e5e7eb',
                      borderRadius: 6,
                      maxHeight: 250,
                      overflowY: 'auto',
                      zIndex: 20,
                      boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                    }}
                  >
                    <div style={{ padding: 8 }}>
                      <input
                        type="text"
                        value={switchRowSearch}
                        onChange={(e) => setSwitchRowSearch(e.target.value)}
                        placeholder="Search rows..."
                        autoFocus
                        style={{
                          width: '100%',
                          padding: '8px 10px',
                          borderRadius: 4,
                          border: '1px solid #e5e7eb',
                          fontSize: 13,
                          fontFamily: 'inherit',
                          boxSizing: 'border-box',
                          marginBottom: 8,
                        }}
                      />
                    </div>
                    {rowOptions
                      .filter(opt => !switchRowSearch || opt.label.toLowerCase().includes(switchRowSearch.toLowerCase()))
                      .map((opt) => (
                        <div
                          key={opt.id}
                          onClick={() => {
                            if (opt.id !== rowId) {
                              navigate(`/organization/${id}/time-tracker/brands/${opt.id}`);
                            }
                            setOpenSwitchRowDropdown(false);
                            setSwitchRowSearch('');
                          }}
                          style={{
                            padding: '10px 12px',
                            borderBottom: '1px solid #f3f4f6',
                            cursor: 'pointer',
                            fontSize: 13,
                            backgroundColor: rowId === opt.id ? '#eff6ff' : '#fff',
                            fontWeight: rowId === opt.id ? 600 : 400,
                            color: rowId === opt.id ? '#0284c7' : '#1f2937',
                            transition: 'background-color 0.15s',
                          }}
                          onMouseOver={(e) => {
                            if (rowId !== opt.id) e.currentTarget.style.backgroundColor = '#f9fafb';
                          }}
                          onMouseOut={(e) => {
                            if (rowId !== opt.id) e.currentTarget.style.backgroundColor = '#fff';
                          }}
                        >
                          {opt.label}
                        </div>
                      ))}
                    {rowOptions.filter(opt => !switchRowSearch || opt.label.toLowerCase().includes(switchRowSearch.toLowerCase())).length === 0 && (
                      <div style={{ padding: '10px 12px', color: '#9ca3af', fontSize: 13, textAlign: 'center' }}>
                        No matches found
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
            <Link className="btn secondary" to={`/organization/${id}/time-tracker?tab=brands`} style={{ padding: '8px 16px' }}>
              ← Back to List
            </Link>
            {activeTab === 'data' && (
              <button className="btn" onClick={saveRow} disabled={saving || loading || !rowData} style={{ padding: '8px 16px' }}>
                {saving ? '💾 Saving...' : '💾 Save Changes'}
              </button>
            )}
            </div>
          </div>
        </div>
      </div>
      </div>

      {/* Alerts */}
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 20px', marginTop: 16 }}>
        {error && <div style={{ background: '#fee2e2', border: '1px solid #fecaca', borderRadius: 8, padding: 12, color: '#991b1b', marginBottom: 12 }}>⚠️ {error}</div>}
        {columnBatchStatus && (
          <div style={{ background: '#dbeafe', border: '1px solid #bfdbfe', borderRadius: 8, padding: 12, color: '#1d4ed8', marginBottom: 12 }}>
            ⏳ {columnBatchStatus.action}... Processed {columnBatchStatus.processed} rows.
          </div>
        )}
        {success && <div style={{ background: '#dcfce7', border: '1px solid #86efac', borderRadius: 8, padding: 12, color: '#15803d', marginBottom: 12 }}>✓ {success}</div>}
      </div>

      {/* Tab Navigation */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e5e7eb', marginTop: 16 }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 20px', display: 'flex', gap: 0 }}>
          <button
            onClick={() => setActiveTab('data')}
            style={{
              padding: '12px 20px',
              border: 'none',
              background: activeTab === 'data' ? '#fff' : 'transparent',
              borderBottom: activeTab === 'data' ? '2px solid #0ea5e9' : 'none',
              color: activeTab === 'data' ? '#0ea5e9' : '#6b7280',
              cursor: 'pointer',
              fontWeight: activeTab === 'data' ? 600 : 400,
              fontSize: 14,
            }}
          >
            📝 Data Entry
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            style={{
              padding: '12px 20px',
              border: 'none',
              background: activeTab === 'settings' ? '#fff' : 'transparent',
              borderBottom: activeTab === 'settings' ? '2px solid #0ea5e9' : 'none',
              color: activeTab === 'settings' ? '#0ea5e9' : '#6b7280',
              cursor: 'pointer',
              fontWeight: activeTab === 'settings' ? 600 : 400,
              fontSize: 14,
            }}
          >
            ⚙️ Column Settings
          </button>
          <button
            onClick={() => setActiveTab('comments')}
            style={{
              padding: '12px 20px',
              border: 'none',
              background: activeTab === 'comments' ? '#fff' : 'transparent',
              borderBottom: activeTab === 'comments' ? '2px solid #0ea5e9' : 'none',
              color: activeTab === 'comments' ? '#0ea5e9' : '#6b7280',
              cursor: 'pointer',
              fontWeight: activeTab === 'comments' ? 600 : 400,
              fontSize: 14,
            }}
          >
            💬 Comments ({comments.length})
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 20px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#6b7280' }}>
            <div style={{ fontSize: 18, marginBottom: 8 }}>⏳ Loading...</div>
          </div>
        ) : !rowData ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#6b7280' }}>
            <div style={{ fontSize: 18 }}>⚠️ No data available</div>
          </div>
        ) : (
          <>
            {/* Data Entry Tab */}
            {activeTab === 'data' && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: 20 }}>
                  {orderedHeaders.map((header) => {
                    const primary = getPrimaryType(header);
                    const editable = isEditableField(header);
                    const inputType = primary === 'number' ? 'number' : (primary === 'date' ? 'date' : 'text');
                    return (
                      <div key={header} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16 }}>
                        <label style={{ display: 'block', fontWeight: 600, marginBottom: 8, fontSize: 14, color: '#1f2937' }}>
                          {header}
                          {primary !== 'text' && <span style={{ fontSize: 12, color: '#9ca3af', marginLeft: 6, fontWeight: 400 }}>({primary})</span>}
                        </label>
                        {editable ? (
                          getColumnTypeConfig(header).dropdown ? (
                            <div data-dropdown-menu style={{ position: 'relative' }}>
                              <button
                                type="button"
                                onClick={() => setOpenDropdowns(prev => ({ ...prev, [header]: !prev[header] }))}
                                style={{
                                  width: '100%',
                                  padding: '10px 12px',
                                  borderRadius: 6,
                                  border: '1px solid #e5e7eb',
                                  fontSize: 14,
                                  fontFamily: 'inherit',
                                  boxSizing: 'border-box',
                                  background: '#fff',
                                  textAlign: 'left',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                }}
                              >
                                <span>{(formData[header]?.length ?? 0) > 0 ? `${formData[header].length} selected` : `Select ${header.toLowerCase()}...`}</span>
                                <span style={{ fontSize: 12 }}>{openDropdowns[header] ? '▲' : '▼'}</span>
                              </button>
                              
                              {(formData[header]?.length ?? 0) > 0 && (
                                <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                                  {Array.isArray(formData[header]) && formData[header].map((val) => (
                                    <div
                                      key={val}
                                      style={{
                                        background: '#dbeafe',
                                        color: '#0284c7',
                                        padding: '4px 8px',
                                        borderRadius: 4,
                                        fontSize: 12,
                                        fontWeight: 500,
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 4,
                                      }}
                                    >
                                      {val}
                                      <button
                                        type="button"
                                        onClick={() => setFormData(prev => ({
                                          ...prev,
                                          [header]: Array.isArray(prev[header]) ? prev[header].filter(v => v !== val) : []
                                        }))}
                                        style={{
                                          background: 'none',
                                          border: 'none',
                                          cursor: 'pointer',
                                          color: '#0284c7',
                                          padding: 0,
                                          fontSize: 14,
                                          lineHeight: 1,
                                        }}
                                      >
                                        ✕
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {openDropdowns[header] && (
                                <div
                                  onClick={(e) => e.stopPropagation()}
                                  style={{
                                    position: 'absolute',
                                    top: 'calc(100% + 4px)',
                                    left: 0,
                                    right: 0,
                                    background: '#fff',
                                    border: '1px solid #e5e7eb',
                                    borderRadius: 6,
                                    maxHeight: 250,
                                    overflowY: 'auto',
                                    zIndex: 20,
                                    boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                                  }}
                                >
                                  <div style={{ padding: 8 }}>
                                    <input
                                      type="text"
                                      value={dropdownSearches[header] ?? ''}
                                      onChange={(e) => setDropdownSearches(prev => ({ ...prev, [header]: e.target.value }))}
                                      placeholder={`Search ${header.toLowerCase()}...`}
                                      autoFocus
                                      style={{
                                        width: '100%',
                                        padding: '8px 10px',
                                        borderRadius: 4,
                                        border: '1px solid #e5e7eb',
                                        fontSize: 13,
                                        fontFamily: 'inherit',
                                        boxSizing: 'border-box',
                                        marginBottom: 8,
                                      }}
                                    />
                                  </div>
                                  {(() => {
                                    const config = getColumnTypeConfig(header);
                                    const optionValues = (allRows || [])
                                      .map(row => row[header])
                                      .filter(val => val && String(val).trim());
                                    const deduped = config.showDuplicates ? optionValues : Array.from(new Set(optionValues));
                                    return deduped
                                      .sort((a, b) => String(a).localeCompare(String(b)))
                                      .filter(val => {
                                        const searchTerm = dropdownSearches[header] || '';
                                        return !searchTerm || String(val).toLowerCase().includes(String(searchTerm).toLowerCase());
                                      })
                                      .map((val) => {
                                      const isSelected = Array.isArray(formData[header]) && formData[header].includes(val);
                                      return (
                                        <label
                                          key={val}
                                          style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 8,
                                            padding: '10px 12px',
                                            borderBottom: '1px solid #f3f4f6',
                                            cursor: 'pointer',
                                            fontSize: 13,
                                            background: isSelected ? '#eff6ff' : '#fff',
                                            transition: 'background-color 0.15s',
                                          }}
                                          onMouseOver={(e) => {
                                            if (!isSelected) e.currentTarget.style.backgroundColor = '#f9fafb';
                                          }}
                                          onMouseOut={(e) => {
                                            if (!isSelected) e.currentTarget.style.backgroundColor = '#fff';
                                          }}
                                        >
                                          <input
                                            type="checkbox"
                                            checked={isSelected}
                                            onChange={() => {
                                              setFormData(prev => {
                                                const current = Array.isArray(prev[header]) ? prev[header] : [];
                                                if (isSelected) {
                                                  return { ...prev, [header]: current.filter(v => v !== val) };
                                                } else {
                                                  return { ...prev, [header]: [...current, val] };
                                                }
                                              });
                                            }}
                                            style={{ cursor: 'pointer', width: 16, height: 16 }}
                                          />
                                          <span>{val}</span>
                                        </label>
                                      );
                                    });
                                  })()}
                                  {(() => {
                                    const config = getColumnTypeConfig(header);
                                    const optionValues = (allRows || [])
                                      .map(row => row[header])
                                      .filter(val => val && String(val).trim());
                                    const deduped = config.showDuplicates ? optionValues : Array.from(new Set(optionValues));
                                    return deduped
                                      .filter(val => {
                                        const searchTerm = dropdownSearches[header] || '';
                                        return !searchTerm || String(val).toLowerCase().includes(String(searchTerm).toLowerCase());
                                      }).length === 0;
                                  })() && (
                                    <div style={{ padding: '10px 12px', color: '#9ca3af', fontSize: 13, textAlign: 'center' }}>
                                      No matches found
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          ) : (
                            <input
                              type={inputType}
                              value={formData[header] ?? ''}
                              onChange={(e) => setFormData(prev => ({ ...prev, [header]: e.target.value }))}
                              placeholder={`Enter ${header.toLowerCase()}...`}
                              style={{
                                width: '100%',
                                padding: '10px 12px',
                                borderRadius: 6,
                                border: '1px solid #e5e7eb',
                                fontSize: 14,
                                fontFamily: 'inherit',
                                boxSizing: 'border-box',
                              }}
                            />
                          )
                        ) : (
                          <div style={{ padding: '10px 12px', borderRadius: 6, background: '#f3f4f6', border: '1px solid #e5e7eb', fontSize: 14, color: '#6b7280', wordBreak: 'break-word' }}>
                            {formatValue(rowData[header]) || '(empty)'}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* Column Settings Tab */}
            {activeTab === 'settings' && (
              <div style={{ display: 'grid', gap: 16 }}>
                {/* Create New Row - Collapsible */}
                <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
                  <button
                    type="button"
                    onClick={() => setExpandCreateRow(!expandCreateRow)}
                    style={{
                      width: '100%',
                      padding: 20,
                      border: 'none',
                      background: '#fff',
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: 16,
                      fontWeight: 600,
                      color: '#1f2937',
                      transition: 'background-color 0.2s',
                      borderBottom: expandCreateRow ? '1px solid #e5e7eb' : 'none'
                    }}
                    onMouseOver={(e) => e.currentTarget.style.background = '#f9fafb'}
                    onMouseOut={(e) => e.currentTarget.style.background = '#fff'}
                  >
                    <span>➕ Create New Row</span>
                    <span style={{ fontSize: 14, transition: 'transform 0.2s', transform: expandCreateRow ? 'rotate(180deg)' : 'rotate(0deg)' }}>▼</span>
                  </button>
                  {expandCreateRow && (
                    <div style={{ padding: 20, borderTop: '1px solid #e5e7eb' }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
                        <div style={{ minWidth: 220, flex: 1 }}>
                          <label style={{ display: 'block', fontWeight: 600, marginBottom: 6, fontSize: 13, color: '#1f2937' }}>
                            Row label {labelColumn && <span style={{ fontSize: 12, color: '#9ca3af' }}>({labelColumn})</span>}
                          </label>
                          <input
                            type="text"
                            value={newRowLabel}
                            onChange={(e) => setNewRowLabel(e.target.value)}
                            placeholder={labelColumn ? `Enter ${labelColumn.toLowerCase()}...` : 'Enter row label...'}
                            onKeyPress={(e) => e.key === 'Enter' && createNewRow()}
                            style={{
                              width: '100%',
                              padding: '10px 12px',
                              borderRadius: 6,
                              border: '1px solid #e5e7eb',
                              fontSize: 14,
                              fontFamily: 'inherit',
                              boxSizing: 'border-box'
                            }}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={createNewRow}
                          disabled={creatingNewRow}
                          className="btn"
                          style={{ padding: '10px 16px' }}
                        >
                          {creatingNewRow ? 'Creating...' : 'Create Row'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Delete Row - Collapsible */}
                <div style={{ background: '#fff', border: '1px solid #fee2e2', borderRadius: 8, overflow: 'hidden' }}>
                  <button
                    type="button"
                    onClick={() => setExpandDeleteRow(!expandDeleteRow)}
                    style={{
                      width: '100%',
                      padding: 20,
                      border: 'none',
                      background: '#fff',
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: 16,
                      fontWeight: 600,
                      color: '#1f2937',
                      transition: 'background-color 0.2s',
                      borderBottom: expandDeleteRow ? '1px solid #fee2e2' : 'none'
                    }}
                    onMouseOver={(e) => e.currentTarget.style.background = '#fef2f2'}
                    onMouseOut={(e) => e.currentTarget.style.background = '#fff'}
                  >
                    <span>🗑️ Delete Row</span>
                    <span style={{ fontSize: 14, transition: 'transform 0.2s', transform: expandDeleteRow ? 'rotate(180deg)' : 'rotate(0deg)' }}>▼</span>
                  </button>
                  {expandDeleteRow && (
                    <div style={{ padding: 20, borderTop: '1px solid #fee2e2' }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
                        <div style={{ minWidth: 220, flex: 1 }}>
                          <label style={{ display: 'block', fontWeight: 600, marginBottom: 6, fontSize: 13, color: '#1f2937' }}>
                            Select row to delete
                          </label>
                          <select
                            value={selectedRowDelete}
                            onChange={(e) => setSelectedRowDelete(e.target.value)}
                            disabled={allRows.length === 0}
                            style={{
                              width: '100%',
                              padding: '10px 12px',
                              borderRadius: 6,
                              border: '1px solid #fecaca',
                              fontSize: 14,
                              fontFamily: 'inherit',
                              background: '#fff',
                              cursor: allRows.length === 0 ? 'not-allowed' : 'pointer',
                              opacity: allRows.length === 0 ? 0.5 : 1
                            }}
                          >
                            <option value="">-- Select a row --</option>
                            {allRows.map((row) => {
                              const rowLabel = labelColumn && row[labelColumn] ? String(row[labelColumn]) : 'Unnamed';
                              const rowId = row.id || '';
                              return (
                                <option key={rowId} value={rowId}>
                                  {rowLabel}
                                </option>
                              );
                            })}
                          </select>
                        </div>
                        <button
                          type="button"
                          onClick={deleteSelectedRow}
                          disabled={deletingRow || !selectedRowDelete}
                          style={{
                            padding: '10px 16px',
                            borderRadius: 6,
                            border: '1px solid #ef4444',
                            background: selectedRowDelete ? '#fee2e2' : '#f3f4f6',
                            color: selectedRowDelete ? '#b91c1c' : '#9ca3af',
                            cursor: selectedRowDelete && !deletingRow ? 'pointer' : 'not-allowed',
                            fontWeight: 600,
                            fontSize: 14,
                            opacity: selectedRowDelete ? 1 : 0.5,
                            transition: 'all 0.2s'
                          }}
                          onMouseOver={(e) => {
                            if (selectedRowDelete && !deletingRow) {
                              e.currentTarget.style.background = '#fecaca';
                              e.currentTarget.style.borderColor = '#dc2626';
                            }
                          }}
                          onMouseOut={(e) => {
                            if (selectedRowDelete && !deletingRow) {
                              e.currentTarget.style.background = '#fee2e2';
                              e.currentTarget.style.borderColor = '#ef4444';
                            }
                          }}
                        >
                          {deletingRow ? 'Deleting...' : 'Delete Row'}
                        </button>
                      </div>
                      <p style={{ fontSize: 12, color: '#991b1b', marginTop: 12, fontWeight: 500 }}>
                        ⚠️ Warning: Deleting a row cannot be undone.
                      </p>
                    </div>
                  )}
                </div>

                {/* Add New Column - Collapsible */}
                <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
                  <button
                    type="button"
                    onClick={() => setExpandAddColumn(!expandAddColumn)}
                    style={{
                      width: '100%',
                      padding: 20,
                      border: 'none',
                      background: '#fff',
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: 16,
                      fontWeight: 600,
                      color: '#1f2937',
                      transition: 'background-color 0.2s',
                      borderBottom: expandAddColumn ? '1px solid #e5e7eb' : 'none'
                    }}
                    onMouseOver={(e) => e.currentTarget.style.background = '#f9fafb'}
                    onMouseOut={(e) => e.currentTarget.style.background = '#fff'}
                  >
                    <span>➕ Add New Column</span>
                    <span style={{ fontSize: 14, transition: 'transform 0.2s', transform: expandAddColumn ? 'rotate(180deg)' : 'rotate(0deg)' }}>▼</span>
                  </button>
                  {expandAddColumn && (
                    <div style={{ padding: 20, borderTop: '1px solid #e5e7eb' }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
                        <div style={{ minWidth: 220, flex: 1 }}>
                          <label style={{ display: 'block', fontWeight: 600, marginBottom: 6, fontSize: 13, color: '#1f2937' }}>
                            Column name
                          </label>
                          <input
                            type="text"
                            value={newColumnName}
                            onChange={(e) => setNewColumnName(e.target.value)}
                            placeholder="Enter column name"
                            onKeyPress={(e) => e.key === 'Enter' && addColumn()}
                            style={{
                              width: '100%',
                              padding: '10px 12px',
                              borderRadius: 6,
                              border: '1px solid #e5e7eb',
                              fontSize: 14,
                              fontFamily: 'inherit',
                              boxSizing: 'border-box'
                            }}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={addColumn}
                          disabled={addingColumn}
                          className="btn"
                          style={{ padding: '10px 16px' }}
                        >
                          {addingColumn ? 'Adding...' : 'Add Column'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Manage Columns - Collapsible */}
                <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
                  <button
                    type="button"
                    onClick={() => setExpandManageColumns(!expandManageColumns)}
                    style={{
                      width: '100%',
                      padding: 20,
                      border: 'none',
                      background: '#fff',
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: 16,
                      fontWeight: 600,
                      color: '#1f2937',
                      transition: 'background-color 0.2s',
                      borderBottom: expandManageColumns ? '1px solid #e5e7eb' : 'none'
                    }}
                    onMouseOver={(e) => e.currentTarget.style.background = '#f9fafb'}
                    onMouseOut={(e) => e.currentTarget.style.background = '#fff'}
                  >
                    <span>📋 Manage Columns</span>
                    <span style={{ fontSize: 14, transition: 'transform 0.2s', transform: expandManageColumns ? 'rotate(180deg)' : 'rotate(0deg)' }}>▼</span>
                  </button>
                  {expandManageColumns && (
                    <div style={{ padding: 20, borderTop: '1px solid #e5e7eb' }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
                        <div style={{ minWidth: 220 }}>
                          <label style={{ display: 'block', fontWeight: 600, marginBottom: 6, fontSize: 13, color: '#1f2937' }}>
                            Column
                          </label>
                          <select
                            value={selectedColumn}
                            onChange={(e) => {
                              setSelectedColumn(e.target.value);
                              setRenameColumnName('');
                            }}
                            disabled={headers.length === 0}
                            style={{
                              width: '100%',
                              padding: '10px 12px',
                              borderRadius: 6,
                              border: '1px solid #e5e7eb',
                              fontSize: 14
                            }}
                          >
                            {headers.length === 0 && <option>No columns</option>}
                            {headers.map((h) => (
                              <option key={h} value={h}>{h}</option>
                            ))}
                          </select>
                        </div>
                        <div style={{ minWidth: 260 }}>
                          <label style={{ display: 'block', fontWeight: 600, marginBottom: 6, fontSize: 13, color: '#1f2937' }}>
                            Rename to
                          </label>
                          <input
                            type="text"
                            value={renameColumnName}
                            onChange={(e) => setRenameColumnName(e.target.value)}
                            placeholder="New column name"
                            style={{
                              width: '100%',
                              padding: '10px 12px',
                              borderRadius: 6,
                              border: '1px solid #e5e7eb',
                              fontSize: 14,
                              fontFamily: 'inherit'
                            }}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={renameColumn}
                          disabled={renamingColumn || !selectedColumn}
                          className="btn"
                          style={{ padding: '10px 16px' }}
                        >
                          {renamingColumn ? 'Renaming...' : 'Rename Column'}
                        </button>
                        <button
                          type="button"
                          onClick={deleteColumn}
                          disabled={deletingColumn || !selectedColumn}
                          style={{
                            padding: '10px 16px',
                            borderRadius: 6,
                            border: '1px solid #ef4444',
                            background: '#fee2e2',
                            color: '#b91c1c',
                            cursor: 'pointer',
                            fontWeight: 600
                          }}
                        >
                          {deletingColumn ? 'Deleting...' : 'Delete Column'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                {/* Configure Column Data Types - Collapsible */}
                <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
                  <button
                    type="button"
                    onClick={() => setExpandConfigureTypes(!expandConfigureTypes)}
                    style={{
                      width: '100%',
                      padding: 20,
                      border: 'none',
                      background: '#fff',
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: 16,
                      fontWeight: 600,
                      color: '#1f2937',
                      transition: 'background-color 0.2s',
                      borderBottom: expandConfigureTypes ? '1px solid #e5e7eb' : 'none'
                    }}
                    onMouseOver={(e) => e.currentTarget.style.background = '#f9fafb'}
                    onMouseOut={(e) => e.currentTarget.style.background = '#fff'}
                  >
                    <span>⚙️ Configure Column Data Types</span>
                    <span style={{ fontSize: 14, transition: 'transform 0.2s', transform: expandConfigureTypes ? 'rotate(180deg)' : 'rotate(0deg)' }}>▼</span>
                  </button>
                  {expandConfigureTypes && (
                    <div style={{ padding: 20, borderTop: '1px solid #e5e7eb' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
                        {headers.map((header) => {
                          const config = getColumnTypeConfig(header);
                          return (
                            <div key={`${header}-type`} style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 12, background: '#f9fafb' }}>
                              <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 14 }}>{header}</div>
                              <div style={{ display: 'grid', gap: 8 }}>
                                <div>
                                  <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Data Type</label>
                                  <select
                                    value={config.type}
                                    onChange={(e) => saveColumnType(header, e.target.value, config.dropdown)}
                                    style={{
                                      width: '100%',
                                      padding: '6px 8px',
                                      borderRadius: 6,
                                      border: '1px solid #e5e7eb',
                                      fontSize: 13,
                                    }}
                                  >
                                    <option value="auto">Auto (auto-detect)</option>
                                    <option value="text">Text</option>
                                    <option value="number">Number</option>
                                    <option value="date">Date</option>
                                  </select>
                                </div>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                                  <input
                                    type="checkbox"
                                    checked={config.dropdown}
                                    onChange={(e) => saveColumnType(header, config.type, e.target.checked, config.showDuplicates)}
                                    style={{ width: '16px', height: '16px', cursor: 'pointer', flexShrink: 0 }}
                                  />
                                  <span>Enable dropdown for this column</span>
                                </label>
                                {config.dropdown && (
                                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                                    <input
                                      type="checkbox"
                                      checked={config.showDuplicates}
                                      onChange={(e) => saveColumnType(header, config.type, config.dropdown, e.target.checked)}
                                      style={{ width: '16px', height: '16px', cursor: 'pointer', flexShrink: 0 }}
                                    />
                                    <span>Show duplicate values</span>
                                  </label>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Default Label Column - Collapsible */}
                <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
                  <button
                    type="button"
                    onClick={() => setExpandDefaultLabel(!expandDefaultLabel)}
                    style={{
                      width: '100%',
                      padding: 20,
                      border: 'none',
                      background: '#fff',
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: 16,
                      fontWeight: 600,
                      color: '#1f2937',
                      transition: 'background-color 0.2s',
                      borderBottom: expandDefaultLabel ? '1px solid #e5e7eb' : 'none'
                    }}
                    onMouseOver={(e) => e.currentTarget.style.background = '#f9fafb'}
                    onMouseOut={(e) => e.currentTarget.style.background = '#fff'}
                  >
                    <span>🌍 Default Label Column (for all users)</span>
                    <span style={{ fontSize: 14, transition: 'transform 0.2s', transform: expandDefaultLabel ? 'rotate(180deg)' : 'rotate(0deg)' }}>▼</span>
                  </button>
                  {expandDefaultLabel && (
                    <div style={{ padding: 20, borderTop: '1px solid #e5e7eb' }}>
                      <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>
                        Set the column that will be used to display row labels for all users in this organization. Users can still override this with their personal preference.
                      </p>
                      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                        <div style={{ minWidth: 220 }}>
                          <label style={{ display: 'block', fontWeight: 600, marginBottom: 6, fontSize: 13, color: '#1f2937' }}>
                            Select column
                          </label>
                          <select
                            value={defaultLabelColumn}
                            onChange={(e) => {
                              // Just update state, don't auto-save
                              const nextValue = e.target.value;
                              setDefaultLabelColumn(nextValue);
                            }}
                            disabled={headers.length === 0}
                            style={{
                              width: '100%',
                              padding: '10px 12px',
                              borderRadius: 6,
                              border: '1px solid #e5e7eb',
                              fontSize: 13,
                              fontFamily: 'inherit',
                              opacity: headers.length === 0 ? 0.5 : 1,
                              cursor: headers.length === 0 ? 'not-allowed' : 'pointer',
                            }}
                          >
                            <option value="">-- No default --</option>
                            {headers.map((h) => (
                              <option key={h} value={h}>{h}</option>
                            ))}
                          </select>
                        </div>
                        <button
                          type="button"
                          onClick={() => saveDefaultLabelColumn(defaultLabelColumn)}
                          disabled={savingDefaultLabelColumn || headers.length === 0}
                          className="btn"
                          style={{ padding: '10px 16px' }}
                        >
                          {savingDefaultLabelColumn ? 'Saving...' : 'Set Default'}
                        </button>
                      </div>
                      {defaultLabelColumn && (
                        <p style={{ fontSize: 12, color: '#10b981', marginTop: 12, fontWeight: 500 }}>
                          ✓ Default set to: <strong>{defaultLabelColumn}</strong>
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Organize Columns - Collapsible */}
                <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
                  <button
                    type="button"
                    onClick={() => setExpandOrganizeColumns(!expandOrganizeColumns)}
                    style={{
                      width: '100%',
                      padding: 20,
                      border: 'none',
                      background: '#fff',
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: 16,
                      fontWeight: 600,
                      color: '#1f2937',
                      transition: 'background-color 0.2s',
                      borderBottom: expandOrganizeColumns ? '1px solid #e5e7eb' : 'none'
                    }}
                    onMouseOver={(e) => e.currentTarget.style.background = '#f9fafb'}
                    onMouseOut={(e) => e.currentTarget.style.background = '#fff'}
                  >
                    <span>🔀 Organize Columns</span>
                    <span style={{ fontSize: 14, transition: 'transform 0.2s', transform: expandOrganizeColumns ? 'rotate(180deg)' : 'rotate(0deg)' }}>▼</span>
                  </button>
                  {expandOrganizeColumns && (
                    <div style={{ padding: 20, borderTop: '1px solid #e5e7eb' }}>
                      <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>Use the arrows to reorder columns as they appear in the Data Entry tab.</p>
                      <div style={{ display: 'grid', gap: 8 }}>
                        {orderedHeaders.map((col, idx) => (
                          <div key={col} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, background: '#f9fafb', borderRadius: 6, border: '1px solid #e5e7eb' }}>
                            <span style={{ fontSize: 13, fontWeight: 600, minWidth: 24, textAlign: 'center', color: '#9ca3af' }}>{idx + 1}</span>
                            <span style={{ flex: 1, fontWeight: 500 }}>{col}</span>
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button
                                type="button"
                                onClick={() => moveColumn(col, 'up')}
                                disabled={idx === 0}
                                style={{
                                  padding: '6px 10px',
                                  borderRadius: 4,
                                  border: '1px solid #e5e7eb',
                                  background: idx === 0 ? '#f3f4f6' : '#fff',
                                  cursor: idx === 0 ? 'not-allowed' : 'pointer',
                                  opacity: idx === 0 ? 0.5 : 1,
                                  fontSize: 12,
                                }}
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                onClick={() => moveColumn(col, 'down')}
                                disabled={idx === orderedHeaders.length - 1}
                                style={{
                                  padding: '6px 10px',
                                  borderRadius: 4,
                                  border: '1px solid #e5e7eb',
                                  background: idx === orderedHeaders.length - 1 ? '#f3f4f6' : '#fff',
                                  cursor: idx === orderedHeaders.length - 1 ? 'not-allowed' : 'pointer',
                                  opacity: idx === orderedHeaders.length - 1 ? 0.5 : 1,
                                  fontSize: 12,
                                }}
                              >
                                ↓
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Comments Tab */}
            {activeTab === 'comments' && (
              <div style={{ display: 'grid', gap: 20 }}>
                {/* Comments List */}
                <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 20 }}>
                  <h3 style={{ margin: '0 0 16px 0', fontSize: 16, fontWeight: 600 }}>Comments ({comments.length})</h3>
                  {commentsLoading ? (
                    <div style={{ color: '#6b7280', padding: '20px' }}>Loading comments...</div>
                  ) : comments.length === 0 ? (
                    <div style={{ color: '#6b7280', textAlign: 'center', padding: '40px 20px' }}>
                      <div style={{ fontSize: 18, marginBottom: 8 }}>😴 No comments yet</div>
                      <div>Be the first to add a comment below</div>
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gap: 12 }}>
                      {comments.map((comment) => (
                        <div
                          key={comment.id}
                          style={{
                            background: '#f9fafb',
                            border: '1px solid #e5e7eb',
                            borderRadius: 6,
                            padding: 12,
                            position: 'relative',
                          }}
                        >
                          {editingCommentId === comment.id ? (
                            <>
                              <textarea
                                value={editingCommentText}
                                onChange={(e) => setEditingCommentText(e.target.value)}
                                rows={3}
                                style={{
                                  width: '100%',
                                  padding: '8px 10px',
                                  borderRadius: 6,
                                  border: '1px solid #e5e7eb',
                                  marginBottom: 8,
                                  fontSize: 13,
                                  fontFamily: 'inherit',
                                  boxSizing: 'border-box',
                                }}
                              />
                              <div style={{ display: 'flex', gap: 8 }}>
                                <button
                                  className="btn small"
                                  onClick={() => updateComment(comment.id)}
                                  style={{ padding: '6px 12px', fontSize: 12 }}
                                >
                                  Save
                                </button>
                                <button
                                  className="btn small secondary"
                                  onClick={() => { setEditingCommentId(null); setEditingCommentText(''); }}
                                  style={{ padding: '6px 12px', fontSize: 12 }}
                                >
                                  Cancel
                                </button>
                              </div>
                            </>
                          ) : (
                            <>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                                <div style={{ fontSize: 12, color: '#6b7280' }}>
                                  <strong>{comment.createdBy || 'Unknown'}</strong> · {formatCommentDate(comment.createdAt)}
                                </div>
                                <div style={{ display: 'flex', gap: 6 }}>
                                  <button
                                    onClick={() => { setEditingCommentId(comment.id); setEditingCommentText(comment.text); }}
                                    style={{
                                      background: 'none',
                                      border: 'none',
                                      color: '#0ea5e9',
                                      cursor: 'pointer',
                                      fontSize: 12,
                                      fontWeight: 500,
                                      padding: '4px 8px',
                                    }}
                                  >
                                    ✏️ Edit
                                  </button>
                                  <button
                                    onClick={() => deleteComment(comment.id)}
                                    disabled={deletingCommentId === comment.id}
                                    style={{
                                      background: 'none',
                                      border: 'none',
                                      color: '#ef4444',
                                      cursor: 'pointer',
                                      fontSize: 12,
                                      fontWeight: 500,
                                      padding: '4px 8px',
                                      opacity: deletingCommentId === comment.id ? 0.6 : 1,
                                    }}
                                  >
                                    🗑️ Delete
                                  </button>
                                </div>
                              </div>
                              <div style={{ fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                {comment.text || '(empty)'}
                              </div>
                              {comment.attachments && comment.attachments.length > 0 && (
                                <div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
                                  <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 600 }}>Attachments</div>
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                                    {comment.attachments.map((attachment, idx) => (
                                      <div
                                        key={`${comment.id}-att-${idx}`}
                                        style={{
                                          display: 'flex',
                                          alignItems: 'center',
                                          gap: 8,
                                          padding: 8,
                                          borderRadius: 6,
                                          border: '1px solid #e5e7eb',
                                          background: '#fff',
                                          fontSize: 12,
                                        }}
                                      >
                                        <a
                                          href={attachment.url}
                                          target="_blank"
                                          rel="noreferrer"
                                          style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: 8,
                                            textDecoration: 'none',
                                            color: '#111827',
                                            flex: 1,
                                            minWidth: 0,
                                          }}
                                        >
                                          {isImageAttachment(attachment) ? (
                                            <img
                                              src={attachment.url}
                                              alt={attachment.name || 'attachment'}
                                              style={{ width: 72, height: 54, objectFit: 'cover', borderRadius: 4, border: '1px solid #e5e7eb' }}
                                            />
                                          ) : (
                                            <div style={{
                                              width: 72,
                                              height: 54,
                                              borderRadius: 4,
                                              border: '1px solid #e5e7eb',
                                              display: 'flex',
                                              alignItems: 'center',
                                              justifyContent: 'center',
                                              fontWeight: 600,
                                              color: '#6b7280',
                                              background: '#f9fafb',
                                            }}>
                                              FILE
                                            </div>
                                          )}
                                          <div style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                                            <div style={{ fontWeight: 600, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                              {attachment.name || 'Attachment'}
                                            </div>
                                            <div style={{ color: '#6b7280' }}>{formatFileSize(attachment.size)}</div>
                                          </div>
                                        </a>
                                        <button
                                          onClick={() => deleteAttachment(comment.id, idx)}
                                          disabled={deletingAttachmentKey === `${comment.id}-${idx}`}
                                          style={{
                                            border: 'none',
                                            background: 'none',
                                            color: '#ef4444',
                                            cursor: 'pointer',
                                            fontSize: 12,
                                            fontWeight: 600,
                                            padding: '4px 6px',
                                            opacity: deletingAttachmentKey === `${comment.id}-${idx}` ? 0.6 : 1,
                                          }}
                                        >
                                          🗑️
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Add Comment Form */}
                <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 20 }}>
                  <h3 style={{ margin: '0 0 16px 0', fontSize: 16, fontWeight: 600 }}>Add a New Comment</h3>
                  <div style={{ display: 'grid', gap: 12 }}>
                    <textarea
                      value={newCommentText}
                      onChange={(e) => setNewCommentText(e.target.value)}
                      rows={4}
                      placeholder="Share your thoughts, notes, or updates about this row..."
                      style={{
                        width: '100%',
                        padding: '12px',
                        borderRadius: 6,
                        border: '1px solid #e5e7eb',
                        fontSize: 13,
                        fontFamily: 'inherit',
                        boxSizing: 'border-box',
                      }}
                    />
                    <div style={{ display: 'grid', gap: 8 }}>
                      <label style={{ fontSize: 12, color: '#6b7280', fontWeight: 600 }}>Attach files or images</label>
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept={attachmentAccept}
                        onChange={handleFileSelection}
                        style={{ fontSize: 12 }}
                      />
                      {newCommentFilePreviews.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                          {newCommentFilePreviews.map((preview) => (
                            <div
                              key={`${preview.file.name}-${preview.file.size}`}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                padding: 8,
                                border: '1px solid #e5e7eb',
                                borderRadius: 6,
                                background: '#f9fafb',
                                fontSize: 12,
                              }}
                            >
                              {preview.file.type && preview.file.type.startsWith('image/') ? (
                                <img
                                  src={preview.url}
                                  alt={preview.file.name}
                                  style={{ width: 64, height: 48, objectFit: 'cover', borderRadius: 4, border: '1px solid #e5e7eb' }}
                                />
                              ) : (
                                <div style={{
                                  width: 64,
                                  height: 48,
                                  borderRadius: 4,
                                  border: '1px solid #e5e7eb',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontWeight: 600,
                                  color: '#6b7280',
                                  background: '#fff',
                                }}>
                                  FILE
                                </div>
                              )}
                              <div style={{ display: 'grid', gap: 2 }}>
                                <div style={{ fontWeight: 600, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {preview.file.name}
                                </div>
                                <div style={{ color: '#6b7280' }}>{formatFileSize(preview.file.size)}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {Object.keys(uploadProgress).length > 0 && (
                        <div style={{ display: 'grid', gap: 8 }}>
                          {Object.entries(uploadProgress).map(([key, entry]) => (
                            <div key={key} style={{ display: 'grid', gap: 4 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#6b7280' }}>
                                <span style={{ fontWeight: 600 }}>{entry.name || 'Uploading'}</span>
                                <span>{entry.progress || 0}%</span>
                              </div>
                              <div style={{ height: 6, background: '#e5e7eb', borderRadius: 999, overflow: 'hidden' }}>
                                <div
                                  style={{
                                    width: `${entry.progress || 0}%`,
                                    height: '100%',
                                    background: entry.status === 'error' ? '#ef4444' : '#0ea5e9',
                                    transition: 'width 0.2s ease',
                                  }}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <button
                        className="btn"
                        onClick={addComment}
                        disabled={addingComment || (!newCommentText.trim() && newCommentFiles.length === 0)}
                        style={{ padding: '8px 16px' }}
                      >
                        {addingComment ? '⏳ Adding...' : '➕ Add Comment'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default ExcelRowDetail;
