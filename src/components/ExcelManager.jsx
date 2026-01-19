import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db, storage } from '../firebase';
import { collection, doc, setDoc, addDoc, deleteDoc, serverTimestamp, getDocs, writeBatch, getDoc, updateDoc, arrayUnion } from 'firebase/firestore';
import './DonorUploader.css';
import CatalogManager from './CatalogManager';
import ExcelUploader from './ExcelUploader';

const ExcelManager = ({ churchId = null, collectionName = 'brands' }) => {
  const [rows, setRows] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [localSearch, setLocalSearch] = useState('');
  const [preferredHeaders, setPreferredHeaders] = useState([]);
  const [columnTypes, setColumnTypes] = useState({});
  const [catalogs, setCatalogs] = useState({});
  const [catalogDocMap, setCatalogDocMap] = useState({});
  const [selectedCatalogHeader, setSelectedCatalogHeader] = useState(null);
  const [showUploader, setShowUploader] = useState(false);
  const [showCatalogs, setShowCatalogs] = useState(false);
  const [commentsModal, setCommentsModal] = useState({ visible: false, rowId: null, tempId: null });
  const [comments, setComments] = useState([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [newCommentText, setNewCommentText] = useState('');
  const [uploadingComment, setUploadingComment] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState(null);
  const [editingCommentText, setEditingCommentText] = useState('');
  const { user } = useAuth();

  const getPrimaryType = (header) => {
    const v = columnTypes && header ? columnTypes[header] : null;
    if (!v) return 'auto';
    if (typeof v === 'string') return v;
    return v.type || 'auto';
  };

  const saveRow = async (index) => {
    if (!churchId) { setError('Missing churchId'); return; }
    setSavingRow(true);
    try {
      let row = (rows || [])[index];
      // try to locate by id if index lookup failed
      if (!row) row = (rows || []).find(r => r && (r.__tempId === index || r.__id === index));
      if (!row) { setError('Row not found'); return; }

      const collRef = collection(db, `churches/${churchId}/${collectionName}`);

      // prepare payload by converting types
      const payload = {};
      (headers || []).forEach((k) => {
        const primary = getPrimaryType(k);
        const v = row[k];
        if (primary === 'date') {
          if (typeof v === 'string' && v) {
            const parsed = Date.parse(v);
            payload[k] = (!isNaN(parsed)) ? new Date(parsed) : v;
          } else if (v instanceof Date) payload[k] = v;
          else payload[k] = v;
        } else if (primary === 'number') {
          if (v === '' || v === null || v === undefined) payload[k] = null;
          else if (typeof v === 'string') {
            const n = parseFloat(v);
            payload[k] = isNaN(n) ? v : n;
          } else payload[k] = v;
        } else {
          payload[k] = v;
        }
      });

      if (row.__id) {
        const ref = doc(db, `churches/${churchId}/${collectionName}`, row.__id);
        payload.updatedAt = serverTimestamp();
        await setDoc(ref, payload, { merge: true });
        setRows(prev => (prev || []).map(r => (r && r.__id === row.__id) ? { ...r, ...payload } : r));
      } else {
        // new temp row
        const payloadNew = { ...row };
        delete payloadNew.__tempId;
        // convert values similarly
        (headers || []).forEach((k) => {
          const primary = getPrimaryType(k);
          const v = payloadNew[k];
          if (primary === 'date') {
            if (typeof v === 'string' && v) {
              const parsed = Date.parse(v);
              if (!isNaN(parsed)) payloadNew[k] = new Date(parsed);
            }
          } else if (primary === 'number') {
            if (v === '' || v === null || v === undefined) payloadNew[k] = null;
            else if (typeof v === 'string') {
              const n = parseFloat(v);
              payloadNew[k] = isNaN(n) ? v : n;
            }
          }
        });
        const added = await addDoc(collRef, { ...payloadNew, createdAt: serverTimestamp() });
        const savedRow = { __id: added.id, ...payloadNew, createdAt: new Date() };
        setRows(prev => (prev || []).map(r => (r && r.__tempId && r.__tempId === row.__tempId) ? savedRow : r));
        setSortKey(null);
        setCurrentPage(0);
        setEditingCell(null);
        // create an initial creation comment listing non-empty fields and migrate local comments
        try {
          const createdBy = (user && (user.email || user.uid)) || 'anonymous';
          const nonEmpty = (headers || []).filter(k => payloadNew[k] !== undefined && payloadNew[k] !== null && String(payloadNew[k]).trim() !== '');
          const lines = nonEmpty.map(k => `${k}: "${formatValue(payloadNew[k])}"`);
          const text = lines.length ? `Row created with fields:\n${lines.join('\n')}` : 'Row created.';
          await addDoc(collection(db, `churches/${churchId}/${collectionName}/${added.id}/comments`), { text, createdBy, createdAt: serverTimestamp() });
          // migrate any local temp comments for this tempId into the new doc
          if (row.__tempId && window.__excel_local_comments__ && window.__excel_local_comments__[row.__tempId]) {
            const locals = window.__excel_local_comments__[row.__tempId] || [];
            for (const lc of locals) {
              const body = { text: lc.text || null, createdBy: lc.createdBy || createdBy, createdAt: lc.createdAt ? lc.createdAt : serverTimestamp() };
              try { await addDoc(collection(db, `churches/${churchId}/${collectionName}/${added.id}/comments`), body); } catch (e) { /* ignore individual failures */ }
            }
            // clear local store for this tempId
            delete window.__excel_local_comments__[row.__tempId];
          }
        } catch (e) {
          console.error('Failed to write creation comment', e);
        }
      }
    } catch (err) {
      console.error('Save row error', err);
      setError('Failed to save row.');
    } finally {
      setSavingRow(false);
    }
  };

  const isDropdown = (header) => {
    const v = columnTypes && header ? columnTypes[header] : null;
    if (!v) return false;
    if (typeof v === 'string') return v === 'dropdown';
    return !!v.dropdown || v.type === 'dropdown';
  };
  const [editingCell, setEditingCell] = useState(null); // { id: __id or idx, key: header }
  const editingRef = useRef(null);
  useEffect(() => { editingRef.current = editingCell; }, [editingCell]);
  const [editValue, setEditValue] = useState('');
  const [clearing, setClearing] = useState(false);
  const [savingRow, setSavingRow] = useState(false);
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [currentPage, setCurrentPage] = useState(0);
  const PAGE_SIZE = 10;

  const formatValue = (val) => {
    if (val === null || val === undefined) return '';
    // Firestore Timestamp has toDate()
    if (typeof val === 'object') {
      if (val.toDate && typeof val.toDate === 'function') {
        try { return val.toDate().toLocaleString(); } catch (e) { }
      }
      // older shape: { seconds, nanoseconds }
      if (val.seconds !== undefined && val.nanoseconds !== undefined) {
        try { return new Date(val.seconds * 1000).toLocaleString(); } catch (e) { }
      }
      // fallback for objects
      try { return JSON.stringify(val); } catch (e) { return String(val); }
    }
    return String(val);
  };

  const isUrl = (val) => {
    if (!val) return false;
    try {
      const s = typeof val === 'string' ? val : formatValue(val);
      return /^(https?:)?\/\//.test(s) || /^www\./i.test(s);
    } catch (e) { return false; }
  };

  const formatDateOnly = (val, header) => {
    if (!val) return '';
    let d = null;
    const explicit = getPrimaryType(header);
    if (typeof val === 'object') {
      if (val instanceof Date) d = val;
      else if (val.toDate && typeof val.toDate === 'function') {
        try { d = val.toDate(); } catch (e) { }
      } else if (val.seconds !== undefined) {
        try { d = new Date(val.seconds * 1000); } catch (e) { }
      }
    } else {
      if (explicit === 'text') {
        d = null;
      } else if (explicit === 'date') {
        if (typeof val === 'number') {
          try { const ms = (val - 25569) * 86400 * 1000; d = new Date(ms); } catch (e) { }
        } else if (typeof val === 'string') {
          const parsed = Date.parse(val);
          if (!isNaN(parsed)) d = new Date(parsed);
        }
      } else {
        if (typeof val === 'string') {
          const dateLike = /[\/\-T]|[A-Za-z]/.test(val);
          if (dateLike) {
            const parsed = Date.parse(val);
            if (!isNaN(parsed)) d = new Date(parsed);
          }
        }
        if (typeof val === 'number' && header) {
          const skipDateColumns = [2,4,5,11];
          const colIndex = headers && headers.length ? headers.indexOf(header) + 1 : null;
          const isSkipped = colIndex && skipDateColumns.includes(colIndex);
          if (!isSkipped && /date|day|dob|created|timestamp/i.test(header)) {
            try { const ms = (val - 25569) * 86400 * 1000; d = new Date(ms); } catch (e) { }
          }
        }
      }
    }
    if (!d) return formatValue(val);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
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
    return val === null || val === undefined ? '' : String(val);
  };

  const updateCell = (rowIndex, key, value) => {
    setRows(prev => {
      const copy = [...(prev || [])];
      if (rowIndex === undefined || rowIndex === null) return copy;
      // rowIndex may be an index or an id; if it's an id, try to find
      if (typeof rowIndex === 'string' && !copy[rowIndex]) {
        const idx = copy.findIndex(r => r && (r.__tempId === rowIndex || r.__id === rowIndex));
        if (idx === -1) return copy;
        copy[idx] = { ...copy[idx], [key]: value };
        return copy;
      }
      const idx = Number(rowIndex);
      if (!Number.isNaN(idx) && copy[idx]) copy[idx] = { ...copy[idx], [key]: value };
      return copy;
    });
  };

  // Switch to on-demand fetching: only load data when mounted or when an explicit refresh is requested
  const refreshCollection = useCallback(async () => {
    if (!churchId) return;
    try {
      const collRef = collection(db, `churches/${churchId}/${collectionName}`);
      const snapshot = await getDocs(collRef);
      const docs = snapshot.docs.map(d => ({ __id: d.id, ...d.data() }));
      console.log('ExcelManager.refreshCollection loaded', docs.length, 'docs');

      // Determine headers from first doc order, append any others
      let hdrs = [];
      if (snapshot.docs.length > 0) {
        const firstData = snapshot.docs[0].data() || {};
        hdrs = Object.keys(firstData).filter(k => k !== '__id');
      }
      snapshot.docs.forEach(d => {
        Object.keys(d.data() || {}).forEach(k => {
          if (k === '__id') return;
          if (!hdrs.includes(k)) hdrs.push(k);
        });
      });

      // If preferred headers exist, use them (preserve order), append any new keys
      let finalHeaders = hdrs;
      if (preferredHeaders && preferredHeaders.length) {
        const ordered = [];
        preferredHeaders.forEach(k => { if (hdrs.includes(k)) ordered.push(k); });
        hdrs.forEach(k => { if (!ordered.includes(k)) ordered.push(k); });
        finalHeaders = ordered;
      }

      setHeaders(finalHeaders);
      setRows(prevRows => {
        // preserve any unsaved temporary rows (have __tempId)
        const unsaved = (prevRows || []).filter(r => r && r.__tempId);
        const prevById = (prevRows || []).reduce((acc, r, i) => {
          const id = (r && r.__id) ? r.__id : (r && r.__tempId ? r.__tempId : String(i));
          acc[id] = r; return acc;
        }, {});
        const mapped = docs.map((d, i) => {
          const id = d.__id || String(i);
          // if user is editing this row and we have a prior local copy, preserve it
          const editing = editingRef && editingRef.current;
          if (editing && editing.id && id === String(editing.id) && prevById[id]) {
            return prevById[id];
          }
          const obj = {};
          finalHeaders.forEach(h => obj[h] = d[h] !== undefined ? d[h] : '');
          if (d.__id) obj.__id = d.__id;
          return obj;
        });
        return [...unsaved, ...mapped];
      });
    } catch (err) {
      console.error('Load collection error', err);
      setError('Failed to load collection.');
    }
  }, [churchId, collectionName, preferredHeaders]);

  const refreshMetadata = useCallback(async () => {
    if (!churchId) return;
    try {
      const metaRef = doc(db, 'churches', String(churchId), 'collectionMetadata', collectionName);
      const snap = await getDoc(metaRef);
      console.log('ExcelManager.refreshMetadata meta exists?', !!(snap && snap.exists()));
      if (snap && snap.exists()) {
        const data = snap.data() || {};
        const pref = data.headers || [];
        setPreferredHeaders(pref || []);
        setColumnTypes(data.types || {});

        // load any catalogs mapping and fetch catalog docs
        if (data.catalogs) {
          const map = data.catalogs || {};
          setCatalogDocMap(map || {});
          const entries = Object.entries(map).filter(([, docId]) => !!docId);
          const pairs = await Promise.all(entries.map(async ([header, docId]) => {
            try {
              const snapCat = await getDoc(doc(db, 'churches', String(churchId), 'catalogs', docId));
              if (snapCat && snapCat.exists()) {
                const d = snapCat.data() || {};
                return [header, (d.values && d.values.length) ? d.values : []];
              }
            } catch (e) {
              console.error('Failed to fetch catalog', docId, e);
            }
            return [header, []];
          }));
          const catObj = (pairs || []).reduce((acc, [h, vals]) => { acc[h] = vals || []; return acc; }, {});
          setCatalogs(prev => ({ ...(prev || {}), ...catObj }));
        }
      } else {
        setPreferredHeaders([]);
        setColumnTypes({});
      }
    } catch (err) {
      console.error('Failed to load metadata', err);
    }
  }, [churchId, collectionName]);



  const openCommentsForRow = async (row) => {
    if (!row) return;
    setCommentsLoading(true);
    setComments([]);
    try {
      if (row.__id) {
        const collRef = collection(db, `churches/${churchId}/${collectionName}/${row.__id}/comments`);
        const snap = await getDocs(collRef);
        const list = (snap.docs || []).map(d => ({ id: d.id, ...d.data() }));
        list.sort((a, b) => {
          const ta = a.createdAt && a.createdAt.seconds ? a.createdAt.seconds : 0;
          const tb = b.createdAt && b.createdAt.seconds ? b.createdAt.seconds : 0;
          return tb - ta;
        });
        setComments(list);
        setCommentsModal({ visible: true, rowId: row.__id, tempId: null });
      } else if (row.__tempId) {
        const localStore = window.__excel_local_comments__ || {};
        const list = (localStore[row.__tempId] || []).slice().reverse();
        setComments(list);
        setCommentsModal({ visible: true, rowId: null, tempId: row.__tempId });
      }
    } catch (err) {
      console.error('Failed to load comments', err);
      setComments([]);
    } finally {
      setCommentsLoading(false);
    }
  };

  const closeComments = () => {
    setCommentsModal({ visible: false, rowId: null, tempId: null });
    setComments([]);
    setNewCommentText('');
    setEditingCommentId(null);
    setEditingCommentText('');
  };

  const addComment = async () => {
    if (!commentsModal.visible) return;
    const text = (newCommentText || '').trim();
    if (!text) return;
    setUploadingComment(true);
    try {
      const createdBy = (user && (user.email || user.uid)) || 'anonymous';
      const createdAt = serverTimestamp();

      if (commentsModal.rowId) {
        const collRef = collection(db, `churches/${churchId}/${collectionName}/${commentsModal.rowId}/comments`);
        const docRef = await addDoc(collRef, { text: text || null, createdBy, createdAt });
        const saved = { id: docRef.id, text: text || null, createdBy, createdAt: new Date() };
        setComments(prev => [saved, ...(prev || [])]);
      } else if (commentsModal.tempId) {
        window.__excel_local_comments__ = window.__excel_local_comments__ || {};
        window.__excel_local_comments__[commentsModal.tempId] = window.__excel_local_comments__[commentsModal.tempId] || [];
        const localEntry = { id: `local_${Date.now()}`, text: text || null, createdBy, createdAt: new Date() };
        window.__excel_local_comments__[commentsModal.tempId].push(localEntry);
        setComments(prev => [localEntry, ...(prev || [])]);
      }

      setNewCommentText('');
      setEditingCommentId(null);
      setEditingCommentText('');
    } catch (err) {
      console.error('Add comment failed', err);
      alert('Failed to add comment: ' + (err && err.message));
    } finally {
      setUploadingComment(false);
    }
  };

  const editComment = async (commentId, newText) => {
    if (!commentId) return;
    const trimmed = (newText || '').trim();
    if (commentId.startsWith('local_')) {
      const tempId = commentsModal.tempId;
      if (!tempId) return;
      window.__excel_local_comments__ = window.__excel_local_comments__ || {};
      const arr = window.__excel_local_comments__[tempId] || [];
      const idx = arr.findIndex(c => c.id === commentId);
      if (idx !== -1) {
        arr[idx].text = trimmed;
        setComments(prev => prev.map(c => c.id === commentId ? { ...c, text: trimmed } : c));
      }
      return;
    }
    try {
      const ref = doc(db, `churches/${churchId}/${collectionName}/${commentsModal.rowId}/comments`, commentId);
      await updateDoc(ref, { text: trimmed, updatedAt: serverTimestamp() });
      setComments(prev => prev.map(c => c.id === commentId ? { ...c, text: trimmed, updatedAt: new Date() } : c));
      setEditingCommentId(null);
      setEditingCommentText('');
    } catch (err) {
      console.error('Edit comment failed', err);
      alert('Failed to edit comment: ' + (err && err.message));
    }
  };

  const deleteComment = async (commentId) => {
    if (!commentId) return;
    const ok = window.confirm('Delete this comment?');
    if (!ok) return;
    if (commentId.startsWith('local_')) {
      const tempId = commentsModal.tempId;
      if (!tempId) return;
      window.__excel_local_comments__ = window.__excel_local_comments__ || {};
      window.__excel_local_comments__[tempId] = (window.__excel_local_comments__[tempId] || []).filter(c => c.id !== commentId);
      setComments(prev => prev.filter(c => c.id !== commentId));
      return;
    }
    try {
      await deleteDoc(doc(db, `churches/${churchId}/${collectionName}/${commentsModal.rowId}/comments`, commentId));
      setComments(prev => prev.filter(c => c.id !== commentId));
    } catch (err) {
      console.error('Delete comment failed', err);
      alert('Failed to delete comment: ' + (err && err.message));
    }
  };

  useEffect(() => {
    if (!churchId) return;
    setError(null);
    // initial load only
    refreshCollection();
    refreshMetadata();
    // no realtime subscriptions: data will be re-fetched on demand after edits
  }, [churchId, collectionName, refreshCollection, refreshMetadata]);

  const handleCatalogSaved = async (docId) => {
    if (!docId || !churchId) return;
    // find which header maps to this docId
    const header = Object.keys(catalogDocMap || {}).find(k => catalogDocMap[k] === docId);
    if (!header) return;
    try {
      const snap = await getDoc(doc(db, 'churches', String(churchId), 'catalogs', docId));
      if (snap && snap.exists()) {
        const d = snap.data() || {};
        setCatalogs(prev => ({ ...(prev || {}), [header]: (d.values && d.values.length) ? d.values : (prev && prev[header]) || [] }));
      } else {
        setCatalogs(prev => {
          const copy = { ...(prev || {}) };
          delete copy[header];
          return copy;
        });
      }
    } catch (e) {
      console.error('Failed to reload catalog after save', docId, e);
    }
  };

  const addCatalogValue = async (header, value) => {
    if (!header || !value || !churchId) return null;
    try {
      const existingDocId = (catalogDocMap && catalogDocMap[header]) || null;
      if (existingDocId) {
        const catRef = doc(db, 'churches', String(churchId), 'catalogs', existingDocId);
        await updateDoc(catRef, { values: arrayUnion(value), updatedAt: serverTimestamp() });
        // update local cache
        setCatalogs(prev => ({ ...(prev || {}), [header]: Array.from(new Set([...(prev && prev[header]) || [], value])) }));
        return existingDocId;
      }

      // create new catalog doc
      const coll = collection(db, 'churches', String(churchId), 'catalogs');
      const newDoc = await addDoc(coll, { header, values: [value], updatedAt: serverTimestamp() });
      const newDocId = newDoc.id;

      // update metadata mapping for this collection
      try {
        const metaRef = doc(db, 'churches', String(churchId), 'collectionMetadata', collectionName);
        const metaSnap = await getDoc(metaRef);
        const metaData = (metaSnap && metaSnap.exists()) ? (metaSnap.data() || {}) : {};
        const newCatalogs = { ...(metaData.catalogs || {}), [header]: newDocId };
        await setDoc(metaRef, { catalogs: newCatalogs }, { merge: true });
        // update local maps
        setCatalogDocMap(prev => ({ ...(prev || {}), [header]: newDocId }));
        setCatalogs(prev => ({ ...(prev || {}), [header]: [value] }));
      } catch (metaErr) {
        console.error('Failed updating metadata for new catalog', metaErr);
      }

      return newDocId;
    } catch (err) {
      console.error('Failed to add catalog value', err);
      return null;
    }
  };

  const deleteRow = async (index) => {
    console.log('deleteRow called index=', index, 'rowsLen=', rows && rows.length);
    let row = rows[index];
    if (!row) {
      // attempt to find by matching id if index is not valid
      const byId = (rows || []).find((r, i) => (r && (r.__tempId === index || r.__id === index)));
      if (byId) {
        row = byId;
        index = (rows || []).indexOf(byId);
        console.log('deleteRow matched by id, new index=', index);
      }
    }
    if (!row) return;
    const ok = window.confirm('Delete this row?');
    if (!ok) return;
    try {
      if (row.__id) {
        await deleteDoc(doc(db, `churches/${churchId}/${collectionName}`, row.__id));
        // refresh after delete
        await refreshCollection();
      } else {
        // remove locally for unsaved rows
        setRows(prev => prev.filter((_, i) => i !== index));
      }
    } catch (err) {
      console.error('Delete error', err);
      setError('Failed to delete row.');
    }
  };

  const addRow = async () => {
    // ensure metadata/catalogs loaded so new row respects column formats
    try { await refreshMetadata(); } catch (e) { /* ignore */ }
    // avoid creating multiple unsaved temp rows: if one exists, focus it
    if (rows && rows.some(r => r && r.__tempId)) {
      const first = rows.find(r => r && r.__tempId);
      if (first) {
        setSortKey(null);
        setCurrentPage(0);
        setSearch(''); setLocalSearch('');
        setEditValue(first[headers && headers[0] ? headers[0] : ''] || '');
        setEditingCell({ id: first.__tempId, key: headers && headers[0] ? headers[0] : 'name' });
        return;
      }
    }
    // add new empty row at the top, reset search/page and open first cell for editing
    if (!headers || headers.length === 0) {
      setHeaders(['name']);
      const newRow = { name: '' };
      setRows(prev => [newRow, ...(prev || [])]);
      setSortKey(null);
      setCurrentPage(0);
      setSearch(''); setLocalSearch('');
      setEditValue('');
      setEditingCell({ id: 0, key: 'name' });
      return;
    }
    const empty = {};
    headers.forEach(h => {
      // initialize according to known column type
      const primary = getPrimaryType(h);
      if (primary === 'number') empty[h] = '';
      else if (primary === 'date') empty[h] = '';
      else empty[h] = '';
    });
    const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    empty.__tempId = tempId;
    setRows(prev => [empty, ...(prev || [])]);
    setSortKey(null);
    setCurrentPage(0);
    setSearch(''); setLocalSearch('');
    setEditValue(empty[headers[0]] || '');
    setEditingCell({ id: tempId, key: headers[0] });
  };

  const discardTempRows = () => {
    setRows(prev => (prev || []).filter(r => !(r && r.__tempId)));
    setEditingCell(null);
    setEditValue('');
  };

  const clearAll = async () => {
    if (!churchId) { setError('Pass churchId to clear data'); return; }
    const ok = window.confirm(`Delete ALL rows from ${collectionName}? This cannot be undone.`);
    if (!ok) return;
    setClearing(true);
    setError(null);
    try {
      const collRef = collection(db, `churches/${churchId}/${collectionName}`);
      const snapshot = await getDocs(collRef);
      const docs = snapshot.docs || [];
      const CHUNK = 500;
      for (let i = 0; i < docs.length; i += CHUNK) {
        const batch = writeBatch(db);
        docs.slice(i, i + CHUNK).forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
      // remove metadata doc as well
      try { await deleteDoc(doc(db, 'churches', String(churchId), 'collectionMetadata', collectionName)); } catch (metaErr) { /* ignore */ }
      setRows([]);
      setHeaders([]);
    } catch (err) {
      console.error('Clear all error', err);
      setError('Failed to clear collection.');
    }
    setClearing(false);
  };

  // keep original index for each row so actions map to the correct document
  const filtered = rows.map((r, idx) => ({ r, idx })).filter(({ r }) => {
    if (!search) return true;
    const s = search.toString().toLowerCase();
    return headers.some(h => formatValue(r[h]).toLowerCase().includes(s));
  });

  const compareValues = (a, b) => {
    if (a === undefined || a === null) return -1;
    if (b === undefined || b === null) return 1;
    // numeric
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    const na = parseFloat(a);
    const nb = parseFloat(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    // dates
    const da = Date.parse(a);
    const db = Date.parse(b);
    if (!isNaN(da) && !isNaN(db)) return da - db;
    // string
    return String(a).localeCompare(String(b));
  };

  const sorted = React.useMemo(() => {
    if (!sortKey) return filtered;
    const copy = [...filtered];
    copy.sort((A, B) => {
      const a = formatValue(A.r[sortKey]);
      const b = formatValue(B.r[sortKey]);
      const cmp = compareValues(a, b);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

  // reset page when filtered set changes
  useEffect(() => {
    setCurrentPage(0);
  }, [sorted.length]);

  // Cleanup accidental duplicate temp rows (if multiple temp rows appear, keep only the first)
  useEffect(() => {
    if (!rows || rows.length === 0) return;
    const temps = rows.filter(r => r && r.__tempId);
    if (temps.length > 1) {
      setRows(prev => {
        let kept = false;
        const out = [];
        for (const r of prev) {
          if (r && r.__tempId) {
            if (!kept) { out.push(r); kept = true; }
            // skip subsequent temp rows
          } else {
            out.push(r);
          }
        }
        return out;
      });
    }
  }, [rows]);

  // Debounce the search input so typing is smooth and doesn't trigger expensive updates immediately
  useEffect(() => {
    const t = setTimeout(() => setSearch(localSearch), 300);
    return () => clearTimeout(t);
  }, [localSearch]);

  const totalPages = Math.max(1, Math.ceil((sorted && sorted.length) / PAGE_SIZE));
  const paged = (sorted || []).slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  return (
    <div style={{ width: '100%', marginTop: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>Manage {collectionName}</h2>
          <div style={{ display: 'flex', gap: 8 }}>
          <input
            placeholder="Search..."
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            onBlur={() => setSearch(localSearch)}
            style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #e5e7eb' }}
          />
          <button className="btn" onClick={addRow} disabled={savingRow}>Add Row</button>
          {(rows && rows.some(r => r && r.__tempId)) ? (
            <button className="btn secondary small" onClick={discardTempRows} title="Remove unsaved draft">Discard Draft</button>
          ) : null}
          <button className="btn" onClick={async () => { setError(null); await refreshCollection(); await refreshMetadata(); }} style={{ marginLeft: 4 }}>Refresh</button>
          <button className="btn secondary" onClick={clearAll} disabled={clearing} style={{ marginLeft: 8 }}>{clearing ? 'Clearing...' : 'Clear All'}</button>
        </div>
      </div>

      {/* CatalogManager and Uploader sections are rendered below the table via toggles */}

      {error && <div className="error">{error}</div>}

      <div className="table-wrap">
        {filtered.length === 0 ? (
          <div style={{ padding: 24, color: '#6b7280' }}>No rows to display.</div>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ color: '#6b7280', fontSize: 13 }}>
                Showing {Math.min(1 + currentPage * PAGE_SIZE, (sorted || []).length || 0)} - {Math.min((currentPage + 1) * PAGE_SIZE, (sorted || []).length || 0)} of {(sorted || []).length || 0}
              </div>
              <div />
            </div>
            <table className="donor-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th style={{ width: 40 }}></th>
                {headers.map(h => (
                  <th key={h} style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => {
                    if (sortKey === h) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
                    else { setSortKey(h); setSortDir('asc'); }
                  }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div>{h} {sortKey === h ? (sortDir === 'asc' ? '▲' : '▼') : ''}</div>
                      </div>
                      {isDropdown(h) && collectionName !== 'brands' ? (
                        <div>
                          <button className="btn small" onClick={(e) => { e.stopPropagation(); setShowCatalogs(true); setSelectedCatalogHeader(h); }}>Manage</button>
                        </div>
                      ) : null}
                    </div>
                  </th>
                ))}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
                {paged.map(({ r, idx }, i) => {
                  const rowKey = r && r.__id ? r.__id : (r && r.__tempId ? r.__tempId : (idx || i));
                  return (
                    <tr key={rowKey}>
                      <td style={{ textAlign: 'center' }}>
                        <button title="Comments" className="btn small" onClick={() => openCommentsForRow(r)}>💬</button>
                      </td>
                      {headers.map((h) => {
                        const isEditing = editingCell && editingCell.id === rowKey && editingCell.key === h;
                        return (
                          <td key={h}>
                            {isEditing ? (
                              isDropdown(h) ? (
                                <select
                                  className="cell-input"
                                  autoFocus
                                  value={editValue}
                                  onChange={async (e) => {
                                    const v = e.target.value;
                                    if (v === '__add_new__') {
                                      // prompt for new catalog value
                                      const newVal = window.prompt(`Add new value to ${h}:`);
                                      if (newVal && newVal.trim()) {
                                        const trimmed = newVal.trim();
                                        const docId = await addCatalogValue(h, trimmed);
                                        if (docId) {
                                          // set the cell to the newly added value
                                          setEditValue(trimmed);
                                          updateCell(idx, h, trimmed);
                                        } else {
                                          // failed to add, keep previous
                                          setEditValue(editValue);
                                        }
                                      } else {
                                        // reset selection
                                        setEditValue(editValue);
                                      }
                                    } else {
                                      setEditValue(v);
                                      updateCell(idx, h, v);
                                    }
                                  }}
                                >
                                  <option value="">--</option>
                                  {(catalogs[h] || []).map((opt) => (
                                    <option key={opt} value={opt}>{opt}</option>
                                  ))}
                                  <option value="__add_new__">+ Add new...</option>
                                </select>
                              ) : (
                                (() => {
                                  const primary = getPrimaryType(h);
                                  if (primary === 'date') {
                                    return (
                                      <input
                                        type="date"
                                        className="cell-input"
                                        autoFocus
                                        value={editValue}
                                        onChange={(e) => { setEditValue(e.target.value); updateCell(idx, h, e.target.value); }}
                                        onBlur={() => { updateCell(idx, h, editValue); setEditingCell(null); }}
                                      />
                                    );
                                  }
                                  if (primary === 'number') {
                                    return (
                                      <input
                                        type="number"
                                        className="cell-input"
                                        autoFocus
                                        value={editValue}
                                        onChange={(e) => { setEditValue(e.target.value); updateCell(idx, h, e.target.value); }}
                                        onBlur={() => { updateCell(idx, h, editValue); setEditingCell(null); }}
                                      />
                                    );
                                  }
                                  return (
                                    <input
                                      className="cell-input"
                                      autoFocus
                                      value={editValue}
                                      onChange={(e) => setEditValue(e.target.value)}
                                      onBlur={() => {
                                        updateCell(idx, h, editValue);
                                        setEditingCell(null);
                                      }}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') e.currentTarget.blur();
                                        else if (e.key === 'Escape') {
                                          setEditValue(rows[idx] ? (rows[idx][h] || '') : '');
                                          setEditingCell(null);
                                        }
                                      }}
                                    />
                                  );
                                })()
                              )
                            ) : (
                              isUrl(r[h]) ? (
                                <a className="cell-view" href={typeof r[h] === 'string' ? r[h] : formatValue(r[h])} target="_blank" rel="noreferrer">link</a>
                              ) : (
                                <div
                                  className="cell-view"
                                  onClick={() => {
                                    const rowKeyInner = (r && r.__id) ? r.__id : (r && r.__tempId ? r.__tempId : idx);
                                    setEditingCell({ id: rowKeyInner, key: h });
                                    setEditValue(isDropdown(h) ? (rows[idx] ? (rows[idx][h] || '') : '') : formatValue(r[h]));
                                  }}
                                >
                                  {(() => {
                                    const maybeDate = formatDateOnly(r[h], h);
                                    return maybeDate === formatValue(r[h]) ? formatValue(r[h]) : maybeDate;
                                  })()}
                                </div>
                              )
                            )}
                          </td>
                        );
                      })}
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button className="btn small" onClick={() => saveRow(idx)} disabled={savingRow}>Save</button>
                        <button className="btn small secondary" onClick={() => deleteRow(idx)} style={{ marginLeft: 8 }}>Delete</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
          </table>
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <button className="btn small" onClick={() => setCurrentPage(p => Math.max(0, p - 1))} disabled={currentPage <= 0}>Prev</button>
            <div style={{ fontSize: 13 }}>{currentPage + 1} / {totalPages}</div>
            <button className="btn small" onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))} disabled={currentPage >= totalPages - 1}>Next</button>
          </div>
          
          </>
        )}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 12 }}>
          <button className="btn" onClick={() => { setShowUploader(s => !s); setShowCatalogs(false); }}>Upload</button>
          <button className="btn" onClick={() => { setShowCatalogs(s => !s); setShowUploader(false); }}>Manage Catalogs</button>
        </div>

        {showUploader ? (
          <div style={{ marginTop: 12 }}>
            <ExcelUploader churchId={churchId} collectionName={collectionName} />
          </div>
        ) : null}

        {showCatalogs ? (
          <div style={{ marginTop: 12 }}>
            <CatalogManager
              churchId={churchId}
              collectionName={collectionName}
              docId={selectedCatalogHeader ? (catalogDocMap && catalogDocMap[selectedCatalogHeader]) : null}
              header={selectedCatalogHeader}
              onSaved={handleCatalogSaved}
            />
            <div style={{ marginTop: 8 }}>
              <button className="btn" onClick={() => { setShowCatalogs(false); setSelectedCatalogHeader(null); }}>Close catalogs</button>
            </div>
          </div>
        ) : null}
        {commentsModal.visible ? (
          <div className="comments-modal">
            <div className="comments-panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0 }}>Comments</h3>
                <button className="btn small" onClick={closeComments}>Close</button>
              </div>
              <div style={{ marginTop: 8, maxHeight: 320, overflow: 'auto' }}>
                {commentsLoading ? <div>Loading...</div> : (
                  (comments && comments.length) ? comments.map(c => (
                    <div key={c.id} style={{ borderBottom: '1px solid #eee', padding: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ fontSize: 12, color: '#666' }}>{c.createdBy || 'unknown'} • {c.createdAt && c.createdAt.toDate ? c.createdAt.toDate().toLocaleString() : (c.createdAt && c.createdAt.seconds ? new Date(c.createdAt.seconds * 1000).toLocaleString() : (c.createdAt ? String(c.createdAt) : ''))}</div>
                        <div>
                          {(user && (user.email === c.createdBy || user.uid === c.createdBy)) || (user && user.isAdmin) ? (
                            <>
                              <button className="btn small" onClick={() => { setEditingCommentId(c.id); setEditingCommentText(c.text || ''); }}>Edit</button>
                              <button className="btn small secondary" style={{ marginLeft: 8 }} onClick={() => deleteComment(c.id)}>Delete</button>
                            </>
                          ) : null}
                        </div>
                      </div>
                      <div style={{ marginTop: 6 }}>
                        {editingCommentId === c.id ? (
                          <div>
                            <textarea value={editingCommentText} onChange={(e) => setEditingCommentText(e.target.value)} style={{ width: '100%', minHeight: 80 }} />
                            <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
                              <button className="btn small" onClick={() => editComment(c.id, editingCommentText)}>Save</button>
                              <button className="btn small secondary" onClick={() => { setEditingCommentId(null); setEditingCommentText(''); }}>Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <div>{c.text}</div>
                        )}
                      </div>
                    </div>
                  )) : <div style={{ color: '#666' }}>No comments yet.</div>
                )}
              </div>
              <div style={{ marginTop: 8 }}>
                <textarea placeholder="Add a comment..." value={newCommentText} onChange={(e) => setNewCommentText(e.target.value)} style={{ width: '100%', minHeight: 80 }} />
                <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                  <button className="btn" onClick={addComment} disabled={uploadingComment}>{uploadingComment ? 'Adding...' : 'Add Comment'}</button>
                  <button className="btn secondary" onClick={closeComments}>Cancel</button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default ExcelManager;
