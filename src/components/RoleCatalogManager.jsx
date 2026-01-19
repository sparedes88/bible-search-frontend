import React, { useEffect, useState, useMemo } from 'react';
import { db } from '../firebase';
import './RoleCatalogManager.css';
import { collection, query, orderBy, onSnapshot, doc, setDoc } from 'firebase/firestore';

const emptyCatalog = { serving: [], connecting: [], discipleship: [], attending: [] };

const RoleCatalogManager = ({ churchId, onClose }) => {
  const [donors, setDonors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [catalogs, setCatalogs] = useState(emptyCatalog);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (!churchId) return;
    const q = query(collection(db, `churches/${churchId}/donors`), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      setDonors(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, [churchId]);

  useEffect(() => {
    if (!churchId) return;
    const ref = doc(db, `churches/${churchId}/donorSettings`, 'roleCatalogs');
    const unsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) setCatalogs({ ...emptyCatalog, ...snap.data() });
      else setCatalogs(emptyCatalog);
    }, () => setCatalogs(emptyCatalog));
    return () => unsub();
  }, [churchId]);

  const disciplerOptions = useMemo(() => {
    const s = new Set();
    donors.forEach(d => {
      ['discipler','serving','connecting','discipleship','attending'].forEach(field => {
        const raw = (d[field] || '').toString().trim();
        if (!raw) return;
        raw.split(/[;,\/|]+/).map(x => x.trim()).filter(Boolean).forEach(name => s.add(name));
      });
    });
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [donors]);

  const handleAddItem = (cat, name) => {
    if (!name || !name.trim()) return;
    setCatalogs(c => ({ ...c, [cat]: [...c[cat], { name: name.trim(), disciplers: [] }] }));
  };

  const handleDeleteItem = (cat, idx) => {
    setCatalogs(c => ({ ...c, [cat]: c[cat].filter((_, i) => i !== idx) }));
  };

  const handleChangeItemName = (cat, idx, name) => {
    setCatalogs(c => {
      const copy = c[cat].slice();
      copy[idx] = { ...copy[idx], name };
      return { ...c, [cat]: copy };
    });
  };

  const toggleDisciplerForItem = (cat, idx, name) => {
    setCatalogs(c => {
      const copy = c[cat].slice();
      const item = { ...copy[idx] };
      const arr = new Set(item.disciplers || []);
      if (arr.has(name)) arr.delete(name); else arr.add(name);
      item.disciplers = Array.from(arr);
      copy[idx] = item;
      return { ...c, [cat]: copy };
    });
  };

  const handleSave = async () => {
    if (!churchId) return;
    setSaving(true);
    try {
      const ref = doc(db, `churches/${churchId}/donorSettings`, 'roleCatalogs');
      await setDoc(ref, catalogs, { merge: true });
      setSaving(false);
      if (onClose) onClose();
    } catch (err) {
      console.error('Error saving role catalogs', err);
      alert('Error saving role catalogs');
      setSaving(false);
    }
  };

  const CatalogSection = ({ catKey, title }) => (
    <div style={{ marginBottom: 18 }}>
      <h4 style={{ margin: '6px 0' }}>{title}</h4>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
        <input className="add-input" placeholder={`Add ${title} item`} id={`add-${catKey}`} style={{ padding: 8, borderRadius: 6, border: '1px solid #e5e7eb' }} />
        <button className="btn add-button" onClick={() => {
          const el = document.getElementById(`add-${catKey}`);
          if (!el) return;
          handleAddItem(catKey, el.value);
          el.value = '';
        }}>Add</button>
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        {catalogs[catKey] && catalogs[catKey].map((it, idx) => (
          <div key={`${catKey}-${idx}`} style={{ padding: 8, borderRadius: 6, border: '1px solid #e5e7eb', background: '#fff' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input value={it.name} onChange={e => handleChangeItemName(catKey, idx, e.target.value)} style={{ flex: 1, padding: 6 }} />
              <button className="btn secondary" onClick={() => handleDeleteItem(catKey, idx)}>Delete</button>
            </div>
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 13, color: '#374151', marginBottom: 6 }}>Assign disciplers</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {disciplerOptions.filter(n => n.toLowerCase().includes(filter.toLowerCase())).map(name => {
                  const checked = (it.disciplers || []).includes(name);
                  return (
                    <label key={name} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input type="checkbox" checked={checked} onChange={() => toggleDisciplerForItem(catKey, idx, name)} />
                      <span style={{ fontSize: 13 }}>{name}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="role-catalog-manager" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 99999 }}>
      <div style={{ width: '90%', maxWidth: 920, maxHeight: '90%', overflow: 'auto', background: '#f9fafb', padding: 18, borderRadius: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Role Catalogs</h3>
          <div style={{ display: 'flex', gap: 8 }}>
            <input placeholder="Filter disciplers..." value={filter} onChange={e => setFilter(e.target.value)} style={{ padding: 8, borderRadius: 6, border: '1px solid #e5e7eb' }} />
            <button className="btn" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
            <button className="btn secondary" onClick={() => onClose && onClose()}>Close</button>
          </div>
        </div>

        <CatalogSection catKey="serving" title="Serving" />
        <CatalogSection catKey="connecting" title="Connecting" />
        <CatalogSection catKey="discipleship" title="Discipleship" />
        <CatalogSection catKey="attending" title="Attending" />
        <div style={{ marginTop: 12, color: '#6b7280', fontSize: 13 }}>Changes are saved under <strong>churches/{churchId}/donorSettings/roleCatalogs</strong>.</div>
      </div>
    </div>
  );
};

export default RoleCatalogManager;
