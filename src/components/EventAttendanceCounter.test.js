import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { toast } from 'react-toastify';
import EventAttendanceCounter from './EventAttendanceCounter';

jest.mock('../firebase', () => ({ db: {} }));
jest.mock('react-toastify', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('firebase/firestore', () => ({
  doc: (_database, ...segments) => segments.join('/'),
  getDoc: jest.fn(),
  updateDoc: jest.fn(),
  serverTimestamp: jest.fn(() => 'server-time'),
}));

let container;
let root;

const LocationProbe = () => <output data-testid="route">{useLocation().pathname}</output>;

const render = async (path = '/organization/test-org/event/event-1/counter') => {
  await act(async () => root.render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <LocationProbe />
      <Routes>
        <Route path="/organization/:id/event/:eventId/counter" element={<EventAttendanceCounter />} />
        <Route path="/organization/:id/event/:eventId" element={<p>Event details</p>} />
      </Routes>
    </MemoryRouter>
  ));
};

beforeEach(() => {
  jest.clearAllMocks();
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  getDoc.mockResolvedValue({
    exists: () => true,
    id: 'event-1',
    data: () => ({ title: 'Sunday Gathering', attendanceCounts: { adults: 3, children: 1 } }),
  });
  serverTimestamp.mockReturnValue('server-time');
  updateDoc.mockResolvedValue(undefined);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

test('counts adults and children, prevents negative totals, and saves the values', async () => {
  await render();
  expect(container.textContent).toContain('Sunday Gathering');
  expect(container.querySelector('[aria-label="Adults total"]').textContent).toBe('3');
  expect(container.querySelector('[aria-label="Children total"]').textContent).toBe('1');

  await act(async () => Simulate.click(container.querySelector('[aria-label="Increase adults"]')));
  await act(async () => Simulate.click(container.querySelector('[aria-label="Decrease children"]')));
  expect(container.querySelector('[aria-label="Adults total"]').textContent).toBe('4');
  expect(container.querySelector('[aria-label="Children total"]').textContent).toBe('0');
  expect(container.querySelector('[aria-label="Decrease children"]').disabled).toBe(true);

  await act(async () => Simulate.click(Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Save totals')));
  expect(updateDoc).toHaveBeenCalledWith('eventInstances/event-1', {
    attendanceCounts: { adults: 4, children: 0 },
    attendanceCountsUpdatedAt: 'server-time',
  });
  expect(toast.success).toHaveBeenCalledWith('Attendance totals saved');
});

test('back link returns to the event details page', async () => {
  await render();
  await act(async () => container.querySelector('a').click());
  expect(container.querySelector('[data-testid="route"]').textContent).toBe('/organization/test-org/event/event-1');
  expect(container.textContent).toContain('Event details');
});