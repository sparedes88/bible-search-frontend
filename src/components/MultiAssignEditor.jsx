import React, { useState, useMemo } from 'react';
import { parseMultiAssign, encodeMultiAssign } from '../utils/roleUtils';

const MultiAssignEditor = ({ open, onClose, options = [], value = '', title = 'Assign', onSave }) => {
  const parsed = useMemo(() => parseMultiAssign(value), [value]);
  const initial = useMemo(() => {
    const map = new Map();
    parsed.forEach(p => map.set(p.name, { name: p.name }));
    return options.map(o => ({ name: typeof o === 'string' ? o : o.name, selected: map.has(typeof o === 'string' ? o : o.name) }));
  }, [options, parsed]);

  const [items, setItems] = useState(initial);

  React.useEffect(() => setItems(initial), [value, options]);

  const toggle = (i) => {
    setItems(prev => {
      const copy = prev.slice();
      copy[i] = { ...copy[i], selected: !copy[i].selected };
      return copy;
    });
  };

  const handleSave = () => {
    const selected = items.filter(i => i.selected).map(i => ({ name: i.name }));
    if (selected.length === 0) {
      onSave('');
      onClose();
      return;
    }
    onSave(encodeMultiAssign(selected));
    onClose();
  };

  if (!open) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1300 }}>
      <div style={{ width: '90%', maxWidth: 680, maxHeight: '90%', overflow: 'auto', background: '#fff', padding: 16, borderRadius: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h4 style={{ margin: 0 }}>{title}</h4>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn secondary" onClick={() => { onClose(); }}>Close</button>
          </div>
        </div>

        <div style={{ display: 'grid', gap: 8 }}>
          {items.map((it, i) => (
            <div key={it.name} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={!!it.selected} onChange={() => toggle(i)} />
                <span>{it.name}</span>
              </label>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button className="btn" onClick={handleSave}>Save</button>
          <button className="btn secondary" onClick={() => onClose()}>Cancel</button>
        </div>
      </div>
    </div>
  );
};

export default MultiAssignEditor;
