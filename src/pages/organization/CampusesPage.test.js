import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { getDocs } from 'firebase/firestore';
import CampusesPage from './CampusesPage';

jest.mock('../../firebase', () => ({ db: {} }));
jest.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { email: 'tester@example.com' } }) }));
jest.mock('react-toastify', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('firebase/firestore', () => ({
  collection: (_database, ...segments) => segments.join('/'),
  query: (reference) => reference,
  orderBy: jest.fn(),
  getDocs: jest.fn(),
  addDoc: jest.fn(),
  updateDoc: jest.fn(),
  deleteDoc: jest.fn(),
  doc: (_database, ...segments) => segments.join('/'),
}));

let container;
let root;

beforeEach(() => {
  jest.clearAllMocks();
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  getDocs.mockResolvedValue({ docs: [{
    id: 'campus-1',
    data: () => ({
      name: 'Main Campus',
      address: { country: 'US', state: 'Illinois', street: '123 Main St', zip: '60601', city: 'Chicago' },
      description: 'Main location',
    }),
  }] });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

test('structured campus addresses render as text and populate the edit form', async () => {
  await act(async () => root.render(
    <MemoryRouter initialEntries={['/organization/test-org/campuses']}>
      <Routes><Route path="/organization/:id/campuses" element={<CampusesPage />} /></Routes>
    </MemoryRouter>
  ));

  expect(container.textContent).toContain('123 Main St, Chicago, Illinois, 60601, US');
  const editButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent.includes('Edit'));
  await act(async () => Simulate.click(editButton));
  expect(container.querySelector('input[name="address"]').value).toBe('123 Main St, Chicago, Illinois, 60601, US');
});