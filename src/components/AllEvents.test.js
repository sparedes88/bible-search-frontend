import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { addDoc, getDocs, updateDoc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import AllEvents from './AllEvents';
import { downloadEventImage } from '../utils/downloadEventImage';
import { getEventDesignDetails } from '../utils/eventDesignDetails';

jest.mock('../utils/downloadEventImage', () => ({ downloadEventImage: jest.fn() }));

jest.mock('../firebase', () => ({ db: {}, storage: { bucket: 'configured-bucket' } }));
jest.mock('firebase/storage', () => ({
  ref: jest.fn((_storage, path) => path),
  getDownloadURL: jest.fn(),
  uploadBytes: jest.fn(),
}));
jest.mock('./ChurchHeader', () => () => null);
jest.mock('../contexts/AuthContext', () => {
  let user = { uid: 'admin-user', role: 'admin', baseRole: 'admin', churchId: 'test-org' };
  return {
    useAuth: () => ({ user, loading: false }),
    setTestUser: nextUser => { user = nextUser; },
  };
});
jest.mock('react-toastify', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('firebase/firestore', () => ({
  collection: (_database, ...segments) => segments.join('/'),
  query: (reference, ...constraints) => ({ reference, constraints }),
  where: (...args) => args,
  getDocs: jest.fn(),
  doc: (_database, ...segments) => segments.join('/'),
  getDoc: jest.fn(),
  addDoc: jest.fn(),
  updateDoc: jest.fn(),
  deleteDoc: jest.fn(),
  writeBatch: jest.fn(),
  serverTimestamp: () => 'server-time',
}));

let container;
let root;
let createdEventNumber;
let eventDocuments;

const render = async () => {
  await act(async () => root.render(
    <MemoryRouter initialEntries={['/organization/test-org/all-events']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/organization/:id/all-events" element={<AllEvents />} />
        <Route path="/organization/:id/event/:eventId/design" element={<p>Event design studio</p>} />
        <Route path="/organization/:id/all-events/counter-analytics" element={<p>Analytics overview</p>} />
        <Route path="/organization/:id/login" element={<p>Organization sign in</p>} />
        <Route path="/organization/:id/mi-organizacion" element={<p>Mi Organización overview</p>} />
      </Routes>
    </MemoryRouter>
  ));
};

const change = async (element, value) => {
  await act(async () => Simulate.change(element, { target: { value } }));
};

beforeEach(() => {
  jest.clearAllMocks();
  ref.mockImplementation((_storage, path) => path);
  jest.requireMock('../contexts/AuthContext').setTestUser({ uid: 'admin-user', role: 'admin', baseRole: 'admin', churchId: 'test-org' });
  createdEventNumber = 0;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  const campuses = [
    { id: 'campus-a', data: () => ({ name: 'Main Campus' }) },
    { id: 'campus-b', data: () => ({ name: 'North Campus' }) },
  ];
  const rooms = [
    { id: 'room-a', data: () => ({ name: 'Sanctuary', campusId: 'campus-a' }) },
    { id: 'room-b', data: () => ({ name: 'Classroom', campusId: 'campus-b' }) },
  ];
  eventDocuments = [
    { id: 'event-nov-10', data: () => ({ churchId: 'test-org', title: 'Later November', startDate: '11-10-2026' }) },
    { id: 'event-oct', data: () => ({ churchId: 'test-org', title: 'October Event', startDate: '2026-10-28', startHour: '19:00', endHour: '20:30', campusId: 'campus-a', roomId: 'room-a', venueGroups: [{ id: 'group-a', name: 'Choir' }] }) },
    { id: 'event-nov-02', data: () => ({ churchId: 'test-org', title: 'Earlier November', startDate: '11-02-2026' }) },
  ];
  const groups = [
    { id: 'group-a', data: () => ({ churchId: 'test-org', groupName: 'Choir' }) },
    { id: 'group-b', data: () => ({ churchId: 'test-org', groupName: 'Youth' }) },
  ];
  getDocs.mockImplementation(async target => {
    const reference = typeof target === 'string' ? target : target.reference;
    const constraints = typeof target === 'string' ? [] : target.constraints || [];
    const seriesConstraint = constraints.find(constraint => constraint[0] === 'recurrenceSeriesId');
    const docs = reference === 'churches/test-org/campuses' ? campuses
      : reference === 'churches/test-org/rooms' ? rooms
        : reference === 'groups' ? groups
        : reference === 'eventInstances' ? (seriesConstraint
          ? eventDocuments.filter(eventDoc => eventDoc.data().recurrenceSeriesId === seriesConstraint[2])
          : eventDocuments)
        : [];
    return { docs };
  });
  addDoc.mockImplementation(async () => ({ id: `created-event-${++createdEventNumber}` }));
  updateDoc.mockResolvedValue(undefined);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

test('full-width event form filters rooms by campus and saves the selection', async () => {
  await render();
  expect(container.firstElementChild.style.width).toBe('100%');
  expect(container.firstElementChild.style.maxWidth).toBe('100%');

  const addEventButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Add New Event');
  await act(async () => Simulate.click(addEventButton));

  const campusSelect = container.querySelector('[aria-label="Event campus"]');
  const roomSelect = container.querySelector('[aria-label="Event room"]');
  expect(roomSelect.disabled).toBe(true);
  await change(campusSelect, 'campus-a');
  expect(Array.from(roomSelect.options).map(option => option.textContent)).toEqual(['Select a room', 'Sanctuary']);
  await change(roomSelect, 'room-a');

  await act(async () => Simulate.click(Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Select all')));

  const form = container.querySelector('form');
  await change(form.querySelector('input[placeholder="e.g. Sunday gathering"]'), 'Sunday Service');
  await change(form.querySelector('input[type="date"]'), '2026-11-01');
  await change(form.querySelector('input[type="time"]'), '10:00');
  await act(async () => Simulate.submit(form));

  expect(addDoc).toHaveBeenCalledWith('eventInstances', expect.objectContaining({
    campusId: 'campus-a', campusName: 'Main Campus', roomId: 'room-a', roomName: 'Sanctuary',
    venueGroups: [{ id: 'group-a', name: 'Choir' }, { id: 'group-b', name: 'Youth' }],
    location: 'Main Campus - Sanctuary',
  }));
  expect(container.textContent).toContain('Groups:Choir, Youth');
});

test('the default back button returns to Mi Organización', async () => {
  await render();
  const backButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent.includes('Back to Mi Organización'));
  expect(backButton).toBeDefined();
  await act(async () => Simulate.click(backButton));
  expect(container.textContent).toContain('Mi Organización overview');
});

test('event cards resolve uploaded images using configured storage and preserve direct URLs', async () => {
  const uploadedPath = 'events/test-org/event-oct/uploaded-photo.jpg';
  const downloadUrl = 'https://firebasestorage.googleapis.com/configured-photo?alt=media&token=test';
  const directUrl = 'https://example.com/event.jpg';
  eventDocuments = [
    { id: 'uploaded', data: () => ({ title: 'Uploaded image', startDate: '2026-10-28', imageUrl: `/${uploadedPath}` }) },
    { id: 'direct', data: () => ({ title: 'Direct image', startDate: '2026-10-29', imageUrl: directUrl }) },
    { id: 'missing', data: () => ({ title: 'Missing image', startDate: '2026-10-30', imageUrl: 'events/missing.jpg' }) },
  ];
  getDownloadURL.mockImplementation(async path => {
    if (path === uploadedPath) return downloadUrl;
    throw new Error('Image not found');
  });

  await render();

  expect(ref).toHaveBeenCalledWith(jest.requireMock('../firebase').storage, uploadedPath);
  expect(container.querySelector('img[alt="Uploaded image"]').getAttribute('src')).toBe(downloadUrl);
  expect(container.querySelector('img[alt="Direct image"]').getAttribute('src')).toBe(directUrl);
  expect(getDownloadURL).toHaveBeenCalledTimes(2);
  expect(container.querySelectorAll('.event-img')[2].textContent).toBe('M');

  await act(async () => Simulate.error(container.querySelector('img[alt="Uploaded image"]')));
  expect(container.querySelectorAll('.event-img')[0].textContent).toBe('U');
});

test('uploads an image from the event card and immediately displays it', async () => {
  uploadBytes.mockResolvedValue({});
  getDownloadURL.mockResolvedValue('https://example.com/uploaded.jpg');
  await render();
  const file = new File(['photo'], 'card-photo.png', { type: 'image/png' });
  const input = container.querySelector('[aria-label="Event image for October Event"]');
  await act(async () => Simulate.change(input, { target: { files: [file], value: 'card-photo.png' } }));

  const uploadedPath = uploadBytes.mock.calls[0][0];
  expect(uploadedPath).toMatch(/^events\/test-org\/event-oct\/\d+_card-photo\.png$/);
  expect(uploadBytes).toHaveBeenCalledWith(uploadedPath, file);
  expect(updateDoc).toHaveBeenCalledWith('eventInstances/event-oct', expect.objectContaining({ imageUrl: uploadedPath }));
  expect(container.querySelector('img[alt="October Event"]').getAttribute('src')).toBe('https://example.com/uploaded.jpg');
});

test('rejects invalid images and preserves the card when an upload fails', async () => {
  await render();
  const input = container.querySelector('[aria-label="Event image for October Event"]');
  const selectFile = async file => act(async () => Simulate.change(input, { target: { files: [file], value: file.name } }));
  await selectFile(new File(['text'], 'notes.txt', { type: 'text/plain' }));
  expect(require('react-toastify').toast.error).toHaveBeenLastCalledWith('Please select an image file');
  await selectFile({ name: 'large.jpg', type: 'image/jpeg', size: 6 * 1024 * 1024 });
  expect(require('react-toastify').toast.error).toHaveBeenLastCalledWith('Image size should be less than 5MB');
  expect(uploadBytes).not.toHaveBeenCalled();

  uploadBytes.mockRejectedValue(new Error('Upload failed'));
  await selectFile(new File(['photo'], 'photo.png', { type: 'image/png' }));
  expect(updateDoc).not.toHaveBeenCalled();
  expect(require('react-toastify').toast.error).toHaveBeenLastCalledWith('Failed to upload image');
  expect(container.querySelector('[aria-label="Upload image for October Event"]').disabled).toBe(false);
});

test('members cannot upload event card images', async () => {
  jest.requireMock('../contexts/AuthContext').setTestUser({ uid: 'member', role: 'member', churchId: 'test-org' });
  await render();
  expect(container.querySelector('.event-image-upload')).toBeNull();
});

test('opens the AI design studio from an event card', async () => {
  await render();
  const card = Array.from(container.querySelectorAll('.event-card')).find(element => element.textContent.includes('October Event'));
  const button = Array.from(card.querySelectorAll('button')).find(element => element.textContent.includes('Design with AI'));
  await act(async () => Simulate.click(button));
  expect(container.textContent).toContain('Event design studio');
});

test('counter analytics button opens the analytics page', async () => {
  await render();
  const analyticsButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Counter Analytics');
  await act(async () => Simulate.click(analyticsButton));
  expect(container.textContent).toContain('Analytics overview');
});

test('switches between list, grid, and navigable calendar views', async () => {
  await render();
  expect(container.querySelector('.event-card-container').classList.contains('event-card-grid')).toBe(false);

  await act(async () => Simulate.click(container.querySelector('[aria-label="Grid view"]')));
  expect(container.querySelector('.event-card-container').classList.contains('event-card-grid')).toBe(true);

  await act(async () => Simulate.click(container.querySelector('[aria-label="Calendar view"]')));
  expect(container.querySelector('.event-calendar-grid')).not.toBeNull();
  const firstMonth = container.querySelector('.event-calendar-header h2').textContent;
  await act(async () => Simulate.click(container.querySelector('[aria-label="Next month"]')));
  expect(container.querySelector('.event-calendar-header h2').textContent).not.toBe(firstMonth);

  await act(async () => Simulate.click(container.querySelector('[aria-label="List view"]')));
  expect(container.querySelector('.event-calendar-grid')).toBeNull();
  expect(container.querySelector('.event-card-container').classList.contains('event-card-grid')).toBe(false);
});

test('signed-out visitors are directed to organization sign-in without protected venue reads', async () => {
  jest.requireMock('../contexts/AuthContext').setTestUser(null);
  await render();

  expect(container.textContent).toContain('Sign in to manage venues and create events.');
  expect(Array.from(container.querySelectorAll('button')).some(button => button.textContent === 'Add New Event')).toBe(false);
  expect(Array.from(container.querySelectorAll('button')).some(button => button.textContent === 'Delete All Events')).toBe(false);
  const queriedCollections = getDocs.mock.calls.map(([target]) => typeof target === 'string' ? target : target.reference);
  expect(queriedCollections).not.toContain('churches/test-org/campuses');
  expect(queriedCollections).not.toContain('churches/test-org/rooms');
  expect(queriedCollections).not.toContain('groups');

  await act(async () => Simulate.click(Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Sign in')));
  expect(container.textContent).toContain('Organization sign in');
});

test('a failed room read does not block campus loading', async () => {
  const loadCollection = getDocs.getMockImplementation();
  getDocs.mockImplementation(async target => {
    const reference = typeof target === 'string' ? target : target.reference;
    if (reference === 'churches/test-org/rooms') throw new Error('permission denied');
    return loadCollection(target);
  });

  await render();
  await act(async () => Simulate.click(Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Add New Event')));
  expect(Array.from(container.querySelector('[aria-label="Event campus"]').options).map(option => option.textContent)).toEqual([
    'Select a campus', 'Main Campus', 'North Campus',
  ]);
  expect(container.querySelector('[aria-label="Event room"]').disabled).toBe(true);
  expect(require('react-toastify').toast.error).toHaveBeenCalledWith('Failed to load rooms');
});

test('upcoming event cards sort chronologically across supported date formats', async () => {
  await render();
  expect(Array.from(container.querySelectorAll('.event-card h3')).map(heading => heading.textContent)).toEqual([
    'October Event', 'Earlier November', 'Later November',
  ]);
  expect(container.querySelector('.event-card').textContent).toContain('7:00 PM - 8:30 PM');
  expect(container.querySelector('.event-card').textContent).toContain('Wednesday, October 28, 2026');
});

test('manual date range filters ISO and MM-DD-YYYY event dates inclusively', async () => {
  await render();
  await change(container.querySelector('input[placeholder="Start date"]'), '2026-11-02');
  await change(container.querySelector('input[placeholder="End date"]'), '2026-11-02');

  expect(Array.from(container.querySelectorAll('.event-card h3')).map(heading => heading.textContent)).toEqual(['Earlier November']);
  expect(container.querySelector('[aria-label="Quick date range"]').value).toBe('custom');
});

test('quick date presets expose requested ranges and calculate local calendar boundaries', async () => {
  await render();
  const preset = container.querySelector('[aria-label="Quick date range"]');
  expect(Array.from(preset.options).map(option => option.textContent)).toEqual([
    'All dates', 'Today', 'Tomorrow', 'This week', 'This weekend', 'Next 3 days', 'This month', 'Next month',
  ]);

  const asInputDate = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const today = new Date();
  await change(preset, 'today');
  expect(container.querySelector('input[placeholder="Start date"]').value).toBe(asInputDate(today));
  expect(container.querySelector('input[placeholder="End date"]').value).toBe(asInputDate(today));

  await change(preset, 'next-month');
  const nextMonthStart = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const nextMonthEnd = new Date(today.getFullYear(), today.getMonth() + 2, 0);
  expect(container.querySelector('input[placeholder="Start date"]').value).toBe(asInputDate(nextMonthStart));
  expect(container.querySelector('input[placeholder="End date"]').value).toBe(asInputDate(nextMonthEnd));
});

test('editing an event preloads its details and updates the event instead of creating another', async () => {
  await render();
  const octoberCard = Array.from(container.querySelectorAll('.event-card')).find(card => card.textContent.includes('October Event'));
  await act(async () => Simulate.click(octoberCard.querySelector('.event-edit-button')));

  const form = container.querySelector('form');
  expect(octoberCard.contains(form)).toBe(true);
  expect(form.querySelector('input[placeholder="e.g. Sunday gathering"]').value).toBe('October Event');
  expect(form.querySelector('input[type="date"]').value).toBe('2026-10-28');
  expect(form.querySelector('[aria-label="Event campus"]').value).toBe('campus-a');
  expect(form.querySelector('[aria-label="Event room"]').value).toBe('room-a');
  const groupOptions = form.querySelectorAll('.event-venue-group-option input');
  expect(groupOptions[0].checked).toBe(true);
  await change(form.querySelector('input[placeholder="e.g. Sunday gathering"]'), 'Updated October Event');
  await act(async () => Simulate.submit(form));

  expect(updateDoc).toHaveBeenCalledWith('eventInstances/event-oct', expect.objectContaining({
    title: 'Updated October Event',
    startDate: '10-28-2026',
    campusId: 'campus-a',
    roomId: 'room-a',
    venueGroups: [{ id: 'group-a', name: 'Choir' }],
  }));
  expect(addDoc).not.toHaveBeenCalled();
});

test('weekly recurring events use the selected weekday on or after the start date', async () => {
  await render();
  await act(async () => Simulate.click(Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Add New Event')));
  const form = container.querySelector('form');
  await change(form.querySelector('input[placeholder="e.g. Sunday gathering"]'), 'Friday Gathering');
  await change(form.querySelector('input[type="date"]'), '2026-10-28');
  await change(form.querySelector('input[type="time"]'), '19:00');
  await act(async () => Simulate.change(form.querySelector('.event-create-toggle input'), { target: { checked: true } }));

  const weekdaySelect = form.querySelector('[aria-label="Repeat on weekday"]');
  expect(weekdaySelect.value).toBe('3');
  await change(weekdaySelect, '5');
  await change(form.querySelectorAll('input[type="date"]')[1], '2026-11-20');
  await act(async () => Simulate.submit(form));

  const createdDates = addDoc.mock.calls.map(([, payload]) => payload.startDate);
  expect(createdDates).toEqual(['10-30-2026', '11-06-2026', '11-13-2026', '11-20-2026']);
  expect(addDoc.mock.calls[0][1].recurrenceDayOfWeek).toBe(5);
  expect(new Set(addDoc.mock.calls.map(([, payload]) => payload.recurrenceSeriesId)).size).toBe(1);
  expect(addDoc.mock.calls.map(([, payload]) => payload.isRecurrenceMaster)).toEqual([true, false, false, false]);
});

test('monthly recurring events retain the original day after a short month', async () => {
  await render();
  await act(async () => Simulate.click(Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Add New Event')));
  const form = container.querySelector('form');
  await change(form.querySelector('input[placeholder="e.g. Sunday gathering"]'), 'Month End Gathering');
  await change(form.querySelector('input[type="date"]'), '2027-01-31');
  await change(form.querySelector('input[type="time"]'), '10:00');
  await act(async () => Simulate.change(form.querySelector('.event-create-toggle input'), { target: { checked: true } }));
  await change(form.querySelector('.event-create-repeat select'), 'monthly');
  await change(form.querySelectorAll('input[type="date"]')[1], '2027-04-30');
  await act(async () => Simulate.submit(form));

  expect(addDoc.mock.calls.map(([, payload]) => payload.startDate)).toEqual([
    '01-31-2027', '02-28-2027', '03-31-2027', '04-30-2027',
  ]);
});

test('master event is identified and changing its weekday reschedules the entire series', async () => {
  const recurrenceSeriesId = 'series-friday';
  eventDocuments.push(
    { id: 'master-friday', data: () => ({
      churchId: 'test-org', title: 'Friday Gathering', startDate: '10-30-2026', startHour: '19:00',
      isRecurring: true, recurrenceType: 'weekly', recurrenceDayOfWeek: 5, recurrenceEndDate: '11-06-2026',
      recurrenceSeriesId, isRecurrenceMaster: true,
    }) },
    { id: 'occurrence-friday', data: () => ({
      churchId: 'test-org', title: 'Friday Gathering', startDate: '11-06-2026', startHour: '19:00',
      isRecurring: true, recurrenceType: 'weekly', recurrenceDayOfWeek: 5, recurrenceEndDate: '11-06-2026',
      recurrenceSeriesId, isRecurrenceMaster: false,
    }) },
  );
  await render();
  await change(container.querySelector('[aria-label="Filter events by series"]'), 'masters');
  const masterCards = Array.from(container.querySelectorAll('.event-card'));
  expect(masterCards).toHaveLength(1);
  const masterCard = masterCards[0];
  expect(masterCard.textContent).toContain('Friday Gathering');
  expect(masterCard.querySelector('.event-series-master').textContent).toBe('Series master');
  await act(async () => Simulate.click(masterCard.querySelector('.event-edit-button')));
  const form = masterCard.querySelector('form');
  expect(form.querySelector('button[type="submit"]').textContent).toContain('Save series');
  await change(form.querySelector('[aria-label="Repeat on weekday"]'), '6');
  await change(form.querySelectorAll('input[type="date"]')[1], '2026-11-07');
  await act(async () => Simulate.submit(form));

  expect(updateDoc).toHaveBeenCalledWith('eventInstances/master-friday', expect.objectContaining({
    startDate: '10-31-2026', recurrenceDayOfWeek: 6, isRecurrenceMaster: true,
  }));
  expect(updateDoc).toHaveBeenCalledWith('eventInstances/occurrence-friday', expect.objectContaining({
    startDate: '11-07-2026', recurrenceDayOfWeek: 6, isRecurrenceMaster: false,
  }));
});

test('legacy recurring events show a master and upgrade to a series when edited', async () => {
  eventDocuments.push(
    { id: 'legacy-master', data: () => ({
      churchId: 'test-org', title: 'Legacy Weekly Gathering', startDate: '10-30-2026', startHour: '19:00',
      isRecurring: true, recurrenceType: 'weekly', recurrenceDayOfWeek: 5, recurrenceEndDate: '11-06-2026',
    }) },
    { id: 'legacy-occurrence', data: () => ({
      churchId: 'test-org', title: 'Legacy Weekly Gathering', startDate: '11-06-2026', startHour: '19:00',
      isRecurring: true, recurrenceType: 'weekly', recurrenceDayOfWeek: 5, recurrenceEndDate: '11-06-2026',
    }) },
  );
  await render();
  await change(container.querySelector('[aria-label="Filter events by series"]'), 'masters');
  const legacyMasterCard = Array.from(container.querySelectorAll('.event-card')).find(card => card.textContent.includes('Legacy Weekly Gathering'));
  expect(legacyMasterCard.querySelector('.event-series-master').textContent).toBe('Series master');
  await act(async () => Simulate.click(legacyMasterCard.querySelector('.event-edit-button')));
  const form = legacyMasterCard.querySelector('form');
  expect(form.querySelector('button[type="submit"]').textContent).toContain('Save series');
  await change(form.querySelector('[aria-label="Repeat on weekday"]'), '6');
  await change(form.querySelectorAll('input[type="date"]')[1], '2026-11-07');
  await act(async () => Simulate.submit(form));

  const masterUpdate = updateDoc.mock.calls.find(([reference]) => reference === 'eventInstances/legacy-master');
  const occurrenceUpdate = updateDoc.mock.calls.find(([reference]) => reference === 'eventInstances/legacy-occurrence');
  expect(masterUpdate[1]).toEqual(expect.objectContaining({ recurrenceSeriesId: expect.any(String), isRecurrenceMaster: true, recurrenceDayOfWeek: 6 }));
  expect(occurrenceUpdate[1]).toEqual(expect.objectContaining({ recurrenceSeriesId: masterUpdate[1].recurrenceSeriesId, isRecurrenceMaster: false, startDate: '11-07-2026' }));
});

test('Series Masters + Unique Events includes standalone events and modern/legacy masters but excludes occurrences', async () => {
  eventDocuments.push(
    { id: 'modern-master', data: () => ({ churchId: 'test-org', title: 'Weekly Service', instanceTitle: 'Weekly master', startDate: '2026-10-30', recurrenceSeriesId: 'weekly-series', isRecurring: true, recurrenceType: 'weekly', isRecurrenceMaster: true }) },
    { id: 'modern-child', data: () => ({ churchId: 'test-org', title: 'Weekly Service', instanceTitle: 'Weekly occurrence', startDate: '2026-11-06', recurrenceSeriesId: 'weekly-series', isRecurring: true, recurrenceType: 'weekly', isRecurrenceMaster: false }) },
    { id: 'legacy-master', data: () => ({ churchId: 'test-org', title: 'Legacy Service', instanceTitle: 'Legacy master', startDate: '2026-10-31', recurrenceType: 'weekly' }) },
    { id: 'legacy-child', data: () => ({ churchId: 'test-org', title: 'Legacy Service', instanceTitle: 'Legacy occurrence', startDate: '2026-11-07', recurrenceType: 'weekly' }) },
  );
  await render();
  const filter = container.querySelector('[aria-label="Filter events by series"]');
  expect(Array.from(filter.options).map(option => option.textContent)).toContain('Series Masters + Unique Events');
  await change(filter, 'masters-unique');
  const titles = Array.from(container.querySelectorAll('.event-card h3')).map(heading => heading.textContent);
  expect(titles).toEqual(['October Event', 'Weekly master', 'Legacy master', 'Earlier November', 'Later November']);
  await act(async () => Simulate.click(container.querySelector('[aria-label="Grid view"]')));
  expect(container.querySelectorAll('.event-card')).toHaveLength(5);
  await act(async () => Simulate.click(container.querySelector('[aria-label="Calendar view"]')));
  const calendarTitles = Array.from(container.querySelectorAll('.event-calendar-item')).map(element => element.textContent);
  expect(calendarTitles.some(title => title.includes('Weekly master'))).toBe(true);
  expect(calendarTitles.some(title => title.includes('Legacy master'))).toBe(true);
  expect(calendarTitles.some(title => title.includes('occurrence'))).toBe(false);
  await change(filter, 'masters');
  expect(container.querySelectorAll('.event-calendar-item')).toHaveLength(2);
});

test.each([true, false])('series editor saves master-image sharing as %s and respects it for existing and new occurrences', async shareDesign => {
  const masterImage = 'events/test-org/design-master/master.jpg';
  const recurrenceSeriesId = 'design-series';
  const common = { churchId: 'test-org', title: 'Shared Design Gathering', startHour: '19:00', isRecurring: true, recurrenceType: 'weekly', recurrenceDayOfWeek: 5, recurrenceEndDate: '11-06-2026', recurrenceSeriesId };
  eventDocuments.push(
    { id: 'design-master', data: () => ({ ...common, startDate: '10-30-2026', isRecurrenceMaster: true, imageUrl: masterImage, useMasterDesignForSeries: !shareDesign }) },
    { id: 'design-child', data: () => ({ ...common, startDate: '11-06-2026', isRecurrenceMaster: false, imageUrl: 'events/test-org/design-child/own.jpg' }) },
  );
  await render();
  await change(container.querySelector('[aria-label="Filter events by series"]'), 'masters');
  const masterCard = Array.from(container.querySelectorAll('.event-card')).find(card => card.textContent.includes('Shared Design Gathering'));
  await act(async () => Simulate.click(masterCard.querySelector('.event-edit-button')));
  const form = masterCard.querySelector('form');
  const sharingCheckbox = form.querySelector('[aria-label="Use master design for all events"]');
  expect(sharingCheckbox.checked).toBe(!shareDesign);
  await act(async () => Simulate.change(sharingCheckbox, { target: { checked: shareDesign } }));
  await change(form.querySelectorAll('input[type="date"]')[1], '2026-11-13');
  await act(async () => Simulate.submit(form));

  const masterUpdate = updateDoc.mock.calls.find(([reference]) => reference === 'eventInstances/design-master')[1];
  const childUpdate = updateDoc.mock.calls.find(([reference]) => reference === 'eventInstances/design-child')[1];
  const newOccurrence = addDoc.mock.calls[0][1];
  expect(masterUpdate.useMasterDesignForSeries).toBe(shareDesign);
  if (shareDesign) {
    expect(childUpdate.imageUrl).toBe(masterImage);
    expect(newOccurrence.imageUrl).toBe(masterImage);
  } else {
    expect(childUpdate).not.toHaveProperty('imageUrl');
    expect(newOccurrence).not.toHaveProperty('imageUrl');
  }
});

test('a later master image upload updates the shared series without generating AI designs', async () => {
  uploadBytes.mockResolvedValue({});
  getDownloadURL.mockResolvedValue('https://example.com/new-master.jpg');
  const common = { churchId: 'test-org', title: 'Image Sharing Gathering', startHour: '19:00', isRecurring: true, recurrenceType: 'weekly', recurrenceDayOfWeek: 5, recurrenceEndDate: '11-06-2026', recurrenceSeriesId: 'upload-series' };
  eventDocuments.push(
    { id: 'upload-master', data: () => ({ ...common, startDate: '10-30-2026', isRecurrenceMaster: true, useMasterDesignForSeries: true }) },
    { id: 'upload-child', data: () => ({ ...common, startDate: '11-06-2026', isRecurrenceMaster: false }) },
  );
  await render();
  const masterCard = Array.from(container.querySelectorAll('.event-card')).find(card => card.querySelector('.event-series-master') && card.textContent.includes('Image Sharing Gathering'));
  const file = new File(['photo'], 'shared.png', { type: 'image/png' });
  await act(async () => Simulate.change(masterCard.querySelector('input[type="file"]'), { target: { files: [file], value: 'shared.png' } }));
  const imagePath = uploadBytes.mock.calls[0][0];
  expect(updateDoc).toHaveBeenCalledWith('eventInstances/upload-master', expect.objectContaining({ imageUrl: imagePath }));
  expect(updateDoc).toHaveBeenCalledWith('eventInstances/upload-child', expect.objectContaining({ imageUrl: imagePath }));
});

test('a member can download the saved event image without changing the event', async () => {
  jest.requireMock('../contexts/AuthContext').setTestUser({ uid: 'member', role: 'member', churchId: 'test-org' });
  eventDocuments = [{ id: 'download-event', data: () => ({ churchId: 'test-org', title: 'Saved Poster', startDate: '2026-10-28', imageUrl: 'events/test-org/download-event/poster.jpg' }) }];
  getDownloadURL.mockResolvedValue('https://example.com/full-resolution.jpg');
  downloadEventImage.mockResolvedValue(undefined);
  await render();
  const downloadButton = container.querySelector('[aria-label="Download image for Saved Poster"]');
  expect(downloadButton.disabled).toBe(false);
  await act(async () => Simulate.click(downloadButton));
  expect(downloadEventImage).toHaveBeenCalledWith('https://example.com/full-resolution.jpg', 'Saved Poster');
  expect(updateDoc).not.toHaveBeenCalled();
  expect(uploadBytes).not.toHaveBeenCalled();
  expect(downloadButton.disabled).toBe(false);
});

test('event download buttons are disabled when no image is saved', async () => {
  await render();
  const buttons = container.querySelectorAll('.event-image-download');
  expect(buttons).toHaveLength(3);
  expect(Array.from(buttons).every(button => button.disabled)).toBe(true);
  expect(downloadEventImage).not.toHaveBeenCalled();
});

test('an event image download failure shows an error and re-enables the button', async () => {
  eventDocuments = [{ id: 'download-event', data: () => ({ churchId: 'test-org', title: 'Saved Poster', startDate: '2026-10-28', imageUrl: 'https://example.com/poster.jpg' }) }];
  downloadEventImage.mockRejectedValue(new Error('Could not download the image. Please retry.'));
  await render();
  const downloadButton = container.querySelector('[aria-label="Download image for Saved Poster"]');
  await act(async () => Simulate.click(downloadButton));
  expect(require('react-toastify').toast.error).toHaveBeenCalledWith('Could not download the image. Please retry.');
  expect(downloadButton.disabled).toBe(false);
});

test('editing a legacy event with an image warns that its image needs updating', async () => {
  const october = eventDocuments.find(document => document.id === 'event-oct');
  const original = october.data();
  october.data = () => ({ ...original, imageUrl: 'https://example.com/old-poster.jpg' });
  await render();
  let card = Array.from(container.querySelectorAll('.event-card')).find(element => element.textContent.includes('October Event'));
  expect(card.querySelector('.event-image-outdated')).toBeNull();
  await act(async () => Simulate.click(card.querySelector('.event-edit-button')));
  await change(card.querySelector('input[placeholder="e.g. Sunday gathering"]'), 'Updated October Event');
  await act(async () => Simulate.submit(card.querySelector('form')));
  card = Array.from(container.querySelectorAll('.event-card')).find(element => element.textContent.includes('Updated October Event'));
  expect(card.querySelector('.event-image-outdated').textContent).toContain('Title');
  expect(updateDoc).toHaveBeenCalledWith('eventInstances/event-oct', expect.objectContaining({ imageEventDetails: getEventDesignDetails(original) }));

  uploadBytes.mockResolvedValue({});
  getDownloadURL.mockResolvedValue('https://example.com/current-poster.jpg');
  const file = new File(['image'], 'current.jpg', { type: 'image/jpeg' });
  await act(async () => Simulate.change(card.querySelector('input[type="file"]'), { target: { files: [file], value: 'current.jpg' } }));
  expect(card.querySelector('.event-image-outdated')).toBeNull();
});

test('an image already known to be stale warns immediately when All Events loads', async () => {
  const october = eventDocuments.find(document => document.id === 'event-oct');
  const original = october.data();
  october.data = () => ({ ...original, imageUrl: 'https://example.com/old.jpg', imageEventDetails: getEventDesignDetails({ ...original, title: 'Old October Title' }) });
  await render();
  const card = Array.from(container.querySelectorAll('.event-card')).find(element => element.textContent.includes('October Event'));
  expect(card.querySelector('.event-image-outdated').textContent).toContain('Title');
});

test('saving a master series preserves an occurrence-specific image', async () => {
  const common = { churchId: 'test-org', title: 'Family Series', startHour: '19:00', isRecurring: true, recurrenceType: 'weekly', recurrenceDayOfWeek: 5, recurrenceEndDate: '11-06-2026', recurrenceSeriesId: 'custom-image-series' };
  eventDocuments.push(
    { id: 'custom-image-master', data: () => ({ ...common, startDate: '10-30-2026', isRecurrenceMaster: true, useMasterDesignForSeries: true, imageUrl: 'https://example.com/master.jpg' }) },
    { id: 'custom-image-child', data: () => ({ ...common, startDate: '11-06-2026', isRecurrenceMaster: false, imageIsSeriesOverride: true, imageUrl: 'https://example.com/custom.jpg' }) },
  );
  await render();
  await change(container.querySelector('[aria-label="Filter events by series"]'), 'masters');
  const masterCard = Array.from(container.querySelectorAll('.event-card')).find(card => card.textContent.includes('Family Series'));
  await act(async () => Simulate.click(masterCard.querySelector('.event-edit-button')));
  await change(masterCard.querySelector('input[placeholder="e.g. Sunday gathering"]'), 'Updated Family Series');
  await act(async () => Simulate.submit(masterCard.querySelector('form')));
  const childUpdate = updateDoc.mock.calls.find(([reference]) => reference === 'eventInstances/custom-image-child')[1];
  expect(childUpdate).not.toHaveProperty('imageUrl');
  expect(childUpdate).not.toHaveProperty('imageIsSeriesOverride', false);
});

test('calendar dates show each event image, time and title without nested image controls', async () => {
  const today = new Date();
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const path = 'events/test-org/calendar-event/poster.jpg';
  eventDocuments = [
    { id: 'calendar-upload', data: () => ({ churchId: 'test-org', title: 'Uploaded calendar image', startDate: date, startHour: '19:00', imageUrl: path }) },
    { id: 'calendar-direct', data: () => ({ churchId: 'test-org', title: 'Direct calendar image', startDate: date, startHour: '20:00', imageUrl: 'https://example.com/calendar.png' }) },
    { id: 'calendar-no-image', data: () => ({ churchId: 'test-org', title: 'Calendar without image', startDate: date }) },
  ];
  getDownloadURL.mockResolvedValue('https://example.com/resolved-calendar.jpg');
  await render();
  await act(async () => Simulate.click(container.querySelector('[aria-label="Calendar view"]')));
  const events = container.querySelectorAll('.event-calendar-item');
  expect(events).toHaveLength(3);
  const uploaded = Array.from(events).find(event => event.textContent.includes('Uploaded calendar image'));
  const direct = Array.from(events).find(event => event.textContent.includes('Direct calendar image'));
  const withoutImage = Array.from(events).find(event => event.textContent.includes('Calendar without image'));
  expect(uploaded.querySelector('img').getAttribute('src')).toBe('https://example.com/resolved-calendar.jpg');
  expect(direct.querySelector('img').getAttribute('src')).toBe('https://example.com/calendar.png');
  expect(withoutImage.querySelector('img')).toBeNull();
  expect(uploaded.querySelector('time').textContent).toBe('7:00 PM');
  expect(uploaded.textContent).toContain('Uploaded calendar image');
  expect(container.querySelectorAll('.event-calendar-item button')).toHaveLength(0);
  expect(uploaded.closest('.event-calendar-day')).toBe(direct.closest('.event-calendar-day'));
  await act(async () => Simulate.error(uploaded.querySelector('img')));
  expect(uploaded.querySelector('img')).toBeNull();
  expect(uploaded.textContent).toContain('Uploaded calendar image');
});