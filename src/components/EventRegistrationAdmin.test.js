import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { addDoc, deleteDoc, getDoc, getDocs, updateDoc } from 'firebase/firestore';
import { getDownloadURL } from 'firebase/storage';
import { toast } from 'react-toastify';
import EventRegistrationAdmin from './EventRegistrationAdmin';

jest.mock('../firebase', () => ({ db: {}, storage: {} }));
jest.mock('firebase/storage', () => ({ getDownloadURL: jest.fn(), ref: (_storage, path) => path }));
jest.mock('../contexts/AuthContext', () => {
  let user = { uid: 'admin', email: 'admin@example.com' };
  return {
    useAuth: () => ({ user, loading: false, isAdmin: () => Boolean(user?.role === 'admin' || user?.role === 'global_admin' || user?.uid === 'admin') }),
    setTestUser: nextUser => { user = nextUser; },
  };
});
jest.mock('./ChurchHeader', () => () => <div data-testid="organization-header" />);
jest.mock('./RegistrationsPDF', () => () => null);
jest.mock('@react-pdf/renderer', () => ({ PDFDownloadLink: ({ children }) => <a>{children}</a> }));
jest.mock('react-toastify', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('firebase/firestore', () => ({
  collection: (_database, ...segments) => segments.join('/'),
  doc: (_database, ...segments) => segments.join('/'),
  query: (reference, ...constraints) => ({ reference, constraints }),
  where: (...args) => args,
  orderBy: (...args) => args,
  getDoc: jest.fn(),
  getDocs: jest.fn(),
  addDoc: jest.fn(),
  updateDoc: jest.fn(),
  deleteDoc: jest.fn(),
  serverTimestamp: () => 'server-time',
}));

let container;
let root;

const render = async () => {
  await act(async () => root.render(
    <MemoryRouter initialEntries={['/organization/test-org/event/event-1/registrations']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes><Route path="/organization/:id/event/:eventId/registrations" element={<EventRegistrationAdmin />} /><Route path="/organization/:id/event/:eventId" element={<p>Event details destination</p>} /></Routes>
    </MemoryRouter>
  ));
};

const change = async (element, value) => {
  await act(async () => Simulate.change(element, { target: { value } }));
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.requireMock('../contexts/AuthContext').setTestUser({ uid: 'admin', email: 'admin@example.com' });
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  getDoc.mockResolvedValue({ exists: () => true, data: () => ({ title: 'Sunday Meal', startDate: '11-01-2026', potluckEnabled: false, imageUrl: 'https://example.com/sunday-meal.jpg' }) });
  getDocs.mockResolvedValue({ docs: [] });
  addDoc.mockResolvedValue({ id: 'registration-1' });
  updateDoc.mockResolvedValue(undefined);
  deleteDoc.mockResolvedValue(undefined);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

test('admin can enable potluck and save a custom registration choice', async () => {
  await render();
  expect(container.querySelector('img[alt="Sunday Meal image"]').getAttribute('src')).toBe('https://example.com/sunday-meal.jpg');
  const potluckToggle = container.querySelector('[aria-label="Enable potluck question"]');
  await act(async () => Simulate.change(potluckToggle, { target: { checked: true } }));
  expect(updateDoc).toHaveBeenCalledWith('eventInstances/event-1', expect.objectContaining({ potluckEnabled: true }));

  const addButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Add New Registration');
  await act(async () => Simulate.click(addButton));
  const form = container.querySelector('form');
  const potluckInput = form.querySelector('#admin-registration-potluck-choice');
  expect(potluckInput).not.toBeNull();
  expect(Array.from(form.querySelectorAll('#admin-registration-potluck-suggestions option')).map(option => option.value)).toContain('Chicken');
  expect(Array.from(form.querySelectorAll('#admin-registration-potluck-suggestions option')).map(option => option.value)).toContain('Soda');
  expect(Array.from(form.querySelectorAll('#admin-registration-potluck-suggestions option')).map(option => option.value)).toContain('Chips');

  await change(form.querySelectorAll('input[type="text"]')[0], 'Alex');
  await change(form.querySelectorAll('input[type="text"]')[1], 'Rivera');
  await change(potluckInput, 'Homemade empanadas');
  await act(async () => Simulate.submit(form));

  expect(addDoc).toHaveBeenCalledWith('eventRegistrations', expect.objectContaining({
    eventId: 'event-1', name: 'Alex', lastName: 'Rivera', potluckChoice: 'Homemade empanadas',
  }));
  expect(container.textContent).toContain('Homemade empanadas');
  expect(toast.success).toHaveBeenCalledWith('Registration created successfully');
});

test('signed-out visitor can submit a public RSVP without loading the registration roster', async () => {
  jest.requireMock('../contexts/AuthContext').setTestUser(null);
  getDoc.mockResolvedValue({ exists: () => true, data: () => ({ title: 'Sunday Meal', startDate: '11-01-2026', potluckEnabled: true }) });
  await render();

  expect(container.textContent).toContain('RSVP for this Event');
  expect(container.textContent).not.toContain('Manage Event Registrations');
  expect(getDocs).not.toHaveBeenCalled();

  const form = container.querySelector('form');
  expect(form.querySelector('#admin-registration-potluck-choice')).not.toBeNull();
  await change(form.querySelectorAll('input[type="text"]')[0], 'Jordan');
  await change(form.querySelectorAll('input[type="text"]')[1], 'Lee');
  await change(form.querySelector('#admin-registration-potluck-choice'), 'Vegetable tray');
  await act(async () => Simulate.submit(form));

  expect(addDoc).toHaveBeenCalledWith('eventRegistrations', expect.objectContaining({
    eventId: 'event-1', churchId: 'test-org', userId: null,
    name: 'Jordan', lastName: 'Lee', potluckChoice: 'Vegetable tray',
  }));
  expect(container.textContent).toContain('Your RSVP has been received');
});

test('the event graphic replaces the organization banner and summary uses readable dates and times', async () => {
  getDoc.mockResolvedValue({ exists: () => true, data: () => ({ title: 'Sunday Meal', startDate: '11-01-2026', startHour: '19:00', endHour: '20:30', location: 'Main Hall', imageUrl: '/events/test-org/event-1/design.jpg' }) });
  getDownloadURL.mockResolvedValue('https://example.com/event-design.jpg');
  await render();
  expect(getDownloadURL).toHaveBeenCalledWith('events/test-org/event-1/design.jpg');
  expect(container.querySelector('.event-registration-graphic img').getAttribute('src')).toBe('https://example.com/event-design.jpg');
  expect(container.querySelector('[data-testid="organization-header"]')).toBeNull();
  expect(container.querySelector('h1').textContent).toBe('Sunday Meal');
  expect(container.querySelector('.registration-facts').textContent).toContain('November 01, 2026');
  expect(container.querySelector('.registration-facts').textContent).toContain('7:00 PM - 8:30 PM');
  expect(container.querySelector('.registration-facts').textContent).toContain('Main Hall');
});

test('failed event images fall back to the organization header without hiding management actions', async () => {
  await render();
  await act(async () => Simulate.error(container.querySelector('.event-registration-graphic img')));
  expect(container.querySelector('[data-testid="organization-header"]')).not.toBeNull();
  expect(container.querySelector('.event-registration-graphic')).toBeNull();
  expect(Array.from(container.querySelectorAll('button')).some(button => button.textContent === 'Add New Registration')).toBe(true);
});

test('admins can edit a registration from the new roster table', async () => {
  getDocs.mockResolvedValue({ docs: [{ id: 'existing-registration', data: () => ({ name: 'Alex', lastName: 'Rivera', phone: '5551234', comments: 'See you there', registeredAt: { toDate: () => new Date(2026, 9, 29, 12) } }) }] });
  await render();
  expect(container.querySelector('table')).not.toBeNull();
  expect(container.querySelector('.registration-admin-count').textContent).toContain('1 registered');
  await act(async () => Simulate.click(container.querySelector('[aria-label="Edit registration for Alex Rivera"]')));
  expect(container.querySelector('#admin-registration-first-name').value).toBe('Alex');
  expect(container.querySelector('#admin-registration-last-name').value).toBe('Rivera');
  await change(container.querySelector('#admin-registration-phone'), '5556789');
  await act(async () => Simulate.submit(container.querySelector('form')));
  expect(updateDoc).toHaveBeenCalledWith('eventRegistrations/existing-registration', expect.objectContaining({ phone: '5556789' }));
  expect(container.querySelector('table').textContent).toContain('5556789');
});

test('admins can delete from the roster with confirmation', async () => {
  getDocs.mockResolvedValue({ docs: [{ id: 'existing-registration', data: () => ({ name: 'Alex', lastName: 'Rivera' }) }] });
  const confirmation = jest.spyOn(window, 'confirm').mockReturnValue(true);
  try {
    await render();
    await act(async () => Simulate.click(container.querySelector('[aria-label="Delete registration for Alex Rivera"]')));
    expect(confirmation).toHaveBeenCalled();
    expect(deleteDoc).toHaveBeenCalledWith('eventRegistrations/existing-registration');
    expect(container.querySelector('table')).toBeNull();
    expect(container.textContent).toContain('No registrations found');
  } finally {
    confirmation.mockRestore();
  }
});

test('public RSVP view never exposes management settings, export or the roster', async () => {
  jest.requireMock('../contexts/AuthContext').setTestUser(null);
  await render();
  expect(container.querySelector('[aria-label="Enable potluck question"]')).toBeNull();
  expect(container.querySelector('table')).toBeNull();
  expect(container.textContent).not.toContain('Export PDF');
  expect(getDocs).not.toHaveBeenCalled();
  container.querySelectorAll('form label').forEach(label => expect(container.querySelector(`#${label.htmlFor}`)).not.toBeNull());
});

test('the redesigned back control returns to organization event details', async () => {
  await render();
  await act(async () => Simulate.click(container.querySelector('.registration-back')));
  expect(container.textContent).toContain('Event details destination');
});