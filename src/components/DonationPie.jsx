import React, { useMemo, useState, useEffect } from 'react';

const defaultRanges = [
  { key: '0-1k', min: 0, max: 1000 },
  { key: '1k-2k', min: 1000, max: 2000 },
  { key: '2k-5k', min: 2000, max: 5000 },
  { key: '5k-7k', min: 5000, max: 7000 },
  { key: '7k-15k', min: 7000, max: 15000 },
  { key: '15k+', min: 15000, max: Infinity }
];

const toNumber = (v) => {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  const s = v.toString().replace(/[^0-9.-]+/g, '');
  return Number(s) || 0;
};

const colors = ['#059669', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4', '#6B7280'];

function getContrastColor(hex) {
  if (!hex) return '#fff';
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16) / 255;
  const g = parseInt(h.substring(2, 4), 16) / 255;
  const b = parseInt(h.substring(4, 6), 16) / 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.6 ? '#000' : '#fff';
}

function polarToCartesian(cx, cy, r, angleRad) {
  return {
    x: cx + r * Math.cos(angleRad),
    y: cy + r * Math.sin(angleRad)
  };
}

function arcPath(cx, cy, r, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, r, startAngle);
  const end = polarToCartesian(cx, cy, r, endAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
}

function formatCurrency(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

const DonationPie = ({ donors = [], ranges = defaultRanges, size = 340, outerPadding = 60, churchId = null, labels = {}, saveLabels, showLegend = true }) => {
  const counts = useMemo(() => {
    const c = ranges.map(r => ({ ...r, count: 0, total: 0 }));
    donors.forEach(d => {
      const amt = toNumber(d.totalDonated);
      for (let i = 0; i < c.length; i++) {
        const r = c[i];
        if (amt >= r.min && amt < r.max) {
          c[i].count += 1;
          c[i].total += amt;
          break;
        }
      }
    });
    return c;
  }, [donors, ranges]);

  const total = counts.reduce((s, r) => s + r.count, 0);

  const initialLabels = useMemo(() => {
    const map = {};
    ranges.forEach(r => { map[r.key] = r.key; });
    return map;
  }, [ranges]);

  const [localLabels, setLocalLabels] = useState(() => ({ ...initialLabels, ...labels }));
  const [saving, setSaving] = useState(false);
  const [editMode, setEditMode] = useState(false);

  useEffect(() => {
    setLocalLabels({ ...initialLabels, ...labels });
  }, [labels, initialLabels]);

  const doSave = async () => {
    if (!saveLabels) return alert('Save handler not provided');
    setSaving(true);
    try {
      await saveLabels(localLabels);
      setSaving(false);
      alert('Labels saved');
      setEditMode(false);
    } catch (err) {
      console.error('Save labels error', err);
      setSaving(false);
      alert('Error saving labels');
    }
  };

  const cx = size / 2;
  const cy = size / 2;
  const r = Math.max(12, Math.min(cx, cy) - outerPadding);

  let angle = -Math.PI / 2; // start at top

  return (
    <div className={`donation-pie ${editMode ? 'editing' : ''}`}>
      {editMode ? (
        <div className="dp-labels">
          {ranges.map((r, i) => (
            <div className="dp-label-row" key={r.key}>
              <label className="dp-label-key">{r.key}</label>
              <input className="dp-label-input" value={localLabels[r.key] || ''} onChange={e => setLocalLabels(l => ({ ...l, [r.key]: e.target.value }))} />
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn" onClick={doSave} disabled={saving}>{saving ? 'Saving...' : 'Save Labels'}</button>
            <button className="btn secondary" onClick={() => { setLocalLabels({ ...initialLabels, ...labels }); setEditMode(false); }} disabled={saving}>Cancel</button>
          </div>
        </div>
      ) : (
        <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {showLegend && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <strong>Labels</strong>
              <div className="dp-legend" style={{ display: 'flex', gap: 8 }}>
                {ranges.map((r, i) => (
                  <div className="dp-legend-row" key={r.key} style={{ alignItems: 'center' }}>
                    <span className="dp-swatch" style={{ background: colors[i % colors.length] }} />
                    <span className="dp-label">{(labels && labels[r.key]) || r.key}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div>
            <button className="btn" onClick={() => setEditMode(true)}>Edit Labels</button>
          </div>
        </div>
      )}
      <div className="dp-main">
        <div className="dp-svg">
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} overflow="visible" style={{ overflow: 'visible' }}>
            <defs>
              <marker id="donation-arrow" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto" markerUnits="strokeWidth">
                <path d="M0,0 L12,6 L0,12 L3,6 z" fill="currentColor" />
              </marker>
            </defs>
            {total === 0 ? (
              <circle cx={cx} cy={cy} r={r} stroke="#e5e7eb" strokeWidth="10" fill="none" />
            ) : (
              counts.map((c, i) => {
                if (c.count === 0) return null;
                const sliceAngle = (c.count / total) * Math.PI * 2;
                const start = angle;
                const end = angle + sliceAngle;
                const d = arcPath(cx, cy, r, start, end);
                const mid = start + sliceAngle / 2;
                const lp = polarToCartesian(cx, cy, r * 0.6, mid);
                const percent = Math.round((c.count / Math.max(1, total)) * 100);
                const startPoint = polarToCartesian(cx, cy, r * 0.95, mid);
                // use half the previous large margin so labels sit past arrow tips
                const margin = 70;
                const endPointRaw = polarToCartesian(cx, cy, r + margin, mid);
                const endPoint = {
                  x: Math.max(12, Math.min(size - 12, endPointRaw.x)),
                  y: Math.max(12, Math.min(size - 12, endPointRaw.y))
                };
                const labelText = (labels && labels[c.key]) || c.key;
                const fill = colors[i % colors.length];
                const textAnchorSide = endPoint.x > cx ? 'start' : 'end';
                const textX = endPoint.x + (endPoint.x > cx ? 14 : -14);
                const textY = endPoint.y;
                angle = end;
                return (
                  <g key={c.key}>
                    <path d={d} fill={fill} stroke="#fff" strokeWidth="1" />
                    {/* connector line with arrow (longer) */}
                    <polyline points={`${startPoint.x},${startPoint.y} ${endPoint.x},${endPoint.y}`} fill="none" stroke={fill} strokeWidth="2" markerEnd="url(#donation-arrow)" style={{ color: fill }} />
                    {/* endpoint marker only (labels shown in right-side legend) */}
                    {percent > 0 && (
                      <g>
                        <circle cx={endPoint.x} cy={endPoint.y} r={6} fill={fill} stroke="#fff" strokeWidth={1} />
                        {/* percent text at arrow tip */}
                        {(() => {
                          const dx = endPoint.x - cx;
                          const dy = endPoint.y - cy;
                          const len = Math.sqrt(dx * dx + dy * dy) || 1;
                          const ux = dx / len;
                          const uy = dy / len;
                          const offset = 32; // push percent further out from endpoint (halved)
                          // perpendicular vector to push label off the connector so arrow doesn't sit underneath
                          const perpX = -uy;
                          const perpY = ux;
                          const perpSign = endPoint.x > cx ? -1 : 1;
                          let pctX = endPoint.x + ux * offset + perpX * perpSign * 12;
                          let pctY = endPoint.y + uy * offset + perpY * perpSign * 6;
                          const edgePad = 0;
                          const pctAnchor = pctX > cx ? 'start' : 'end';
                          const pctStr = `${percent}%`;
                          const estW = Math.max(28, pctStr.length * 8 + 8);
                          let rectX = pctAnchor === 'start' ? pctX - 8 : pctX - estW + 8;
                          const rectY = pctY - 10;
                          return (
                            <g>
                              <rect x={rectX} y={rectY} width={estW} height={20} rx={6} fill="#ffffff" stroke="#e5e7eb" />
                              <text x={pctX} y={pctY} textAnchor={pctAnchor} dominantBaseline="middle" fontSize={12} fill="#111827" style={{ fontWeight: 700 }}>
                                {pctStr}
                              </text>
                            </g>
                          );
                        })()}
                        <title>{labelText} - {percent}%</title>
                      </g>
                    )}
                  </g>
                );
              })
            )}
            {total > 0 && (
              <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fontSize="16" fill="#ffffff" fontWeight={700}>{total}</text>
            )}
          </svg>
        </div>

        <div className="dp-legend dp-legend-right">
          {counts.map((c, i) => (
            <div className="dp-legend-row" key={c.key}>
              <span className="dp-swatch" style={{ background: colors[i % colors.length] }} />
              <span className="dp-label">{(labels && labels[c.key]) || c.key}</span>
              <span className="dp-num">{c.count}</span>
              <span className="dp-amount">{formatCurrency(c.total)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default DonationPie;
