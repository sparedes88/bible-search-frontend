import { getAppliedDesignDetails, getEventDesignBaselines, getEventDesignChanges, getEventDesignDetails, getEventImageChanges, getSharedDesignDetails } from './eventDesignDetails';

const event = { title: 'Family Night', startDate: '2026-11-01', startHour: '19:00', endHour: '20:30', location: 'Main Hall', description: 'Dinner and music' };

test('detects changed title, date, time, location and description', () => {
  const baseline = getEventDesignDetails(event);
  expect(getEventDesignChanges({ ...event, title: 'Updated Family Night', startDate: '2026-11-02', startHour: '18:00', location: 'North Hall', description: 'Dinner only' }, baseline)).toEqual(['Title', 'Date', 'Time', 'Location', 'Description']);
});

test('equivalent date/time formats and whitespace do not mark images stale', () => {
  expect(getEventDesignChanges({ ...event, title: ' Family   Night ', startDate: '11-01-2026', startHour: '7:00 PM' }, getEventDesignDetails(event))).toEqual([]);
});

test('does not invent a mismatch for an image with no saved baseline', () => {
  expect(getEventImageChanges({ ...event, imageUrl: 'old.jpg' })).toEqual([]);
});

test('captures legacy image details before an edit and preserves an existing baseline', () => {
  const saved = getEventDesignBaselines({ ...event, imageUrl: 'old.jpg' });
  expect(getEventImageChanges({ ...event, title: 'Updated', imageUrl: 'old.jpg', ...saved })).toEqual(['Title']);
  expect(getEventDesignBaselines({ ...event, title: 'Updated', imageUrl: 'old.jpg', ...saved })).toEqual(saved);
});

test('finds the applied image snapshot in design history', () => {
  const eventDetails = getEventDesignDetails(event);
  expect(getAppliedDesignDetails({ ...event, imageUrl: 'original.jpg', announcementDesigns: [{ imagePath: 'latest.jpg', versions: [{ imagePath: 'original.jpg', eventDetails }] }] })).toEqual(eventDetails);
});

test('checks applied images independently from unused stale design options', () => {
  expect(getEventImageChanges({ ...event, imageUrl: 'current.jpg', imageEventDetails: getEventDesignDetails(event), announcementDesigns: [{ eventDetails: getEventDesignDetails({ ...event, title: 'Old title' }) }] })).toEqual([]);
});

test('intentional series sharing keeps occurrence dates but tracks shared content', () => {
  const occurrence = { ...event, startDate: '2026-11-08' };
  const snapshot = getSharedDesignDetails(occurrence, getEventDesignDetails(event));
  expect(getEventDesignChanges(occurrence, snapshot)).toEqual([]);
  expect(getEventDesignChanges({ ...occurrence, startHour: '18:00' }, snapshot)).toEqual(['Time']);
});