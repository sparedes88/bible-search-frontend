import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { toast } from 'react-toastify';
import { db } from '../firebase';
import commonStyles from '../pages/commonStyles';

const normalizeCount = (value) => {
  const count = Number(value);
  return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
};

const EventAttendanceCounter = () => {
  const { id, eventId } = useParams();
  const [event, setEvent] = useState(null);
  const [eventCollection, setEventCollection] = useState('');
  const [counts, setCounts] = useState({ adults: 0, children: 0 });
  const [savedCounts, setSavedCounts] = useState({ adults: 0, children: 0 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    const loadEvent = async () => {
      setLoading(true);
      setError('');
      for (const collectionName of ['eventInstances', 'events']) {
        try {
          const eventSnapshot = await getDoc(doc(db, collectionName, eventId));
          if (!eventSnapshot.exists()) continue;
          const eventData = { id: eventSnapshot.id, ...eventSnapshot.data() };
          const initialCounts = {
            adults: normalizeCount(eventData.attendanceCounts?.adults),
            children: normalizeCount(eventData.attendanceCounts?.children),
          };
          if (active) {
            setEvent(eventData);
            setEventCollection(collectionName);
            setCounts(initialCounts);
            setSavedCounts(initialCounts);
          }
          return;
        } catch (loadError) {
          console.error(`Error loading event from ${collectionName}:`, loadError);
        }
      }
      if (active) setError('Could not load this event. Check your access and try again.');
    };

    loadEvent().finally(() => {
      if (active) setLoading(false);
    });

    return () => { active = false; };
  }, [eventId]);

  const adjustCount = (field, amount) => {
    setCounts(previous => ({ ...previous, [field]: Math.max(0, previous[field] + amount) }));
  };

  const hasChanges = counts.adults !== savedCounts.adults || counts.children !== savedCounts.children;

  const saveCounts = async () => {
    if (!eventCollection || !eventId || saving || !hasChanges) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, eventCollection, eventId), {
        attendanceCounts: counts,
        attendanceCountsUpdatedAt: serverTimestamp(),
      });
      setSavedCounts(counts);
      toast.success('Attendance totals saved');
    } catch (saveError) {
      console.error('Error saving attendance totals:', saveError);
      toast.error('Failed to save attendance totals');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main style={{ ...commonStyles.fullWidthContainer, minHeight: '100vh', textAlign: 'left' }}>
      <Link to={`/organization/${id}/event/${eventId}`} style={commonStyles.backButtonLink}>
        Back to event
      </Link>
      {loading ? (
        <p>Loading event counter...</p>
      ) : error ? (
        <p role="alert">{error}</p>
      ) : (
        <div style={{ width: '100%', maxWidth: '1000px', margin: '0 auto' }}>
          <header style={{ margin: '20px 0 28px' }}>
            <p style={{ color: '#0F766E', fontWeight: 700, marginBottom: 6 }}>EVENT ATTENDANCE</p>
            <h1 style={{ ...commonStyles.title, textAlign: 'left', marginBottom: 8 }}>People Counter</h1>
            <p style={{ color: '#64748B', margin: 0 }}>{event?.title || event?.instanceTitle || 'Event'}</p>
          </header>

          <section aria-label="Attendance totals" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
            {[
              { field: 'adults', label: 'Adults' },
              { field: 'children', label: 'Children' },
            ].map(({ field, label }) => (
              <div key={field} style={{ border: '1px solid #E2E8F0', borderRadius: 8, padding: 20, background: '#FFFFFF' }}>
                <h2 style={{ fontSize: 18, margin: '0 0 18px' }}>{label}</h2>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                  <button
                    type="button"
                    aria-label={`Decrease ${label.toLowerCase()}`}
                    onClick={() => adjustCount(field, -1)}
                    disabled={counts[field] === 0}
                    style={{ width: 52, height: 52, fontSize: 26, border: '1px solid #CBD5E1', borderRadius: 6, background: '#F8FAFC', cursor: counts[field] === 0 ? 'not-allowed' : 'pointer' }}
                  >
                    -
                  </button>
                  <output aria-label={`${label} total`} style={{ minWidth: 88, textAlign: 'center', fontSize: 42, fontWeight: 700, color: '#0F172A' }}>
                    {counts[field]}
                  </output>
                  <button
                    type="button"
                    aria-label={`Increase ${label.toLowerCase()}`}
                    onClick={() => adjustCount(field, 1)}
                    style={{ width: 52, height: 52, fontSize: 26, border: 'none', borderRadius: 6, background: '#0F766E', color: '#FFFFFF', cursor: 'pointer' }}
                  >
                    +
                  </button>
                </div>
              </div>
            ))}
          </section>

          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 20 }}>
            <button type="button" onClick={saveCounts} disabled={saving || !hasChanges} style={{ padding: '10px 18px', border: 0, borderRadius: 6, color: '#FFFFFF', background: saving || !hasChanges ? '#94A3B8' : '#0F766E', cursor: saving || !hasChanges ? 'not-allowed' : 'pointer', fontWeight: 600 }}>
              {saving ? 'Saving...' : 'Save totals'}
            </button>
            <span role="status" style={{ color: '#64748B' }}>{hasChanges ? 'Unsaved changes' : 'All totals saved'}</span>
          </div>
        </div>
      )}
    </main>
  );
};

export default EventAttendanceCounter;