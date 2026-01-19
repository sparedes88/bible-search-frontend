import React, { useEffect, useState } from 'react';

const splitNames = (str) => {
  if (!str) return [];
  return str.toString().split(/[;,\/|]+/).map(s => s.trim()).filter(Boolean);
};

const RoleSection = ({ label, value = '', options = [], onChange }) => {
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState(new Set(splitNames(value)));

  useEffect(() => setSelected(new Set(splitNames(value))), [value]);

  const toggle = (name) => {
    setSelected(s => {
      const copy = new Set(Array.from(s));
      if (copy.has(name)) copy.delete(name); else copy.add(name);
      const out = Array.from(copy).join(', ');
      onChange(out);
      return copy;
    });
  };

  const onAdd = (v) => {
    const name = (v || '').toString().trim();
    if (!name) return;
    setSelected(s => {
      const copy = new Set(Array.from(s));
      copy.add(name);
      const out = Array.from(copy).join(', ');
      onChange(out);
      return copy;
    });
  };

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>{label}</div>
      <input placeholder="Filter..." value={filter} onChange={e => setFilter(e.target.value)} style={{ padding: 8, borderRadius: 6, border: '1px solid #e5e7eb', width: '100%', marginBottom: 8 }} />
      <div style={{ maxHeight: 200, overflow: 'auto', border: '1px solid #eef2f7', padding: 8, borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {(options || []).map(opt => typeof opt === 'string' ? opt : opt.name).filter(o => o.toLowerCase().includes(filter.toLowerCase())).map(opt => (
          <label key={opt} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={selected.has(opt)} onChange={() => toggle(opt)} />
            <span style={{ fontSize: 13 }}>{opt}</span>
          </label>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <input placeholder="Add custom..." onKeyDown={e => { if (e.key === 'Enter') { onAdd(e.target.value); e.target.value = ''; } }} style={{ flex: 1, padding: 8, borderRadius: 6, border: '1px solid #e5e7eb' }} />
      </div>
    </div>
  );
};

const RoleFieldsModal = ({ open, onClose, donorId, fields = {}, roleCatalogs = {}, churchId, db, docFn, updateFn }) => {
  const [local, setLocal] = useState({
    discipler: '', serving: '', connecting: '', discipleship: '', attending: ''
  });

  useEffect(() => {
    setLocal({
      discipler: fields.discipler || '',
      serving: fields.serving || '',
      connecting: fields.connecting || '',
      discipleship: fields.discipleship || '',
      attending: fields.attending || ''
    });
  }, [fields, open]);

  if (!open) return null;

  const handleSave = async () => {
    try {
      if (!donorId) {
        onClose();
        return;
      }
      const ref = docFn(db, `churches/${churchId}/donors`, donorId);
      await updateFn(ref, {
        discipler: local.discipler || '',
        serving: local.serving || '',
        connecting: local.connecting || '',
        discipleship: local.discipleship || '',
        attending: local.attending || ''
      });
      onClose();
    } catch (err) {
      console.error('Error saving roles', err);
      alert('Error saving roles');
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200000 }}>
      <div style={{ width: '90%', maxWidth: 860, maxHeight: '90%', overflow: 'auto', background: '#fff', padding: 16, borderRadius: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Edit Roles</h3>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn secondary" onClick={() => onClose()}>Close</button>
            <button className="btn" onClick={handleSave}>Save</button>
          </div>
        </div>

        <RoleSection label="Disciplers" value={local.discipler} options={roleCatalogs.discipleship || roleCatalogs.discipler || []} onChange={v => setLocal(l => ({ ...l, discipler: v }))} />
        <RoleSection label="Serving" value={local.serving} options={roleCatalogs.serving || []} onChange={v => setLocal(l => ({ ...l, serving: v }))} />
        <RoleSection label="Connecting" value={local.connecting} options={roleCatalogs.connecting || []} onChange={v => setLocal(l => ({ ...l, connecting: v }))} />
        <RoleSection label="Discipleship" value={local.discipleship} options={roleCatalogs.discipleship || []} onChange={v => setLocal(l => ({ ...l, discipleship: v }))} />
        <RoleSection label="Attending" value={local.attending} options={roleCatalogs.attending || []} onChange={v => setLocal(l => ({ ...l, attending: v }))} />
      </div>
    </div>
  );
};

export default RoleFieldsModal;
