import React, { useEffect, useState } from 'react';
import { db } from '../firebase';
import { collection, getDocs, doc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import './DonorUploader.css';

const CatalogManager = ({ churchId = null, collectionName = 'brands', docId = null, header = null, onSaved = null }) => {
  const [catalogs, setCatalogs] = useState([]);
  const [editing, setEditing] = useState({}); // { id, items: [], newValue: '' }
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!churchId) return;
    const load = async () => {
      try {
        const collRef = collection(db, 'churches', String(churchId), 'catalogs');
        if (docId) {
          const snap = await getDocs(collRef);
          const found = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(d => d.id === docId);
          setCatalogs(found);
          return;
        }
        const snap = await getDocs(collRef);
        const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        // filter to collectionName prefix or header match
        const prefix = `${collectionName}__`;
        let filtered = docs.filter(d => d.id && d.id.startsWith(prefix));
        if (header) {
          filtered = filtered.filter(d => d.header === header || d.id === `${collectionName}__${String(header || '').toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')}`);
        }
        setCatalogs(filtered);
      } catch (err) {
        console.error('Load catalogs error', err);
        setError('Failed to load catalogs.');
      }
    };
    load();
  }, [churchId, collectionName]);

  const startEdit = (id, values) => setEditing({ id, items: (values || []).slice(), newValue: '' });

  const save = async (id) => {
    if (!churchId) return;
    try {
      const values = (editing.items || []).map(s => (s || '').toString().trim()).filter(Boolean);
      await setDoc(doc(db, 'churches', String(churchId), 'catalogs', id), { values, updatedAt: serverTimestamp() }, { merge: true });
      setCatalogs(prev => prev.map(c => c.id === id ? ({ ...c, values }) : c));
      setEditing({});
      if (typeof onSaved === 'function') onSaved(id);
    } catch (err) {
      console.error('Save catalog', err);
      setError('Failed to save catalog.');
    }
  };

  const updateItem = (idx, val) => {
    setEditing(prev => ({ ...(prev || {}), items: (prev.items || []).map((it, i) => i === idx ? val : it) }));
  };

  const deleteItem = (idx) => {
    setEditing(prev => ({ ...(prev || {}), items: (prev.items || []).filter((_, i) => i !== idx) }));
  };

  const addNewItem = () => {
    if (!editing) return;
    const v = (editing.newValue || '').toString().trim();
    if (!v) return;
    setEditing(prev => ({ ...(prev || {}), items: [ ...(prev.items || []), v ], newValue: '' }));
  };

  const remove = async (id) => {
    if (!churchId) return;
    const ok = window.confirm('Delete this catalog? This will remove its list of values.');
    if (!ok) return;
    try {
      await deleteDoc(doc(db, 'churches', String(churchId), 'catalogs', id));
      setCatalogs(prev => prev.filter(c => c.id !== id));
      if (typeof onSaved === 'function') onSaved(id);
    } catch (err) {
      console.error('Delete catalog', err);
      setError('Failed to delete catalog.');
    }
  };

  return (
    <div style={{ width: '100%', marginTop: 12 }}>
      <h3>Catalogs for {collectionName}</h3>
      {error && <div className="error">{error}</div>}
      <div className="table-wrap">
        {catalogs.length === 0 ? (
          <div style={{ padding: 18, color: '#6b7280' }}>No catalogs found for this collection.</div>
        ) : (
          <table className="donor-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Catalog</th>
                <th>Values</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {catalogs.map(c => (
                <tr key={c.id}>
                  <td style={{ verticalAlign: 'top' }}>{c.header} <div style={{ color: '#9ca3af', fontSize: 12 }}>{c.id}</div></td>
                  <td>
                    {editing.id === c.id ? (
                      <div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                          {(editing.items || []).map((it, ii) => (
                            <div key={ii} className="catalog-chip">
                              <input className="catalog-chip-input" value={it} onChange={(e) => updateItem(ii, e.target.value)} />
                              <button className="btn small secondary" onClick={() => deleteItem(ii)} style={{ marginLeft: 6 }}>Del</button>
                            </div>
                          ))}
                        </div>
                        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                          <input placeholder="New value" value={editing.newValue || ''} onChange={(e) => setEditing(prev => ({ ...(prev || {}), newValue: e.target.value }))} style={{ flex: 1, padding: '6px 8px', borderRadius: 6, border: '1px solid #e5e7eb' }} />
                          <button className="btn" onClick={addNewItem}>Add</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {(c.values || []).map((v, i) => (
                          <div key={i} className="catalog-chip">{v}</div>
                        ))}
                      </div>
                    )}
                  </td>
                  <td style={{ whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                    {editing.id === c.id ? (
                      <>
                        <button className="btn small" onClick={() => save(c.id)}>Save</button>
                        <button className="btn small secondary" onClick={() => setEditing({})} style={{ marginLeft: 8 }}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button className="btn small" onClick={() => startEdit(c.id, c.values)}>Edit</button>
                        <button className="btn small secondary" onClick={() => remove(c.id)} style={{ marginLeft: 8 }}>Delete</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default CatalogManager;
