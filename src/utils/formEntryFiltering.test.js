import { filterAndSortFormEntries } from './formEntryFiltering';

const fields = [{ name: 'city', type: 'text' }, { name: 'age', type: 'number' }, { name: 'consent', type: 'boolean' }, { name: 'choices', type: 'checkbox' }, { name: 'date', type: 'date' }];
const entries = [
  { id: 'a', city: 'Chicago', age: 20, consent: false, choices: ['A', 'B'], date: '2026-10-28', createdAt: { toDate: () => new Date('2026-10-28T12:00:00Z') } },
  { id: 'b', city: 'Evanston', age: 9, consent: true, choices: ['B'], date: '2026-10-29', createdAt: { toDate: () => new Date('2026-10-29T12:00:00Z') } },
  { id: 'c', city: '', age: 0, consent: false, choices: [], createdAt: null },
];

test('combines global search with multiple field filters', () => {
  const result = filterAndSortFormEntries(entries, fields, { searchTerm: 'chic', filters: [{ field: 'age', operator: 'gte', value: '18' }, { field: 'choices', operator: 'equals', value: 'B' }] });
  expect(result.map((entry) => entry.id)).toEqual(['a']);
});

test('numeric sorting is numeric, reversible, and does not mutate entries', () => {
  expect(filterAndSortFormEntries(entries, fields, { sortField: 'age', sortDirection: 'asc' }).map((entry) => entry.age)).toEqual([0, 9, 20]);
  expect(filterAndSortFormEntries(entries, fields, { sortField: 'age', sortDirection: 'desc' }).map((entry) => entry.age)).toEqual([20, 9, 0]);
  expect(entries[0].id).toBe('a');
});

test('boolean false and zero remain filterable instead of being treated as empty', () => {
  expect(filterAndSortFormEntries(entries, fields, { filters: [{ field: 'consent', operator: 'equals', value: 'No' }] })).toHaveLength(2);
  expect(filterAndSortFormEntries(entries, fields, { filters: [{ field: 'age', operator: 'equals', value: '0' }] }).map((entry) => entry.id)).toEqual(['c']);
});

test('supports empty answers, not-equals, and date ranges', () => {
  expect(filterAndSortFormEntries(entries, fields, { filters: [{ field: 'choices', operator: 'empty', value: '' }] }).map((entry) => entry.id)).toEqual(['c']);
  expect(filterAndSortFormEntries(entries, fields, { filters: [{ field: 'choices', operator: 'notEquals', value: 'B' }] }).map((entry) => entry.id)).toEqual(['c']);
  expect(filterAndSortFormEntries(entries, fields, { filters: [{ field: 'date', operator: 'lte', value: '2026-10-28' }] }).map((entry) => entry.id)).toEqual(['a']);
});

test('keeps missing values last and sorts Firestore dates chronologically', () => {
  expect(filterAndSortFormEntries(entries, fields).map((entry) => entry.id)).toEqual(['b', 'a', 'c']);
  expect(filterAndSortFormEntries(entries, fields, { sortField: 'city', sortDirection: 'asc' }).map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
});