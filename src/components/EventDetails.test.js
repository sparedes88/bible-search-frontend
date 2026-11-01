import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { addDoc, getDoc, getDocs, onSnapshot, updateDoc } from 'firebase/firestore';
import { getDownloadURL, uploadBytes } from 'firebase/storage';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { updateEventDesign } from '../utils/eventSeriesDesign';
import EventDetails from './EventDetails';

jest.mock('../firebase', () => ({ db: {}, storage: {} }));
jest.mock('firebase/storage', () => ({ getDownloadURL: jest.fn(), uploadBytes: jest.fn(), deleteObject: jest.fn(), ref: (_storage, path) => path }));
jest.mock('../utils/eventSeriesDesign', () => ({ updateEventDesign: jest.fn() }));
jest.mock('../contexts/AuthContext', () => {
  let user;
  return { useAuth: () => ({ user }), setTestUser: nextUser => { user = nextUser; } };
});
jest.mock('./ChurchHeader', () => () => <div data-testid="organization-header" />);
jest.mock('./QRCodeLabel', () => () => null);
jest.mock('@react-pdf/renderer', () => ({ PDFDownloadLink: ({ children }) => <a>{children}</a> }));
jest.mock('react-toastify', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('html5-qrcode', () => ({ Html5QrcodeScanner: jest.fn(), Html5QrcodeSupportedFormats: { QR_CODE: 0 } }));
jest.mock('firebase/firestore', () => ({
  collection: (_database, ...segments) => segments.join('/'),
  doc: (_database, ...segments) => segments.join('/'),
  query: reference => ({ reference }),
  where: (...args) => args,
  orderBy: (...args) => args,
  getDoc: jest.fn(), getDocs: jest.fn(), onSnapshot: jest.fn(),
  addDoc: jest.fn(), updateDoc: jest.fn(), deleteDoc: jest.fn(),
  arrayUnion: (...values) => values, serverTimestamp: () => 'server-time',
}));

let container;
let root;
let scanner;
const eventData = {
  title: 'Sunday Meal', startDate: '11-01-2026', endDate: '11-02-2026', startHour: '19:00', endHour: '20:30',
  location: 'Main Hall', description: 'Bring the whole family.', imageUrl: 'https://example.com/event.jpg',
  categoryName: 'Community', subcategoryName: 'Meals', isRecurring: true, recurrencePattern: 'weekly',
  rooms: [{ id: 'room-1', name: 'Family Room' }],
};
const registration = { id: 'registration-1', data: () => ({ name: 'Alex', lastName: 'Rivera', userId: 'visitor-1', registeredAt: { toDate: () => new Date(2026, 9, 29, 12) } }) };
const button = name => Array.from(container.querySelectorAll('button')).find(element => element.textContent.trim() === name);
const click = async element => { await act(async () => Simulate.click(element)); };
const change = async (element, value) => { await act(async () => Simulate.change(element, { target: { value } })); };
const render = async () => {
  await act(async () => root.render(
    <MemoryRouter initialEntries={['/organization/test-org/event/event-1']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/organization/:id/event/:eventId" element={<EventDetails />} />
        <Route path="/organization/:id/event/:eventId/:destination" element={<p>Event tool destination</p>} />
        <Route path="/organization/:id/all-events" element={<p>All events destination</p>} />
      </Routes>
    </MemoryRouter>
  ));
};

beforeEach(() => {
  jest.clearAllMocks();
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.requireMock('../contexts/AuthContext').setTestUser({ uid: 'admin', role: 'admin' });
  getDoc.mockResolvedValue({ id: 'event-1', exists: () => true, data: () => eventData });
  getDocs.mockImplementation(async reference => ({ docs: reference?.reference === 'eventRegistrations' ? [registration] : [], empty: true }));
  onSnapshot.mockImplementation((_query, callback) => { callback({ docs: [registration] }); return () => {}; });
  addDoc.mockResolvedValue({ id: 'new-registration' });
  updateDoc.mockResolvedValue(undefined);
  uploadBytes.mockResolvedValue(undefined);
  updateEventDesign.mockResolvedValue(new Set(['event-1']));
  getDownloadURL.mockResolvedValue('https://example.com/resolved.jpg');
  scanner = { render: jest.fn(), clear: jest.fn().mockResolvedValue(undefined), stop: jest.fn().mockResolvedValue(undefined) };
  Html5QrcodeScanner.mockImplementation(() => scanner);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: jest.fn().mockResolvedValue(undefined) } });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  jest.useRealTimers();
});

test('graphic replaces organization banner while all event facts remain available', async () => {
  await render();
  expect(container.querySelector('.event-registration-graphic img').getAttribute('src')).toBe(eventData.imageUrl);
  expect(container.querySelector('[data-testid="organization-header"]')).toBeNull();
  expect(container.querySelector('h1').textContent).toBe('Sunday Meal');
  const information = container.querySelector('.event-details-information').textContent;
  ['November 01, 2026', 'November 02, 2026', '7:00 PM - 8:30 PM', 'Main Hall', 'Bring the whole family.', 'Community', 'Meals'].forEach(text => expect(information).toContain(text));
  const recurrenceFact = Array.from(container.querySelectorAll('.registration-facts dt')).find(term => term.textContent === 'Recurring');
  expect(recurrenceFact.parentElement.querySelector('dd').textContent).toBe('Weekly');
});

test('storage graphics resolve and failed images preserve all controls with a fallback header', async () => {
  getDoc.mockResolvedValue({ id: 'event-1', exists: () => true, data: () => ({ ...eventData, imageUrl: '/events/test-org/event-1/design.jpg' }) });
  await render();
  expect(getDownloadURL).toHaveBeenCalledWith('events/test-org/event-1/design.jpg');
  await act(async () => Simulate.error(container.querySelector('.event-registration-graphic img')));
  expect(container.querySelector('[data-testid="organization-header"]')).not.toBeNull();
  expect(button('Attendance Counter')).toBeDefined();
  expect(button('Manage Registration')).toBeDefined();
});

test('legacy recurring events without a pattern keep a readable summary', async () => {
  getDoc.mockResolvedValue({ id: 'event-1', exists: () => true, data: () => ({ ...eventData, recurrencePattern: 'undefined', recurrenceEndDate: '2027-01-03' }) });
  await render();
  const recurrenceFact = Array.from(container.querySelectorAll('.registration-facts dt')).find(term => term.textContent === 'Recurring');
  expect(recurrenceFact.parentElement.querySelector('dd').textContent).toBe('Until January 03, 2027');
  expect(container.querySelector('.registration-facts').textContent).not.toContain('undefined');
});

test('room management and child and course forms are still reachable from attendance logs', async () => {
  await render();
  expect(container.textContent).toContain('Attendance Logs (1)');
  expect(container.textContent).toContain('Registrations (1)');
  expect(container.textContent).toContain('Family Room');
  await click(button('Manage Rooms'));
  expect(container.querySelector('[role="combobox"]')).not.toBeNull();
  await click(button('Done'));
  await click(container.querySelector('[aria-label="child"]').closest('button'));
  expect(container.querySelector('input[placeholder="Child\'s Name"]')).not.toBeNull();
  await click(button('Cancel'));
  await click(container.querySelector('[aria-label="course"]').closest('button'));
  expect(container.querySelector('input[placeholder="Instructor Name *"]')).not.toBeNull();
  await click(button('Cancel'));
  expect(updateDoc).not.toHaveBeenCalled();
});

test.each(['Attendance Counter', 'Coordinación', 'Manage Registration'])('%s navigation remains available', async name => {
  await render();
  await click(button(name));
  expect(container.textContent).toContain('Event tool destination');
});

test('scanner can still open and close without changing event data', async () => {
  await render();
  jest.useFakeTimers();
  await click(button('Scan Attendance QR'));
  await act(async () => jest.runOnlyPendingTimers());
  expect(Html5QrcodeScanner).toHaveBeenCalled();
  expect(container.querySelector('#qr-reader')).not.toBeNull();
  await click(button('Close Scanner'));
  expect(container.querySelector('#qr-reader')).toBeNull();
  expect(scanner.clear).toHaveBeenCalled();
  expect(addDoc).not.toHaveBeenCalled();
});

test('QR and copy button both retain event-link sharing', async () => {
  await render();
  await click(container.querySelector('[aria-label="Copy event link QR code"]'));
  await click(button('Copy event link'));
  expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(2);
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(window.location.href);
});

test('signed-out visitors retain registration while admin tools remain hidden', async () => {
  jest.requireMock('../contexts/AuthContext').setTestUser(null);
  await render();
  expect(button('Log in')).toBeDefined();
  expect(container.querySelector('#event-image-upload')).toBeNull();
  expect(button('Attendance Counter')).toBeUndefined();
  expect(button('Manage Rooms')).toBeUndefined();
  await change(container.querySelector('[aria-label="First Name"]'), 'Taylor');
  await change(container.querySelector('[aria-label="Last Name"]'), 'Rivera');
  await change(container.querySelector('[aria-label="Phone"]'), '5551234');
  await act(async () => Simulate.submit(container.querySelector('.registration-form')));
  expect(addDoc).toHaveBeenCalledWith('eventRegistrations', expect.objectContaining({ eventId: 'event-1', churchId: 'test-org', name: 'Taylor', lastName: 'Rivera', phone: '5551234', userId: null }));
});

test('image preview and explicit save still use series-aware upload behavior', async () => {
  URL.createObjectURL = jest.fn(() => 'blob:local-preview');
  await render();
  const image = new File(['image'], 'event.png', { type: 'image/png' });
  await act(async () => Simulate.change(container.querySelector('#event-image-upload'), { target: { files: [image] } }));
  expect(container.querySelector('.event-registration-graphic img').getAttribute('src')).toBe('blob:local-preview');
  expect(uploadBytes).not.toHaveBeenCalled();
  await click(button('Save Image'));
  expect(uploadBytes).toHaveBeenCalledWith(expect.stringMatching(/^events\/test-org\/event-1\/\d+_event\.png$/), image);
  expect(updateEventDesign).toHaveBeenCalledWith('test-org', expect.objectContaining({ id: 'event-1' }), expect.stringMatching(/^events\/test-org\/event-1\//));
});