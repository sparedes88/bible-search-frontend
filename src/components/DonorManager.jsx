import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { collection, query, orderBy, onSnapshot, doc, updateDoc, deleteDoc, setDoc } from 'firebase/firestore';
import './DonorUploader.css';
import DonationHistogram from './DonationHistogram';
import DonationPie from './DonationPie';
import DonationByDiscipler from './DonationByDiscipler';
import DonationByRole from './DonationByRole';
import MultiAssignEditor from './MultiAssignEditor';
import RoleCatalogManager from './RoleCatalogManager';
import RoleFieldsModal from './RoleFieldsModal';

const DonorManager = ({ churchId }) => {
  const { user } = useAuth();
  const [donors, setDonors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [editFields, setEditFields] = useState({});
  const [searchText, setSearchText] = useState('');
  const [sortColumn, setSortColumn] = useState(null);
  const [sortDir, setSortDir] = useState('desc'); // 'asc' or 'desc'
  const [donationLabels, setDonationLabels] = useState({});
  const [selectedYear, setSelectedYear] = useState('All');
  const [showRoleCatalogs, setShowRoleCatalogs] = useState(false);
  const [roleCatalogs, setRoleCatalogs] = useState({ serving: [], connecting: [], discipleship: [], attending: [] });
  const [assignEditor, setAssignEditor] = useState({ open: false, field: null, value: '', title: '' });

  useEffect(() => {
    if (!churchId || !user) return;
    const q = query(collection(db, `churches/${churchId}/donors`), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setDonors(docs);
      setLoading(false);
    }, (err) => {
      console.error('DonorManager snapshot error', err);
      setLoading(false);
    });

    return () => unsub();
  }, [churchId, user]);

  // Listen for donation label settings for this church
  useEffect(() => {
    if (!churchId) return;
    const ref = doc(db, `churches/${churchId}/donorSettings`, 'labels');
    const unsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setDonationLabels(data.donationLabels || {});
      } else {
        setDonationLabels({});
      }
    }, (err) => {
      console.error('Labels snapshot error', err);
      setDonationLabels({});
    });

    return () => unsub();
  }, [churchId]);

  // Listen for role catalogs (serving, connecting, discipleship, attending)
  useEffect(() => {
    if (!churchId) return;
    const ref = doc(db, `churches/${churchId}/donorSettings`, 'roleCatalogs');
    const unsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        const data = snap.data() || {};
        setRoleCatalogs({ serving: data.serving || [], connecting: data.connecting || [], discipleship: data.discipleship || [], attending: data.attending || [] });
      } else {
        setRoleCatalogs({ serving: [], connecting: [], discipleship: [], attending: [] });
      }
    }, (err) => {
      console.error('RoleCatalogs snapshot error', err);
      setRoleCatalogs({ serving: [], connecting: [], discipleship: [], attending: [] });
    });
    return () => unsub();
  }, [churchId]);

  const saveDonationLabels = async (labels) => {
    if (!churchId) return;
    try {
      const ref = doc(db, `churches/${churchId}/donorSettings`, 'labels');
      await setDoc(ref, { donationLabels: labels }, { merge: true });
    } catch (err) {
      console.error('Error saving donation labels', err);
      throw err;
    }
  };

  const years = useMemo(() => {
    const ys = Array.from(new Set(donors.map(d => d.year).filter(Boolean))).sort((a, b) => String(b).localeCompare(String(a)));
    return ['All', ...ys];
  }, [donors]);

  const PALETTE = [
    '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b',
    '#e377c2', '#7f7f7f', '#17becf', '#393b79', '#637939', '#8c6d31'
  ];

  const buildColorMap = (names) => {
    const n = names.length;
    if (n === 0) return {};
    if (n <= PALETTE.length) {
      const step = 5;
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
    const map = {};
    names.slice().sort().forEach((name, i) => {
      const h = Math.round((i * 360) / n);
      map[name] = `hsl(${h} 70% 45%)`;
    });
    return map;
  };

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

  const disciplerColorMap = useMemo(() => {
    return buildColorMap(disciplerOptions);
  }, [disciplerOptions]);

  const parseDisciplerList = (str) => {
    if (!str) return [];
    return str.toString().split(/[;,\/|]+/).map(s => s.trim()).filter(Boolean);
  };

  const toggleDisciplerInEdit = (value) => {
    setEditFields(f => {
      const list = parseDisciplerList(f.discipler || '');
      const has = list.includes(value);
      const next = has ? list.filter(x => x !== value) : [...list, value];
      return { ...f, discipler: next.join(', ') };
    });
  };

  const addCustomDisciplerInEdit = (value) => {
    const v = (value || '').toString().trim();
    if (!v) return;
    setEditFields(f => {
      const list = parseDisciplerList(f.discipler || '');
      if (list.includes(v)) return f;
      return { ...f, discipler: [...list, v].join(', ') };
    });
  };

  const toggleServingDropdown = () => {
    setServingDropdownOpen(o => {
      const next = !o;
      if (next) setTimeout(() => ddRefServing.current && ddRefServing.current.scrollIntoView({ block: 'nearest', inline: 'nearest' }), 50);
      return next;
    });
  };

  const toggleConnectingDropdown = () => {
    setConnectingDropdownOpen(o => {
      const next = !o;
      if (next) setTimeout(() => ddRefConnecting.current && ddRefConnecting.current.scrollIntoView({ block: 'nearest', inline: 'nearest' }), 50);
      return next;
    });
  };

  const toggleDiscipleshipDropdown = () => {
    setDiscipleshipDropdownOpen(o => {
      const next = !o;
      if (next) setTimeout(() => ddRefDiscipleship.current && ddRefDiscipleship.current.scrollIntoView({ block: 'nearest', inline: 'nearest' }), 50);
      return next;
    });
  };

  const toggleAttendingDropdown = () => {
    setAttendingDropdownOpen(o => {
      const next = !o;
      if (next) setTimeout(() => ddRefAttending.current && ddRefAttending.current.scrollIntoView({ block: 'nearest', inline: 'nearest' }), 50);
      return next;
    });
  };

  const toggleRoleInEdit = (field, value) => {
    setEditFields(f => {
      const list = parseDisciplerList(f[field] || '');
      const has = list.includes(value);
      const next = has ? list.filter(x => x !== value) : [...list, value];
      return { ...f, [field]: next.join(', ') };
    });
  };

  const addCustomRoleInEdit = (field, value) => {
    const v = (value || '').toString().trim();
    if (!v) return;
    setEditFields(f => {
      const list = parseDisciplerList(f[field] || '');
      if (list.includes(v)) return f;
      return { ...f, [field]: [...list, v].join(', ') };
    });
  };

  const [disciplerDropdownOpen, setDisciplerDropdownOpen] = useState(false);
  const [disciplerFilter, setDisciplerFilter] = useState('');
  const ddRef = useRef(null);
  const panelRef = useRef(null);
  const [panelAlignRight, setPanelAlignRight] = useState(false);
  
  const [servingDropdownOpen, setServingDropdownOpen] = useState(false);
  const [servingFilter, setServingFilter] = useState('');
  const ddRefServing = useRef(null);
  const panelRefServing = useRef(null);
  const [panelAlignRightServing, setPanelAlignRightServing] = useState(false);

  const [connectingDropdownOpen, setConnectingDropdownOpen] = useState(false);
  const [connectingFilter, setConnectingFilter] = useState('');
  const ddRefConnecting = useRef(null);
  const panelRefConnecting = useRef(null);
  const [panelAlignRightConnecting, setPanelAlignRightConnecting] = useState(false);

  const [discipleshipDropdownOpen, setDiscipleshipDropdownOpen] = useState(false);
  const [discipleshipFilter, setDiscipleshipFilter] = useState('');
  const ddRefDiscipleship = useRef(null);
  const panelRefDiscipleship = useRef(null);
  const [panelAlignRightDiscipleship, setPanelAlignRightDiscipleship] = useState(false);

  const [attendingDropdownOpen, setAttendingDropdownOpen] = useState(false);
  const [attendingFilter, setAttendingFilter] = useState('');
  const ddRefAttending = useRef(null);
  const panelRefAttending = useRef(null);
  const [panelAlignRightAttending, setPanelAlignRightAttending] = useState(false);

  useEffect(() => {
    const onDocClick = (e) => {
      if (!ddRef.current) return;
      if (!ddRef.current.contains(e.target)) {
        setDisciplerDropdownOpen(false);
        setDisciplerFilter('');
      }
    };
    if (disciplerDropdownOpen) document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [disciplerDropdownOpen]);

  useEffect(() => {
    const onDocClick = (e) => {
      if (!ddRefServing.current) return;
      if (!ddRefServing.current.contains(e.target)) {
        setServingDropdownOpen(false);
        setServingFilter('');
      }
    };
    if (servingDropdownOpen) document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [servingDropdownOpen]);

  useEffect(() => {
    const onDocClick = (e) => {
      if (!ddRefConnecting.current) return;
      if (!ddRefConnecting.current.contains(e.target)) {
        setConnectingDropdownOpen(false);
        setConnectingFilter('');
      }
    };
    if (connectingDropdownOpen) document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [connectingDropdownOpen]);

  useEffect(() => {
    const onDocClick = (e) => {
      if (!ddRefDiscipleship.current) return;
      if (!ddRefDiscipleship.current.contains(e.target)) {
        setDiscipleshipDropdownOpen(false);
        setDiscipleshipFilter('');
      }
    };
    if (discipleshipDropdownOpen) document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [discipleshipDropdownOpen]);

  useEffect(() => {
    const onDocClick = (e) => {
      if (!ddRefAttending.current) return;
      if (!ddRefAttending.current.contains(e.target)) {
        setAttendingDropdownOpen(false);
        setAttendingFilter('');
      }
    };
    if (attendingDropdownOpen) document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [attendingDropdownOpen]);

  useEffect(() => {
    if (!disciplerDropdownOpen) return;
    const adjust = () => {
      const wrap = ddRef.current;
      const panel = panelRef.current;
      if (!wrap || !panel) return setPanelAlignRight(false);
      const wrapRect = wrap.getBoundingClientRect();
      const panelW = panel.offsetWidth || 420;
      const spaceRight = window.innerWidth - wrapRect.left;
      // prefer left alignment; if not enough space on right, align to right edge of wrapper
      setPanelAlignRight(spaceRight < panelW + 12);
    };
    adjust();
    window.addEventListener('resize', adjust);
    return () => window.removeEventListener('resize', adjust);
  }, [disciplerDropdownOpen]);

  useEffect(() => {
    if (!servingDropdownOpen) return;
    const adjust = () => {
      const wrap = ddRefServing.current;
      const panel = panelRefServing.current;
      if (!wrap || !panel) return setPanelAlignRightServing(false);
      const wrapRect = wrap.getBoundingClientRect();
      const panelW = panel.offsetWidth || 420;
      const spaceRight = window.innerWidth - wrapRect.left;
      setPanelAlignRightServing(spaceRight < panelW + 12);
    };
    adjust();
    window.addEventListener('resize', adjust);
    return () => window.removeEventListener('resize', adjust);
  }, [servingDropdownOpen]);

  useEffect(() => {
    if (!connectingDropdownOpen) return;
    const adjust = () => {
      const wrap = ddRefConnecting.current;
      const panel = panelRefConnecting.current;
      if (!wrap || !panel) return setPanelAlignRightConnecting(false);
      const wrapRect = wrap.getBoundingClientRect();
      const panelW = panel.offsetWidth || 420;
      const spaceRight = window.innerWidth - wrapRect.left;
      setPanelAlignRightConnecting(spaceRight < panelW + 12);
    };
    adjust();
    window.addEventListener('resize', adjust);
    return () => window.removeEventListener('resize', adjust);
  }, [connectingDropdownOpen]);

  useEffect(() => {
    if (!discipleshipDropdownOpen) return;
    const adjust = () => {
      const wrap = ddRefDiscipleship.current;
      const panel = panelRefDiscipleship.current;
      if (!wrap || !panel) return setPanelAlignRightDiscipleship(false);
      const wrapRect = wrap.getBoundingClientRect();
      const panelW = panel.offsetWidth || 420;
      const spaceRight = window.innerWidth - wrapRect.left;
      setPanelAlignRightDiscipleship(spaceRight < panelW + 12);
    };
    adjust();
    window.addEventListener('resize', adjust);
    return () => window.removeEventListener('resize', adjust);
  }, [discipleshipDropdownOpen]);

  useEffect(() => {
    if (!attendingDropdownOpen) return;
    const adjust = () => {
      const wrap = ddRefAttending.current;
      const panel = panelRefAttending.current;
      if (!wrap || !panel) return setPanelAlignRightAttending(false);
      const wrapRect = wrap.getBoundingClientRect();
      const panelW = panel.offsetWidth || 420;
      const spaceRight = window.innerWidth - wrapRect.left;
      setPanelAlignRightAttending(spaceRight < panelW + 12);
    };
    adjust();
    window.addEventListener('resize', adjust);
    return () => window.removeEventListener('resize', adjust);
  }, [attendingDropdownOpen]);

  const filteredByYear = useMemo(() => {
    if (!selectedYear || selectedYear === 'All') return donors;
    return donors.filter(d => String(d.year) === String(selectedYear));
  }, [donors, selectedYear]);

  const stats = useMemo(() => {
    const list = filteredByYear || [];
    const totalDonors = list.length;
    const totalDonated = list.reduce((s, d) => s + (Number(d.totalDonated) || 0), 0);
    const avgPerPerson = totalDonors ? totalDonated / totalDonors : 0;
    const monthly = avgPerPerson / 12;
    const weekly = avgPerPerson / 52;
    const quarterlyAvgPerPerson = avgPerPerson / 4;
    const totalMonthly = totalDonated / 12;
    const totalWeekly = totalDonated / 52;
    return { totalDonors, totalDonated, avgPerPerson, monthly, weekly, quarterlyAvgPerPerson, totalMonthly, totalWeekly };
  }, [filteredByYear]);

  const startEdit = (donor) => {
    setEditingId(donor.id);
    setEditFields({
      firstName: donor.firstName || '',
      lastName: donor.lastName || '',
      discipler: donor.discipler || '',
      serving: donor.serving || '',
      connecting: donor.connecting || '',
      discipleship: donor.discipleship || '',
      attending: donor.attending || '',
      phone: donor.phone || '',
      donationCount: donor.donationCount || 0,
      totalDonated: donor.totalDonated || 0,
      year: donor.year || ''
    });
  };

  const saveEdit = async (id) => {
    try {
      const ref = doc(db, `churches/${churchId}/donors`, id);
      await updateDoc(ref, {
        ...editFields
      });
      setEditingId(null);
    } catch (err) {
      console.error('Update donor error', err);
      alert('Error actualizando el donante');
    }
  };

  const handleKeyDown = (e, id) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveEdit(id);
    }
    if (e.key === 'Escape') {
      setEditingId(null);
    }
  };

  const remove = async (id) => {
    if (!confirm('Eliminar este donante?')) return;
    try {
      await deleteDoc(doc(db, `churches/${churchId}/donors`, id));
    } catch (err) {
      console.error('Delete donor error', err);
      alert('Error eliminando el donante');
    }
  };

  const [roleEditor, setRoleEditor] = useState({ open: false, donorId: null, fields: {} });

  // resetAll removed per user request

  // Ensure hooks are called in the same order; handle missing churchId in render below

  const displayedDonors = useMemo(() => {
    const q = (d) => {
      if (!searchText) return true;
      const s = searchText.toString().toLowerCase();
      return [d.firstName, d.lastName, d.phone, d.discipler, d.serving, d.connecting, d.discipleship, d.attending, String(d.donationCount), String(d.totalDonated), String(d.year)]
        .filter(Boolean)
        .some(v => v.toString().toLowerCase().includes(s));
    };

    let list = filteredByYear.filter(q);

    if (sortColumn) {
      const numericCols = ['donationCount', 'totalDonated', 'year'];
      list = list.slice().sort((a, b) => {
        const av = a[sortColumn];
        const bv = b[sortColumn];
        if (numericCols.includes(sortColumn)) {
          const na = Number(av) || 0;
          const nb = Number(bv) || 0;
          return sortDir === 'asc' ? na - nb : nb - na;
        }
        const sa = (av || '').toString().toLowerCase();
        const sb = (bv || '').toString().toLowerCase();
        if (sa < sb) return sortDir === 'asc' ? -1 : 1;
        if (sa > sb) return sortDir === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return list;
  }, [donors, searchText, sortColumn, sortDir]);

  const handleSort = (col) => {
    if (sortColumn === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(col);
      setSortDir('desc');
    }
  };

  const formatCurrency = (v) => {
    const n = Number((v || '').toString().replace(/[^0-9.-]+/g, '')) || 0;
    return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  };

  return (
    <div className="donor-uploader" style={{ width: '100%', maxWidth: 'none' }}>
      {/* KPI cards above charts */}
      <div className="kpi-container">
        <div className="kpi-card">
          <div className="kpi-title">Year</div>
          <div className="kpi-value">
            <select value={selectedYear} onChange={e => setSelectedYear(e.target.value)} style={{ padding: 6, borderRadius: 6, border: '1px solid #e5e7eb' }}>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-title">Total Donors</div>
          <div className="kpi-value" style={{ fontWeight: 800 }}>{stats.totalDonors}</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-title">Total Collected</div>
          <div className="kpi-value" style={{ fontWeight: 800 }}>{formatCurrency(stats.totalDonated)}</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-title">Total / Quarter (est.)</div>
          <div className="kpi-sub">1 quarter = 3 months • 4 quarters / year</div>
          <div className="kpi-value" style={{ fontWeight: 800 }}>{formatCurrency(stats.totalDonated / 4)}</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-title">Total / Month (est.)</div>
          <div className="kpi-sub">12 months / year</div>
          <div className="kpi-value" style={{ fontWeight: 800 }}>{formatCurrency(stats.totalMonthly)}</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-title">Total / Week (est.)</div>
          <div className="kpi-sub">52 weeks / year</div>
          <div className="kpi-value" style={{ fontWeight: 800 }}>{formatCurrency(stats.totalWeekly)}</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-title">Quarterly Avg / Person</div>
          <div className="kpi-sub">(avg per person over 3 months)</div>
          <div className="kpi-value" style={{ fontWeight: 800 }}>{formatCurrency(stats.quarterlyAvgPerPerson)}</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-title">Avg / Month / Person</div>
          <div className="kpi-sub">12 months / year</div>
          <div className="kpi-value" style={{ fontWeight: 800 }}>{formatCurrency(stats.monthly)}</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-title">Avg / Week / Person</div>
          <div className="kpi-sub">52 weeks / year</div>
          <div className="kpi-value" style={{ fontWeight: 800 }}>{formatCurrency(stats.weekly)}</div>
        </div>
      </div>

      <div className="donation-charts">
        <DonationPie donors={donors} churchId={churchId} labels={donationLabels} saveLabels={saveDonationLabels} size={460} outerPadding={70} showLegend={false} />
        <DonationHistogram donors={donors} labels={donationLabels} />
        <DonationByDiscipler donors={filteredByYear} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <DonationByRole donors={filteredByYear} field="serving" title="Giving by Serving" limit={12} />
          <DonationByRole donors={filteredByYear} field="connecting" title="Giving by Connecting" limit={12} />
          <DonationByRole donors={filteredByYear} field="discipleship" title="Giving by Discipleship" limit={12} />
          <DonationByRole donors={filteredByYear} field="attending" title="Giving by Attending" limit={12} />
        </div>
      </div>
      <h3>Manage Donors</h3>
      {loading ? <div>Cargando...</div> : (
        <div className="table-wrap">
          <div style={{ display: 'flex', gap: 12, marginBottom: 12, alignItems: 'center' }}>
            <input placeholder="Buscar por nombre, teléfono, año, monto..." value={searchText} onChange={e => setSearchText(e.target.value)} style={{ flex: 1, padding: 8, borderRadius: 6, border: '1px solid #e5e7eb' }} />
            <div style={{ fontSize: 14, color: '#374151' }}>Sort: </div>
            <div style={{ marginLeft: 'auto' }}>
              <button className="btn" onClick={() => setShowRoleCatalogs(true)}>Manage Role Catalogs</button>
            </div>
          </div>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>Hint: double-click any row to edit inline. Press Enter to save or Esc to cancel.</div>
          <table className="donor-table">
            <datalist id="discipler-list">
              {disciplerOptions.map(o => <option key={o} value={o} />)}
            </datalist>
            <datalist id="serving-list">
              {roleCatalogs.serving && roleCatalogs.serving.map((it, i) => <option key={`s-${i}`} value={typeof it === 'string' ? it : it.name} />)}
            </datalist>
            <datalist id="connecting-list">
              {roleCatalogs.connecting && roleCatalogs.connecting.map((it, i) => <option key={`c-${i}`} value={typeof it === 'string' ? it : it.name} />)}
            </datalist>
            <datalist id="discipleship-list">
              {roleCatalogs.discipleship && roleCatalogs.discipleship.map((it, i) => <option key={`d-${i}`} value={typeof it === 'string' ? it : it.name} />)}
            </datalist>
            <datalist id="attending-list">
              {roleCatalogs.attending && roleCatalogs.attending.map((it, i) => <option key={`a-${i}`} value={typeof it === 'string' ? it : it.name} />)}
            </datalist>
            <thead>
              <tr>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('firstName')}>First Name {sortColumn === 'firstName' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('lastName')}>Last Name {sortColumn === 'lastName' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('phone')}>Phone {sortColumn === 'phone' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('donationCount')}>Donation Count {sortColumn === 'donationCount' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('totalDonated')}>Total (USD) {sortColumn === 'totalDonated' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('year')}>Year {sortColumn === 'year' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('discipler')}>Discipler {sortColumn === 'discipler' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</th>
                <th>Serving</th>
                <th>Connecting</th>
                <th>Discipleship</th>
                <th>Attending</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayedDonors.map(d => (
                <tr key={d.id} onDoubleClick={() => startEdit(d)}>
                  <td>{editingId === d.id ? <input value={editFields.firstName} onChange={e => setEditFields(f => ({...f, firstName: e.target.value}))} /> : d.firstName}</td>
                  <td>{editingId === d.id ? <input value={editFields.lastName} onChange={e => setEditFields(f => ({...f, lastName: e.target.value}))} onKeyDown={e => handleKeyDown(e, d.id)} /> : d.lastName}</td>
                  <td>{editingId === d.id ? <input value={editFields.phone} onChange={e => setEditFields(f => ({...f, phone: e.target.value}))} onKeyDown={e => handleKeyDown(e, d.id)} /> : d.phone}</td>
                  <td>{editingId === d.id ? <input value={editFields.donationCount} onChange={e => setEditFields(f => ({...f, donationCount: Number(e.target.value)}))} onKeyDown={e => handleKeyDown(e, d.id)} /> : d.donationCount}</td>
                  <td>{editingId === d.id ? <input value={editFields.totalDonated} onChange={e => setEditFields(f => ({...f, totalDonated: Number(e.target.value)}))} onKeyDown={e => handleKeyDown(e, d.id)} /> : formatCurrency(d.totalDonated)}</td>
                  <td>{editingId === d.id ? <input value={editFields.year} onChange={e => setEditFields(f => ({...f, year: e.target.value}))} onKeyDown={e => handleKeyDown(e, d.id)} /> : d.year}</td>
                  <td className="discipler-cell">
                    {editingId === d.id ? (
                      <div ref={ddRef} style={{ position: 'relative', display: 'inline-block' }}>
                        <button type="button" className="btn" onClick={() => setDisciplerDropdownOpen(o => !o)} style={{ padding: '6px 8px', minWidth: 160, textAlign: 'left' }}>
                          {parseDisciplerList(editFields.discipler || '').length ? parseDisciplerList(editFields.discipler || '').join(', ') : 'Select disciplers...'}
                        </button>
                        {disciplerDropdownOpen && (
                          <div ref={panelRef} className="discipler-dropdown-panel" style={{ left: panelAlignRight ? 'auto' : 0, right: panelAlignRight ? 0 : 'auto' }}>
                            <input className="discipler-search" placeholder="Filter..." value={disciplerFilter} onChange={e => setDisciplerFilter(e.target.value)} />
                            <div className="discipler-options-list">
                              {disciplerOptions.filter(o => o.toLowerCase().includes(disciplerFilter.toLowerCase())).map(opt => {
                                const selected = parseDisciplerList(editFields.discipler || '').includes(opt);
                                return (
                                  <label key={opt} className="discipler-option-row">
                                    <input type="checkbox" checked={selected} onChange={() => toggleDisciplerInEdit(opt)} />
                                    <span className="discipler-opt-label">{opt}</span>
                                  </label>
                                );
                              })}
                            </div>
                            <div className="discipler-dropdown-bottom">
                              <input placeholder="Add custom..." onKeyDown={e => { if (e.key === 'Enter') { addCustomDisciplerInEdit(e.target.value); e.target.value = ''; } }} className="discipler-add-input" />
                              <div style={{ display: 'flex', gap: 8 }}>
                                <button className="btn" onClick={() => { setAssignEditor({ open: true, field: 'discipler', value: editFields.discipler || '', title: 'Assign Disciplers' }); setDisciplerDropdownOpen(false); }}>Assign...</button>
                                <button className="btn secondary" onClick={() => setDisciplerDropdownOpen(false)}>Done</button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      (d.discipler || '').toString().trim() ? (
                        <div className="discipler-display">
                          {parseDisciplerList(d.discipler).map(s => {
                              const color = disciplerColorMap[s] || '#4b5563';
                              return (<span key={s} className="discipler-badge" style={{ background: color }}>{s}</span>);
                            })}
                        </div>
                      ) : ''
                    )}
                  </td>
                  <td>
                    {editingId === d.id ? (
                      <div ref={ddRefServing} style={{ position: 'relative', display: 'inline-block' }}>
                        <button type="button" className="btn" onClick={toggleServingDropdown} style={{ padding: '6px 8px', minWidth: 160, textAlign: 'left' }}>
                          {parseDisciplerList(editFields.serving || '').length ? parseDisciplerList(editFields.serving || '').join(', ') : 'Select serving...'}
                        </button>
                        {servingDropdownOpen && (
                          <div ref={panelRefServing} className="discipler-dropdown-panel" style={{ left: panelAlignRightServing ? 'auto' : 0, right: panelAlignRightServing ? 0 : 'auto' }}>
                            <input className="discipler-search" placeholder="Filter..." value={servingFilter} onChange={e => setServingFilter(e.target.value)} />
                            <div className="discipler-options-list">
                              {(roleCatalogs.serving || []).map(it => typeof it === 'string' ? it : it.name).filter(o => o.toLowerCase().includes(servingFilter.toLowerCase())).map(opt => {
                                const selected = parseDisciplerList(editFields.serving || '').includes(opt);
                                return (
                                  <label key={opt} className="discipler-option-row">
                                    <input type="checkbox" checked={selected} onChange={() => toggleRoleInEdit('serving', opt)} />
                                    <span className="discipler-opt-label">{opt}</span>
                                  </label>
                                );
                              })}
                            </div>
                            <div className="discipler-dropdown-bottom">
                              <input placeholder="Add custom..." onKeyDown={e => { if (e.key === 'Enter') { addCustomRoleInEdit('serving', e.target.value); e.target.value = ''; } }} className="discipler-add-input" />
                              <div style={{ display: 'flex', gap: 8 }}>
                                <button className="btn" onClick={() => { setAssignEditor({ open: true, field: 'serving', value: editFields.serving || '', title: 'Assign Serving' }); setServingDropdownOpen(false); }}>Assign...</button>
                                <button className="btn secondary" onClick={() => setServingDropdownOpen(false)}>Done</button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      (d.serving || '').toString().trim() ? (
                        <div className="discipler-display">
                          {parseDisciplerList(d.serving).map(s => <span key={s} className="discipler-badge" style={{ background: disciplerColorMap[s] || '#4b5563' }}>{s}</span>)}
                        </div>
                      ) : ''
                    )}
                  </td>
                  <td>
                    {editingId === d.id ? (
                      <div ref={ddRefConnecting} style={{ position: 'relative', display: 'inline-block' }}>
                        <button type="button" className="btn" onClick={toggleConnectingDropdown} style={{ padding: '6px 8px', minWidth: 160, textAlign: 'left' }}>
                          {parseDisciplerList(editFields.connecting || '').length ? parseDisciplerList(editFields.connecting || '').join(', ') : 'Select connecting...'}
                        </button>
                        {connectingDropdownOpen && (
                          <div ref={panelRefConnecting} className="discipler-dropdown-panel" style={{ left: panelAlignRightConnecting ? 'auto' : 0, right: panelAlignRightConnecting ? 0 : 'auto' }}>
                            <input className="discipler-search" placeholder="Filter..." value={connectingFilter} onChange={e => setConnectingFilter(e.target.value)} />
                            <div className="discipler-options-list">
                              {(roleCatalogs.connecting || []).map(it => typeof it === 'string' ? it : it.name).filter(o => o.toLowerCase().includes(connectingFilter.toLowerCase())).map(opt => {
                                const selected = parseDisciplerList(editFields.connecting || '').includes(opt);
                                return (
                                  <label key={opt} className="discipler-option-row">
                                    <input type="checkbox" checked={selected} onChange={() => toggleRoleInEdit('connecting', opt)} />
                                    <span className="discipler-opt-label">{opt}</span>
                                  </label>
                                );
                              })}
                            </div>
                            <div className="discipler-dropdown-bottom">
                              <input placeholder="Add custom..." onKeyDown={e => { if (e.key === 'Enter') { addCustomRoleInEdit('connecting', e.target.value); e.target.value = ''; } }} className="discipler-add-input" />
                              <div style={{ display: 'flex', gap: 8 }}>
                                <button className="btn" onClick={() => { setAssignEditor({ open: true, field: 'connecting', value: editFields.connecting || '', title: 'Assign Connecting' }); setConnectingDropdownOpen(false); }}>Assign...</button>
                                <button className="btn secondary" onClick={() => setConnectingDropdownOpen(false)}>Done</button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      (d.connecting || '').toString().trim() ? (
                        <div className="discipler-display">
                          {parseDisciplerList(d.connecting).map(s => <span key={s} className="discipler-badge" style={{ background: disciplerColorMap[s] || '#4b5563' }}>{s}</span>)}
                        </div>
                      ) : ''
                    )}
                  </td>
                  <td>
                    {editingId === d.id ? (
                      <div ref={ddRefDiscipleship} style={{ position: 'relative', display: 'inline-block' }}>
                        <button type="button" className="btn" onClick={toggleDiscipleshipDropdown} style={{ padding: '6px 8px', minWidth: 160, textAlign: 'left' }}>
                          {parseDisciplerList(editFields.discipleship || '').length ? parseDisciplerList(editFields.discipleship || '').join(', ') : 'Select discipleship...'}
                        </button>
                        {discipleshipDropdownOpen && (
                          <div ref={panelRefDiscipleship} className="discipler-dropdown-panel" style={{ left: panelAlignRightDiscipleship ? 'auto' : 0, right: panelAlignRightDiscipleship ? 0 : 'auto' }}>
                            <input className="discipler-search" placeholder="Filter..." value={discipleshipFilter} onChange={e => setDiscipleshipFilter(e.target.value)} />
                            <div className="discipler-options-list">
                              {(roleCatalogs.discipleship || []).map(it => typeof it === 'string' ? it : it.name).filter(o => o.toLowerCase().includes(discipleshipFilter.toLowerCase())).map(opt => {
                                const selected = parseDisciplerList(editFields.discipleship || '').includes(opt);
                                return (
                                  <label key={opt} className="discipler-option-row">
                                    <input type="checkbox" checked={selected} onChange={() => toggleRoleInEdit('discipleship', opt)} />
                                    <span className="discipler-opt-label">{opt}</span>
                                  </label>
                                );
                              })}
                            </div>
                            <div className="discipler-dropdown-bottom">
                              <input placeholder="Add custom..." onKeyDown={e => { if (e.key === 'Enter') { addCustomRoleInEdit('discipleship', e.target.value); e.target.value = ''; } }} className="discipler-add-input" />
                              <div style={{ display: 'flex', gap: 8 }}>
                                <button className="btn" onClick={() => { setAssignEditor({ open: true, field: 'discipleship', value: editFields.discipleship || '', title: 'Assign Discipleship' }); setDiscipleshipDropdownOpen(false); }}>Assign...</button>
                                <button className="btn secondary" onClick={() => setDiscipleshipDropdownOpen(false)}>Done</button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      (d.discipleship || '').toString().trim() ? (
                        <div className="discipler-display">
                          {parseDisciplerList(d.discipleship).map(s => <span key={s} className="discipler-badge" style={{ background: disciplerColorMap[s] || '#4b5563' }}>{s}</span>)}
                        </div>
                      ) : ''
                    )}
                  </td>
                  <td>
                    {editingId === d.id ? (
                      <div ref={ddRefAttending} style={{ position: 'relative', display: 'inline-block' }}>
                        <button type="button" className="btn" onClick={toggleAttendingDropdown} style={{ padding: '6px 8px', minWidth: 160, textAlign: 'left' }}>
                          {parseDisciplerList(editFields.attending || '').length ? parseDisciplerList(editFields.attending || '').join(', ') : 'Select attending...'}
                        </button>
                        {attendingDropdownOpen && (
                          <div ref={panelRefAttending} className="discipler-dropdown-panel" style={{ left: panelAlignRightAttending ? 'auto' : 0, right: panelAlignRightAttending ? 0 : 'auto' }}>
                            <input className="discipler-search" placeholder="Filter..." value={attendingFilter} onChange={e => setAttendingFilter(e.target.value)} />
                            <div className="discipler-options-list">
                              {(roleCatalogs.attending || []).map(it => typeof it === 'string' ? it : it.name).filter(o => o.toLowerCase().includes(attendingFilter.toLowerCase())).map(opt => {
                                const selected = parseDisciplerList(editFields.attending || '').includes(opt);
                                return (
                                  <label key={opt} className="discipler-option-row">
                                    <input type="checkbox" checked={selected} onChange={() => toggleRoleInEdit('attending', opt)} />
                                    <span className="discipler-opt-label">{opt}</span>
                                  </label>
                                );
                              })}
                            </div>
                            <div className="discipler-dropdown-bottom">
                              <input placeholder="Add custom..." onKeyDown={e => { if (e.key === 'Enter') { addCustomRoleInEdit('attending', e.target.value); e.target.value = ''; } }} className="discipler-add-input" />
                              <div style={{ display: 'flex', gap: 8 }}>
                                <button className="btn" onClick={() => { setAssignEditor({ open: true, field: 'attending', value: editFields.attending || '', title: 'Assign Attending' }); setAttendingDropdownOpen(false); }}>Assign...</button>
                                <button className="btn secondary" onClick={() => setAttendingDropdownOpen(false)}>Done</button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      (d.attending || '').toString().trim() ? (
                        <div className="discipler-display">
                          {parseDisciplerList(d.attending).map(s => <span key={s} className="discipler-badge" style={{ background: disciplerColorMap[s] || '#4b5563' }}>{s}</span>)}
                        </div>
                      ) : ''
                    )}
                  </td>
                  <td className="actions-cell">
                    {editingId === d.id ? (
                      <>
                        <button className="btn" onClick={() => saveEdit(d.id)}>Guardar</button>
                        <button className="btn secondary" onClick={() => setEditingId(null)}>Cancelar</button>
                        <button className="btn secondary" onClick={() => remove(d.id)} style={{ marginLeft: 8 }}>Eliminar</button>
                        <button className="btn" onClick={() => setRoleEditor({ open: true, donorId: d.id, fields: { discipler: d.discipler, serving: d.serving, connecting: d.connecting, discipleship: d.discipleship, attending: d.attending } })} style={{ marginLeft: 8 }}>Edit Roles</button>
                      </>
                    ) : (
                      <>
                        <button className="btn" onClick={() => startEdit(d)}>Editar</button>
                        <button className="btn secondary" onClick={() => remove(d.id)} style={{ marginLeft: 8 }}>Eliminar</button>
                        <button className="btn" onClick={() => setRoleEditor({ open: true, donorId: d.id, fields: { discipler: d.discipler, serving: d.serving, connecting: d.connecting, discipleship: d.discipleship, attending: d.attending } })} style={{ marginLeft: 8 }}>Edit Roles</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {showRoleCatalogs && <RoleCatalogManager churchId={churchId} onClose={() => setShowRoleCatalogs(false)} />}
      <MultiAssignEditor
        open={assignEditor.open}
        options={[...new Set([...disciplerOptions, ...(roleCatalogs.serving||[]), ...(roleCatalogs.connecting||[]), ...(roleCatalogs.discipleship||[]), ...(roleCatalogs.attending||[])])].map(x => typeof x === 'string' ? x : x.name)}
        value={assignEditor.value}
        title={assignEditor.title}
        onClose={() => setAssignEditor({ open: false, field: null, value: '', title: '' })}
        onSave={(val) => {
          if (assignEditor.field) setEditFields(f => ({ ...f, [assignEditor.field]: val }));
        }}
      />
      <RoleFieldsModal
        open={roleEditor.open}
        onClose={() => setRoleEditor({ open: false, donorId: null, fields: {} })}
        donorId={roleEditor.donorId}
        fields={roleEditor.fields}
        roleCatalogs={roleCatalogs}
        churchId={churchId}
        db={db}
        docFn={doc}
        updateFn={updateDoc}
      />
    </div>
  );
};

export default DonorManager;
