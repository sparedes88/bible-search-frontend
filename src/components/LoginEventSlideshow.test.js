import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { getDocs } from 'firebase/firestore';
import { getDownloadURL } from 'firebase/storage';
import LoginEventSlideshow, { getLoginWeekEvents } from './LoginEventSlideshow';

jest.mock('../firebase', () => ({ db: {}, storage: {} }));
jest.mock('firebase/firestore', () => ({ collection: (_db, ...segments) => segments.join('/'), query: (reference, ...constraints) => ({ reference, constraints }), where: (...args) => args, getDocs: jest.fn() }));
jest.mock('firebase/storage', () => ({ ref: (_storage, path) => path, getDownloadURL: jest.fn() }));

let container;
let root;
let documents;
const render = async (organizationId = 'test-org') => act(async () => root.render(<LoginEventSlideshow organizationId={organizationId} />));

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 9, 29, 12));
  jest.clearAllMocks();
  global.IS_REACT_ACT_ENVIRONMENT = true;
  documents = [
    { id: 'friday', churchId: 'test-org', title: 'Friday Gathering', startDate: '10-30-2026', startHour: '19:00', endHour: '20:30', location: 'Main Hall', imageUrl: 'events/friday.jpg' },
    { id: 'saturday', churchId: 'test-org', title: 'Saturday Class', startDate: '2026-10-31', startHour: '10:00', imageUrl: 'https://example.com/class.jpg' },
    { id: 'next-week', churchId: 'test-org', title: 'Next Sunday', startDate: '11-01-2026' },
    { id: 'deleted', churchId: 'test-org', title: 'Deleted', startDate: '10-30-2026', isDeleted: true },
  ];
  getDocs.mockImplementation(async () => ({ docs: documents.map(event => ({ id: event.id, data: () => event })) }));
  getDownloadURL.mockResolvedValue('https://example.com/friday.jpg');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  jest.useRealTimers();
});

test('filters the current Sunday-Saturday week across date formats and sorts by schedule', () => {
  const events = [
    ...documents,
    { id: 'sunday', title: 'Start of week', startDate: '2026-10-25' },
    { id: 'previous-week', startDate: '10-24-2026' },
    { id: 'removed', startDate: '10-30-2026', removed: true },
    { id: 'cancelled', startDate: '10-30-2026', status: 'cancelled' },
    { id: 'invalid', startDate: '02-30-2026' },
  ];
  expect(getLoginWeekEvents(events, new Date(2026, 9, 29)).map(event => event.id)).toEqual(['sunday', 'friday', 'saturday']);
});

test('publicly loads only this organization\'s weekly slides and resolves uploaded image paths', async () => {
  documents.push({ id: 'foreign', churchId: 'other-org', title: 'Other organization', startDate: '10-30-2026' });
  await render();
  expect(getDocs).toHaveBeenCalledWith({ reference: 'eventInstances', constraints: [['churchId', '==', 'test-org']] });
  expect(getDownloadURL).toHaveBeenCalledWith('events/friday.jpg');
  expect(container.querySelector('img').getAttribute('src')).toBe('https://example.com/friday.jpg');
  expect(container.textContent).toContain('7:00 PM - 8:30 PM');
  expect(container.textContent).toContain('Friday Gathering');
  expect(container.textContent).not.toContain('Next Sunday');
  expect(container.textContent).toContain('1 / 2');
});

test('rotates every six seconds and supports next, previous and pause controls', async () => {
  await render();
  await act(async () => jest.advanceTimersByTime(6000));
  expect(container.querySelector('h3').textContent).toBe('Saturday Class');
  await act(async () => Simulate.click(container.querySelector('[aria-label="Previous event"]')));
  expect(container.querySelector('h3').textContent).toBe('Friday Gathering');
  await act(async () => Simulate.click(container.querySelector('[aria-label="Pause event slideshow"]')));
  await act(async () => jest.advanceTimersByTime(12000));
  expect(container.querySelector('h3').textContent).toBe('Friday Gathering');
  await act(async () => Simulate.click(container.querySelector('[aria-label="Next event"]')));
  expect(container.querySelector('h3').textContent).toBe('Saturday Class');
});

test('failed images keep the event name and schedule visible', async () => {
  await render();
  await act(async () => Simulate.error(container.querySelector('img')));
  expect(container.querySelector('img')).toBeNull();
  expect(container.textContent).toContain('Friday Gathering');
  expect(container.textContent).toContain('7:00 PM');
});

test('does not render a slideshow when there are no events in the current week', async () => {
  documents = documents.filter(event => event.id === 'next-week');
  await render();
  expect(container.querySelector('section')).toBeNull();
});

test('event loading failures are non-blocking and missing organization IDs make no reads', async () => {
  await render('');
  expect(getDocs).not.toHaveBeenCalled();
  getDocs.mockRejectedValue(new Error('Unavailable'));
  await render();
  expect(container.querySelector('[role="status"]').textContent).toContain('temporarily unavailable');
});

test('hover pauses automatic rotation and explicit play resumes it', async () => {
  await render();
  const slideshow = container.querySelector('section');
  await act(async () => Simulate.mouseEnter(slideshow));
  await act(async () => jest.advanceTimersByTime(6000));
  expect(container.querySelector('h3').textContent).toBe('Friday Gathering');
  await act(async () => Simulate.click(container.querySelector('[aria-label="Pause event slideshow"]')));
  await act(async () => Simulate.click(container.querySelector('[aria-label="Play event slideshow"]')));
  await act(async () => jest.advanceTimersByTime(6000));
  expect(container.querySelector('h3').textContent).toBe('Saturday Class');
});

test('a single event does not show unnecessary rotation controls', async () => {
  documents = documents.filter(event => event.id === 'friday');
  await render();
  expect(container.querySelector('[aria-label="Next event"]')).toBeNull();
  await act(async () => jest.advanceTimersByTime(18000));
  expect(container.querySelector('h3').textContent).toBe('Friday Gathering');
});

test('registration link follows the event currently shown in the slideshow', async () => {
  await render();
  let link = container.querySelector('.login-week-event-register');
  expect(link.getAttribute('href')).toBe('/organization/test-org/event/friday/register');
  expect(link.getAttribute('aria-label')).toBe('Register for Friday Gathering');
  expect(link.textContent).toContain('Register for this event');
  await act(async () => Simulate.click(container.querySelector('[aria-label="Next event"]')));
  link = container.querySelector('.login-week-event-register');
  expect(link.getAttribute('href')).toBe('/organization/test-org/event/saturday/register');
  expect(link.getAttribute('aria-label')).toBe('Register for Saturday Class');
});