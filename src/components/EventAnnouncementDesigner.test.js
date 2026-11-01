import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { getDoc, getDocs, onSnapshot, updateDoc } from 'firebase/firestore';
import { getDownloadURL, uploadBytes } from 'firebase/storage';
import EventAnnouncementDesigner, { buildOpenAIAnnouncementPrompt, formatAnnouncementTime } from './EventAnnouncementDesigner';
import { composeEventAnnouncement } from '../utils/eventAnnouncementLayout';
import { downloadEventImage } from '../utils/downloadEventImage';
import { getEventDesignDetails } from '../utils/eventDesignDetails';

jest.mock('../utils/downloadEventImage', () => ({ downloadEventImage: jest.fn() }));

jest.mock('../utils/eventAnnouncementLayout', () => ({
  ...jest.requireActual('../utils/eventAnnouncementLayout'),
  composeEventAnnouncement: jest.fn(),
}));

jest.mock('../firebase', () => ({ db: {}, storage: {}, auth: { currentUser: { getIdToken: jest.fn() } } }));
jest.mock('../contexts/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('react-toastify', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('firebase/firestore', () => ({
  doc: (_database, ...segments) => segments.join('/'),
  collection: (_database, ...segments) => segments.join('/'),
  query: (reference, ...constraints) => ({ reference, constraints }),
  where: (...args) => args,
  getDoc: jest.fn(),
  getDocs: jest.fn(),
  onSnapshot: jest.fn(),
  updateDoc: jest.fn(),
}));
jest.mock('firebase/storage', () => ({
  ref: (_storage, path) => path,
  getDownloadURL: jest.fn(),
  uploadBytes: jest.fn(),
}));

let container;
let root;
let eventData;
let originalFetch;
let costSubscriber;
const render = async (search = '') => {
  await act(async () => root.render(
    <React.StrictMode>
      <MemoryRouter initialEntries={[`/organization/test-org/event/event-one/design${search}`]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/organization/:id/event/:eventId/design" element={<EventAnnouncementDesigner />} />
          <Route path="/organization/:id/all-events" element={<p>All events destination</p>} />
        </Routes>
      </MemoryRouter>
    </React.StrictMode>
  ));
};
const button = text => Array.from(container.querySelectorAll('button')).find(element => element.textContent.includes(text));
const submitNewOptionsPrompt = async (prompt = 'A clean new TV announcement') => {
  await act(async () => Simulate.change(container.querySelector('#event-new-design-prompt'), { target: { value: prompt } }));
  await act(async () => Simulate.submit(container.querySelector('[aria-label="New design options"]')));
};
const requestNewOptions = async () => {
  await act(async () => Simulate.click(button('New options')));
  await submitNewOptionsPrompt();
};
const savedOptions = () => ['Editorial', 'Community', 'Spotlight'].map((name, index) => {
  const version = { imagePath: `events/test-org/event-one/saved-${index}.png`, imageUrl: `https://example.com/design-${index}.png`, artworkUrl: `https://example.com/artwork-${index}.png`, brief: '', createdAt: '2026-10-29' };
  return { ...version, name, versions: [version] };
});

beforeEach(() => {
  jest.clearAllMocks();
  global.IS_REACT_ACT_ENVIRONMENT = true;
  eventData = { churchId: 'test-org', title: 'Family Night', startDate: '2026-11-02', startHour: '18:00', endHour: '20:30', location: 'Main Hall', description: 'Dinner and music' };
  jest.requireMock('../contexts/AuthContext').useAuth.mockReturnValue({ user: { uid: 'admin', role: 'admin', churchId: 'test-org' }, loading: false });
  jest.requireMock('../firebase').auth.currentUser.getIdToken.mockResolvedValue('test-token');
  getDoc.mockImplementation(async reference => ({
    exists: () => true,
    data: () => reference === 'eventInstances/event-one' ? eventData
      : reference === 'churches/test-org' ? { name: 'Lighthouse Church', logo: 'https://example.com/logo.png', brandColors: ['#123456', '#abc123'] }
        : { organizationName: 'Unrelated module', logoUrl: 'https://example.com/other.png', brandColors: ['#ff0000'] },
  }));
  updateDoc.mockResolvedValue(undefined);
  getDocs.mockResolvedValue({ docs: [] });
  onSnapshot.mockImplementation((_reference, callback) => {
    costSubscriber = callback;
    callback({ exists: () => true, data: () => eventData });
    return () => {};
  });
  uploadBytes.mockResolvedValue({});
  composeEventAnnouncement.mockResolvedValue(new Blob(['composed-poster'], { type: 'image/png' }));
  getDownloadURL.mockImplementation(async path => `https://example.com/${encodeURIComponent(path)}`);
  originalFetch = global.fetch;
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ imageBase64: 'aW1hZ2U=', mimeType: 'image/png' }) });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  global.fetch = originalFetch;
});

test('creates three distinct branded announcements only after an explicit prompt, including in StrictMode', async () => {
  await render();
  expect(global.fetch).not.toHaveBeenCalled();
  await requestNewOptions();
  expect(global.fetch).toHaveBeenCalledTimes(3);
  const requests = global.fetch.mock.calls.map(([, request]) => JSON.parse(request.body));
  requests.forEach(request => {
    expect(request.churchId).toBe('test-org');
    expect(request.eventId).toBe('event-one');
    expect(request.referenceImageUrls).toEqual(['https://example.com/logo.png']);
    expect(request.prompt).toContain('#123456, #abc123');
    expect(request.prompt).toContain('Lighthouse Church');
    expect(request.prompt).toContain('Family Night');
    expect(request.prompt).toContain('Main Hall');
    expect(request.prompt).toContain('6:00 PM');
    expect(request.prompt).toContain('8:30 PM');
    expect(request.prompt).not.toContain('18:00');
    expect(request.prompt).not.toContain('20:30');
    expect(request.prompt).toContain('1920x1080');
    expect(request.prompt).toContain('landscape 16:9');
    expect(request.prompt).toContain('CLEAN, UNIQUE');
    expect(request.prompt).toContain('96 pixels');
  });
  expect(getDoc.mock.calls.every(([path]) => !path.includes('myDesignTeam'))).toBe(true);
  expect(container.querySelector('.event-designer-heading p').textContent).toContain('6:00 PM - 8:30 PM');
  expect(new Set(requests.map(request => request.prompt)).size).toBe(3);
  expect(global.fetch.mock.calls.every(([url]) => url.endsWith('/generateEventDesignWithOpenAI'))).toBe(true);
  expect(uploadBytes).toHaveBeenCalledTimes(3);
  expect(composeEventAnnouncement).not.toHaveBeenCalled();
  uploadBytes.mock.calls.forEach(([path]) => expect(path).toMatch(/^events\/test-org\/event-one\/announcement-(artwork-)?\d-\d+\.png$/));
  expect(container.querySelectorAll('.event-designer-preview img')).toHaveLength(3);
  expect(Array.from(container.querySelectorAll('.event-designer-source')).every(element => element.textContent === 'OpenAI')).toBe(true);
  expect(updateDoc.mock.calls.every(([, changes]) => !Object.hasOwn(changes, 'imageUrl'))).toBe(true);
  expect(updateDoc.mock.calls[2][1].announcementDesigns).toHaveLength(3);
  expect(updateDoc.mock.calls[2][1].announcementDesigns.every(option => option.provider === 'openai' && option.width === 1920 && option.height === 1080)).toBe(true);
  expect(container.querySelector('#event-design-provider')).toBeNull();
});

test.each([
  ['00:00', '12:00 AM'], ['12:00', '12:00 PM'], ['19:00', '7:00 PM'],
  ['08:05', '8:05 AM'], ['23:59', '11:59 PM'], ['7:30 pm', '7:30 PM'],
  ['12:00 AM', '12:00 AM'], ['12:00 PM', '12:00 PM'], ['', ''], ['25:00', ''],
])('formats %s as %s', (value, expected) => {
  expect(formatAnnouncementTime(value)).toBe(expected);
});

test('opening a saved design never regenerates, even through an old fresh link', async () => {
  eventData.announcementDesigns = savedOptions().map(option => ({ ...option, brief: 'Old unrelated template and neon decorations' }));
  await render('?fresh=1');
  expect(global.fetch).not.toHaveBeenCalled();
  expect(uploadBytes).not.toHaveBeenCalled();
  await act(async () => Simulate.click(button('New options')));
  expect(global.fetch).not.toHaveBeenCalled();
  await submitNewOptionsPrompt();
  expect(global.fetch).toHaveBeenCalledTimes(3);
  global.fetch.mock.calls.forEach(([, request]) => {
    const body = JSON.parse(request.body);
    expect(body.previousImageUrl).toBe('');
    expect(body.prompt).not.toContain('neon decorations');
    expect(body.prompt).toContain('completely new original composition');
  });
  expect(updateDoc.mock.calls[2][1].announcementDesigns.every(option => option.brief === 'A clean new TV announcement')).toBe(true);
});

test('an event with an existing card image does not generate automatically', async () => {
  eventData.imageUrl = 'events/test-org/event-one/existing.jpg';
  await render();
  expect(global.fetch).not.toHaveBeenCalled();
  expect(uploadBytes).not.toHaveBeenCalled();
});

test('new designs use logo colors when the organization has no palette and omit prior module feedback', () => {
  const prompt = buildOpenAIAnnouncementPrompt(eventData, { name: 'Church', colors: [], logoUrl: 'https://example.com/logo.png' }, 0, '', 'Old module prompt');
  expect(prompt).toContain('Derive the brand accents from the supplied official logo');
  expect(prompt).toContain('CLEAN, UNIQUE');
  expect(prompt).toContain('Omit empty fields');
  expect(prompt).not.toContain('Old module prompt');
});

test('Spanish events use English Month DD, YYYY dates in new designs and refinements', () => {
  const event = { title: 'Domingo Comida en Familia', language: 'es', startDate: '11-01-2026', endDate: '2026-11-03' };
  const brand = { name: 'Church', colors: [], logoUrl: '' };
  for (const instruction of ['', 'Make the title larger']) {
    const prompt = buildOpenAIAnnouncementPrompt(event, brand, 0, instruction);
    expect(prompt).toContain('"date":"November 01, 2026"');
    expect(prompt).toContain('"endDate":"November 03, 2026"');
    expect(prompt).toContain('Never translate dates into Spanish');
    expect(prompt).not.toContain('de noviembre');
    expect(prompt).toContain('Domingo Comida en Familia');
  }
});

test('reopens saved options without spending credits and applies the selected design', async () => {
  eventData.announcementDesigns = savedOptions();
  await render();
  expect(global.fetch).not.toHaveBeenCalled();
  await act(async () => Simulate.click(container.querySelector('[aria-label="Select Community design"]')));
  await act(async () => Simulate.click(button('Use this design')));
  expect(updateDoc).toHaveBeenCalledWith('eventInstances/event-one', expect.objectContaining({ imageUrl: 'events/test-org/event-one/saved-1.png' }));
  expect(container.textContent).toContain('All events destination');
});

test('refines only the selected option using its current image and preserves earlier versions', async () => {
  eventData.announcementDesigns = savedOptions();
  await render();
  await act(async () => Simulate.click(container.querySelector('[aria-label="Select Community design"]')));
  await act(async () => Simulate.change(container.querySelector('textarea'), { target: { value: 'Include activities for children and a bigger title' } }));
  await act(async () => Simulate.click(button('Refine design')));
  expect(global.fetch).toHaveBeenCalledTimes(1);
  const request = JSON.parse(global.fetch.mock.calls[0][1].body);
  expect(request.previousImageUrl).toBe('https://example.com/design-1.png');
  expect(request.prompt).toContain('activities for children');
  const saved = updateDoc.mock.calls[0][1].announcementDesigns;
  expect(saved[0].imagePath).toBe(eventData.announcementDesigns[0].imagePath);
  expect(saved[1].versions).toHaveLength(2);
  expect(saved[2].imagePath).toBe(eventData.announcementDesigns[2].imagePath);
  await act(async () => Simulate.click(button('Version 1')));
  await act(async () => Simulate.click(button('Use this design')));
  expect(updateDoc).toHaveBeenLastCalledWith('eventInstances/event-one', expect.objectContaining({ imageUrl: 'events/test-org/event-one/saved-1.png' }));
});

test('stops on depleted credits instead of repeating requests', async () => {
  global.fetch.mockResolvedValue({ ok: false, json: async () => ({ error: 'Your prepayment credits are depleted.' }) });
  await render();
  await requestNewOptions();
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[role="alert"]').textContent).toContain('OpenAI API credits');
  expect(updateDoc).not.toHaveBeenCalled();
  expect(button('New options').disabled).toBe(false);
});

test('preserves completed options if generating a later option fails', async () => {
  global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ imageBase64: 'aW1hZ2U=', mimeType: 'image/png' }) })
    .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Service unavailable' }) });
  await render();
  await requestNewOptions();
  expect(global.fetch).toHaveBeenCalledTimes(2);
  expect(container.querySelectorAll('.event-designer-preview img')).toHaveLength(1);
  expect(button('Use this design').disabled).toBe(false);
});

test('blocks non-managers and events belonging to another organization', async () => {
  eventData.churchId = 'other-org';
  await render();
  expect(container.querySelector('[role="alert"]').textContent).toContain('Event not found');
  expect(global.fetch).not.toHaveBeenCalled();
});

test('members cannot trigger paid generation', async () => {
  jest.requireMock('../contexts/AuthContext').useAuth.mockReturnValue({ user: { uid: 'member', role: 'member', churchId: 'test-org' }, loading: false });
  await render();
  expect(container.querySelector('[role="alert"]').textContent).toContain('Only event managers');
  expect(getDoc).not.toHaveBeenCalled();
  expect(global.fetch).not.toHaveBeenCalled();
});

test('regenerates all three saved options with OpenAI only', async () => {
  eventData.announcementDesigns = savedOptions();
  await render();
  await requestNewOptions();
  expect(global.fetch).toHaveBeenCalledTimes(3);
  expect(global.fetch.mock.calls.every(([url]) => url.endsWith('/generateEventDesignWithOpenAI'))).toBe(true);
  expect(composeEventAnnouncement).not.toHaveBeenCalled();
  expect(uploadBytes).toHaveBeenCalledTimes(3);
  expect(updateDoc.mock.calls[2][1].announcementDesigns.every(option => option.provider === 'openai')).toBe(true);
});

test('reports invalid server OpenAI credentials without retrying or silently using Gemini', async () => {
  global.fetch.mockResolvedValue({ ok: false, json: async () => ({ error: 'The server OpenAI API key was rejected. Update the server-side key.' }) });
  await render();
  await requestNewOptions();
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(global.fetch.mock.calls[0][0]).toContain('/generateEventDesignWithOpenAI');
  expect(container.querySelector('[role="alert"]').textContent).toContain('server OpenAI API key was rejected');
  expect(uploadBytes).not.toHaveBeenCalled();
});

test('shows selected version cost and live tracked event spending at the top', async () => {
  eventData.announcementDesigns = savedOptions().map((option, index) => ({ ...option, billing: { usd: 0.12 + index * 0.01, kind: 'usage_estimate', currency: 'USD' } }));
  eventData.announcementGenerationCost = { usd: 0.45, generations: 3, unknownGenerations: 0 };
  await render();
  const summary = container.querySelector('[aria-label="Design cost"]');
  expect(Array.from(summary.querySelectorAll('strong')).map(element => element.textContent)).toEqual(['$0.12', '$0.45']);
  await act(async () => Simulate.click(container.querySelector('[aria-label="Select Community design"]')));
  expect(summary.querySelector('strong').textContent).toBe('$0.13');
  await act(async () => costSubscriber({ exists: () => true, data: () => ({ announcementGenerationCost: { usd: 0.59, generations: 4, unknownGenerations: 0 } }) }));
  expect(summary.querySelectorAll('strong')[1].textContent).toBe('$0.59');
});

test('old designs without usage never display a fabricated zero cost', async () => {
  eventData.announcementDesigns = savedOptions();
  await render();
  const summary = container.querySelector('[aria-label="Design cost"]');
  expect(summary.textContent).toContain('Cost not recorded');
  expect(summary.textContent).toContain('Not recorded yet');
  expect(summary.textContent).not.toContain('$0.00');
});

test('persists usage and pricing on each generated design version', async () => {
  const billing = { usd: 0.1234, kind: 'usage_estimate', currency: 'USD', tracked: true };
  global.fetch.mockResolvedValue({ ok: true, json: async () => ({ imageBase64: 'aW1hZ2U=', mimeType: 'image/png', billing }) });
  await render();
  await requestNewOptions();
  expect(updateDoc.mock.calls[2][1].announcementDesigns.every(option => option.billing.usd === billing.usd)).toBe(true);
  expect(container.querySelector('[aria-label="Design cost"] strong').textContent).toBe('$0.1234');
});

test('selecting an old unpriced version clears the newer version cost', async () => {
  eventData.announcementDesigns = savedOptions().map(option => ({ ...option, billing: { usd: 0.25, kind: 'usage_estimate' } }));
  await render();
  expect(container.querySelector('[aria-label="Design cost"] strong').textContent).toBe('$0.25');
  await act(async () => Simulate.click(button('Version 1')));
  expect(container.querySelector('[aria-label="Design cost"] strong').textContent).toBe('Cost not recorded');
});

test('applying a shared master design updates only its active organization series', async () => {
  eventData.announcementDesigns = savedOptions();
  Object.assign(eventData, { isRecurrenceMaster: true, recurrenceSeriesId: 'family-series', useMasterDesignForSeries: true });
  getDocs.mockResolvedValue({ docs: [
    { id: 'child', data: () => ({ churchId: 'test-org', recurrenceSeriesId: 'family-series' }) },
    { id: 'other-org', data: () => ({ churchId: 'other-org', recurrenceSeriesId: 'family-series' }) },
    { id: 'other-series', data: () => ({ churchId: 'test-org', recurrenceSeriesId: 'other-series' }) },
    { id: 'removed', data: () => ({ churchId: 'test-org', recurrenceSeriesId: 'family-series', removed: true }) },
  ] });
  await render();
  await act(async () => Simulate.click(button('Use this design')));
  expect(updateDoc.mock.calls).toEqual([
    ['eventInstances/event-one', expect.objectContaining({ imageUrl: 'events/test-org/event-one/saved-0.png' })],
    ['eventInstances/child', expect.objectContaining({ imageUrl: 'events/test-org/event-one/saved-0.png' })],
  ]);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('a master with sharing off keeps the selected design on that event only', async () => {
  eventData.announcementDesigns = savedOptions();
  Object.assign(eventData, { isRecurrenceMaster: true, recurrenceSeriesId: 'family-series', useMasterDesignForSeries: false });
  await render();
  await act(async () => Simulate.click(button('Use this design')));
  expect(getDocs).not.toHaveBeenCalled();
  expect(updateDoc).toHaveBeenCalledTimes(1);
});

test('each saved image has a loading progress bar until its image loads', async () => {
  eventData.announcementDesigns = savedOptions();
  await render();
  const bars = container.querySelectorAll('progress');
  expect(bars).toHaveLength(3);
  expect(Array.from(bars).every(bar => !bar.hasAttribute('value'))).toBe(true);
  expect(bars[0].getAttribute('aria-valuetext')).toBe('Loading image...');
  await act(async () => Simulate.load(container.querySelector('.event-designer-preview img')));
  expect(bars[0].value).toBe(100);
  expect(bars[0].getAttribute('aria-valuetext')).toBe('Ready');
  expect(bars[1].hasAttribute('value')).toBe(false);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('progress bars distinguish the active generation from queued options', async () => {
  let finishRequest;
  global.fetch.mockImplementationOnce(() => new Promise(resolve => { finishRequest = resolve; }));
  await render();
  await requestNewOptions();
  const bars = container.querySelectorAll('progress');
  expect(bars[0].getAttribute('aria-valuetext')).toBe('Generating design...');
  expect(bars[0].hasAttribute('value')).toBe(false);
  expect(bars[1].getAttribute('aria-valuetext')).toBe('Queued');
  expect(bars[1].value).toBe(0);
  expect(bars[2].getAttribute('aria-valuetext')).toBe('Queued');
  await act(async () => finishRequest({ ok: true, json: async () => ({ imageBase64: 'aW1hZ2U=', mimeType: 'image/png' }) }));
  expect(Array.from(bars).every(bar => bar.getAttribute('aria-valuetext') === 'Loading image...')).toBe(true);
});

test('failed generation stops the active bar and pauses queued options', async () => {
  global.fetch.mockResolvedValue({ ok: false, json: async () => ({ error: 'Service unavailable' }) });
  await render();
  await requestNewOptions();
  const bars = container.querySelectorAll('progress');
  expect(bars[0].getAttribute('aria-valuetext')).toBe('Generation failed');
  expect(bars[0].value).toBe(0);
  expect(bars[1].getAttribute('aria-valuetext')).toBe('Waiting to retry');
  expect(bars[2].getAttribute('aria-valuetext')).toBe('Waiting to retry');
});

test('a failed image load does not display a completed progress bar', async () => {
  eventData.announcementDesigns = savedOptions();
  await render();
  await act(async () => Simulate.error(container.querySelector('.event-designer-preview img')));
  const bar = container.querySelector('progress');
  expect(bar.value).toBe(0);
  expect(bar.getAttribute('aria-valuetext')).toBe('Image failed to load');
});

test('regeneration stays in saving until the new image is saved and loaded', async () => {
  eventData.announcementDesigns = savedOptions();
  let finishUpload;
  uploadBytes.mockImplementationOnce(() => new Promise(resolve => { finishUpload = resolve; }));
  await render();
  const regenerateButton = container.querySelector('[aria-label="Regenerate Editorial design"]');
  await act(async () => Simulate.click(regenerateButton));
  await submitNewOptionsPrompt();
  const bar = container.querySelector('progress');
  expect(bar.getAttribute('aria-valuetext')).toBe('Saving design...');
  await act(async () => Simulate.load(container.querySelector('.event-designer-preview img')));
  expect(bar.getAttribute('aria-valuetext')).toBe('Saving design...');
  await act(async () => finishUpload({}));
  expect(bar.getAttribute('aria-valuetext')).toBe('Loading image...');
  await act(async () => Simulate.load(container.querySelector('.event-designer-preview img')));
  expect(bar.value).toBe(100);
  expect(bar.getAttribute('aria-valuetext')).toBe('Ready');
});

test('uploads an image without generating and includes it in the next design request', async () => {
  eventData.announcementDesigns = savedOptions();
  await render();
  const file = new File(['photo'], 'speaker.png', { type: 'image/png' });
  await act(async () => Simulate.change(container.querySelector('[aria-label="Upload design images"]'), { target: { files: [file], value: 'speaker.png' } }));
  expect(global.fetch).not.toHaveBeenCalled();
  const uploaded = updateDoc.mock.calls[0][1].announcementReferenceImages[0];
  expect(uploaded.name).toBe('speaker.png');
  expect(uploaded.mode).toBe('include');
  expect(uploaded.imagePath).toMatch(/^events\/test-org\/event-one\/reference-\d+-0-speaker\.png$/);
  expect(container.querySelector('img[alt="speaker.png"]')).not.toBeNull();
  await requestNewOptions();
  const request = JSON.parse(global.fetch.mock.calls[0][1].body);
  expect(request.referenceImageUrls).toEqual(['https://example.com/logo.png', uploaded.imageUrl]);
  expect(request.prompt).toContain('ADD TO DESIGN');
  expect(request.prompt).toContain('speaker.png');
});

test('saves image usage modes and sends style references alongside a refinement', async () => {
  eventData.announcementDesigns = savedOptions();
  eventData.announcementReferenceImages = [{ id: 'ref-one', name: 'inspiration.jpg', imagePath: 'events/ref.jpg', imageUrl: 'https://example.com/ref.jpg', mode: 'include' }];
  await render();
  await act(async () => Simulate.change(container.querySelector('[aria-label="Image use for inspiration.jpg"]'), { target: { value: 'reference' } }));
  expect(updateDoc.mock.calls[0][1].announcementReferenceImages[0].mode).toBe('reference');
  await act(async () => Simulate.change(container.querySelector('textarea'), { target: { value: 'Use this visual style' } }));
  await act(async () => Simulate.click(button('Refine design')));
  const request = JSON.parse(global.fetch.mock.calls[0][1].body);
  expect(request.previousImageUrl).toBe('https://example.com/design-0.png');
  expect(request.referenceImageUrls).toEqual(['https://example.com/logo.png', 'https://example.com/ref.jpg']);
  expect(request.prompt).toContain('STYLE REFERENCE ONLY');
  expect(request.prompt).toContain('the selected design, then the official organization logo');
});

test('removing an attachment detaches it without regenerating or deleting design history', async () => {
  eventData.announcementDesigns = savedOptions();
  eventData.announcementReferenceImages = [{ id: 'ref-one', name: 'photo.png', imageUrl: 'https://example.com/photo.png', mode: 'include' }];
  await render();
  await act(async () => Simulate.click(container.querySelector('[aria-label="Remove photo.png"]')));
  expect(updateDoc).toHaveBeenCalledWith('eventInstances/event-one', { announcementReferenceImages: [] });
  expect(container.querySelector('img[alt="photo.png"]')).toBeNull();
  expect(global.fetch).not.toHaveBeenCalled();
});

test('rejects invalid files, oversized files and more than three attachments', async () => {
  eventData.announcementDesigns = savedOptions();
  await render();
  const input = container.querySelector('[aria-label="Upload design images"]');
  const choose = async files => act(async () => Simulate.change(input, { target: { files, value: 'selected' } }));
  await choose([new File(['text'], 'notes.txt', { type: 'text/plain' })]);
  expect(container.querySelector('[role="alert"]').textContent).toContain('PNG, JPEG, or WebP');
  await choose([{ name: 'large.jpg', type: 'image/jpeg', size: 5 * 1024 * 1024 }]);
  expect(container.querySelector('[role="alert"]').textContent).toContain('smaller than 5MB');
  await choose(Array.from({ length: 4 }, (_value, index) => new File(['photo'], `photo-${index}.png`, { type: 'image/png' })));
  expect(container.querySelector('[role="alert"]').textContent).toContain('up to three images');
  expect(uploadBytes).not.toHaveBeenCalled();
  expect(global.fetch).not.toHaveBeenCalled();
});

test('uploads three photos, blocks excess uploads, and retains them on a generated version', async () => {
  eventData.announcementDesigns = savedOptions();
  await render();
  const files = ['first.png', 'second.png', 'third.png'].map(name => new File(['photo'], name, { type: 'image/png' }));
  await act(async () => Simulate.change(container.querySelector('[aria-label="Upload design images"]'), { target: { files, value: 'photos' } }));
  expect(container.querySelectorAll('.event-designer-reference')).toHaveLength(3);
  expect(button('Upload images').disabled).toBe(true);
  expect(global.fetch).not.toHaveBeenCalled();
  await act(async () => Simulate.click(container.querySelector('[aria-label="Regenerate Editorial design"]')));
  await submitNewOptionsPrompt();
  const request = JSON.parse(global.fetch.mock.calls[0][1].body);
  expect(request.referenceImageUrls).toHaveLength(4);
  const designs = updateDoc.mock.calls[3][1].announcementDesigns;
  expect(designs[0].referenceImages).toHaveLength(3);
});

test('an upload blocks generation and keeps saved attachments when a later upload fails', async () => {
  eventData.announcementDesigns = savedOptions();
  eventData.announcementReferenceImages = [{ id: 'existing', name: 'saved.png', imageUrl: 'https://example.com/saved.png', mode: 'reference' }];
  let rejectUpload;
  uploadBytes.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectUpload = reject; }));
  await render();
  const file = new File(['photo'], 'new.png', { type: 'image/png' });
  await act(async () => Simulate.change(container.querySelector('[aria-label="Upload design images"]'), { target: { files: [file], value: 'new.png' } }));
  expect(button('New options').disabled).toBe(true);
  expect(container.querySelector('[aria-label="Image attachments upload progress"]')).not.toBeNull();
  await act(async () => rejectUpload(new Error('Upload failed')));
  expect(button('New options').disabled).toBe(false);
  expect(container.querySelector('img[alt="saved.png"]')).not.toBeNull();
  expect(container.querySelector('img[alt="new.png"]')).toBeNull();
  expect(container.querySelector('[role="alert"]').textContent).toContain('Could not upload');
  expect(global.fetch).not.toHaveBeenCalled();
});

test('each design option downloads its saved image without generating or changing it', async () => {
  eventData.announcementDesigns = savedOptions();
  downloadEventImage.mockResolvedValue(undefined);
  await render();
  for (const [index, concept] of ['Editorial', 'Community', 'Spotlight'].entries()) {
    const downloadButton = container.querySelector(`[aria-label="Download ${concept} design"]`);
    expect(downloadButton.disabled).toBe(false);
    await act(async () => Simulate.click(downloadButton));
    expect(downloadEventImage).toHaveBeenLastCalledWith(`https://example.com/design-${index}.png`, `Family Night - ${concept}`);
  }
  expect(global.fetch).not.toHaveBeenCalled();
  expect(updateDoc).not.toHaveBeenCalled();
});

test('downloading a selected older design version uses that version\'s image', async () => {
  eventData.announcementDesigns = savedOptions();
  eventData.announcementDesigns[0].versions.push({ imagePath: 'events/newer.jpg', imageUrl: 'https://example.com/newer.jpg' });
  Object.assign(eventData.announcementDesigns[0], { imagePath: 'events/newer.jpg', imageUrl: 'https://example.com/newer.jpg' });
  downloadEventImage.mockResolvedValue(undefined);
  await render();
  await act(async () => Simulate.click(button('Version 1')));
  await act(async () => Simulate.click(container.querySelector('[aria-label="Download Editorial design"]')));
  expect(downloadEventImage).toHaveBeenCalledWith('https://example.com/design-0.png', 'Family Night - Editorial');
});

test('the existing card image remains downloadable as the starting design', async () => {
  eventData.imageUrl = 'events/existing-card.jpg';
  await render();
  expect(container.querySelector('[aria-label="Download Editorial design"]').disabled).toBe(false);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('a failed design download shows an error without losing saved options', async () => {
  eventData.announcementDesigns = savedOptions();
  downloadEventImage.mockRejectedValue(new Error('Download failed'));
  await render();
  const downloadButton = container.querySelector('[aria-label="Download Editorial design"]');
  await act(async () => Simulate.click(downloadButton));
  expect(require('react-toastify').toast.error).toHaveBeenCalledWith('Download failed');
  expect(downloadButton.disabled).toBe(false);
  expect(container.querySelectorAll('.event-designer-preview img')).toHaveLength(3);
});

test('new versions retain the exact event details used to generate them', async () => {
  await render();
  await requestNewOptions();
  const saved = updateDoc.mock.calls[2][1];
  expect(saved.announcementDesignEventDetails).toEqual(getEventDesignDetails(eventData));
  expect(saved.announcementDesigns.every(option => option.eventDetails.title === 'Family Night')).toBe(true);
});

test('live event changes warn about outdated designs without automatically regenerating', async () => {
  const baseline = getEventDesignDetails(eventData);
  eventData.announcementDesigns = savedOptions().map(option => ({ ...option, eventDetails: baseline }));
  await render();
  expect(container.querySelector('[aria-label="Image needs updating"]')).toBeNull();
  await act(async () => costSubscriber({ exists: () => true, data: () => ({ ...eventData, title: 'Updated Family Night', startHour: '18:30' }) }));
  const warning = container.querySelector('[aria-label="Image needs updating"]');
  expect(warning.textContent).toContain('Title');
  expect(warning.textContent).toContain('Time');
  expect(container.querySelectorAll('.event-designer-stale-label')).toHaveLength(3);
  expect(container.querySelector('h1').textContent).toBe('Updated Family Night');
  expect(global.fetch).not.toHaveBeenCalled();
});

test('a fresh selected design still warns if the image on All Events is outdated', async () => {
  eventData.imageUrl = 'events/old-card.jpg';
  eventData.imageEventDetails = getEventDesignDetails({ ...eventData, title: 'Old Family Night' });
  eventData.announcementDesigns = savedOptions().map(option => ({ ...option, eventDetails: getEventDesignDetails(eventData) }));
  await render();
  expect(container.querySelector('[aria-label="Image needs updating"]').textContent).toContain('All Events still needs to be replaced');
  await act(async () => Simulate.click(button('Use this design')));
  expect(updateDoc).toHaveBeenCalledWith('eventInstances/event-one', expect.objectContaining({ imageEventDetails: getEventDesignDetails(eventData) }));
  expect(global.fetch).not.toHaveBeenCalled();
});

test('applying an old version preserves its original facts instead of falsely marking it current', async () => {
  const oldDetails = getEventDesignDetails({ ...eventData, title: 'Original Family Night' });
  eventData.announcementDesigns = savedOptions().map(option => ({ ...option, eventDetails: oldDetails }));
  await render();
  await act(async () => Simulate.click(button('Use this design')));
  expect(updateDoc).toHaveBeenCalledWith('eventInstances/event-one', expect.objectContaining({ imageEventDetails: oldDetails }));
});

test('a sub-event opens the shared master graphic as an editable starting option without generating', async () => {
  Object.assign(eventData, { recurrenceSeriesId: 'family-series', isRecurrenceMaster: false, imageUrl: 'events/test-org/master/shared.jpg' });
  await render();
  expect(container.querySelector('.event-designer-preview img').getAttribute('src')).toBe('https://example.com/events%2Ftest-org%2Fmaster%2Fshared.jpg');
  expect(global.fetch).not.toHaveBeenCalled();
  await act(async () => Simulate.change(container.querySelector('textarea'), { target: { value: 'Adjust this occurrence only' } }));
  await act(async () => Simulate.click(button('Refine design')));
  expect(JSON.parse(global.fetch.mock.calls[0][1].body).previousImageUrl).toContain('shared.jpg');
  expect(updateDoc.mock.calls.every(([reference]) => reference === 'eventInstances/event-one')).toBe(true);
  await act(async () => Simulate.click(button('Use this design')));
  expect(updateDoc).toHaveBeenLastCalledWith('eventInstances/event-one', expect.objectContaining({ imageIsSeriesOverride: true }));
  expect(getDocs).not.toHaveBeenCalled();
});

test('later master updates preserve an occurrence-specific image override', async () => {
  eventData.announcementDesigns = savedOptions();
  Object.assign(eventData, { isRecurrenceMaster: true, recurrenceSeriesId: 'family-series', useMasterDesignForSeries: true });
  getDocs.mockResolvedValue({ docs: [
    { id: 'shared-child', data: () => ({ churchId: 'test-org', recurrenceSeriesId: 'family-series' }) },
    { id: 'custom-child', data: () => ({ churchId: 'test-org', recurrenceSeriesId: 'family-series', imageIsSeriesOverride: true }) },
  ] });
  await render();
  await act(async () => Simulate.click(button('Use this design')));
  expect(updateDoc.mock.calls.map(([reference]) => reference)).toEqual(['eventInstances/event-one', 'eventInstances/shared-child']);
});

test('New options opens a prompt and can be cancelled without paid requests', async () => {
  eventData.announcementDesigns = savedOptions();
  await render();
  await act(async () => Simulate.click(button('New options')));
  expect(container.querySelector('[aria-label="New design options"]')).not.toBeNull();
  expect(button('Generate 3 options').disabled).toBe(true);
  expect(global.fetch).not.toHaveBeenCalled();
  await act(async () => Simulate.change(container.querySelector('#event-new-design-prompt'), { target: { value: 'A new layout for this event only' } }));
  expect(button('Generate 3 options').disabled).toBe(false);
  expect(global.fetch).not.toHaveBeenCalled();
  await act(async () => Simulate.click(button('Cancel')));
  expect(container.querySelector('[aria-label="New design options"]')).toBeNull();
  expect(global.fetch).not.toHaveBeenCalled();
  expect(updateDoc).not.toHaveBeenCalled();
});

test('first-time events and legacy fresh links both wait for a prompt', async () => {
  await render('?fresh=1');
  expect(global.fetch).not.toHaveBeenCalled();
  expect(uploadBytes).not.toHaveBeenCalled();
  expect(container.querySelectorAll('.event-designer-preview img')).toHaveLength(0);
});