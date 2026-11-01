import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import FormEntryFilters from './FormEntryFilters';
import { filterAndSortFormEntries } from '../utils/formEntryFiltering';

const fields = [{ name: 'city', label: 'City', type: 'text' }, { name: 'age', label: 'Age', type: 'number' }, { name: 'consent', label: 'Consent', type: 'boolean' }];
const entries = [{ city: 'Chicago', age: 20, consent: false }, { city: 'Evanston', age: 9, consent: true }];
const Harness = () => {
  const [filters, setFilters] = useState([]);
  const [sortField, setSortField] = useState('createdAt');
  const [sortDirection, setSortDirection] = useState('desc');
  const visible = filterAndSortFormEntries(entries, fields, { filters, sortField, sortDirection });
  return <>
    <FormEntryFilters fields={fields} filters={filters} onFiltersChange={setFilters} sortField={sortField} onSortFieldChange={setSortField} sortDirection={sortDirection} onSortDirectionChange={setSortDirection} onReset={() => { setFilters([]); setSortField('createdAt'); setSortDirection('desc'); }} matchingCount={visible.length} totalCount={entries.length} />
    <output aria-label="Visible entries">{visible.map((entry) => entry.city).join(', ')}</output>
  </>;
};
let container;
let root;
const click = async (label) => {
  const button = Array.from(container.querySelectorAll('button')).find((entry) => entry.textContent === label || entry.getAttribute('aria-label') === label);
  expect(button).toBeDefined();
  await act(async () => Simulate.click(button));
};
const change = async (selector, value) => {
  await act(async () => Simulate.change(container.querySelector(selector), { target: { value } }));
};
beforeEach(async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

test('adding typed filters narrows results and multiple filters combine', async () => {
  await click('Add Filter');
  await change('#filter-0-field', 'age');
  await change('#filter-0-operator', 'gte');
  await change('#filter-0-value', '18');
  expect(container.querySelector('[aria-label="Visible entries"]').textContent).toBe('Chicago');
  await click('Add Filter');
  await change('#filter-1-field', 'city');
  await change('#filter-1-value', 'Evanston');
  expect(container.textContent).toContain('0 of 2 entries');
  await click('Remove filter 2');
  expect(container.querySelector('[aria-label="Visible entries"]').textContent).toBe('Chicago');
});

test('sorting by a numeric field respects direction', async () => {
  await change('#entries-sort-field', 'age');
  await change('#entries-sort-direction', 'asc');
  expect(container.querySelector('[aria-label="Visible entries"]').textContent).toBe('Evanston, Chicago');
  await change('#entries-sort-direction', 'desc');
  expect(container.querySelector('[aria-label="Visible entries"]').textContent).toBe('Chicago, Evanston');
});

test('boolean filters offer Yes and No and Reset clears filters and sorting', async () => {
  await click('Add Filter');
  await change('#filter-0-field', 'consent');
  expect(container.querySelector('#filter-0-value').tagName).toBe('SELECT');
  await change('#filter-0-value', 'No');
  expect(container.querySelector('[aria-label="Visible entries"]').textContent).toBe('Chicago');
  await change('#entries-sort-field', 'age');
  await click('Reset');
  expect(container.querySelector('[role="group"]')).toBeNull();
  expect(container.querySelector('#entries-sort-field').value).toBe('createdAt');
  expect(container.querySelector('[aria-label="Visible entries"]').textContent).toBe('Chicago, Evanston');
});

test('empty/not-empty conditions do not require a comparison value', async () => {
  await click('Add Filter');
  await change('#filter-0-operator', 'notEmpty');
  expect(container.querySelector('#filter-0-value').disabled).toBe(true);
  expect(container.textContent).toContain('2 of 2 entries');
});