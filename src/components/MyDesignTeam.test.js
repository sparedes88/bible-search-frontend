import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { getDoc, onSnapshot, updateDoc, where } from 'firebase/firestore';
import MyDesignTeam from './MyDesignTeam';

jest.mock('../firebase', () => ({ db: {}, storage: {}, auth: {} }));
jest.mock('./ChurchHeader', () => () => null);
jest.mock('../contexts/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('react-toastify', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock('firebase/firestore', () => ({
  doc: (_database, ...segments) => segments.join('/'),
  collection: (_database, ...segments) => segments.join('/'),
  query: (reference, ...constraints) => ({ reference, constraints }),
  where: jest.fn(),
  orderBy: (...args) => args,
  limit: value => value,
  getDoc: jest.fn(),
  onSnapshot: jest.fn(),
  updateDoc: jest.fn(),
  addDoc: jest.fn(),
  setDoc: jest.fn(),
  deleteDoc: jest.fn(),
  writeBatch: jest.fn(),
  serverTimestamp: () => 'server-time',
}));

let container;
let root;
let designs;

const EventsDestination = () => <p>All events {useLocation().pathname}</p>;
const render = async () => {
  await act(async () => root.render(
    <MemoryRouter initialEntries={['/organization/test-org/my-design-team?eventId=event-one']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/organization/:id/my-design-team" element={<MyDesignTeam />} />
        <Route path="/organization/:id/all-events" element={<EventsDestination />} />
      </Routes>
    </MemoryRouter>
  ));
};
const button = text => Array.from(container.querySelectorAll('button')).find(element => element.textContent.includes(text));

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
  jest.requireMock('../contexts/AuthContext').useAuth.mockReturnValue({
    user: { uid: 'admin', role: 'admin', churchId: 'test-org' },
  });
  where.mockImplementation((...args) => args);
  getDoc.mockImplementation(async reference => ({
    exists: () => true,
    data: () => reference === 'eventInstances/event-one'
      ? { churchId: 'test-org', title: 'Family Night', startDate: '11-02-2026', startHour: '18:00', endHour: '20:00', location: 'Main Hall', description: 'Dinner and music' }
      : { name: 'Test Organization' },
  }));
  designs = [];
  onSnapshot.mockImplementation((target, callback) => {
    callback({ docs: target.reference.endsWith('myDesignTeamRequests')
      ? designs.map(design => ({ id: design.id, data: () => design })) : [] });
    return () => {};
  });
  updateDoc.mockResolvedValue(undefined);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

test('prefills the event brief and scopes saved designs to this event', async () => {
  await render();
  expect(container.querySelector('h1').textContent).toBe('Family Night');
  expect(container.querySelector('#design-title').value).toBe('Family Night');
  expect(container.querySelector('#design-date').value).toBe('2026-11-02');
  expect(container.querySelector('#design-start-time').value).toBe('18:00');
  expect(container.querySelector('#design-location').value).toBe('Main Hall');
  expect(container.querySelector('#design-notes').value).toBe('Dinner and music');
  expect(where).toHaveBeenCalledWith('eventId', '==', 'event-one');
  expect(button('Use for event').disabled).toBe(true);
  await act(async () => Simulate.click(button('Back to events')));
  expect(container.textContent).toContain('/organization/test-org/all-events');
  expect(updateDoc).not.toHaveBeenCalled();
});

const useSavedDesigns = () => {
  designs = [
    { id: 'original', eventId: 'event-one', status: 'completed', rootRequestId: 'original', imageUrl: 'https://example.com/first.png', imageStoragePath: 'designs/first.png', createdAt: 1, formSnapshot: { title: 'Original brief' } },
    { id: 'revision', eventId: 'event-one', status: 'completed', parentRequestId: 'original', rootRequestId: 'original', imageUrl: 'https://example.com/revised.png', imageStoragePath: 'designs/revised.png', createdAt: 2, formSnapshot: { title: 'Refined brief' }, editInstruction: 'Make the title larger' },
  ];
};

test('reopens the latest event revision and applies it before returning to events', async () => {
  useSavedDesigns();
  await render();
  expect(container.querySelector('#design-title').value).toBe('Refined brief');
  expect(container.querySelector('img[alt="Viewed design version"]').getAttribute('src')).toBe('https://example.com/revised.png');
  await act(async () => Simulate.click(button('Use for event')));
  expect(updateDoc).toHaveBeenCalledWith('eventInstances/event-one', { imageUrl: 'designs/revised.png', designRequestId: 'revision' });
  expect(container.textContent).toContain('/organization/test-org/all-events');
});

test('applies the selected older version rather than always using the latest revision', async () => {
  useSavedDesigns();
  await render();
  await act(async () => Simulate.click(container.querySelectorAll('[aria-label="View this version"]')[0]));
  await act(async () => Simulate.click(button('Use for event')));
  expect(updateDoc).toHaveBeenCalledWith('eventInstances/event-one', { imageUrl: 'designs/first.png', designRequestId: 'original' });
});

test('keeps the design available when updating the event fails', async () => {
  useSavedDesigns();
  updateDoc.mockRejectedValue(new Error('Permission denied'));
  await render();
  await act(async () => Simulate.click(button('Use for event')));
  expect(container.querySelector('h1').textContent).toBe('Family Night');
  expect(require('react-toastify').toast.error).toHaveBeenCalledWith('Could not update the event image. Your design is still saved.');
  expect(button('Use for event').disabled).toBe(false);
});

test('members cannot apply designs to an event', async () => {
  useSavedDesigns();
  jest.requireMock('../contexts/AuthContext').useAuth.mockReturnValue({ user: { uid: 'member', role: 'member', churchId: 'test-org' } });
  await render();
  expect(button('Use for event')).toBeUndefined();
  expect(updateDoc).not.toHaveBeenCalled();
});