import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { db } from '../firebase';
import { collection, writeBatch, doc, serverTimestamp, getDocs, setDoc, deleteDoc, addDoc, onSnapshot } from 'firebase/firestore';
import './DonorUploader.css';

const ExcelUploader = ({ churchId = null, collectionName = 'brands' }) => {
  const [rows, setRows] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [headerTypes, setHeaderTypes] = useState({});
  const [savedHeaderTypes, setSavedHeaderTypes] = useState({});
  const [savedCatalogs, setSavedCatalogs] = useState({});
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [uploadSummary, setUploadSummary] = useState(null);
  const [collapsedAfterSave, setCollapsedAfterSave] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [isFileUploaded, setIsFileUploaded] = useState(false);
  const [liveRows, setLiveRows] = useState([]);
  const [editingRow, setEditingRow] = useState(null);
  const PREVIEW_COUNT = 7; // show first N rows in preview
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [useRichest, setUseRichest] = useState(false);

  const handleFile = async (e) => {
    setError(null);
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const name = file.name || '';
      const ext = name.split('.').pop().toLowerCase();
      let workbook;
      if (ext === 'csv' || file.type === 'text/csv') {
        const txt = await file.text();
        workbook = XLSX.read(txt, { type: 'string' });
      } else {
        try {
          const data = await file.arrayBuffer();
          workbook = XLSX.read(data, { type: 'array' });
        } catch (innerErr) {
          const txt = await file.text();
          workbook = XLSX.read(txt, { type: 'string' });
        }
      }

      if (!workbook || !workbook.SheetNames || workbook.SheetNames.length === 0) {
        throw new Error('Workbook contains no sheets');
      }

      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const rangeRef = worksheet && worksheet['!ref'];
      if (!rangeRef) {
        throw new Error('Worksheet is empty');
      }

      const range = XLSX.utils.decode_range(rangeRef);
      const headerRow = range.s.r;
      const headerCols = [];

      for (let c = range.s.c; c <= range.e.c; c += 1) {
        const headerCell = worksheet[XLSX.utils.encode_cell({ r: headerRow, c })];
        const headerName = String(headerCell?.w ?? headerCell?.v ?? '').trim();
        if (headerName) {
          headerCols.push({ c, header: headerName });
        }
      }

      if (!headerCols.length) {
        throw new Error('No header row found in worksheet');
      }

      const parsedRows = [];
      for (let r = headerRow + 1; r <= range.e.r; r += 1) {
        const rowObj = {};
        let hasValue = false;

        headerCols.forEach(({ c, header }) => {
          const cell = worksheet[XLSX.utils.encode_cell({ r, c })];
          const hyperlinkTarget = cell?.l?.Target;
          const rawValue = hyperlinkTarget || (cell?.w ?? cell?.v ?? '');
          const normalizedValue = rawValue === undefined || rawValue === null ? '' : String(rawValue);

          rowObj[header] = normalizedValue;
          if (normalizedValue.trim() !== '') {
            hasValue = true;
          }
        });

        if (hasValue) {
          parsedRows.push(rowObj);
        }
      }

      const json = parsedRows;

      // collect headers (preserve worksheet order)
      const hdrs = headerCols.map(({ header }) => header);
      setHeaders(hdrs);
      // default header types to savedHeaderTypes (from metadata) or existing headerTypes or 'auto'
      const types = {};
      hdrs.forEach(h => {
        const saved = savedHeaderTypes && savedHeaderTypes[h];
        if (saved && typeof saved === 'object') {
          types[h] = { ...(saved || {}) };
        } else if (saved && typeof saved === 'string') {
          if (saved === 'dropdown') types[h] = { type: 'auto', dropdown: true };
          else types[h] = { type: saved, dropdown: false };
        } else if (headerTypes && headerTypes[h]) {
          const cur = headerTypes[h];
          if (typeof cur === 'string') types[h] = { type: cur, dropdown: false };
          else types[h] = { ...(cur || {}) };
        } else {
          types[h] = { type: 'auto', dropdown: false };
        }
      });
      setHeaderTypes(types);
      setShowPreview(true);
      setIsFileUploaded(true);
      setRows(json.map(r => {
        const normalized = {};
        hdrs.forEach(h => normalized[h] = r[h] !== undefined ? r[h] : '');
        return normalized;
      }));
    } catch (err) {
      console.error('Excel parse error:', err);
      setError(`Error parsing file: ${err && err.message ? err.message : 'Invalid Excel/CSV file.'}`);
    }
  };

  const formatValue = (val) => {
    if (val === null || val === undefined) return '';
    if (typeof val === 'object') {
      if (val.toDate && typeof val.toDate === 'function') {
        try { return val.toDate().toLocaleString(); } catch (e) { }
      }
      if (val.seconds !== undefined && val.nanoseconds !== undefined) {
        try { return new Date(val.seconds * 1000).toLocaleString(); } catch (e) { }
      }
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

  const handleTypeChange = (header, val) => {
    setHeaderTypes(prev => ({ ...prev, [header]: { ...(prev[header] || {}), type: val } }));
  };

  const handleDropdownToggle = (header, checked) => {
    setHeaderTypes(prev => ({ ...prev, [header]: { ...(prev[header] || {}), dropdown: !!checked } }));
  };

  const getPrimaryType = (header) => {
    const v = headerTypes && header ? headerTypes[header] : null;
    if (!v) return 'auto';
    if (typeof v === 'string') return v;
    return v.type || 'auto';
  };

  const isDropdown = (header) => {
    const v = headerTypes && header ? headerTypes[header] : null;
    if (!v) return false;
    if (typeof v === 'string') return v === 'dropdown';
    return !!v.dropdown || v.type === 'dropdown';
  };

  const formatDateOnly = (val, header) => {
    if (!val) return '';
    let d = null;
    // respect explicit header type selection (if provided)
    const explicit = getPrimaryType(header);
    if (typeof val === 'object') {
      if (val instanceof Date) {
        d = val;
      } else if (val.toDate && typeof val.toDate === 'function') {
        try { d = val.toDate(); } catch (e) { }
      } else if (val.seconds !== undefined) {
        try { d = new Date(val.seconds * 1000); } catch (e) { }
      }
    } else {
      // if user forced text, skip parsing
      if (explicit === 'text') {
        d = null;
      } else if (explicit === 'date') {
        // force numeric -> excel serial conversion
        if (typeof val === 'number') {
          try { const ms = (val - 25569) * 86400 * 1000; d = new Date(ms); } catch (e) { }
        } else if (typeof val === 'string') {
          const parsed = Date.parse(val);
          if (!isNaN(parsed)) d = new Date(parsed);
        }
      } else {
        // auto mode: detect strings that look like dates
        if (typeof val === 'string') {
          const dateLike = /[\/-T]|[A-Za-z]/.test(val);
          if (dateLike) {
            const parsed = Date.parse(val);
            if (!isNaN(parsed)) d = new Date(parsed);
          }
        }
        // numeric -> excel serial conversion when header suggests date and not skipped
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

  const updateCell = (rowIndex, key, value) => {
    setRows(prev => {
      const copy = [...prev];
      copy[rowIndex] = { ...copy[rowIndex], [key]: value };
      return copy;
    });
  };

  const getColumnOptions = (header) => {
    if (!rows || rows.length === 0) return [];
    const vals = Array.from(new Set(rows.map(r => (r && r[header] !== undefined && r[header] !== null) ? String(r[header]).trim() : '').filter(Boolean)));
    return vals.sort();
  };

  const compareValues = (a, b) => {
    if (a === undefined || a === null) return -1;
    if (b === undefined || b === null) return 1;
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    const na = parseFloat(a);
    const nb = parseFloat(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    const da = Date.parse(a);
    const db = Date.parse(b);
    if (!isNaN(da) && !isNaN(db)) return da - db;
    return String(a).localeCompare(String(b));
  };

  // sortedRows is an array of { r: rowObject, idx: originalIndex }
  const sortedRows = React.useMemo(() => {
    const arr = rows.map((r, idx) => ({ r, idx }));
    if (!sortKey) return arr;
    arr.sort((A, B) => {
      const a = formatValue(A.r[sortKey]);
      const b = formatValue(B.r[sortKey]);
      const cmp = compareValues(a, b);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  const richestRows = React.useMemo(() => {
    if (!rows || rows.length === 0) return [];
    const scored = rows.map((r, idx) => {
      let count = 0;
      headers.forEach(h => { if (r[h] !== undefined && r[h] !== null && String(r[h]).trim() !== '') count++; });
      return { r, idx, count };
    });
    scored.sort((a, b) => b.count - a.count);
    return scored.map(s => ({ r: s.r, idx: s.idx }));
  }, [rows, headers]);

  // Subscribe to Firestore collection for live updates
  useEffect(() => {
    if (!churchId) return;
    setError(null);
    const collRef = collection(db, `churches/${churchId}/${collectionName}`);
    const unsub = onSnapshot(collRef, (snapshot) => {
      const docs = snapshot.docs.map(d => ({ __id: d.id, ...d.data() }));
      const hdrs = Array.from(new Set(docs.flatMap(d => Object.keys(d).filter(k => k !== '__id'))));
      setLiveRows(docs.map(d => {
        const obj = {};
        hdrs.forEach(h => obj[h] = d[h] !== undefined ? d[h] : '');
        if (d.__id) obj.__id = d.__id;
        return obj;
      }));
      // only update uploader headers when no file is currently uploaded
      if (!isFileUploaded && hdrs.length && headers.length === 0) {
        setHeaders(hdrs);
      }
    }, (err) => {
      console.error('Realtime load error', err);
      setError('Failed to subscribe to Firebase collection.');
    });

    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [churchId, collectionName]);

  // Subscribe to metadata for saved header types
  useEffect(() => {
    if (!churchId) return;
    const metaRef = doc(db, 'churches', String(churchId), 'collectionMetadata', collectionName);
    const unsubMeta = onSnapshot(metaRef, (snap) => {
      if (snap && snap.exists()) {
        const data = snap.data() || {};
        if (data.types) {
          setSavedHeaderTypes(data.types || {});
          // if headers already loaded, merge saved types into headerTypes
          if (headers && headers.length) {
            setHeaderTypes(prev => {
              const merged = {};
              headers.forEach(h => {
                const src = (data.types && data.types[h]) || prev[h] || 'auto';
                if (src && typeof src === 'object') merged[h] = { ...(src || {}) };
                else if (src && typeof src === 'string') {
                  if (src === 'dropdown') merged[h] = { type: 'auto', dropdown: true };
                  else merged[h] = { type: src, dropdown: false };
                } else merged[h] = { type: 'auto', dropdown: false };
              });
              return merged;
            });
          }
        }
        if (data.catalogs) {
          setSavedCatalogs(data.catalogs || {});
        }
      }
    }, (err) => {
      // ignore
    });
    return () => { if (unsubMeta) unsubMeta(); };
  }, [churchId, collectionName]);

  const addRow = () => {
    if (!headers || headers.length === 0) {
      // initialize a default empty header set
      setHeaders(['column1']);
      setRows([{ column1: '' }]);
      return;
    }
    const empty = {};
    headers.forEach(h => empty[h] = '');
    setRows(prev => [...prev, empty]);
  };

  const deleteRow = async (index) => {
    const row = rows[index];
    const ok = window.confirm('Delete this row? This will remove it locally and from Firebase if already saved.');
    if (!ok) return;
    // If has __id, delete from Firebase immediately
    if (row && row.__id) {
      try {
        await deleteDoc(doc(db, `churches/${churchId}/${collectionName}`, row.__id));
      } catch (err) {
        console.error('Delete error', err);
        setError('Failed to delete from Firebase.');
        return;
      }
    }
    // remove locally
    setRows(prev => prev.filter((_, i) => i !== index));
  };

  const saveRow = async (index) => {
    if (!churchId) { setError('Pass `churchId` to save.'); return; }
    const row = rows[index];
    if (!row) return;
    setError(null);
    try {
      const collRef = collection(db, `churches/${churchId}/${collectionName}`);
      if (row.__id) {
        const ref = doc(collRef, row.__id);
        const payload = { ...row };
        delete payload.__id;
        payload.updatedAt = serverTimestamp();
        await setDoc(ref, payload, { merge: true });
      } else {
        const added = await addDoc(collRef, { ...row, createdAt: serverTimestamp() });
        // update local row with new id
        setRows(prev => {
          const copy = [...prev];
          copy[index] = { ...copy[index], __id: added.id };
          return copy;
        });
      }
    } catch (err) {
      console.error('Save row error', err);
      setError('Failed to save row to Firebase.');
    }
  };

  const handleSave = async () => {
    if (!churchId) { setError('Pass `churchId` to save to Firebase.'); return; }
    if (!rows || rows.length === 0) { setError('No rows to save.'); return; }
    if (rows.length > 1000) {
      const ok = window.confirm('Saving more than 1000 rows may hit Firestore limits. Continue?');
      if (!ok) return;
    }

    // Hide preview immediately and proceed to upload all rows (upsert semantics)
    setShowPreview(false);
    setSaving(true);
    setError(null);

    try {
      const collRef = collection(db, `churches/${churchId}/${collectionName}`);

      // load existing docs to attempt matching
      const existingSnap = await getDocs(collRef);
      const existing = existingSnap.docs.map(d => ({ id: d.id, data: d.data() }));

      // determine key field to match existing rows; prefer id, uid, email, name
      const keyField = headers.find(h => /^(id|uid|email|key|identifier|code|slug)$/i.test(h)) || headers.find(h => /name/i.test(h));
      const existingIndex = {};
      if (keyField) {
        existing.forEach(d => {
          const val = d.data && d.data[keyField];
          if (val !== undefined && val !== null && String(val).trim() !== '') existingIndex[String(val).trim()] = d.id;
        });
      }

      // chunked commits
      const CHUNK = 400;
      let created = 0, updated = 0;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const batch = writeBatch(db);
        const slice = rows.slice(i, i + CHUNK);
        for (const r of slice) {
          const payload = { ...r };
          delete payload.__id;
          payload.updatedAt = serverTimestamp();

          // determine target id
          let targetId = null;
          if (r.__id) targetId = r.__id;
          else if (keyField && r[keyField] && existingIndex[String(r[keyField]).trim()]) targetId = existingIndex[String(r[keyField]).trim()];

          if (targetId) {
            const ref = doc(collRef, targetId);
            batch.set(ref, payload, { merge: true });
            updated++;
          } else {
            const ref = doc(collRef);
            payload.createdAt = serverTimestamp();
            batch.set(ref, payload);
            created++;
          }
        }
        await batch.commit();
      }
      // save column order metadata and catalogs for dropdown columns
      try {
        const catalogsMap = {};
        const sanitize = (s) => String(s || '').toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '').slice(0, 60);
        for (const h of headers) {
          if (isDropdown(h)) {
            const vals = Array.from(new Set(rows.map(r => (r[h] !== undefined && r[h] !== null ? String(r[h]).trim() : '')).filter(Boolean)));
            const values = vals.sort();
            const docId = `${collectionName}__${sanitize(h)}`;
            try {
              await setDoc(doc(db, 'churches', String(churchId), 'catalogs', docId), {
                header: h,
                values,
                updatedAt: serverTimestamp(),
              });
              catalogsMap[h] = docId;
            } catch (cErr) {
              console.error('Failed to write catalog for', h, cErr);
            }
          }
        }

        if (headers && headers.length) {
          await setDoc(doc(db, 'churches', String(churchId), 'collectionMetadata', collectionName), {
            headers,
            types: headerTypes || {},
            catalogs: catalogsMap,
            updatedAt: serverTimestamp(),
          });
        }
      } catch (metaErr) {
        console.error('Failed to write metadata', metaErr);
      }

      setUploadSummary({ created: created || 0, updated: updated || 0 });
      setCollapsedAfterSave(true);
    } catch (err) {
      console.error('Save error', err);
      setError('Error saving to Firebase. Check permissions and network.');
    }

    setSaving(false);
    // after successful save, clear uploaded-file state and rows so preview won't show
    setIsFileUploaded(false);
    setRows([]);
  };

  return (
    <div className="donor-uploader" style={{ width: '100%' }}>
      <h3>Upload Excel ({collectionName})</h3>
      <p className="muted">Upload an Excel file and edit any column before saving to Firebase.</p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
        {collapsedAfterSave && uploadSummary ? (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div>Last upload: <strong>{uploadSummary.updated}</strong> updated, <strong>{uploadSummary.created}</strong> created.</div>
            <button className="btn" onClick={() => { setCollapsedAfterSave(false); setUploadSummary(null); setHeaders([]); setHeaderTypes(savedHeaderTypes || {}); }}>Upload another file</button>
          </div>
        ) : (
          <>
            <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} />
            <button className="btn" onClick={addRow}>Add Row</button>
            <button className="btn secondary" onClick={() => setUseRichest(s => !s)} style={{ marginLeft: 8 }}>{useRichest ? 'Showing richest' : 'Show richest rows'}</button>
          </>
        )}
      </div>

      {error && <div className="error">{error}</div>}

      {isFileUploaded && showPreview && (
        <div className="preview">
          <h4>Preview ({rows.length} rows)</h4>
          <div className="table-wrap">
            {rows.length === 0 ? (
              <div style={{ padding: 24, color: '#6b7280' }}>
                Uploaded file contains no rows.
              </div>
            ) : (
              <table className="donor-table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    {headers.map(h => (
                      <th key={h} style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => {
                        if (sortKey === h) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
                        else { setSortKey(h); setSortDir('asc'); }
                      }}>
                        {h} {sortKey === h ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                      </th>
                    ))}
                    <th key="actions">Actions</th>
                  </tr>
                  <tr>
                    {headers.map(h => (
                      <th key={h + '-type'} style={{ paddingTop: 4, paddingBottom: 4 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <select value={(headerTypes[h] && headerTypes[h].type) || 'auto'} onChange={(e) => handleTypeChange(h, e.target.value)} style={{ padding: '4px' }}>
                            <option value="auto">Auto</option>
                            <option value="text">Text</option>
                            <option value="number">Number</option>
                            <option value="date">Date</option>
                            <option value="url">URL</option>
                          </select>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }} title="Make this column a dropdown catalog">
                            <input type="checkbox" checked={isDropdown(h)} onChange={(e) => handleDropdownToggle(h, e.target.checked)} />
                            <span style={{ fontSize: 12 }}>Dropdown</span>
                          </label>
                        </div>
                      </th>
                    ))}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(useRichest ? richestRows : sortedRows).slice(0, PREVIEW_COUNT).map(({ r, idx }, i) => (
                        <tr key={idx || i}>
                          {headers.map(h => (
                            <td key={h}>
                              {editingRow === idx ? (
                                isDropdown(h) ? (
                                  <select className="cell-input" style={{ width: '100%' }} value={r[h] || ''} onChange={(e) => updateCell(idx, h, e.target.value)}>
                                    <option value="">--</option>
                                    {getColumnOptions(h).map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                  </select>
                                ) : (
                                  <input className="cell-input" style={{ width: '100%' }} value={r[h] || ''} onChange={(e) => updateCell(idx, h, e.target.value)} />
                                )
                              ) : (
                                isUrl(r[h]) ? (
                                  <a className="cell-view" href={typeof r[h] === 'string' ? r[h] : formatValue(r[h])} target="_blank" rel="noreferrer">link</a>
                                ) : (
                                <div className="cell-view">{(() => {
                                  const maybeDate = formatDateOnly(r[h], h);
                                  return maybeDate === formatValue(r[h]) ? formatValue(r[h]) : maybeDate;
                                })()}</div>
                              )
                              )}
                            </td>
                          ))}
                          <td style={{ whiteSpace: 'nowrap' }}>
                            {editingRow === idx ? (
                              <>
                                <button className="btn small" onClick={() => { saveRow(idx); setEditingRow(null); }}>Save</button>
                                <button className="btn small secondary" onClick={() => setEditingRow(null)} style={{ marginLeft: 8 }}>Cancel</button>
                              </>
                            ) : (
                              <>
                                <button className="btn small" onClick={() => setEditingRow(idx)}>Edit</button>
                                <button className="btn small secondary" onClick={() => deleteRow(idx)} style={{ marginLeft: 8 }}>Delete</button>
                              </>
                            )}
                          </td>
                        </tr>
                      ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Upsert behavior: always update existing and create new if no match. */}
          {collapsedAfterSave && uploadSummary ? (
            <div style={{ padding: 12, background: '#f9fafb', borderRadius: 6, marginBottom: 12 }}>
              <div style={{ marginBottom: 8 }}>Upload summary: <strong>{uploadSummary.updated}</strong> updated, <strong>{uploadSummary.created}</strong> created.</div>
              <button className="btn" onClick={() => { setCollapsedAfterSave(false); setUploadSummary(null); setHeaders([]); setHeaderTypes(savedHeaderTypes || {}); }}>Upload another file</button>
            </div>
          ) : null}

          <div className="actions" style={{ marginTop: 12 }}>
            {churchId ? (
              <button className="btn" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save to Firebase'}</button>
            ) : (
              <div className="note">To save, pass <strong>churchId</strong> as prop.</div>
            )}
            <button className="btn secondary" onClick={() => { setRows([]); setHeaders([]); setError(null); setIsFileUploaded(false); }}>Clear</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExcelUploader;
