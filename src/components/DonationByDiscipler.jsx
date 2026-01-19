import React, { useMemo } from 'react';

const PALETTE = [
  '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b',
  '#e377c2', '#7f7f7f', '#17becf', '#393b79', '#637939', '#8c6d31'
];

const buildColorMap = (names) => {
  const n = names.length;
  if (n === 0) return {};
  // If names fit in palette, spread them using a fixed step to avoid nearby palette indices
  if (n <= PALETTE.length) {
    const step = 5; // co-prime with PALETTE.length=12
    // derive a stable start from the concatenated names
    let seed = 0;
    for (const nm of names) for (let i = 0; i < nm.length; i++) seed = seed + nm.charCodeAt(i);
    seed = Math.abs(seed) % PALETTE.length;
    const map = {};
    names.slice().sort().forEach((name, i) => {
      const idx = (seed + i * step) % PALETTE.length;
      map[name] = PALETTE[idx];
    });
    return map;
  }

  // Otherwise generate n evenly spaced HSL colors for good separation
  const map = {};
  names.slice().sort().forEach((name, i) => {
    const h = Math.round((i * 360) / n);
    map[name] = `hsl(${h} 70% 45%)`;
  });
  return map;
};

const DonationByDiscipler = ({ donors = [], limit = 20 }) => {
  const groups = useMemo(() => {
    const map = {};
    donors.forEach(d => {
      const raw = (d.discipler || 'Unassigned').toString().trim() || 'Unassigned';
      const parts = raw.split(/[;,\/|]+/).map(s => s.trim()).filter(Boolean);
      // detect percent annotations like Name|50 or Name:50%
      const parsed = parts.map(p => {
        const m = p.match(/^(.+?)[|:](\s*\d+(?:\.\d+)?)(?:%?)$/);
        if (m) return { name: m[1].trim(), pct: Number(m[2]) };
        return { name: p, pct: undefined };
      });
      const amt = Number(d.totalDonated) || 0;
      const hasPct = parsed.some(x => typeof x.pct === 'number' && !isNaN(x.pct));
      if (hasPct) {
        let totalPct = parsed.reduce((s, x) => s + (Number(x.pct) || 0), 0) || 1;
        parsed.forEach(x => {
          const share = amt * ((Number(x.pct) || 0) / totalPct);
          const countShare = ((Number(x.pct) || 0) / totalPct);
          if (!map[x.name]) map[x.name] = { name: x.name, count: 0, total: 0 };
          map[x.name].count += countShare;
          map[x.name].total += share;
        });
      } else {
        const n = parsed.length || 1;
        parsed.forEach(x => {
          const share = amt / n;
          const countShare = 1 / n;
          if (!map[x.name]) map[x.name] = { name: x.name, count: 0, total: 0 };
          map[x.name].count += countShare;
          map[x.name].total += share;
        });
      }
    });
    const names = Object.keys(map).sort();
    const colorMap = buildColorMap(names);
    const arr = Object.values(map).map(g => ({ ...g, color: colorMap[g.name] || '#888' })).sort((a, b) => b.total - a.total);
    return arr.slice(0, limit);
  }, [donors, limit]);

  const max = groups.reduce((m, g) => Math.max(m, g.total), 0) || 1;

  return (
    <div className="discipler-chart">
      <h4>Giving by Discipler</h4>
      <div className="discipler-rows">
        {groups.length === 0 && <div className="muted">No data</div>}
        {groups.map((g) => (
          <div className="discipler-row" key={g.name}>
            <div className="discipler-meta">
              <div className="discipler-name">{g.name}</div>
              <div className="discipler-count">{Number.isInteger(g.count) ? g.count : (Math.round(g.count * 10) / 10)}</div>
            </div>
            <div className="discipler-bar-wrap">
              <div className="discipler-bar" style={{ width: `${(g.total / max) * 100}%`, background: g.color }} />
              <div className="discipler-value">{g.total.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default DonationByDiscipler;
