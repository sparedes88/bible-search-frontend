import React, { useMemo } from 'react';

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

const DonationHistogram = ({ donors = [], ranges = defaultRanges, labels = {} }) => {
  const counts = useMemo(() => {
    const c = ranges.map(r => ({ ...r, count: 0 }));
    donors.forEach(d => {
      const amt = toNumber(d.totalDonated);
      for (let i = 0; i < c.length; i++) {
        const r = c[i];
        if (amt >= r.min && amt < r.max) {
          c[i].count += 1;
          break;
        }
      }
    });
    return c;
  }, [donors, ranges]);

  const total = counts.reduce((s, r) => s + r.count, 0);
  const maxCount = Math.max(1, ...counts.map(r => r.count));

  return (
    <div className="donation-histogram">
      <div className="dh-header">
        <strong>Donation distribution</strong>
        <span className="dh-total">Total donors: {total}</span>
      </div>
      <div className="dh-bars">
        {counts.map((r) => (
          <div className="dh-row" key={r.key}>
            <div className="dh-label">{labels[r.key] || r.key}</div>
            <div className="dh-bar-wrap">
              <div className="dh-bar" style={{ width: `${(r.count / maxCount) * 100}%` }} />
            </div>
            <div className="dh-count">{r.count}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default DonationHistogram;
