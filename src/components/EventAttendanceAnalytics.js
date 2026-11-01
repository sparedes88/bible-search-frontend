import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import commonStyles from '../pages/commonStyles';

const countValue = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
};

const getMonthKey = (value) => {
  if (!value) return '';
  if (typeof value?.toDate === 'function') value = value.toDate();
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`;
  }
  if (typeof value !== 'string') return '';
  const monthDayYear = value.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (monthDayYear) return `${monthDayYear[3]}-${monthDayYear[1]}`;
  const yearMonthDay = value.match(/^(\d{4})-(\d{2})-\d{2}/);
  return yearMonthDay ? `${yearMonthDay[1]}-${yearMonthDay[2]}` : '';
};

const formatMonthLabel = (monthKey) => {
  const [year, month] = monthKey.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
};

const EventAttendanceAnalytics = () => {
  const { id } = useParams();
  const [events, setEvents] = useState([]);
  const [selectedMonth, setSelectedMonth] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const loadEvents = async () => {
      setLoading(true);
      setError('');
      const collections = ['eventInstances', 'events'];
      const results = await Promise.allSettled(collections.map(async collectionName => {
        const eventQuery = query(
          collection(db, collectionName),
          where('churchId', '==', id)
        );
        const snapshot = await getDocs(eventQuery);
        return snapshot.docs.map(eventDoc => ({
          id: eventDoc.id,
          eventCollection: collectionName,
          ...eventDoc.data(),
        }));
      }));

      const fulfilledResults = results.filter(result => result.status === 'fulfilled');
      if (!fulfilledResults.length) {
        if (active) setError('Could not load event attendance totals. Check your access and try again.');
      } else {
        const eventById = new Map();
        fulfilledResults.forEach(result => result.value.forEach(event => {
          if (!event.removed && !event.isDeleted && !eventById.has(event.id)) {
            eventById.set(event.id, event);
          }
        }));
        const rows = Array.from(eventById.values()).map(event => {
          const adults = countValue(event.attendanceCounts?.adults);
          const children = countValue(event.attendanceCounts?.children);
          return { ...event, adults, children, total: adults + children };
        }).sort((first, second) => (first.title || first.instanceTitle || '').localeCompare(second.title || second.instanceTitle || ''));
        if (active) setEvents(rows);
      }

      if (active) setLoading(false);
    };

    if (id) loadEvents().catch(loadError => {
      console.error('Error loading event attendance analytics:', loadError);
      if (active) {
        setError('Could not load event attendance totals. Check your access and try again.');
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, [id]);

  const monthOptions = Array.from(new Set(events
    .map(event => getMonthKey(event.startDate || event.date))
    .filter(Boolean)))
    .sort((first, second) => second.localeCompare(first));
  const reportEvents = selectedMonth === 'all'
    ? events
    : events.filter(event => getMonthKey(event.startDate || event.date) === selectedMonth);
  const reportTotals = reportEvents.reduce((totals, event) => ({
    adults: totals.adults + event.adults,
    children: totals.children + event.children,
    total: totals.total + event.total,
  }), { adults: 0, children: 0, total: 0 });

  return (
    <main style={{ ...commonStyles.fullWidthContainer, minHeight: '100vh', textAlign: 'left' }}>
      <Link to={`/organization/${id}/all-events`} style={commonStyles.backButtonLink}>
        Back to all events
      </Link>
      <div style={{ width: '100%', maxWidth: '1200px', margin: '20px auto' }}>
        <header style={{ marginBottom: 24 }}>
          <p style={{ color: '#0F766E', fontWeight: 700, marginBottom: 6 }}>EVENT ATTENDANCE</p>
          <h1 style={{ ...commonStyles.title, textAlign: 'left', marginBottom: 8 }}>Counter Analytics</h1>
          <p style={{ color: '#64748B', margin: 0 }}>Adult and child totals for each event</p>
        </header>

        {loading ? (
          <p>Loading event totals...</p>
        ) : error ? (
          <p role="alert">{error}</p>
        ) : events.length === 0 ? (
          <p>No events found for this organization.</p>
        ) : (
          <div>
            <label htmlFor="counter-report-month" style={{ display: 'block', fontWeight: 600, marginBottom: 8 }}>
              Report month
            </label>
            <select
              id="counter-report-month"
              aria-label="Report month"
              value={selectedMonth}
              onChange={event => setSelectedMonth(event.target.value)}
              style={{ width: '100%', maxWidth: 360, padding: '10px 12px', border: '1px solid #CBD5E1', borderRadius: 6, background: '#FFFFFF', marginBottom: 20 }}
            >
              <option value="all">All months</option>
              {monthOptions.map(month => <option key={month} value={month}>{formatMonthLabel(month)}</option>)}
            </select>

            <section aria-label="Report totals" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
              {[
                ['Adults', reportTotals.adults],
                ['Children', reportTotals.children],
                ['Total attendance', reportTotals.total],
              ].map(([label, total]) => (
                <div key={label} style={{ border: '1px solid #E2E8F0', borderRadius: 6, padding: 14, background: '#FFFFFF' }}>
                  <div style={{ color: '#64748B', fontSize: 14 }}>{label}</div>
                  <output aria-label={`Monthly ${label.toLowerCase()}`} style={{ fontSize: 24, fontWeight: 700 }}>{total}</output>
                </div>
              ))}
            </section>

            {reportEvents.length === 0 ? (
              <p>No events found for {formatMonthLabel(selectedMonth)}.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', background: '#FFFFFF' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '2px solid #CBD5E1' }}>
                  <th scope="col" style={{ padding: '12px 10px' }}>Event</th>
                  <th scope="col" style={{ padding: '12px 10px' }}>Date</th>
                  <th scope="col" style={{ padding: '12px 10px', textAlign: 'right' }}>Adults</th>
                  <th scope="col" style={{ padding: '12px 10px', textAlign: 'right' }}>Children</th>
                  <th scope="col" style={{ padding: '12px 10px', textAlign: 'right' }}>Total</th>
                  <th scope="col" style={{ padding: '12px 10px' }}><span className="visually-hidden">Counter</span></th>
                </tr>
              </thead>
              <tbody>
                {reportEvents.map(event => (
                  <tr key={`${event.eventCollection}-${event.id}`} style={{ borderBottom: '1px solid #E2E8F0' }}>
                    <th scope="row" style={{ padding: '12px 10px', fontWeight: 600 }}>
                      {event.title || event.instanceTitle || 'Untitled event'}
                    </th>
                    <td style={{ padding: '12px 10px', color: '#64748B' }}>{event.startDate || event.date || 'Date not set'}</td>
                    <td style={{ padding: '12px 10px', textAlign: 'right' }}>{event.adults}</td>
                    <td style={{ padding: '12px 10px', textAlign: 'right' }}>{event.children}</td>
                    <td style={{ padding: '12px 10px', textAlign: 'right', fontWeight: 700 }}>{event.total}</td>
                    <td style={{ padding: '12px 10px', textAlign: 'right' }}>
                      <Link to={`/organization/${id}/event/${event.id}/counter`} style={{ color: '#0F766E', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        Open counter
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
};

export default EventAttendanceAnalytics;