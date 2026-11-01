import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { addDoc, getDoc } from 'firebase/firestore';
import { getDownloadURL } from 'firebase/storage';
import EventRegistration from './EventRegistration';

jest.mock('../firebase', () => ({ db: {}, storage: { bucket: 'configured-bucket' } }));
jest.mock('firebase/storage', () => ({ ref: (_storage, path) => path, getDownloadURL: jest.fn() }));
jest.mock('../contexts/AuthContext', () => {
  const user = { uid: 'attendee-1', name: 'Alex', lastName: 'Rivera' };
  return { useAuth: () => ({ user }) };
});
jest.mock('./ChurchHeader', () => () => <div data-testid="organization-header" />);
jest.mock('react-toastify', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('firebase/firestore', () => ({
  collection: (_database, ...segments) => segments.join('/'),
  doc: (_database, ...segments) => segments.join('/'),
  query: (reference, ...constraints) => ({ reference, constraints }),
  where: (...args) => args,
  getDoc: jest.fn(),
  getDocs: jest.fn(),
  addDoc: jest.fn(),
  setDoc: jest.fn(),
  serverTimestamp: () => 'server-time',
}));

let container;
let root;

const render = async () => {
  await act(async () => root.render(
    <MemoryRouter initialEntries={['/organization/test-org/event/event-1/register']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/organization/:id/event/:eventId/register" element={<EventRegistration />} />
        <Route path="/organization/:id/event/:eventId" element={<p>Event details</p>} />
      </Routes>
    </MemoryRouter>
  ));
};

const change = async (element, value) => {
  await act(async () => Simulate.change(element, { target: { value } }));
};

beforeEach(() => {
  jest.clearAllMocks();
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  getDoc.mockResolvedValue({
    exists: () => true,
    data: () => ({ title: 'Sunday Meal', startDate: '11-01-2026', potluckEnabled: true }),
  });
  addDoc.mockResolvedValue({ id: 'registration-1' });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

test('public registration shows potluck suggestions and saves a custom choice when enabled', async () => {
  await render();
  const potluckInput = container.querySelector('#registration-potluck-choice');
  expect(potluckInput).not.toBeNull();
  expect(container.textContent).toContain('At this event, everyone is bringing a plate, snack, or drink. Can you bring an item to share? If so, please tell us what.');
  expect(Array.from(container.querySelectorAll('#registration-potluck-suggestions option')).map(option => option.value)).toEqual([
    'Chicken', 'Soda', 'Chips', 'Salad', 'Dessert',
  ]);

  await change(potluckInput, 'Homemade empanadas');
  await act(async () => Simulate.submit(container.querySelector('form')));
  expect(addDoc).toHaveBeenCalledWith('eventRegistrations', expect.objectContaining({
    eventId: 'event-1', potluckChoice: 'Homemade empanadas',
  }));
});

test('the event graphic replaces the organization banner and resolves uploaded image paths', async () => {
  getDoc.mockResolvedValue({ exists: () => true, data: () => ({ title: 'Sunday Gathering', imageUrl: '/events/test-org/event-1/design.jpg' }) });
  getDownloadURL.mockResolvedValue('https://example.com/event-design.jpg');
  await render();
  expect(getDownloadURL).toHaveBeenCalledWith('events/test-org/event-1/design.jpg');
  const graphic = container.querySelector('.event-registration-graphic img');
  expect(graphic.getAttribute('src')).toBe('https://example.com/event-design.jpg');
  expect(graphic.getAttribute('alt')).toBe('Sunday Gathering event graphic');
  expect(graphic.closest('.event-registration-graphic')).not.toBeNull();
  expect(container.querySelector('[data-testid="organization-header"]')).toBeNull();
  expect(container.querySelector('form')).not.toBeNull();
});

test('direct event image URLs display without a Storage lookup', async () => {
  getDoc.mockResolvedValue({ exists: () => true, data: () => ({ title: 'Direct Image Event', imageUrl: 'https://example.com/direct.png' }) });
  await render();
  expect(container.querySelector('.event-registration-graphic img').getAttribute('src')).toBe('https://example.com/direct.png');
  expect(getDownloadURL).not.toHaveBeenCalled();
});

test('missing or failed event graphics retain the organization header fallback', async () => {
  await render();
  expect(container.querySelector('[data-testid="organization-header"]')).not.toBeNull();
});

test('an image load failure falls back to the organization header without blocking registration', async () => {
  getDoc.mockResolvedValue({ exists: () => true, data: () => ({ title: 'Event', imageUrl: 'https://example.com/unavailable.jpg' }) });
  await render();
  await act(async () => Simulate.error(container.querySelector('.event-registration-graphic img')));
  expect(container.querySelector('.event-registration-graphic')).toBeNull();
  expect(container.querySelector('[data-testid="organization-header"]')).not.toBeNull();
  expect(container.querySelector('form')).not.toBeNull();
});

test('a failed Storage lookup falls back without blocking the registration form', async () => {
  getDoc.mockResolvedValue({ exists: () => true, data: () => ({ title: 'Event', imageUrl: 'events/missing.jpg' }) });
  getDownloadURL.mockRejectedValue(new Error('Not found'));
  await render();
  expect(container.querySelector('[data-testid="organization-header"]')).not.toBeNull();
  expect(container.querySelector('form')).not.toBeNull();
});

test('the redesigned event summary shows readable dates, AM/PM times and venue', async () => {
  getDoc.mockResolvedValue({ exists: () => true, data: () => ({ title: 'Sunday Gathering', startDate: '11-01-2026', startHour: '19:00', endHour: '20:30', location: 'Main Hall', description: 'Community dinner' }) });
  await render();
  expect(container.querySelector('h1').textContent).toBe('Sunday Gathering');
  const details = container.querySelector('.registration-facts').textContent;
  expect(details).toContain('November 01, 2026');
  expect(details).toContain('7:00 PM - 8:30 PM');
  expect(details).toContain('Main Hall');
  expect(container.querySelector('.registration-description').textContent).toBe('Community dinner');
  container.querySelectorAll('form label').forEach(label => expect(container.querySelector(`#${label.htmlFor}`)).not.toBeNull());
  expect(container.querySelector('#registration-first-name').required).toBe(true);
  expect(container.querySelector('#registration-last-name').required).toBe(true);
});

test('the redesigned form keeps attendee input while submitting and prevents repeat submission', async () => {
  let finishRegistration;
  addDoc.mockImplementationOnce(() => new Promise(resolve => { finishRegistration = resolve; }));
  await render();
  await change(container.querySelector('#registration-comments'), 'Looking forward to it');
  await act(async () => Simulate.submit(container.querySelector('form')));
  expect(container.querySelector('.registration-submit').disabled).toBe(true);
  expect(container.querySelector('.registration-submit').getAttribute('aria-busy')).toBe('true');
  expect(container.querySelector('#registration-first-name').disabled).toBe(true);
  expect(container.querySelector('#registration-comments').value).toBe('Looking forward to it');
  await act(async () => Simulate.submit(container.querySelector('form')));
  expect(addDoc).toHaveBeenCalledTimes(1);
  await act(async () => finishRegistration({ id: 'registration-1' }));
  expect(container.textContent).toContain('Event details');
});

test('the back control returns to the event details page', async () => {
  await render();
  await act(async () => Simulate.click(container.querySelector('.registration-back')));
  expect(container.textContent).toContain('Event details');
});