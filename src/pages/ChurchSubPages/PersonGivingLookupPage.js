import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { toast } from 'react-toastify';
import { db } from '../../firebase';
import commonStyles from '../../pages/commonStyles';
import ChurchHeader from '../../components/ChurchHeader';

const hashPin = async (pinValue) => {
  const pin = String(pinValue || '').trim();
  if (!pin) return '';

  if (typeof window !== 'undefined' && window.crypto?.subtle) {
    const encoded = new TextEncoder().encode(pin);
    const digest = await window.crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  return pin;
};

const getPersonDisplayName = (person) => {
  if (!person) return 'Unknown person';
  const firstName = String(person.firstName || '').trim();
  const lastName = String(person.lastName || '').trim();
  return `${firstName} ${lastName}`.trim() || 'Unknown person';
};

const normalizeName = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

const normalizePhone = (value) => String(value || '').replace(/\D/g, '');

const isValidPhoneFormat = (value) => {
  const digits = normalizePhone(value);
  if (digits.length === 10) return true;
  return digits.length === 11 && digits.startsWith('1');
};

const formatPhoneDisplay = (value) => {
  const digits = normalizePhone(value);
  const normalizedDigits = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;

  if (normalizedDigits.length === 10) {
    return `(${normalizedDigits.slice(0, 3)}) ${normalizedDigits.slice(3, 6)}-${normalizedDigits.slice(6)}`;
  }

  return String(value || '').trim() || 'N/A';
};

const formatPhoneInput = (value) => {
  const digits = normalizePhone(value).slice(0, 11);

  const hasLeadingOne = digits.length > 0 && digits[0] === '1';
  const workingDigits = hasLeadingOne ? digits.slice(1, 11) : digits.slice(0, 10);

  const area = workingDigits.slice(0, 3);
  const prefix = workingDigits.slice(3, 6);
  const line = workingDigits.slice(6, 10);

  let formatted = '';
  if (area) {
    formatted = `(${area}`;
    if (area.length === 3) formatted += ')';
  }
  if (prefix) {
    formatted += `${formatted ? ' ' : ''}${prefix}`;
  }
  if (line) {
    formatted += `-${line}`;
  }

  return hasLeadingOne ? `1 ${formatted}`.trim() : formatted;
};

const isPhoneMatch = (inputPhone, savedPhone) => {
  const input = normalizePhone(inputPhone);
  const saved = normalizePhone(savedPhone);
  if (!input || !saved) return false;

  if (input === saved) return true;

  const inputLast10 = input.slice(-10);
  const savedLast10 = saved.slice(-10);
  return inputLast10.length === 10 && savedLast10.length === 10 && inputLast10 === savedLast10;
};

const styles = {
  page: {
    width: '100%',
  },
  container: {
    ...commonStyles.fullWidthContainer,
    maxWidth: '960px',
    margin: '0 auto',
  },
  card: {
    backgroundColor: 'white',
    border: '1px solid #E5E7EB',
    borderRadius: '10px',
    padding: '1rem',
    marginTop: '1rem',
  },
  topActions: {
    display: 'flex',
    gap: '0.75rem',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginTop: '0.5rem',
  },
  navButton: {
    padding: '8px 12px',
    borderRadius: '6px',
    border: '1px solid #D1D5DB',
    backgroundColor: 'white',
    color: '#374151',
    textDecoration: 'none',
    fontWeight: '500',
    cursor: 'pointer',
  },
  row: {
    display: 'grid',
    gridTemplateColumns: '2fr 1fr auto',
    gap: '0.75rem',
    alignItems: 'center',
  },
  filtersRow: {
    display: 'grid',
    gridTemplateColumns: '2fr 1fr 1fr 1fr',
    gap: '0.75rem',
    alignItems: 'end',
    marginTop: '1rem',
  },
  input: {
    padding: '8px',
    borderRadius: '4px',
    border: '1px solid #ddd',
    width: '100%',
  },
  button: {
    padding: '10px 14px',
    backgroundColor: '#4F46E5',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  label: {
    fontSize: '0.9rem',
    color: '#374151',
    marginBottom: '0.35rem',
    display: 'block',
  },
  stat: {
    margin: '0.35rem 0',
    color: '#1F2937',
  },
  tableWrap: {
    marginTop: '0.75rem',
    border: '1px solid #E5E7EB',
    borderRadius: '8px',
    overflowX: 'auto',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    minWidth: '640px',
  },
  th: {
    textAlign: 'left',
    padding: '10px',
    borderBottom: '1px solid #E5E7EB',
    backgroundColor: '#F9FAFB',
  },
  td: {
    padding: '10px',
    borderBottom: '1px solid #F3F4F6',
  },
  helperText: {
    margin: '0.5rem 0 0',
    color: '#4B5563',
    fontSize: '0.9rem',
  },
  mutedText: {
    color: '#6B7280',
    fontSize: '0.9rem',
  },
};

const responsiveStyles = `
  @media (max-width: 900px) {
    .person-lookup-row {
      grid-template-columns: 1fr;
    }

    .person-lookup-filters-row {
      grid-template-columns: 1fr;
    }

    .person-lookup-top-actions {
      width: 100%;
    }

    .person-lookup-top-actions a,
    .person-lookup-top-actions button {
      width: 100%;
      text-align: center;
      justify-content: center;
    }
  }

  @media (max-width: 640px) {
    .person-lookup-container {
      padding-left: 10px;
      padding-right: 10px;
    }

    .person-lookup-title {
      font-size: 1.35rem;
    }
  }
`;

const PersonGivingLookupPage = () => {
  const { id } = useParams();
  const [people, setPeople] = useState([]);
  const [finances, setFinances] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lookup, setLookup] = useState({ fullName: '', phone: '', pin: '' });
  const [matchedPersonId, setMatchedPersonId] = useState('');
  const [verifiedPersonId, setVerifiedPersonId] = useState('');
  const [period, setPeriod] = useState('month');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    const loadData = async () => {
      try {
        const [peopleSnapshot, financesSnapshot] = await Promise.all([
          getDocs(collection(db, `churches/${id}/financePeople`)),
          getDocs(query(collection(db, `churches/${id}/finances`), orderBy('date', 'desc'))),
        ]);

        const loadedPeople = peopleSnapshot.docs
          .map((item) => ({ id: item.id, ...item.data() }))
          .sort((a, b) => getPersonDisplayName(a).localeCompare(getPersonDisplayName(b)));

        const loadedFinances = financesSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));

        setPeople(loadedPeople);
        setFinances(loadedFinances);
      } catch (error) {
        console.error('Failed to load person giving data:', error);
        toast.error('Failed to load lookup data');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [id]);

  const selectedPerson = useMemo(
    () => people.find((person) => person.id === verifiedPersonId) || null,
    [people, verifiedPersonId]
  );

  const matchedPerson = useMemo(
    () => people.find((person) => person.id === matchedPersonId) || null,
    [people, matchedPersonId]
  );

  const personTransactions = useMemo(() => {
    if (!verifiedPersonId) return [];
    return finances
      .filter((finance) => finance.personId === verifiedPersonId)
      .sort((a, b) => new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0));
  }, [finances, verifiedPersonId]);

  const getDateRange = () => {
    const now = new Date();

    if (period === 'week') {
      const start = new Date(now);
      const day = start.getDay();
      start.setDate(start.getDate() - day);
      start.setHours(0, 0, 0, 0);

      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }

    if (period === 'month') {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      start.setHours(0, 0, 0, 0);

      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }

    if (period === 'custom' && customStartDate && customEndDate) {
      const start = new Date(customStartDate);
      const end = new Date(customEndDate);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }

    return null;
  };

  const filteredTransactions = useMemo(() => {
    let rows = [...personTransactions];

    const dateRange = getDateRange();
    if (dateRange) {
      rows = rows.filter((entry) => {
        const entryDate = new Date(entry.date || entry.createdAt || 0);
        return entryDate >= dateRange.start && entryDate <= dateRange.end;
      });
    }

    const queryText = searchTerm.trim().toLowerCase();
    if (queryText) {
      rows = rows.filter((entry) => {
        const haystack = [
          entry.title,
          entry.description,
          entry.category,
          entry.type,
          entry.fundType,
          entry.typeOfFunds,
          String(entry.amount ?? ''),
          new Date(entry.date || entry.createdAt || 0).toLocaleDateString(),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        return haystack.includes(queryText);
      });
    }

    return rows;
  }, [personTransactions, period, customStartDate, customEndDate, searchTerm]);

  const totals = useMemo(() => {
    return filteredTransactions.reduce(
      (acc, finance) => {
        const amount = Number(finance.amount || 0);
        if (finance.type === 'income') {
          acc.income += amount;
        } else {
          acc.expense += amount;
        }
        return acc;
      },
      { income: 0, expense: 0 }
    );
  }, [filteredTransactions]);

  const handleValidateIdentity = () => {
    const requestedName = normalizeName(lookup.fullName);
    const requestedPhone = normalizePhone(lookup.phone);

    if (!requestedName || !requestedPhone) {
      toast.error('Enter full name and phone number');
      return;
    }

    if (!isValidPhoneFormat(lookup.phone)) {
      toast.error('Phone must be in a valid format (10 digits, or 11 digits starting with 1)');
      return;
    }

    const match = people.find((person) => {
      const personName = normalizeName(getPersonDisplayName(person));
      return personName === requestedName && isPhoneMatch(requestedPhone, person.phone);
    });

    if (!match) {
      setMatchedPersonId('');
      setVerifiedPersonId('');
      toast.error('Name and phone did not match our records');
      return;
    }

    setMatchedPersonId(match.id);
    setVerifiedPersonId('');
    toast.success(`Identity verified for ${getPersonDisplayName(match)} (${formatPhoneDisplay(match.phone)}). Enter your PIN to continue.`);
  };

  const handleLookup = async () => {
    const person = people.find((item) => item.id === matchedPersonId);
    if (!person) {
      toast.error('Verify your name and phone first');
      return;
    }

    const enteredPinHash = await hashPin(lookup.pin);
    const storedHash = person.pinHash || person.pin || '';
    if (!enteredPinHash || enteredPinHash !== storedHash) {
      setVerifiedPersonId('');
      toast.error('Invalid PIN');
      return;
    }

    setVerifiedPersonId(person.id);
  };

  return (
    <div style={styles.page}>
      <style>{responsiveStyles}</style>
      <ChurchHeader id={id} applyShadow={false} />
      <div style={styles.container} className="person-lookup-container">
        <div style={styles.topActions} className="person-lookup-top-actions">
          <Link to={`/organization/${id}/finances`} style={styles.navButton}>
            ← Back to Finances
          </Link>
        </div>
        <h2 style={commonStyles.title} className="person-lookup-title">Person Giving Lookup</h2>

        <div style={styles.card}>
          <p style={{ marginTop: 0, color: '#4B5563' }}>
            Enter your full name and phone number first. If it matches, you can enter your PIN to see only your transactions.
          </p>
          <div style={styles.row} className="person-lookup-row">
            <div>
              <label style={styles.label}>Full Name</label>
              <input
                type="text"
                value={lookup.fullName}
                onChange={(e) => {
                  setLookup((prev) => ({ ...prev, fullName: e.target.value }));
                  setMatchedPersonId('');
                  setVerifiedPersonId('');
                }}
                placeholder="e.g. Maria Lopez"
                style={styles.input}
              />
            </div>

            <div>
              <label style={styles.label}>Phone Number</label>
              <input
                type="tel"
                value={lookup.phone}
                onChange={(e) => {
                  const formattedPhone = formatPhoneInput(e.target.value);
                  setLookup((prev) => ({ ...prev, phone: formattedPhone }));
                  setMatchedPersonId('');
                  setVerifiedPersonId('');
                }}
                placeholder="e.g. 787-555-1234"
                style={styles.input}
                maxLength={15}
              />
            </div>

            <button type="button" onClick={handleValidateIdentity} style={styles.button} disabled={loading}>
              Validate
            </button>
          </div>

          {matchedPerson && !verifiedPersonId && (
            <>
              <p style={styles.helperText}>
                Identity matched for <strong>{getPersonDisplayName(matchedPerson)}</strong>. Enter PIN to continue.
              </p>
              <p style={styles.helperText}>Phone validated: <strong>{formatPhoneDisplay(matchedPerson.phone)}</strong></p>
              <div style={styles.row} className="person-lookup-row">
                <div>
                  <label style={styles.label}>PIN</label>
                  <input
                    type="password"
                    inputMode="numeric"
                    value={lookup.pin}
                    onChange={(e) => {
                      setLookup((prev) => ({ ...prev, pin: e.target.value }));
                      setVerifiedPersonId('');
                    }}
                    placeholder="Enter PIN"
                    style={styles.input}
                  />
                </div>
                <div />
                <button type="button" onClick={handleLookup} style={styles.button} disabled={loading}>
                  View Transactions
                </button>
              </div>
            </>
          )}
        </div>

        {verifiedPersonId && selectedPerson && (
          <div style={styles.card}>
            <h3 style={{ marginTop: 0 }}>{getPersonDisplayName(selectedPerson)}</h3>
            <p style={styles.stat}>Phone: {formatPhoneDisplay(selectedPerson.phone)}</p>
            <p style={styles.stat}>Transactions Shown: {filteredTransactions.length}</p>
            <p style={styles.stat}>Income: ${totals.income.toFixed(2)}</p>
            <p style={styles.stat}>Expenses: ${totals.expense.toFixed(2)}</p>
            <p style={styles.stat}>Net: ${(totals.income - totals.expense).toFixed(2)}</p>

            <div style={styles.filtersRow} className="person-lookup-filters-row">
              <div>
                <label style={styles.label}>Search Transactions</label>
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search title, category, amount, date..."
                  style={styles.input}
                />
              </div>

              <div>
                <label style={styles.label}>Range</label>
                <select
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                  style={styles.input}
                >
                  <option value="week">This Week</option>
                  <option value="month">This Month</option>
                  <option value="custom">Custom</option>
                </select>
              </div>

              {period === 'custom' && (
                <>
                  <div>
                    <label style={styles.label}>Start Date</label>
                    <input
                      type="date"
                      value={customStartDate}
                      onChange={(e) => setCustomStartDate(e.target.value)}
                      style={styles.input}
                    />
                  </div>

                  <div>
                    <label style={styles.label}>End Date</label>
                    <input
                      type="date"
                      value={customEndDate}
                      onChange={(e) => setCustomEndDate(e.target.value)}
                      style={styles.input}
                    />
                  </div>
                </>
              )}
            </div>

            <div style={styles.tableWrap}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Date</th>
                    <th style={styles.th}>Title</th>
                    <th style={styles.th}>Type</th>
                    <th style={styles.th}>Category</th>
                    <th style={styles.th}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTransactions.map((entry) => (
                    <tr key={entry.id}>
                      <td style={styles.td}>{new Date(entry.date).toLocaleDateString()}</td>
                      <td style={styles.td}>{entry.title}</td>
                      <td style={styles.td}>{entry.type}</td>
                      <td style={styles.td}>{entry.category || 'Uncategorized'}</td>
                      <td
                        style={{
                          ...styles.td,
                          color: entry.type === 'income' ? '#059669' : '#DC2626',
                          fontWeight: '600',
                        }}
                      >
                        {entry.type === 'income' ? '+' : '-'} ${Number(entry.amount || 0).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                  {filteredTransactions.length === 0 && (
                    <tr>
                      <td style={styles.td} colSpan={5}>
                        <span style={styles.mutedText}>No transactions match your current filters.</span>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PersonGivingLookupPage;
