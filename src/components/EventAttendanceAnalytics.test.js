import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { getDocs } from 'firebase/firestore';
import EventAttendanceAnalytics from './EventAttendanceAnalytics';

jest.mock('../firebase', () => ({ db: {} }));
jest.mock('firebase/firestore', () => ({
  collection: (_database, ...segments) => segments.join('/'),
  query: reference => reference,
  where: jest.fn(),
  getDocs: jest.fn(),
}));

let container;
let root;

const render = async () => {
  await act(async () => root.render(
    <MemoryRouter initialEntries={['/organization/test-org/all-events/counter-analytics']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/organization/:id/all-events/counter-analytics" element={<EventAttendanceAnalytics />} />
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
  getDocs.mockImplementation(async collectionName => ({
    docs: collectionName === 'eventInstances'
      ? [
        { id: 'event-1', data: () => ({ churchId: 'test-org', title: 'Sunday Gathering', startDate: '10-28-2026', attendanceCounts: { adults: 12, children: 5 } }) },
        { id: 'event-2', data: () => ({ churchId: 'test-org', title: 'Prayer Night', startDate: '11-05-2026', attendanceCounts: { adults: 8, children: 2 } }) },
      ]
      : [
        { id: 'event-1', data: () => ({ churchId: 'test-org', title: 'Duplicate Legacy Event', attendanceCounts: { adults: 100, children: 100 } }) },
        { id: 'event-3', data: () => ({ churchId: 'test-org', title: 'Legacy Event', startDate: '2026-10-30', attendanceCounts: { adults: 3, children: 2 } }) },
      ],
  }));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

test('shows per-event adult, child, and combined totals with a counter link', async () => {
  await render();
  expect(container.textContent).toContain('Counter Analytics');

  const rows = Array.from(container.querySelectorAll('tbody tr'));
  expect(rows).toHaveLength(3);
  const sundayRow = rows.find(row => row.textContent.includes('Sunday Gathering'));
  expect(sundayRow.textContent).toContain('12');
  expect(sundayRow.textContent).toContain('5');
  expect(sundayRow.textContent).toContain('17');
  expect(sundayRow.querySelector('a').getAttribute('href')).toBe('/organization/test-org/event/event-1/counter');
  expect(rows.find(row => row.textContent.includes('Prayer Night')).textContent).toContain('0');
  expect(container.textContent).not.toContain('Duplicate Legacy Event');
});

test('selecting a month filters events and updates monthly totals', async () => {
  await render();
  const monthSelect = container.querySelector('#counter-report-month');
  expect(Array.from(monthSelect.options).map(option => option.value)).toEqual(['all', '2026-11', '2026-10']);

  await act(async () => {
    monthSelect.value = '2026-10';
    monthSelect.dispatchEvent(new Event('change', { bubbles: true }));
  });

  const rows = Array.from(container.querySelectorAll('tbody tr'));
  expect(rows).toHaveLength(2);
  expect(rows.map(row => row.textContent).join(' ')).toContain('Sunday Gathering');
  expect(rows.map(row => row.textContent).join(' ')).toContain('Legacy Event');
  expect(rows.map(row => row.textContent).join(' ')).not.toContain('Prayer Night');
  expect(container.querySelector('[aria-label="Monthly adults"]').textContent).toBe('15');
  expect(container.querySelector('[aria-label="Monthly children"]').textContent).toBe('7');
  expect(container.querySelector('[aria-label="Monthly total attendance"]').textContent).toBe('22');
});