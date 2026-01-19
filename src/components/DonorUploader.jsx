import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import { db } from '../firebase';
import { collection, writeBatch, doc, serverTimestamp, getDocs } from 'firebase/firestore';
import './DonorUploader.css';

const normalizeRow = (row) => {
  // Attempt to normalize common header names to a predictable shape
  const map = {
    first: ['first name', 'firstname', 'first_name', 'nombre'],
    last: ['last name', 'lastname', 'last_name', 'apellido'],
    phone: ['phone', 'phone number', 'telefono', 'teléfono', 'telefono movil'],
    discipler: ['discipler', 'discipler name', 'discipler_name', 'discipler_name', 'discipleship', 'discipleship_leader', 'discipleship_leader_name'],
    serving: ['serving', 'serving_leader', 'serving_leader_name'],
    connecting: ['connecting', 'connecting_leader', 'connecting_leader_name'],
    discipleship: ['discipleship_leader', 'discipleship_person'],
    attending: ['attending', 'attending_leader', 'attending_leader_name'],
    donation_count: ['donation count', 'donations', 'donation_count', 'cantidad_donaciones'],
    total_donated: ['total donated', 'total', 'total_donated', 'monto_total', 'amount'],
    year: ['year', 'anio', 'año']
  };

  const normalized = {
    first: '',
    last: '',
    phone: '',
    discipler: '',
    serving: '',
    connecting: '',
    discipleship: '',
    attending: '',
    donation_count: '',
    total_donated: '',
    year: ''
  };

  Object.keys(row).forEach((key) => {
    const lower = key.toString().trim().toLowerCase();
    if (map.first.includes(lower)) normalized.first = row[key];
    else if (map.last.includes(lower)) normalized.last = row[key];
    else if (map.phone.includes(lower)) normalized.phone = row[key];
    else if (map.discipler.includes(lower)) normalized.discipler = row[key];
    else if (map.serving && map.serving.includes(lower)) normalized.serving = row[key];
    else if (map.connecting && map.connecting.includes(lower)) normalized.connecting = row[key];
    else if (map.discipleship && map.discipleship.includes(lower)) normalized.discipleship = row[key];
    else if (map.attending && map.attending.includes(lower)) normalized.attending = row[key];
    else if (map.donation_count.includes(lower)) normalized.donation_count = row[key];
    else if (map.total_donated.includes(lower)) normalized.total_donated = row[key];
    else if (map.year.includes(lower)) normalized.year = row[key];
    else {
      // try to guess by substring
      if (lower.includes('first') || lower.includes('nombre')) normalized.first = row[key];
      else if (lower.includes('last') || lower.includes('apellido')) normalized.last = row[key];
      else if (lower.includes('phone') || lower.includes('tel')) normalized.phone = row[key];
      else if (lower.includes('discip') || lower.includes('leader')) normalized.discipler = row[key];
      else if (lower.includes('serv') || lower.includes('serving')) normalized.serving = row[key];
      else if (lower.includes('connect')) normalized.connecting = row[key];
      else if (lower.includes('discipleship') && !normalized.discipleship) normalized.discipleship = row[key];
      else if (lower.includes('attend') && !normalized.attending) normalized.attending = row[key];
      else if (lower.includes('count') || lower.includes('donat') && !normalized.donation_count) normalized.donation_count = row[key];
      else if (lower.includes('total') || lower.includes('amount') || lower.includes('monto')) normalized.total_donated = row[key];
      else if (lower.includes('year') || lower.includes('año') || lower.includes('anio')) normalized.year = row[key];
    }
  });

  return normalized;
};

const DonorUploader = ({ churchId = null }) => {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveMode, setSaveMode] = useState('merge'); // 'merge' or 'replace'

  const handleFile = async (e) => {
    setError(null);
    const file = e.target.files[0];
    if (!file) return;

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const json = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

      // Normalize rows to expected fields
      const parsed = json.map((r) => normalizeRow(r));
      setRows(parsed);
    } catch (err) {
      console.error(err);
      setError('Error parsing the Excel file. Asegúrate que el archivo sea válido.');
    }
  };

  const handleSave = async () => {
    if (!churchId) {
      setError('No churchId provided. Pasar `churchId` como prop para guardar en Firestore.');
      return;
    }

    setSaving(true);
    setError(null);
    // dedupe uploaded rows before any save operation
    const { unique: _uniqueRows, duplicates: _duplicates } = dedupeRows(rows);
    let rowsToSave = _uniqueRows;
    if (_duplicates && _duplicates.length > 0) {
      const ok = window.confirm(`${_duplicates.length} duplicate row(s) detected and will be removed before saving. Continue?`);
      if (!ok) {
        setSaving(false);
        return;
      }
    }

    // filter out rows missing first or last name
    const missingName = rowsToSave.filter(r => !(r.first && r.first.toString().trim()) || !(r.last && r.last.toString().trim()));
    if (missingName.length > 0) {
      const ok2 = window.confirm(`${missingName.length} row(s) are missing first or last name and will be skipped. Continue?`);
      if (!ok2) {
        setSaving(false);
        return;
      }
      rowsToSave = rowsToSave.filter(r => (r.first && r.first.toString().trim()) && (r.last && r.last.toString().trim()));
    }

    // filter out rows where first or last are not alphabetic (must contain at least one letter)
    const alphaRegex = /[A-Za-z]/;
    const nonAlpha = rowsToSave.filter(r => !(r.first && alphaRegex.test(r.first.toString())) || !(r.last && alphaRegex.test(r.last.toString())));
    if (nonAlpha.length > 0) {
      const ok3 = window.confirm(`${nonAlpha.length} row(s) have invalid first/last names (must contain letters) and will be skipped. Continue?`);
      if (!ok3) {
        setSaving(false);
        return;
      }
      rowsToSave = rowsToSave.filter(r => (r.first && alphaRegex.test(r.first.toString())) && (r.last && alphaRegex.test(r.last.toString())));
    }
    if (saveMode === 'replace') {
      const ok = window.confirm('Replace mode will DELETE all existing donors for this church and replace them with the uploaded rows. Continue?');
      if (!ok) {
        setSaving(false);
        return;
      }
    }
    try {
      const collRef = collection(db, `churches/${churchId}/donors`);
      const batch = writeBatch(db);

      // Replace mode: delete all existing docs then add new ones
      if (saveMode === 'replace') {
        // fetch existing
        const existing = await getDocs(collRef);
        existing.docs.forEach((d) => batch.delete(d.ref));

        rowsToSave.forEach((row) => {
          const ref = doc(collRef);
          const donationCount = Number(row.donation_count) || 0;
          const totalDonated = Number(row.total_donated) || 0;
          batch.set(ref, {
            firstName: row.first || '',
            lastName: row.last || '',
            phone: String(row.phone || ''),
                discipler: row.discipler || '',
                serving: row.serving || '',
                connecting: row.connecting || '',
                discipleship: row.discipleship || '',
                attending: row.attending || '',
            donationCount,
            totalDonated,
            year: row.year || '',
            createdAt: serverTimestamp(),
          });
        });
      } else {
        // Merge mode: attempt to match existing donors by normalized phone,
        // fallback to normalized name (first|last|year) if phone missing or doesn't match
        const existing = await getDocs(collRef);
        const mapByPhone = {};
        const mapByName = {};
        existing.docs.forEach((d) => {
          const data = d.data() || {};
          const phone = normalizePhone(String(data.phone || ''));
          const first = (data.firstName || '').toString().trim().toLowerCase();
          const last = (data.lastName || '').toString().trim().toLowerCase();
          const year = (data.year || '').toString().trim();
          const nameKey = `${first}|${last}|${year}`;
          if (phone) mapByPhone[phone] = d.ref;
          if (first || last || year) mapByName[nameKey] = d.ref;
        });

        rowsToSave.forEach((row) => {
          const donationCount = Number(row.donation_count) || 0;
          const totalDonated = Number(row.total_donated) || 0;
          const phoneRaw = String(row.phone || '');
          const phone = normalizePhone(phoneRaw);
          const first = (row.first || '').toString().trim().toLowerCase();
          const last = (row.last || '').toString().trim().toLowerCase();
          const year = (row.year || '').toString().trim();
          const nameKey = `${first}|${last}|${year}`;

            if (phone && mapByPhone[phone]) {
            // update existing doc by phone
            batch.set(mapByPhone[phone], {
              firstName: row.first || '',
              lastName: row.last || '',
              phone: phoneRaw,
                discipler: row.discipler || '',
                serving: row.serving || '',
                connecting: row.connecting || '',
                discipleship: row.discipleship || '',
                attending: row.attending || '',
              donationCount,
              totalDonated,
              year: row.year || '',
              updatedAt: serverTimestamp(),
            }, { merge: true });
          } else if (mapByName[nameKey]) {
            // fallback: update existing doc matched by name+year
            batch.set(mapByName[nameKey], {
              firstName: row.first || '',
              lastName: row.last || '',
              phone: phoneRaw,
                discipler: row.discipler || '',
                serving: row.serving || '',
                connecting: row.connecting || '',
                discipleship: row.discipleship || '',
                attending: row.attending || '',
              donationCount,
              totalDonated,
              year: row.year || '',
              updatedAt: serverTimestamp(),
            }, { merge: true });
          } else {
            // create new
            const ref = doc(collRef);
            batch.set(ref, {
              firstName: row.first || '',
              lastName: row.last || '',
              phone: phoneRaw,
                discipler: row.discipler || '',
                serving: row.serving || '',
                connecting: row.connecting || '',
                discipleship: row.discipleship || '',
                attending: row.attending || '',
              donationCount,
              totalDonated,
              year: row.year || '',
              createdAt: serverTimestamp(),
            });
          }
        });
      }

      await batch.commit();
    } catch (err) {
      console.error('Save error', err);
      setError('Error saving to Firestore. Verifica permisos y configuración.');
    }
    setSaving(false);
  };

  const normalizePhone = (p) => {
    return (p || '').toString().replace(/[^0-9]/g, '').replace(/^\+/, '');
  };

  const formatCurrency = (v) => {
    const n = Number((v || '').toString().replace(/[^0-9.-]+/g, '')) || 0;
    return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  };

  const dedupeRows = (rowsList) => {
    const seen = new Set();
    const unique = [];
    const duplicates = [];
    rowsList.forEach((r) => {
      const phone = normalizePhone(String(r.phone || ''));
      const nameKey = `${(r.first||'').toString().trim().toLowerCase()}|${(r.last||'').toString().trim().toLowerCase()}|${(r.year||'').toString().trim()}`;
      const key = phone || nameKey || JSON.stringify(r);
      if (seen.has(key)) duplicates.push(r);
      else { seen.add(key); unique.push(r); }
    });
    return { unique, duplicates };
  };

  const updateRow = (index, field, value) => {
    setRows((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: value };
      return copy;
    });
  };

  return (
    <div className="donor-uploader">
      <h3>Subir Excel de Donantes</h3>
      <p className="muted">Carga un archivo Excel (.xlsx, .xls) con columnas de nombre, apellido, teléfono, conteo y monto.</p>

      <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} />

      {error && <div className="error">{error}</div>}

      {rows.length > 0 && (
        <div className="preview">
          <h4>Vista previa ({rows.length} filas)</h4>
          <div className="table-wrap">
            <table className="donor-table">
              <thead>
                <tr>
                  <th>First</th>
                  <th>Last</th>
                  <th>Phone</th>
                  <th>Discipler</th>
                  <th>Serving</th>
                  <th>Connecting</th>
                  <th>Discipleship</th>
                  <th>Attending</th>
                  <th>Donation Count</th>
                  <th>Total Donated</th>
                  <th>Year</th>
                </tr>
              </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i}>
                        <td>
                          <input value={r.first || ''} onChange={(e) => updateRow(i, 'first', e.target.value)} />
                        </td>
                        <td>
                          <input value={r.last || ''} onChange={(e) => updateRow(i, 'last', e.target.value)} />
                        </td>
                        <td>
                          <input value={r.phone || ''} onChange={(e) => updateRow(i, 'phone', e.target.value)} />
                        </td>
                        <td>
                          <input value={r.discipler || ''} onChange={(e) => updateRow(i, 'discipler', e.target.value)} />
                        </td>
                        <td>
                          <input value={r.serving || ''} onChange={(e) => updateRow(i, 'serving', e.target.value)} />
                        </td>
                        <td>
                          <input value={r.connecting || ''} onChange={(e) => updateRow(i, 'connecting', e.target.value)} />
                        </td>
                        <td>
                          <input value={r.discipleship || ''} onChange={(e) => updateRow(i, 'discipleship', e.target.value)} />
                        </td>
                        <td>
                          <input value={r.attending || ''} onChange={(e) => updateRow(i, 'attending', e.target.value)} />
                        </td>
                        <td>
                          <input value={r.donation_count || ''} onChange={(e) => updateRow(i, 'donation_count', e.target.value)} />
                        </td>
                        <td>
                          <input value={r.total_donated || ''} onChange={(e) => updateRow(i, 'total_donated', e.target.value)} />
                          <div style={{ marginTop: 6, fontSize: 12, color: '#374151' }}>{formatCurrency(r.total_donated)}</div>
                        </td>
                        <td>
                          <input value={r.year || ''} onChange={(e) => updateRow(i, 'year', e.target.value)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
            </table>
          </div>

              <div className="save-mode">
                <label>
                  <input type="radio" name="saveMode" value="merge" checked={saveMode === 'merge'} onChange={() => setSaveMode('merge')} /> Merge (update by phone or add)
                </label>
                <label style={{ marginLeft: 12 }}>
                  <input type="radio" name="saveMode" value="replace" checked={saveMode === 'replace'} onChange={() => setSaveMode('replace')} /> Replace (delete existing, then insert)
                </label>
                {saveMode === 'replace' && (
                  <div className="warning">Warning: Replace will remove all existing donors for this church.</div>
                )}

              </div>

          <div className="actions">
            {churchId ? (
              <button className="btn" onClick={handleSave} disabled={saving}>
                {saving ? 'Guardando...' : 'Guardar en Firestore'}
              </button>
            ) : (
              <div className="note">No se guardará. Para guardar, pasa la prop <strong>churchId</strong>.</div>
            )}
            <button className="btn secondary" onClick={() => { setRows([]); setError(null); }}>
              Limpiar
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default DonorUploader;
