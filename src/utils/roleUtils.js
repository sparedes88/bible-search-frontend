export const parseMultiAssign = (str) => {
  if (!str) return [];
  const parts = str.toString().split(/[;,\/]+/).map(s => s.trim()).filter(Boolean);
  return parts.map(p => {
    // support formats: "Name|50" or "Name:50%" or "Name|50%"
    const m = p.match(/^(.+?)[|:](\s*\d+(?:\.\d+)?)(?:%?)$/);
    if (m) {
      return { name: m[1].trim(), pct: Number(m[2]) };
    }
    // plain name
    return { name: p, pct: undefined };
  });
};

export const encodeMultiAssign = (arr) => {
  if (!arr || arr.length === 0) return '';
  const anyPct = arr.some(i => typeof i.pct === 'number' && !isNaN(i.pct));
  if (!anyPct) return arr.map(i => i.name).join(', ');
  return arr.map(i => `${i.name}|${Number(i.pct)}`).join('; ');
};

export const normalizePercents = (arr) => {
  // arr: [{name, pct?}]
  const result = arr.map(i => ({ ...i }));
  const hasPct = result.some(i => typeof i.pct === 'number' && !isNaN(i.pct));
  if (!hasPct) return result;
  let total = result.reduce((s, it) => s + (Number(it.pct) || 0), 0);
  if (total === 0) {
    // make equal
    const equal = 100 / result.length;
    return result.map(it => ({ ...it, pct: equal }));
  }
  // normalize to 100
  return result.map(it => ({ ...it, pct: ((Number(it.pct) || 0) / total) * 100 }));
};
