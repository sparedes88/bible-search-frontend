import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { addDoc, getDocs } from 'firebase/firestore';
import { toast } from 'react-toastify';
import RoomsPage from './RoomsPage';

jest.mock('../../firebase', () => ({ db: {} }));
jest.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: 'global_admin' } }) }));
jest.mock('react-toastify', () => ({ toast: { success: jest.fn(), error: jest.fn(), loading: jest.fn(), update: jest.fn() } }));
jest.mock('jspdf', () => ({ jsPDF: jest.fn() }));
jest.mock('firebase/firestore', () => ({
  collection: (_database, ...segments) => segments.join('/'),
  doc: (_database, ...segments) => segments.join('/'),
  query: (reference) => reference,
  orderBy: jest.fn(),
  getDocs: jest.fn(),
  addDoc: jest.fn(),
  updateDoc: jest.fn(),
  deleteDoc: jest.fn(),
}));

let container;
let root;
let campusDocs;
let roomDocs;

const render = async () => {
  await act(async () => root.render(
    <MemoryRouter initialEntries={['/organization/test-org/rooms']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes><Route path="/organization/:id/rooms" element={<RoomsPage />} /></Routes>
    </MemoryRouter>
  ));
};

beforeEach(() => {
  jest.clearAllMocks();
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  campusDocs = [{ id: 'campus-a', data: () => ({ name: 'Main Campus' }) }];
  roomDocs = [{ id: 'room-a', data: () => ({ name: 'Sanctuary', capacity: 100, campusId: 'campus-a' }) }];
  getDocs.mockImplementation(async reference => ({ docs: reference.endsWith('/campuses') ? campusDocs : roomDocs }));
  addDoc.mockResolvedValue(undefined);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

test('requires a campus selection before rooms can be chosen or added', async () => {
  await render();
  expect(container.firstElementChild.style.width).toBe('100%');
  expect(container.firstElementChild.style.maxWidth).toBe('100%');
  expect(container.firstElementChild.style.minHeight).toBe('100vh');
  const addRoomButton = () => Array.from(container.querySelectorAll('button')).find(button => button.textContent.includes('Add New Room'));
  expect(container.querySelector('[data-room-id="room-a"]')).toBeNull();
  expect(addRoomButton().disabled).toBe(true);

  await act(async () => Simulate.change(container.querySelector('#rooms-campus-filter'), { target: { value: 'campus-a' } }));
  expect(container.querySelector('[data-room-id="room-a"]')).not.toBeNull();
  expect(addRoomButton().disabled).toBe(false);
});