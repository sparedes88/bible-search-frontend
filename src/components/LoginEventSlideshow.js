import React, { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { getDownloadURL, ref } from 'firebase/storage';
import { endOfWeek, format, isValid, isWithinInterval, parse, startOfWeek } from 'date-fns';
import { MdChevronLeft, MdChevronRight, MdEvent, MdHowToReg, MdPause, MdPlayArrow } from 'react-icons/md';
import { db, storage } from '../firebase';
import { formatAnnouncementTime } from '../utils/eventAnnouncementLayout';

const parseEventDate = value => {
  if (typeof value !== 'string') return null;
  const pattern = /^\d{4}-\d{2}-\d{2}$/.test(value) ? 'yyyy-MM-dd' : /^\d{2}-\d{2}-\d{4}$/.test(value) ? 'MM-dd-yyyy' : '';
  if (!pattern) return null;
  const date = parse(value, pattern, new Date(2000, 0, 1));
  return isValid(date) ? date : null;
};

export const getLoginWeekEvents = (events, now = new Date()) => {
  const interval = { start: startOfWeek(now, { weekStartsOn: 0 }), end: endOfWeek(now, { weekStartsOn: 0 }) };
  return events.filter(event => {
    const date = parseEventDate(event.startDate || event.date);
    return date && !event.removed && !event.isDeleted && !['cancelled', 'canceled'].includes(String(event.status || '').toLowerCase()) && isWithinInterval(date, interval);
  }).sort((first, second) => parseEventDate(first.startDate || first.date) - parseEventDate(second.startDate || second.date) || String(first.startHour || '').localeCompare(String(second.startHour || '')));
};

const LoginEventSlideshow = ({ organizationId }) => {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(() => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches));
  const [interacting, setInteracting] = useState(false);
  const [imageErrors, setImageErrors] = useState({});

  useEffect(() => {
    if (!organizationId) return;
    let active = true;
    setLoading(true);
    setFailed(false);
    setEvents([]);
    setActiveIndex(0);
    const loadEvents = async () => {
      try {
        const snapshot = await getDocs(query(collection(db, 'eventInstances'), where('churchId', '==', String(organizationId))));
        const weekEvents = getLoginWeekEvents(snapshot.docs.map(document => ({ ...document.data(), id: document.id })).filter(event => String(event.churchId) === String(organizationId)));
        const resolved = await Promise.all(weekEvents.map(async event => {
          if (!event.imageUrl) return { ...event, slideImageUrl: '' };
          try {
            const slideImageUrl = /^https?:\/\//i.test(event.imageUrl) ? event.imageUrl : await getDownloadURL(ref(storage, String(event.imageUrl).replace(/^\//, '')));
            return { ...event, slideImageUrl };
          } catch (error) {
            return { ...event, slideImageUrl: '' };
          }
        }));
        if (active) setEvents(resolved);
      } catch (error) {
        if (active) setFailed(true);
      } finally {
        if (active) setLoading(false);
      }
    };
    loadEvents();
    return () => { active = false; };
  }, [organizationId]);

  useEffect(() => {
    if (events.length < 2 || paused || interacting) return;
    const timer = setInterval(() => setActiveIndex(index => (index + 1) % events.length), 6000);
    return () => clearInterval(timer);
  }, [events.length, paused, interacting]);

  if (!organizationId) return null;
  if (loading) return <div className="login-week-events-loading" role="status">Loading this week&apos;s events...</div>;
  if (failed) return <p className="login-week-events-unavailable" role="status">This week&apos;s events are temporarily unavailable.</p>;
  if (!events.length) return null;
  const event = events[activeIndex] || events[0];
  const title = event.instanceTitle || event.title || 'Event';
  const time = [formatAnnouncementTime(event.startHour), formatAnnouncementTime(event.endHour)].filter(Boolean).join(' - ');
  const changeSlide = direction => setActiveIndex(index => (index + direction + events.length) % events.length);

  return (
    <section className="login-week-events" aria-label="This week's events" aria-roledescription="carousel" onMouseEnter={() => setInteracting(true)} onMouseLeave={() => setInteracting(false)} onFocusCapture={() => setInteracting(true)} onBlurCapture={blur => { if (!blur.currentTarget.contains(blur.relatedTarget)) setInteracting(false); }}>
      <div className="login-week-events-heading"><h2>This week</h2><span>{format(startOfWeek(new Date(), { weekStartsOn: 0 }), 'MMM dd')} - {format(endOfWeek(new Date(), { weekStartsOn: 0 }), 'MMM dd')}</span></div>
      <div className="login-week-event-slide" role="group" aria-roledescription="slide" aria-label={`${activeIndex + 1} of ${events.length}`} aria-live={paused || interacting ? 'polite' : 'off'}>
        <div className="login-week-event-media">
          {event.slideImageUrl && !imageErrors[event.id] ? <img key={event.id} src={event.slideImageUrl} alt={title} onError={() => setImageErrors(previous => ({ ...previous, [event.id]: true }))} /> : <div className="login-week-event-placeholder"><MdEvent size={48} aria-hidden="true" /><span>{title}</span></div>}
        </div>
        <div className="login-week-event-caption">
          <h3>{title}</h3>
          <p><time>{format(parseEventDate(event.startDate || event.date), 'EEEE, MMMM dd, yyyy')}</time>{time && <span> | {time}</span>}</p>
          {event.location && <p className="login-week-event-location">{event.location}</p>}
          <a className="login-week-event-register" href={`/organization/${encodeURIComponent(organizationId)}/event/${encodeURIComponent(event.id)}/register`} aria-label={`Register for ${title}`}><MdHowToReg size={20} aria-hidden="true" /> Register for this event</a>
        </div>
      </div>
      {events.length > 1 && <div className="login-week-events-controls">
        <button type="button" aria-label="Previous event" title="Previous event" onClick={() => changeSlide(-1)}><MdChevronLeft size={24} /></button>
        <span className="login-week-events-counter" aria-live="polite">{activeIndex + 1} / {events.length}</span>
        <button type="button" aria-label={paused ? 'Play event slideshow' : 'Pause event slideshow'} title={paused ? 'Play slideshow' : 'Pause slideshow'} onClick={() => { if (paused) setInteracting(false); setPaused(previous => !previous); }}>{paused ? <MdPlayArrow size={21} /> : <MdPause size={21} />}</button>
        <button type="button" aria-label="Next event" title="Next event" onClick={() => changeSlide(1)}><MdChevronRight size={24} /></button>
      </div>}
    </section>
  );
};

export default LoginEventSlideshow;