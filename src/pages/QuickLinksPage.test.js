import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { getDocs, getDocsFromServer, query, updateDoc, where } from 'firebase/firestore';
import { getDownloadURL } from 'firebase/storage';
import { getChurchData } from '../api/church';
import { useAuth } from '../contexts/AuthContext';
import QuickLinksPage from './QuickLinksPage';

jest.mock('../firebase', () => ({ db: {}, storage: {} }));
jest.mock('../api/church', () => ({ getChurchData: jest.fn() }));
jest.mock('../contexts/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('firebase/storage', () => ({ getDownloadURL: jest.fn(), ref: (_storage, path) => path, uploadBytes: jest.fn() }));
jest.mock('firebase/firestore', () => ({
  collection: (_database, ...segments) => segments.join('/'),
  doc: (_database, ...segments) => segments.join('/'),
  query: jest.fn((reference, ...constraints) => ({ reference, constraints })),
  where: jest.fn((...constraint) => constraint),
  getDocs: jest.fn().mockResolvedValue({ docs: [] }),
  getDocsFromServer: jest.fn().mockResolvedValue({ docs: [] }),
  updateDoc: jest.fn(),
  serverTimestamp: () => 'server-time',
}));

let container;
let root;
const media = [
  { title: 'First image', type: 'image', imageUrl: 'https://example.com/first.jpg' },
  { title: 'Second video', type: 'video', embedUrl: 'https://www.youtube.com/embed/test-video' },
];

const LocationProbe = () => {
  const location = useLocation();
  return <output data-testid="quick-links-search">{location.search}</output>;
};

const render = async (initialPath = '/organization/test-org/quick-links') => {
  await act(async () => root.render(
    <MemoryRouter initialEntries={[initialPath]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <LocationProbe />
      <Routes><Route path="/organization/:id/quick-links" element={<QuickLinksPage />} /></Routes>
    </MemoryRouter>
  ));
};

const clickButton = async (label) => {
  const button = Array.from(container.querySelectorAll('button')).find(element => element.textContent.trim() === label);
  expect(button).toBeDefined();
  await act(async () => Simulate.click(button));
};

const deleteFirstMedia = async () => {
  const preview = container.querySelector('#quick-links-content-editor [role="button"]');
  await act(async () => Simulate.click(preview));
  const deleteButton = container.querySelector('[aria-label="Delete selected media"]');
  expect(deleteButton.disabled).toBe(false);
  await act(async () => Simulate.click(deleteButton));
};

beforeEach(() => {
  jest.clearAllMocks();
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  getChurchData.mockResolvedValue({ name: 'Test Organization', quickLinksConfig: { videos: media } });
  useAuth.mockReturnValue({ user: { uid: 'admin' }, isAdmin: () => true, isGlobalAdmin: () => false });
  query.mockImplementation((reference, ...constraints) => ({ reference, constraints }));
  where.mockImplementation((...constraint) => constraint);
  getDocs.mockResolvedValue({ docs: [] });
  getDocsFromServer.mockResolvedValue({ docs: [] });
  getDownloadURL.mockResolvedValue('https://example.com/resolved-event.jpg');
  updateDoc.mockResolvedValue(undefined);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

test('public Quick Links queries only active forms allowed by Firestore rules', async () => {
  useAuth.mockReturnValue({ user: null, isAdmin: () => false, isGlobalAdmin: () => false });
  getDocsFromServer.mockResolvedValue({ docs: [
    { id: 'active-form', data: () => ({ title: 'Public form', isActive: true }) },
    { id: 'inactive-form', data: () => ({ title: 'Draft form', isActive: false }) },
  ] });
  await render();

  const formsQueryCall = getDocsFromServer.mock.calls.find(([request]) => request.reference === 'churches/test-org/forms');
  expect(formsQueryCall).toBeDefined();
  expect(formsQueryCall[0].constraints).toContainEqual(['isActive', '==', true]);
});

test('deletes selected media from the list and saves only the remaining item', async () => {
  await render();
  await clickButton('Edit Content');
  expect(container.querySelector('[aria-label="Delete selected media"]').disabled).toBe(true);
  await deleteFirstMedia();
  expect(Array.from(container.querySelectorAll('#quick-links-content-editor [role="button"]')).some(row => row.textContent.includes('First image'))).toBe(false);
  expect(container.querySelector('[role="status"]').textContent).toContain('Save Content to publish this deletion');
  expect(container.querySelector('[aria-label="Delete selected media"]').disabled).toBe(true);
  await clickButton('Save Content');
  expect(updateDoc).toHaveBeenCalledWith('churches/test-org', {
    quickLinksConfig: expect.objectContaining({ videos: [expect.objectContaining({ title: 'Second video' })] }),
  });
  expect(container.querySelector('[role="status"]').textContent).toContain('Content saved');
});

test('shows failed deletion saves and allows retrying without restoring removed media', async () => {
  await render();
  await clickButton('Edit Content');
  await deleteFirstMedia();
  updateDoc.mockRejectedValueOnce(new Error('Missing permissions'));
  await clickButton('Save Content');
  expect(container.querySelector('[role="alert"]').textContent).toContain('Changes were not saved. Missing permissions');
  expect(Array.from(container.querySelectorAll('#quick-links-content-editor [role="button"]')).some(row => row.textContent.includes('First image'))).toBe(false);
  expect(Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Discard Changes').disabled).toBe(false);
  await clickButton('Save Content');
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.querySelector('[role="status"]').textContent).toContain('Content saved');
  expect(updateDoc.mock.calls[1][1].quickLinksConfig.videos).toHaveLength(1);
});

test('deleting all media saves an empty array and keeps it empty after remounting', async () => {
  await render();
  await clickButton('Edit Content');
  await deleteFirstMedia();
  await deleteFirstMedia();
  await clickButton('Save Content');
  const savedConfig = updateDoc.mock.calls[0][1].quickLinksConfig;
  expect(savedConfig.videos).toEqual([]);
  getChurchData.mockResolvedValue({ name: 'Test Organization', quickLinksConfig: savedConfig });
  await act(async () => root.unmount());
  root = createRoot(container);
  await render();
  await clickButton('Edit Content');
  expect(container.querySelectorAll('#quick-links-content-editor [role="button"]')).toHaveLength(0);
  expect(container.textContent).not.toContain('Featured Video');
  expect(container.textContent).not.toContain('Next Watch');
});

test('discarding a media deletion restores the item without saving', async () => {
  await render();
  await clickButton('Edit Content');
  await deleteFirstMedia();
  await clickButton('Discard Changes');
  await clickButton('Edit Content');
  expect(container.querySelector('#quick-links-content-editor').textContent).toContain('First image');
  expect(updateDoc).not.toHaveBeenCalled();
});

test('organizations without a saved media configuration still receive the defaults', async () => {
  getChurchData.mockResolvedValue({ name: 'Test Organization' });
  await render();
  await clickButton('Edit Content');
  expect(container.querySelector('#quick-links-content-editor').textContent).toContain('Featured Video');
  expect(container.querySelector('#quick-links-content-editor').textContent).toContain('Next Watch');
});

test('slideshow fullscreen can be entered and exited on touch devices', async () => {
  await render();
  const enterButton = container.querySelector('[aria-label="View slideshow fullscreen"]');
  expect(enterButton).not.toBeNull();

  await act(async () => Simulate.click(enterButton));
  const fullscreenSlideshow = container.querySelector('[role="dialog"][aria-label="Fullscreen slideshow"]');
  expect(fullscreenSlideshow).not.toBeNull();
  expect(container.querySelector('[data-testid="quick-links-search"]').textContent).toBe("?slideshow=fullscreen");
  expect(fullscreenSlideshow.style.position).toBe("fixed");
  expect(fullscreenSlideshow.style.overflow).toBe("auto");
  expect(document.body.style.overflow).toBe("hidden");
  await clickButton("Copy link");
  expect(container.querySelector('[role="status"]').textContent).toMatch(/Fullscreen slideshow link copied|Copy is not available/);

  await act(async () => Simulate.click(container.querySelector('[aria-label="Exit fullscreen slideshow"]')));
  expect(container.querySelector('[role="dialog"][aria-label="Fullscreen slideshow"]')).toBeNull();
  expect(container.querySelector('[data-testid="quick-links-search"]').textContent).toBe("");
  expect(document.body.style.overflow).toBe("");
});

test("fullscreen slideshow opens directly from its custom URL", async () => {
  await render("/organization/test-org/quick-links?slideshow=fullscreen");

  expect(container.querySelector('[role="dialog"][aria-label="Fullscreen slideshow"]')).not.toBeNull();
  expect(document.body.style.overflow).toBe("hidden");
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
  expect(container.querySelector('[role="dialog"][aria-label="Fullscreen slideshow"]')).toBeNull();
  expect(container.querySelector('[data-testid="quick-links-search"]').textContent).toBe("");
  expect(document.body.style.overflow).toBe("");
});

const eventSnapshot = () => ({ docs: [
  { id: 'event-1', data: () => ({ title: 'Sunday Gathering', startDate: '11-01-2026', imageUrl: '/events/test-org/event-1/poster.jpg', description: 'Join us Sunday' }) },
  { id: 'event-2', data: () => ({ title: 'Community Meal', startDate: '10-01-2025', imageUrl: 'https://example.com/meal.jpg' }) },
  { id: 'event-3', data: () => ({ title: 'No Poster' }) },
  { id: 'event-4', data: () => ({ title: 'Removed Event', removed: true, imageUrl: 'https://example.com/removed.jpg' }) },
  { id: 'event-5', data: () => ({ title: 'Deleted Event', isDeleted: true }) },
] });

test('lists organization events with previews and imports multiple images without saving until requested', async () => {
  await render();
  await clickButton('Edit Content');
  getDocsFromServer.mockResolvedValue(eventSnapshot());
  await clickButton('Add From Events');
  expect(where).toHaveBeenCalledWith('churchId', '==', 'test-org');
  expect(query).toHaveBeenCalledWith('eventInstances', ['churchId', '==', 'test-org']);
  const picker = container.querySelector('#quick-links-event-picker');
  expect(picker.querySelectorAll('img')).toHaveLength(2);
  const eventRow = picker.querySelector('[aria-label="Select event Sunday Gathering"]').closest('label');
  expect(eventRow.textContent).toContain('Sunday Gathering');
  expect(eventRow.textContent).toContain('11-01-2026');
  const thumbnail = eventRow.querySelector('img');
  expect(thumbnail.style.width).toBe('auto');
  expect(thumbnail.style.height).toBe('auto');
  expect(thumbnail.style.maxWidth).toBe('100%');
  expect(thumbnail.style.maxHeight).toBe('100%');
  expect(thumbnail.style.objectFit).toBe('contain');
  expect(thumbnail.parentElement.style.width).toBe('64px');
  expect(thumbnail.parentElement.style.height).toBe('64px');
  expect(picker.textContent).toContain('10-01-2025');
  expect(picker.textContent).not.toContain('Removed Event');
  expect(picker.textContent).not.toContain('Deleted Event');
  expect(picker.querySelector('[aria-label="Select event No Poster"]').disabled).toBe(true);
  expect(getDownloadURL).toHaveBeenCalledWith('events/test-org/event-1/poster.jpg');
  for (const title of ['Sunday Gathering', 'Community Meal']) {
    await act(async () => Simulate.change(picker.querySelector(`[aria-label="Select event ${title}"]`), { target: { checked: true } }));
  }
  await clickButton('Add Selected (2)');
  expect(container.querySelector('#quick-links-event-picker')).toBeNull();
  expect(updateDoc).not.toHaveBeenCalled();
  await clickButton('Save Content');
  expect(updateDoc.mock.calls[0][1].quickLinksConfig.videos).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'image', title: 'Sunday Gathering', description: 'Join us Sunday', imageUrl: 'https://example.com/resolved-event.jpg', sourceEventId: 'event-1' }),
    expect.objectContaining({ type: 'image', title: 'Community Meal', imageUrl: 'https://example.com/meal.jpg', sourceEventId: 'event-2' }),
  ]));
  expect(updateDoc.mock.calls[0][1].quickLinksConfig.videos).toHaveLength(4);
});

test('searches events, preserves selection across searches, and disables unavailable images', async () => {
  await render();
  await clickButton('Edit Content');
  getDocsFromServer.mockResolvedValue(eventSnapshot());
  getDownloadURL.mockRejectedValue(new Error('Missing image'));
  await clickButton('Add From Events');
  expect(container.querySelector('[aria-label="Select event Sunday Gathering"]').disabled).toBe(true);
  const search = container.querySelector('[aria-label="Search events"]');
  await act(async () => Simulate.change(search, { target: { value: 'Community' } }));
  expect(container.querySelector('#quick-links-event-picker').textContent).not.toContain('Sunday Gathering');
  await act(async () => Simulate.change(container.querySelector('[aria-label="Select event Community Meal"]'), { target: { checked: true } }));
  await act(async () => Simulate.change(search, { target: { value: 'no matches' } }));
  expect(container.querySelector('#quick-links-event-picker').textContent).toContain('No matching events.');
  await clickButton('Add Selected (1)');
  await clickButton('Discard Changes');
  await clickButton('Edit Content');
  expect(container.querySelectorAll('#quick-links-content-editor [role="button"]')).toHaveLength(2);
  expect(updateDoc).not.toHaveBeenCalled();
});

test('shows an event load failure and allows retrying', async () => {
  await render();
  await clickButton('Edit Content');
  getDocsFromServer.mockRejectedValue(new Error('Offline'));
  getDocs.mockRejectedValue(new Error('Unavailable'));
  await clickButton('Add From Events');
  expect(container.querySelector('[role="alert"]').textContent).toContain('Could not load events');
  getDocsFromServer.mockResolvedValue(eventSnapshot());
  await clickButton('Retry');
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.querySelector('[aria-label="Select event Community Meal"]')).not.toBeNull();
});

test('orders events by distance from today across month and year boundaries with invalid dates last', async () => {
  jest.useFakeTimers('modern');
  jest.setSystemTime(new Date(2026, 11, 31, 15));
  try {
    await render();
    await clickButton('Edit Content');
    getDocsFromServer.mockResolvedValue({ docs: [
      { id: 'later', data: () => ({ title: 'Next month', startDate: '01-31-2027' }) },
      { id: 'missing', data: () => ({ title: 'Missing date' }) },
      { id: 'past', data: () => ({ title: 'Two days ago', startDate: '12-29-2026' }) },
      { id: 'invalid', data: () => ({ title: 'Invalid date', startDate: '02-30-2026' }) },
      { id: 'tomorrow', data: () => ({ title: 'Tomorrow', startDate: '2027-01-01' }) },
      { id: 'today', data: () => ({ title: 'Today', startDate: '12-31-2026' }) },
    ] });
    await clickButton('Add From Events');
    expect(Array.from(container.querySelectorAll('#quick-links-event-picker input[type="checkbox"]'))
      .map(checkbox => checkbox.getAttribute('aria-label'))).toEqual([
      'Select event Today',
      'Select event Tomorrow',
      'Select event Two days ago',
      'Select event Next month',
      'Select event Invalid date',
      'Select event Missing date',
    ]);
  } finally {
    jest.useRealTimers();
  }
});